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
const QR_TERMINAL_COLUMNS = 56;
const QR_TERMINAL_BORDER = 2;

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
  const width = Math.min(QR_TERMINAL_COLUMNS, png.width);
  const height = Math.max(1, Math.round(width * png.height / png.width));
  const lines: string[] = [];
  for (let y = -QR_TERMINAL_BORDER; y < height + QR_TERMINAL_BORDER; y += 2) {
    const line: string[] = [];
    for (let x = -QR_TERMINAL_BORDER; x < width + QR_TERMINAL_BORDER; x++) {
      line.push(renderHalfBlock(sampleDark(png, x, y, width, height), sampleDark(png, x, y + 1, width, height)));
    }
    lines.push(`${line.join("")}\x1b[0m`);
  }
  return lines.join("\n");
}

function sampleDark(png: PNG, outX: number, outY: number, outWidth: number, outHeight: number) {
  if (outX < 0 || outY < 0 || outX >= outWidth || outY >= outHeight) {
    return false;
  }
  const x = Math.min(png.width - 1, Math.floor((outX + 0.5) * png.width / outWidth));
  const y = Math.min(png.height - 1, Math.floor((outY + 0.5) * png.height / outHeight));
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
