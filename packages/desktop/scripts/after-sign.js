const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");
const { reSignAdhocWithoutHardenedRuntime } = require("./adhoc-signature.js");
const { smokePackagedHubChannels } = require("./packaged-channel-smoke.js");

// electron-builder arch enum → Node.js arch string
const ARCH_MAP = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const EXECUTABLE_NAME = "Clisbot";

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`);
  reSignAdhocWithoutHardenedRuntime(appPath);

  // Only a signed app runs, and only one built for this machine.
  const arch = ARCH_MAP[context.arch];
  if (arch === process.arch) {
    smokePackagedHubChannels({
      executable: path.join(appPath, "Contents", "MacOS", EXECUTABLE_NAME),
      resourcesDirectory: path.join(appPath, "Contents", "Resources"),
    });
  } else {
    console.log(
      `Skipping packaged channel smoke: build arch ${arch} differs from host ${process.arch}.`,
    );
  }

  if (process.env.CLISBOT_DESKTOP_SMOKE !== "1") {
    return;
  }

  await smokePackagedDesktopApp({ appPath });
};
