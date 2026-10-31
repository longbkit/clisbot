const path = require("node:path");
const { verifyDesktopRenderer } = require("./renderer-build");

exports.default = async function beforePack() {
  verifyDesktopRenderer(path.resolve(__dirname, "..", "..", "app", "dist"));
};
