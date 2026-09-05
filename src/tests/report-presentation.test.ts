import { describe, expect, it } from "vitest";
import type { Issue } from "../scanner/Issue";
import {
	presentClassification,
	presentFix,
	presentLifecycle,
	presentSeverity,
} from "../report/presentation";

const issue = (eligibility: Issue["eligibility"]): Issue => ({
	scannerId: "empty-notes",
	severity: "warning",
	title: "Empty note",
	message: "Empty",
	classification: "confirmed",
	explanation: { why: "Empty", nextStep: "Review" },
	primaryPath: "note.md",
	relatedPaths: [],
	evidence: {},
	fingerprint: "empty-note",
	fixAction: {
		kind: "trash-file",
		label: "Delete",
		description: "Move note.md to trash",
		targetPaths: ["note.md"],
	},
	...(eligibility ? { eligibility } : {}),
});

describe("report presentation", () => {
	it("uses plain-language classification labels", () => {
		expect(presentClassification("confirmed").label).toBe("Confirmed");
		expect(presentClassification("candidate").label).toBe("Needs review");
		expect(presentClassification("unverified").label).toBe("Could not verify");
	});

	it("uses plural plain-language severity labels", () => {
		expect(presentSeverity("error")).toBe("Errors");
		expect(presentSeverity("warning")).toBe("Warnings");
		expect(presentSeverity("info")).toBe("Info");
	});

	it("shows only new lifecycle state on collapsed cards", () => {
		expect(presentLifecycle("new")).toEqual({
			label: "New",
			className: "vi-status-new",
			showOnCard: true,
		});
		expect(presentLifecycle("persisting").showOnCard).toBe(false);
		expect(presentLifecycle("persisting").label).toBe("Previously found");
	});

	it("uses the action itself instead of an eligible badge", () => {
		expect(presentFix(issue("eligible"))).toMatchObject({
			actionLabel: "Fix this issue",
			stateLabel: null,
			className: "vi-fix-ready",
		});
		expect(presentFix(issue("review-required"))).toMatchObject({
			actionLabel: "Review fix",
			stateLabel: "Review before fixing",
			className: "vi-fix-review",
		});
		expect(presentFix(issue("blocked"))).toMatchObject({
			actionLabel: null,
			stateLabel: "Fix unavailable",
			className: "vi-fix-unavailable",
		});
	});

	it("returns no fix presentation for issues without a fix action", () => {
		expect(presentFix({ ...issue("eligible"), fixAction: undefined })).toBeNull();
	});
});
