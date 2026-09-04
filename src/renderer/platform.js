/**
 * dsh-usage-stats — DeepSeek platform usage monitor.
 *
 * Ported from the approach of Joyi-code/DeepSeekMonitorWindows (MIT):
 * the DeepSeek API exposes only the balance endpoint, so account-level usage
 * is fetched from the platform's own web interfaces using the usage token
 * stored in `localStorage.userToken` on platform.deepseek.com (NOT the API
 * key).
 *
 * Primary interface (what the platform /usage page itself uses):
 *   GET /api/v0/usage/by_api_key/amount?start=<epoch>&end=<epoch>&tz=28800
 *       -> data.biz_data.{ start, end, bucket, models, series:[
 *            { api_key:{tracking_id,name,sensitive_id,valid}, model,
 *              buckets:[{ time, usage:{REQUEST, PROMPT_CACHE_HIT_TOKEN,
 *                PROMPT_CACHE_MISS_TOKEN, RESPONSE_TOKEN} }] } ] }
 *   GET /api/v0/usage/by_api_key/cost?start=<epoch>&end=<epoch>&tz=28800
 *       -> data.biz_data.{ start, end, bucket, models, data:[{ currency,
 *            series:[{ api_key, model, buckets:[{ time, cost }] }] }] }
 *
 * Buckets are epoch seconds aligned to the requested `tz` offset (28800 =
 * GMT+8, no DST in China), so dates render as `(time + tz)` — this is what
 * gives the panel GMT+8 daily usage and the extra per-API-Key dimension.
 *
 * Fallback interface (kept for resilience when by_api_key drifts):
 *   GET /api/v0/usage/amount?month=&year=  (+ /api/v0/usage/cost)
 *
 * The token is resolved through the harness credentials seam at request time
 * — this module never stores or emits it. Kept free of cordis imports so it
 * can be unit-tested outside the running harness (same convention as
 * balance.js).
 *
 * @module dsh-usage-stats/platform
 */

/** Credential reference resolved by the credentials seam. */
export const DEEPSEEK_USAGE_TOKEN_REF = "DEEPSEEK_USAGE_TOKEN";

const DEFAULT_TIMEOUT_MS = 15000;
const PLATFORM_BASE = "https://platform.deepseek.com";
const AMOUNT_PATH = "/api/v0/usage/amount";
const COST_PATH = "/api/v0/usage/cost";
const BY_KEY_AMOUNT_PATH = "/api/v0/usage/by_api_key/amount";
const BY_KEY_COST_PATH = "/api/v0/usage/by_api_key/cost";

/** GMT+8 offset in seconds (the platform usage interface timezone parameter). */
const GMT8_TZ_SECONDS = 28800;
const GMT8_TZ_MS = GMT8_TZ_SECONDS * 1000;
const DAY_SECONDS = 86400;

/** Browser-like request headers the platform web interface expects. */
const PLATFORM_HEADERS = {
	"x-app-version": "1.0.0",
	accept: "*/*",
	"user-agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
		+ "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
};

/** Display names for the models DeepSeek currently reports. */
const MODEL_NAMES = {
	"deepseek-v4-flash": "V4 Flash",
	"deepseek-v4-pro": "V4 Pro",
	"deepseek-v4-flash-vision-exp": "V4 Flash Vision",
	"deepseek-chat & deepseek-reasoner": "DeepSeek Chat & Reasoner"
};

function numberOrNull(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function statusError(status, message, httpStatus) {
	const error = new Error(message);
	error.providerStatus = status;
	if (httpStatus !== void 0) error.httpStatus = httpStatus;
	return error;
}

function responseStatus(status) {
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 429) return "rate-limited";
	if (status === 404 || status === 405) return "unsupported";
	return status >= 500 ? "unavailable" : "invalid-response";
}

/** Validate a month/year pair; returns the numeric pair or throws. */
export function normalizeMonthYear(month, year, now = new Date()) {
	// Defaults follow the GMT+8 calendar — the platform usage interface's
	// `tz` convention, so the default/background month keeps its China month.
	const china = new Date(now.getTime() + GMT8_TZ_MS);
	const m = month === void 0 || month === null || month === "" ? china.getUTCMonth() + 1 : Number(month);
	const y = year === void 0 || year === null || year === "" ? china.getUTCFullYear() : Number(year);
	if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error("month must be 1-12");
	if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error("year must be 2000-2100");
	return { month: m, year: y };
}

