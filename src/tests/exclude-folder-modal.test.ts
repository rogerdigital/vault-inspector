import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../scanner/Issue";

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

import {
	buildFolderExclusionRequest,
	showFolderExclusionModal,
} from "../report/exclude-folder-modal";

function makeIssue(
	fingerprint: string,
	primaryPath?: string,
	relatedPaths: string[] = [],
	scannerId: Issue["scannerId"] = "broken-links",
): Issue {
	return {
		scannerId,
		severity: "warning",
		classification: "confirmed",
		explanation: { why: "Test evidence.", nextStep: "Review it." },
		title: fingerprint,
		message: fingerprint,
		...(primaryPath ? { primaryPath } : {}),
		relatedPaths,
		evidence: {},
		fingerprint,
	};
}

function findByText(element: FakeElement, text: string): FakeElement | undefined {
	if (element.text === text) return element;
	for (const child of element.children) {
		const result = findByText(child, text);
		if (result) return result;
	}
	return undefined;
}

describe("buildFolderExclusionRequest", () => {
	it("uses the first available path and counts only same-scanner findings in the folder", () => {
		const issue = makeIssue("target", undefined, ["notes/project/file.md"]);
		const visible = [
			issue,
			makeIssue("nested", "notes/project/nested/file.md"),
			makeIssue("sibling-prefix", "notes/project-old/file.md"),
			makeIssue("other-scanner", "notes/project/empty.md", [], "empty-notes"),
		];

		expect(buildFolderExclusionRequest(issue, visible)).toEqual({
			scannerId: "broken-links",
			folder: "notes/project",
			affectedCount: 2,
		});
	});

	it("returns null when no non-root parent exists", () => {
		expect(buildFolderExclusionRequest(makeIssue("root", "file.md"), [])).toBeNull();
		expect(buildFolderExclusionRequest(makeIssue("pathless"), [])).toBeNull();
	});
});

describe("showFolderExclusionModal", () => {
	beforeEach(() => { modalInstances.length = 0; });

	it("shows scope details and resolves true only once when confirmed", async () => {
		const result = showFolderExclusionModal({} as any, {
			scannerId: "broken-links",
			folder: "notes/project",
			affectedCount: 3,
		});
		const modal = modalInstances[0];
		const content = modal.contentEl as FakeElement;

		expect(findByText(content, "Broken Links")).toBeDefined();
		expect(findByText(content, "notes/project")).toBeDefined();
		expect(findByText(content, "3")).toBeDefined();
		const confirm = findByText(content, "Exclude folder")!;
		expect(confirm.attr.type).toBe("button");
		confirm.click();
		confirm.click();

		await expect(result).resolves.toBe(true);
	});

	it("resolves false on cancel and close", async () => {
		const cancelled = showFolderExclusionModal({} as any, {
			scannerId: "empty-notes",
			folder: "templates",
			affectedCount: 1,
		});
		const cancel = findByText(modalInstances[0].contentEl, "Cancel")!;
		expect(cancel.attr.type).toBe("button");
		cancel.click();
		await expect(cancelled).resolves.toBe(false);

		const closed = showFolderExclusionModal({} as any, {
			scannerId: "empty-notes",
			folder: "templates",
			affectedCount: 1,
		});
		modalInstances[1].close();
		await expect(closed).resolves.toBe(false);
	});
});
