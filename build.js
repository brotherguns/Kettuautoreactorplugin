const fs = require("fs");
const crypto = require("crypto");

if (!fs.existsSync("dist")) fs.mkdirSync("dist");

const code = fs.readFileSync("dist/index.js", "utf8");
const hash = crypto.createHash("sha256").update(code).digest("hex");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
manifest.hash = hash;
fs.writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 4));
console.log("Hash:", hash);
