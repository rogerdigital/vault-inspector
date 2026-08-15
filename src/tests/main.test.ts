import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultInspectorPlugin, { migrateExcalidrawFrontmatterKey } from "../main";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { InspectorSettings } from "../settings/settings";
import { InspectorView } from "../report/InspectorView";
import type { FixAction, Issue, ScanResult } from "../scanner/Issue";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "../snapshot/scan-snapshot";
import type { LifecycleComparison } from "../scanner/result-diff";
import {
	getUtf8ByteLength,
	MAX_SAFE_VAULT_REPORT_BYTES,
} from "../report/report-export";
import { generateMarkdownReport } from "../report/markdown-export";

const {
	createScanProfileMock,
	executeFixActionMock,
	noticeMessages,
	openPluginSettingsMock,
	showConfirmModalMock,
	showLargeReportWarningModalMock,
} = vi.hoisted(() => ({
	createScanProfileMock: vi.fn(),
	executeFixActionMock: vi.fn(),
	noticeMessages: [] as string[],
	openPluginSettingsMock: vi.fn(),
	showConfirmModalMock: vi.fn(),
	showLargeReportWarningModalMock: vi.fn(),
}));

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
		Notice: class {
			constructor(message: string) {
				noticeMessages.push(message);
			}
		},
	};
});

vi.mock("../fix/fix-executor", () => ({
	executeFixAction: executeFixActionMock,
}));

vi.mock("../fix/confirm-modal", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../fix/confirm-modal")>();
	return { ...actual, showConfirmModal: showConfirmModalMock };
});

vi.mock("../report/export-warning-modal", () => ({
	showLargeReportWarningModal: showLargeReportWarningModalMock,
}));

vi.mock("../scanner/scan-profile", () => ({
	createScanProfile: createScanProfileMock,
}));

vi.mock("../utils/open-plugin-settings", () => ({
	openPluginSettings: openPluginSettingsMock,
}));

function makeFixIssue(fingerprint: string, fixAction: FixAction): Issue {
	return {
		scannerId: fixAction.kind === "remove-link-text" ? "broken-links" : "empty-notes",
		severity: "warning",
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		primaryPath: fixAction.targetPaths[0],
		relatedPaths: [],
		evidence: {},
		fingerprint,
		fixAction,
	};
}

function makeScanResult(issues: Issue[]): ScanResult {
	return {
		startedAt: 0,
		finishedAt: 1,
		issues,
		ignoredIssues: [],
		filesScanned: 1,
		scannersRun: ["broken-links", "empty-notes"],
	};
}

