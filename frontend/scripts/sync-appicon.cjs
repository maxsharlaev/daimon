"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const args = new Set(process.argv.slice(2));
const ifChangedOnly = args.has("--if-changed");
const forceFS = args.has("--force");

function md5File(filePath) {
  return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
}

function bumpEpoch(epochGo) {
  const body = fs.readFileSync(epochGo, "utf8");
  const next = String(Date.now());
  const replaced = body.replace(/const Epoch = \d+/, `const Epoch = ${next}`);
  if (replaced === body) {
    console.warn("sync-appicon: could not bump internal/appicon/epoch.go (pattern missing)");
    return false;
  }
  fs.writeFileSync(epochGo, replaced, "utf8");
  console.log("sync-appicon: bumped appicon Epoch ->", next);
  return true;
}

function darwinRefreshBundle() {
  if (process.platform !== "darwin") return;
  const appPath = path.join(__dirname, "..", "..", "build", "bin", "daimon.app");
  if (!fs.existsSync(appPath)) return;
  const { execFileSync } = require("child_process");
  const now = new Date();
  try {
    fs.utimesSync(appPath, now, now);
    execFileSync(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", appPath],
      { stdio: "ignore" }
    );
    console.log("sync-appicon: Launch Services refresh:", path.basename(appPath));
  } catch (e) {
    console.warn("sync-appicon: darwin refresh failed:", e.message);
  }
}

const src = path.join(__dirname, "..", "src", "images", "daimon-icon.png");
const dest = path.join(__dirname, "..", "..", "build", "appicon.png");
const epochGo = path.join(__dirname, "..", "..", "internal", "appicon", "epoch.go");

if (!fs.existsSync(src)) {
  console.error("sync-appicon: missing", src);
  process.exit(1);
}

if (!fs.existsSync(epochGo)) {
  console.error("sync-appicon: missing", epochGo);
  process.exit(1);
}

const srcHash = md5File(src);
let destHash = null;
if (fs.existsSync(dest)) {
  try {
    destHash = md5File(dest);
  } catch {
    destHash = null;
  }
}

const iconChanged = destHash !== srcHash;

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);

const shouldBump = ifChangedOnly ? iconChanged : true;

if (shouldBump) {
  bumpEpoch(epochGo);
} else if (ifChangedOnly && !iconChanged) {
  console.log("sync-appicon: build/appicon.png already matches src; skip Epoch bump");
}

if (forceFS) {
  const icns = path.join(__dirname, "..", "..", "build", "bin", "daimon.app", "Contents", "Resources", "iconfile.icns");
  try {
    if (fs.existsSync(icns)) {
      fs.unlinkSync(icns);
      console.log("sync-appicon: removed stale", path.basename(icns));
    }
  } catch (e) {
    console.warn("sync-appicon: could not remove iconfile.icns:", e.message);
  }
  darwinRefreshBundle();
} else if (shouldBump && iconChanged && process.platform === "darwin") {
  darwinRefreshBundle();
}

console.log("sync-appicon:", path.relative(process.cwd(), src), "->", path.relative(process.cwd(), dest));
