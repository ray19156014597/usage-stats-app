/**
 * Client contract checks (no DOM harness for the app bundle).
 *
 * `client.js` is the panel bundle loaded inside the WebView; the repo has no
 * browser test rig, so the contracts that only exist in effects/closures are
 * pinned here against the source text. Each assertion names the exact expression
 * the implementation must keep, so a refactor cannot silently drop it.
 *
 *   F02  every account-scoped load is gated by a credential generation
 *   F03  the platform state is only cleared by a success, and the card shows it
 *   F05  a bounded scan is never labelled as a lifetime total
 *   F10  the holiday table declares its coverage and refuses to guess
 *   F12  the settings view owns the balance API key instead of pointing at a YAML
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/renderer/client.js", import.meta.url), "utf8");
const dataLayer = readFileSync(new URL("../src/renderer/dataLayer.js", import.meta.url), "utf8");

function callbackBody(name) {
	const start = source.indexOf(`const ${name} = react.useCallback(`);
	assert.ok(start >= 0, `${name} must exist`);
	const end = source.indexOf("\n\t\t\t}, [", start);
	assert.ok(end > start, `${name} must close with a dependency array`);
	return source.slice(start, end);
}

// ── F02 ──────────────────────────────────────────────────────────────────────
for (const name of ["loadPlatform", "loadPlatformTotal", "loadRecentPlatform", "loadDayDetail"]) {
	const body = callbackBody(name);
	assert.ok(/const gen = credentialGenRef\.current;/.test(body), `${name} must snapshot the credential generation`);
	assert.ok(/credentialGenRef\.current !== gen/.test(body), `${name} must discard results from another generation`);
}
assert.ok(/const seq = \+\+totalSeqRef\.current;/.test(callbackBody("loadPlatformTotal")), "the cumulative load needs its own sequence");
assert.ok(/totalSeqRef\.current !== seq/.test(callbackBody("loadPlatformTotal")), "the cumulative load must drop out-of-order responses");
for (const name of ["saveToken", "clearToken"]) {
	assert.ok(/credentialGenRef\.current \+= 1;/.test(callbackBody(name)), `${name} must invalidate in-flight account loads`);
}
assert.ok(/credentialGenRef\.current \+= 1;/.test(source.slice(source.indexOf('if (statusPayload.last?.ok === true) {'), source.indexOf('setTokenMessage(translate("token.syncCaptured"))'))), "a captured token is a credential switch too");

// ── F03 ──────────────────────────────────────────────────────────────────────
const loadPlatformBody = callbackBody("loadPlatform");
const beforeFetch = loadPlatformBody.slice(loadPlatformBody.indexOf("platformLoaderRef.current.start()"), loadPlatformBody.indexOf("fetchJson("));
assert.ok(!/setPlatformError\(null\)/.test(beforeFetch), "loadPlatform must not clear the failure state before the request settles");
assert.ok(/setPlatformOkAt\(payload\.fetchedAt/.test(loadPlatformBody), "a platform success must record its own timestamp");
assert.ok(/data-platform-state/.test(source), "the account card must render the platform failure state");
assert.ok(/platform\.staleNote/.test(source), "a platform failure must say the amounts are the last successful result");
// A healthy platform adds no line: the always-on "updated at" note looked out of
// place in the card footer (user feedback), so freshness stays on the panel footer.
assert.ok(!/platform\.updatedAt/.test(source), "no always-on platform timestamp line may be rendered");

// ── F05 ──────────────────────────────────────────────────────────────────────
// The scanned-window caveat stays in the data and in the total cell's tooltip; it
// must not come back as a permanent label or a standalone note line (user feedback).
assert.ok(/totalScopeHint/.test(source), "the scanned range must stay reachable (total cell tooltip)");
assert.ok(/title: totalScopeHint/.test(source), "the total cell must carry the range as its tooltip");
assert.ok(!/usage\.totalTokensScanned/.test(source), "no scanned-range label may be rendered");
assert.ok(!/scopeNote === null \? null/.test(source), "no standalone range note may be rendered");

// ── F10 ──────────────────────────────────────────────────────────────────────
assert.ok(/PRICE_HOLIDAY_COVERAGE/.test(source), "the holiday table must declare the years it covers");
assert.ok(/priceHolidayCovered\(parts\.year\) && PRICE_HOLIDAYS\.has/.test(source), "an uncovered year must not be guessed as a holiday");
assert.ok(/price\.calendarCoverage/.test(source), "the coverage and update date must be visible");

// ── F12 ──────────────────────────────────────────────────────────────────────
// Comments may explain the old dead end; user-visible strings must not repeat it.
const stringLines = source
	.split("\n")
	.filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
	.filter((line) => /credentials\.yaml/.test(line));
assert.equal(stringLines.length, 0, `no user-visible string may point at a file this app never reads: ${stringLines.join(" | ")}`);
assert.ok(/apiKey\.title/.test(source), "the settings view must expose the balance API key");
assert.ok(/\/api\/usage-stats\/platform\/apikey/.test(dataLayer), "the data layer must route the API key settings");

console.log("app client contract ok (credentials generation, platform freshness, scanned total, holiday coverage, api key)");
