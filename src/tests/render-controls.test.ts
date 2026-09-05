import { describe, expect, it, vi } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import type { CurrentFindingStatus } from "../scanner/result-diff";
import { buildIssueFilterView, type IssueFilters } from "../report/report-model";
import {
	activeFilterCount,
	renderReportControls,
	type ReportControlsConfig,
} from "../report/render-controls";

type ElementOptions = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
};

type Listener = () => void;

class FakeElement {
	children: FakeElement[] = [];
	cls: string;
	text: string | null;
	attr: Record<string, string> = {};
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

	get open(): boolean {
		return this.openState;
	}

	/**
	 * Mirrors the HTML spec: assigning open queues a toggle event as a task,
	 * so listeners observe the change asynchronously — including listeners
	 * attached after the assignment, like the renderer's own toggle handler.
	 */
	set open(value: boolean) {
		if (this.openState === value) return;
		this.openState = value;
		queueMicrotask(() => {
			this.listeners.get("toggle")?.();
		});
	}

	get textContent(): string {
		return [this, ...this.children.flatMap(flatten)]
			.map((node) => node.text ?? "")
			.join("");
	}

	createDiv(options: ElementOptions = {}): FakeElement {
		return this.append("div", options);
	}

	createEl(tag: string, options: ElementOptions = {}): FakeElement {
		return this.append(tag, options);
	}

	setAttr(name: string, value: string): void {
		this.attr[name] = value;
	}

	addEventListener(event: string, listener: Listener): void {
		this.listeners.set(event, listener);
	}

	click(): void {
		this.listeners.get("click")?.();
	}

	private append(tag: string, options: ElementOptions): FakeElement {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}
}

function flatten(element: FakeElement): FakeElement[] {
	return [element, ...element.children.flatMap(flatten)];
}

function findButton(root: FakeElement, text: string): FakeElement | undefined {
	return flatten(root).find((node) => node.tag === "button" && node.text === text);
}

function findSummary(root: FakeElement): FakeElement | undefined {
	return flatten(root).find((node) => node.tag === "summary");
}

function makeIssue(): Issue {
	return {
		scannerId: "broken-links",
		severity: "error",
		classification: "candidate",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: "fixture",
		message: "fixture",
		relatedPaths: [],
		evidence: {},
		fingerprint: "fixture",
	};
}

const fixtureResult: ScanResult = {
	startedAt: 0,
	finishedAt: 1000,
	issues: [makeIssue()],
	ignoredIssues: [],
	filesScanned: 1,
	scannersRun: ["broken-links"],
};
const fixtureStatuses = new Map<string, CurrentFindingStatus>([["fixture", "new"]]);
const emptyFilters: IssueFilters = {
	scanner: null,
	severity: null,
	status: null,
	classification: null,
};

function renderControls(
	overrides: Partial<ReportControlsConfig> = {},
): { details: FakeElement; config: ReportControlsConfig } {
	const config: ReportControlsConfig = {
		result: fixtureResult,
		filterView: buildIssueFilterView(
			fixtureResult.issues,
			emptyFilters,
			fixtureStatuses,
		),
		filters: emptyFilters,
		comparisonAvailable: true,
		expanded: false,
		selectionMode: false,
		onExpandedChange: vi.fn(),
		onFiltersChange: vi.fn(),
		onSelectionModeChange: vi.fn(),
		...overrides,
	};
	const container = new FakeElement();
	const details = renderReportControls(
		container as unknown as HTMLElement,
		config,
	);
	return { details: details as unknown as FakeElement, config };
}