/**
 * GMT+8 day-start epoch for a Y-M-D date (the platform interface's exact
 * convention: `Date.UTC(y, m, d) - tz`). Do NOT use local Date getters here —
 * an 8-hour offset would otherwise shift the day boundary.
 */
export function dayStartEpoch(year, month, day) {
	return Math.floor((Date.UTC(year, month - 1, day) - GMT8_TZ_MS) / 1000);
}

/**
 * GMT+8 epoch range for a month: `{ start, end }` where start = 1st 00:00 and
 * end = 1st 00:00 of the following month (exclusive), matching the platform
 * `by_api_key` start/end parameters.
 */
export function monthRangeEpoch(month, year) {
	const nextYear = month === 12 ? year + 1 : year;
	const nextMonth = month === 12 ? 1 : month + 1;
	return {
		start: dayStartEpoch(year, month, 1),
		end: dayStartEpoch(nextYear, nextMonth, 1)
	};
}

/** GMT+8 `YYYY-MM-DD` for a platform bucket epoch (add the tz before slicing). */
export function dateOfBucket(timeEpoch) {
	return new Date((timeEpoch + GMT8_TZ_SECONDS) * 1000).toISOString().slice(0, 10);
}

/** One model's usage breakdown. Returns null when the entry is unusable. */
export function usageBreakdown(entries) {
	if (!Array.isArray(entries)) return null;
	let total = 0;
	let request = 0;
	let hit = 0;
	let miss = 0;
	let response = 0;
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") continue;
		const kind = entry.type;
		const value = numberOrNull(entry.amount);
		if (value === null) continue;
		const rounded = Math.round(value);
		switch (kind) {
			case "REQUEST":
				request = rounded;
				break;
			case "PROMPT_CACHE_HIT_TOKEN":
				hit = rounded;
				total += rounded;
				break;
			case "PROMPT_CACHE_MISS_TOKEN":
				miss = rounded;
				total += rounded;
				break;
			case "RESPONSE_TOKEN":
				response = rounded;
				total += rounded;
				break;
			case "PROMPT_TOKEN":
				total += rounded;
				break;
			default:
				break;
		}
	}
	if (total === 0 && request === 0 && hit === 0 && miss === 0 && response === 0) return null;
	return { totalTokens: total, requestCount: request, cacheHitTokens: hit, cacheMissTokens: miss, responseTokens: response };
}

/** Sum of monetary amounts for a model's usage entries (REQUEST is not billed). */
export function costOf(entries) {
	if (!Array.isArray(entries)) return 0;
	let sum = 0;
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object" || entry.type === "REQUEST") continue;
		const value = numberOrNull(entry.amount);
		if (value !== null) sum += value;
	}
	return sum;
}

/** Display name for a model id (falls back to the raw id). */
export function modelNameOf(model) {
	return MODEL_NAMES[model] ?? model;
}

