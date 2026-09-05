import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTooltip, WorkspaceLeaf } from "obsidian";
import type {
	FindingClassification,
	Issue,
	ScanResult,
	ScannerId,
} from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import type { SnapshotIssue } from "../snapshot/scan-snapshot";

const {
	renderIssueListMock,
	renderResolvedChangesMock,
	renderSummaryMock,
	showFolderExclusionModalMock,
	inspectorNoticeMessages,
} = vi.hoisted(() => ({
	renderIssueListMock: vi.fn(),
	renderResolvedChangesMock: vi.fn(),
	renderSummaryMock: vi.fn(),
	showFolderExclusionModalMock: vi.fn(),
	inspectorNoticeMessages: [] as string[],
}));

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
		Notice: class {
			constructor(message: string) { inspectorNoticeMessages.push(message); }
		},
	};
});

vi.mock("../report/render-issues", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../report/render-issues")>();
	return { ...actual, renderIssueList: renderIssueListMock };
});

vi.mock("../report/render-summary", () => ({
	renderSummary: renderSummaryMock,
}));

vi.mock("../report/render-changes", () => ({
	renderResolvedChanges: renderResolvedChangesMock,
}));

vi.mock("../report/exclude-folder-modal", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../report/exclude-folder-modal")>();
	return { ...actual, showFolderExclusionModal: showFolderExclusionModalMock };
});

import { InspectorView } from "../report/InspectorView";

type Listener = () => void;

type ElementOptions = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
};

class FakeElement {
	children: FakeElement[] = [];
	cls: string;
	text: string | null;
	attr: Record<string, string>;
	style = { display: "" };
	scrollTop = 0;
	private openState = false;
	private listeners = new Map<string, Listener>();

	constructor(
		readonly tag = "div",
		options: ElementOptions = {},
	) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
		this.attr = options.attr ?? {};
	}

	/**
	 * Mirrors the HTML spec: assigning open queues a toggle event as a task,
	 * so listeners observe the change asynchronously — including listeners
	 * attached after the assignment, like the renderer's own toggle handler.
	 */
	get open(): boolean {
		return this.openState;
	}

	set open(value: boolean) {
		if (this.openState === value) return;
		this.openState = value;
		queueMicrotask(() => {
			this.listeners.get("toggle")?.();
		});
	}

	createDiv(options: ElementOptions = {}): FakeElement {
		const child = new FakeElement("div", options);
		this.children.push(child);
		return child;
	}

	createSpan(options: ElementOptions = {}): FakeElement {
		const child = new FakeElement("span", options);
		this.children.push(child);
		return child;
	}

	createEl(tag: string, options: ElementOptions = {}): FakeElement {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}

	empty(): void {
		this.children = [];
	}

	addClass(cls: string): void {
		this.cls = `${this.cls} ${cls}`.trim();
	}

	setAttr(name: string, value: string): void {
		this.attr[name] = value;
	}

	addEventListener(event: string, listener: Listener): void {
		this.listeners.set(event, listener);
	}

	removeEventListener(): void {}
	scrollTo(): void {}

	click(): void {
		this.listeners.get("click")?.();
	}
}

function makeIssue(
	scannerId: ScannerId,
	severity: Issue["severity"],
	fingerprint: string,
	classification: FindingClassification = "confirmed",
): Issue {
	return {
		scannerId,
		severity,
		classification,
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		relatedPaths: [],
		evidence: {},
		fingerprint,
	};
}

const duplicateWarning = makeIssue("duplicate-files", "warning", "duplicate-warning");
const duplicateInfo = makeIssue("duplicate-files", "info", "duplicate-info");
const result: ScanResult = {
	startedAt: 0,
	finishedAt: 1000,
	issues: [
		makeIssue("broken-links", "error", "broken-error"),
		duplicateWarning,
		duplicateInfo,
	],
	ignoredIssues: [],
	filesScanned: 3,
	scannersRun: ["broken-links", "duplicate-files"],
};

function comparable(
	statuses: Array<[string, "new" | "persisting"]>,
): LifecycleComparison {
	return {
		available: true,
		statuses: new Map(statuses),
		resolvedIssues: [],
	};
}

function findByText(element: FakeElement, text: string): FakeElement | undefined {
	if (element.text === text) return element;
	for (const child of element.children) {
		const match = findByText(child, text);
		if (match) return match;
	}
	return undefined;
}

