# 1.0.0 Core Reliability Implementation Plan

**Goal:** Fix three problems: atomic writes, missing target metadata, and cache verification after operations.

**Architecture:** Keep scanner logic pure; update content through `vault.process` in the executor; place native event synchronization in the plugin adapter, and let the batch runner consume explicit verification readiness results.

**Tech Stack:** TypeScript, Obsidian API, Vitest, and the existing Markdown parser.

Follow the [master plan](2026-09-13-v1-release-readiness.md) for execution order and shared gates. This companion plan does not authorize a release.

## A1 — Atomic link text fixes

**Files:**
- Modify: `src/fix/fix-executor.ts` — `replaceLinkText`.
- Modify: `src/tests/fix-executor.test.ts` — stateful vault mock and concurrency/primitive tests.
- Modify: mocks in `src/tests/fix-runner.test.ts` that call the real executor.
- Locate: `rg -n 'executeFixAction|vault:|modify:' src/tests/main.test.ts src/tests/fix-runner.test.ts src/tests/fix-executor.test.ts`; update only mocks that depend on the real executor, without bulk changes to unrelated tests.

### A1.1 — Add a regression that fails against the old implementation

- [ ] Add the following test to `fix-executor.test.ts`. The injection simulates another writer committing exactly between read and modify; the new implementation does not call either primitive and instead obtains the latest content under the process lock.

```ts
it("preserves an edit committed before the atomic transformation", async () => {
  const file = new TFile("Source.md");
  let disk = "[label](missing)\nOriginal paragraph";
  const appended = "\nConcurrent user edit";
  const read = vi.fn(async () => {
    const stale = disk;
    disk += appended;
    return stale;
  });
  const modify = vi.fn(async (_file: TFile, text: string) => { disk = text; });
  const process = vi.fn(async (_file: TFile, transform: (text: string) => string) => {
    disk += appended;
    disk = transform(disk);
    return disk;
  });
  const app = { vault: { getAbstractFileByPath: () => file, read, modify, process } };
  const count = await executeFixAction(app as any, {
    kind: "remove-link-text", label: "Remove link", description: "",
    targetPaths: [file.path], original: "[label](missing)", replacement: "label",
  });
  expect(count).toBe(1);
  expect(disk).toBe("label\nOriginal paragraph\nConcurrent user edit");
  expect(process).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  expect(modify).not.toHaveBeenCalled();
});
```

- [ ] Run `npm test -- src/tests/fix-executor.test.ts -t 'preserves an edit committed'`; the old implementation must fail because it loses the appended content, not because of dependency or type errors.

### A1.2 — Replace the function while preserving actual syntax parsing

- [ ] Replace `replaceLinkText` with the following function without changing the trash branch. The installed Obsidian declarations state that `Vault.process` has been supported since 1.1.0, earlier than the current minimum supported version.

```ts
async function replaceLinkText(
  app: App,
  sourcePath: string,
  original: string | undefined,
  replacement: string,
  legacyLinkText?: string,
): Promise<number> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile)) return 0;
  let changed = false;
  await app.vault.process(file, (content) => {
    const wiki = original === undefined || /^!?\[\[/.test(original);
    const ranges = (wiki ? wikiLinkRanges(content) : markdownLinks(content))
      .filter(({ start, end }) => {
        const source = content.slice(start, end);
        return original !== undefined
          ? source === original
          : source === `[[${legacyLinkText}]]` || source === `![[${legacyLinkText}]]`;
      })
      .sort((left, right) => left.start - right.start);
    let cursor = 0;
    let updated = "";
    for (const { start, end } of ranges) {
      if (start < cursor) continue;
      updated += content.slice(cursor, start) + replacement;
      cursor = end;
    }
    updated += content.slice(cursor);
    changed = updated !== content;
    return updated;
  });
  return changed ? 1 : 0;
}
```

- [ ] Update the test helper `makeApp(content)` to hold a writable `disk`, implement `process`, and expose `getContent()`. Replace `expect(modify).toHaveBeenCalledWith(file, expected)` with `expect(getContent()).toBe(expected)`; preserve all expected strings and source protection assertions. When no match exists, verify count=0 and unchanged content, without asserting that native process performs no filesystem calls.

