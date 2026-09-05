import { describe, expect, it } from "vitest";
import type { Issue } from "../scanner/Issue";
import {
	describeEligibility,
	resolveEligibility,
} from "../fix/fix-eligibility";

function issue(overrides: Partial<Issue> = {}): Issue {
	return {
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
		...overrides,
	};
}

describe("fix eligibility presentation", () => {
	it("fails closed when eligibility metadata is missing", () => {
		expect(resolveEligibility(issue())).toBe("review-required");
		expect(describeEligibility(issue()).status).toBe("Review before fixing");
	});

	it("describes eligible fixes as ready without exposing the enum", () => {
		expect(describeEligibility(issue({ eligibility: "eligible" }))).toEqual({
			status: "Ready to fix",
			reason: "The fix is confirmed and its evidence is complete.",
		});
	});

	it("describes blocked fixes as unavailable", () => {
		const blocked = issue({
			classification: "unverified",
			eligibility: "blocked",
		});
		expect(describeEligibility(blocked)).toEqual({
			status: "Fix unavailable",
			reason: "The finding could not be verified, so its fix cannot run.",
		});
	});

	it("describes findings without a fix action", () => {
		expect(describeEligibility(issue({ fixAction: undefined }))).toEqual({
			status: "No fix available",
			reason: "This finding has no fix action.",
		});
	});

	it("falls back to a generic reason for blocked fixes without a specific cause", () => {
		expect(describeEligibility(issue({ eligibility: "blocked" }))).toEqual({
			status: "Fix unavailable",
			reason: "This fix cannot run in the current state.",
		});
	});
});
