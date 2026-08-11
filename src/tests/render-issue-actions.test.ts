import { describe, expect, it, vi } from "vitest";
import type { Issue } from "../scanner/Issue";
import { renderIssueList } from "../report/render-issues";

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
