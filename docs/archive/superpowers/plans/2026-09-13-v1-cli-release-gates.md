# CLI Configuration, Installed Package and Release Gates Implementation Plan


**Goal:** Fix silent misinterpretation of CLI JSON configuration, verify that installed npm artifacts run on Node 18/24, and prevent inconsistent releases through version, packaging, and release gates.

**Architecture:** Validate configuration as unknown at the JSON boundary before entering the existing CliConfig merge path; introduce no schema dependency and preserve scan semantics. Build and package once on Node 24, then distribute the same tarball for installation checks on Node 18/24. Release only commits that pass verification and belong to main.

**Tech Stack:** TypeScript, Vitest, Node built-in assert/fs/child_process, npm pack/install, GitHub Actions.

---

All paths below are relative to `/Users/Roger/Code/personal/vault-inspector`; run commands from that directory. This document defines the plan; write code and commit only during execution. Follow the master plan and C6 session authorization for version bumps and external publication, without requesting authorization already granted. Node 18 is the minimum runtime promised by package.json; this does not imply that development tools run on Node 18.

## B1 — Strict CLI Configuration Boundary Validation

**Files:** Modify `cli/cli.ts` (`loadConfig`, `validateConfig`); Test `src/tests/cli.test.ts`; Modify the configuration documentation in `docs/cli.md`.

The current `JSON.parse(raw) as CliConfig` only bypasses the type system: `[]` is accepted, and comparing against `largeMarkdownBytes: "garbage"` can produce a successful result with no findings. Enum and array fields also suffer from truthiness checks and missing type validation.

Policy: require a non-null, non-array object and validate the types of all known fields. All five numeric settings must be finite non-negative integers, including 0. Do not coerce strings to numbers. Preserve the existing behavior of ignoring unknown fields to avoid additional compatibility changes. Reject an invalid configuration file even when a CLI option overrides the invalid field.

- [ ] Add the following tests inside `describe("runCli", ...)`, reusing the existing `withVault`, `mkdtemp`, `writeFile`, `join`, `tmpdir`, and `rm` imports:

```ts
it.each([
  ["[]", "Config must be a JSON object"],
  ["null", "Config must be a JSON object"],
  ["true", "Config must be a JSON object"],
  ['"config"', "Config must be a JSON object"],
  ['{"largeMarkdownBytes":"garbage"}', "largeMarkdownBytes must be a finite non-negative integer"],
  ['{"largeMarkdownBytes":"10"}', "largeMarkdownBytes must be a finite non-negative integer"],
  ['{"largeMarkdownBytes":1e999}', "largeMarkdownBytes must be a finite non-negative integer"],
  ['{"largeAttachmentBytes":-1}', "largeAttachmentBytes must be a finite non-negative integer"],
  ['{"duplicateHashMaxBytes":null}', "duplicateHashMaxBytes must be a finite non-negative integer"],
  ['{"lowUsageTagThreshold":1.5}', "lowUsageTagThreshold must be a finite non-negative integer"],
  ['{"emptyNoteWordThreshold":false}', "emptyNoteWordThreshold must be a finite non-negative integer"],
  ['{"scanners":"large-files"}', "scanners must be an array of strings"],
  ['{"severity":[0]}', "severity must be an array of strings"],
  ['{"include":null}', "include must be an array of strings"],
  ['{"exclude":[1]}', "exclude must be an array of strings"],
  ['{"watchedTags":{}}', "watchedTags must be an array of strings"],
  ['{"baselinePath":false}', "baselinePath must be a string"],
  ['{"failOn":""}', "Unsupported failOn value: "],
])("rejects invalid config %s before scanning", async (raw, message) => {
  const dir = await mkdtemp(join(tmpdir(), "vi-invalid-config-"));
  try {
    const config = join(dir, "config.json");
    await writeFile(config, raw, "utf8");
    // This vault deliberately does not exist. Config validation must win.
    const result = await runCli([join(dir, "missing-vault"), "--config", config]);
    expect(result).toEqual({ exitCode: 2, stdout: "", stderr: `${message}\n` });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([0, 10])("accepts integer config threshold %s without losing findings", async (threshold) => {
  await withVault({ "Note.md": "x".repeat(30) }, async (vaultPath) => {
    const config = join(vaultPath, "config.json");
    await writeFile(config, JSON.stringify({
      scanners: ["large-files"], largeMarkdownBytes: threshold, failOn: "none",
    }), "utf8");
    const result = await runCli([vaultPath, "--config", config, "--format", "json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ scannerId: "large-files", primaryPath: "Note.md" }),
    ]));
  });
});
```

