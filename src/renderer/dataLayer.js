/**
 * usage-stats-app — in-page data layer (option C: the plugin's server logic
 * runs inside the WebView).
 *
 * Implements the SAME `/api/usage-stats/*` route semantics as the dsh plugin
 * server half, but the network requests go through tauri-plugin-http (Rust
 * performs the request — no CORS, credential scope allowlisted) and the
 * credentials (usage token / API key) live in the Rust core's config.json.
 *
 * The renderer keeps calling `fetchJson("/api/usage-stats/...")` — boot.js
 * intercepts those requests and routes them to `createDataLayer().handle()`.
 * All parsing/aggregation reuses the plugin's platform.js / balance.js
 * modules untouched (only fetch is injected).
 */

import { fetchPlatformUsageSmart, fetchPlatformCumulativeTokenTotal, fetchPlatformDayDetail, fetchPlatformMonthTokenSum, normalizeMonthYear } from "./platform.js";
import { balanceSchemeOf, queryBalance } from "./balance.js";

const PLATFORM_REFRESH_MS = 300000;
const UPSTREAM_TIMEOUT_MS = 15000;
const PLATFORM_TOTAL_MAX_MONTHS = 24;
const TOKEN_REF = "DEEPSEEK_USAGE_TOKEN";

//#region transport

let invokeImpl = null;
let transportFetch = null;

/** Inject the Tauri invoke (window.__TAURI__.core.invoke) or a test stub. */
export function setInvoke(fn) {
	invokeImpl = fn;
}

/**
 * Inject the HTTP transport (boot passes the official
 * @tauri-apps/plugin-http fetch, which implements the chunked body protocol
 * correctly). Tests pass a fake fetch.
 */
export function setTransportFetch(fn) {
	transportFetch = fn;
}

function invoke(command, args) {
	if (invokeImpl !== null) return invokeImpl(command, args);
	if (typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function") {
		return window.__TAURI__.core.invoke(command, args);
	}
	return Promise.reject(new Error("Tauri invoke unavailable (browser mode)"));
}

/**
 * Browser-fetch-shaped adapter over the official plugin-http fetch (Rust-side
 * requests — no CORS; scope allowlisted to the two DeepSeek hosts). The
 * shared platform.js / balance.js modules only use method/headers/signal and
 * a JSON/text response.
 */
async function httpFetch(url, init = {}) {
	if (typeof transportFetch !== "function") throw new Error("http transport not configured");
	return transportFetch(url, init);
}

const apiOptions = { fetchImpl: httpFetch, timeoutMs: UPSTREAM_TIMEOUT_MS };

//#endregion

//#region credentials (Rust-held config)

let credsCache = { usageToken: "", apiKey: "" };
let credsAt = 0;

async function readCredentials(force = false) {
	if (force || Date.now() - credsAt > 30000) {
		try {
			const creds = await invoke("get_credentials");
			credsCache = {
				usageToken: typeof creds?.usageToken === "string" ? creds.usageToken : "",
				apiKey: typeof creds?.apiKey === "string" ? creds.apiKey : ""
			};
			credsAt = Date.now();
		} catch { /* keep the previous cache on transport errors */ }
	}
	return credsCache;
}

//#endregion

//#region platform caches (mirrors the plugin server's per-month 5-min cache)

const monthCache = new Map();
const monthInflight = new Map();
const dayCache = new Map();
const dayInflight = new Map();
const totalSummary = { at: 0, result: null };
const totalMonthCache = new Map();
let totalInflight = null;

async function platformMonth(month, year, force = false) {
	const { month: m, year: y } = normalizeMonthYear(month, year);
	const key = `${y}-${String(m).padStart(2, "0")}`;
	const creds = await readCredentials();
	if (creds.usageToken === "") return null;
	if (!force) {
		const hit = monthCache.get(key);
		if (hit !== void 0 && Date.now() - hit.at < PLATFORM_REFRESH_MS) return hit.result;
	}
	const inflight = monthInflight.get(key);
	if (inflight !== void 0) return inflight;
	const run = fetchPlatformUsageSmart(creds.usageToken, { month: m, year: y, ...apiOptions }).then((result) => {
		monthCache.set(key, { at: Date.now(), result });
		return result;
	}).finally(() => {
		monthInflight.delete(key);
	});
	monthInflight.set(key, run);
	return run;
}

