# External-link SSRF Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent vault-controlled external-link checks from reaching non-public network destinations while preserving checks for ordinary public HTTP(S) links.

**Architecture:** Enforce a browser-compatible URL and IP policy in the shared scanner before either request adapter runs. Replace the CLI fetch adapter with a Node-only HEAD requester that resolves and pins a validated public address and manually revalidates each redirect hop; retain Obsidian `requestUrl` behind the shared policy and document its DNS/redirect limitation.

**Tech Stack:** TypeScript, Obsidian Plugin API, Node HTTP/HTTPS/DNS APIs, Vitest, ESLint, esbuild

**Design:** `docs/superpowers/specs/2026-08-06-external-link-ssrf-design.md`

---

## File map

- Create `src/utils/network-destination.ts`: parse URLs and classify public IPv4/IPv6 destinations without Node APIs.
- Create `src/tests/network-destination.test.ts`: table-driven shared policy coverage.
- Modify `src/scanner/scanners/external-links.ts`: block unsafe destinations before `ctx.requestUrl` and report the reason.
- Modify `src/tests/external-links.test.ts`: prove blocked destinations do not reach the adapter and public URLs still do.
- Create `cli/public-http.ts`: DNS validation, IP-pinned HEAD requests, and bounded manual redirects.
- Create `src/tests/public-http.test.ts`: deterministic DNS, pinning, redirect, and abort tests.
- Modify `cli/cli.ts`: use the secured CLI requester.
- Modify `src/tests/cli.test.ts`: replace fetch-specific expectations and add the original loopback regression.

### Task 1: Encode the shared destination invariant

- [x] Add failing table tests in `src/tests/network-destination.test.ts` for public URLs, credentials, localhost suffixes, alternate loopback IPv4 syntax, private/reserved IPv4, loopback/unique-local/link-local/IPv4-mapped IPv6, and malformed URLs.
- [x] Run `npm test -- src/tests/network-destination.test.ts` and require failure because the policy module does not exist.
- [x] Implement `assessExternalHttpUrl(value)` and `isPublicIpAddress(hostname)` in `src/utils/network-destination.ts`. Return a parsed `URL` on success and a stable human-readable reason on failure.
- [x] Re-run `npm test -- src/tests/network-destination.test.ts` and require all policy cases to pass.

### Task 2: Enforce the policy in the shared scanner

- [x] Add a failing `src/tests/external-links.test.ts` case containing `127.0.0.1`, `localhost`, private IPv4, and private IPv6 links; assert the request adapter is never called and each result is an `External link check blocked` information issue. Keep a public control in the same boundary and assert it reaches the adapter.
- [x] Run `npm test -- src/tests/external-links.test.ts` and require the adapter-call assertion to fail against the vulnerable implementation.
- [x] Add a `blocked` `CheckResult` variant in `src/scanner/scanners/external-links.ts`, call `assessExternalHttpUrl` at the start of `checkUrl`, include blocked counts in progress, and render a stable informational issue with the policy reason.
- [x] Re-run `npm test -- src/tests/external-links.test.ts` and require the regression and existing behavior tests to pass.

### Task 3: Secure the CLI connection and redirect boundary

- [x] Add failing tests in `src/tests/public-http.test.ts` using injected resolver and request functions. Cover rejection of private DNS answers, rejection of mixed public/private answers, passing the selected public address to the request function, public relative redirects, private redirect rejection before a second request, the five-hop limit, and abort propagation.
- [x] Run `npm test -- src/tests/public-http.test.ts` and require failure because `cli/public-http.ts` does not exist.
- [x] Implement `requestPublicHttpStatus(url, signal, dependencies?)` in `cli/public-http.ts`. Use the shared policy, `dns.lookup(..., { all: true, verbatim: true })`, `http.request`/`https.request` with a pinned custom lookup callback, explicit redirect handling, and a five-hop bound.
- [x] Re-run `npm test -- src/tests/public-http.test.ts` and require all connection-policy tests to pass.

### Task 4: Integrate and reproduce the original CLI exploit path

- [x] Update CLI tests so public-link cases inject or spy on the secured requester rather than global fetch. Add a real loopback HTTP server regression that scans a vault containing its URL and asserts the server receives zero requests while the JSON output contains a blocked-link issue.
- [x] Run the focused CLI adapter regression before integration and require it to fail because `runCli` ignores the secured runtime adapter; retain the loopback case as the end-to-end exploit regression because the shared policy already blocks the original direct address.
- [x] Replace the `fetch` adapter in `cli/cli.ts` with `requestPublicHttpStatus(url, signal)`.
- [x] Run `npm test -- src/tests/cli.test.ts` and require the public-link, timeout, and loopback regression cases to pass.

### Task 5: Verify security closure and repository health

- [x] Run `npm test -- src/tests/network-destination.test.ts src/tests/external-links.test.ts src/tests/public-http.test.ts src/tests/cli.test.ts`.
- [x] Re-run the original local loopback PoC through built `cli.js`; require zero received requests and an informational blocked-link result.
- [x] Review the final source-to-sink path and test an alternate private IPv6 destination plus a public-to-private redirect in the focused harness.
- [x] Run `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.
- [x] Run `npm pack --dry-run` and confirm the shipped CLI artifact remains included.
- [x] Inspect `git diff --check`, `git diff`, and `git status --short`; preserve the unrelated untracked `.zcode/` directory.