- [ ] RED: `npm test -- src/tests/cli.test.ts -t 'rejects invalid config|accepts integer config'`. Cases such as an array root must fail; ensure an unrelated scan error is not mistaken for successful validation.
- [ ] Replace the three parse/validate lines in `loadConfig` with:

```ts
const candidate: unknown = JSON.parse(raw);
const validationError = validateConfig(candidate);
if (validationError) return { error: validationError };
const config = candidate as CliConfig;
```

- [ ] Replace `validateConfig` with the complete function below. Keep the existing signatures of `validateScanners`, `isSeverity`, and `isFailOn`.

```ts
function validateConfig(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "Config must be a JSON object";
  }
  const config = value as Record<string, unknown>;
  const arrayKeys = [
    "scanners", "severity", "include", "exclude", "ignoredFolders",
    "ignoredLargeMarkdownFrontmatterKeys", "ignoredLargeMarkdownPathPatterns",
    "watchedTags", "ignoredProperties",
  ];
  for (const key of arrayKeys) {
    const field = config[key];
    if (field !== undefined &&
      (!Array.isArray(field) || field.some((item) => typeof item !== "string"))) {
      return `${key} must be an array of strings`;
    }
  }
  const numberKeys = [
    "largeMarkdownBytes", "largeAttachmentBytes", "duplicateHashMaxBytes",
    "lowUsageTagThreshold", "emptyNoteWordThreshold",
  ];
  for (const key of numberKeys) {
    const field = config[key];
    if (field !== undefined && (typeof field !== "number" ||
      !Number.isFinite(field) || !Number.isInteger(field) || field < 0)) {
      return `${key} must be a finite non-negative integer`;
    }
  }
  if (config.baselinePath !== undefined && typeof config.baselinePath !== "string") {
    return "baselinePath must be a string";
  }
  if (config.scanners !== undefined) {
    const error = validateScanners(config.scanners as string[]);
    if (error) return error;
  }
  if (config.severity !== undefined) {
    for (const severity of config.severity as string[]) {
      if (!isSeverity(severity)) return `Unknown severity: ${severity}`;
    }
  }
  if (config.failOn !== undefined && !isFailOn(config.failOn)) {
    return `Unsupported failOn value: ${String(config.failOn)}`;
  }
  if (config.ignoreUnresolvedNoteLinks !== undefined &&
      typeof config.ignoreUnresolvedNoteLinks !== "boolean") {
    return "ignoreUnresolvedNoteLinks must be a boolean";
  }
  if (config.ignoredFoldersByScanner !== undefined) {
    const foldersByScanner = config.ignoredFoldersByScanner;
    if (typeof foldersByScanner !== "object" || foldersByScanner === null ||
        Array.isArray(foldersByScanner)) {
      return "ignoredFoldersByScanner must be an object of scanner IDs to folder arrays";
    }
    for (const [scannerId, folders] of Object.entries(foldersByScanner)) {
      if (!SCANNER_IDS.includes(scannerId as ScannerId)) {
        return `Unknown scanner in ignoredFoldersByScanner: ${scannerId}`;
      }
      if (!Array.isArray(folders) || folders.some((folder) => typeof folder !== "string")) {
        return `ignoredFoldersByScanner.${scannerId} must be an array of folder paths`;
      }
    }
  }
  return null;
}
```

- [ ] GREEN: `npm test -- src/tests/cli.test.ts`. Existing tests for CLI overrides, per-scanner folders, and boolean-field error messages must also pass.
- [ ] Add the following to the configuration section of `docs/cli.md`:

```markdown
Configuration must be a JSON object. Thresholds and the duplicate hash cap must
be finite non-negative integers; numeric strings are not accepted. List options
must be arrays of strings. Invalid configuration exits with code 2 before the
vault is scanned, even when a command-line option would override that field.
Unknown configuration keys are ignored.
```

- [ ] Run the complete required checks before committing: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.
- [ ] Commit: `git add cli/cli.ts src/tests/cli.test.ts docs/cli.md && git commit -m "fix: validate CLI configuration before scanning"`。

## B2 — Verify Installed CLI Entrypoints from a Tarball

**Files:** Create `scripts/smoke-installed-cli.mjs`; Modify `package.json` scripts；Modify `.github/workflows/ci.yml`。

- [ ] Create the complete smoke script below. The script itself must run on Node 18 without Vitest or devDependencies:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";

