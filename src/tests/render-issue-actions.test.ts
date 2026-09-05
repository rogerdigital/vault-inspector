import { describe, expect, it, vi } from "vitest";
import type { Issue } from "../scanner/Issue";
import { renderIssueList, selectBulkFixable } from "../report/render-issues";

class FakeEvent {
	propagationStopped = false;
	stopPropagation() { this.propagationStopped = true; }
	preventDefault = vi.fn();
}

type ElementOptions = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	type?: string;
};

class FakeElement {
	children: FakeElement[] = [];
	cls: string;
	text: string | null;
	attr: Record<string, string>;
	type?: string;
	checked = false;
	private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

	constructor(
		readonly tag = "div",
		options: ElementOptions = {},
		readonly parent: FakeElement | null = null,
	) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
		this.attr = options.attr ?? {};
		this.type = options.type;
	}

	createDiv(options: ElementOptions = {}) { return this.createEl("div", options); }
	createSpan(options: ElementOptions = {}) { return this.createEl("span", options); }
	createEl(tag: string, options: ElementOptions = {}) {
		const child = new FakeElement(tag, options, this);
		this.children.push(child);
		return child;
	}
	addClass(cls: string) { this.cls = `${this.cls} ${cls}`.trim(); }
	setText(text: string) { this.text = text; }
	addEventListener(name: string, listener: (event: FakeEvent) => void) {
		this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
	}
	click(event = new FakeEvent()): FakeEvent {
		for (const listener of this.listeners.get("click") ?? []) listener(event);
		if (!event.propagationStopped) this.parent?.click(event);
		return event;
	}
}