async function getJson(url, token, deps, type) {
	const response = await (deps.fetch ?? fetch)(url, {
		headers: { authorization: `Bearer ${token}`, ...PLATFORM_HEADERS },
		signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw statusError(responseStatus(response.status), `platform API returned HTTP ${response.status}`, response.status);
	}
	if (type === "text") return response.text();
	let body;
	try {
		body = await response.json();
	} catch {
		throw statusError("invalid-response", "platform API returned invalid JSON");
	}
	return body;
}

function modelUsageOf(value) {
	if (value === null || typeof value !== "object") return { model: "unknown", usage: [] };
	return {
		model: typeof value.model === "string" && value.model !== "" ? value.model : "unknown",
		usage: Array.isArray(value.usage) ? value.usage : []
	};
}

/**
 * Fetch and normalize one month of DeepSeek platform usage.
 * @param token - usage token (localStorage.userToken on platform.deepseek.com).
 * @param options - `{ month, year, timeoutMs, fetchImpl, now }`.
 * @returns `{ month, year, models, days, monthCost }` where each model entry
 *   is `{ key, name, totalTokens, requestCount, cacheHitTokens,
 *   cacheMissTokens, responseTokens, cost }` and each day entry is
 *   `{ date, totalTokens, totalCost, models: { [model]: { cacheHitTokens,
 *   cacheMissTokens, responseTokens } } }`, days sorted ascending.
 * @throws an Error with `providerStatus` on upstream failures.
 */
export async function fetchPlatformUsage(token, options = {}) {
	if (typeof token !== "string" || token.trim() === "") throw statusError("not-configured", "usage token is missing");
	const { month, year } = normalizeMonthYear(options.month, options.year, options.now ?? new Date());
	const deps = { timeoutMs: options.timeoutMs, fetch: options.fetchImpl ?? options.fetch };
	const amountUrl = `${PLATFORM_BASE}${AMOUNT_PATH}?month=${month}&year=${year}`;
	const costUrl = `${PLATFORM_BASE}${COST_PATH}?month=${month}&year=${year}`;
	const [amountBody, costBody] = await Promise.all([
		getJson(amountUrl, token, deps),
		getJson(costUrl, token, deps)
	]);
	const amount = amountBody?.data?.biz_data ?? null;
	const costBiz = costBody?.data?.biz_data ?? null;
	const costTotal = Array.isArray(costBiz) ? costBiz[0] ?? null : null;
	if (amount === null || typeof amount !== "object") {
		throw statusError("invalid-response", "platform amount response is missing data.biz_data");
	}

	const models = [];
	const totals = Array.isArray(amount.total) ? amount.total : [];

	// Per-model monetary cost comes from the cost endpoint (amount entries are
	// token counts, not money).
	const costByModel = new Map();
	if (costTotal !== null && typeof costTotal === "object" && Array.isArray(costTotal.total)) {
		for (const raw of costTotal.total) {
			const entry = modelUsageOf(raw);
			costByModel.set(entry.model, costOf(entry.usage));
		}
	}
	for (const raw of totals) {
		const entry = modelUsageOf(raw);
		const breakdown = usageBreakdown(entry.usage);
		if (breakdown === null) continue;
		models.push({
			key: entry.model,
			name: modelNameOf(entry.model),
			...breakdown,
			cost: costByModel.get(entry.model) ?? 0
		});
	}
	models.sort((a, b) => b.totalTokens - a.totalTokens);

	const costByDate = new Map();
	if (costTotal !== null && typeof costTotal === "object" && Array.isArray(costTotal.days)) {
		for (const day of costTotal.days) {
			if (day === null || typeof day !== "object") continue;
			const date = typeof day.date === "string" ? day.date : null;
			if (date === null) continue;
			const entries = Array.isArray(day.data) ? day.data : [];
			let dayCost = 0;
			for (const raw of entries) dayCost += costOf(modelUsageOf(raw).usage);
			costByDate.set(date, dayCost);
		}
	}

	const days = [];
	const rawDays = Array.isArray(amount.days) ? amount.days : [];
	for (const day of rawDays) {
		if (day === null || typeof day !== "object") continue;
		const date = typeof day.date === "string" ? day.date : null;
		if (date === null) continue;
		const dayModels = {};
		let totalTokens = 0;
		const entries = Array.isArray(day.data) ? day.data : [];
		for (const raw of entries) {
			const entry = modelUsageOf(raw);
			const breakdown = usageBreakdown(entry.usage);
			if (breakdown === null) continue;
			totalTokens += breakdown.totalTokens;
			dayModels[entry.model] = {
				cacheHitTokens: breakdown.cacheHitTokens,
				cacheMissTokens: breakdown.cacheMissTokens,
				responseTokens: breakdown.responseTokens
			};
		}
		days.push({
			date,
			totalTokens,
			totalCost: costByDate.get(date) ?? 0,
			models: dayModels
		});
	}
	days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	let monthCost = 0;
	if (costTotal !== null && typeof costTotal === "object" && Array.isArray(costTotal.total)) {
		for (const raw of costTotal.total) monthCost += costOf(modelUsageOf(raw).usage);
	}

	return { month, year, models, days, monthCost };
}

/** Normalize one platform usage bucket (`time` epoch + `usage` object) — null when all zero. */
function bucketBreakdown(bucket) {
	if (bucket === null || typeof bucket !== "object") return null;
	const usage = typeof bucket.usage === "object" && bucket.usage !== null ? bucket.usage : {};
	const request = numberOrNull(usage.REQUEST) ?? 0;
	const hit = numberOrNull(usage.PROMPT_CACHE_HIT_TOKEN) ?? 0;
	const miss = numberOrNull(usage.PROMPT_CACHE_MISS_TOKEN) ?? 0;
	const response = numberOrNull(usage.RESPONSE_TOKEN) ?? 0;
	const prompt = numberOrNull(usage.PROMPT_TOKEN) ?? 0;
	if (request === 0 && hit === 0 && miss === 0 && response === 0 && prompt === 0) return null;
	return {
		totalTokens: hit + miss + response + prompt,
		requestCount: request,
		cacheHitTokens: hit,
		cacheMissTokens: miss,
		responseTokens: response
	};
}

/** Per-series meta: `{ trackingId, name, model, buckets }` (platform by_api_key shape). */
function byKeySeriesOf(value) {
	const series = value ?? {};
	const key = typeof series.api_key === "object" && series.api_key !== null ? series.api_key : {};
	return {
		trackingId: typeof key.tracking_id === "string" ? key.tracking_id : "",
		name: typeof key.name === "string" && key.name !== "" ? key.name : "API Key",
		model: typeof series.model === "string" && series.model !== "" ? series.model : "unknown",
		buckets: Array.isArray(series.buckets) ? series.buckets : []
	};
}

/** Accumulate a token/cost breakdown into a mutable accumulator (mutating). */
function addIntoBreakdown(target, breakdown, cost) {
	target.totalTokens += breakdown.totalTokens;
	target.requestCount += breakdown.requestCount;
	target.cacheHitTokens += breakdown.cacheHitTokens;
	target.cacheMissTokens += breakdown.cacheMissTokens;
	target.responseTokens += breakdown.responseTokens;
	target.cost += cost;
}

/**
 * Fetch one month of DeepSeek platform usage from the richer per-API-Key
 * interface, aggregated into the same wire shape as the legacy endpoint plus
 * the new per-Key dimension. Days are GMT+8 (buckets are epoch seconds aligned
 * to `tz=28800`).
 * @param token - usage token (localStorage.userToken on platform.deepseek.com).
 * @param options - `{ month, year, timeoutMs, fetchImpl, now }`.
 * @returns `{ month, year, source: "by-api-key", models, days, monthCost, apiKeys }`.
 * @throws an Error with `providerStatus` on upstream failures.
 */
export async function fetchPlatformUsageByKey(token, options = {}) {
	if (typeof token !== "string" || token.trim() === "") throw statusError("not-configured", "usage token is missing");
	const { month, year } = normalizeMonthYear(options.month, options.year, options.now ?? new Date());
	const range = monthRangeEpoch(month, year);
	const query = `start=${range.start}&end=${range.end}&tz=${GMT8_TZ_SECONDS}`;
	const deps = { timeoutMs: options.timeoutMs, fetch: options.fetchImpl ?? options.fetch };
	const [amountBody, costBody] = await Promise.all([
		getJson(`${PLATFORM_BASE}${BY_KEY_AMOUNT_PATH}?${query}`, token, deps),
		getJson(`${PLATFORM_BASE}${BY_KEY_COST_PATH}?${query}`, token, deps)
	]);
	const biz = amountBody?.data?.biz_data ?? null;
	const costBiz = costBody?.data?.biz_data ?? null;
	const costData = Array.isArray(costBiz?.data) ? costBiz.data[0] ?? null : null;
	if (biz === null || typeof biz !== "object" || !Array.isArray(biz.series)) {
		throw statusError("invalid-response", "platform by_api_key amount response is missing data.biz_data.series");
	}

	// cost lookup: `${trackingId}|${model}|${time}` → numeric cost.
	const costLookup = new Map();
	let currency = "CNY";
	if (costData !== null && typeof costData === "object") {
		currency = typeof costData.currency === "string" && costData.currency !== "" ? costData.currency : currency;
		if (Array.isArray(costData.series)) {
			for (const series of costData.series) {
				const meta = byKeySeriesOf(series);
				for (const bucket of meta.buckets) {
					const amount = numberOrNull(bucket?.cost);
					if (amount === null) continue;
					costLookup.set(`${meta.trackingId}|${meta.model}|${bucket?.time}`, amount);
				}
			}
		}
	}

	// Aggregate per model (across keys), per api key (across models), per day.
	const modelAcc = new Map(); // model → accumulator
	const keyAcc = new Map(); // trackingId → { name, ...accumulator }
	const dayAcc = new Map(); // date → { models: Map, totalTokens, totalCost }

	for (const raw of biz.series) {
		const meta = byKeySeriesOf(raw);
		let modelEntry = modelAcc.get(meta.model);
		if (modelEntry === void 0) {
			modelEntry = { totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 };
			modelAcc.set(meta.model, modelEntry);
		}
		let keyEntry = keyAcc.get(meta.trackingId);
		if (keyEntry === void 0) {
			keyEntry = { trackingId: meta.trackingId, name: meta.name, totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, cost: 0 };
			keyAcc.set(meta.trackingId, keyEntry);
		}
		for (const bucket of meta.buckets) {
			const breakdown = bucketBreakdown(bucket);
			if (breakdown === null) continue;
			const time = bucket?.time;
			const cost = typeof time === "number" ? costLookup.get(`${meta.trackingId}|${meta.model}|${time}`) ?? 0 : 0;
			addIntoBreakdown(modelEntry, breakdown, cost);
			addIntoBreakdown(keyEntry, breakdown, cost);
			const date = dateOfBucket(time);
			let day = dayAcc.get(date);
			if (day === void 0) {
				day = { models: new Map(), keys: new Map(), totalTokens: 0, totalCost: 0, totalRequests: 0 };
				dayAcc.set(date, day);
			}
			let dayModel = day.models.get(meta.model);
			if (dayModel === void 0) {
				dayModel = { cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0, requestCount: 0, cost: 0 };
				day.models.set(meta.model, dayModel);
			}
			dayModel.cacheHitTokens += breakdown.cacheHitTokens;
			dayModel.cacheMissTokens += breakdown.cacheMissTokens;
			dayModel.responseTokens += breakdown.responseTokens;
			dayModel.requestCount += breakdown.requestCount;
			dayModel.cost += cost;
			let dayKey = day.keys.get(meta.trackingId);
			if (dayKey === void 0) {
				dayKey = { trackingId: meta.trackingId, name: meta.name, totalTokens: 0, requestCount: 0, cost: 0 };
				day.keys.set(meta.trackingId, dayKey);
			}
			dayKey.totalTokens += breakdown.totalTokens;
			dayKey.requestCount += breakdown.requestCount;
			dayKey.cost += cost;
			day.totalTokens += breakdown.totalTokens;
			day.totalCost += cost;
			day.totalRequests += breakdown.requestCount;
		}
	}

	const models = [...modelAcc.entries()]
		.map(([key, acc]) => ({ key, name: modelNameOf(key), ...acc }))
		.filter((entry) => entry.totalTokens > 0 || entry.cost > 0 || entry.requestCount > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);
	const apiKeys = [...keyAcc.values()]
		.filter((entry) => entry.totalTokens > 0 || entry.cost > 0 || entry.requestCount > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);
	const days = [...dayAcc.entries()]
		.map(([date, day]) => {
			const modelsMap = {};
			for (const [model, b] of day.models) modelsMap[model] = { ...b };
			const keys = [...day.keys.values()]
				.filter((entry) => entry.totalTokens > 0 || entry.requestCount > 0 || entry.cost > 0)
				.sort((a, b) => b.totalTokens - a.totalTokens);
			return { date, totalTokens: day.totalTokens, totalCost: day.totalCost, totalRequests: day.totalRequests, models: modelsMap, keys };
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const monthCost = [...modelAcc.values()].reduce((sum, entry) => sum + entry.cost, 0);

	return { month, year, source: "by-api-key", models, days, monthCost, apiKeys, currency };
}

/**
 * Primary path: by_api_key (GMT+8, per-API-Key granularity). On upstream or
 * parsing trouble (shape drift, 5xx, …) falls back to the legacy month/year
 * endpoints so the panel keeps working; auth failures are never retried with
 * the legacy endpoints.
 * @returns the by_key result with `source: "by-api-key"`, or the legacy result
 *   with `source: "legacy"` (no `apiKeys`).
 */
export async function fetchPlatformUsageSmart(token, options = {}) {
	try {
		return await fetchPlatformUsageByKey(token, options);
	} catch (error) {
		const status = error?.providerStatus;
		if (status === void 0 || status === "unauthorized" || status === "not-configured" || status === "rate-limited") throw error;
		const legacy = await fetchPlatformUsage(token, options);
		return { ...legacy, source: "legacy" };
	}
}

/**
 * Total tokens of one month through the by_api_key amount interface only
 * (no cost call). The platform web interface caps query windows at roughly
 * one month, so a month is the largest safe unit for scanning history.
 * @returns the month's token total (0 when the month has no usage).
 */
export async function fetchPlatformMonthTokenSum(token, options = {}) {
	if (typeof token !== "string" || token.trim() === "") throw statusError("not-configured", "usage token is missing");
	const { month, year } = normalizeMonthYear(options.month, options.year, options.now ?? new Date());
	const range = monthRangeEpoch(month, year);
	const query = `start=${range.start}&end=${range.end}&tz=${GMT8_TZ_SECONDS}`;
	const deps = { timeoutMs: options.timeoutMs, fetch: options.fetchImpl ?? options.fetch };
	const body = await getJson(`${PLATFORM_BASE}${BY_KEY_AMOUNT_PATH}?${query}`, token, deps);
	const biz = body?.data?.biz_data ?? null;
	if (biz === null || typeof biz !== "object" || !Array.isArray(biz.series)) {
		throw statusError("invalid-response", "platform by_api_key amount response is missing data.biz_data.series");
	}
	let total = 0;
	for (const series of biz.series) {
		if (series === null || typeof series !== "object") continue;
		for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
			const breakdown = bucketBreakdown(bucket);
			if (breakdown !== null) total += breakdown.totalTokens;
		}
	}
	return total;
}

/**
 * All-time platform token total: walk months backward from the starting
 * (default: current) month, one query per month, and sum token totals. The
 * walk breaks at the first empty month below the newest data month and trims
 * leading empty months, so a fresh account never scans years of nothing.
 * @returns `{ total, months, oldest }` — `months` counts months with usage,
 *   `oldest` is the `YYYY-MM` of the first month with usage (null when none).
 */
export async function fetchPlatformCumulativeTokenTotal(token, options = {}) {
	let { month, year } = normalizeMonthYear(options.month, options.year, options.now ?? new Date());
	const maxMonths = Number.isFinite(options.maxMonths) && options.maxMonths > 0 ? Math.floor(options.maxMonths) : 24;
	const monthTotal = typeof options.monthTotal === "function" ? options.monthTotal : null;
	const seen = [];
	let foundUsage = false;
	for (let i = 0; i < maxMonths; i += 1) {
		const total = monthTotal !== null ? await monthTotal(month, year) : await fetchPlatformMonthTokenSum(token, { ...options, month, year });
		seen.push({ year, month, total });
		if (total > 0) foundUsage = true;
		else if (foundUsage) break; // first empty month below the newest data — nothing earlier
		if (month === 1) {
			month = 12;
			year -= 1;
		} else {
			month -= 1;
		}
	}
	const withUsage = seen.filter((entry) => entry.total > 0);
	const oldest = withUsage.length > 0 ? withUsage[withUsage.length - 1] : null;
	return {
		total: withUsage.reduce((sum, entry) => sum + entry.total, 0),
		months: withUsage.length,
		oldest: oldest === null ? null : `${oldest.year}-${String(oldest.month).padStart(2, "0")}`
	};
}

/**
 * One day's finer-grained usage from the platform. A single-day query returns
 * hourly buckets (bucket=3600 for both amount and cost), so this yields
 * per-hour tokens/requests/cost plus per-API-Key and per-model day totals —
 * all from the same two requests.
 * @param options - `{ date: "YYYY-MM-DD" (GMT+8), timeoutMs, fetchImpl }`.
 * @returns `{ date, source: "by-api-key", hours, perKey, perModel, currency }`
 *   with `hours` covering 0–23 (empty hours stay as zeros) in ascending order.
 */
export async function fetchPlatformDayDetail(token, options = {}) {
	if (typeof token !== "string" || token.trim() === "") throw statusError("not-configured", "usage token is missing");
	const date = typeof options.date === "string" ? options.date : "";
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw statusError("invalid-params", "date must be YYYY-MM-DD");
	const [y, m, d] = date.split("-").map(Number);
	const start = dayStartEpoch(y, m, d);
	const end = start + DAY_SECONDS;
	const query = `start=${start}&end=${end}&tz=${GMT8_TZ_SECONDS}`;
	const deps = { timeoutMs: options.timeoutMs, fetch: options.fetchImpl ?? options.fetch };
	const [amountBody, costBody] = await Promise.all([
		getJson(`${PLATFORM_BASE}${BY_KEY_AMOUNT_PATH}?${query}`, token, deps),
		getJson(`${PLATFORM_BASE}${BY_KEY_COST_PATH}?${query}`, token, deps)
	]);
	const biz = amountBody?.data?.biz_data ?? null;
	const costBiz = costBody?.data?.biz_data ?? null;
	const costData = Array.isArray(costBiz?.data) ? costBiz.data[0] ?? null : null;
	if (biz === null || typeof biz !== "object" || !Array.isArray(biz.series)) {
		throw statusError("invalid-response", "platform by_api_key amount response is missing data.biz_data.series");
	}

	// cost lookup: `${trackingId}|${model}|${hourEpoch}` → numeric cost.
	const costLookup = new Map();
	let currency = "CNY";
	if (costData !== null && typeof costData === "object") {
		currency = typeof costData.currency === "string" && costData.currency !== "" ? costData.currency : currency;
		if (Array.isArray(costData.series)) {
			for (const series of costData.series) {
				const meta = byKeySeriesOf(series);
				for (const bucket of meta.buckets) {
					const amount = numberOrNull(bucket?.cost);
					if (amount === null) continue;
					costLookup.set(`${meta.trackingId}|${meta.model}|${bucket?.time}`, amount);
				}
			}
		}
	}

	const hourAcc = new Map(); // hour 0–23 → { hour, tokens, requestCount, cost }
	const keyAcc = new Map();
	const modelAcc = new Map();
	for (const raw of biz.series) {
		const meta = byKeySeriesOf(raw);
		for (const bucket of meta.buckets) {
			// Include empty buckets as zero hours so the chart keeps 24 columns.
			const breakdown = bucketBreakdown(bucket) ?? { totalTokens: 0, requestCount: 0, cacheHitTokens: 0, cacheMissTokens: 0, responseTokens: 0 };
			const time = bucket?.time;
			const cost = typeof time === "number" ? costLookup.get(`${meta.trackingId}|${meta.model}|${time}`) ?? 0 : 0;
			const hour = typeof time === "number" ? Math.floor(((time + GMT8_TZ_SECONDS) % 86400) / 3600) : -1;
			if (hour >= 0 && hour <= 23) {
				let h = hourAcc.get(hour);
				if (h === void 0) {
					h = { hour, tokens: 0, requestCount: 0, cost: 0 };
					hourAcc.set(hour, h);
				}
				h.tokens += breakdown.totalTokens;
				h.requestCount += breakdown.requestCount;
				h.cost += cost;
			}
			let keyEntry = keyAcc.get(meta.trackingId);
			if (keyEntry === void 0) {
				keyEntry = { trackingId: meta.trackingId, name: meta.name, totalTokens: 0, requestCount: 0, cost: 0 };
				keyAcc.set(meta.trackingId, keyEntry);
			}
			keyEntry.totalTokens += breakdown.totalTokens;
			keyEntry.requestCount += breakdown.requestCount;
			keyEntry.cost += cost;
			let modelEntry = modelAcc.get(meta.model);
			if (modelEntry === void 0) {
				modelEntry = { model: meta.model, totalTokens: 0, requestCount: 0, cost: 0 };
				modelAcc.set(meta.model, modelEntry);
			}
			modelEntry.totalTokens += breakdown.totalTokens;
			modelEntry.requestCount += breakdown.requestCount;
			modelEntry.cost += cost;
		}
	}
	const hours = [...hourAcc.values()].sort((a, b) => a.hour - b.hour);
	const perKey = [...keyAcc.values()]
		.filter((entry) => entry.totalTokens > 0 || entry.requestCount > 0 || entry.cost > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);
	const perModel = [...modelAcc.values()]
		.filter((entry) => entry.totalTokens > 0 || entry.requestCount > 0 || entry.cost > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);
	return { date, source: "by-api-key", hours, perKey, perModel, currency };
}

/** Credential references used by this module (for docs/tests). */
export function platformCredentialRefs() {
	return [DEEPSEEK_USAGE_TOKEN_REF];
}

/**
 * Verify a usage token by calling the amount endpoint for the current month.
 * Resolves true on HTTP 200; throws `statusError` otherwise (used by the
 * web-login auto-sync flow before saving a captured token).
 */
export async function verifyUsageToken(token, options = {}) {
	if (typeof token !== "string" || token.trim() === "") throw statusError("not-configured", "usage token is missing");
	const { month, year } = normalizeMonthYear(options.month, options.year, options.now ?? new Date());
	const deps = { timeoutMs: options.timeoutMs, fetch: options.fetchImpl ?? options.fetch };
	await getJson(`${PLATFORM_BASE}${AMOUNT_PATH}?month=${month}&year=${year}`, token, deps);
	return true;
}