assert(process.argv[2], "Usage: node scripts/smoke-installed-cli.mjs <tarball>");
const tarball = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "vi-installed-"));
const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` };
const run = (file, args, cwd = root) => {
  const result = spawnSync(file, args, { cwd, env, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
};
try {
  const install = run("npm", ["install", "--prefix", root, "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
  assert.equal(install.status, 0, install.stderr);
  const pkg = JSON.parse(await readFile(join(root, "node_modules/vault-inspector/package.json"), "utf8"));
  const vault = join(root, "vault");
  await mkdir(vault);
  const files = { "A.md": "Identical content", "B.md": "Identical content" };
  for (const [name, body] of Object.entries(files)) await writeFile(join(vault, name), body);
  for (const alias of ["vault-inspector", "vinspect"]) {
    const binary = join(root, "node_modules/.bin", alias);
    const help = run(binary, ["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert(help.stdout.includes("--config"));
    const scan = run(binary, [vault, "--format", "json", "--scanner", "duplicate-files", "--fail-on", "none"]);
    assert.equal(scan.status, 0, scan.stderr);
    assert.equal(scan.stderr, "");
    const payload = JSON.parse(scan.stdout);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.toolVersion, pkg.version);
    assert.match(payload.comparison.scanProfile, /^[a-f0-9]{64}$/);
    assert(payload.issues.some((issue) => issue.scannerId === "duplicate-files" &&
      issue.evidence.hashState === "hash-confirmed" &&
      issue.relatedPaths.includes("A.md") && issue.relatedPaths.includes("B.md")));
    const baseline = join(root, `${alias}-baseline.json`);
    await writeFile(baseline, scan.stdout);
    const repeat = run(binary, [vault, "--format", "json", "--scanner", "duplicate-files",
      "--baseline", baseline, "--fail-on", "new"]);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.equal(repeat.stderr, "");
    const comparison = JSON.parse(repeat.stdout).comparison;
    assert.equal(comparison.available, true);
    assert.equal(comparison.mode, "profile");
    assert.equal(comparison.newIssues, 0);
    assert.equal(comparison.resolvedIssues, 0);
    assert.equal(comparison.persistingIssues, payload.comparison.fingerprints.length);
    const old = structuredClone(payload);
    old.comparison.comparisonVersion -= 1;
    const oldBaseline = join(root, `${alias}-old-baseline.json`);
    await writeFile(oldBaseline, JSON.stringify(old));
    const mismatch = run(binary, [vault, "--format", "json", "--scanner", "duplicate-files",
      "--baseline", oldBaseline, "--fail-on", "none"]);
    assert.equal(mismatch.status, 2);
    assert.equal(JSON.parse(mismatch.stdout).comparison.reason, "semantics-changed");
    const failure = run(binary, ["scan", vault, "--scanner", "duplicate-files", "--fail-on", "any"]);
    assert.equal(failure.status, 1, failure.stderr);
    const config = join(root, "invalid.json");
    await writeFile(config, '{"largeMarkdownBytes":"garbage"}');
    const invalid = run(binary, [vault, "--config", config]);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /largeMarkdownBytes must be a finite non-negative integer/);
  }
  for (const [name, body] of Object.entries(files)) assert.equal(await readFile(join(vault, name), "utf8"), body);
  assert.deepEqual((await readdir(vault)).sort(), Object.keys(files).sort());
  console.log(`Installed CLI smoke passed on ${process.version}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
