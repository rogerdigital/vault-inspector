import { describe, expect, it, vi } from "vitest";
import type { Issue } from "../scanner/Issue";
import type { CurrentFindingStatus } from "../scanner/result-diff";
import { renderFindingEvidence } from "../report/render-evidence";
import { renderIssueList } from "../report/render-issues";

type ElementOptions = {
	cls?: string;
	text?: string;
	type?: string;
};

type FakeListener = (event: FakeEvent) => void;

class FakeEvent {
	propagationStopped = false;
	defaultPrevented = false;

	stopPropagation(): void {
		this.propagationStopped = true;
	}

	preventDefault(): void {
		this.defaultPrevented = true;
	}
}

class FakeElement {
	children: FakeElement[] = [];
	cls: string;
	text: string | null;
	checked = false;
	parent: FakeElement | null = null;
	private listeners = new Map<string, FakeListener[]>();

	constructor(
		readonly tag: string = "div",
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

	setText(text: string): void {
		this.text = text;
	}

	addClass(cls: string): void {
		this.cls = `${this.cls} ${cls}`.trim();
	}

	addEventListener(event: string, listener: FakeListener): void {
		const listeners = this.listeners.get(event) ?? [];
		listeners.push(listener);
		this.listeners.set(event, listeners);
	}

	click(): FakeEvent {
		const event = new FakeEvent();
		this.dispatch("click", event);
		return event;
	}

	private dispatch(type: string, event: FakeEvent): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
			if (event.propagationStopped) return;
		}
		this.parent?.dispatch(type, event);
	}

	private append(tag: string, options: ElementOptions): FakeElement {
		const child = new FakeElement(tag, options);
		child.parent = this;
		this.children.push(child);
		return child;
	}
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "broken-links",
		severity: "warning",
		classification: "candidate",
		explanation: {
			why: "No note reference was found.",
			caveat: "External references may exist.",
			nextStep: "Review before deleting.",
		},
		title: "Broken link",
		message: "A link target could not be resolved.",
		primaryPath: "Notes/source.md",
		relatedPaths: [],
		evidence: {
			lastModified: 1_700_000_000_000,
			target: "Missing note",
			verified: false,
		},
		fingerprint: "broken-link-fingerprint",
		...overrides,
	};
}

function flattenText(element: FakeElement): string {
	return [element.text ?? "", ...element.children.map(flattenText)].join("");
}

function findByClass(element: FakeElement, cls: string): FakeElement[] {
	const matches = element.cls.split(/\s+/).includes(cls) ? [element] : [];
	return matches.concat(element.children.flatMap((child) => findByClass(child, cls)));
}

describe("renderFindingEvidence", () => {
	it("renders classification, interpretation, and sorted scalar evidence", () => {
		const container = new FakeElement();
		const issue = makeIssue({
			evidence: {
				verified: false,
				lastModified: 1_700_000_000_000,
				target: "Missing note",
			},
		});

		renderFindingEvidence(container as unknown as HTMLElement, issue);

		const text = flattenText(container);
		expect(text).toContain("CANDIDATE");
		expect(text).toContain("WhyNo note reference was found.");
		expect(text).toContain("CaveatExternal references may exist.");
		expect(text).toContain("NextReview before deleting.");
		expect(text).toContain("Evidence");
		expect(text).toContain("lastModified");

		const badge = findByClass(container, "vi-classification-badge")[0];
		expect(badge.cls).toBe("vi-classification-badge vi-classification-candidate");
		expect(badge.text).toBe("CANDIDATE");

		const disclosure = findByClass(container, "vi-evidence-disclosure")[0];
		expect(disclosure.tag).toBe("details");
		expect(disclosure.children[0]).toMatchObject({ tag: "summary", text: "Evidence" });
		const evidenceLabels = disclosure.children.slice(1).map((row) => row.children[0].text);
		expect(evidenceLabels).toEqual(["lastModified", "target", "verified"]);
		expect(disclosure.children.slice(1).map((row) => row.children[1].text)).toEqual([
			"1700000000000",
			"Missing note",
			"false",
		]);
	});

	it("omits caveat rows for absent and empty caveats", () => {
		for (const caveat of [undefined, ""] as const) {
			const container = new FakeElement();
			const issue = makeIssue({
				classification: "confirmed",
				explanation: {
					why: "The finding is confirmed.",
					...(caveat === undefined ? {} : { caveat }),
					nextStep: "Fix the finding.",
				},
			});

			renderFindingEvidence(container as unknown as HTMLElement, issue);

			expect(flattenText(container)).toContain("CONFIRMED");
			expect(flattenText(container)).not.toContain("Caveat");
		}
	});

	it("renders evidence values as text without interpreting markup", () => {
		const container = new FakeElement();
		const issue = makeIssue({ evidence: { source: "<img src=x onerror=alert(1)>" } });

		renderFindingEvidence(container as unknown as HTMLElement, issue);

		const disclosure = findByClass(container, "vi-evidence-disclosure")[0];
		expect(disclosure.children[1].children[1].text).toBe("<img src=x onerror=alert(1)>");
		expect(disclosure.children[1].children).toHaveLength(2);
	});
});