async function platformMonthTokenSum(month, year, timeoutMs = 20000) {
	const key = `${year}-${String(month).padStart(2, "0")}`;
	const hit = totalMonthCache.get(key);
	if (hit !== void 0 && Date.now() - hit.at < PLATFORM_REFRESH_MS) return hit.total;
	const token = (await readCredentials()).usageToken;
	if (token === "") return 0;
	const total = await Promise.race([
		fetchPlatformMonthTokenSum(token, { month, year, ...apiOptions }),
		// A single month must never stall the whole cumulative walk (WAF can be
		// slow on cold months); treat a timed-out month as 0.
		new Promise((resolve) => setTimeout(() => resolve(0), timeoutMs))
	]);
	totalMonthCache.set(key, { at: Date.now(), total });
	return total;
}

async function platformTotal(force = false) {
	const token = (await readCredentials()).usageToken;
	if (token === "") return null;
	if (!force && totalSummary.result !== null && Date.now() - totalSummary.at < PLATFORM_REFRESH_MS) return totalSummary.result;
	if (totalInflight !== null) return totalInflight;
	totalInflight = fetchPlatformCumulativeTokenTotal(token, {
		...apiOptions,
		maxMonths: PLATFORM_TOTAL_MAX_MONTHS,
		monthTotal: (month, year) => platformMonthTokenSum(month, year)
	}).then((result) => {
		totalSummary.at = Date.now();
		totalSummary.result = result;
		return result;
	}).finally(() => {
		totalInflight = null;
	});
	return totalInflight;
}

async function platformDayDetail(date, force = false) {
	const token = (await readCredentials()).usageToken;
	if (token === "") return null;
	if (!force) {
		const hit = dayCache.get(date);
		if (hit !== void 0 && Date.now() - hit.at < PLATFORM_REFRESH_MS) return hit.result;
	}
	const inflight = dayInflight.get(date);
	if (inflight !== void 0) return inflight;
	const run = fetchPlatformDayDetail(token, { date, ...apiOptions }).then((result) => {
		dayCache.set(date, { at: Date.now(), result });
		return result;
	}).finally(() => {
		dayInflight.delete(date);
	});
	dayInflight.set(date, run);
	return run;
}

//#endregion

//#region route handlers (same maps and shapes as the plugin server half)

async function handleUsage() {
	// Local session logs are dsh-private; the app is platform-only (the client
	// falls back to local only when platform data is absent).
	return { ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: Date.now() };
}

async function handleAccount() {
	const creds = await readCredentials(true);
	if (creds.apiKey === "") {
		// Card's "not configured" state (same shape as the plugin account
		// service when the API key ref is empty).
		return {
			ok: true,
			account: {
				id: "deepseek-official",
				displayName: "DeepSeek",
				mode: "balance",
				status: "not-configured",
				missingCredentials: ["DEEPSEEK_API_KEY"],
				statusMessage: "未配置 DEEPSEEK_API_KEY（可在应用配置或环境变量中设置）",
				balance: null,
				fetchedAt: Date.now()
			}
		};
	}
	try {
		const parsed = await queryBalance(balanceSchemeOf("deepseek-official"), "https://api.deepseek.com", creds.apiKey, UPSTREAM_TIMEOUT_MS, httpFetch);
		return {
			ok: true,
			account: {
				id: "deepseek-official",
				displayName: "DeepSeek",
				mode: "balance",
				status: parsed.isAvailable === false ? "unavailable" : "ok",
				balance: {
					isAvailable: parsed.isAvailable !== false,
					currency: parsed.currency,
					remaining: parsed.total,
					granted: parsed.granted,
					toppedUp: parsed.toppedUp
				},
				fetchedAt: Date.now()
			}
		};
	} catch (error) {
		const status = error?.providerStatus ?? "failed";
		return {
			ok: false,
			error: status === "unauthorized" ? "no-credential" : status,
			message: error instanceof Error ? error.message : String(error)
		};
	}
}

async function handlePlatform(search) {
	const month = search.get("month");
	const year = search.get("year");
	const force = search.get("refresh") === "1";
	let params;
	try {
		params = normalizeMonthYear(month, year);
	} catch (error) {
		return { ok: false, error: "invalid-params", message: error instanceof Error ? error.message : String(error) };
	}
	const result = await platformMonth(params.month, params.year, force);
	if (result === null) return { ok: false, error: "no-credential", message: TOKEN_REF };
	// Push a live tray tooltip whenever the platform data loads (best-effort).
	updateTrayTooltip(result).catch(() => {});
	return { ok: true, fetchedAt: Date.now(), ...result };
}

