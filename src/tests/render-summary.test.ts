import { describe, expect, it, vi } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import type { SnapshotIssue } from "../snapshot/scan-snapshot";
import { renderSummary } from "../report/render-summary";

type Listener = () => void;

class FakeElement {
	children: FakeElement[] = [];
	text: string | null;
	cls: string;
	tag: string;
	attr: Record<string, string>;
	private listeners = new Map<string, Listener>();

	constructor(
		tag = "div",
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	) {
		this.text = options.text ?? null;
		this.cls = options.cls ?? "";
		this.tag = tag;
		this.attr = options.attr ?? {};
	}

	createDiv(
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	): FakeElement {
		return this.addChild("div", options);
	}

	createSpan(
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	): FakeElement {
		return this.addChild("span", options);
	}

	createEl(
		tag: string,
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	): FakeElement {
		return this.addChild(tag, options);
	}

	addClass(cls: string): void {
		this.cls = `${this.cls} ${cls}`.trim();
	}

	addEventListener(event: string, listener: Listener): void {
		this.listeners.set(event, listener);
	}

	click(): void {
		this.listeners.get("click")?.();
	}

	private addChild(
		tag: string,
		options: { text?: string; cls?: string; attr?: Record<string, string> },
	): FakeElement {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}
}

function flatten(element: FakeElement): string {
	return `${element.text ?? ""}${element.children.map(flatten).join("")}`;
}

function findByText(element: FakeElement, text: string): FakeElement | undefined {
	if (flatten(element) === text) return element;
	for (const child of element.children) {
		const match = findByText(child, text);
		if (match) return match;
	}
	return undefined;
}

function snapshotIssue(fingerprint: string, ignored: boolean): SnapshotIssue {
	return {
		fingerprint,
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
		title: fingerprint,
		message: fingerprint,
		relatedPaths: [],
		evidence: {},
		explanation: { why: "why", nextStep: "next" },
		ignored,
	};
}

function activeIssue(
	fingerprint: string,
	severity: Issue["severity"] = "error",
	classification: Issue["classification"] = "confirmed",
): Issue {
	return {
		scannerId: "broken-links",
		severity,
		classification,
		title: fingerprint,
		message: fingerprint,
		relatedPaths: [],
		evidence: {},
		explanation: { why: "why", nextStep: "next" },
		fingerprint,
	};
}

const resultWithLifecycle: ScanResult = {
	startedAt: 0,
	finishedAt: 1000,
	issues: [
		activeIssue("new-error"),
		activeIssue("new-warning", "warning"),
		activeIssue("new-candidate", "error", "candidate"),
		activeIssue("persisting-a"),
		activeIssue("persisting-b"),
	],
	ignoredIssues: [
		activeIssue("ignored-a"),
		activeIssue("ignored-b"),
	],
	filesScanned: 8,
	scannersRun: ["broken-links", "empty-notes"],
};

function compatibleComparison(): LifecycleComparison {
	return {
		available: true,
		previousScanAt: 1_000,
		statuses: new Map([
			["new-error", "new"],
			["new-warning", "new"],
			["new-candidate", "new"],
			["persisting-a", "persisting"],
			["persisting-b", "persisting"],
		]),
		resolvedIssues: [
			snapshotIssue("resolved-active", false),
			snapshotIssue("resolved-ignored", true),
		],
	};
}

function firstScanComparison(): LifecycleComparison {
	return {
		available: false,
		reason: "first-scan",
		statuses: new Map(),
		resolvedIssues: [],
	};
}

function settingsChangedComparison(previousScanAt?: number): LifecycleComparison {
	return {
		available: false,
		reason: "settings-changed",
		previousScanAt,
		statuses: new Map(),
		resolvedIssues: [],
	};
}

function semanticsChangedComparison(previousScanAt?: number): LifecycleComparison {
	return {
		available: false,
		reason: "semantics-changed",
		previousScanAt,
		statuses: new Map(),
		resolvedIssues: [],
	};
}

