# External Link Classification Design (Milestone 1, Task 1.6)

Date: 2026-08-30
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.6)

## Problem

The external-links scanner collapses every HTTP status `>= 400` into one
finding: `title: "Dead external link"`, `severity: "warning"`,
`classification: "candidate"` (`src/scanner/scanners/external-links.ts`,
`makeIssue`). A 403 behind a login wall, a 429 from an aggressive rate limiter,
and a 500 during an outage are all presented as probable dead links. The
finding's own caveat even admits the conflation
("Authentication, rate limits, bot protection, and temporary outages can
produce a non-success status") instead of resolving it.

The request adapter is equally under-specified:

```ts
requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
```

(`src/scanner/ScanContext.ts`). The scanner cannot ask for a method, cannot
distinguish a HEAD-rejected origin from a genuinely failing one, and cannot
record which method produced the final status. Origins that reject HEAD with
405/501 are therefore reported as dead links even when the resource exists.
The security model also pins the method implicitly: `cli/public-http.ts`
hardcodes `method: "HEAD"`, and `src/main.ts` hardcodes `method: "HEAD"` in
its `requestUrl({ url, method: "HEAD" })` call — a GET fallback introduced
anywhere else would bypass the pinned-lookup DNS checks unless the adapter
contract itself is method-aware.

## Goals

- Roadmap status policy, exactly:

  | Result | Presentation |
  | --- | --- |
  | 404 or 410 | Candidate dead link |
  | 401 or 403 | Access-restricted, not dead |
  | 429 | Rate-limited, not dead |
  | 5xx | Candidate temporary server failure |
  | Timeout or request failure | Unverified |
  | Safety-policy block | Unverified and blocked |

- Replace the status-only adapter with a **method-aware result contract**:
  the scanner requests `HEAD` first and a **bounded Range GET fallback only
  for 405 or 501** (the two statuses that mean "this method is not allowed",
  per RFC 9110 sections 15.4.6 and 15.6.10).
- **Never retain response bodies.** The result contract has no body field;
  the Node adapter discards the body (`response.resume()`); the Obsidian
  adapter reads only `.status` from the response object.
- **Re-run URL, DNS, redirect, and public-IP checks for every fallback and
  every redirect destination.** Both are properties of the adapter contract,
  not of the scanner: `requestPublicHttpStatus` re-assesses the URL and
  revalidates DNS before each connection (redirect hops today, the fallback
  GET as of this PR); the scanner additionally re-runs the URL policy before
  issuing the fallback call.
- Preserve `EXTERNAL_LINK_TIMEOUT_MS = 5000`,
  `EXTERNAL_LINK_SCAN_BUDGET_MS = 60000`, and the 5-request batch size
  unchanged (no performance evidence justifies changing them; the fallback
  consumes a second request within the same per-URL timeout envelope, so
  worst-case wall time per URL is unchanged).
- External-link scanning stays disabled by default (`DEFAULT_SETTINGS`).
- New classifications produce **stable, distinct fingerprints**, and
  `COMPARISON_VERSION` is bumped because this is a genuine detection-semantics
  change (details below).

## Non-goals (this PR)

- No retry/backoff logic for 429 or 5xx, no per-URL caching of outcomes, no
  settings additions, no report UI changes.
- No change to the scanner's URL collection (links, embeds, frontmatter,
  bare-URL extraction are untouched).
- No remediation of Obsidian's `requestUrl` internal redirect handling (see
  Risks).
- No Milestone 2 action-impact work.

## Design

### Method-aware request adapter contract

`src/scanner/ScanContext.ts` gains the contract types and replaces the
`requestUrl` field type:

```ts
export type ExternalHttpMethod = "HEAD" | "GET";

export type ExternalRequestResult = {
	status: number;
	method: ExternalHttpMethod;
};

export type ExternalRequestAdapter = (
	url: string,
	method: ExternalHttpMethod,
	signal?: AbortSignal,
) => Promise<ExternalRequestResult>;
```

Contract rules for every adapter implementation (the Obsidian plugin adapter
in `src/main.ts`, the CLI adapter in `cli/public-http.ts`, and any injected
test stub):

1. Issue exactly the requested method against exactly the requested URL.
2. Throw on transport failure (DNS, TLS, connectivity, abort). The scanner
   maps thrown errors to the existing `failed`/`timeout` findings.
