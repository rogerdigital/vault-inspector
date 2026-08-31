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

const result: ScanResult = {
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

function availableComparison(): LifecycleComparison {
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

describe("renderSummary", () => {
	it("leads with new confirmed errors and warnings before aggregate totals", () => {
		const container = new FakeElement();
		const onFilterStatus = vi.fn();
		const onReviewNewFindings = vi.fn();

		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
			onFilterStatus,
			onReviewNewFindings,
		});

		const text = flatten(container);
		expect(text).toContain("What changed");
		expect(text).toContain("Compared with the scan from");
		expect(text).toContain("New errors1New warnings1Persisting2Resolved1");
		expect(text).toContain("Active5");
		expect(text).toContain("8 files scanned1.0s2 scannersIgnored 2");
		expect(text.indexOf("New errors1")).toBeGreaterThan(0);
		expect(text.indexOf("New errors1")).toBeLessThan(text.indexOf("Active5"));
	});

	it("counts only confirmed new findings in the headline", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("New errors1");
		expect(text).toContain("New warnings1");
		expect(text).not.toContain("New errors2");
		expect(text).not.toContain("New warnings2");
	});

	it("keeps persisting as the only summary status-filter button", () => {
		const container = new FakeElement();
		const onFilterStatus = vi.fn();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
			onFilterStatus,
		});

		const newErrors = findByText(container, "New errors1");
		const newWarnings = findByText(container, "New warnings1");
		const persisting = findByText(container, "Persisting2");
		const resolved = findByText(container, "Resolved1");
		expect(newErrors?.tag).toBe("div");
		expect(newWarnings?.tag).toBe("div");
		expect(persisting?.tag).toBe("button");
		expect(persisting?.attr).toEqual({ type: "button" });
		expect(persisting?.cls).toContain("vi-stat-persisting");
		expect(resolved?.tag).toBe("div");

		persisting?.click();
		expect(onFilterStatus.mock.calls).toEqual([["persisting"]]);
	});

	it("offers a review control reporting the new confirmed count", () => {
		const container = new FakeElement();
		const onReviewNewFindings = vi.fn();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
			onReviewNewFindings,
		});

		const button = findByText(container, "Review new findings (2)");
		expect(button?.tag).toBe("button");
		expect(button?.attr).toEqual({ type: "button" });
		expect(button?.cls).toContain("vi-review-new-btn");

		button?.click();
		expect(onReviewNewFindings).toHaveBeenCalledTimes(1);
	});

	it("omits the review control without new confirmed findings or a callback", () => {
		const persistingOnly = { ...result, issues: [activeIssue("persisting-a")] };

		const noNewConfirmed = new FakeElement();
		renderSummary(noNewConfirmed as unknown as HTMLElement, persistingOnly, {
			comparison: {
				...availableComparison(),
				statuses: new Map([["persisting-a", "persisting"]]),
			},
			onReviewNewFindings: vi.fn(),
		});
		expect(flatten(noNewConfirmed)).not.toContain("Review new findings");

		const noCallback = new FakeElement();
		renderSummary(noCallback as unknown as HTMLElement, result, {
			comparison: availableComparison(),
		});
		expect(flatten(noCallback)).not.toContain("Review new findings");
	});

	it("shows the previous scan time next to each unavailable reason", () => {
		for (const reason of [
			"first-scan",
			"settings-changed",
			"semantics-changed",
		] as const) {
			const container = new FakeElement();
			renderSummary(container as unknown as HTMLElement, result, {
				comparison: {
					available: false,
					reason,
					previousScanAt: 1_000,
					statuses: new Map(),
					resolvedIssues: [],
				},
			});

			const text = flatten(container);
			expect(text).toContain("previous successful scan:");
			if (reason === "settings-changed") {
				expect(text).toContain("Scan settings changed; this scan starts a new comparison baseline");
			} else if (reason === "semantics-changed") {
				expect(text).toContain("Scanner behavior changed; this scan starts a new comparison baseline");
			} else {
				expect(text).toContain("No previous successful scan for these settings");
			}
		}
	});

	it("renders no time and no lifecycle stats for a first scan", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: {
				available: false,
				reason: "first-scan",
				statuses: new Map(),
				resolvedIssues: [],
			},
		});

		const text = flatten(container);
		expect(text).toContain("No previous successful scan for these settings");
		expect(text).not.toContain("previous successful scan:");
		expect(text).not.toContain("New errors");
		expect(text).not.toContain("New warnings");
		expect(text).not.toContain("Persisting");
		expect(text).not.toContain("Resolved");
		expect(text).not.toContain("Compared with the scan from");
		expect(text).toContain("Active5");
	});
});
