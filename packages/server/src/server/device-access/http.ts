import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Response,
  type NextFunction,
} from "express";
import type { DeviceAuthority } from "@clisbot/device-access/authority";
import { httpBinding } from "@clisbot/device-access/proof";
import { DeviceProofSchema } from "@clisbot/protocol/device-access";
import { extractHttpBearerToken, shouldBypassBearerAuth } from "../auth.js";
import { matchesLocalCredential } from "../local-credential.js";

const rawBody = Symbol("device-proof-body");
interface DeviceRequest extends Request {
  [rawBody]?: string;
}

export function mountDeviceAccess(input: {
  app: Express;
  authority: DeviceAuthority | undefined;
  localCredential(): string | null;
  managedAccessRequired(): boolean;
  revokeSessions(id: string): Promise<void>;
}): void {
  if (!input.authority) return;
  const options = { ...input, authority: input.authority };
  options.app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, body) => {
        (req as DeviceRequest)[rawBody] = body.toString("utf8");
      },
    }),
  );
  options.app.use(deviceGate(options));
  options.app.get(
    "/api/devices",
    deviceRoute(async () => ({
      devices: (await options.authority.list()).map(({ publicKey: _key, ...device }) => device),
    })),
  );
  options.app.post(
    "/api/devices/invitations",
    deviceRoute((req) =>
      options.authority.createInvitation({ label: req.body?.label, ttlMs: req.body?.ttlMs }),
    ),
  );
  options.app.patch(
    "/api/devices/:id",
    deviceRoute(async (req) => {
      await options.authority.rename(String(req.params.id), req.body?.label);
      return { ok: true };
    }),
  );
  options.app.delete(
    "/api/devices/:id",
    deviceRoute(async (req) => {
      const id = String(req.params.id);
      await options.authority.revoke(id);
      await options.revokeSessions(id);
      return { ok: true };
    }),
  );
}

function deviceGate(options: {
  authority: DeviceAuthority;
  localCredential(): string | null;
  managedAccessRequired(): boolean;
}): RequestHandler {
  return (req: DeviceRequest, res, next) => {
    if (shouldBypassBearerAuth(req.method, req.path)) {
      next();
      return;
    }
    const token = extractHttpBearerToken(req.header("authorization"));
    const local = options.localCredential();
    if (local && token && matchesLocalCredential(local, token)) {
      next();
      return;
    }
    if (options.managedAccessRequired()) {
      res.status(403).json({ error: "Managed access ticket required" });
      return;
    }
    void admitDeviceHttp(options.authority, req, res, next);
  };
}

async function authenticateRequest(authority: DeviceAuthority, req: DeviceRequest): Promise<void> {
  const header = req.header("x-clisbot-device-proof");
  if (!header || header.length > 1024) throw new Error("Missing device proof");
  if (
    (req.header("transfer-encoding") || Number(req.header("content-length") ?? "0") > 0) &&
    req[rawBody] === undefined
  )
    throw new Error("Unsupported signed body");
  const proof = DeviceProofSchema.parse(JSON.parse(header));
  await authority.authenticate(proof, {
    purpose: "http",
    binding: httpBinding({
      method: req.method,
      path: req.originalUrl,
      body: req[rawBody] ?? "",
    }),
  });
}

function deviceRoute(action: (request: Request) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void respondToDeviceOperation(() => action(req), res, next);
  };
}

async function respondToDeviceOperation(
  action: () => Promise<unknown>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await action());
  } catch (error) {
    next(error);
  }
}

async function admitDeviceHttp(
  authority: DeviceAuthority,
  req: DeviceRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authenticateRequest(authority, req);
    next();
  } catch {
    res.status(401).json({ error: "Paired device required" });
  }
}
