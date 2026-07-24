import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultInspectorPlugin, { migrateExcalidrawFrontmatterKey } from "../main";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { InspectorSettings } from "../settings/settings";
import type { InspectorView } from "../report/InspectorView";
import type { FixAction, Issue, ScanResult } from "../scanner/Issue";

const { executeFixActionMock, noticeMessages, showConfirmModalMock } = vi.hoisted(() => ({
	executeFixActionMock: vi.fn(),
	noticeMessages: [] as string[],
	showConfirmModalMock: vi.fn(),
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

function makeFixIssue(fingerprint: string, fixAction: FixAction): Issue {
	return {
		scannerId: fixAction.kind === "remove-link-text" ? "broken-links" : "empty-notes",
		severity: "warning",
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
		executeFixActionMock.mockReset();
		showConfirmModalMock.mockReset();
		noticeMessages.length = 0;
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

	it("rescans before fixing and executes only issues whose fingerprint and action still match", async () => {
		const exactAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const changedAction: FixAction = {
			...exactAction,
			linkText: "Different",
		};
		const staleIssues = [
			makeFixIssue("still-current", exactAction),
			makeFixIssue("changed", exactAction),
			makeFixIssue("gone", exactAction),
		];
		const freshResult = makeScanResult([
			makeFixIssue("still-current", { ...exactAction, targetPaths: [...exactAction.targetPaths] }),
			makeFixIssue("changed", changedAction),
		]);
		const run = vi.fn().mockResolvedValue(freshResult);
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		(plugin as any).app = {};
		(plugin as any).scanRunner = { run };
		showConfirmModalMock.mockResolvedValue(true);
		executeFixActionMock.mockResolvedValue(1);

		let callbacks: any;
		const view = {
			setCallbacks: vi.fn((value) => { callbacks = value; }),
			setEnableFixActions: vi.fn(),
			setScanning: vi.fn(),
			setScanProgress: vi.fn(),
			setResult: vi.fn(),
		};
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues(staleIssues);

		expect(run).toHaveBeenCalledTimes(4);
		expect(run.mock.invocationCallOrder[0]).toBeLessThan(
			executeFixActionMock.mock.invocationCallOrder[0],
		);
		expect(executeFixActionMock).toHaveBeenCalledTimes(1);
		expect(executeFixActionMock).toHaveBeenCalledWith(
			(plugin as any).app,
			exactAction,
		);
	});

	it("revalidates each action after earlier fixes may have changed later issues", async () => {
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
		const run = vi.fn()
			.mockResolvedValueOnce(makeScanResult([firstIssue, secondIssue]))
			.mockResolvedValueOnce(makeScanResult([firstIssue]))
			.mockResolvedValueOnce(makeScanResult([]));
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		(plugin as any).app = {};
		(plugin as any).scanRunner = { run };
		showConfirmModalMock.mockResolvedValue(true);
		executeFixActionMock.mockResolvedValue(1);

		let callbacks: any;
		const view = {
			setCallbacks: vi.fn((value) => { callbacks = value; }),
			setEnableFixActions: vi.fn(),
			setScanning: vi.fn(),
			setScanProgress: vi.fn(),
			setResult: vi.fn(),
		};
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues([firstIssue, secondIssue]);

		expect(run).toHaveBeenCalledTimes(3);
		expect(executeFixActionMock).toHaveBeenCalledTimes(1);
		expect(executeFixActionMock).toHaveBeenCalledWith(
			(plugin as any).app,
			firstAction,
		);
	});

	it("adds executor return values and does not report zero-result actions as successes", async () => {
		const firstAction: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Remove missing link",
			targetPaths: ["Source.md"],
			linkText: "Missing",
		};
		const secondAction: FixAction = {
			kind: "trash-file",
			label: "Delete duplicates",
			description: "Move duplicate files to trash",
			targetPaths: ["one.png", "two.png", "three.png"],
		};
		const issues = [
			makeFixIssue("link", firstAction),
			makeFixIssue("duplicates", secondAction),
		];
		const run = vi.fn().mockResolvedValue(makeScanResult(issues));
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		(plugin as any).app = {};
		(plugin as any).scanRunner = { run };
		showConfirmModalMock.mockResolvedValue(true);
		executeFixActionMock
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(3);

		let callbacks: any;
		const view = {
			setCallbacks: vi.fn((value) => { callbacks = value; }),
			setEnableFixActions: vi.fn(),
			setScanning: vi.fn(),
			setScanProgress: vi.fn(),
			setResult: vi.fn(),
		};
		(plugin as any).configureView(view);

		await callbacks.onFixAllIssues(issues);

		expect(noticeMessages).toContain("Fixed 3 items");
		expect(noticeMessages).not.toContain("Fixed 2 issue(s)");
	});
});

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
});
