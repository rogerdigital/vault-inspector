import { describe, expect, it } from "vitest";
import { renderResolvedChanges } from "../report/render-changes";
import type { SnapshotIssue } from "../snapshot/scan-snapshot";

type ElementOptions = {
	cls?: string;
	text?: string;
};

class FakeElement {
	children: FakeElement[] = [];
	cls: string;
	text: string | null;

	constructor(
		readonly tag = "div",
		options: ElementOptions = {},
	) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
	}

	createDiv(options: ElementOptions = {}): FakeElement {
		return this.append("div", options);
	}

	createSpan(options: ElementOptions = {}): FakeElement {
		return this.append("span", options);
	}

	createEl(tag: string, options: ElementOptions = {}): FakeElement {
		return this.append(tag, options);
	}

	private append(tag: string, options: ElementOptions): FakeElement {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}
}

function snapshotIssue(
	fingerprint: string,
	ignored: boolean,
	primaryPath?: string,
): SnapshotIssue {
	return {
		fingerprint,
		scannerId: ignored ? "empty-notes" : "broken-links",
		severity: ignored ? "info" : "error",
		classification: "confirmed",
		title: ignored ? "Ignored empty note resolved" : "Broken link resolved",
		message: "Previous finding",
		...(primaryPath === undefined ? {} : { primaryPath }),
		relatedPaths: [],
		evidence: {},
		explanation: {
			why: "The previous finding no longer appears.",
			nextStep: "No action is required.",
		},
		ignored,
	};
}

function flatten(element: FakeElement): FakeElement[] {
	return [element, ...element.children.flatMap(flatten)];
}

function findByClass(element: FakeElement, cls: string): FakeElement[] {
	return flatten(element).filter((item) => item.cls.split(/\s+/).includes(cls));
}

describe("renderResolvedChanges", () => {
	it("renders active and previously ignored resolved findings without actions", () => {
		const container = new FakeElement();
		const active = snapshotIssue("active-resolved", false, "Notes/source.md");
		const ignored = snapshotIssue("ignored-resolved", true, "Archive/empty.md");

		renderResolvedChanges(container as unknown as HTMLElement, [active, ignored]);

		const items = findByClass(container, "vi-resolved-item");
		expect(items).toHaveLength(2);
		expect(items.map((item) => item.children.map((child) => child.text))).toEqual([
			["RESOLVED", "Broken Links", "Broken link resolved", "Notes/source.md"],
			["RESOLVED", "Empty Notes", "Ignored empty note resolved", "Archive/empty.md", "Previously ignored"],
		]);
		expect(findByClass(container, "vi-status-resolved")).toHaveLength(2);
		expect(findByClass(container, "vi-status-resolved")[0]?.cls).toBe(
			"vi-status-badge vi-status-resolved",
		);
		expect(findByClass(container, "vi-issue-path")).toHaveLength(2);
		expect(findByClass(container, "vi-resolved-ignored")).toHaveLength(1);

		const nodes = flatten(container);
		expect(nodes.map((node) => node.tag)).not.toEqual(
			expect.arrayContaining(["button", "input", "select"]),
		);
		expect(nodes.every((node) => !("innerHTML" in node))).toBe(true);
		for (const node of nodes) {
			expect(node.cls).not.toMatch(/\b(?:vi-issue-checkbox|vi-select-btn|vi-action\S*|vi-filter-btn)\b/);
		}
		expect(nodes.map((node) => node.text).filter(Boolean)).not.toEqual(
			expect.arrayContaining(["Select", "Fix", "Ignore", "Exclude", "Restore"]),
		);
	});

	it("omits the path element when a snapshot finding has no primary path", () => {
		const container = new FakeElement();

		renderResolvedChanges(container as unknown as HTMLElement, [
			snapshotIssue("pathless", false),
		]);

		expect(findByClass(container, "vi-issue-path")).toHaveLength(0);
	});
});
