# External-link SSRF Remediation Design

## Summary

The optional external-link scanner currently accepts every `http://` or `https://`
value from vault content and forwards it to either Obsidian `requestUrl` or Node
`fetch`. A crafted vault can therefore make the host issue `HEAD` requests to
loopback, private, link-local, metadata, or reserved destinations.

The remediation is layered. A shared, browser-compatible policy blocks unsafe URL
syntax and explicit non-public destinations before either runtime adapter is
called. The CLI adds connection-level controls: it resolves hostnames, rejects any
non-public answer, pins the HTTP connection to a validated address, disables
implicit redirects, and repeats validation for every redirect hop.

## Security invariant

Untrusted vault content must not cause Vault Inspector to initiate an external-link
check to an explicitly local or non-public destination. The CLI must additionally
connect only to the exact public address it validated and must revalidate every
redirect target before connecting.

## Shared destination policy

Create `src/utils/network-destination.ts` with pure helpers that use only web
platform APIs so the plugin bundle remains Obsidian-compatible.

The policy accepts only HTTP and HTTPS URLs and rejects:

- embedded username or password values;
- `localhost` and local-only suffixes such as `.localhost`, `.local`, `.lan`,
  `.internal`, and `.home.arpa`;
- non-public IPv4 literals, including loopback, private, link-local, carrier-grade
  NAT, documentation, benchmarking, multicast, and reserved ranges;
- non-public IPv6 literals, including unspecified, loopback, IPv4-mapped private
  addresses, unique-local, link-local, site-local, documentation, and multicast
  ranges.

WHATWG URL parsing is applied before address classification so alternate IPv4
spellings are normalized before the range check.

The external-link scanner reports a blocked URL as an informational issue with a
stable reason and never invokes `ctx.requestUrl` for it. Valid public URLs continue
through the existing timeout, status, and issue-reporting flow.

## CLI connection policy

Create `cli/public-http.ts`. Its public function returns the final HTTP status for a
HEAD request and accepts the existing `AbortSignal`.

For each request hop it:

1. applies the shared destination policy;
2. resolves DNS with `node:dns/promises` when the target is a hostname;
3. rejects empty answers and any answer that is not a public IPv4 or IPv6 address;
4. selects a validated answer and supplies a custom `lookup` callback to
   `node:http` or `node:https`, pinning the socket to that exact address while
   retaining the original hostname for the Host header and TLS SNI;
5. handles redirects itself and repeats the entire policy for the resolved
   `Location` value;
6. rejects redirect loops after five hops.

The request helper exposes narrow dependency injection for deterministic unit
tests. Production callers use its built-in DNS and HTTP implementations.

## Obsidian runtime boundary

The plugin keeps using Obsidian `requestUrl` after the shared destination policy.
This preserves cross-origin external-link checking and blocks the reproduced direct
private-address path. Obsidian does not expose DNS address selection or redirect
controls for `requestUrl`, so DNS rebinding and public-to-private redirect behavior
cannot be closed at the socket layer without replacing the supported adapter or
disabling the feature. This residual limitation is documented in code and in the
verification report; the scanner remains disabled by default.

## Error and compatibility behavior

- Blocked explicit destinations produce `External link check blocked` information
  issues instead of silent omission.
- CLI DNS, redirect, and connection-policy failures continue through the existing
  `External link check failed` path.
- Healthy public links remain unreported; public 4xx/5xx statuses remain dead-link
  warnings.
- Existing timeouts and the global external-link scan budget remain unchanged.
- No settings, output schema, fix action, or default scanner state changes.

## Validation

Tests must prove that the original loopback request no longer reaches a local
server, representative private IPv4/IPv6 and local hostnames never reach the
adapter, alternate IPv4 spellings are normalized and blocked, public destinations
retain existing behavior, CLI DNS answers containing a private address fail closed,
connections receive the selected validated address, redirect targets are
revalidated, redirect loops are bounded, and abort signals still cancel requests.

The final verification sequence is:

```bash
npm test -- src/tests/network-destination.test.ts src/tests/external-links.test.ts src/tests/public-http.test.ts src/tests/cli.test.ts
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
```

## Non-goals

- Fixing the separate regular-expression, Markdown-export, or algorithmic-complexity findings.
- Adding a user-maintained domain allowlist.
- Replacing Obsidian `requestUrl` or changing the external-link scanner's default state.
