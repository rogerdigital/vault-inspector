import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;
type ElementOptions = { cls?: string; text?: string; attr?: Record<string, string> };

class FakeElement {
	children: FakeElement[] = [];
	cls = "";
	text: string | null = null;
	attr: Record<string, string> = {};
	private listeners = new Map<string, Listener>();

	constructor(readonly tag = "div", options: ElementOptions = {}) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
		this.attr = options.attr ?? {};
	}

	empty() { this.children = []; }
	addClass(cls: string) { this.cls = `${this.cls} ${cls}`.trim(); }
	createEl(tag: string, options: ElementOptions = {}) {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}
	createDiv(options: ElementOptions = {}) { return this.createEl("div", options); }
	createSpan(options: ElementOptions = {}) { return this.createEl("span", options); }
	addEventListener(name: string, listener: Listener) { this.listeners.set(name, listener); }
	click() { this.listeners.get("click")?.(); }
}

const { modalInstances } = vi.hoisted(() => ({ modalInstances: [] as any[] }));

vi.mock("obsidian", () => ({
	App: class {},
	Modal: class {
		contentEl = new FakeElement();
		constructor(public app: unknown) { modalInstances.push(this); }
		open() { this.onOpen(); }
		close() { this.onClose(); }
		onOpen() {}
		onClose() {}
	},
}));

import { showLargeReportWarningModal } from "../report/export-warning-modal";

function findByText(element: FakeElement, text: string): FakeElement | undefined {
	if (element.text === text) return element;
	for (const child of element.children) {
		const result = findByText(child, text);
		if (result) return result;
	}
	return undefined;
}

describe("showLargeReportWarningModal", () => {
	beforeEach(() => { modalInstances.length = 0; });

	it("renders the warning, report details, and button semantics", async () => {
		const result = showLargeReportWarningModal({} as any, {
			reportBytes: 3.2 * 1024 * 1024,
			thresholdBytes: 1024 * 1024,
			findingCount: 3881,
		});
		const content = modalInstances[0].contentEl as FakeElement;

		expect(content.cls).toContain("vi-confirm-modal");
		expect(findByText(content, "Large report warning")).toBeDefined();
		expect(findByText(content, "The full report may make Obsidian unresponsive while indexing it.")).toBeDefined();
		expect(findByText(content, "3.2 MB")).toBeDefined();
		expect(findByText(content, "1.0 MB")).toBeDefined();
		expect(findByText(content, "3881")).toBeDefined();
		expect(findByText(content, "A summary keeps scan totals while omitting per-finding details.")).toBeDefined();

		const cancel = findByText(content, "Cancel")!;
		const full = findByText(content, "Export full report anyway")!;
		const summary = findByText(content, "Export summary only")!;
		expect(cancel.attr.type).toBe("button");
		expect(full.attr.type).toBe("button");
		expect(summary.attr.type).toBe("button");
		expect(summary.cls).toContain("mod-cta");

		modalInstances[0].close();
		await expect(result).resolves.toBeNull();
	});

	it.each([
		["summary", "Export summary only"],
		["full", "Export full report anyway"],
	] as const)("resolves %s only once when its button is clicked", async (decision, label) => {
		const result = showLargeReportWarningModal({} as any, {
			reportBytes: 1,
			thresholdBytes: 1,
			findingCount: 1,
		});
		const modal = modalInstances[0];
		const button = findByText(modal.contentEl, label)!;

		button.click();
		button.click();
		modal.close();

		await expect(result).resolves.toBe(decision);
	});

	it("resolves null on cancel and close", async () => {
		const cancelled = showLargeReportWarningModal({} as any, {
			reportBytes: 1,
			thresholdBytes: 1,
			findingCount: 1,
		});
		findByText(modalInstances[0].contentEl, "Cancel")!.click();
		await expect(cancelled).resolves.toBeNull();

		const closed = showLargeReportWarningModal({} as any, {
			reportBytes: 1,
			thresholdBytes: 1,
			findingCount: 1,
		});
		modalInstances[1].close();
		await expect(closed).resolves.toBeNull();
	});
});