function makeIssue(path: string): Issue {
	return {
		scannerId: "broken-links",
		severity: "warning",
		classification: "confirmed",
		explanation: { why: "Missing target.", nextStep: "Repair the link." },
		title: "Broken link",
		message: "Missing target",
		primaryPath: path,
		relatedPaths: [],
		evidence: { target: "Missing" },
		fingerprint: path,
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

function findByTag(element: FakeElement, tag: string): FakeElement[] {
	const matches = element.tag === tag ? [element] : [];
	return matches.concat(element.children.flatMap((child) => findByTag(child, tag)));
}

function flattenText(element: FakeElement): string {
	return [element.text ?? "", ...element.children.map(flattenText)].join("");
}

function findByClass(element: FakeElement, cls: string): FakeElement[] {
	const matches = element.cls.split(/\s+/).includes(cls) ? [element] : [];
	return matches.concat(element.children.flatMap((child) => findByClass(child, cls)));
}

function renderExpandedIssue(issue: Issue): FakeElement {
	const container = new FakeElement();
	renderIssueList(container as any, {
		issues: [issue],
		scannersRun: [issue.scannerId],
		selectionMode: false,
		selectedFingerprints: new Set(),
		onOpenIssue: vi.fn(),
		onToggleSelect: vi.fn(),
		onFixIssue: vi.fn(),
	});
	return container;
}

describe("renderIssueList contextual actions", () => {
	it("renders a native Actions disclosure with only available type=button controls", () => {
		const container = new FakeElement();
		const issue = makeIssue("notes/project/file.md");
		const onIgnoreIssue = vi.fn();
		const onExcludeFolder = vi.fn();
		const onOpenScannerSettings = vi.fn();

		renderIssueList(container as any, {
			issues: [issue],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
			onIgnoreIssue,
			onExcludeFolder,
			onOpenScannerSettings,
		});

		const actions = findByText(container, "Actions")!;
		expect(actions.tag).toBe("summary");
		expect(actions.parent?.tag).toBe("details");
		for (const text of ["Ignore this issue", "Exclude parent folder", "Scanner settings"]) {
			const button = findByText(container, text);
			expect(button?.attr.type).toBe("button");
			expect(button?.cls.split(/\s+/)).toContain("vi-action-btn");
		}

		findByText(container, "Ignore this issue")?.click();
		findByText(container, "Exclude parent folder")?.click();
		findByText(container, "Scanner settings")?.click();
		expect(onIgnoreIssue).toHaveBeenCalledWith(issue);
		expect(onExcludeFolder).toHaveBeenCalledWith(issue);
		expect(onOpenScannerSettings).toHaveBeenCalledWith("broken-links");
	});

	it("renders an explicit review action for a review-required fix", () => {
		const container = new FakeElement();
		const issue = makeFixIssueWith("review-required", "notes/file.md");
		const onFixIssue = vi.fn();

		renderIssueList(container as any, {
			issues: [issue],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
			onFixIssue,
		});

		findByText(container, "Review fix")?.click();
		expect(onFixIssue).toHaveBeenCalledOnce();
		expect(onFixIssue).toHaveBeenCalledWith(issue);
	});

	it("renders a fix action for an eligible issue through the same callback", () => {
		const container = new FakeElement();
		const issue = makeFixIssueWith("eligible", "notes/file.md");
		const onFixIssue = vi.fn();

		renderIssueList(container as any, {
			issues: [issue],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
			onFixIssue,
		});

		findByText(container, "Fix this issue")?.click();
		expect(onFixIssue).toHaveBeenCalledOnce();
		expect(onFixIssue).toHaveBeenCalledWith(issue);
		expect(findByText(container, "Review fix")).toBeUndefined();
	});

	it("does not render a fix action when the fix callback is not provided", () => {
		// Mirrors the bulk fix button hiding when fix actions are disabled:
		// InspectorView then omits onFixIssue from the config entirely.
		const container = new FakeElement();
		renderIssueList(container as any, {
			issues: [
				makeFixIssueWith("eligible", "a.md"),
				makeFixIssueWith("review-required", "b.md"),
			],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
		});
		expect(findByText(container, "Fix this issue")).toBeUndefined();
		expect(findByText(container, "Review fix")).toBeUndefined();
	});

	it("does not render a fix action for blocked or non-fixable findings", () => {
		for (const issue of [
			makeFixIssueWith("blocked", "blocked.md"),
			makeIssue("plain.md"),
		]) {
			const container = new FakeElement();
			renderIssueList(container as any, {
				issues: [issue],
				scannersRun: ["broken-links"],
				selectionMode: false,
				selectedFingerprints: new Set(),
				onOpenIssue: vi.fn(),
				onToggleSelect: vi.fn(),
				onFixIssue: vi.fn(),
			});
			expect(findByText(container, "Review fix")).toBeUndefined();
			expect(findByText(container, "Fix this issue")).toBeUndefined();
		}
	});

	it("hides parent-folder control for root findings and all Actions when no callback exists", () => {
		const root = new FakeElement();
		renderIssueList(root as any, {
			issues: [makeIssue("file.md")],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
			onIgnoreIssue: vi.fn(),
			onExcludeFolder: vi.fn(),
		});
		expect(findByText(root, "Ignore this issue")).toBeDefined();
		expect(findByText(root, "Exclude parent folder")).toBeUndefined();

		const ignored = new FakeElement();
		renderIssueList(ignored as any, {
			issues: [makeIssue("notes/file.md")],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
		});
		expect(findByText(ignored, "Actions")).toBeUndefined();
	});

	it("does not toggle selection or prevent disclosure defaults when actions are used", () => {
		const container = new FakeElement();
		const onToggleSelect = vi.fn();
		renderIssueList(container as any, {
			issues: [makeIssue("notes/file.md")],
			scannersRun: ["broken-links"],
			selectionMode: true,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect,
			onIgnoreIssue: vi.fn(),
		});

		const disclosureEvent = findByText(container, "Actions")!.click();
		const buttonEvent = findByText(container, "Ignore this issue")!.click();

		expect(onToggleSelect).not.toHaveBeenCalled();
		expect(disclosureEvent.preventDefault).not.toHaveBeenCalled();
		expect(buttonEvent.preventDefault).not.toHaveBeenCalled();
		expect(findByTag(container, "details")).toHaveLength(2);
	});
});

function makeFixIssueWith(
	eligibility: "eligible" | "review-required" | "blocked" | undefined,
	path: string,
): Issue {
	return {
		...makeIssue(path),
		// Blocked fixtures are unverified, mirroring the only policy path
		// that annotates a fix-bearing finding as blocked with an otherwise
		// complete action shape.
		...(eligibility === "blocked"
			? { classification: "unverified" as const, eligibility }
			: eligibility
				? { eligibility }
				: {}),
		fixAction: {
			kind: "trash-file",
			label: "Delete",
			description: `Move "${path}" to trash`,
			targetPaths: [path],
		},
	};
}

describe("fix eligibility reporting and bulk gating", () => {
	it("does not duplicate a ready-to-fix status beside the Fix action", () => {
		const rendered = renderExpandedIssue(makeFixIssueWith("eligible", "notes/file.md"));
		const text = flattenText(rendered);

		expect(text).toContain("Fix this issue");
		expect(text).not.toContain("Ready to fix");
		expect(text).not.toContain("Eligible");
		expect(findByClass(rendered, "vi-fix-state")).toHaveLength(0);
		expect(findByText(rendered, "Fix")).toBeUndefined();
	});

	it("keeps review and blocked reasons visible when they affect the next action", () => {
		const review = renderExpandedIssue(makeFixIssueWith("review-required", "notes/file.md"));
		expect(flattenText(review)).toContain("Review fix");
		const reviewLabel = findByText(review, "Review before fixing");
		expect(reviewLabel?.parent?.cls).toBe("vi-fix-state vi-fix-review");
		expect(reviewLabel?.cls).toBe("vi-fix-state-label");
		expect(findByText(review, describeReasonFor("review-required"))?.cls)
			.toBe("vi-fix-state-reason");

		const blocked = renderExpandedIssue(makeFixIssueWith("blocked", "notes/file.md"));
		expect(flattenText(blocked)).not.toContain("Fix this issue");
		const blockedLabel = findByText(blocked, "Fix unavailable");
		expect(blockedLabel?.parent?.cls).toBe("vi-fix-state vi-fix-unavailable");
		expect(findByText(blocked, describeReasonFor("blocked"))?.cls)
			.toBe("vi-fix-state-reason");
	});

	it("treats a missing eligibility field as review-required in the report", () => {
		const container = new FakeElement();
		renderIssueList(container as any, {
			issues: [makeFixIssueWith(undefined, "notes/file.md")],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
		});
		expect(findByText(container, "Review before fixing")).toBeDefined();
		expect(findByText(container, "Fix unavailable")).toBeUndefined();
	});

	it("renders no fix state for issues without a fix action", () => {
		const container = new FakeElement();
		renderIssueList(container as any, {
			issues: [makeIssue("notes/file.md")],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
		});
		expect(findByText(container, "Fix")).toBeUndefined();
		expect(findByClass(container, "vi-fix-state")).toHaveLength(0);
	});

	it("limits bulk fix to eligible issues and counts the excluded tiers", () => {
		const eligible = makeFixIssueWith("eligible", "a.md");
		const review = makeFixIssueWith("review-required", "b.md");
		const blocked = makeFixIssueWith("blocked", "c.md");
		const plain = makeIssue("d.md");

		expect(selectBulkFixable([eligible, review, blocked, plain])).toEqual({
			bulk: [eligible],
			reviewRequired: 1,
			blocked: 1,
		});
	});
});

function describeReasonFor(
	eligibility: "review-required" | "blocked",
): string {
	if (eligibility === "blocked") {
		return "The finding could not be verified, so its fix cannot run.";
	}
	return "Review this finding before allowing its fix to run.";
}