```

- [ ] RED: Run the script against a tarball from the commit before B1. It must fail at the `largeMarkdownBytes` validation assertion. Do not roll back the current worktree. Use `git worktree add --detach /private/tmp/vi-smoke-before HEAD^` to create a checkout exclusively for the comparison build, run `npm ci && npm run build && npm pack --pack-destination /private/tmp` there, then point the current script at the resulting package. Record the package path and hash; keep the old package outside the release candidate directory. If that ancestor is not the pre-B1 state, use `git log --oneline` to locate the parent of the fix commit before creating the worktree.
- [ ] Add `"smoke:package": "node scripts/smoke-installed-cli.mjs"` to `package.json` scripts.
- [ ] GREEN (Node 24): Run `npm run build`, then the following version-independent command:

```bash
node --input-type=module <<'JS'
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const directory = await mkdtemp(join(tmpdir(), "vi-candidate-pack-"));
const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", directory], { encoding: "utf8" }));
if (packed.length !== 1) throw new Error("Expected one npm package");
const tarball = join(directory, packed[0].filename);
execFileSync(process.execPath, ["scripts/smoke-installed-cli.mjs", tarball], { stdio: "inherit" });
console.log(JSON.stringify({ tarball, integrity: packed[0].integrity }));
JS
```

Retain the actual tarball path and integrity from the output; use that same file for the subsequent npm publish.
## B3 — Node 18/24 Artifact Runtime Matrix

Depends on B2. Modify `.github/workflows/ci.yml`; build only on Node 24.

- [ ] Keep the Node 24 lint/build/coverage/dry-run steps in the CI `verify` job and append:

```yaml
      - name: Create package artifact
        run: |
          mkdir package-artifact
          npm pack --pack-destination package-artifact
      - uses: actions/upload-artifact@v4
        with:
          name: npm-package
          path: package-artifact/*.tgz
          if-no-files-found: error
```

Add the following job to the same workflow. Build the artifact once; runtime jobs must not run npm ci/build:

```yaml
  installed-cli:
    needs: verify
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [18, 24]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
      - uses: actions/download-artifact@v4
        with:
          name: npm-package
          path: package-artifact
      - name: Verify installed CLI
        run: |
          set -euo pipefail
          packages=(package-artifact/*.tgz)
          test "${#packages[@]}" -eq 1
          node scripts/smoke-installed-cli.mjs "${packages[0]}"
```

- [ ] Acceptance: Both jobs pass against the same tarball, and logs record the actual Node versions. Node 18 must not run the modern Vitest/esbuild toolchain. This script covers only Linux/macOS bin shell paths; do not claim Windows installation acceptance. C2 covers native Windows installation checks. Porting this script requires .cmd handling and Windows process-launch rules, without uncontrolled shell string concatenation.
- [ ] After all required checks pass, commit `ci: verify installed CLI on supported Node runtimes`.

## B4 — Version and Release Gates

**Files:** Create `scripts/check-release-version.mjs`; Modify `.github/workflows/release.yml`; Modify the verify workflow. Version promotion modifies `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and `cli/version.ts`.

- [ ] Create the script below and add `node scripts/check-release-version.mjs` before the build in the verify workflow:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const pkg = await json("package.json");
const lock = await json("package-lock.json");
const manifest = await json("manifest.json");
const versions = await json("versions.json");
const source = await readFile("cli/version.ts", "utf8");
assert.equal(manifest.version, pkg.version, "manifest version mismatch");
assert.equal(lock.version, pkg.version, "lockfile version mismatch");
assert.equal(lock.packages[""].version, pkg.version, "lockfile root version mismatch");
assert.equal(versions[pkg.version], manifest.minAppVersion, "versions compatibility mapping mismatch");
assert.equal(source.trim(), `export const TOOL_VERSION = "${pkg.version}";`, "CLI version mismatch");
if (process.argv[2] !== undefined) assert.equal(process.argv[2], pkg.version, "tag version mismatch");
console.log(`Version metadata verified: ${pkg.version}`);
```

- [ ] RED: `node scripts/check-release-version.mjs 999.0.0` must exit nonzero. GREEN: `node scripts/check-release-version.mjs` must exit 0. Do not modify repository metadata for the negative test.
- [ ] Add `fetch-depth: 0` to the release checkout. Add the following before npm ci:

```yaml
      - name: Verify tag version and main ancestry
        env:
          RELEASE_TAG: ${{ github.ref_name }}
        run: |
          node scripts/check-release-version.mjs "$RELEASE_TAG"
          git fetch origin main
          git merge-base --is-ancestor HEAD origin/main
```

- [ ] Replace the single `npm run build` step in the release workflow with this self-contained verification sequence. Tag releases must not rely solely on a historical passing run:

```yaml
      - run: npm run lint
      - run: npm run lint:obsidian-warnings
      - run: npm run build
      - run: npm run test:coverage
      - run: npm pack --dry-run
      - name: Verify installed package
        run: |
          set -euo pipefail
          mkdir release-package
          npm pack --pack-destination release-package
          packages=(release-package/*.tgz)
          test "${#packages[@]}" -eq 1
          node scripts/smoke-installed-cli.mjs "${packages[0]}"
      - uses: actions/setup-node@v6
        with:
          node-version: 18
      - name: Verify minimum Node runtime
        run: |
          set -euo pipefail
          packages=(release-package/*.tgz)
          test "${#packages[@]}" -eq 1
          node scripts/smoke-installed-cli.mjs "${packages[0]}"
      - uses: actions/setup-node@v6
        with:
          node-version: 24
```

Keep the existing Create release / Attest steps after these checks. Do not add a separate manual `gh release create` path. The existing workflow remains responsible for creating the release.

- [ ] Inspect default-branch protection: read the existing required status checks, retain verify, and add the actual CI check names for `installed-cli (18)` and `installed-cli (24)`. If changing protection settings is not authorized, record the administrator action as a gate and manually verify all three checks before merging in the meantime. Do not remove existing protections to make CI pass.
- [ ] Before committing, run all required checks, `npm pack --dry-run`, and the local smoke test; commit `ci: gate release assets on version and package verification`.

Follow [C6](2026-09-13-v1-runtime-acceptance.md#c6--formal-release-explicit-session-authorization-required) for formal version promotion, merging, tagging, and npm publication to prevent drift between two runbooks. This subplan does not authorize publication.

## B5 — Align README with Current Scan and Keep Policies

**Files:** Modify `README.md`; verify against `src/scanner/reference-index.ts`, `src/scanner/scanners/duplicate-files.ts`, `src/fix/action-policy.ts`。

- [ ] Replace the opening orphan-detection paragraph with:

```markdown
Scans for attachment files without indexed references from Markdown links,
embeds, frontmatter links, Canvas file nodes, or Canvas group backgrounds.
```

Replace the limitations paragraph with:

```markdown
Orphan detection cannot account for references from CSS, dynamic Dataview
queries, or external tools. Missing Markdown metadata and malformed or
unreadable Canvas files reduce reference coverage; trash actions are blocked while reference coverage is incomplete. Orphan
findings remain candidates, not proof that an attachment is unused.
```

- [ ] Replace the opening duplicate-detection paragraph with:

```markdown
Collects candidates using two independent groups: matching basename plus
extension, and matching byte size. Candidate files at or below the hash cap are
verified with SHA-256, so identical content can be detected across different
filenames. Files above the cap remain unverified candidates.
```

- [ ] Replace the keep-policy paragraph with the following accurate description of the existing `pickAutomaticKeepPath` and `action-policy` behavior. If another subplan changes the policy during execution, update this wording and the corresponding tests together.

```markdown
Deletion is offered only for files confirmed identical by content hash. By
default, Vault Inspector asks which file to keep. Automatic selection prefers
the copy with the highest indexed inbound reference count; ties use the
lexicographically smallest vault-relative path. Groups with multiple referenced
copies require an explicit keep choice and are excluded from bulk actions.
References are never rewritten automatically. Modification time, access time,
and file size do not choose the keep file.
```
- [ ] Run `npm test -- src/tests/reference-index.test.ts src/tests/duplicate-files.test.ts src/tests/action-policy.test.ts src/tests/scanner-precision.test.ts`. Verify that existing cases for Canvas file nodes, group backgrounds, and identical content under different filenames pass. State that these are logic tests, not native Obsidian acceptance.
- [ ] After all required checks pass, commit `docs: clarify reference coverage and duplicate detection`. Keep scanner implementation changes out of this documentation commit.

- [ ] Align the comparison-semantics documentation in `docs/cli.md` with the final A2 value. Preserve schemaVersion=1, stable fields, legacy-baseline warnings, and exit 0/1/2 definitions.
- [ ] Update the outdated version and read-only descriptions in `CLAUDE.md` to match `AGENTS.md`: scans are read-only; exports and explicitly confirmed fixes may write. The manifest defines the actual version; write the 1.0 version number only in C6.
- [ ] Add navigation for the current delivery status to the old umbrella roadmap, linking this plan and existing completion records. Do not mark all items complete without renewed acceptance.
- [ ] Check the README External Links section against the current classification: 401/403 means restricted access, 429 means rate limiting, 404/410 means a candidate dead link, 5xx means a temporary server error, and failures/timeouts remain unverified. Preserve the existing severity rules.
- [ ] Update the README settings table to state that automatic scans and network access are disabled by default. For synchronization failures after a fix, document the recovery step: "Changes may have been saved. Run another scan and review the result."

## Self-Review and Acceptance Records

- [ ] Record the failing tests before the fix, passing tests after the fix, complete verification logs, tarball filename/hash, actual Node 18/24 versions, and CI URLs.
- [ ] This document is a pending execution plan. Implement and verify B1–B5, then follow C6 for publication.
- [ ] If a dependency is unavailable, the Node 18 artifact fails, versions disagree, native acceptance evidence is missing, or registry login fails, stop the corresponding release stage with a specific BLOCKED reason. Preserve completed work and do not fabricate acceptance results.
