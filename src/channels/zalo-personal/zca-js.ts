import { dirname } from "node:path";
import { PNG } from "pngjs";
import { collapseHomePath, ensureDir, expandHomePath } from "../../infra/paths.ts";
import {
  readZaloPersonalAuthSession,
  writeZaloPersonalAuthSession,
  type ZaloPersonalAuthSession,
} from "./session-file.ts";

const DEFAULT_ZALO_PERSONAL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const DEFAULT_ZALO_PERSONAL_LANGUAGE = "vi";
const QR_TERMINAL_QUIET_MODULES = 4;

type ZcaJsModule = typeof import("zca-js");
type ZaloPersonalApi = Awaited<ReturnType<InstanceType<ZcaJsModule["Zalo"]>["login"]>>;

export type ZaloPersonalClient = {
  api: ZaloPersonalApi;
  ThreadType: ZcaJsModule["ThreadType"];
};

export type ZaloPersonalLoginLogger = {
  log(message: string): void;
};

async function loadZcaJs() {
  return await import("zca-js");
}

function renderQrImage(image: string, logger: ZaloPersonalLoginLogger) {
  const png = PNG.sync.read(Buffer.from(stripPngDataUrlPrefix(image), "base64"));
  logger.log(renderPngAsTerminalQr(png));
}

function stripPngDataUrlPrefix(image: string) {
  return image.replace(/^data:image\/png;base64,/, "");
}

function renderPngAsTerminalQr(png: PNG) {
  const modules = extractQrModules(png) ?? samplePngAsQrModules(png);
  const padded = padQrModules(modules, QR_TERMINAL_QUIET_MODULES);
  const lines: string[] = [];
  if (padded.length % 2 === 1) {
    padded.push(new Array(padded[0]?.length ?? 0).fill(false));
  }

  for (let y = 0; y < padded.length; y += 2) {
    const line: string[] = [];
    for (let x = 0; x < (padded[y]?.length ?? 0); x++) {
      line.push(renderHalfBlock(padded[y]?.[x] ?? false, padded[y + 1]?.[x] ?? false));
    }
    lines.push(`${line.join("")}\x1b[0m`);
  }
  return lines.join("\n");
}

function extractQrModules(png: PNG) {
  const bounds = findDarkBounds(png);
  if (!bounds) {
    return null;
  }
  const moduleCount = inferQrModuleCount(bounds.width, bounds.height);
  if (!moduleCount) {
    return null;
  }
  const stepX = bounds.width / moduleCount;
  const stepY = bounds.height / moduleCount;
  return Array.from({ length: moduleCount }, (_, row) =>
    Array.from({ length: moduleCount }, (_, col) =>
      isDarkPngPixel(
        png,
        Math.round(bounds.minX + (col + 0.5) * stepX),
        Math.round(bounds.minY + (row + 0.5) * stepY),
      )
    )
  );
}

function findDarkBounds(png: PNG) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!isDarkPngPixel(png, x, y)) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= minX && maxY >= minY
    ? { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
}

function inferQrModuleCount(width: number, height: number) {
  let best: { count: number; score: number } | undefined;
  for (let count = 21; count <= 177; count += 4) {
    const stepX = width / count;
    const stepY = height / count;
    const roundedX = Math.round(stepX);
    const roundedY = Math.round(stepY);
    const score = Math.abs(stepX - roundedX) + Math.abs(stepY - roundedY);
    if (roundedX < 2 || roundedY < 2 || Math.abs(stepX - stepY) > 0.25) {
      continue;
    }
    if (!best || score < best.score) {
      best = { count, score };
    }
  }
  return best && best.score < 0.1 ? best.count : null;
}

function samplePngAsQrModules(png: PNG) {
  const width = Math.min(56, png.width);
  const height = Math.max(1, Math.round(width * png.height / png.width));
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) =>
      isDarkPngPixel(
        png,
        Math.floor((col + 0.5) * png.width / width),
        Math.floor((row + 0.5) * png.height / height),
      )
    )
  );
}

function padQrModules(modules: boolean[][], border: number) {
  const width = modules[0]?.length ?? 0;
  const quietRow = new Array(width + border * 2).fill(false);
  return [
    ...Array.from({ length: border }, () => [...quietRow]),
    ...modules.map((row) => [
      ...new Array(border).fill(false),
      ...row,
      ...new Array(border).fill(false),
    ]),
    ...Array.from({ length: border }, () => [...quietRow]),
  ];
}

function isDarkPngPixel(png: PNG, x: number, y: number) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return false;
  }
  const offset = (png.width * y + x) << 2;
  const alpha = png.data[offset + 3] ?? 255;
  const luminance = 0.2126 * (png.data[offset] ?? 255) +
    0.7152 * (png.data[offset + 1] ?? 255) +
    0.0722 * (png.data[offset + 2] ?? 255);
  return alpha >= 128 && luminance < 128;
}

