import { describe, expect, it, vi, type Mock } from "vitest";
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
	const run = options.run ?? vi.fn(async (
		_app: App,
		_settings: InspectorSettings,
		_options?: { onProgress?: (progress: ScanProgress) => void },
	): Promise<ScanResult> => result);
	const persistAccepted = vi.fn(async (_accepted: {
		acceptedSnapshot: ScanSnapshot;
		acceptedHistory: ScanHistoryEntry[];
	}): Promise<void> => {});
	const createProfile = vi.fn(async (_settings: InspectorSettings): Promise<string> => "current-profile");
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
		run: run as unknown as Mock,
		createProfile: createProfile as unknown as Mock,
		persistAccepted: persistAccepted as unknown as Mock,
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
		expect(accepted.acceptedSnapshot.issues.map((issue: Issue) => issue.fingerprint))
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
