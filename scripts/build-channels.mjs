import { execFileSync } from "node:child_process";
import { channelPackageDirs } from "./channel-packages.mjs";

// The Hub imports the channel packages' built output, so they build before it does.
for (const workspace of channelPackageDirs()) {
  execFileSync("npm", ["run", "build", "--workspace", workspace], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