function renderHalfBlock(topDark: boolean, bottomDark: boolean) {
  const foreground = topDark ? 30 : 97;
  const background = bottomDark ? 40 : 107;
  return `\x1b[${foreground};${background}m▀`;
}

function buildSession(params: {
  cookie: unknown[];
  imei: string;
  userAgent: string;
  language?: string;
  user?: {
    name?: string;
    avatar?: string;
  };
}) {
  return {
    version: 1,
    cookie: params.cookie,
    imei: params.imei,
    userAgent: params.userAgent,
    language: params.language,
    savedAt: new Date().toISOString(),
    user: params.user,
  } satisfies ZaloPersonalAuthSession;
}

function buildSessionFromApi(api: ZaloPersonalApi, user?: ZaloPersonalAuthSession["user"]) {
  const context = api.getContext();
  const cookieJar = api.getCookie();
  return buildSession({
    cookie: cookieJar.toJSON()?.cookies ?? [],
    imei: context.imei,
    userAgent: context.userAgent,
    language: context.language,
    user,
  });
}

export async function loginZaloPersonalFromSession(tokenFile: string): Promise<ZaloPersonalClient> {
  const session = await readZaloPersonalAuthSession(tokenFile);
  if (!session) {
    throw new Error(`Missing Zalo Personal auth/session file: ${collapseHomePath(expandHomePath(tokenFile))}`);
  }
  const zca = await loadZcaJs();
  const zalo = new zca.Zalo({ logging: false });
  const api = await zalo.login({
    cookie: session.cookie as any,
    imei: session.imei,
    userAgent: session.userAgent,
    language: session.language,
  });
  await writeZaloPersonalAuthSession(tokenFile, buildSessionFromApi(api, session.user));
  return {
    api,
    ThreadType: zca.ThreadType,
  };
}

export async function loginZaloPersonalWithQr(params: {
  tokenFile: string;
  qrPath?: string;
  logger?: ZaloPersonalLoginLogger;
}) {
  const logger = params.logger ?? console;
  const zca = await loadZcaJs();
  const zalo = new zca.Zalo({ logging: false });
  let pendingSession: ZaloPersonalAuthSession | undefined;
  let scannedUser: ZaloPersonalAuthSession["user"] | undefined;
  const qrSaveTasks: Array<Promise<void>> = [];
  const qrPath = params.qrPath ? expandHomePath(params.qrPath) : undefined;

  logger.log("Zalo Personal QR login only. Scan this QR with the Zalo mobile app.");
  const api = await zalo.loginQR(
    {
      userAgent: DEFAULT_ZALO_PERSONAL_USER_AGENT,
      language: DEFAULT_ZALO_PERSONAL_LANGUAGE,
      ...(qrPath ? { qrPath } : {}),
    },
    (event) => {
      switch (event.type) {
        case zca.LoginQRCallbackEventType.QRCodeGenerated:
          renderQrImage(event.data.image, logger);
          if (qrPath) {
            qrSaveTasks.push(
              (async () => {
                try {
                  await ensureDir(dirname(qrPath));
                  await event.actions.saveToFile(qrPath);
                  logger.log(`QR saved: ${collapseHomePath(qrPath)}`);
                } catch (error) {
                  const reason = error instanceof Error ? error.message : String(error);
                  logger.log(`QR save failed: ${collapseHomePath(qrPath)} ${reason}`);
                }
              })(),
            );
          }
          break;
        case zca.LoginQRCallbackEventType.QRCodeScanned:
          scannedUser = {
            name: event.data.display_name,
            avatar: event.data.avatar,
          };
          logger.log(`QR scanned by: ${event.data.display_name}`);
          break;
        case zca.LoginQRCallbackEventType.QRCodeDeclined:
          logger.log("QR login declined on the phone.");
          break;
        case zca.LoginQRCallbackEventType.QRCodeExpired:
          logger.log("QR expired; zca-js is retrying or aborting according to its callback action.");
          event.actions.retry();
          break;
        case zca.LoginQRCallbackEventType.GotLoginInfo:
          pendingSession = buildSession({
            cookie: event.data.cookie as unknown[],
            imei: event.data.imei,
            userAgent: event.data.userAgent,
            language: DEFAULT_ZALO_PERSONAL_LANGUAGE,
            user: scannedUser,
          });
          break;
      }
    },
  );
  await Promise.all(qrSaveTasks);

  pendingSession = pendingSession ?? buildSessionFromApi(api, scannedUser);
  const path = await writeZaloPersonalAuthSession(params.tokenFile, pendingSession);
  logger.log(`Zalo Personal auth/session saved: ${collapseHomePath(path)}`);
  return {
    api,
    session: pendingSession,
    ThreadType: zca.ThreadType,
  };
}
