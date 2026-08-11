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

function activeIssue(fingerprint: string): Issue {
	return {
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
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
		activeIssue("new"),
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

describe("renderSummary", () => {
	it("shows comparable lifecycle counts in order and excludes ignored resolved findings", () => {
		const container = new FakeElement();
		const onFilterStatus = vi.fn();
		const comparison: LifecycleComparison = {
			available: true,
			statuses: new Map([
				["new", "new"],
				["persisting-a", "persisting"],
				["persisting-b", "persisting"],
			]),
			resolvedIssues: [
				snapshotIssue("resolved-active", false),
				snapshotIssue("resolved-ignored", true),
			],
		};

		renderSummary(container as unknown as HTMLElement, result, {
			comparison,
			onFilterStatus,
		});

		expect(flatten(container)).toContain("Active3New1Persisting2Resolved1");
		expect(flatten(container)).toContain("8 files scanned1.0s2 scannersIgnored 2");

		const active = findByText(container, "Active3");
		const newFinding = findByText(container, "New1");
		const persisting = findByText(container, "Persisting2");
		const resolved = findByText(container, "Resolved1");
		expect(active?.tag).toBe("div");
		expect(active?.cls).toContain("vi-stat-active");
		expect(newFinding?.tag).toBe("button");
		expect(newFinding?.attr).toEqual({ type: "button" });
		expect(newFinding?.cls).toContain("vi-stat-new");
		expect(persisting?.tag).toBe("button");
		expect(persisting?.attr).toEqual({ type: "button" });
		expect(persisting?.cls).toContain("vi-stat-persisting");
		expect(resolved?.tag).toBe("div");
		expect(resolved?.cls).toContain("vi-stat-resolved");
		expect([active, newFinding, persisting, resolved].map((item) => item?.cls).join(" "))
			.not.toMatch(/vi-stat-(?:error|warning|info)/);
	});

	it("uses global active and ignored counts when comparison is unavailable", () => {
		const container = new FakeElement();
		const comparison: LifecycleComparison = {
			available: false,
			reason: "first-scan",
			statuses: new Map(),
			resolvedIssues: [],
		};

		renderSummary(container as unknown as HTMLElement, result, { comparison });

		const text = flatten(container);
		expect(text).toContain("Active3");
		expect(text).toContain("Ignored 2");
		expect(text).toContain("No previous successful scan for these settings");
		expect(text).not.toContain("New");
		expect(text).not.toContain("Persisting");
		expect(text).not.toContain("Resolved");
	});

	it.each([
		["first-scan", "No previous successful scan for these settings"],
		["settings-changed", "Scan settings changed; this scan starts a new comparison baseline"],
		["semantics-changed", "Scanner behavior changed; this scan starts a new comparison baseline"],
	] as const)("explains %s comparisons", (reason, message) => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: {
				available: false,
				reason,
				statuses: new Map(),
				resolvedIssues: [],
			},
		});

		expect(flatten(container)).toContain(message);
	});

	it("filters only from native new and persisting headline buttons", () => {
		const container = new FakeElement();
		const onFilterStatus = vi.fn();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: {
				available: true,
				statuses: new Map([
					["new", "new"],
					["persisting-a", "persisting"],
					["persisting-b", "persisting"],
				]),
				resolvedIssues: [],
			},
			onFilterStatus,
		});

		const active = findByText(container, "Active3");
		const newFinding = findByText(container, "New1");
		const persisting = findByText(container, "Persisting2");
		const resolved = findByText(container, "Resolved0");
		active?.click();
		newFinding?.click();
		persisting?.click();
		resolved?.click();

		expect(active?.tag).not.toBe("button");
		expect(newFinding?.tag).toBe("button");
		expect(persisting?.tag).toBe("button");
		expect(resolved?.tag).not.toBe("button");
		expect(onFilterStatus.mock.calls).toEqual([["new"], ["persisting"]]);
	});
});