3. Return the final status plus the method that produced it — never a
   response body, header set, or redirect chain.
4. Re-run the destination safety checks (URL policy, DNS, public-IP,
   redirect-target revalidation) for **every** connection they open,
   including the Range GET fallback. The CLI adapter enforces this fully; the
   Obsidian adapter enforces the URL policy (see Risks for the Electron
   redirect limitation, which predates this PR).
5. Redirects are followed by the adapter (up to the existing 5-hop cap in the
   CLI adapter; internally by Obsidian's `requestUrl`). A redirect status
   that escapes the adapter is treated by the scanner as `< 400`, i.e.
   healthy — unchanged behavior.

`ScanRunner`'s constructor parameter type changes from
`(url: string) => Promise<number>` to `ExternalRequestAdapter` (the value is
already threaded into `ScanContext.requestUrl` unchanged).

### HEAD-first with bounded Range GET fallback (scanner)

`checkUrl` in `src/scanner/scanners/external-links.ts`:

1. `assessExternalHttpUrl(url)` — unsafe destinations short-circuit to the
   existing `blocked` finding before any request.
2. `ctx.requestUrl(url, "HEAD", signal)`.
3. If the HEAD status is `405` or `501`: re-run `assessExternalHttpUrl(url)`
   (the scanner-side URL-policy gate for the fallback, which also covers
   injected adapters that do not self-check), then
   `ctx.requestUrl(url, "GET", signal)`. The GET result is final regardless
   of its status — including another 405/501, which then falls through to the
   status policy below as a dead-link candidate.
4. Any other HEAD status is final.

The fallback GET is bounded two ways: it is triggered only by 405/501, and
the adapter sends it with `Range: bytes=0-0` (a single-byte body request) and
discards the body. The whole sequence — HEAD plus optional GET — runs inside
the existing per-URL `withTimeout(EXTERNAL_LINK_TIMEOUT_MS)` race and counts
as one entry against the scan budget and batching, so budget math is
unchanged.

### Range GET fallback and destination revalidation (CLI adapter)

`cli/public-http.ts`:

- `requestPublicHttpStatus(value, signal?, dependencies?)` now returns
  `Promise<ExternalRequestResult>` instead of `Promise<number>`.
- `PublicHttpDependencies.request` gains a `method: ExternalHttpMethod`
  parameter.
- The redirect loop is unchanged in shape: every hop (initial URL and every
  redirect destination) already re-runs `assessExternalHttpUrl` and
  `getValidatedAddress` (DNS resolution + public-IP validation) before
  connecting, and the connection stays pinned to the validated address via
  the custom `lookup`.
- When the final HEAD response is 405 or 501, a new
  `requestWithRangeGetFallback` helper re-runs `assessExternalHttpUrl` and
  `getValidatedAddress` for the destination, then issues the GET with
  `Range: bytes=0-0` and returns `{ status, method: "GET" }`. The fallback
  does not chase redirects itself — a 3xx from the GET is returned as-is and
  the scanner treats it as healthy (a redirecting GET answer is still proof
  the origin serves the resource).
- `requestHeadAtAddress` becomes `requestAtAddress(url, address, method,
  signal)`: `method` is passed to the transport, and GET requests carry
  `headers: { Range: "bytes=0-0" }`. The response body is consumed with
  `response.resume()` and never materialized.

### Obsidian plugin adapter

`src/main.ts`:

```ts
scanRunner = new ScanRunner(async (url, method) => {
	const response = await requestUrl({
		url,
		method,
		headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
	});
	return { status: response.status, method };
}, { ...timers unchanged });
```

Obsidian's `requestUrl` pulls the body into the response object transiently,
but the adapter returns only `{ status, method }` — no body is retained in
any finding, evidence, or the adapter result.

### Per-status issue shapes

`CheckResult`'s `http` variant gains `method: ExternalHttpMethod`. The
`makeIssue` http branch (statuses `>= 400`; `< 400` stays silent) becomes a
four-way split:

| Statuses | Title | Severity | Classification | Evidence (beyond `url`, `status`) | Fingerprint input |
| --- | --- | --- | --- | --- | --- |
| 404, 410 (and any other 4xx not listed below) | `Dead external link` | `warning` | `candidate` | `method` | `{ url }` — **unchanged** |
| 401, 403 | `External link access restricted` | `info` | `unverified` | `method`, `restricted: true` | `{ url, restricted: true }` |
| 429 | `External link rate limited` | `info` | `unverified` | `method`, `rateLimited: true` | `{ url, rateLimited: true }` |
| 500–599 | `External link server error` | `info` | `candidate` | `method`, `serverError: true` | `{ url, serverError: true }` |

Rationale for the classification/severity choices:

- **404/410 candidate + warning**: the resource is gone with high
  probability; a human should look at it. Unlisted 4xx (400, 402, 406, …)
  keep this presentation — the roadmap policy only reclassifies the listed
  categories, and a persistent 400 usually does indicate a malformed or
  stale link.
- **401/403 unverified + info**: the server answered; availability was not
  verifiable from this client. Never actionable as "dead".
- **429 unverified + info**: the check itself was rejected, not the resource.
- **5xx candidate + info**: the roadmap words it "candidate temporary server
  failure" — `candidate` (a real server-side failure, reproducible this
  scan) at `info` severity (typically transient, not the user's fault). It is
  deliberately *not* `unverified`: the failure was observed, not skipped.

Messages keep the `HTTP <status> — <url>` shape for all four, so the report
sort/grouping and CLI JSON `message` field stay structurally identical.
`describeFinding` explanations per shape:

- Dead link: why `The server returned HTTP <status> for this URL.`; nextStep
  unchanged; caveat `HTTP 404 and 410 strongly indicate the resource is gone;
  access restrictions, rate limits, and server failures are reported
  separately.`
- Access restricted: why `The server returned HTTP <status>, so this URL's
  availability could not be verified.`; nextStep `Open the URL in a browser —
  a login, paywall, or bot protection may be required.`; caveat
  `Access-restricted responses do not mean the link is dead.`
- Rate limited: why `The server rate-limited the check (HTTP 429), so this
  URL's availability could not be verified.`; nextStep `Run the scan again
  later.`; caveat `Rate-limited responses do not mean the link is dead.`
- Server error: why `The server reported a failure (HTTP <status>).`;
  nextStep `Run the scan again later; if the failure persists, verify the URL
  manually.`; caveat `Server-side failures are often temporary and do not yet
  indicate a dead link.`

`timeout`, `failed`, `blocked`, and the scan-budget finding are unchanged in
shape, classification, severity, and fingerprint.

### Fingerprints and COMPARISON_VERSION

Current URL-based fingerprint inputs: `{ url }` for HTTP failures,
`{ url, blocked: true }`, `{ url, timeout: true }`, `{ url, failed: true }`.

- The dead-link fingerprint input stays exactly `{ url }`: a 404/410 finding
  today and after this PR is the same finding. User ignores of genuine
  dead-link candidates survive.
- 401/403/429/5xx findings change identity: today they share the `{ url }`
  dead-link fingerprint; after this PR they produce
  `{ url, restricted | rateLimited | serverError }`. This is unavoidable —
  the finding is no longer "candidate dead link" — and it is a genuine
  detection-semantics change: an old snapshot compared against a new scan
  would mark every 403/429/5xx as **resolved** (old fingerprint gone) and
  present the new presentation as **new**, both false claims.
- Per the roadmap's cross-cutting rule ("increment `COMPARISON_VERSION` when
  new detection semantics would make old snapshots misleading"),
  `COMPARISON_VERSION` bumps `1` → `2` in `src/snapshot/scan-snapshot.ts`.
  `compareScanResult` already returns `unavailable("semantics-changed")` on
  version mismatch, so pre-bump snapshots degrade to "no lifecycle claims"
  instead of lying. `SNAPSHOT_SCHEMA_VERSION` stays `1` (the snapshot *file*
  format is unchanged; only the interpretation semantics moved).
- Consequences accepted: existing snapshots stop producing comparisons until
  the next successful scan replaces them, and previously ignored 403/429/5xx
  findings resurface under their new fingerprints. Both are correct outcomes
  of a semantics change.

### CLI JSON impact

Additive and re-classifying only:

- Every external-link HTTP finding's `evidence` gains `method` and, for the
  three new presentations, one boolean discriminator
  (`restricted` / `rateLimited` / `serverError`). `url` and `status` are
  unchanged, so existing stable fields survive.
- `title` changes for 401/403/429/5xx findings (see table) — `title` is
  presentation, not a documented stable field; `scannerId`, `fingerprint`,
  `severity`, paths, `evidence` keys, and fix metadata (external-link issues
  have no fix actions) remain stable in shape.
- The CLI runtime override (`cli/cli.ts` `CliRuntime.requestUrl`) becomes
  `ExternalRequestAdapter`; JSON output is otherwise unaffected.

## Precision-suite impact

`src/tests/scanner-precision.test.ts` external describe block (fixture
`src/tests/fixtures/precision-vault/notes/external-links.md` — unchanged,
fixture files are frozen):

- `https://status-404.example.com/gone` → stays `Dead external link`,
  `warning`, `candidate`, evidence gains `method: "HEAD"`.
- `https://status-403.example.com/private` → **flips** to
  `External link access restricted`, `info`, `unverified`.
- `https://status-429.example.com/slow-down` → **flips** to
  `External link rate limited`, `info`, `unverified`.
- `https://status-500.example.com/server-error` → **flips** to
  `External link server error`, `info`, `candidate`.
- `https://status-200.example.com/ok` stays silent;
  `request-error`/loopback findings stay `unverified` — but the
  "unverified count" assertion moves from 2 to 4 (blocked + failed + 403 +
  429).
- The stub adapter returns `{ status, method: "HEAD" }` instead of a bare
  number.
- `EXPECTED_INVENTORY` is unaffected: the default-scan inventory excludes
  external-links (disabled by default), as its own test already pins.

## Test strategy

- `src/tests/external-links.test.ts` — rewrite: every classification row
  (404, 410, 400, 401, 403, 429, 500, 200), fallback behavior (HEAD 405 →
  GET 200 silent; HEAD 501 → GET 404 dead with `method: "GET"`; no fallback
  on 404; fallback transport error → `failed`), evidence/fingerprint
  assertions, plus the kept blocked/timeout/failed/budget/bare-URL/ignore/
  dedupe tests under the new adapter signature.
- `src/tests/public-http.test.ts` — rewrite: method-aware request
  dependencies, `{ status, method }` results, fallback tests (405 and 501
  trigger a Range GET with re-resolved address; 404 does not; fallback
  re-runs URL/DNS validation; Range header sent; body discarded), redirect
  revalidation tests kept, abort-signal test updated for the new arity.
- `src/tests/cli.test.ts` — targeted updates: stub adapters return
  `{ status, method }`; `toHaveBeenCalledWith` assertions gain the `"HEAD"`
  method argument; abort test adapter signature updated.
- `src/tests/scanner-precision.test.ts` — external describe block rewrite
  (assertions only, fixtures untouched).
- `src/tests/scan-snapshot.test.ts`, `src/tests/result-diff.test.ts` —
  COMPARISON_VERSION pin updates (`toBe(2)`, snapshot literals, and the
  semantics-changed fixture moving to version 3).

## Verification strategy

```bash
npm test -- src/tests/external-links.test.ts src/tests/public-http.test.ts src/tests/cli.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: access-control, rate-limit, and temporary server responses are no
longer labeled dead links; the HEAD→GET fallback cannot bypass the SSRF
destination checks (scanner re-assesses before the fallback; the CLI adapter
re-assesses and re-resolves before every connection it opens).

## Risks

- **Obsidian `requestUrl` follows redirects internally**, so the plugin
  adapter cannot re-validate redirect destinations host-by-host. This
  limitation exists today (the pre-request `assessExternalHttpUrl` is the
  gate) and Obsidian's API offers no redirect interception; the fully
  revalidating path is the CLI adapter, which pins DNS and re-checks every
  hop. The adapter contract documents revalidation as required so any future
  Obsidian-side improvement lands in one place.
- **Fallback doubles requests for HEAD-rejecting origins** (within the same
  timeout envelope and batch slot). 405-to-HEAD origins are rare; worst case
  the URL consumes up to 2 × 5s inside its single 5s race, i.e. the fallback
  is simply truncated by the existing timeout — no budget regression.
- **COMPARISON_VERSION bump** invalidates lifecycle comparisons against all
  existing snapshots. Intended and safe (`semantics-changed` degradation
  beats false resolved/new claims); called out in the PR description.
- **405/501 after GET** (origin rejects both methods) is presented as a
  dead-link candidate: the resource is unreachable by any method we are
  willing to use, which is the closest honest reading of the status policy.
