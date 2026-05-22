// electron-builder afterPack hook: strip extended-attribute "detritus"
// (com.apple.quarantine, com.apple.FinderInfo, resource forks) from the packed
// .app before codesign runs. Bundling macFUSE means files get copied off a
// mounted DMG, which tags them with xattrs that make codesign fail with
// "resource fork, Finder information, or similar detritus not allowed".
const { execSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const productFilename = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${productFilename}.app`;
  try {
    execSync(`xattr -cr "${appPath}"`, { stdio: "inherit" });
    console.log(`afterPack: cleared extended attributes on ${appPath}`);
  } catch (e) {
    console.warn("afterPack: xattr -cr failed —", e.message);
  }
};