describe("renderSummary", () => {
	it("shows new and resolved findings as the primary compatible-scan result", () => {
		const container = new FakeElement();
		const onReviewNewFindings = vi.fn();

		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: compatibleComparison(),
			onReviewNewFindings,
		});

		const text = flatten(container);
		expect(text).toContain("2 new findings");
		expect(text).toContain("1 resolved");
		expect(text).toContain("Review new findings");
		expect(text).toContain("2 previously found");
		expect(text).toContain("5 active");
		expect(text).toContain("compared with");
		expect(text).not.toContain("PERSISTING");
		expect(text).toContain("8 files scanned1.0s2 scannersIgnored 2");
		expect(findByText(container, "2 new findings")?.cls).toContain("vi-changes-primary");
		expect(findByText(container, "1 resolved")?.cls).toContain("vi-changes-resolved");
	});

	it("counts only confirmed new findings in the headline", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: compatibleComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("2 new findings");
		expect(text).not.toContain("3 new findings");
	});

	it("uses the singular form for one new finding", () => {
		const singleNew = { ...resultWithLifecycle, issues: [activeIssue("new-error")] };
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, singleNew, {
			comparison: compatibleComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("1 new finding");
		expect(text).not.toContain("1 new findings");
	});

	it("uses the singular form for one active finding on a first scan", () => {
		const singleActive = { ...resultWithLifecycle, issues: [activeIssue("only-issue")] };
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, singleActive, {
			comparison: firstScanComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("1 active finding");
		expect(text).not.toContain("1 active findings");
		expect(text).toContain("Future scans will highlight what changed");
	});

	it("uses a scan-complete result when there is no compatible baseline", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: firstScanComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("Scan complete");
		expect(text).toContain("5 active findings");
		expect(text).toContain("Future scans will highlight what changed");
		expect(text).not.toContain("previous successful scan:");
		expect(text).not.toContain("new findings");
		expect(text).not.toContain("previously found");
		expect(text).not.toContain("resolved");
	});

	it("explains a restarted comparison without presenting false lifecycle counts", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: settingsChangedComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("Comparison restarted");
		expect(text).toContain("Scan settings changed");
		expect(text).not.toContain("new findings");
		expect(text).not.toContain("previously found");
		expect(text).not.toContain("resolved");
	});

	it("cites the previous successful scan when settings restart the comparison", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: settingsChangedComparison(1_000),
		});

		const text = flatten(container);
		expect(text).toContain("Scan settings changed; this scan is the new baseline.");
		expect(text).toContain("previous successful scan:");
	});

	it("explains a scanner-behavior restart like a settings restart", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: semanticsChangedComparison(1_000),
		});

		const text = flatten(container);
		expect(text).toContain("Comparison restarted");
		expect(text).toContain("Scanner behavior changed; this scan is the new baseline.");
		expect(text).toContain("previous successful scan:");
	});

	it("offers a review control when there are new confirmed findings", () => {
		const container = new FakeElement();
		const onReviewNewFindings = vi.fn();
		renderSummary(container as unknown as HTMLElement, resultWithLifecycle, {
			comparison: compatibleComparison(),
			onReviewNewFindings,
		});

		const button = findByText(container, "Review new findings");
		expect(button?.tag).toBe("button");
		expect(button?.attr).toEqual({ type: "button" });
		expect(button?.cls).toContain("vi-review-new-btn");
		expect(button?.cls).toContain("mod-cta");

		button?.click();
		expect(onReviewNewFindings).toHaveBeenCalledTimes(1);
	});

	it("omits the review control without new confirmed findings or a callback", () => {
		const persistingOnly = { ...resultWithLifecycle, issues: [activeIssue("persisting-a")] };

		const noNewConfirmed = new FakeElement();
		renderSummary(noNewConfirmed as unknown as HTMLElement, persistingOnly, {
			comparison: {
				...compatibleComparison(),
				statuses: new Map([["persisting-a", "persisting"]]),
			},
			onReviewNewFindings: vi.fn(),
		});
		expect(flatten(noNewConfirmed)).not.toContain("Review new findings");

		const noCallback = new FakeElement();
		renderSummary(noCallback as unknown as HTMLElement, resultWithLifecycle, {
			comparison: compatibleComparison(),
		});
		expect(flatten(noCallback)).not.toContain("Review new findings");
	});
});
