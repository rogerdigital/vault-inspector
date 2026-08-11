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

const { renderIssueListMock, renderResolvedChangesMock, renderSummaryMock } = vi.hoisted(() => ({
	renderIssueListMock: vi.fn(),
	renderResolvedChangesMock: vi.fn(),
	renderSummaryMock: vi.fn(),
}));

vi.mock("../report/render-issues", () => ({
	renderIssueList: renderIssueListMock,
}));

vi.mock("../report/render-summary", () => ({
	renderSummary: renderSummaryMock,
}));

vi.mock("../report/render-changes", () => ({
	renderResolvedChanges: renderResolvedChangesMock,
}));

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
	private listeners = new Map<string, Listener>();

	constructor(
		readonly tag = "div",
		options: ElementOptions = {},
	) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
		this.attr = options.attr ?? {};
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
		});
		expect.soft(summaryOptions).not.toHaveProperty("issues");
		expect.soft(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [] }),
		);

		const toolbar = container.children[0];
		const scannerButtons = toolbar.children[0].children;
		const severityButtons = toolbar.children[1].children;
		expect.soft(scannerButtons.map((button) => button.text)).toContain("Duplicate Files (0)");

		const activeError = severityButtons.find((button) => button.text === "error (0)");
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

		expect(findByText(container, "new (0)")).toBeUndefined();
		expect(findByText(container, "persisting (0)")).toBeUndefined();
		expect(findByText(container, "confirmed (3)")).toBeDefined();
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
		findByText(container, "new (2)")?.click();

		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [confirmedNew, candidateNew] }),
		);

		findByText(container, "candidate (1)")?.click();

		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [candidateNew] }),
		);
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
		expect((view as any).model.resolvedExpanded).toBe(false);
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

	it("describes mixed fix actions without claiming every action trashes a file", () => {
		const modifyIssue: Issue = {
			...makeIssue("broken-links", "warning", "modify-link"),
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