```ts
function makeApp(content: string) {
  const file = new TFile("Source.md");
  let disk = content;
  const process = vi.fn(async (_file: TFile, transform: (text: string) => string) => {
    disk = transform(disk);
    return disk;
  });
  const read = vi.fn(async () => disk);
  const modify = vi.fn(async (_file: TFile, text: string) => { disk = text; });
  return {
    app: { vault: { getAbstractFileByPath: vi.fn(() => file), read, modify, process } },
    file, process, modify, getContent: () => disk,
  };
}
```

### A1.3 — Protection and failure matrix

- [ ] Confirm that existing tests for Wiki/Markdown aliases, embeds, legacy syntax, indented/fenced/inline code, HTML comments, and escaped examples remain present and pass.
- [ ] Add a process rejection test: `app.vault.process.mockRejectedValueOnce(new Error("write failed"))`. Assert that `executeFixAction` rejects and the runner returns `failed/phase:execution` for that item; it must not return count=0 as a false success.
- [ ] Add a test where the target link has already disappeared from the latest content received by process: count=0, and old text is not restored.
- [ ] Run `npm test -- src/tests/fix-executor.test.ts src/tests/fix-runner.test.ts src/tests/main.test.ts`, then run the full gates in the master plan.
- [ ] Commit separately: `fix: preserve concurrent edits during link fixes`. Record RED/GREEN evidence and the commit SHA.

## A2 — Do not confirm broken heading or block links when metadata is missing

**Files:**
- Modify: `src/tests/helpers/scan-context.ts` — distinguish explicit null from an omitted cache that receives the default.
- Modify: `src/scanner/scanners/broken-links.ts` — the heading branch in `resolveLinkIssues`.
- Modify: `src/tests/broken-links.test.ts`, `src/tests/action-policy.test.ts`, `src/tests/fix-runner.test.ts`.
- Modify: `src/snapshot/scan-snapshot.ts` — comparison semantics.
- Modify: `src/tests/scan-snapshot.test.ts`, `src/tests/result-diff.test.ts`, `src/tests/cli.test.ts` — compatibility assertions for older versions.

### A2.1 — Fix the fixture blind spot and write the RED test

- [ ] Do not let `getFileCache` in `makeScanContext` erase null through `?? {}`; replace it with:

```ts
getFileCache: (file: TFile) => Object.prototype.hasOwnProperty.call(metadataByPath, file.path)
  ? metadataByPath[file.path]
  : {},
```

- [ ] Add the following parameterized regression. Each case must first explicitly assert cache=null so the fixture cannot conceal the problem again.

