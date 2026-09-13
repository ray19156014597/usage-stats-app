/**
 * usage-stats-app — boot (Tauri version).
 *
 * Loads AFTER the client bundle via `<script type="module">`:
 *   1. wires the data layer to Tauri (invoke + plugin-http via Rust core),
 *   2. installs a fetch interceptor: every `/api/usage-stats/*` request the
 *      panel makes is answered from the in-page data layer (option C — the
 *      plugin's server logic runs in the WebView; credentials come from the
 *      Rust core's config.json),
 *   3. runs the plugin bundle (require shims, dictionary harvest) and renders
 *      the panel full-window with the Chinese dictionary; auto-opens it once.
 */
import { createDataLayer, setInvoke, setTransportFetch } from "./dataLayer.js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

(function () {
	"use strict";
	var React = window.React;
	var ReactDOM = window.ReactDOM;

	// --- 1. transport: Tauri invoke (window.__TAURI__ via withGlobalTauri) ---
	var hasTauri = typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function";
	if (hasTauri) {
		setInvoke(function (command, args) { return window.__TAURI__.core.invoke(command, args); });
		setTransportFetch(tauriFetch);
	}

	// --- 2. fetch interceptor for the panel's /api/usage-stats/* calls ---
	var layer = hasTauri ? createDataLayer() : null;
	if (layer !== null) {
		var originalFetch = window.fetch.bind(window);
		window.fetch = function (input, init) {
			var raw = typeof input === "string" ? input : (input && input.url);
			if (typeof raw === "string" && raw.indexOf("/api/usage-stats/") === 0) {
				return layer.handle(raw, init || {}).then(function (payload) {
					return new Response(JSON.stringify(payload), {
						status: 200,
						headers: { "content-type": "application/json" }
					});
				});
			}
			return originalFetch(input, init);
		};

		// Frameless window: edge resize handles (Tauri window commands).
		var RESIZE_DIRECTIONS = { n: "North", s: "South", e: "East", w: "West", ne: "NorthEast", nw: "NorthWest", se: "SouthEast", sw: "SouthWest" };
		document.querySelectorAll(".usg_resize").forEach(function (el) {
			var direction = RESIZE_DIRECTIONS[el.getAttribute("data-edge")] || "East";
			el.addEventListener("pointerdown", function (event) {
				event.preventDefault();
				window.__TAURI__.core.invoke("plugin:window|start_resize_dragging", { direction: direction }).catch(function () {});
			});
		});

		// Frameless window: 面板头部即标题栏 —— 按住头部的空白处即可拖动窗口。
		// 用委托而不是 data-tauri-drag-region：后者只认"鼠标正好落在带属性的那个元素上"，
		// 点到标题文字就失效；这里改成"整个头部除按钮/输入框外都可拖"。
		document.addEventListener("mousedown", function (event) {
			if (event.button !== 0) return;
			var target = event.target;
			if (target === null || target === void 0 || typeof target.closest !== "function") return;
			if (target.closest("button, input, select, textarea, a, [data-no-drag]") !== null) return;
			if (target.closest(".usg_header") === null) return;
			event.preventDefault(); // 拖动时不要选中标题文字
			window.__TAURI__.core.invoke("plugin:window|start_dragging").catch(function () {});
		});
	}

	// --- 3. plugin bundle: require shims + dictionaries + render ---
	var entry = window.__USG_ENTRY__;
	if (entry === null || entry === void 0) {
		document.body.insertAdjacentHTML("beforeend",
			'<div id="boot-error" style="padding:24px;font-family:system-ui">Client bundle did not register.</div>');
		return;
	}

	var require = function (spec) {
		if (spec === "react") return React;
		if (spec === "react/jsx-runtime") {
			// jsx-runtime extracts the key argument; createElement would treat
			// it as a child and overwrite props.children.
			return {
				jsx: function (type, props) { return React.createElement(type, props); },
				jsxs: function (type, props) { return React.createElement(type, props); },
				Fragment: React.Fragment
			};
		}
		if (spec === "@deepseek-ai/dsh-client-ui-primitives") return window.USG_PRIMITIVES;
		throw new Error("unexpected require: " + spec);
	};

	var mod = entry.factory(require);
	if (typeof mod.apply !== "function") throw new Error("bundle missing apply export");

	var dicts = {};
	mod.apply({
		effect: function (fn) { fn(); return function () {}; },
		locale: {
			register: function (ns, dict) { dicts[ns] = dict; }
		},
		slots: {
			inject: function () { return function () {}; },
			register: function () { return function () {}; }
		}
	});
	var dict = dicts["usageStats"] || {};
	var t = function (key) {
		var value = (dict.zh && dict.zh[key]) || (dict.en && dict.en[key]);
		return value === void 0 ? key : value;
	};
	window.__USG_DICT__ = dict;

	var root = ReactDOM.createRoot(document.getElementById("root"));
	root.render(React.createElement(mod.UsageStatsPanel, { wide: true, t: t }));

	window.setTimeout(function () {
		var badge = document.querySelector("[data-usage-stats-badge]");
		if (badge !== null && badge !== void 0) badge.click();
	}, 120);
})();
