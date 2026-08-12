import { describe, expect, it, vi } from "vitest";
import type { OperationOutcome } from "../fix/action-outcomes";
import { renderOperationOutcomes } from "../report/render-outcomes";

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
	attr: Record<string, string>;
	private listeners = new Map<string, Listener>();

	constructor(
		readonly tag = "div",
		options: ElementOptions = {},
	) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
		this.attr = options.attr ?? {};
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

function flattenedText(element: FakeElement): string {
	return flatten(element).map((node) => node.text ?? "").join("");
}

function findByClass(element: FakeElement, cls: string): FakeElement[] {
	return flatten(element).filter((node) => node.cls.split(/\s+/).includes(cls));
}

describe("renderOperationOutcomes", () => {
	it("renders nonzero summaries and safe per-item details for every outcome kind", () => {
		const injected = "<img src=x onerror=alert(1)>";
		const outcomes: OperationOutcome[] = [
			{ fingerprint: "fixed", outcome: "fixed", message: "Verified", affectedPaths: ["fixed.md"] },
			{ fingerprint: "present", outcome: "still-present", message: "Remains", affectedPaths: ["present.md"] },
			{ fingerprint: "skipped", outcome: "skipped", phase: "preflight", message: "Changed", affectedPaths: ["source.md", injected] },
			{ fingerprint: "failed", outcome: "failed", phase: "execution", message: "Permission denied", affectedPaths: ["failed.md"] },
			{ fingerprint: "ignored", outcome: "ignored", message: "Ignored", affectedPaths: ["ignored.md"] },
			{ fingerprint: "restored", outcome: "restored", message: "Restored", affectedPaths: ["restored.md"] },
			{ scannerId: "large-files", outcome: "excluded", message: "Excluded", affectedPaths: ["generated"] },
		];
		const container = new FakeElement();

		renderOperationOutcomes(
			container as unknown as HTMLElement,
			outcomes,
			vi.fn(),
		);

		const text = flattenedText(container);
		const summary = findByClass(container, "vi-outcomes-summary")[0];
		expect(summary.text).toBe(
			"Fixed 1 · Still present 1 · Skipped 1 · Failed 1 · Ignored 1 · Restored 1 · Excluded 1",
		);
		expect(summary.attr).toEqual({ role: "status", "aria-live": "polite" });
		expect(text).toContain("Fixed 1");
		expect(text).toContain("Still present 1");
		expect(text).toContain("Skipped 1");
		expect(text).toContain("Failed 1");
		expect(text).toContain("Ignored 1");
		expect(text).toContain("Restored 1");
		expect(text).toContain("Excluded 1");
		expect(text).toContain("preflight");
		expect(text).toContain("Permission denied");
		for (const path of [
			"fixed.md",
			"present.md",
			"source.md",
			injected,
			"failed.md",
			"ignored.md",
			"restored.md",
			"generated",
		]) {
			expect(text).toContain(path);
		}
		expect(flatten(container).some((node) => "innerHTML" in node)).toBe(false);
		expect(flatten(container).find((node) => node.text === injected)?.children)
			.toHaveLength(0);
	});

	it("uses a native button and invokes the dismiss callback", () => {
		const container = new FakeElement();
		const onDismiss = vi.fn();

		renderOperationOutcomes(
			container as unknown as HTMLElement,
			[{ fingerprint: "fixed", outcome: "fixed", message: "Done", affectedPaths: [] }],
			onDismiss,
		);

		const dismiss = findByClass(container, "vi-outcomes-dismiss")[0];
		expect(dismiss).toMatchObject({ tag: "button", attr: { type: "button" } });
		dismiss.click();
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("renders nothing for an empty outcome list", () => {
		const container = new FakeElement();

		renderOperationOutcomes(
			container as unknown as HTMLElement,
			[],
			vi.fn(),
		);

		expect(container.children).toEqual([]);
	});
});