```ts
it.each(["Existing", "^block-id"])("does not authorize fixes without target cache: %s", (fragment) => {
  const ctx = makeScanContext({
    scanner: "broken-links",
    files: [{ path: "Source.md" }, { path: "Target.md" }],
    metadataByPath: {
      "Source.md": { links: [{
        link: `Target#${fragment}`, original: `[[Target#${fragment}]]`,
        position: {} as any,
      }] },
      "Target.md": null,
    },
  });
  expect(ctx.metadataCache.getFileCache(ctx.markdownFiles[1])).toBeNull();
  const issues = brokenLinksScanner.scan(ctx);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    classification: "unverified", severity: "info",
    evidence: { reason: "target-metadata-unavailable" },
  });
  expect(issues[0].fixAction).toBeUndefined();
});
```

- [ ] Run `npm test -- src/tests/broken-links.test.ts -t 'without target cache'`; it should fail because the old implementation returns confirmed.

### A2.2 — Minimal conservative branch

- [ ] Replace the targetCache initialization in the current `headingPart` branch with the following code; leave the subsequent existing `isBlock`/`found` branches unchanged. Do not treat an empty cache object as unavailable.

```ts
const targetFile = ctx.markdownFiles.find((file) => file.path === resolvedPath);
const targetCache = targetFile ? ctx.metadataCache.getFileCache(targetFile) : null;
if (!targetCache) {
  const uncertain = makeIssue(
    sourcePath, candidate, resolvedPath, "info",
    "The target metadata is not available yet.",
    "heading", headingPart.startsWith("^") ? "block" : "heading",
  );
  delete uncertain.fixAction;
  uncertain.title = "Link could not be verified";
  Object.assign(uncertain, describeFinding(
    "unverified",
    "The target exists, but its heading and block metadata could not be read.",
    "Wait for indexing to finish, then run the scan again.",
  ));
  uncertain.evidence.reason = "target-metadata-unavailable";
  issues.push(uncertain);
  return issues;
}
```

- [ ] Keep `heading` as the sixth `makeIssue` argument, `linkKind`; distinguish block/heading with the seventh argument, `referenceKind`. Do not introduce a new scanner ID or fingerprint algorithm.
- [ ] Add a matrix: null → unverified/no fix; `{}` or empty headings/blocks → the existing confirmed missing-target result; an actual matching heading/block → no issue; other headings/blocks → confirmed. A missing source cache must not throw. For fragment targets that are not Markdown, do not pass an undefined file to `getFileCache`.
- [ ] In the same ctx, replace the Target cache from null with a cache containing the heading/block. A repeated scan must no longer return the issue, demonstrating recovery.
- [ ] Add a runner regression: after the user confirms an old result, preflight returns unverified/no-fix with the same fingerprint; execute must be called 0 times and the outcome must be skipped. Do not relax the global action-policy here.

### A2.3 — Isolate older detection semantics

- [ ] Change `COMPARISON_VERSION` from 3 to 4, with a comment explaining that unavailable target metadata no longer confirms a broken link; keep snapshot schema and CLI schema at 1. If the version has changed by execution time, follow the increment rule in the master plan.

```ts
/** 4 — Missing target metadata is unverified and cannot authorize link fixes. */
export const COMPARISON_VERSION = 4;
```

- [ ] Preserve historical comments. Tests for the current version must use the imported constant; old baselines must explicitly hardcode comparisonVersion:3. Do not replace every occurrence of 3 across the repository.
- [ ] An old plugin snapshot must produce `semantics-changed`, without false new/resolved results; an old CLI profile baseline must return exit2, even with `--fail-on none`. Preserve the existing warning and compatibility policy for legacy fingerprint-only input.
- [ ] Run `npm test -- src/tests/broken-links.test.ts src/tests/action-policy.test.ts src/tests/fix-runner.test.ts src/tests/scan-snapshot.test.ts src/tests/result-diff.test.ts src/tests/cli.test.ts src/tests/scanner-precision.test.ts`, then run the full gates.
- [ ] Commit separately: `fix: withhold link fixes when target metadata is unavailable`.

## A3 — Native cache synchronization

The following sections define the complete adapter and runner changes to execute after A1/A2. A successful write and readiness for verification are distinct states; preserve the existing `phase: verification` representation and do not automatically retry mutations that have already executed.

### A3.1 — Boundaries and event evidence

- `src/fix/fix-executor.ts`: `replaceLinkText` currently returns immediately after `vault.modify`; it does not wait for the metadata cache.
- `src/fix/fix-runner.ts`: executes a preflight before every action and a final verification after the batch. Both may run before the updated cache is available.
- `src/main.ts:243`: directly wires `executeFixAction(this.app, action)` into the batch.
- `src/scanner/ScanRunner.ts:40`: builds its reference index and scanner context from live metadata. Do not add a blind wait here: the runner does not know which write/content it must observe.
- `node_modules/obsidian/obsidian.d.ts:4444-4471`: `changed(file,data,cache)` means that file's updated cache is available; `resolve(file)` relates to resolved/unresolved link tables and happens sometimes after indexing; `resolved()` means all files have resolved. A `resolved` before a matching `changed` is not proof for the write. Register listeners before calling the mutator because events can fire before its promise resolves.
- `src/fix/action-outcomes.ts` already supports `phase: "verification"`; keep this shape. No changes to CLI JSON schema, schemaVersion, or public action metadata.
- Scope includes deletion because a trash operation can also invalidate the shared reference index. For deletion, require the target's metadata `deleted` event for Markdown or vault `delete` for non-Markdown, followed by `resolved`, and check that the path is absent. If this sequence is not emitted on supported Obsidian versions, fail closed and resolve the event contract in native acceptance; do not accept an unrelated resolved or inject a delay.
- Timeout means writes may already be persisted. No automatic retry of the write. Ask the user to run a manual fresh scan and inspect saved contents before retrying. Scope is the causal boundary following our own writes, not an absolute consistent snapshot against concurrent external changes. The plan must be combined with A2 conservative cache preflight checks; do not describe a new batch as safe merely because it emitted some resolved event.

### A3.2 — File map

Create `src/fix/metadata-write-fence.ts` (event lifetime, correlation, timeout, poison).
Modify `src/fix/fix-executor.ts` (optional mutation fence invocation only).
Modify `src/fix/fix-runner.ts` (internal execution result, stop unsafe preflight/verification).
Modify `src/main.ts` (one fence per batch, guard and executor wiring, dispose on completion or unload).
Create `src/tests/metadata-write-fence.test.ts` (causal ordering and cleanup).
Modify `src/tests/fix-executor.test.ts`, `src/tests/fix-runner.test.ts`, `src/tests/main.test.ts` (integration regression).
`src/scanner/ScanRunner.ts`, `src/fix/action-outcomes.ts`, and `cli/**` remain unchanged.

### A3.3 — Add the event fence

- [ ] Add the following test fixture and tests to `src/tests/metadata-write-fence.test.ts`.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { MetadataWriteFence } from "../fix/metadata-write-fence";

function fixture() {
  vi.stubGlobal("window", globalThis);
  type Callback = (...args: unknown[]) => void;
  const listeners = new Map<object, { name: string; callback: Callback }>();
  const events = {
    on(name: string, callback: Callback) {
      const ref = {};
      listeners.set(ref, { name, callback });
      return ref;
    },
    offref(ref: object) { listeners.delete(ref); },
  };
  const emit = (name: string, ...args: unknown[]) => {
    for (const entry of [...listeners.values()]) {
      if (entry.name === name) entry.callback(...args);
    }
  };
  const file = { path: "Source.md", extension: "md" } as TFile;
  let exists = true;
  const app = {
    metadataCache: events,
    vault: { ...events, getAbstractFileByPath: () => exists ? file : null },
  } as unknown as App;
  const fence = new MetadataWriteFence(app, 100);
  return { file, fence, emit, listeners, remove: () => { exists = false; } };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("metadata write fence", () => {
  it("rejects early resolved and wrong content, then accepts the exact changed content plus resolved", async () => {
    const { file, fence, emit, listeners } = fixture();
    let finished = false;
    const waiting = fence.mutate(file, "new", async () => {}).then(value => {
      finished = true;
      return value;
    });
    emit("resolved");
    emit("changed", file, "old", {});
    emit("resolved");
    await Promise.resolve();
    expect(finished).toBe(false);
    emit("changed", file, "new", {});
    await Promise.resolve();
    expect(finished).toBe(false);
    emit("resolved");
    expect(await waiting).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("registers before write and accepts events fired inside modify", async () => {
    const { file, fence, emit, listeners } = fixture();
    expect(await fence.mutate(file, "new", async () => {
      expect(listeners.size).toBeGreaterThan(0);
      emit("changed", file, "new", {});
      emit("resolved");
    })).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("times out without throwing a successful write and removes listeners", async () => {
    vi.useFakeTimers();
    const { file, fence, listeners } = fixture();
    const write = vi.fn(async () => {});
    const waiting = fence.mutate(file, "new", write);
    await vi.advanceTimersByTimeAsync(100);
    expect(await waiting).toBe(false);
    expect(write).toHaveBeenCalledOnce();
    expect(fence.ready).toBe(false);
    expect(listeners.size).toBe(0);
    const secondWrite = vi.fn(async () => {});
    expect(await fence.mutate(file, "next", secondWrite)).toBe(false);
    expect(secondWrite).not.toHaveBeenCalled();
  });

  it("unload releases the waiter and removes all listeners", async () => {
    const { file, fence, listeners } = fixture();
    const waiting = fence.mutate(file, "new", async () => {});
    fence.dispose();
    expect(await waiting).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("preserves real write errors and still poisons the cache session", async () => {
    const { file, fence, listeners } = fixture();
    const error = new Error("write failed");
    await expect(fence.mutate(file, "new", async () => { throw error; })).rejects.toBe(error);
    expect(fence.ready).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("arms expected content in process before synchronous events", async () => {
    const { file, fence, emit } = fixture();
    expect(await fence.mutate(file, undefined, async expectContent => {
      expectContent("new");
      emit("changed", file, "new", {});
      emit("resolved");
    })).toBe(true);
  });

  it("does not await an event for an unchanged process result", async () => {
    const { file, fence, listeners } = fixture();
    expect(await fence.mutate(file, undefined, async () => {})).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("ignores other files and invalidates proof after conflicting source content", async () => {
    vi.useFakeTimers();
    const { file, fence, emit, listeners } = fixture();
    const waiting = fence.mutate(file, "new", async () => {});
    emit("changed", { path: "Other.md" }, "new", {});
    emit("resolved");
    emit("changed", file, "new", {});
    emit("changed", file, "different", {});
    emit("resolved");
    await vi.advanceTimersByTimeAsync(100);
    expect(await waiting).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("requires relevant deletion followed by resolution and actual path absence", async () => {
    const { file, fence, emit, remove, listeners } = fixture();
    let finished = false;
    const waiting = fence.mutate(file, null, async () => {}).then(value => {
      finished = true;
      return value;
    });
    emit("resolved");
    emit("deleted", { path: "Other.md" }, null);
    emit("resolved");
    await Promise.resolve();
    expect(finished).toBe(false);
    remove();
    emit("deleted", file, null);
    emit("resolved");
    expect(await waiting).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
```

- [ ] RED: `npm test -- src/tests/metadata-write-fence.test.ts`; expect missing-module failure.
- [ ] Create `src/fix/metadata-write-fence.ts`:

```ts
import type { App, EventRef, TFile } from "obsidian";

export type MutationFence = {
  readonly ready: boolean;
  mutate(file: TFile, content: string | null | undefined,
    write: (expectContent: (updated: string) => void) => Promise<void>): Promise<boolean>;
};

export const METADATA_NOT_READY =
  "Changes may already be saved, but metadata synchronization did not complete. " +
  "Remaining fixes in this batch were skipped. Run a fresh scan and review saved contents before retrying.";

export class MetadataWriteFence implements MutationFence {
  private poisoned = false;
  private disposed = false;
  private readonly cancel = new Set<() => void>();

  constructor(private readonly app: App, private readonly timeoutMs = 10000) {}

  get ready(): boolean { return !this.poisoned && !this.disposed; }

  async mutate(file: TFile, content: string | null | undefined,
    write: (expectContent: (updated: string) => void) => Promise<void>): Promise<boolean> {
    if (!this.ready) return false;
    const path = file.path;
    let relevant = false;
    let resolved = false;
    let writeDone = false;
    let done = false;
    let settle!: (value: boolean) => void;
    const waiting = new Promise<boolean>(resolve => { settle = resolve; });
    const metadataRefs: EventRef[] = [];
    const vaultRefs: EventRef[] = [];
    let timer: number | undefined;
    const finish = (success: boolean) => {
      if (done) return;
      done = true;
      if (!success) this.poisoned = true;
      for (const ref of metadataRefs) this.app.metadataCache.offref(ref);
      for (const ref of vaultRefs) this.app.vault.offref(ref);
      if (timer !== undefined) window.clearTimeout(timer);
      this.cancel.delete(cancel);
      settle(success);
    };
    const cancel = () => finish(false);
    const check = () => {
      if (!writeDone || !relevant || !resolved) return;
      if (content === null && this.app.vault.getAbstractFileByPath(path)) return;
      finish(true);
    };
    this.cancel.add(cancel);
    metadataRefs.push(this.app.metadataCache.on("changed", (changed, data) => {
      if (content === null || changed.path !== path) return;
      // A later change with other content invalidates earlier proof too.
      relevant = data === content;
      resolved = false;
    }));
    metadataRefs.push(this.app.metadataCache.on("deleted", deleted => {
      if (deleted.path !== path) return;
      relevant = content === null;
      resolved = false;
    }));
    if (content === null && file.extension !== "md") {
      vaultRefs.push(this.app.vault.on("delete", deleted => {
        if (deleted.path !== path) return;
        relevant = true;
        resolved = false;
      }));
    }
    metadataRefs.push(this.app.metadataCache.on("resolved", () => {
      if (!relevant) return;
      resolved = true;
      check();
    }));
    timer = window.setTimeout(cancel, this.timeoutMs);
    try {
      await write(updated => {
        content = updated;
        relevant = false;
        resolved = false;
      });
      writeDone = true;
      // process callbacks that return unchanged content do not schedule a cache event.
      if (content === undefined) finish(true);
      else check();
      return await waiting;
    } catch (error) {
      finish(false);
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const cancel of [...this.cancel]) cancel();
  }
}
```

- [ ] GREEN: `npm test -- src/tests/metadata-write-fence.test.ts`; expect all event-fence tests passing.
- [ ] Include this section and A3.4/A3.5 in one complete commit; do not commit an unconnected module separately. After integration, run `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`. See A3.5 for the commit boundary.

### A3.4 — Inject the fence at actual mutation points

- [ ] In `src/fix/fix-executor.ts`, import `MutationFence` as a type and add optional `fence?: MutationFence` to `executeFixAction`, `trashFiles`, `removeLinkText`, and `replaceLinkText` (put it after `legacyLinkText` in the latter). Propagate it in every call exactly as follows:

```ts
// executeFixAction switch:
case "trash-file":
  return trashFiles(app, action.targetPaths, fence);
case "remove-link-text": {
  const source = action.targetPaths[0];
  if (action.original !== undefined) {
    return replaceLinkText(app, source, action.original, action.replacement ?? "", undefined, fence);
  }
  return removeLinkText(app, source, action.linkText!, fence);
}
// removeLinkText body:
return replaceLinkText(app, sourcePath, undefined, "", linkText, fence);
```

Replace `replaceLinkText` in full below. This deliberately uses `vault.process`, preserving A1's atomic read/transform/write boundary. The fence registers before `process`, while expected content is armed synchronously inside its callback before returning the write content. `file` and no-op cases return zero without waiting for a nonexistent cache event.

```ts
async function replaceLinkText(
  app: App,
  sourcePath: string,
  original: string | undefined,
  replacement: string,
  legacyLinkText?: string,
  fence?: MutationFence,
): Promise<number> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile) || (fence && !fence.ready)) return 0;
  let affectedCount = 0;
  const write = async (expectContent: (updated: string) => void) => {
    await app.vault.process(file, content => {
      const wiki = original === undefined || /^!?\[\[/.test(original);
      const ranges = (wiki ? wikiLinkRanges(content) : markdownLinks(content))
        .filter(({ start, end }) => {
          const source = content.slice(start, end);
          return original !== undefined
            ? source === original
            : source === `[[${legacyLinkText}]]` || source === `![[${legacyLinkText}]]`;
        }).sort((left, right) => left.start - right.start);
      let cursor = 0;
      let updated = "";
      for (const { start, end } of ranges) {
        if (start < cursor) continue;
        updated += content.slice(cursor, start) + replacement;
        cursor = end;
      }
      updated += content.slice(cursor);
      if (updated !== content) {
        affectedCount = 1;
        expectContent(updated);
      }
      return updated;
    });
  };
  if (fence) await fence.mutate(file, undefined, write);
  else await write(() => {});
  return affectedCount;
}
```

Replace `trashFiles`' loop body with:

```ts
if (fence && !fence.ready) break;
const file = app.vault.getAbstractFileByPath(path);
if (file instanceof TFile) {
  const ready = fence
    ? await fence.mutate(file, null, () => app.fileManager.trashFile(file))
    : (await app.fileManager.trashFile(file), true);
  count++;
  if (!ready) break;
}
```

This keeps the legacy numeric API and current tests intact. A persisted write counts as affected even when its synchronization fails; main reports readiness separately. Stops between trash targets on failure to avoid a second mutation. The fence is local to this batch.

- [ ] Add this standalone regression to `src/tests/fix-executor.test.ts` after A1 updates its existing mock to use `vault.process`:

```ts
it("arms expected metadata inside the atomic process callback and preserves change count on timeout", async () => {
  const file = Object.assign(new TFile("Source.md"), { path: "Source.md" });
  const expectContent = vi.fn();
  const process = vi.fn(async (_file: TFile, transform: (content: string) => string) => {
    const updated = transform("[[Missing]]");
    expect(expectContent).toHaveBeenCalledWith(updated);
    expect(updated).toBe("Shown");
    return updated;
  });
  const app = { vault: { getAbstractFileByPath: () => file, process } };
  const mutate = vi.fn(async (_file: unknown, _content: unknown,
    write: (expect: (content: string) => void) => Promise<void>) => {
    await write(expectContent);
    return false;
  });
  expect(await executeFixAction(app as any, {
    kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"],
    original: "[[Missing]]", replacement: "Shown",
  }, { ready: true, mutate })).toBe(1);
  expect(mutate).toHaveBeenCalledWith(file, undefined, expect.any(Function));
  expect(process).toHaveBeenCalledWith(file, expect.any(Function));
});
```

Run RED before implementing the injection (the new third argument is ignored, therefore mutate is uncalled): `npm test -- src/tests/fix-executor.test.ts`. Run the same command GREEN after the change. Keep A1's atomically transformed source and its adversarial-source regression tests.

### A3.5 — Carry readiness through main and batch runner

- [ ] Add the following internal types/fields in `src/fix/fix-runner.ts`:

```ts
export type FixExecutionResult = {
  affectedCount: number;
  verificationReady: boolean;
  verificationMessage?: string;
};
// Replace FixRunnerDependencies.execute and add optional guard:
execute: (action: FixAction) => Promise<number | FixExecutionResult>;
canScan?: () => boolean;
```

Keep number compatibility so standalone executor tests and existing runner tests do not need a broad mechanical rewrite. Main must return the object; no public CLI field is added.

- [ ] Import `METADATA_NOT_READY` in runner. Replace `scanOnce` with the following implementation and add `verificationProblem` before it:

```ts
let verificationProblem: string | undefined;
const scanOnce = () => {
  if (verificationProblem || dependencies.canScan?.() === false) return Promise.resolve(null);
  return dependencies.scan(structuredClone(frozenSettings));
};
```

- [ ] Insert this at the top of each batch loop before the existing policy checks:

```ts
if (verificationProblem || dependencies.canScan?.() === false) {
  outcomes[index] = skipped(issue, METADATA_NOT_READY);
  continue;
}
```

- [ ] Replace the current `try` body that pushes pending actions:

```ts
const raw = await dependencies.execute(freshAction);
const execution = typeof raw === "number"
  ? { affectedCount: raw, verificationReady: true }
  : raw;
pending.push({
  index,
  fingerprint: issue.fingerprint,
  affectedPaths: [...freshAction.targetPaths],
  affectedCount: execution.affectedCount,
});
if (!execution.verificationReady) {
  verificationProblem = execution.verificationMessage ?? METADATA_NOT_READY;
}
```

Keep the existing catch's execution-phase failure for thrown write errors. The fence poisons on write errors too, so the dependency guard prevents subsequent preflights even when partial trash writes preceded that exception. In the no-verificationResult branch change only the pending outcome message:

```ts
message: verificationProblem ?? (
  dependencies.canScan?.() === false
    ? METADATA_NOT_READY
    : "The final verification scan did not complete."
),
```

- [ ] Main imports `MetadataWriteFence` and `METADATA_NOT_READY`; add `private activeMetadataFences = new Set<MetadataWriteFence>();`. Replace `onunload() {}` with:

```ts
onunload() {
  for (const fence of this.activeMetadataFences) fence.dispose();
  this.activeMetadataFences.clear();
}
```

- [ ] Replace the current main `const batch = await runFixBatch(...)` expression, preserving the surrounding frozen settings, profile and acceptance flow:

```ts
const fence = new MetadataWriteFence(this.app);
this.activeMetadataFences.add(fence);
const batch = await (async () => {
  try {
    return await runFixBatch(issues, decisions, {
      settings: () => fixSettings,
      scan: batchSettings => this.scan(view, batchSettings),
      canScan: () => fence.ready,
      execute: async action => ({
        affectedCount: await executeFixAction(this.app, action, fence),
        verificationReady: fence.ready,
        verificationMessage: fence.ready ? undefined : METADATA_NOT_READY,
      }),
    });
  } finally {
    fence.dispose();
    this.activeMetadataFences.delete(fence);
  }
})();
```

Readiness is evaluated after awaiting the executor because object-property evaluation is sequential. A timeout never throws solely for verification failure. A null verificationResult does not go through `acceptScanResult`, so stale results are not persisted as successful verification.

- [ ] Append these complete tests inside the existing `runFixBatch` describe block:

```ts
it("reports successful writes with cache timeouts in verification phase and stops subsequent preflights", async () => {
  const first = issue("first");
  const second = issue("second");
  const scan = vi.fn().mockResolvedValue(result([first, second]));
  const execute = vi.fn().mockResolvedValue({
    affectedCount: 1, verificationReady: false, verificationMessage: "Metadata timed out",
  });
  const batch = await runFixBatch([first, second], [
    { fingerprint: first.fingerprint }, { fingerprint: second.fingerprint },
  ], { settings: () => DEFAULT_SETTINGS, scan, execute });
  expect(scan).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce();
  expect(batch.verificationResult).toBeNull();
  expect(batch.outcomes[0]).toMatchObject({ outcome: "failed", phase: "verification", message: "Metadata timed out" });
  expect(batch.outcomes[1]).toMatchObject({ outcome: "skipped", phase: "preflight" });
});

it("does not run any preflight when this batch fence is already unavailable", async () => {
  const requested = issue("first");
  const scan = vi.fn();
  const execute = vi.fn();
  const batch = await runFixBatch([requested], [{ fingerprint: requested.fingerprint }], {
    settings: () => DEFAULT_SETTINGS, scan, execute, canScan: () => false,
  });
  expect(scan).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(batch.outcomes[0]).toMatchObject({ outcome: "skipped", phase: "preflight" });
});
```

RED/GREEN command: `npm test -- src/tests/fix-runner.test.ts src/tests/fix-executor.test.ts src/tests/metadata-write-fence.test.ts`.

Main tests mock `executeFixAction`, so creating the fence does not register any metadata listeners until the real mutator is used. No harness initialization is needed. Add `import { MetadataWriteFence } from "../fix/metadata-write-fence";` to `src/tests/main.test.ts`. Replace its existing executor argument assertion at line 1320 with:

```ts
expect(executeFixActionMock).toHaveBeenCalledWith(
  (plugin as any).app,
  expect.objectContaining({ targetPaths: ["a.md", "b.md"] }),
  expect.any(MetadataWriteFence),
);
```

- [ ] Run `npm test -- src/tests/main.test.ts`. Verify this integration suite remains green with one new fence per fix batch. Full pipeline: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test && npm pack --dry-run`.
- [ ] Commit executor/runner/main/test integration together with `fix: defer verification until mutation metadata is ready` only after the full pipeline passes.

### A3.6 — Native acceptance and release gate

- [ ] In the user's designated disposable desktop vault, create a Markdown source with two independent fixable broken links and one unrelated Markdown file. Start Fix All and immediately inspect the results. Both removals must save correctly; the second preflight must use the first removal's metadata, and final outcomes must be Fixed. Confirm ordinary text and surrounding source remain byte-for-byte unchanged except intended ranges.
- [ ] Edit the unrelated file while the first fix is running. Its `changed` or `resolved` must not release a source fence lacking the matching source content.
- [ ] Exercise trash for an empty Markdown file and an orphan attachment, confirming actual target removal and the correlated event sequence. If supported desktop versions do not emit the required deletion/resolved sequence, this task is BLOCKED pending an observed causal replacement contract. Do not publish an implementation that always times out for normal deletions.
- [ ] Trigger a metadata timeout in a development fixture. Report must say the change may already be saved, with verification phase failure; the remainder of this batch performs zero writes and zero preflight scans. Manually rescan and inspect saved contents before a new batch, which must still pass A2 conservative preflight checks.
- [ ] Unload the plugin while a fence is waiting. All fence listeners/timers must be removed and, when any already pending OS write completes, the in-flight verification must settle without proceeding to a new action. Do not claim that a pending OS write was canceled.
- [ ] Record Obsidian version, platform, exact fixture contents, event ordering, affected count, verification outcome, and post-operation file content. Unit tests alone do not satisfy this gate. Desktop unavailable = BLOCKED.
