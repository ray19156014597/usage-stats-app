// Data-layer smoke test (option C): the panel's /api/usage-stats/* routes now
// run inside the WebView. Node imports the same ESM modules with a fake Tauri
// invoke (credentials/sync commands) + a fake transport fetch and asserts the
// route shapes.
import { createDataLayer, setInvoke, setTransportFetch } from "../src/renderer/dataLayer.js";

const results = [];
function pass(name) { results.push(`ok:   ${name}`); console.log(`ok:   ${name}`); }
function fail(name, detail) { results.push(`FAIL: ${name} — ${detail}`); console.error(`FAIL: ${name} — ${detail}`); }

let credentials = { usageToken: "tok-1", apiKey: "sk-1" };
let savedToken = "";
let syncStarted = 0;
const invokeCalls = [];
const trayPushes = [];

// GMT+8-aligned bucket for 2026-08-07 (matches the plugin fixtures).
const TIME = 1783756800 + 8 * 3600;
const amountBody = {
	data: {
		biz_data: {
			start: 1,
			end: 2,
			bucket: 86400,
			models: [],
			series: [{
				api_key: { tracking_id: "t1", name: "Harness", sensitive_id: "sk-***", valid: true },
				model: "deepseek-v4-flash",
				buckets: [{ time: TIME, usage: { REQUEST: 5, PROMPT_CACHE_HIT_TOKEN: 100, PROMPT_CACHE_MISS_TOKEN: 10, RESPONSE_TOKEN: 20 } }]
			}]
		}
	}
};
const costBody = {
	data: {
		biz_data: {
			data: [{
				currency: "CNY",
				series: [{
					api_key: { tracking_id: "t1", name: "Harness" },
					model: "deepseek-v4-flash",
					buckets: [{ time: TIME, cost: 0.5 }]
				}]
			}]
		}
	}
};
const balanceBody = {
	is_available: true,
	balance_infos: [{ currency: "CNY", total_balance: "9.34", granted_balance: "0", topped_up_balance: "9.34" }]
};

function fakeFetch(url, init = {}) {
	const u = String(url);
	if (u.includes("/user/balance")) return { status: 200, body: balanceBody };
	if (u.includes("/api/v0/usage/by_api_key/amount")) return { status: 200, body: amountBody };
	if (u.includes("/api/v0/usage/by_api_key/cost")) return { status: 200, body: costBody };
	throw new Error(`unexpected upstream URL: ${u}`);
}

let fetchCounter = 0;
const fetchStore = new Map();

function fakeTransport(url, init = {}) {
	const response = fakeFetch(url, init);
	const id = ++fetchCounter;
	fetchStore.set(id, { status: response.status, body: JSON.stringify(response.body) });
	return Promise.resolve({
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		json: async () => response.body,
		text: async () => JSON.stringify(response.body)
	});
}

const fakeInvoke = (command, args) => {
	invokeCalls.push(command);
	if (command === "get_credentials") return Promise.resolve(credentials);
	if (command === "save_token") { savedToken = args.token; credentials = { ...credentials, usageToken: args.token }; return Promise.resolve({ ok: true }); }
	if (command === "clear_token") { savedToken = ""; credentials = { ...credentials, usageToken: "" }; return Promise.resolve({ ok: true }); }
	if (command === "save_api_key") { credentials = { ...credentials, apiKey: args.key }; return Promise.resolve({ ok: true }); }
	if (command === "clear_api_key") { credentials = { ...credentials, apiKey: "" }; return Promise.resolve({ ok: true }); }
	if (command === "update_tray_tooltip") { trayPushes.push(args); return Promise.resolve(); }
	if (command === "sync_start") { syncStarted += 1; return Promise.resolve({ ok: true, opened: true, running: true }); }
	if (command === "sync_status") return Promise.resolve({ running: false, last: null });
	if (command === "sync_cancel") return Promise.resolve({ ok: true, running: false });
	return Promise.reject(new Error(`unknown command ${command}`));
};

const layer = createDataLayer();
setInvoke(fakeInvoke);
setTransportFetch(fakeTransport);

// 1. Usage route: platform-only inert aggregate.
const usage = await layer.handle("/api/usage-stats/usage");
if (usage.ok === true && Array.isArray(usage.days) && usage.days.length === 0) pass("/usage inert platform-only aggregate");
else fail("/usage", JSON.stringify(usage));

// 2. Account/balance: fake DeepSeek balance normalized to the card shape.
const account = await layer.handle("/api/usage-stats/account?provider=deepseek-official");
if (account.ok === true && account.account?.mode === "balance" && account.account?.balance?.remaining === "9.34") pass(`/account balance (¥${account.account.balance.remaining})`);
else fail("/account", JSON.stringify(account).slice(0, 220));

