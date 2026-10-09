// Builds extension/ into dist-ext/: esbuild bundles each script, and the
// other files are copied. It stops when the manifest version is not the
// package.json version, so AMO signs the version that npm publishes.
//   node scripts/build-ext.mjs         the release build that AMO signs
//   node scripts/build-ext.mjs --e2e   the test build: the sidebar keeps window.foxpaw
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const { values } = parseArgs({ options: { e2e: { type: "boolean", default: false } } });

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`extension/manifest.json has version ${manifest.version}, but package.json has ${pkg.version}. Make them equal.`);
  process.exit(1);
}

rmSync("dist-ext", { recursive: true, force: true });
const files = readdirSync("extension");
await build({
  entryPoints: files.filter((f) => f.endsWith(".js")).map((f) => `extension/${f}`),
  outdir: "dist-ext",
  bundle: true,
  format: "iife",
  target: "firefox153",
  resolveExtensions: [".ts", ".js"],
  logLevel: "warning",
  define: { __E2E__: String(values.e2e) },
  // Drops the dead "if (false)" branch, so the release build has no hook.
  minifySyntax: true,
});
// amo-metadata.json is the AMO listing, not a part of the add-on.
for (const file of files.filter((f) => !f.endsWith(".js") && f !== "amo-metadata.json")) cpSync(`extension/${file}`, `dist-ext/${file}`, { recursive: true });
console.log(`Built dist-ext/ (version ${pkg.version}${values.e2e ? ", e2e build" : ""}).`);
