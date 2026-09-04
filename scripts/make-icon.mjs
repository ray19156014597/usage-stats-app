// Generate app icon assets from the DeepSeek whale SVG (extracted from the
// renderer bundle) using a headless Edge rasterizer: brand-blue rounded
// square + white whale. Outputs PNGs for the tray/window and an ICO (PNG
// entry) for the NSIS installer.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "src", "assets");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9345;
const PROFILE = join(root, ".tmp-icon-profile");

function delay(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

const source = readFileSync(join(root, "src", "renderer", "client.js"), "utf8");
const match = source.match(/DEEPSEEK_WHALE_D = "([^"]+)"/);
if (match === null) throw new Error("whale path not found in client bundle");
const whale = match[1];

function svgOf(size) {
	const scale = size / 27.4;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#4D6BFE"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-13.3 -11.6)">
    <path d="${whale}" fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd"/>
  </g>
</svg>`;
}

function icoWrap(png) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: icon
	header.writeUInt16LE(1, 4); // image count
	const entry = Buffer.alloc(16);
	entry.writeUInt8(0, 0); // 0 = 256px
	entry.writeUInt8(0, 1);
	entry.writeUInt8(0, 2);
	entry.writeUInt8(0, 3);
	entry.writeUInt16LE(1, 4);
	entry.writeUInt16LE(32, 6);
	entry.writeUInt32LE(png.length, 8);
	entry.writeUInt32LE(22, 12);
	return Buffer.concat([header, entry, png]);
}

const proc = spawn(EDGE, [
	"--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
	`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank"
], { stdio: "ignore", windowsHide: true });

let ws = null;
try {
	let page = null;
	for (let i = 0; i < 80 && page === null; i += 1) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
			page = list.find((t) => t.type === "page") ?? null;
		} catch { /* not up yet */ }
		if (page === null) await delay(250);
	}
	if (page === null) throw new Error("no debug page target");
	ws = new WebSocket(page.webSocketDebuggerUrl);
	let nextId = 0;
	const pending = new Map();
	ws.addEventListener("message", (ev) => {
		const msg = JSON.parse(String(ev.data));
		if (msg.id !== void 0 && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	});
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
	});
	const send = (method, params = {}) => new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});
	await send("Page.enable");
	await send("Runtime.enable");

	async function rasterize(size, file) {
		await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
		await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
		await send("Page.navigate", { url: "about:blank" });
		await delay(300);
		await send("Page.navigate", {
			url: "data:text/html;charset=utf-8," + encodeURIComponent(`<body style="margin:0;width:${size}px;height:${size}px">${svgOf(size)}</body>`)
		});
		await delay(500);
		const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
		writeFileSync(file, Buffer.from(shot.result.data, "base64"));
		console.log("written:", file, shot.result.data.length);
	}

	mkdirSync(assets, { recursive: true });
	const big = join(assets, "icon-256.png");
	await rasterize(256, big);
	await rasterize(32, join(assets, "tray-32.png"));
	writeFileSync(join(assets, "icon.ico"), icoWrap(readFileSync(big)));
	console.log("written:", join(assets, "icon.ico"));
} finally {
	try { ws?.close(); } catch { /* ignore */ }
	proc.kill();
	await delay(500);
	try { require("node:fs/promises").rm(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
}
