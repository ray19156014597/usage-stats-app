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

const failedCount = results.filter((line) => line.startsWith("FAIL")).length;
console.log(failedCount === 0 ? "DATA LAYER SMOKE PASSED" : `DATA LAYER SMOKE FAILED (${failedCount})`);
process.exit(failedCount === 0 ? 0 : 1);