describe("VaultInspectorPlugin", () => {
	beforeEach(() => {
		createScanProfileMock.mockReset();
		createScanProfileMock.mockResolvedValue("current-profile");
		executeFixActionMock.mockReset();
		showConfirmModalMock.mockReset();
		showLargeReportWarningModalMock.mockReset();
		openPluginSettingsMock.mockReset();
		noticeMessages.length = 0;
	});

	it("initializes lifecycle comparison as unavailable and stores comparison with results", () => {
		const view = new InspectorView({ app: {} } as any);
		const result = makeScanResult([]);
		const comparison: LifecycleComparison = {
			available: true,
			statuses: new Map([["current", "new"]]),
			resolvedIssues: [],
		};

		expect((view as any).model.comparison).toEqual({
			available: false,
			reason: "first-scan",
			statuses: new Map(),
			resolvedIssues: [],
		});

		(view as any).render = vi.fn();
		(view as any).stopScanTimer = vi.fn();
		view.setResult(result, comparison);

		expect((view as any).model.result).toBe(result);
		expect((view as any).model.comparison).toBe(comparison);
		expect((view as any).model.isScanning).toBe(false);
		expect((view as any).model.selectedFingerprints).toEqual(new Set());
		expect((view as any).model.ignoredSelectedFingerprints).toEqual(new Set());
	});

	it("accepts and persists a first completed scan without lifecycle statuses", async () => {
		const current = makeLifecycleIssue("current");
		const result = makeScanResult([current]);
		const { plugin, run, saveData, view } = makeScanSubject(result);

		await (plugin as any).scanAndRender(view);

		expect(run).toHaveBeenCalledTimes(1);
		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: false,
			reason: "first-scan",
			statuses: new Map(),
			resolvedIssues: [],
		});
		expect(plugin.lastSuccessfulSnapshot).toMatchObject({
			toolVersion: "0.5.0",
			scanProfile: "current-profile",
			issues: [{ fingerprint: "current", ignored: false }],
		});
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
			lastSuccessfulSnapshot: plugin.lastSuccessfulSnapshot,
		});
	});

	it("clears old operation outcomes when an ordinary queued scan starts", async () => {
		const { plugin, run, view } = makeScanSubject(makeScanResult([]));

		await (plugin as any).scanAndRender(view);

		expect(run).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([]);
	});

	it("compares against a compatible snapshot and replaces the accepted baseline", async () => {
		const persisting = makeLifecycleIssue("persisting");
		const resolved = makeLifecycleIssue("resolved");
		const added = makeLifecycleIssue("new");
		const result = makeScanResult([persisting, added]);
		const { plugin, view } = makeScanSubject(result);
		const previous = createScanSnapshot(
			makeScanResult([persisting, resolved]),
			"current-profile",
			"0.4.13",
			100,
		);
		plugin.lastSuccessfulSnapshot = previous;

		await (plugin as any).scanAndRender(view);

		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: true,
			statuses: new Map([
				["persisting", "persisting"],
				["new", "new"],
			]),
			resolvedIssues: [expect.objectContaining({ fingerprint: "resolved" })],
		});
		expect(plugin.lastSuccessfulSnapshot).not.toBe(previous);
		expect(plugin.lastSuccessfulSnapshot?.issues.map((issue) => issue.fingerprint))
			.toEqual(["persisting", "new"]);
	});

	it("does not label findings new when detection settings changed", async () => {
		const result = makeScanResult([makeLifecycleIssue("current")]);
		const { plugin, view } = makeScanSubject(result);
		plugin.lastSuccessfulSnapshot = createScanSnapshot(
			makeScanResult([makeLifecycleIssue("previous")]),
			"previous-profile",
			"0.4.13",
			100,
		);

		await (plugin as any).scanAndRender(view);

		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: false,
			reason: "settings-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});
		expect(plugin.lastSuccessfulSnapshot?.scanProfile).toBe("current-profile");
	});

	it("reports incompatible stored comparison semantics before replacing the baseline", async () => {
		const result = makeScanResult([makeLifecycleIssue("current")]);
		const { plugin, view } = makeScanSubject(result);
		const previous = createScanSnapshot(result, "current-profile", "0.4.13", 100);
		previous.comparisonVersion++;
		plugin.lastSuccessfulSnapshot = previous;

		await (plugin as any).scanAndRender(view);

		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: false,
			reason: "semantics-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});
		expect(plugin.lastSuccessfulSnapshot?.comparisonVersion).not.toBe(
			previous.comparisonVersion,
		);
	});

	it("leaves the accepted baseline untouched when scanning fails", async () => {
		const { plugin, run, saveData, view } = makeScanSubject(makeScanResult([]));
		const previous = makeSnapshot("current-profile");
		plugin.lastSuccessfulSnapshot = previous;
		run.mockRejectedValueOnce(new Error("scanner exploded"));

		await (plugin as any).scanAndRender(view);

		expect(plugin.lastSuccessfulSnapshot).toBe(previous);
		expect(plugin.lastSuccessfulSnapshot).toEqual(previous);
		expect(saveData).not.toHaveBeenCalled();
		expect(view.setResult).not.toHaveBeenCalled();
		expect(noticeMessages).toContain("Vault Inspector scan failed: scanner exploded");
	});

	it("reports one scan notice and recovers the operation queue when scan startup throws", async () => {
		const result = makeScanResult([makeLifecycleIssue("recovered")]);
		const { plugin, run, view } = makeScanSubject(result);
		view.setScanning.mockImplementationOnce(() => {
			throw new Error("scan view unavailable");
		});

		await (plugin as any).scanAndRender(view);
		await (plugin as any).scanAndRender(view);

		expect(run).toHaveBeenCalledOnce();
		expect(view.setResult).toHaveBeenCalledOnce();
		expect(noticeMessages.filter(
			(message) => message === "Vault Inspector scan failed: scan view unavailable",
		)).toHaveLength(1);
	});

	it("keeps a completed result visible, rolls back a failed snapshot save, and recovers", async () => {
		const current = makeLifecycleIssue("current");
		const result = makeScanResult([current]);
		const { plugin, saveData, view } = makeScanSubject(result);
		const previous = createScanSnapshot(
			makeScanResult([makeLifecycleIssue("previous")]),
			"current-profile",
			"0.4.13",
			100,
		);
		plugin.lastSuccessfulSnapshot = previous;
		saveData
			.mockRejectedValueOnce(new Error("disk unavailable"))
			.mockResolvedValueOnce(undefined);

		await expect((plugin as any).scanAndRender(view)).resolves.toBeUndefined();

		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: true,
			statuses: new Map([["current", "new"]]),
			resolvedIssues: [expect.objectContaining({ fingerprint: "previous" })],
		});
		expect(plugin.lastSuccessfulSnapshot).toBe(previous);
		expect(noticeMessages).toContain(
			"Scan completed, but the comparison snapshot could not be saved: disk unavailable",
		);
		expect(noticeMessages.some((message) => message.startsWith("Vault Inspector scan failed:")))
			.toBe(false);

		await expect((plugin as any).scanAndRender(view)).resolves.toBeUndefined();

		expect(saveData).toHaveBeenCalledTimes(2);
		expect(plugin.lastSuccessfulSnapshot).not.toBe(previous);
		expect(plugin.lastSuccessfulSnapshot?.issues.map((issue) => issue.fingerprint))
			.toEqual(["current"]);
		expect((saveData as ReturnType<typeof vi.fn>).mock.calls[1][0])
			.toMatchObject({
				lastSuccessfulSnapshot: {
					scanProfile: "current-profile",
					issues: [{ fingerprint: "current" }],
				},
			});
	});

	it("does not start scanning when the detection profile cannot be created", async () => {
		const { plugin, run, saveData, view } = makeScanSubject(makeScanResult([]));
		const previous = makeSnapshot("current-profile");
		plugin.lastSuccessfulSnapshot = previous;
		createScanProfileMock.mockRejectedValueOnce(new Error("hash unavailable"));

		await expect((plugin as any).scanAndRender(view)).resolves.toBeUndefined();

		expect(run).not.toHaveBeenCalled();
		expect(plugin.lastSuccessfulSnapshot).toBe(previous);
		expect(saveData).not.toHaveBeenCalled();
		expect(view.setResult).not.toHaveBeenCalled();
		expect(view.setScanning).not.toHaveBeenCalled();
		expect(noticeMessages).toContain("Vault Inspector scan failed: hash unavailable");
	});

	it("serializes complete scan flows through snapshot persistence", async () => {
		const resultA = makeScanResult([makeLifecycleIssue("a")]);
		const resultB = makeScanResult([
			makeLifecycleIssue("a"),
			makeLifecycleIssue("b"),
		]);
		const { plugin, run, view } = makeScanSubject(resultA);
		let finishFirstScan!: (result: ScanResult) => void;
		const firstScan = new Promise<ScanResult>((resolve) => { finishFirstScan = resolve; });
		run.mockReset()
			.mockImplementationOnce(() => firstScan)
			.mockResolvedValueOnce(resultB);

		const first = (plugin as any).scanAndRender(view);
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		const second = (plugin as any).scanAndRender(view);
		await flushMicrotasks();

		expect(run).toHaveBeenCalledTimes(1);
		finishFirstScan(resultA);
		await first;
		await second;

		expect(run).toHaveBeenCalledTimes(2);
		expect(plugin.lastSuccessfulSnapshot?.issues.map((issue) => issue.fingerprint))
			.toEqual(["a", "b"]);
	});

	it("uses one immutable settings snapshot for profile creation and scanning", async () => {
		const result = makeScanResult([makeLifecycleIssue("current")]);
		const { plugin, run, view } = makeScanSubject(result);
		const initialThreshold = plugin.settings.lowUsageTagThreshold;
		let profileSettings: InspectorSettings | undefined;
		let finishProfile!: () => void;
		const profileGate = new Promise<void>((resolve) => { finishProfile = resolve; });
		createScanProfileMock.mockImplementationOnce(async (settings: InspectorSettings) => {
			profileSettings = settings;
			await profileGate;
			return `threshold:${settings.lowUsageTagThreshold}`;
		});

		const scan = (plugin as any).scanAndRender(view);
		await vi.waitFor(() => expect(createScanProfileMock).toHaveBeenCalledTimes(1));
		plugin.settings.lowUsageTagThreshold = initialThreshold + 10;
		finishProfile();
		await scan;

		expect(profileSettings).not.toBe(plugin.settings);
		expect(profileSettings?.lowUsageTagThreshold).toBe(initialThreshold);
		expect(run.mock.calls[0][1]).toBe(profileSettings);
		expect(plugin.lastSuccessfulSnapshot?.scanProfile)
			.toBe(`threshold:${initialThreshold}`);
	});

	it("awaits one fixed profile and clones its settings for every fix scan", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("current", action);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		const initialThreshold = plugin.settings.lowUsageTagThreshold;
		let profileSettings: InspectorSettings | undefined;
		let finishProfile!: () => void;
		const profileGate = new Promise<void>((resolve) => { finishProfile = resolve; });
		createScanProfileMock.mockImplementationOnce(async (settings: InspectorSettings) => {
			profileSettings = settings;
			await profileGate;
			return "fixed-profile";
		});
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([issue]))
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([{ fingerprint: issue.fingerprint }]);
		executeFixActionMock.mockResolvedValue(1);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		const fixing = callbacks.onFixAllIssues([issue]);
		await vi.waitFor(() => expect(createScanProfileMock).toHaveBeenCalledOnce());
		expect(run).not.toHaveBeenCalled();
		plugin.settings.lowUsageTagThreshold = initialThreshold + 10;
		finishProfile();
		await fixing;

		expect(profileSettings).not.toBe(plugin.settings);
		expect(profileSettings?.lowUsageTagThreshold).toBe(initialThreshold);
		expect(run).toHaveBeenCalledTimes(2);
		const scanSettings = run.mock.calls.map((call) => call[1] as InspectorSettings);
		expect(scanSettings[0]).not.toBe(profileSettings);
		expect(scanSettings[1]).not.toBe(profileSettings);
		expect(scanSettings[0]).not.toBe(scanSettings[1]);
		expect(scanSettings.map((settings) => settings.lowUsageTagThreshold))
			.toEqual([initialThreshold, initialThreshold]);
		expect(view.setResult).toHaveBeenCalledWith(finalResult, expect.any(Object));
		expect(plugin.lastSuccessfulSnapshot?.scanProfile).toBe("fixed-profile");
	});

	it.each([
		{ firstFails: false, secondFails: false, expected: ["a", "b"] },
		{ firstFails: true, secondFails: false, expected: ["a", "b"] },
		{ firstFails: false, secondFails: true, expected: ["a"] },
		{ firstFails: true, secondFails: true, expected: ["baseline"] },
	])(
		"keeps the durable baseline correct when scan saves resolve as $firstFails/$secondFails",
		async ({ firstFails, secondFails, expected }) => {
			const baseline = createScanSnapshot(
				makeScanResult([makeLifecycleIssue("baseline")]),
				"current-profile",
				"0.4.13",
				100,
			);
			const resultA = makeScanResult([makeLifecycleIssue("a")]);
			const resultB = makeScanResult([
				makeLifecycleIssue("a"),
				makeLifecycleIssue("b"),
			]);
			const { plugin, run, saveData, view } = makeScanSubject(resultA);
			plugin.lastSuccessfulSnapshot = baseline;
			run.mockReset()
				.mockResolvedValueOnce(resultA)
				.mockResolvedValueOnce(resultB);
			let releaseFirstSave!: () => void;
			const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
			saveData.mockReset().mockImplementation(async () => {
				const call = saveData.mock.calls.length;
				if (call === 1) {
					await firstSaveGate;
					if (firstFails) throw new Error("first save failed");
				} else if (secondFails) {
					throw new Error("second save failed");
				}
			});

			const first = (plugin as any).scanAndRender(view);
			await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
			const second = (plugin as any).scanAndRender(view);
			await flushMicrotasks();
			releaseFirstSave();
			await Promise.all([first, second]);

			expect(saveData).toHaveBeenCalledTimes(2);
			const saveCalls = (saveData as ReturnType<typeof vi.fn>).mock.calls;
			expect(snapshotFingerprints(saveCalls[0][0])).toEqual(["a"]);
			expect(snapshotFingerprints(saveCalls[1][0])).toEqual(["a", "b"]);
			expect(plugin.lastSuccessfulSnapshot?.issues.map((issue) => issue.fingerprint))
				.toEqual(expected);
			const secondComparison = view.setResult.mock.calls[1][1] as LifecycleComparison;
			expect(secondComparison.statuses.get("a"))
				.toBe(firstFails ? "new" : "persisting");
		},
	);

	it("persists each accepted candidate instead of reading a later global candidate", async () => {
		const resultA = makeScanResult([makeLifecycleIssue("a")]);
		const resultB = makeScanResult([makeLifecycleIssue("b")]);
		const { plugin, run, saveData, view } = makeScanSubject(resultA);
		plugin.lastSuccessfulSnapshot = makeSnapshot("current-profile");
		run.mockReset()
			.mockResolvedValueOnce(resultA)
			.mockResolvedValueOnce(resultB);
		let releaseBlockingSave!: () => void;
		const blockingSave = new Promise<void>((resolve) => { releaseBlockingSave = resolve; });
		saveData.mockReset().mockImplementation(async () => {
			if (saveData.mock.calls.length === 1) await blockingSave;
		});

		const settingsSave = plugin.saveSettings();
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
		const first = (plugin as any).scanAndRender(view);
		const second = (plugin as any).scanAndRender(view);
		await flushMicrotasks();
		expect(view.setResult).toHaveBeenCalledOnce();
		releaseBlockingSave();
		await Promise.all([settingsSave, first, second]);

		expect(saveData).toHaveBeenCalledTimes(3);
		const saveCalls = (saveData as ReturnType<typeof vi.fn>).mock.calls;
		expect(snapshotFingerprints(saveCalls[1][0])).toEqual(["a"]);
		expect(snapshotFingerprints(saveCalls[2][0])).toEqual(["b"]);
		expect(plugin.lastSuccessfulSnapshot?.issues.map((issue) => issue.fingerprint))
			.toEqual(["b"]);
	});

	it("recovers the scan queue after an unexpected acceptance error without duplicate notices", async () => {
		const resultA = makeScanResult([makeLifecycleIssue("a")]);
		const resultB = makeScanResult([makeLifecycleIssue("b")]);
		const { plugin, run, view } = makeScanSubject(resultA);
		run.mockReset()
			.mockResolvedValueOnce(resultA)
			.mockResolvedValueOnce(resultB);
		view.setResult
			.mockImplementationOnce(() => { throw new Error("view unavailable"); })
			.mockImplementationOnce(() => undefined);
		view.setScanning.mockImplementation((scanning: boolean) => {
			if (!scanning) throw new Error("cleanup unavailable");
		});

		await expect((plugin as any).scanAndRender(view)).resolves.toBeUndefined();
		expect(view.setScanning).toHaveBeenCalledWith(false);
		await expect((plugin as any).scanAndRender(view)).resolves.toBeUndefined();

		expect(run).toHaveBeenCalledTimes(2);
		expect(plugin.lastSuccessfulSnapshot?.issues.map((issue) => issue.fingerprint))
			.toEqual(["b"]);
		expect(noticeMessages.filter(
			(message) => message === "Vault Inspector scan failed: view unavailable",
		)).toHaveLength(1);
	});

	it("binds scan callbacks when Obsidian restores the inspector view", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		let viewFactory: ((leaf: unknown) => InspectorView) | null = null;
		const leaf: { app?: unknown; view?: InspectorView } = {};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [leaf]),
				revealLeaf: vi.fn(async () => {}),
			},
			vault: {
				getAbstractFileByPath: vi.fn(),
			},
		};

		(plugin as any).app = app;
		(plugin as any).registerView = vi.fn((_type, factory) => {
			viewFactory = factory;
		});
		(plugin as any).scanAndRender = vi.fn(async () => {});

		await plugin.onload();

		expect(viewFactory).not.toBeNull();
		leaf.app = app;
		leaf.view = viewFactory!(leaf);

		expect((leaf.view as any).onRunScan).toEqual(expect.any(Function));
		(leaf.view as any).onRunScan();
		await Promise.resolve();

		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect((plugin as any).scanAndRender).toHaveBeenCalledWith(leaf.view);
	});

	it("ignores one issue with deduped paths, rescans once, and reports a disposition outcome", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredIssueFingerprints = ["existing", "target", "target"];
		const issue = {
			...makeLifecycleIssue("target"),
			primaryPath: "notes/source.md",
			relatedPaths: ["notes/source.md", "notes/related.md"],
		};

		await callbacks.onIgnoreIssue(issue);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual(["existing", "target"]);
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(scanAndRender).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "target",
			outcome: "ignored",
			message: expect.stringContaining("Ignored"),
			affectedPaths: ["notes/source.md", "notes/related.md"],
		}]);
	});

	it("rolls back a failed single-issue ignore without rescanning", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredIssueFingerprints = ["existing"];
		saveSettings.mockRejectedValueOnce(new Error("disk unavailable"));
		const issue = makeLifecycleIssue("target");

		await callbacks.onIgnoreIssue(issue);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual(["existing"]);
		expect(scanAndRender).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "target",
			outcome: "failed",
			message: expect.stringContaining("disk unavailable"),
			affectedPaths: ["target.md"],
		}]);
		expect(noticeMessages.some((message) => message.includes("Ignored"))).toBe(false);
	});

	it("bulk ignores each unique fingerprint, persists once, and rescans once", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredIssueFingerprints = ["existing"];
		const first = {
			...makeLifecycleIssue("first"),
			primaryPath: "notes/first.md",
			relatedPaths: ["notes/related.md", "notes/first.md"],
		};
		const second = makeLifecycleIssue("second");

		await callbacks.onIgnoreAllIssues([first, second, first]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual([
			"existing",
			"first",
			"second",
		]);
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(scanAndRender).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([
			{
				fingerprint: "first",
				outcome: "ignored",
				message: expect.stringContaining("Ignored"),
				affectedPaths: ["notes/first.md", "notes/related.md"],
			},
			{
				fingerprint: "second",
				outcome: "ignored",
				message: expect.stringContaining("Ignored"),
				affectedPaths: ["second.md"],
			},
		]);
		expect(noticeMessages.some((message) => message.startsWith("Ignored ")))
			.toBe(false);
	});

	it("reports only per-item failures when a bulk ignore cannot be saved", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredIssueFingerprints = ["existing"];
		saveSettings.mockRejectedValueOnce(new Error("read only"));
		const first = makeLifecycleIssue("first");
		const second = makeLifecycleIssue("second");

		await callbacks.onIgnoreAllIssues([first, second]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual(["existing"]);
		expect(scanAndRender).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([
			expect.objectContaining({
				fingerprint: "first",
				outcome: "failed",
				message: expect.stringContaining("read only"),
			}),
			expect.objectContaining({
				fingerprint: "second",
				outcome: "failed",
				message: expect.stringContaining("read only"),
			}),
		]);
	});

	it("bulk restores each unique fingerprint and rescans once", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredIssueFingerprints = ["first", "second", "keep"];
		const first = makeLifecycleIssue("first");
		const second = makeLifecycleIssue("second");

		await callbacks.onRestoreIssues([first, second, first]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual(["keep"]);
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(scanAndRender).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([
			expect.objectContaining({ fingerprint: "first", outcome: "restored" }),
			expect.objectContaining({ fingerprint: "second", outcome: "restored" }),
		]);
		expect(noticeMessages.some((message) => message.startsWith("Restored ")))
			.toBe(false);
	});

	it("reports only per-item failures when a bulk restore cannot be saved", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredIssueFingerprints = ["first", "second", "keep"];
		saveSettings.mockRejectedValueOnce(new Error("disk unavailable"));
		const first = makeLifecycleIssue("first");
		const second = makeLifecycleIssue("second");

		await callbacks.onRestoreIssues([first, second]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual([
			"first",
			"second",
			"keep",
		]);
		expect(scanAndRender).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([
			expect.objectContaining({ fingerprint: "first", outcome: "failed" }),
			expect.objectContaining({ fingerprint: "second", outcome: "failed" }),
		]);
	});

	it("serializes contextual dispositions so a failed rollback cannot erase a later success", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		let rejectFirst!: (error: Error) => void;
		const firstSave = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
		saveSettings
			.mockImplementationOnce(() => firstSave)
			.mockResolvedValueOnce(undefined);
		const first = callbacks.onIgnoreIssue(makeLifecycleIssue("first"));
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
		const second = callbacks.onIgnoreIssue(makeLifecycleIssue("second"));

		expect(plugin.settings.ignoredIssueFingerprints).toEqual([]);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		rejectFirst(new Error("first failed"));
		await Promise.all([first, second]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual(["second"]);
		expect(saveSettings).toHaveBeenCalledTimes(2);
		expect(scanAndRender).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes.mock.calls.map(([outcomes]) => outcomes[0].outcome))
			.toEqual(["failed", "ignored"]);
	});

	it("keeps a queued bulk ignore after an earlier single-ignore save fails", async () => {
		const { plugin, callbacks, saveData, performScanAndRender } = makeCoordinatedSubject();
		let rejectFirst!: (error: Error) => void;
		const firstSave = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
		saveData.mockImplementationOnce(() => firstSave).mockResolvedValueOnce(undefined);
		const firstIssue = makeLifecycleIssue("single");
		const bulkIssue = makeLifecycleIssue("bulk");

		const single = callbacks.onIgnoreIssue(firstIssue);
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
		const bulk = callbacks.onIgnoreAllIssues([bulkIssue]);
		await Promise.resolve();

		expect(saveData).toHaveBeenCalledTimes(1);
		rejectFirst(new Error("single failed"));
		await Promise.all([single, bulk]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual(["bulk"]);
		expect(saveData).toHaveBeenCalledTimes(2);
		expect((saveData.mock.calls[0][0] as any).settings.ignoredIssueFingerprints)
			.toEqual(["single"]);
		expect((saveData.mock.calls[1][0] as any).settings.ignoredIssueFingerprints)
			.toEqual(["bulk"]);
		expect(performScanAndRender).toHaveBeenCalledOnce();
	});

	it("persists both a successful disposition and a settings-tab change queued during its save", async () => {
		const { plugin, callbacks, saveData } = makeCoordinatedSubject();
		let releaseFirst!: () => void;
		const firstSave = new Promise<void>((resolve) => { releaseFirst = resolve; });
		saveData.mockImplementationOnce(() => firstSave).mockResolvedValueOnce(undefined);

		const disposition = callbacks.onIgnoreIssue(makeLifecycleIssue("single"));
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
		plugin.settings.ignoredIssueFingerprints.push("settings-tab");
		const settingsSave = plugin.saveSettings();
		await Promise.resolve();
		expect(saveData).toHaveBeenCalledOnce();

		releaseFirst();
		await Promise.all([disposition, settingsSave]);

		expect(plugin.settings.ignoredIssueFingerprints).toEqual([
			"settings-tab",
			"single",
		]);
		expect(saveData).toHaveBeenCalledTimes(2);
		expect((saveData.mock.calls[1][0] as any).settings.ignoredIssueFingerprints)
			.toEqual(["settings-tab", "single"]);
	});

	it("queues a manual scan until a failed single ignore leaves stable settings", async () => {
		const { plugin, callbacks, saveData, performScanAndRender, view } = makeCoordinatedSubject();
		let rejectSave!: (error: Error) => void;
		saveData.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
			rejectSave = reject;
		}));
		const observedSettings: string[][] = [];
		performScanAndRender.mockImplementation(async () => {
			observedSettings.push([...plugin.settings.ignoredIssueFingerprints]);
		});

		const ignore = callbacks.onIgnoreIssue(makeLifecycleIssue("temporary"));
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
		const scan = (plugin as any).scanAndRender(view);
		await Promise.resolve();
		expect(performScanAndRender).not.toHaveBeenCalled();

		rejectSave(new Error("save failed"));
		await Promise.all([ignore, scan]);

		expect(observedSettings).toEqual([[]]);
		expect(plugin.settings.ignoredIssueFingerprints).toEqual([]);
	});

	it("queues a manual scan until a failed folder exclusion leaves stable settings", async () => {
		const { plugin, callbacks, saveData, performScanAndRender, view } = makeCoordinatedSubject();
		plugin.settings.ignoredFoldersByScanner["broken-links"] = ["stable"];
		let rejectSave!: (error: Error) => void;
		saveData.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
			rejectSave = reject;
		}));
		const observedSettings: string[][] = [];
		performScanAndRender.mockImplementation(async () => {
			observedSettings.push([
				...plugin.settings.ignoredFoldersByScanner["broken-links"],
			]);
		});

		const exclusion = callbacks.onExcludeFolder({
			scannerId: "broken-links",
			folder: "temporary",
			affectedCount: 1,
		});
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
		const scan = (plugin as any).scanAndRender(view);
		await Promise.resolve();
		expect(performScanAndRender).not.toHaveBeenCalled();

		rejectSave(new Error("save failed"));
		await Promise.all([exclusion, scan]);

		expect(observedSettings).toEqual([["stable"]]);
		expect(plugin.settings.ignoredFoldersByScanner["broken-links"])
			.toEqual(["stable"]);
	});

	it("excludes one scanner folder with dedupe, rescans once, and reports affected scope", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredFoldersByScanner["broken-links"] = ["notes/project", "notes/project"];

		await callbacks.onExcludeFolder({
			scannerId: "broken-links",
			folder: "notes/project",
			affectedCount: 3,
		});

		expect(plugin.settings.ignoredFoldersByScanner["broken-links"]).toEqual(["notes/project"]);
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(scanAndRender).toHaveBeenCalledOnce();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			scannerId: "broken-links",
			outcome: "excluded",
			message: expect.stringMatching(/Broken Links.*notes\/project.*3/),
			affectedPaths: ["notes/project"],
		}]);
	});

	it("rolls back a failed scanner-folder exclusion without rescanning", async () => {
		const { plugin, callbacks, saveSettings, scanAndRender, view } = makeContextualSubject();
		plugin.settings.ignoredFoldersByScanner["empty-notes"] = ["archive"];
		saveSettings.mockRejectedValueOnce(new Error("read only"));

		await callbacks.onExcludeFolder({
			scannerId: "empty-notes",
			folder: "templates",
			affectedCount: 2,
		});

		expect(plugin.settings.ignoredFoldersByScanner["empty-notes"]).toEqual(["archive"]);
		expect(scanAndRender).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			scannerId: "empty-notes",
			outcome: "failed",
			message: expect.stringContaining("read only"),
			affectedPaths: ["templates"],
		}]);
	});

	it("opens scanner settings when available and shows exact recovery guidance otherwise", () => {
		const { plugin, callbacks } = makeContextualSubject();
		openPluginSettingsMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

		callbacks.onOpenScannerSettings("broken-links");
		expect(openPluginSettingsMock).toHaveBeenLastCalledWith(
			(plugin as any).app,
			"vault-inspector",
		);
		expect(noticeMessages).toEqual([]);

		callbacks.onOpenScannerSettings("broken-links");
		expect(noticeMessages).toEqual([
			"Open Settings → Vault Inspector → Scanner-specific ignored folders.",
		]);
	});

	it("continues after execution errors and accepts the only final verification result", async () => {
		const firstAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove first link",
			description: "Remove first link",
			targetPaths: ["Shared.md"],
			linkText: "First",
		};
		const secondAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove second link",
			description: "Remove second link",
			targetPaths: ["Shared.md"],
			linkText: "Second",
		};
		const firstIssue = makeFixIssue("first", firstAction);
		const secondIssue = makeFixIssue("second", secondAction);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([firstIssue, secondIssue]))
			.mockResolvedValueOnce(makeScanResult([secondIssue]))
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([
			{ fingerprint: firstIssue.fingerprint },
			{ fingerprint: secondIssue.fingerprint },
		]);
		executeFixActionMock
			.mockRejectedValueOnce(new Error("write denied"))
			.mockResolvedValueOnce(2);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues([firstIssue, secondIssue]);

		expect(run).toHaveBeenCalledTimes(3);
		expect(executeFixActionMock).toHaveBeenCalledTimes(2);
		expect(view.setResult).toHaveBeenCalledOnce();
		expect(view.setResult.mock.calls[0][0]).toBe(finalResult);
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([
			{
				fingerprint: "first",
				outcome: "failed",
				phase: "execution",
				message: "write denied",
				affectedPaths: ["Shared.md"],
			},
			{
				fingerprint: "second",
				outcome: "fixed",
				message: "Verified after 2 change(s).",
				affectedPaths: ["Shared.md"],
			},
		]);
		expect(noticeMessages).not.toEqual(expect.arrayContaining([
			expect.stringMatching(/^Fixed|^No items were fixed/),
		]));
	});

	it("publishes exact fix outcomes before rethrowing an acceptance failure", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([issue]))
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		executeFixActionMock.mockResolvedValueOnce(1);
		const original = new Error("original acceptance failure");
		view.setResult.mockImplementationOnce(() => { throw original; });
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await expect(callbacks.onFixAllIssues([issue])).rejects.toBe(original);

		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "link",
			outcome: "fixed",
			message: "Verified after 1 change(s).",
			affectedPaths: ["Source.md"],
		}]);
	});

	it("preserves the acceptance error when outcome publication also throws", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([issue]))
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		executeFixActionMock.mockResolvedValueOnce(1);
		const original = new Error("original acceptance failure");
		view.setResult.mockImplementationOnce(() => { throw original; });
		view.setOperationOutcomes.mockImplementationOnce(() => {
			throw new Error("outcome publication failure");
		});
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await expect(callbacks.onFixAllIssues([issue])).rejects.toBe(original);

		expect(view.setOperationOutcomes).toHaveBeenCalledOnce();
	});

	it("propagates an outcome publication failure after successful acceptance", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([issue]))
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		executeFixActionMock.mockResolvedValueOnce(1);
		const publicationError = new Error("outcome publication failure");
		view.setOperationOutcomes.mockImplementationOnce(() => {
			throw publicationError;
		});
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await expect(callbacks.onFixAllIssues([issue])).rejects.toBe(publicationError);

		expect(view.setResult.mock.calls[0][0]).toBe(finalResult);
		expect(plugin.lastSuccessfulSnapshot?.issues).toEqual([]);
	});

	it("reports a one-shot fix preflight startup failure as a skipped outcome", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		view.setScanning.mockImplementationOnce(() => {
			throw new Error("preflight view unavailable");
		});
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues([issue]);

		expect(run).toHaveBeenCalledOnce();
		expect(view.setResult.mock.calls[0][0]).toBe(finalResult);
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "link",
			outcome: "skipped",
			phase: "preflight",
			message: "The preflight scan did not complete.",
			affectedPaths: ["Source.md"],
		}]);
		expect(noticeMessages).toContain(
			"Vault Inspector scan failed: preflight view unavailable",
		);
	});

	it("keeps a skipped preflight outcome when every fix scan startup fails", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const { plugin, run, view } = makeScanSubject(makeScanResult([]));
		view.setScanning.mockImplementation((scanning: boolean) => {
			if (scanning) throw new Error("scan view unavailable");
		});
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues([issue]);

		expect(run).not.toHaveBeenCalled();
		expect(view.setResult).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "link",
			outcome: "skipped",
			phase: "preflight",
			message: "The preflight scan did not complete.",
			affectedPaths: ["Source.md"],
		}]);
		expect(noticeMessages.filter(
			(message) => message === "Vault Inspector scan failed: scan view unavailable",
		)).toHaveLength(2);
	});

	it("reports a pending fix as failed when final verification startup throws", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const { plugin, run, view } = makeScanSubject(makeScanResult([]));
		let scanStarts = 0;
		view.setScanning.mockImplementation((scanning: boolean) => {
			if (scanning && ++scanStarts === 2) {
				throw new Error("verification view unavailable");
			}
		});
		run.mockReset().mockResolvedValueOnce(makeScanResult([issue]));
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		executeFixActionMock.mockResolvedValueOnce(1);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues([issue]);

		expect(run).toHaveBeenCalledOnce();
		expect(view.setResult).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "link",
			outcome: "failed",
			phase: "verification",
			message: "The final verification scan did not complete.",
			affectedPaths: ["Source.md"],
		}]);
		expect(noticeMessages).toContain(
			"Vault Inspector scan failed: verification view unavailable",
		);
	});

	it("does not accept a null verification result and reports verification failure", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const { plugin, run, view } = makeScanSubject(makeScanResult([]));
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([issue]))
			.mockRejectedValueOnce(new Error("verification unavailable"));
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		executeFixActionMock.mockResolvedValueOnce(1);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues([issue]);

		expect(run).toHaveBeenCalledTimes(2);
		expect(view.setResult).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "link",
			outcome: "failed",
			phase: "verification",
			message: "The final verification scan did not complete.",
			affectedPaths: ["Source.md"],
		}]);
		expect(noticeMessages).toContain(
			"Vault Inspector scan failed: verification unavailable",
		);
	});

	it("keeps a manual scan queued until fix preflight and verification finish", async () => {
		const fixAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const issue = makeFixIssue("link", fixAction);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		let finishPreflight!: (result: ScanResult) => void;
		const preflight = new Promise<ScanResult>((resolve) => {
			finishPreflight = resolve;
		});
		run.mockReset()
			.mockImplementationOnce(() => preflight)
			.mockResolvedValueOnce(finalResult)
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([{ fingerprint: "link" }]);
		executeFixActionMock.mockResolvedValue(1);
		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);

		const fixing = callbacks.onFixAllIssues([issue]);
		await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
		const manualScan = (plugin as any).scanAndRender(view);
		await flushMicrotasks();
		expect(run).toHaveBeenCalledOnce();

		finishPreflight(makeScanResult([issue]));
		await Promise.all([fixing, manualScan]);

		expect(run).toHaveBeenCalledTimes(3);
		expect(view.setResult.mock.calls[0][0]).toBe(finalResult);
		expect(view.setOperationOutcomes.mock.calls).toEqual([
			[expect.arrayContaining([
				expect.objectContaining({ fingerprint: "link", outcome: "fixed" }),
			])],
			[[]],
		]);
	});

	it("executes a fresh duplicate action using the selected keep path", async () => {
		const duplicate = makeDuplicateIssue(
			"duplicates",
			["a.md", "b.md", "c.md"],
		);
		const finalResult = makeScanResult([]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([duplicate]))
			.mockResolvedValueOnce(finalResult);
		plugin.settings = {
			...structuredClone(DEFAULT_SETTINGS),
			duplicateKeepMode: "always-ask",
		};
		showConfirmModalMock.mockResolvedValue([
			{ fingerprint: "duplicates", keepPath: "c.md" },
		]);
		executeFixActionMock.mockResolvedValue(2);

		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);
		await callbacks.onFixAllIssues([duplicate]);

		expect(showConfirmModalMock).toHaveBeenCalledWith(
			(plugin as any).app,
			[duplicate],
			"always-ask",
		);
		expect(executeFixActionMock).toHaveBeenCalledWith(
			(plugin as any).app,
			expect.objectContaining({
				targetPaths: ["a.md", "b.md"],
			}),
		);
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([
			expect.objectContaining({ fingerprint: "duplicates", outcome: "fixed" }),
		]);
	});

	it("reports a changed duplicate group as a preflight outcome", async () => {
		const stale = makeDuplicateIssue(
			"duplicates",
			["a.md", "b.md", "c.md"],
		);
		const changed = makeDuplicateIssue(
			"duplicates",
			["a.md", "b.md"],
		);
		const finalResult = makeScanResult([changed]);
		const { plugin, run, view } = makeScanSubject(finalResult);
		run.mockReset()
			.mockResolvedValueOnce(makeScanResult([changed]))
			.mockResolvedValueOnce(finalResult);
		showConfirmModalMock.mockResolvedValue([
			{ fingerprint: "duplicates", keepPath: "b.md" },
		]);

		let callbacks: any;
		view.setCallbacks.mockImplementation((value) => { callbacks = value; });
		(plugin as any).configureView(view);
		await callbacks.onFixAllIssues([stale]);

		expect(executeFixActionMock).not.toHaveBeenCalled();
		expect(view.setOperationOutcomes).toHaveBeenCalledWith([{
			fingerprint: "duplicates",
			outcome: "skipped",
			phase: "preflight",
			message: "The finding or fix evidence changed before execution.",
			affectedPaths: ["b.md", "c.md"],
		}]);
	});

	it("saves settings in an envelope without an absent snapshot key", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.settings = {
			...structuredClone(DEFAULT_SETTINGS),
			reportFolderPath: "Custom reports",
		};
		plugin.saveData = vi.fn(async () => {});

		await plugin.saveSettings();

		expect(plugin.saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
		});
		expect((plugin.saveData as ReturnType<typeof vi.fn>).mock.calls[0][0])
			.not.toHaveProperty("lastSuccessfulSnapshot");
	});

	it("persists settings while a long-running scan is still in progress", async () => {
		const result = makeScanResult([makeLifecycleIssue("current")]);
		const { plugin, run, saveData, view } = makeScanSubject(result);
		let finishScan!: (value: ScanResult) => void;
		const blockedScan = new Promise<ScanResult>((resolve) => { finishScan = resolve; });
		run.mockReset().mockImplementation(() => blockedScan);

		const scan = (plugin as any).scanAndRender(view);
		await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
		plugin.settings.reportFolderPath = "Updated during scan";
		const settingsSave = plugin.saveSettings();

		await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
		expect((saveData.mock.calls[0][0] as any).settings.reportFolderPath)
			.toBe("Updated during scan");
		expect(view.setResult).not.toHaveBeenCalled();

		finishScan(result);
		await Promise.all([scan, settingsSave]);
		expect(view.setResult).toHaveBeenCalledOnce();
	});

	it("saves settings and a successful snapshot in one envelope", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.settings = structuredClone(DEFAULT_SETTINGS);
		plugin.lastSuccessfulSnapshot = makeSnapshot("first-profile");
		plugin.saveData = vi.fn(async () => {});

		await plugin.saveSettings();

		expect(plugin.saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
			lastSuccessfulSnapshot: plugin.lastSuccessfulSnapshot,
		});
	});

	it("serializes saves and captures each payload when its write begins", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.settings = {
			...structuredClone(DEFAULT_SETTINGS),
			reportFolderPath: "First reports",
		};
		plugin.lastSuccessfulSnapshot = makeSnapshot("first-profile");
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
		let activeWrites = 0;
		let maxActiveWrites = 0;
		plugin.saveData = vi.fn(async () => {
			activeWrites++;
			maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
			if ((plugin.saveData as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
				await firstGate;
			}
			activeWrites--;
		});

		const firstSave = plugin.saveSettings();
		await vi.waitFor(() => {
			expect(plugin.saveData).toHaveBeenCalledTimes(1);
		});
		plugin.settings.reportFolderPath = "Latest reports";
		plugin.lastSuccessfulSnapshot = makeSnapshot("latest-profile");
		const secondSave = plugin.saveSettings();
		await Promise.resolve();

		expect(plugin.saveData).toHaveBeenCalledTimes(1);
		releaseFirst();
		await Promise.all([firstSave, secondSave]);

		expect(maxActiveWrites).toBe(1);
		expect(plugin.saveData).toHaveBeenCalledTimes(2);
		expect((plugin.saveData as ReturnType<typeof vi.fn>).mock.calls[0][0])
			.toMatchObject({
				settings: { reportFolderPath: "First reports" },
				lastSuccessfulSnapshot: { scanProfile: "first-profile" },
			});
		expect((plugin.saveData as ReturnType<typeof vi.fn>).mock.calls[1][0])
			.toMatchObject({
				settings: { reportFolderPath: "Latest reports" },
				lastSuccessfulSnapshot: { scanProfile: "latest-profile" },
			});
	});

	it("continues the save queue after a rejected write", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.settings = structuredClone(DEFAULT_SETTINGS);
		plugin.saveData = vi.fn()
			.mockRejectedValueOnce(new Error("disk unavailable"))
			.mockResolvedValueOnce(undefined);

		await expect(plugin.saveSettings()).rejects.toThrow("disk unavailable");
		plugin.settings.reportFolderPath = "Recovered reports";
		await expect(plugin.saveSettings()).resolves.toBeUndefined();

		expect(plugin.saveData).toHaveBeenCalledTimes(2);
		expect((plugin.saveData as ReturnType<typeof vi.fn>).mock.calls[1][0])
			.toMatchObject({ settings: { reportFolderPath: "Recovered reports" } });
	});
});

