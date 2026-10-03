import { readFileSync } from "node:fs";
import { createGateway, type GatewayConfig } from "./gateway.js";

const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as GatewayConfig;
const server = createGateway(config);
const sockets = new Set<import("node:net").Socket>();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
server.listen(config.port, "127.0.0.1", () =>
  process.send?.({
    type: "clisbot:ready",
    listen: `127.0.0.1:${config.port}`,
    serverId: config.instanceId,
  }),
);
const stop = () => {
  server.close(() => process.exit(0));
  for (const socket of sockets) socket.destroy();
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("message", (message) => {
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "clisbot:graceful-shutdown"
  )
    stop();
});