function findByClass(element: FakeElement, cls: string): FakeElement[] {
	const matches = element.cls.split(/\s+/).includes(cls) ? [element] : [];
	return matches.concat(element.children.flatMap((child) => findByClass(child, cls)));
}

function snapshotIssue(
	fingerprint: string,
	ignored: boolean,
	primaryPath: string,
): SnapshotIssue {
	return {
		fingerprint,
		scannerId: ignored ? "empty-notes" : "broken-links",
		severity: ignored ? "info" : "error",
		classification: "confirmed",
		title: fingerprint,
		message: fingerprint,
		primaryPath,
		relatedPaths: [],
		evidence: {},
		explanation: { why: "Previous finding.", nextStep: "No action required." },
		ignored,
	};
}

describe("InspectorView report filter wiring", () => {
	beforeEach(() => {
		renderIssueListMock.mockClear();
		renderResolvedChangesMock.mockClear();
		renderSummaryMock.mockClear();
		showFolderExclusionModalMock.mockReset();
		inspectorNoticeMessages.length = 0;
		vi.mocked(setTooltip).mockClear();
	});

	it("passes the global comparison to summary and filtered issues only to the issue list", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;
		(view as any).model.comparison = comparable([
			["broken-error", "new"],
			["duplicate-warning", "persisting"],
			["duplicate-info", "persisting"],
		]);
		(view as any).model.filterScanner = "duplicate-files";
		(view as any).model.filterSeverity = "error";

		(view as any).render();

		const summaryOptions = renderSummaryMock.mock.lastCall?.[2];
		expect.soft(summaryOptions).toEqual({
			comparison: (view as any).model.comparison,
			onFilterStatus: expect.any(Function),
			onReviewNewFindings: expect.any(Function),
		});
		expect.soft(summaryOptions).not.toHaveProperty("issues");
		expect.soft(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [] }),
		);

		const controls = container.children[0];
		expect(controls.tag).toBe("details");
		expect(controls.open).toBe(true);
		const controlsBody = findByClass(controls, "vi-controls-body")[0];
		const scannerButtons = controlsBody.children[0].children;
		const severityButtons = controlsBody.children[1].children;
		expect.soft(scannerButtons.map((button) => button.text)).toContain("Duplicate Files (0)");

		const activeError = severityButtons.find((button) => button.text === "Errors (0)");
		expect.soft(activeError?.cls ?? "").toContain("vi-active");

		severityButtons.find((button) => button.cls.includes("vi-active"))?.click();

		expect.soft(renderSummaryMock.mock.lastCall?.[2]).not.toHaveProperty("issues");
		expect.soft(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [duplicateInfo, duplicateWarning] }),
		);
	});

	it("hides lifecycle buttons when comparison is unavailable", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;

		(view as any).render();

		expect(findByText(container, "New (0)")).toBeUndefined();
		expect(findByText(container, "Previously found (0)")).toBeUndefined();
		expect(findByText(container, "Confirmed (3)")).toBeDefined();
	});

	it("passes the same lifecycle statuses to active and ignored issue lists", () => {
		const ignoredIssue = makeIssue("empty-notes", "info", "ignored-item");
		const statuses = new Map<string, "new" | "persisting">([
			["broken-error", "new"],
			["ignored-item", "persisting"],
		]);
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, ignoredIssues: [ignoredIssue] };
		(view as any).model.comparison = {
			available: true,
			statuses,
			resolvedIssues: [],
		};
		(view as any).model.ignoredExpanded = true;

		(view as any).render();

		const calls = renderIssueListMock.mock.calls;
		const activeCall = calls.find(([, config]) =>
			config.issues.some((issue: Issue) => issue.fingerprint === "broken-error"));
		const ignoredCall = calls.find(([, config]) =>
			config.issues.some((issue: Issue) => issue.fingerprint === "ignored-item"));
		expect(activeCall?.[1].statuses).toBe(statuses);
		expect(ignoredCall?.[1].statuses).toBe(statuses);
	});

	it("wires contextual controls only to active findings and confirms folder scope", async () => {
		const activeIssue = {
			...makeIssue("broken-links", "error", "active-item"),
			primaryPath: "notes/project/file.md",
		};
		const nestedIssue = {
			...makeIssue("broken-links", "warning", "nested-item"),
			primaryPath: "notes/project/nested/file.md",
		};
		const ignoredIssue = {
			...makeIssue("empty-notes", "info", "ignored-item"),
			primaryPath: "templates/empty.md",
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = {
			...result,
			issues: [activeIssue, nestedIssue],
			ignoredIssues: [ignoredIssue],
		};
		(view as any).model.ignoredExpanded = true;
		const onIgnoreIssue = vi.fn();
		const onExcludeFolder = vi.fn();
		const onOpenScannerSettings = vi.fn();
		const onFixAllIssues = vi.fn();
		view.setCallbacks({
			onIgnoreAllIssues: vi.fn(),
			onRestoreIssues: vi.fn(),
			onFixAllIssues,
			onRevealIssue: vi.fn(),
			onRunScan: vi.fn(),
			onIgnoreIssue,
			onExcludeFolder,
			onOpenScannerSettings,
		});
		showFolderExclusionModalMock.mockResolvedValue(true);

		(view as any).render();

		const activeConfig = renderIssueListMock.mock.calls.find(([, config]) =>
			config.issues.some((issue: Issue) => issue.fingerprint === "active-item"))?.[1];
		const ignoredConfig = renderIssueListMock.mock.calls.find(([, config]) =>
			config.issues.some((issue: Issue) => issue.fingerprint === "ignored-item"))?.[1];
		expect(activeConfig).toEqual(expect.objectContaining({
			onIgnoreIssue: expect.any(Function),
			onExcludeFolder: expect.any(Function),
			onOpenScannerSettings: expect.any(Function),
			onFixIssue: expect.any(Function),
		}));
		expect(ignoredConfig).not.toHaveProperty("onIgnoreIssue");
		expect(ignoredConfig).not.toHaveProperty("onExcludeFolder");
		expect(ignoredConfig).not.toHaveProperty("onOpenScannerSettings");
		expect(ignoredConfig).not.toHaveProperty("onFixIssue");

		await activeConfig.onFixIssue(activeIssue);
		expect(onFixAllIssues).toHaveBeenCalledWith([activeIssue]);
		activeConfig.onIgnoreIssue(activeIssue);
		activeConfig.onOpenScannerSettings("broken-links");
		await activeConfig.onExcludeFolder(activeIssue);
		expect(onIgnoreIssue).toHaveBeenCalledWith(activeIssue);
		expect(onOpenScannerSettings).toHaveBeenCalledWith("broken-links");
		expect(showFolderExclusionModalMock).toHaveBeenCalledWith(view.app, {
			scannerId: "broken-links",
			folder: "notes/project",
			affectedCount: 2,
		});
		expect(onExcludeFolder).toHaveBeenCalledWith({
			scannerId: "broken-links",
			folder: "notes/project",
			affectedCount: 2,
		});
	});

	it("does not dispatch a folder exclusion when confirmation is cancelled", async () => {
		const issue = {
			...makeIssue("broken-links", "error", "active-item"),
			primaryPath: "notes/project/file.md",
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, issues: [issue] };
		const onExcludeFolder = vi.fn();
		view.setCallbacks({
			onIgnoreAllIssues: vi.fn(),
			onRestoreIssues: vi.fn(),
			onFixAllIssues: vi.fn(),
			onRevealIssue: vi.fn(),
			onRunScan: vi.fn(),
			onIgnoreIssue: vi.fn(),
			onExcludeFolder,
			onOpenScannerSettings: vi.fn(),
		});
		showFolderExclusionModalMock.mockResolvedValue(false);
		(view as any).render();

		await renderIssueListMock.mock.lastCall?.[1].onExcludeFolder(issue);

		expect(onExcludeFolder).not.toHaveBeenCalled();
		expect(inspectorNoticeMessages).toEqual([]);
	});

	it("reports a rejected folder exclusion without dispatching the mutation", async () => {
		const issue = {
			...makeIssue("broken-links", "error", "active-item"),
			primaryPath: "notes/project/file.md",
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, issues: [issue] };
		const onExcludeFolder = vi.fn();
		view.setCallbacks({
			onIgnoreAllIssues: vi.fn(),
			onRestoreIssues: vi.fn(),
			onFixAllIssues: vi.fn(),
			onRevealIssue: vi.fn(),
			onRunScan: vi.fn(),
			onIgnoreIssue: vi.fn(),
			onExcludeFolder,
			onOpenScannerSettings: vi.fn(),
		});
		showFolderExclusionModalMock.mockRejectedValue(new Error("modal unavailable"));
		(view as any).render();

		await renderIssueListMock.mock.lastCall?.[1].onExcludeFolder(issue);

		expect(onExcludeFolder).not.toHaveBeenCalled();
		expect(inspectorNoticeMessages).toEqual([
			"Folder exclusion failed: modal unavailable",
		]);
	});

	it("reports an unexpected single-ignore rejection without leaking it", async () => {
		const issue = {
			...makeIssue("broken-links", "error", "active-item"),
			primaryPath: "notes/project/file.md",
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, issues: [issue] };
		view.setCallbacks({
			onIgnoreAllIssues: vi.fn(),
			onRestoreIssues: vi.fn(),
			onFixAllIssues: vi.fn(),
			onRevealIssue: vi.fn(),
			onRunScan: vi.fn(),
			onIgnoreIssue: vi.fn().mockRejectedValue(new Error("unexpected failure")),
			onExcludeFolder: vi.fn(),
			onOpenScannerSettings: vi.fn(),
		});
		(view as any).render();

		await renderIssueListMock.mock.lastCall?.[1].onIgnoreIssue(issue);

		await vi.waitFor(() => {
			expect(inspectorNoticeMessages).toEqual([
				"Ignoring issue failed: unexpected failure",
			]);
		});
	});

	it("clones operation outcome state before rendering", () => {
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).render = vi.fn();
		const outcomes = [{
			fingerprint: "active-item",
			outcome: "ignored" as const,
			message: "Ignored",
			affectedPaths: ["notes/file.md"],
		}];

		view.setOperationOutcomes(outcomes);
		outcomes.push({
			fingerprint: "later",
			outcome: "ignored",
			message: "Later",
			affectedPaths: [],
		});

		expect((view as any).model.operationOutcomes).toEqual([{
			fingerprint: "active-item",
			outcome: "ignored",
			message: "Ignored",
			affectedPaths: ["notes/file.md"],
		}]);
		expect((view as any).render).toHaveBeenCalledOnce();
	});

	it("passes the unavailable comparison's empty status map to issue lists", () => {
		const ignoredIssue = makeIssue("empty-notes", "info", "ignored-item");
		const statuses = new Map<string, "new" | "persisting">();
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, ignoredIssues: [ignoredIssue] };
		(view as any).model.comparison = {
			available: false,
			reason: "first-scan",
			statuses,
			resolvedIssues: [],
		};
		(view as any).model.ignoredExpanded = true;

		(view as any).render();

		expect(renderIssueListMock.mock.calls).toHaveLength(2);
		for (const [, config] of renderIssueListMock.mock.calls) {
			expect(config.statuses).toBe(statuses);
		}
	});

	it("filters the same visible issue list from lifecycle and classification controls", () => {
		const candidateNew = makeIssue("duplicate-files", "warning", "candidate-new", "candidate");
		const confirmedNew = makeIssue("broken-links", "error", "confirmed-new");
		const confirmedPersisting = makeIssue("empty-notes", "info", "confirmed-persisting");
		const lifecycleResult: ScanResult = {
			...result,
			issues: [candidateNew, confirmedNew, confirmedPersisting],
			scannersRun: ["broken-links", "empty-notes", "duplicate-files"],
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = lifecycleResult;
		(view as any).model.comparison = comparable([
			["candidate-new", "new"],
			["confirmed-new", "new"],
			["confirmed-persisting", "persisting"],
		]);

		(view as any).render();
		findByText(container, "New (2)")?.click();

		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [confirmedNew, candidateNew] }),
		);

		findByText(container, "Needs review (1)")?.click();

		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [candidateNew] }),
		);
	});

	it("enters and exits selection mode through the controls disclosure", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;

		(view as any).render();
		expect(container.children[0].open).toBe(false);
		findByText(container, "Select findings")?.click();

		expect((view as any).model.selectionMode).toBe(true);
		expect((view as any).model.controlsExpanded).toBe(true);
		expect(container.children[0].open).toBe(true);

		(view as any).model.selectedFingerprints = new Set(["broken-error"]);
		findByText(container, "Done selecting")?.click();

		expect((view as any).model.selectionMode).toBe(false);
		expect((view as any).model.selectedFingerprints).toEqual(new Set());
		expect((view as any).model.controlsExpanded).toBe(true);
	});

	it("keeps the disclosure open across re-renders after the user expands it", async () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;

		(view as any).render();
		expect(container.children[0].open).toBe(false);

		container.children[0].open = true;
		await Promise.resolve();
		expect((view as any).model.controlsExpanded).toBe(true);

		findByText(container, "Broken Links (1)")?.click();
		expect((view as any).model.filterScanner).toBe("broken-links");

		const reopened = container.children[0];
		expect(reopened.tag).toBe("details");
		expect(reopened.open).toBe(true);
	});

	it("keeps the disclosure collapsed across a no-op filter re-render", async () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;

		(view as any).render();

		const disclosure = container.children[0];
		disclosure.open = true;
		await Promise.resolve();
		disclosure.open = false;
		await Promise.resolve();
		expect((view as any).model.controlsExpanded).toBe(false);

		findByText(container, "All scanners")?.click();

		expect((view as any).model.filterScanner).toBeNull();
		const recollapsed = container.children[0];
		expect(recollapsed.tag).toBe("details");
		expect(recollapsed.open).toBe(false);
	});

	it("toggles lifecycle filtering from the summary headline", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;
		(view as any).model.comparison = comparable([
			["broken-error", "new"],
			["duplicate-warning", "persisting"],
			["duplicate-info", "persisting"],
		]);

		(view as any).render();
		const onFilterStatus = renderSummaryMock.mock.lastCall?.[2].onFilterStatus;
		onFilterStatus("new");

		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [result.issues[0]] }),
		);

		const nextCallback = renderSummaryMock.mock.lastCall?.[2].onFilterStatus;
		nextCallback("new");
		expect(renderIssueListMock.mock.lastCall?.[1].issues).toEqual([
			result.issues[0],
			duplicateInfo,
			duplicateWarning,
		]);
	});

	it("applies and releases the review-new preset without hiding other results", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		const newError = makeIssue("broken-links", "error", "new-confirmed");
		const newCandidate = makeIssue("broken-links", "error", "new-candidate", "candidate");
		const persisting = makeIssue("duplicate-files", "warning", "persisting-confirmed");
		(view as any).model.result = {
			...result,
			issues: [newError, newCandidate, persisting],
		};
		(view as any).model.comparison = comparable([
			["new-confirmed", "new"],
			["new-candidate", "new"],
			["persisting-confirmed", "persisting"],
		]);
		(view as any).model.filterSeverity = "warning";

		(view as any).render();
		renderSummaryMock.mock.lastCall?.[2].onReviewNewFindings();

		expect((view as any).model.filterStatus).toBe("new");
		expect((view as any).model.filterClassification).toBe("confirmed");
		expect((view as any).model.filterSeverity).toBeNull();
		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [newError] }),
		);

		renderSummaryMock.mock.lastCall?.[2].onReviewNewFindings();

		expect((view as any).model.filterStatus).toBeNull();
		expect((view as any).model.filterClassification).toBeNull();
		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [newError, persisting, newCandidate] }),
		);
	});

	it("retains globally available facets across scans and resets vanished facets", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.filterScanner = "broken-links";
		(view as any).model.filterSeverity = "error";
		(view as any).model.filterStatus = "persisting";
		(view as any).model.filterClassification = "candidate";

		const hiddenCandidate = makeIssue("duplicate-files", "warning", "candidate", "candidate");
		const retainedResult: ScanResult = {
			...result,
			issues: [result.issues[0], hiddenCandidate],
		};
		view.setResult(retainedResult, comparable([
			["broken-error", "new"],
			["candidate", "persisting"],
		]));

		expect((view as any).model.filterStatus).toBe("persisting");
		expect((view as any).model.filterClassification).toBe("candidate");

		view.setResult(result, comparable([
			["broken-error", "new"],
			["duplicate-warning", "new"],
			["duplicate-info", "new"],
		]));

		expect((view as any).model.filterStatus).toBeNull();
		expect((view as any).model.filterClassification).toBeNull();
	});

	it("resets lifecycle filters for unavailable comparisons but retains available classifications", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.filterStatus = "new";
		(view as any).model.filterClassification = "confirmed";

		view.setResult(result, {
			available: false,
			reason: "settings-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});

		expect((view as any).model.filterStatus).toBeNull();
		expect((view as any).model.filterClassification).toBe("confirmed");
	});

	it("initializes lifecycle filter state and resolved expansion", () => {
		const view = new InspectorView(new WorkspaceLeaf());

		expect((view as any).model.filterStatus).toBeNull();
		expect((view as any).model.filterClassification).toBeNull();
		expect((view as any).model.controlsExpanded).toBe(false);
		expect((view as any).model.resolvedExpanded).toBe(false);
	});

	it("collapses the controls disclosure when an accepted result leaves no filter", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.controlsExpanded = true;
		(view as any).model.filterStatus = "new";

		view.setResult(result, comparable([
			["broken-error", "persisting"],
			["duplicate-warning", "persisting"],
			["duplicate-info", "persisting"],
		]));

		expect((view as any).model.filterStatus).toBeNull();
		expect((view as any).model.controlsExpanded).toBe(false);
	});

	it("expands and collapses an accessible read-only resolved section before ignored items", () => {
		const activeResolved = snapshotIssue("active-resolved", false, "Notes/source.md");
		const ignoredResolved = snapshotIssue("ignored-resolved", true, "Archive/empty.md");
		const currentIgnored = makeIssue("empty-notes", "info", "current-ignored");
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, ignoredIssues: [currentIgnored] };
		(view as any).model.comparison = {
			available: true,
			statuses: new Map(),
			resolvedIssues: [activeResolved, ignoredResolved],
		};

		(view as any).render();

		let header = findByText(container, "Resolved items (2)");
		expect(header?.tag).toBe("button");
		expect(header?.attr).toMatchObject({ type: "button", "aria-expanded": "false" });
		expect(renderResolvedChangesMock).not.toHaveBeenCalled();
		expect(findByClass(container, "vi-resolved-section")).toHaveLength(1);
		expect(container.children.findIndex((child) => child.cls === "vi-issues"))
			.toBeLessThan(container.children.findIndex((child) => child.cls === "vi-resolved-section"));
		expect(container.children.findIndex((child) => child.cls === "vi-resolved-section"))
			.toBeLessThan(container.children.findIndex((child) => child.cls === "vi-ignored-section"));
		expect(header?.children.some((child) =>
			["input", "select"].includes(child.tag) || /vi-(?:select|action|filter)/.test(child.cls)))
			.toBe(false);

		header?.click();

		expect((view as any).model.resolvedExpanded).toBe(true);
		expect(renderResolvedChangesMock).toHaveBeenCalledOnce();
		expect(renderResolvedChangesMock).toHaveBeenCalledWith(
			expect.any(FakeElement),
			[activeResolved, ignoredResolved],
		);
		header = findByText(container, "Resolved items (2)");
		expect(header?.attr["aria-expanded"]).toBe("true");

		header?.click();

		expect((view as any).model.resolvedExpanded).toBe(false);
		expect(renderResolvedChangesMock).toHaveBeenCalledOnce();
	});

	it("hides resolved findings for unavailable and empty comparisons", () => {
		for (const comparison of [
			{
				available: false,
				reason: "first-scan" as const,
				statuses: new Map(),
				resolvedIssues: [snapshotIssue("stale", false, "Notes/stale.md")],
			},
			{ available: true, statuses: new Map(), resolvedIssues: [] },
		]) {
			const container = new FakeElement();
			const view = new InspectorView(new WorkspaceLeaf());
			(view as any).containerEl.children[1] = container;
			(view as any).model.result = result;
			(view as any).model.comparison = comparison;

			(view as any).render();

			expect(findByClass(container, "vi-resolved-section")).toHaveLength(0);
		}
	});

	it("never passes snapshot resolved findings to active or ignored issue lists", () => {
		const currentIgnored = makeIssue("empty-notes", "info", "current-ignored");
		const resolved = snapshotIssue("snapshot-resolved", false, "Notes/resolved.md");
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, ignoredIssues: [currentIgnored] };
		(view as any).model.comparison = {
			available: true,
			statuses: new Map(),
			resolvedIssues: [resolved],
		};
		(view as any).model.ignoredExpanded = true;

		(view as any).render();

		expect(renderIssueListMock.mock.calls).toHaveLength(2);
		for (const [, config] of renderIssueListMock.mock.calls) {
			expect(config.issues.map((issue: Issue) => issue.fingerprint)).not.toContain(
				"snapshot-resolved",
			);
		}
		expect(renderIssueListMock.mock.calls.flatMap(([, config]) =>
			config.issues.map((issue: Issue) => issue.fingerprint))).toEqual(
			expect.arrayContaining(["broken-error", "current-ignored"]),
		);
	});

	it("renders outcomes after the summary, before actions, and dismisses cloned state", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;
		(view as any).model.selectionMode = true;
		const affectedPaths = ["Notes/source.md"];
		renderSummaryMock.mockImplementationOnce((summaryContainer: FakeElement) => {
			summaryContainer.createDiv({ cls: "summary-marker" });
		});

		view.setOperationOutcomes([{
			fingerprint: "broken-error",
			outcome: "failed",
			phase: "execution",
			message: "Permission denied",
			affectedPaths,
		}]);
		affectedPaths.push("mutated-after-set.md");

		const summaryIndex = container.children.findIndex(
			(child) => child.cls === "summary-marker",
		);
		const outcomesIndex = container.children.findIndex(
			(child) => child.cls === "vi-outcomes",
		);
		const actionsIndex = container.children.findIndex(
			(child) => child.cls === "vi-action-bar",
		);
		expect(summaryIndex).toBeGreaterThanOrEqual(0);
		expect(outcomesIndex).toBeGreaterThan(summaryIndex);
		expect(actionsIndex).toBeGreaterThan(outcomesIndex);
		expect(findByText(container, "Notes/source.md")).toBeDefined();
		expect(findByText(container, "mutated-after-set.md")).toBeUndefined();

		const dismiss = findByClass(container, "vi-outcomes-dismiss")[0];
		expect(dismiss).toMatchObject({ tag: "button", attr: { type: "button" } });
		dismiss.click();

		expect((view as any).model.operationOutcomes).toEqual([]);
		expect(findByClass(container, "vi-outcomes")).toHaveLength(0);
	});

	it("reports an unexpected batch-fix callback rejection", async () => {
		const fixableIssue: Issue = {
			...makeIssue("broken-links", "warning", "fixable"),
			eligibility: "eligible",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove a broken link",
				targetPaths: ["Source.md"],
				linkText: "Missing",
			},
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = { ...result, issues: [fixableIssue] };
		(view as any).model.selectionMode = true;
		(view as any).model.selectedFingerprints = new Set([fixableIssue.fingerprint]);
		view.setCallbacks({
			onIgnoreAllIssues: vi.fn(),
			onRestoreIssues: vi.fn(),
			onFixAllIssues: vi.fn().mockRejectedValue(new Error("original")),
			onRevealIssue: vi.fn(),
			onRunScan: vi.fn(),
			onIgnoreIssue: vi.fn(),
			onExcludeFolder: vi.fn(),
			onOpenScannerSettings: vi.fn(),
		});

		(view as any).render();
		findByClass(container, "vi-action-delete")[0].click();

		await vi.waitFor(() => expect(inspectorNoticeMessages).toEqual([
			"Fixing issues failed: original",
		]));
	});

	it("describes mixed fix actions without claiming every action trashes a file", () => {
		const modifyIssue: Issue = {
			...makeIssue("broken-links", "warning", "modify-link"),
			eligibility: "eligible",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove a broken link",
				targetPaths: ["Source.md"],
				linkText: "Missing",
			},
		};
		const trashIssue: Issue = {
			...makeIssue("empty-notes", "warning", "trash-note"),
			eligibility: "eligible",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: "Move note to trash",
				targetPaths: ["Empty.md"],
			},
		};
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = {
			...result,
			issues: [modifyIssue, trashIssue],
		};
		(view as any).model.selectionMode = true;
		(view as any).model.selectedFingerprints = new Set([
			modifyIssue.fingerprint,
			trashIssue.fingerprint,
		]);

		(view as any).render();

		expect(setTooltip).toHaveBeenCalledWith(
			expect.any(FakeElement),
			"Modify 1 note and move 1 file to trash",
		);
	});
});