// 3. Platform month: by_api_key aggregation via the plugin's parser.
const month = await layer.handle("/api/usage-stats/platform?month=8&year=2026");
if (month.ok === true && month.source === "by-api-key" && Array.isArray(month.days) && month.days.length === 1) pass(`/platform month (${month.days[0].date}, ${month.days[0].totalTokens} tokens, ¥${month.days[0].totalCost})`);
else fail("/platform month", JSON.stringify(month).slice(0, 220));

// 4. Month cache hit: second call must not hit the upstream again.
const upstreamBefore = fetchCounter;
await layer.handle("/api/usage-stats/platform?month=8&year=2026");
const upstreamAfter = fetchCounter;
if (upstreamAfter === upstreamBefore) pass("platform month served from the 5-min cache");
else fail("platform cache", `upstream calls ${upstreamBefore} → ${upstreamAfter}`);

// 5. Token settings: save flows through the Rust config command.
const tokenSaved = await layer.handle("/api/usage-stats/platform/token", { method: "POST", body: JSON.stringify({ token: "tok-new" }) });
if (tokenSaved.ok === true && savedToken === "tok-new") pass("/platform/token POST writes through invoke");
else fail("/platform/token POST", JSON.stringify(tokenSaved));
const tokenStatus = await layer.handle("/api/usage-stats/platform/token", { method: "GET" });
if (tokenStatus.ok === true && tokenStatus.configured === true) pass("/platform/token GET reports configured");
else fail("/platform/token GET", JSON.stringify(tokenStatus));

// 5b. Credential switch must not serve the previous account's cached numbers
// (report repro 3): the token change has to invalidate the month/day caches.
const beforeSwitch = fetchCounter;
await layer.handle("/api/usage-stats/platform/token", { method: "POST", body: JSON.stringify({ token: "tok-other" }) });
const afterSwitch = await layer.handle("/api/usage-stats/platform?month=8&year=2026");
if (afterSwitch.ok === true && fetchCounter > beforeSwitch) pass("credential switch re-queries the month instead of the old cache");
else fail("credential switch cache", `upstream calls ${beforeSwitch} → ${fetchCounter}, ok=${afterSwitch.ok}`);

// 6. Sync: start/status/cancel route to the Rust commands.
const syncStartedResult = await layer.handle("/api/usage-stats/platform/sync", { method: "POST" });
if (syncStartedResult.ok === true && syncStarted === 1) pass("/platform/sync POST starts the login window");
else fail("/platform/sync POST", JSON.stringify(syncStartedResult));
const syncStatus = await layer.handle("/api/usage-stats/platform/sync", { method: "GET" });
if (syncStatus.ok === true && syncStatus.running === false) pass("/platform/sync GET status");
else fail("/platform/sync GET", JSON.stringify(syncStatus));

// 7. No credential: clearing the token (which force-refreshes the credential
// cache) must surface clean no-credential, not stale cached platform data.
await layer.handle("/api/usage-stats/platform/token", { method: "DELETE" });
const missing = await layer.handle("/api/usage-stats/platform?month=8&year=2026");
if (missing.ok === false && missing.error === "no-credential") pass("/platform clean no-credential after token clear");
else fail("/platform no-credential", JSON.stringify(missing).slice(0, 220));

// 8. Tray (report F09): only the CURRENT Beijing month may rewrite "本月".
// Browsing August or the cross-month prefetch must not touch the tooltip.
{
	trayPushes.length = 0;
	await layer.handle("/api/usage-stats/platform/token", { method: "POST", body: JSON.stringify({ token: "tok-tray" }) });
	await layer.handle("/api/usage-stats/platform?month=8&year=2026&refresh=1");
	if (trayPushes.length === 0) pass("historical month never rewrites the tray");
	else fail("tray historical month", JSON.stringify(trayPushes));

	const now = new Date();
	const currentMonth = now.getMonth() + 1;
	const currentYear = now.getFullYear();
	trayPushes.length = 0;
	await layer.handle(`/api/usage-stats/platform?month=${currentMonth}&year=${currentYear}&refresh=1`);
	const pushed = trayPushes[0];
	if (pushed !== void 0 && pushed.monthLabel === `${currentYear}-${String(currentMonth).padStart(2, "0")}` && pushed.currency === "CNY") {
		pass("current month updates the tray with its label and currency");
	} else fail("tray current month", JSON.stringify(trayPushes));
}

