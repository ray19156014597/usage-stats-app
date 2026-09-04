// Copy the React 18 UMD builds into the renderer vendor folder (zero-build
// renderer: the app serves classic scripts, no bundler).
import { mkdir, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "src", "renderer", "vendor");
await mkdir(vendor, { recursive: true });

const pairs = [
	[join(root, "node_modules", "react", "umd", "react.production.min.js"), join(vendor, "react.production.min.js")],
	[join(root, "node_modules", "react-dom", "umd", "react-dom.production.min.js"), join(vendor, "react-dom.production.min.js")]
];
for (const [from, to] of pairs) {
	await copyFile(from, to);
	console.log("vendor:", to);
}
