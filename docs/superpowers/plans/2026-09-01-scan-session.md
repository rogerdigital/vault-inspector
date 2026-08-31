# Scan Session Implementation Plan (Milestone 3, Task 3.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple scan sessions from the report view. A new `src/scanner/scan-session.ts` owns the scan unit of work: `runScanSession(deps, settings, hooks?, trigger?)` clones settings, creates the scan profile, runs one scan through `runScanOperation` (startup hook → `deps.runner.run` with each progress event delivered through `try { hooks.onProgress?.(progress) } catch {}` so a failed progress consumer can never fail a completed scan → best-effort `onScanningChange(false)` cleanup only on failure), then `acceptScanResult(deps, hooks, result, scanProfile, trigger?)` computes the `LifecycleComparison` via `compareScanResult(result, deps.getSnapshot(), scanProfile)`, invokes `hooks.onResult` (errors propagate — an undisplayable result is an acceptance failure), builds the snapshot + one history entry, and persists through `deps.persistAccepted` (persistence errors are caught and returned as `persistWarning`, not thrown). The session returns `{ status: "completed"; result; comparison; persistWarning? } | { status: "failed"; message }`, never throws, and never touches `Notice` or any view — headless scans complete with NO hooks and no `InspectorView`. `src/main.ts` delegates: `performScanAndRender` calls `runScanSession` and translates outcomes into the two existing notices; the private `scan(view, settings)` becomes a thin adapter over `runScanOperation` (notice + `null` on failure) for the fix pipeline; `onFixAllIssues` calls the session's exported `acceptScanResult` under the batch's frozen profile. The serialized boundary (`enqueueOperation` / `operationQueue`) STAYS in `main.ts` — the session adds no second lock, so only one scan or mutation batch runs at a time, unchanged. Manual scans still open and update the report view: `runScan()`, `configureView`, and `scanAndRender`'s outcome clearing are untouched; main passes view-backed hooks (`onScanningChange: view.setScanning`, `onProgress: view.setScanProgress`, `onResult: view.setResult`). No scanner, fingerprint, `COMPARISON_VERSION`, snapshot/history shape, settings, or CLI change.