// 9. Balance API key settings (report F12): the key has a real route now, and a
// failed Rust write must surface as a failure instead of a silent success.
{
	const apiKeyStatus = await layer.handle("/api/usage-stats/platform/apikey", { method: "GET" });
	if (apiKeyStatus.ok === true && apiKeyStatus.configured === true) pass("/platform/apikey GET reports configured");
	else fail("/platform/apikey GET", JSON.stringify(apiKeyStatus));
	const saved = await layer.handle("/api/usage-stats/platform/apikey", { method: "POST", body: JSON.stringify({ key: "sk-new" }) });
	if (saved.ok === true && credentials.apiKey === "sk-new") pass("/platform/apikey POST writes through invoke");
	else fail("/platform/apikey POST", JSON.stringify(saved));
	const cleared = await layer.handle("/api/usage-stats/platform/apikey", { method: "DELETE" });
	if (cleared.ok === true && credentials.apiKey === "") pass("/platform/apikey DELETE clears the key");
	else fail("/platform/apikey DELETE", JSON.stringify(cleared));
	credentials = { ...credentials, apiKey: "sk-1" };
}

// 10. Report F01/F11 surfacing: a rejected Rust command must be reported, not
// turned into "ok". The data layer passes the invoke rejection through.
{
	credentials = { ...credentials, usageToken: "tok-x" };
	const original = fakeInvoke;
	setInvoke((command, args) => {
		if (command === "save_token") return Promise.reject(new Error("拒绝访问。 (os error 5)"));
		return original(command, args);
	});
	const failedSave = await layer.handle("/api/usage-stats/platform/token", { method: "POST", body: JSON.stringify({ token: "tok-y" }) });
	if (failedSave.ok === false && failedSave.error === "save-failed" && /os error 5/.test(failedSave.message)) pass("a failed config write is reported, not swallowed");
	else fail("failed config write", JSON.stringify(failedSave));
	setInvoke(original);
}

// 11. Cumulative scan (report F05/F06): one bad month keeps the months already
// read, and a bounded window is never sold as a lifetime total.
const { fetchPlatformCumulativeTokenTotal } = await import("../src/renderer/platform.js");
{
	const throwing = (status) => {
		const error = new Error(`upstream ${status}`);
		error.providerStatus = status;
		throw error;
	};
	const partial = await fetchPlatformCumulativeTokenTotal("tok", {
		month: 10,
		year: 2026,
		maxMonths: 24,
		monthTotal: async (month, year) => {
			const key = `${year}-${String(month).padStart(2, "0")}`;
			if (key === "2026-08") throwing("unavailable");
			return key === "2026-10" ? 100 : key === "2026-09" ? 50 : 0;
		}
	});
	if (partial.total === 150 && partial.partial === true && partial.scannedMonths === 2 && partial.stoppedAt === "2026-08") pass("one failing month keeps the months already read");
	else fail("partial cumulative", JSON.stringify(partial));
	if (partial.limited === true && partial.limitedReason === "upstream" && partial.complete === false) pass("a 5xx stop is flagged limited + incomplete");
	else fail("partial cumulative flags", JSON.stringify(partial));

	const windowOnly = await fetchPlatformCumulativeTokenTotal("tok", {
		month: 10,
		year: 2026,
		maxMonths: 24,
		monthTotal: async (month, year) => (`${year}-${String(month).padStart(2, "0")}` === "2026-10" ? 100 : 0)
	});
	if (windowOnly.limited === true && windowOnly.limitedReason === "window" && windowOnly.scannedMonths === 24) pass("a fully scanned window is labelled as a scanned range");
	else fail("window cumulative flags", JSON.stringify(windowOnly));

	const authoritative = await fetchPlatformCumulativeTokenTotal("tok", {
		month: 10,
		year: 2026,
		maxMonths: 24,
		monthTotal: async (month, year) => {
			const key = `${year}-${String(month).padStart(2, "0")}`;
			if (key === "2026-03") throwing("invalid-response");
			return key === "2026-10" ? 100 : 0;
		}
	});
	if (authoritative.complete === true && authoritative.limited === false && authoritative.partial === true) pass("a structural refusal is the only verifiable end");
	else fail("authoritative cumulative flags", JSON.stringify(authoritative));
}

const failedCount = results.filter((line) => line.startsWith("FAIL")).length;
console.log(failedCount === 0 ? "DATA LAYER SMOKE PASSED" : `DATA LAYER SMOKE FAILED (${failedCount})`);
process.exit(failedCount === 0 ? 0 : 1);