describe("report export safety", () => {
	beforeEach(() => {
		showLargeReportWarningModalMock.mockReset();
		noticeMessages.length = 0;
	});

	it("exports a small full report without showing the large-report modal", async () => {
		const { create, createFolder, plugin } = makeExportSubject(
			makeScanResult([makeLifecycleIssue("small-fixture")]),
		);

		await (plugin as any).exportReport();

		expect(showLargeReportWarningModalMock).not.toHaveBeenCalled();
		expect(createFolder).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledOnce();
		const [filepath, content] = create.mock.calls[0];
		expect(filepath).toMatch(/^Vault Inspector Reports\/Vault Inspector Report .+\.md$/);
		expect(content).toContain("# Vault Inspector Report");
		expect(noticeMessages).toHaveLength(1);
		expect(noticeMessages[0]).toMatch(/^Report exported to /);
	});

	it("waits for the large-report decision before creating a summary export", async () => {
		const result = makeLargeExportResult();
		const { create, createFolder, getAbstractFileByPath, plugin } = makeExportSubject(
			result,
		);
		getAbstractFileByPath.mockReturnValue(null);
		let choose!: (decision: "summary") => void;
		showLargeReportWarningModalMock.mockImplementation(
			() => new Promise<"summary">((resolve) => { choose = resolve; }),
		);

		const exporting = (plugin as any).exportReport();
		await vi.waitFor(() => expect(showLargeReportWarningModalMock).toHaveBeenCalledOnce());

		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		const details = showLargeReportWarningModalMock.mock.calls[0][1];
		expect(details).toEqual({
			reportBytes: expect.any(Number),
			thresholdBytes: MAX_SAFE_VAULT_REPORT_BYTES,
			findingCount: 1,
		});
		expect(details.reportBytes).toBe(getUtf8ByteLength(generateMarkdownReport(result)));

		choose("summary");
		await exporting;

		expect(createFolder).toHaveBeenCalledOnce();
		expect(create).toHaveBeenCalledOnce();
		const [filepath, content] = create.mock.calls[0];
		expect(filepath).toMatch(/^Vault Inspector Reports\/Vault Inspector Summary .+\.md$/);
		expect(content).toContain("# Vault Inspector Summary");
		expect(content).not.toContain("Full fixture title");
		expect(content.length).toBeLessThan(4096);
		expect(noticeMessages).toHaveLength(1);
		expect(noticeMessages[0]).toMatch(/^Summary exported to /);
	});

	it("exports the generated full report after the user chooses full", async () => {
		const result = makeLargeExportResult();
		const expectedReportBytes = getUtf8ByteLength(generateMarkdownReport(result));
		const { create, plugin } = makeExportSubject(result);
		showLargeReportWarningModalMock.mockResolvedValue("full");
		const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");

		try {
			await (plugin as any).exportReport();
			expect(encodeSpy).toHaveBeenCalledOnce();
		} finally {
			encodeSpy.mockRestore();
		}

		expect(showLargeReportWarningModalMock).toHaveBeenCalledOnce();
		expect(showLargeReportWarningModalMock.mock.calls[0][1].reportBytes)
			.toBe(expectedReportBytes);
		expect(create).toHaveBeenCalledOnce();
		const [filepath, content] = create.mock.calls[0];
		expect(filepath).toMatch(/^Vault Inspector Reports\/Vault Inspector Report .+\.md$/);
		expect(content).toContain("Full fixture title");
		expect(new TextEncoder().encode(content).byteLength)
			.toBeGreaterThan(MAX_SAFE_VAULT_REPORT_BYTES);
		expect(noticeMessages).toHaveLength(1);
		expect(noticeMessages[0]).toMatch(/^Report exported to /);
	});

	it("does not mutate the vault when the large-report modal is cancelled", async () => {
		const { create, createFolder, plugin } = makeExportSubject(makeLargeExportResult());
		showLargeReportWarningModalMock.mockResolvedValue(null);

		await (plugin as any).exportReport();

		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual([]);
	});

	it("requires a completed scan result before exporting", async () => {
		const { create, createFolder, plugin } = makeExportSubject(null);

		await (plugin as any).exportReport();

		expect(showLargeReportWarningModalMock).not.toHaveBeenCalled();
		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual(["Run a scan first before exporting."]);
	});

	it("reports a modal failure without mutating the vault", async () => {
		const { create, createFolder, plugin } = makeExportSubject(makeLargeExportResult());
		showLargeReportWarningModalMock.mockRejectedValue(new Error("modal unavailable"));

		await (plugin as any).exportReport();

		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual(["Report export failed: modal unavailable"]);
	});

	it("reports folder and file failures without a success notice", async () => {
		const folderFailure = makeExportSubject(makeScanResult([]));
		folderFailure.getAbstractFileByPath.mockReturnValue(null);
		folderFailure.createFolder.mockRejectedValue(new Error("folder unavailable"));

		await (folderFailure.plugin as any).exportReport();

		expect(folderFailure.create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual(["Report export failed: folder unavailable"]);

		noticeMessages.length = 0;
		const fileFailure = makeExportSubject(makeScanResult([]));
		fileFailure.create.mockRejectedValue(new Error("file unavailable"));

		await (fileFailure.plugin as any).exportReport();

		expect(fileFailure.createFolder).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual(["Report export failed: file unavailable"]);
	});
});

function makeLargeExportResult(): ScanResult {
	const issue = makeLifecycleIssue("large-fixture");
	issue.title = "Full fixture title";
	issue.message = "x".repeat(MAX_SAFE_VAULT_REPORT_BYTES + 1);
	return makeScanResult([issue]);
}

function makeExportSubject(result: ScanResult | null) {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	const getAbstractFileByPath = vi.fn().mockReturnValue({ path: plugin.settings.reportFolderPath });
	const createFolder = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
	const create = vi.fn<(path: string, content: string) => Promise<void>>()
		.mockResolvedValue(undefined);
	const view = {
		hasResult: vi.fn(() => result !== null),
		getResult: vi.fn(() => result),
	};
	(plugin as any).app = {
		workspace: {
			getLeavesOfType: vi.fn(() => [{ view }]),
		},
		vault: {
			getAbstractFileByPath,
			createFolder,
			create,
		},
	};
	return { create, createFolder, getAbstractFileByPath, plugin, view };
}

function makeSnapshot(scanProfile: string) {
	return createScanSnapshot(makeScanResult([]), scanProfile, "0.5.0", 100);
}

function makeLifecycleIssue(fingerprint: string): Issue {
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

function makeScanSubject(result: ScanResult) {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	(plugin as any).app = {};
	(plugin as any).manifest = { version: "0.5.0" };
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	const run = vi.fn().mockResolvedValue(result);
	(plugin as any).scanRunner = { run };
	const saveData = vi.fn(async (_data: unknown) => {});
	plugin.saveData = saveData;
	const view = {
		setCallbacks: vi.fn(),
		setEnableFixActions: vi.fn(),
		setOperationOutcomes: vi.fn(),
		setScanning: vi.fn(),
		setScanProgress: vi.fn(),
		setResult: vi.fn(),
	};
	return { plugin, run, saveData, view };
}

function makeContextualSubject() {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	(plugin as any).app = {};
	(plugin as any).manifest = { id: "vault-inspector", version: "0.5.0" };
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	const saveSettings = vi.fn(async () => {});
	plugin.saveData = saveSettings;
	const scanAndRender = vi.fn(async () => {});
	(plugin as any).performScanAndRender = scanAndRender;
	let callbacks: any;
	const view = {
		setCallbacks: vi.fn((value) => { callbacks = value; }),
		setEnableFixActions: vi.fn(),
		setOperationOutcomes: vi.fn(),
		setScanning: vi.fn(),
		setScanProgress: vi.fn(),
		setResult: vi.fn(),
	};
	(plugin as any).configureView(view);
	return { plugin, callbacks, saveSettings, scanAndRender, view };
}

function makeCoordinatedSubject() {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	(plugin as any).app = {};
	(plugin as any).manifest = { id: "vault-inspector", version: "0.5.0" };
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	const saveData = vi.fn(async (_data: unknown) => {});
	plugin.saveData = saveData;
	const performScanAndRender = vi.fn(async () => {});
	(plugin as any).performScanAndRender = performScanAndRender;
	let callbacks: any;
	const view = {
		setCallbacks: vi.fn((value) => { callbacks = value; }),
		setEnableFixActions: vi.fn(),
		setOperationOutcomes: vi.fn(),
		setScanning: vi.fn(),
		setScanProgress: vi.fn(),
		setResult: vi.fn(),
	};
	(plugin as any).configureView(view);
	return { plugin, callbacks, saveData, performScanAndRender, view };
}

async function flushMicrotasks(count = 20): Promise<void> {
	for (let index = 0; index < count; index++) await Promise.resolve();
}

function snapshotFingerprints(payload: unknown): string[] {
	const snapshot = (payload as { lastSuccessfulSnapshot?: ScanSnapshot })
		.lastSuccessfulSnapshot;
	return snapshot?.issues.map((issue) => issue.fingerprint) ?? [];
}

function makeDuplicateIssue(fingerprint: string, paths: string[]): Issue {
	const sorted = paths.slice().sort();
	const keepPath = sorted[0];
	return {
		scannerId: "duplicate-files",
		severity: "warning",
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: "Duplicate files (hash-identical)",
		message: `${sorted.length} files have identical content`,
		relatedPaths: sorted,
		evidence: { count: sorted.length, paths: sorted.join(", ") },
		fingerprint,
		fixAction: {
			kind: "trash-file",
			label: "Delete duplicates",
			description:
				`Keep "${keepPath}" and move ${sorted.length - 1} duplicate(s) to trash`,
			targetPaths: sorted.slice(1),
			selection: {
				kind: "keep-one",
				candidatePaths: sorted,
				automaticKeepPath: keepPath,
			},
		},
	};
}

describe("migrateExcalidrawFrontmatterKey", () => {
	function makeSettings(keys: string[]): InspectorSettings {
		return { ...DEFAULT_SETTINGS, ignoredLargeMarkdownFrontmatterKeys: keys };
	}

	it("replaces legacy excalidraw key with excalidraw-plugin", () => {
		const settings = makeSettings(["excalidraw"]);
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw"],
		});
		expect(changed).toBe(true);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
		]);
	});

	it("replaces legacy key while preserving other custom keys", () => {
		const settings = makeSettings(["excalidraw", "canvas"]);
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw", "canvas"],
		});
		expect(changed).toBe(true);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
			"canvas",
		]);
	});

	it("dedupes when both legacy and correct keys are present", () => {
		const settings = makeSettings(["excalidraw", "excalidraw-plugin"]);
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw", "excalidraw-plugin"],
		});
		expect(changed).toBe(true);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
		]);
	});

	it("is a no-op when loaded value has no legacy key", () => {
		const settings = makeSettings(["excalidraw-plugin"]);
		const original = [...settings.ignoredLargeMarkdownFrontmatterKeys];
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw-plugin"],
		});
		expect(changed).toBe(false);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual(original);
	});

	it("is a no-op when nothing was persisted (fresh install)", () => {
		const settings = makeSettings([...DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys]);
		const original = [...settings.ignoredLargeMarkdownFrontmatterKeys];
		const changed = migrateExcalidrawFrontmatterKey(settings, null);
		expect(changed).toBe(false);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual(original);
	});

	it("is a no-op when persisted value omits this setting", () => {
		const settings = makeSettings([...DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys]);
		const original = [...settings.ignoredLargeMarkdownFrontmatterKeys];
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			largeMarkdownBytes: 500,
		});
		expect(changed).toBe(false);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual(original);
	});

	it("migrates the legacy key inside an envelope without losing its snapshot", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		const snapshot = makeSnapshot("migration-profile");
		plugin.loadData = vi.fn(async () => ({
			settings: {
				ignoredLargeMarkdownFrontmatterKeys: ["excalidraw", "canvas"],
			},
			lastSuccessfulSnapshot: snapshot,
		}));
		plugin.saveData = vi.fn(async () => {});

		await plugin.loadSettings();

		expect(plugin.settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
			"canvas",
		]);
		expect(plugin.lastSuccessfulSnapshot).toEqual(snapshot);
		expect(plugin.saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
			lastSuccessfulSnapshot: snapshot,
		});
	});
});
