import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTooltip, WorkspaceLeaf } from "obsidian";
import type { Issue, ScanResult, ScannerId } from "../scanner/Issue";

const { renderIssueListMock, renderSummaryMock } = vi.hoisted(() => ({
	renderIssueListMock: vi.fn(),
	renderSummaryMock: vi.fn(),
}));

vi.mock("../report/render-issues", () => ({
	renderIssueList: renderIssueListMock,
}));

vi.mock("../report/render-summary", () => ({
	renderSummary: renderSummaryMock,
}));

import { InspectorView } from "../report/InspectorView";

type Listener = () => void;

class FakeElement {
	children: FakeElement[] = [];
	cls: string;
	text: string | null;
	style = { display: "" };
	scrollTop = 0;
	private listeners = new Map<string, Listener>();

	constructor(options: { cls?: string; text?: string } = {}) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
	}

	createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
		const child = new FakeElement(options);
		this.children.push(child);
		return child;
	}

	createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
		const child = new FakeElement(options);
		this.children.push(child);
		return child;
	}

	createEl(_tag: string, options: { cls?: string; text?: string } = {}): FakeElement {
		const child = new FakeElement(options);
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

function makeIssue(scannerId: ScannerId, severity: Issue["severity"], fingerprint: string): Issue {
	return {
		scannerId,
		severity,
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

describe("InspectorView report filter wiring", () => {
	beforeEach(() => {
		renderIssueListMock.mockClear();
		renderSummaryMock.mockClear();
		vi.mocked(setTooltip).mockClear();
	});

	it("passes the same filtered view to summary, toolbar, and issue list", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		(view as any).model.result = result;
		(view as any).model.filterScanner = "duplicate-files";
		(view as any).model.filterSeverity = "error";

		(view as any).render();

		expect.soft(renderSummaryMock).toHaveBeenLastCalledWith(
			container,
			result,
			expect.objectContaining({ issues: [] }),
		);
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

		expect.soft(renderSummaryMock).toHaveBeenLastCalledWith(
			container,
			result,
			expect.objectContaining({ issues: [duplicateWarning, duplicateInfo] }),
		);
		expect.soft(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [duplicateWarning, duplicateInfo] }),
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