/** Today's `YYYY-MM-DD` in GMT+8 (platform display convention). */
function gmt8TodayKey() {
	return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Best-effort: report today tokens / month cost to the Rust tray tooltip. */
async function updateTrayTooltip(result) {
	if (!Array.isArray(result?.days) || typeof result?.monthCost !== "number") return;
	const today = gmt8TodayKey();
	const day = result.days.find((entry) => entry.date === today) ?? null;
	await invoke("update_tray_tooltip", {
		todayTokens: typeof day?.totalTokens === "number" ? day.totalTokens : 0,
		monthCost: result.monthCost
	});
}

async function handlePlatformTotal(search) {
	const result = await platformTotal(search.get("refresh") === "1");
	if (result === null) return { ok: false, error: "no-credential", message: TOKEN_REF };
	return { ok: true, fetchedAt: Date.now(), ...result };
}

async function handlePlatformDay(search) {
	const date = search.get("date") ?? "";
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return { ok: false, error: "invalid-params", message: "date must be YYYY-MM-DD" };
	}
	const result = await platformDayDetail(date, search.get("refresh") === "1");
	if (result === null) return { ok: false, error: "no-credential", message: TOKEN_REF };
	return { ok: true, fetchedAt: Date.now(), ...result };
}

async function handleToken(method, body) {
	if (method === "GET") {
		const creds = await readCredentials(true);
		const configured = creds.usageToken !== "";
		return { ok: true, configured, source: configured ? "app" : null };
	}
	if (method === "POST") {
		const token = typeof body?.token === "string" ? body.token.trim() : "";
		if (token === "") return { ok: false, error: "invalid-token", message: "token must be a non-empty string" };
		try {
			await invoke("save_token", { token });
			await readCredentials(true);
			return { ok: true, configured: true, source: "app" };
		} catch (error) {
			return { ok: false, error: "save-failed", message: error instanceof Error ? error.message : String(error) };
		}
	}
	// DELETE
	try {
		await invoke("clear_token");
		await readCredentials(true);
		return { ok: true, configured: false, source: null };
	} catch (error) {
		return { ok: false, error: "clear-failed", message: error instanceof Error ? error.message : String(error) };
	}
}

async function handleSync(method) {
	if (method === "POST") {
		try {
			const result = await invoke("sync_start");
			return { ok: true, ...result };
		} catch (error) {
			const code = error instanceof Error && error.message.includes("already") ? "sync-already-running" : "sync-failed";
			return { ok: false, error: code, message: error instanceof Error ? error.message : String(error) };
		}
	}
	if (method === "DELETE") {
		await invoke("sync_cancel").catch(() => {});
		return { ok: true, running: false };
	}
	const status = await invoke("sync_status").catch(() => ({ running: false, last: null }));
	return { ok: true, running: status?.running === true, last: status?.last ?? null };
}

//#endregion

/**
 * Route dispatcher matching the plugin's `/api/usage-stats/*` routes.
 * `path` = full path with query string (same shape fetch receives).
 */
export function createDataLayer() {
	return {
		async handle(path, init = {}) {
			const url = new URL(path, "http://app.local");
			const search = url.searchParams;
			const pathname = url.pathname;
			const method = (init.method ?? "GET").toUpperCase();
			let body = null;
			if (init.body !== void 0 && init.body !== null) {
				try { body = typeof init.body === "string" ? JSON.parse(init.body) : init.body; } catch { body = null; }
			}
			try {
				if (pathname === "/api/usage-stats/usage") return await handleUsage();
				if (pathname === "/api/usage-stats/account") return await handleAccount();
				if (pathname === "/api/usage-stats/platform/day") return await handlePlatformDay(search);
				if (pathname === "/api/usage-stats/platform/total") return await handlePlatformTotal(search);
				if (pathname === "/api/usage-stats/platform/token") return await handleToken(method, body);
				if (pathname === "/api/usage-stats/platform/sync") return await handleSync(method);
				if (pathname === "/api/usage-stats/platform") return await handlePlatform(search);
				return { ok: false, error: "not-found" };
			} catch (error) {
				return { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) };
			}
		}
	};
}