**Architecture:** Dependency injection keeps the session headless and testable: `ScanDeps` carries `app`, `runner`, `createProfile`, `toolVersion`, `getSnapshot`, `getHistory`, and `persistAccepted` — `main.ts`'s `scanDeps()` wires these to `this.scanRunner`, the `createScanProfile` import (the one `main.test.ts` already mocks), `this.manifest.version`, plugin state getters, and `this.persistPluginData` (which keeps owning the save queue, candidate isolation, and rollback). Three exports serve the three call sites: `runScanSession` (manual scans, future automatic scans), `runScanOperation` (fix preflight/verification — settings passed through UNCLONED because the fix batch owns freezing), and `acceptScanResult` (fix-batch verification acceptance). Today's hook call pattern is preserved exactly: `onScanningChange(true)` failures are startup failures, success never calls `onScanningChange(false)` (the manual path's `view.setResult` already clears scanning state), and profile-creation failure fires no hooks.

**Tech Stack:** TypeScript, Obsidian Plugin API (type-only in the session), Vitest

Design doc: `docs/superpowers/specs/2026-09-01-scan-session-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.3)

---

## Ground rules

- Branch: `feat/scan-session`, cut from latest `main`.
- One commit: `refactor: decouple scan sessions from report views`.
- The session never throws and never constructs a `Notice` — all human-facing notices stay in `src/main.ts`, byte-identical strings.
- Progress-consumer isolation applies ONLY to `onProgress`. `onScanningChange(true)` and `onResult` failures remain real failures (pinned by `main.test.ts` "reports one scan notice and recovers the operation queue when scan startup throws" and "recovers the scan queue after an unexpected acceptance error without duplicate notices").
- Best-effort cleanup (`onScanningChange(false)` in `try/catch`) runs only on failure paths — never on success — preserving today's exact `setScanning` call pattern so all 65 `main.test.ts` tests pass UNCHANGED.
- The serialized operation boundary stays in `main.ts` (`enqueueOperation` / `operationQueue`). The session must not enqueue, lock, or reorder anything.
- `runScanOperation` must NOT clone settings (the fix batch owns freezing); `runScanSession` MUST clone once and reuse the clone for profile creation and the runner.
- Deviation from the roadmap file list: `src/report/InspectorView.ts` is NOT modified (it already exposes `setScanning` / `setScanProgress` / `setResult` as plain methods; nothing view-side exists to change), and `src/tests/main.test.ts` is NOT modified (all 65 tests drive the plugin through public flows that the delegation preserves; running them unedited is the acceptance evidence). `src/tests/scan-session.test.ts` is the new focused suite.
- `src/scanner/scan-session.ts` may import Obsidian ONLY as a type (`import type { App }`). Never `eslint-disable` any `obsidianmd/*` rule.
- Do not modify `src/scanner/scanners/*`, `src/scanner/ScanRunner.ts`, `src/scanner/scan-profile.ts`, `src/snapshot/*`, `src/settings/*`, `src/fix/*`, `src/report/*`, `styles.css`, or `cli/*`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/scan-session
```

---

### Task 2: Write the failing session tests first (TDD)

**Files:**
- Create: `src/tests/scan-session.test.ts`

- [ ] **Step 1: Create `src/tests/scan-session.test.ts` in full**

```typescript
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "../settings/settings";
import type { Issue, ScanProgress, ScanResult } from "../scanner/Issue";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "../snapshot/scan-snapshot";
import type { ScanHistoryEntry } from "../snapshot/scan-history";
import {
	acceptScanResult,
	runScanOperation,
	runScanSession,
	type ScanDeps,
} from "../scanner/scan-session";

function makeSettings(): InspectorSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

function makeIssue(fingerprint: string): Issue {
	return {
		scannerId: "broken-links",
		severity: "warning",
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		primaryPath: `${fingerprint}.md`,
		relatedPaths: [],
		evidence: { target: fingerprint },
		fingerprint,
	};
}

function makeResult(issues: Issue[]): ScanResult {
	return {
		startedAt: 0,
		finishedAt: 1,
		issues,
		ignoredIssues: [],
		filesScanned: 1,
		scannersRun: ["broken-links", "empty-notes"],
	};
}

function makeBaseline(fingerprint = "previous"): ScanSnapshot {
	return createScanSnapshot(makeResult([makeIssue(fingerprint)]), "current-profile", "0.5.0", 100);
}

function makeProgress(): ScanProgress {
	return {
		type: "scanner-start",
		scannerId: "broken-links",
		scannerIndex: 1,
		scannerTotal: 2,
		elapsedMs: 0,
	};
}

function makeDeps(options: {
	run?: ScanDeps["runner"]["run"];
	snapshot?: ScanSnapshot | null;
} = {}) {
	const result = makeResult([makeIssue("current")]);
	const run = options.run ?? vi.fn(async () => result);
	const persistAccepted = vi.fn(async () => {});
	const createProfile = vi.fn(async () => "current-profile");
	let snapshot: ScanSnapshot | null = options.snapshot ?? null;
	let history: ScanHistoryEntry[] = [];
	const deps: ScanDeps = {
		app: {} as App,
		runner: { run },
		createProfile,
		toolVersion: "0.6.0",
		getSnapshot: () => snapshot,
		getHistory: () => history,
		persistAccepted,
	};
	return {
		deps,
		run,
		createProfile,
		persistAccepted,
		result,
		readHistory: () => history,
	};
}

describe("runScanSession", () => {
	it("clones settings once and reuses the clone for profile creation and scanning", async () => {
		const subject = makeDeps();
		const liveSettings = makeSettings();
		const initialThreshold = liveSettings.lowUsageTagThreshold;
		let profileSettings: InspectorSettings | undefined;
		let finishProfile!: () => void;
		const gate = new Promise<void>((resolve) => { finishProfile = resolve; });
		subject.createProfile.mockImplementationOnce(async (settings: InspectorSettings) => {
			profileSettings = settings;
			await gate;
			return "current-profile";
		});

		const session = runScanSession(subject.deps, liveSettings);
		await vi.waitFor(() => expect(profileSettings).toBeDefined());
		liveSettings.lowUsageTagThreshold = initialThreshold + 10;
		finishProfile();
		const outcome = await session;

		expect(outcome.status).toBe("completed");
		expect(profileSettings).not.toBe(liveSettings);
		expect(profileSettings?.lowUsageTagThreshold).toBe(initialThreshold);
		expect(subject.run.mock.calls[0][1]).toBe(profileSettings);
	});

	it("completes headless with no hooks and persists snapshot and history", async () => {
		const subject = makeDeps({ snapshot: makeBaseline() });

		const outcome = await runScanSession(subject.deps, makeSettings());

		expect(outcome.status).toBe("completed");
		if (outcome.status !== "completed") return;
		expect(outcome.result).toBe(subject.result);
		expect(outcome.comparison.statuses.get("current")).toBe("new");
		expect(outcome.persistWarning).toBeUndefined();
		expect(subject.persistAccepted).toHaveBeenCalledTimes(1);
		const accepted = subject.persistAccepted.mock.calls[0][0];
		expect(accepted.acceptedSnapshot.issues.map((issue) => issue.fingerprint))
			.toEqual(["current"]);
		expect(accepted.acceptedHistory).toHaveLength(1);
		expect(accepted.acceptedHistory[0]).toMatchObject({
			scanProfile: "current-profile",
			toolVersion: "0.6.0",
			trigger: "manual",
		});
	});

	it("propagates the trigger into the persisted history entry", async () => {
		const subject = makeDeps();

		await runScanSession(subject.deps, makeSettings(), {}, "automatic");

		const accepted = subject.persistAccepted.mock.calls[0][0];
		expect(accepted.acceptedHistory[0].trigger).toBe("automatic");
	});

	it("isolates a throwing progress consumer from the completed result", async () => {
		const result = makeResult([makeIssue("current")]);
		const run = vi.fn(async (
			_app: unknown,
			_settings: InspectorSettings,
			options?: { onProgress?: (progress: ScanProgress) => void },
		) => {
			options?.onProgress?.(makeProgress());
			options?.onProgress?.(makeProgress());
			return result;
		});
		const subject = makeDeps({ run });
		const onProgress = vi.fn(() => { throw new Error("render exploded"); });

		const outcome = await runScanSession(subject.deps, makeSettings(), { onProgress });

		expect(onProgress).toHaveBeenCalledTimes(2);
		expect(outcome.status).toBe("completed");
		expect(subject.persistAccepted).toHaveBeenCalledTimes(1);
	});

	it("returns failed without persisting when the runner rejects, with best-effort cleanup", async () => {
		const run = vi.fn(async () => {
			throw new Error("scanner exploded");
		});
		const subject = makeDeps({ run });
		const onScanningChange = vi.fn()
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => { throw new Error("cleanup unavailable"); });

		const outcome = await runScanSession(subject.deps, makeSettings(), { onScanningChange });

		expect(outcome).toEqual({ status: "failed", message: "scanner exploded" });
		expect(subject.persistAccepted).not.toHaveBeenCalled();
		expect(subject.readHistory()).toHaveLength(0);
		expect(onScanningChange).toHaveBeenCalledWith(false);
	});

	it("fails before any hook when profile creation rejects", async () => {
		const subject = makeDeps();
		subject.createProfile.mockRejectedValueOnce(new Error("hash unavailable"));
		const onScanningChange = vi.fn();

		const outcome = await runScanSession(subject.deps, makeSettings(), { onScanningChange });

		expect(outcome).toEqual({ status: "failed", message: "hash unavailable" });
		expect(onScanningChange).not.toHaveBeenCalled();
		expect(subject.run).not.toHaveBeenCalled();
		expect(subject.persistAccepted).not.toHaveBeenCalled();
	});

	it("propagates acceptance view failures without persisting, with best-effort cleanup", async () => {
		const subject = makeDeps();
		const onResult = vi.fn(() => { throw new Error("view unavailable"); });
		const onScanningChange = vi.fn();

		const outcome = await runScanSession(subject.deps, makeSettings(), {
			onResult,
			onScanningChange,
		});

		expect(outcome).toEqual({ status: "failed", message: "view unavailable" });
		expect(subject.persistAccepted).not.toHaveBeenCalled();
		expect(onScanningChange).toHaveBeenCalledWith(false);
	});

	it("keeps the completed result and reports a persist warning when persistence rejects", async () => {
		const subject = makeDeps({ snapshot: makeBaseline() });
		subject.persistAccepted.mockRejectedValueOnce(new Error("disk unavailable"));
		const onResult = vi.fn();

		const outcome = await runScanSession(subject.deps, makeSettings(), { onResult });

		expect(outcome.status).toBe("completed");
		if (outcome.status !== "completed") return;
		expect(outcome.persistWarning).toBe("disk unavailable");
		expect(outcome.comparison.statuses.get("current")).toBe("new");
		expect(onResult).toHaveBeenCalledTimes(1);
	});
});

describe("runScanOperation", () => {
	it("passes caller-provided settings through uncloned without acceptance", async () => {
		const subject = makeDeps();
		const frozenSettings = makeSettings();

		const outcome = await runScanOperation(subject.deps, frozenSettings);

		expect(outcome.status).toBe("completed");
		if (outcome.status !== "completed") return;
		expect(outcome.result).toBe(subject.result);
		expect(subject.run.mock.calls[0][1]).toBe(frozenSettings);
		expect(subject.createProfile).not.toHaveBeenCalled();
		expect(subject.persistAccepted).not.toHaveBeenCalled();
	});

	it("treats a throwing scanning-start hook as a startup failure", async () => {
		const subject = makeDeps();
		const onScanningChange = vi.fn(() => {
			throw new Error("scan view unavailable");
		});

		const outcome = await runScanOperation(subject.deps, makeSettings(), {
			onScanningChange,
		});

		expect(outcome).toEqual({ status: "failed", message: "scan view unavailable" });
		expect(subject.run).not.toHaveBeenCalled();
	});
});

describe("acceptScanResult", () => {
	it("accepts a given result under a given profile for fix verification", async () => {
		const subject = makeDeps({
			snapshot: createScanSnapshot(
				makeResult([makeIssue("previous")]),
				"fixed-profile",
				"0.5.0",
				100,
			),
		});
		const onResult = vi.fn();
		const result = makeResult([makeIssue("current")]);

		const accepted = await acceptScanResult(
			subject.deps,
			{ onResult },
			result,
			"fixed-profile",
		);

		expect(accepted.comparison.statuses.get("current")).toBe("new");
		expect(accepted.persistWarning).toBeUndefined();
		expect(onResult).toHaveBeenCalledWith(result, accepted.comparison);
		const persisted = subject.persistAccepted.mock.calls[0][0];
		expect(persisted.acceptedSnapshot.scanProfile).toBe("fixed-profile");
		expect(persisted.acceptedHistory[0].scanProfile).toBe("fixed-profile");
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/scan-session.test.ts
```

Expected: FAIL — `../scanner/scan-session` does not exist, so the suite fails to
resolve the import (that is the expected red).

---

### Task 3: Create `src/scanner/scan-session.ts`

**Files:**
- Create: `src/scanner/scan-session.ts`

- [ ] **Step 1: Create the file in full**

```typescript
import type { App } from "obsidian";
import type { InspectorSettings } from "../settings/settings";
import type {
	ScanProgress,
	ScanProgressCallback,
	ScanResult,
} from "./Issue";
import { compareScanResult, type LifecycleComparison } from "./result-diff";
import {
	appendScanHistoryEntry,
	createScanHistoryEntry,
	type ScanHistoryEntry,
	type ScanTrigger,
} from "../snapshot/scan-history";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "../snapshot/scan-snapshot";

/**
 * Headless-capable scan session. All view interaction is expressed as
 * optional hooks; all plugin state is injected as functions so persistence
 * ownership stays with the caller.
 */
export type ScanDeps = {
	app: App;
	runner: {
		run: (
			app: App,
			settings: InspectorSettings,
			options?: { onProgress?: ScanProgressCallback },
		) => Promise<ScanResult>;
	};
	createProfile: (settings: InspectorSettings) => Promise<string>;
	toolVersion: string;
	getSnapshot: () => ScanSnapshot | null;
	getHistory: () => ScanHistoryEntry[];
	persistAccepted: (accepted: {
		acceptedSnapshot: ScanSnapshot;
		acceptedHistory: ScanHistoryEntry[];
	}) => Promise<void>;
};

export type ScanSessionHooks = {
	onScanningChange?: (scanning: boolean) => void;
	onProgress?: (progress: ScanProgress) => void;
	onResult?: (result: ScanResult, comparison: LifecycleComparison) => void;
};

export type ScanSessionOutcome =
	| {
		status: "completed";
		result: ScanResult;
		comparison: LifecycleComparison;
		persistWarning?: string;
	}
	| { status: "failed"; message: string };

export type ScanOperationOutcome =
	| { status: "completed"; result: ScanResult }
	| { status: "failed"; message: string };

/**
 * Full scan session: clone settings, create the scan profile, run one scan,
 * then compare, accept, and persist successful results. Profile failures
 * fire no hooks; scanning failures and acceptance failures clean up the
 * scanning state best-effort. Never throws.
 */
export async function runScanSession(
	deps: ScanDeps,
	settings: InspectorSettings,
	hooks: ScanSessionHooks = {},
	trigger: ScanTrigger = "manual",
): Promise<ScanSessionOutcome> {
	let scanSettings: InspectorSettings;
	let scanProfile: string;
	try {
		scanSettings = structuredClone(settings);
		scanProfile = await deps.createProfile(scanSettings);
	} catch (error) {
		return { status: "failed", message: errorMessage(error) };
	}

	const operation = await runScanOperation(deps, scanSettings, hooks);
	if (operation.status === "failed") return operation;

	try {
		const accepted = await acceptScanResult(
			deps,
			hooks,
			operation.result,
			scanProfile,
			trigger,
		);
		return { status: "completed", result: operation.result, ...accepted };
	} catch (error) {
		stopScanningBestEffort(hooks);
		return { status: "failed", message: errorMessage(error) };
	}
}

/**
 * Scan-only operation for the verified fix pipeline. The caller owns settings
 * freezing and profile creation; the given settings are passed through
 * uncloned and no acceptance happens here. Never throws.
 */
export async function runScanOperation(
	deps: ScanDeps,
	settings: InspectorSettings,
	hooks: ScanSessionHooks = {},
): Promise<ScanOperationOutcome> {
	try {
		hooks.onScanningChange?.(true);
		const result = await deps.runner.run(deps.app, settings, {
			onProgress: (progress) => {
				try {
					hooks.onProgress?.(progress);
				} catch {
					// A failed progress consumer must not fail the scan.
				}
			},
		});
		return { status: "completed", result };
	} catch (error) {
		stopScanningBestEffort(hooks);
		return { status: "failed", message: errorMessage(error) };
	}
}

/**
 * Compares, displays (via the optional onResult hook), and persists one
 * successful result. onResult errors propagate (an undisplayable result is
 * an acceptance failure); persistence errors are returned as persistWarning.
 */
export async function acceptScanResult(
	deps: ScanDeps,
	hooks: ScanSessionHooks,
	result: ScanResult,
	scanProfile: string,
	trigger: ScanTrigger = "manual",
): Promise<{ comparison: LifecycleComparison; persistWarning?: string }> {
	const comparison = compareScanResult(result, deps.getSnapshot(), scanProfile);
	hooks.onResult?.(result, comparison);

	const nextSnapshot = createScanSnapshot(result, scanProfile, deps.toolVersion);
	const nextHistory = appendScanHistoryEntry(
		deps.getHistory(),
		createScanHistoryEntry({
			result,
			comparison,
			scanProfile,
			toolVersion: deps.toolVersion,
			trigger,
		}),
	);
	try {
		await deps.persistAccepted({
			acceptedSnapshot: nextSnapshot,
			acceptedHistory: nextHistory,
		});
	} catch (error) {
		return { comparison, persistWarning: errorMessage(error) };
	}
	return { comparison };
}

function stopScanningBestEffort(hooks: ScanSessionHooks): void {
	try {
		hooks.onScanningChange?.(false);
	} catch {
		// Preserve the original scan outcome when view cleanup is unavailable.
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 2: Run the session tests**

```bash
npm test -- src/tests/scan-session.test.ts
```

Expected: PASS. (`ScanRunner.run` satisfies the structural `runner` type —
same `App`, `InspectorSettings`, and `{ onProgress?: ScanProgressCallback }`
options shape.)

---

### Task 4: Delegate from `src/main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update the imports**

Replace (lines 26–34):

```typescript
import {
	appendScanHistoryEntry,
	createScanHistoryEntry,
	type ScanHistoryEntry,
	type ScanTrigger,
} from "./snapshot/scan-history";
import { createScanProfile } from "./scanner/scan-profile";
import { compareScanResult } from "./scanner/result-diff";
import type { ScanResult } from "./scanner/Issue";
```

with:

```typescript
import type { ScanHistoryEntry } from "./snapshot/scan-history";
import { createScanProfile } from "./scanner/scan-profile";
import {
	acceptScanResult,
	runScanOperation,
	runScanSession,
	type ScanDeps,
	type ScanSessionHooks,
} from "./scanner/scan-session";
```

(`import { SCANNER_LABELS } from "./scanner/Issue";` on line 35 and the
`ScanSnapshot` import stay.)

- [ ] **Step 2: Replace the fix-batch acceptance block**

In `onFixAllIssues` (lines 232–245), replace:

```typescript
					let acceptanceFailed = false;
					let acceptanceError: unknown;
					if (batch.verificationResult) {
						try {
							await this.acceptScanResult(
								view,
								batch.verificationResult,
								scanProfile,
							);
						} catch (error) {
							acceptanceFailed = true;
							acceptanceError = error;
						}
					}
```

with:

```typescript
					let acceptanceFailed = false;
					let acceptanceError: unknown;
					if (batch.verificationResult) {
						try {
							const accepted = await acceptScanResult(
								this.scanDeps(),
								this.viewHooks(view),
								batch.verificationResult,
								scanProfile,
							);
							if (accepted.persistWarning) {
								new Notice(
									`Scan completed, but the comparison snapshot could not be saved: ${accepted.persistWarning}`,
								);
							}
						} catch (error) {
							acceptanceFailed = true;
							acceptanceError = error;
						}
					}
```

- [ ] **Step 3: Simplify `scanAndRender`**

Replace (lines 339–344):

```typescript
	private scanAndRender(view: InspectorView): Promise<void> {
		return this.enqueueOperation(async () => {
			view.setOperationOutcomes([]);
			await this.performScanAndRenderHandled(view);
		});
	}
```

with:

```typescript
	private scanAndRender(view: InspectorView): Promise<void> {
		return this.enqueueOperation(async () => {
			view.setOperationOutcomes([]);
			await this.performScanAndRender(view);
		});
	}
```

- [ ] **Step 4: Replace the orchestration block with session delegation**

Replace the whole block from `performScanAndRenderHandled` through
`stopScanningBestEffort` (lines 346–437):

```typescript
	private async performScanAndRenderHandled(view: InspectorView): Promise<void> {
		try {
			await this.performScanAndRender(view);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Vault Inspector scan failed: ${message}`);
		}
	}

	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const run = this.operationQueue
			.catch(() => undefined)
			.then(operation);
		this.operationQueue = run.catch(() => undefined);
		return run;
	}

	private async performScanAndRender(view: InspectorView) {
		const scanSettings = structuredClone(this.settings);
		const scanProfile = await createScanProfile(scanSettings);
		try {
			const result = await this.scan(view, scanSettings);
			if (!result) return;
			await this.acceptScanResult(view, result, scanProfile);
		} catch (error) {
			this.stopScanningBestEffort(view);
			throw error;
		}
	}

	private async acceptScanResult(
		view: InspectorView,
		result: ScanResult,
		scanProfile: string,
		trigger: ScanTrigger = "manual",
	) {
		const comparison = compareScanResult(
			result,
			this.lastSuccessfulSnapshot,
			scanProfile,
		);
		view.setResult(result, comparison);

		const nextSnapshot = createScanSnapshot(
			result,
			scanProfile,
			this.manifest.version,
		);
		const nextHistory = appendScanHistoryEntry(
			this.scanHistory,
			createScanHistoryEntry({
				result,
				comparison,
				scanProfile,
				toolVersion: this.manifest.version,
				trigger,
			}),
		);
		try {
			await this.persistPluginData({
				acceptedSnapshot: nextSnapshot,
				acceptedHistory: nextHistory,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(
				`Scan completed, but the comparison snapshot could not be saved: ${message}`,
			);
		}
	}

	private async scan(view: InspectorView, settings: InspectorSettings) {
		try {
			view.setScanning(true);
			return await this.scanRunner.run(this.app, settings, {
				onProgress: (progress) => view.setScanProgress(progress),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Vault Inspector scan failed: ${message}`);
			this.stopScanningBestEffort(view);
			return null;
		}
	}

	private stopScanningBestEffort(view: InspectorView) {
		try {
			view.setScanning(false);
		} catch {
			// Preserve the original scan outcome when view cleanup is unavailable.
		}
	}
```

with:

```typescript
	private async performScanAndRender(view: InspectorView) {
		const outcome = await runScanSession(
			this.scanDeps(),
			this.settings,
			this.viewHooks(view),
		);
		if (outcome.status === "failed") {
			new Notice(`Vault Inspector scan failed: ${outcome.message}`);
			return;
		}
		if (outcome.persistWarning) {
			new Notice(
				`Scan completed, but the comparison snapshot could not be saved: ${outcome.persistWarning}`,
			);
		}
	}

	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const run = this.operationQueue
			.catch(() => undefined)
			.then(operation);
		this.operationQueue = run.catch(() => undefined);
		return run;
	}

	private scanDeps(): ScanDeps {
		return {
			app: this.app,
			runner: this.scanRunner,
			createProfile: createScanProfile,
			toolVersion: this.manifest.version,
			getSnapshot: () => this.lastSuccessfulSnapshot,
			getHistory: () => this.scanHistory,
			persistAccepted: (accepted) => this.persistPluginData(accepted),
		};
	}

	private viewHooks(view: InspectorView): ScanSessionHooks {
		return {
			onScanningChange: (scanning) => view.setScanning(scanning),
			onProgress: (progress) => view.setScanProgress(progress),
			onResult: (result, comparison) => view.setResult(result, comparison),
		};
	}

	private async scan(view: InspectorView, settings: InspectorSettings) {
		const outcome = await runScanOperation(
			this.scanDeps(),
			settings,
			this.viewHooks(view),
		);
		if (outcome.status === "failed") {
			new Notice(`Vault Inspector scan failed: ${outcome.message}`);
			return null;
		}
		return outcome.result;
	}
```

- [ ] **Step 5: Update the remaining `performScanAndRenderHandled` call sites**

Replace every remaining occurrence of:

```typescript
await this.performScanAndRenderHandled(view);
```

with:

```typescript
await this.performScanAndRender(view);
```

(4 occurrences inside `configureView`: `onIgnoreAllIssues`, `onRestoreIssues`,
`onIgnoreIssue`, `onExcludeFolder` — lines 178, 208, 290, 319.)

- [ ] **Step 6: Run the focused suites**

```bash
npm test -- src/tests/scan-session.test.ts src/tests/main.test.ts
```

Expected: PASS — all 65 `main.test.ts` tests unchanged and green, plus the new
session suite. If any main test fails, STOP: the delegation changed behavior;
fix the delegation, never the pinned test.

---

### Task 5: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/scan-session.test.ts src/tests/main.test.ts
```

Expected: PASS — manual behavior remains unchanged and successful headless
scans update persistence through the same acceptance path.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings, build regenerates usable
`main.js` and `cli.js`, full suite green.

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/scan-session.ts`, `src/main.ts`, and
`src/tests/scan-session.test.ts`. NOT `src/report/*`, `src/scanner/scanners/*`,
`src/scanner/ScanRunner.ts`, `src/scanner/scan-profile.ts`, `src/snapshot/*`,
`src/settings/*`, `src/fix/*`, `src/tests/main.test.ts`, `styles.css`, or
`cli/*`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/scan-session.ts src/main.ts src/tests/scan-session.test.ts
git commit -m "refactor: decouple scan sessions from report views"
git push -u origin feat/scan-session
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `refactor: decouple scan sessions from report views`, covering: new
  `src/scanner/scan-session.ts` (`runScanSession` / `runScanOperation` /
  `acceptScanResult` + `ScanDeps`/`ScanSessionHooks`/outcome types) owns
  settings cloning, profile creation, scanning, comparison, acceptance, and
  snapshot+history persistence, returning outcome objects without requiring an
  open `InspectorView`; `src/main.ts` delegates through `scanDeps()` /
  `viewHooks()` and keeps the serialized `enqueueOperation` boundary and all
  notices; each progress event is delivered to the optional consumer inside
  `try/catch` so a failed progress consumer cannot fail a completed scan;
  fix-batch preflight/verification reuse `runScanOperation` (settings frozen
  by the batch) and accept through the same exported `acceptScanResult`;
  manual scans still open and update the report view via the same hooks;
  deviations documented (`InspectorView.ts` and `main.test.ts` unmodified,
  with evidence); no scanner, fingerprint, `COMPARISON_VERSION`, snapshot,
  history, settings, or CLI change. Include the roadmap PR-description items:
  focused tests run, full verification results, non-goals, compatibility
  impact, and remaining boundaries.

## Self-review checklist (completed during plan writing)

- Roadmap Task 3.3 responsibility ↔ implementation mapping: clone settings and create the scan profile ✓ (Task 3 `runScanSession`: one `structuredClone` reused by `createProfile` and `runner.run`, pinned by the clone test and `main.test.ts` "uses one immutable settings snapshot for profile creation and scanning"); run one scan through the existing serialized operation boundary ✓ (Task 4 keeps `enqueueOperation`/`operationQueue` in `main.ts`; the session is enqueued through it — pinned unchanged by "serializes complete scan flows through snapshot persistence" and "keeps a manual scan queued until fix preflight and verification finish"); publish optional progress events ✓ (Task 3 `ScanSessionHooks.onProgress`, wrapped per-event in `try/catch`); compare and accept successful results ✓ (Task 3 `acceptScanResult`: `compareScanResult` → `onResult` → snapshot + history → persist); persist snapshot and summary history ✓ (same `createScanSnapshot` + `appendScanHistoryEntry(createScanHistoryEntry(…))` payloads moved verbatim from `main.ts` lines 389–403); return a result without requiring an open `InspectorView` ✓ (outcome objects; no `Notice`, no view reference; headless test passes NO hooks).
- Roadmap required behavior mapping: manual scans still open and update the report view ✓ (`runScan`, `configureView`, `scanAndRender`'s outcome clearing untouched; `viewHooks` wires `setScanning`/`setScanProgress`/`setResult`); headless scans complete without a view ✓ ("completes headless with no hooks and persists snapshot and history"); only one scan or mutation batch at a time ✓ (single `operationQueue` unchanged; the session holds no lock); a failed progress consumer cannot convert a completed scan into a failed detection result ✓ ("isolates a throwing progress consumer from the completed result" — runner's `onProgress` wrapper swallows consumer throws).
- Behavior-preservation audit against `main.test.ts` (all 65 unedited): profile failure fires no hooks and skips cleanup ("does not start scanning when the detection profile cannot be created" — profile `try` is separate from the scanning `try`, matching `main.ts` lines 364–365 sitting outside the scanning `try`); startup `setScanning(true)` throw is a failed operation with best-effort `setScanning(false)` ("reports one scan notice and recovers the operation queue when scan startup throws", "keeps a skipped preflight outcome when every fix scan startup fails"); runner rejection → notice + no persistence + no history ("leaves the accepted baseline untouched when scanning fails", "appends one history entry per accepted scan and none for failed scans"); `setResult` throw → failed outcome, cleanup throw swallowed, snapshot untouched ("recovers the scan queue after an unexpected acceptance error without duplicate notices"); persist rejection → `persistWarning` → the exact "Scan completed, but the comparison snapshot could not be saved:" notice, result stays visible, baseline rolled back by `persistPluginData` ("keeps a completed result visible, rolls back a failed snapshot save, and recovers", "keeps the durable baseline correct when scan saves resolve as …"); fix path: `scan(view, batchSettings)` keeps notice+`null` semantics and passes batch settings through uncloned ("awaits one fixed profile and clones its settings for every fix scan" — cloning is the fix batch's existing job), acceptance errors still rethrow after outcome publication ("publishes exact fix outcomes before rethrowing an acceptance failure", "preserves the acceptance error when outcome publication also throws"); success path never calls `setScanning(false)` because `view.setResult` clears scanning state (pinned by the view model assertions in main.test.ts lines 126–131).
- Verified against real code: `ScanRunner.run` signature (`ScanRunner.ts` line 39) matches the structural `runner.run` type including `RunOptions.onProgress?: ScanProgressCallback`; `persistPluginData` options (`main.ts` lines 108–112) accept exactly `{ acceptedSnapshot, acceptedHistory }`; `createScanHistoryEntry` input shape (`scan-history.ts` lines 38–45) copied verbatim; `compareScanResult(result, snapshot, profile)` argument order (`result-diff.ts`); `ScanProgress` fields match `emitProgress` in `ScanRunner.ts` lines 93–101 (`message` optional); `main.test.ts` mocks `vi.mock("../scanner/scan-profile")` and passes `createScanProfile` from `main.ts` via `scanDeps()`, so the existing mock keeps intercepting profile creation; `makeScanSubject` replaces `(plugin as any).scanRunner = { run }` and `scanDeps` reads `this.scanRunner` at call time, so the stub flows through; the private `acceptScanResult` method is deleted with no direct test references (all fix-flow tests go through `callbacks.onFixAllIssues`).
- No placeholders: Task 3 is a complete file; Task 2 is a complete test file; Tasks 4 quotes exact current `main.ts` code before every replacement with line anchors.
- Type/name consistency: `ScanDeps`/`ScanSessionHooks`/`ScanSessionOutcome`/`ScanOperationOutcome` exported and imported as types from `./scanner/scan-session` (relative from `src/main.ts`); `acceptScanResult` export does not collide (the old private method is removed in the same task); `ScanTrigger`/`ScanHistoryEntry`/`ScanSnapshot` imported as types only where used.
- obsidianmd lint constraints: `scan-session.ts` uses `import type { App } from "obsidian"` only — no runtime Obsidian API, no DOM globals, no `innerHTML`; notices stay in `main.ts`.
- Precision-suite/CLI impact: none — `src/tests/scanner-precision.test.ts` observes scanners (untouched); `cli/` and all stable CLI fields untouched; fingerprints, `COMPARISON_VERSION`, snapshot/history shapes unchanged.