describe("renderReportControls", () => {
	it("collapses optional controls when no filter is active", () => {
		const { details } = renderControls({
			filters: emptyFilters,
			expanded: false,
			selectionMode: false,
		});

		expect(details.open).toBe(false);
		expect(details.textContent).toContain("Filter and select");
		expect(details.textContent).not.toContain("active");
	});

	it("opens controls when a filter is active or selection mode is on", () => {
		const { details: filtered } = renderControls({
			filters: { ...emptyFilters, severity: "error", status: "new" },
			expanded: false,
			selectionMode: false,
		});
		const { details: selecting } = renderControls({
			filters: emptyFilters,
			expanded: false,
			selectionMode: true,
		});

		expect(filtered.open).toBe(true);
		expect(selecting.open).toBe(true);
	});

	it("opens controls from the remembered expanded state alone", () => {
		const { details } = renderControls({
			filters: emptyFilters,
			expanded: true,
			selectionMode: false,
		});

		expect(details.open).toBe(true);
	});

	it("reports the number of active filters in the summary and aria-label", () => {
		const { details } = renderControls({
			filters: { ...emptyFilters, severity: "error", status: "new" },
		});
		const summary = findSummary(details);

		expect(details.textContent).toContain("Filter and select · 2 active");
		expect(summary?.text).toBe("Filter and select · 2 active");
		expect(summary?.attr["aria-label"]).toBe(
			"Filter and select, 2 active filters",
		);
	});

	it("counts only non-null filters", () => {
		expect(activeFilterCount(emptyFilters)).toBe(0);
		expect(activeFilterCount({ ...emptyFilters, scanner: "broken-links" })).toBe(1);
		expect(
			activeFilterCount({
				scanner: "broken-links",
				severity: "error",
				status: "new",
				classification: "candidate",
			}),
		).toBe(4);
	});

	it("preserves scanner, severity, lifecycle, classification, and selection callbacks", () => {
		const onFiltersChange = vi.fn();
		const onSelectionModeChange = vi.fn();
		const { details } = renderControls({ onFiltersChange, onSelectionModeChange });

		findButton(details, "Broken Links (1)")?.click();
		findButton(details, "Errors (1)")?.click();
		findButton(details, "New (1)")?.click();
		findButton(details, "Needs review (1)")?.click();
		findButton(details, "Select findings")?.click();

		expect(onFiltersChange).toHaveBeenCalledTimes(4);
		expect(onFiltersChange).toHaveBeenNthCalledWith(1, {
			...emptyFilters,
			scanner: "broken-links",
		});
		expect(onFiltersChange).toHaveBeenNthCalledWith(2, {
			...emptyFilters,
			severity: "error",
		});
		expect(onFiltersChange).toHaveBeenNthCalledWith(3, {
			...emptyFilters,
			status: "new",
		});
		expect(onFiltersChange).toHaveBeenNthCalledWith(4, {
			...emptyFilters,
			classification: "candidate",
		});
		expect(onSelectionModeChange).toHaveBeenCalledWith(true);
	});

	it("releases a filter on its own active button and keeps buttons accessible", () => {
		const onFiltersChange = vi.fn();
		const { details } = renderControls({
			filters: { ...emptyFilters, scanner: "broken-links" },
			onFiltersChange,
		});
		const activeButton = findButton(details, "Broken Links (1)");
		const idleButton = findButton(details, "All scanners");

		expect(activeButton?.cls).toContain("vi-active");
		expect(activeButton?.attr).toMatchObject({
			type: "button",
			"aria-pressed": "true",
		});
		expect(idleButton?.attr).toMatchObject({ "aria-pressed": "false" });

		activeButton?.click();
		idleButton?.click();

		expect(onFiltersChange).toHaveBeenNthCalledWith(1, { ...emptyFilters });
		expect(onFiltersChange).toHaveBeenNthCalledWith(2, { ...emptyFilters });
	});

	it("hides lifecycle controls when no comparison is available", () => {
		const { details } = renderControls({ comparisonAvailable: false });

		expect(findButton(details, "New (1)")).toBeUndefined();
		expect(details.textContent).not.toContain("New (1)");

		const { details: compared } = renderControls({ comparisonAvailable: true });
		expect(findButton(compared, "New (1)")).toBeDefined();
	});

	it("labels the selection toggle for the current mode and exits it", () => {
		const onSelectionModeChange = vi.fn();
		const { details: idle } = renderControls({ selectionMode: false });
		const { details: selecting } = renderControls({
			selectionMode: true,
			onSelectionModeChange,
		});

		expect(findButton(idle, "Select findings")).toBeDefined();
		expect(findButton(idle, "Done selecting")).toBeUndefined();
		expect(findButton(selecting, "Done selecting")).toBeDefined();

		findButton(selecting, "Done selecting")?.click();
		expect(onSelectionModeChange).toHaveBeenCalledWith(false);
	});

	it("clears every filter at once and only offers clearing while filtering", () => {
		const onFiltersChange = vi.fn();
		const { details } = renderControls({
			filters: { ...emptyFilters, scanner: "broken-links" },
			onFiltersChange,
		});
		const { details: clean } = renderControls();

		expect(findButton(clean, "Clear filters")).toBeUndefined();

		findButton(details, "Clear filters")?.click();
		expect(onFiltersChange).toHaveBeenCalledWith({
			scanner: null,
			severity: null,
			status: null,
			classification: null,
		});
	});

	it("reports disclosure toggles asynchronously after each user toggle", async () => {
		const onExpandedChange = vi.fn();
		const { details } = renderControls({ onExpandedChange });

		expect(onExpandedChange).not.toHaveBeenCalled();

		details.open = true;
		await Promise.resolve();
		expect(onExpandedChange).toHaveBeenCalledWith(true);

		details.open = false;
		await Promise.resolve();
		expect(onExpandedChange).toHaveBeenLastCalledWith(false);
		expect(onExpandedChange).toHaveBeenCalledTimes(2);
	});

	it("auto-open asynchronously syncs onExpandedChange", async () => {
		const onExpandedChange = vi.fn();
		const { details: filtered } = renderControls({
			filters: { ...emptyFilters, severity: "error" },
			expanded: false,
			onExpandedChange,
		});
		const { details: selecting } = renderControls({
			filters: emptyFilters,
			selectionMode: true,
			onExpandedChange,
		});

		expect(filtered.open).toBe(true);
		expect(selecting.open).toBe(true);
		expect(onExpandedChange).not.toHaveBeenCalled();

		await Promise.resolve();

		expect(onExpandedChange).toHaveBeenCalledTimes(2);
		expect(onExpandedChange).toHaveBeenNthCalledWith(1, true);
		expect(onExpandedChange).toHaveBeenNthCalledWith(2, true);
	});

	it("does not queue a toggle when the open state is unchanged", async () => {
		const onExpandedChange = vi.fn();
		renderControls({ onExpandedChange });

		await Promise.resolve();

		expect(onExpandedChange).not.toHaveBeenCalled();
	});
});