describe("renderIssueList finding metadata", () => {
	function render(statuses?: ReadonlyMap<string, CurrentFindingStatus>): FakeElement {
		const container = new FakeElement();
		renderIssueList(container as unknown as HTMLElement, {
			issues: [makeIssue()],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			statuses,
			onOpenIssue: () => {},
			onToggleSelect: () => {},
		});
		return container;
	}

	it.each([
		["new", "NEW"],
		["persisting", "PERSISTING"],
	] as const)("renders the %s lifecycle badge after severity", (status, label) => {
		const container = render(new Map([["broken-link-fingerprint", status]]));
		const issueCard = findByClass(container, "vi-issue")[0];

		expect(issueCard.children[0]).toMatchObject({
			cls: "vi-severity-badge vi-severity-warning",
			text: "WARNING",
		});
		expect(issueCard.children[1]).toMatchObject({
			cls: `vi-status-badge vi-status-${status}`,
			text: label,
		});
		expect(findByClass(issueCard, "vi-classification-candidate")).toHaveLength(1);
		expect(flattenText(issueCard)).toContain("WhyNo note reference was found.");
		expect(flattenText(issueCard)).toContain("lastModified1700000000000");
	});

	it("does not render a lifecycle badge when status is unavailable", () => {
		const issueCard = findByClass(render(), "vi-issue")[0];

		expect(findByClass(issueCard, "vi-status-badge")).toHaveLength(0);
	});

	it("keeps scanner-specific visible evidence before interpretation and disclosure", () => {
		const issueCard = findByClass(render(), "vi-issue")[0];
		const details = findByClass(issueCard, "vi-issue-details")[0];
		const targetIndex = details.children.findIndex((child) => child.cls === "vi-issue-target");
		const explanationIndex = details.children.findIndex((child) => child.cls === "vi-explanation");
		const disclosureIndex = details.children.findIndex((child) => child.cls === "vi-evidence-disclosure");

		expect(targetIndex).toBeGreaterThanOrEqual(0);
		expect(explanationIndex).toBeGreaterThan(targetIndex);
		expect(disclosureIndex).toBeGreaterThan(explanationIndex);
		expect(flattenText(details.children[targetIndex])).toBe("TargetMissing note");
	});

	it("keeps evidence disclosure interaction from toggling card selection", () => {
		const container = new FakeElement();
		const issue = makeIssue();
		const onToggleSelect = vi.fn();
		renderIssueList(container as unknown as HTMLElement, {
			issues: [issue],
			scannersRun: ["broken-links"],
			selectionMode: true,
			selectedFingerprints: new Set(),
			onOpenIssue: () => {},
			onToggleSelect,
		});
		const issueCard = findByClass(container, "vi-issue")[0];
		const disclosure = findByClass(issueCard, "vi-evidence-disclosure")[0];

		const summaryEvent = disclosure.children[0].click();
		expect(onToggleSelect).not.toHaveBeenCalled();
		expect(summaryEvent.defaultPrevented).toBe(false);

		const evidenceValueEvent = disclosure.children[1].children[1].click();
		expect(onToggleSelect).not.toHaveBeenCalled();
		expect(evidenceValueEvent.defaultPrevented).toBe(false);

		issueCard.click();
		expect(onToggleSelect).toHaveBeenCalledOnce();
		expect(onToggleSelect).toHaveBeenCalledWith(issue);
	});
});
