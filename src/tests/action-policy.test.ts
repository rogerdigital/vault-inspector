import { describe, expect, it } from "vitest";
import type { Issue } from "../scanner/Issue";
import type { ReferenceIndex } from "../scanner/reference-index";
import {
	deriveActionPolicy,
	withActionPolicy,
} from "../fix/action-policy";

function makeIndex(
	overrides: {
		inbound?: Record<string, number>;
		coverageComplete?: boolean;
	} = {},
): ReferenceIndex {
	return {
		inboundByPath: new Map(
			Object.entries(overrides.inbound ?? {}).map(([path, count]) => [
				path,
				{ count, kinds: [], sources: [] },
			]),
		),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: overrides.coverageComplete ?? true,
	};
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "orphan-attachments",
		severity: "warning",
		title: "Orphan attachment",
		message: "This attachment is not referenced by any note",
		classification: "candidate",
		explanation: { why: "why", nextStep: "next step" },
		primaryPath: "attachments/orphan.png",
		relatedPaths: [],
		evidence: {},
		fingerprint: "fingerprint",
		...overrides,
	};
}

describe("deriveActionPolicy", () => {
	it("returns null for findings without a fix action", () => {
		const issue = makeIssue();
		expect(deriveActionPolicy(issue, makeIndex())).toBeNull();
	});

	it("blocks unverified findings regardless of action shape", () => {
		const issue = makeIssue({
			classification: "unverified",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(deriveActionPolicy(issue, makeIndex())?.eligibility).toBe("blocked");
	});

	it("blocks trash actions when reference coverage is incomplete", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.eligibility,
		).toBe("blocked");
	});

	it("blocked outranks review-required: candidate trash under incomplete coverage is blocked", () => {
		const issue = makeIssue({
			classification: "candidate",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.eligibility,
		).toBe("blocked");
	});

	it("marks confirmed trash under incomplete coverage as blocked", () => {
		const issue = makeIssue({
			classification: "confirmed",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.eligibility,
		).toBe("blocked");
	});

	it("marks candidate findings as review-required even with complete coverage", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(deriveActionPolicy(issue, makeIndex())?.eligibility).toBe("review-required");
	});

	it("marks confirmed remove-link-text actions without replacement evidence as review-required", () => {
		const missingReplacement = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
			},
		});
		const missingOriginal = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove the link",
				targetPaths: ["notes/source.md"],
				replacement: "Missing",
			},
		});
		expect(deriveActionPolicy(missingReplacement, makeIndex())?.eligibility).toBe("review-required");
		expect(deriveActionPolicy(missingOriginal, makeIndex())?.eligibility).toBe("review-required");
	});

	it("marks review-required duplicate groups (requiresReview) as review-required despite confirmed classification", () => {
		const issue = makeIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png", "c.png"],
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png", "c.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png", "c.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["a.png", "b.png"],
					requiresReview: true,
				},
			},
		});
		expect(deriveActionPolicy(issue, makeIndex())?.eligibility).toBe("review-required");
	});

	it("marks confirmed findings with complete evidence as eligible", () => {
		const brokenLink = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: 'Replace "[Missing](missing.md)" with "Missing" in "notes/source.md"',
				targetPaths: ["notes/source.md"],
				original: "[Missing](missing.md)",
				replacement: "Missing",
			},
		});
		expect(deriveActionPolicy(brokenLink, makeIndex())?.eligibility).toBe("eligible");

		const duplicateGroup = makeIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "a.png" and move 1 duplicate(s) to trash',
				targetPaths: ["b.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png"],
					automaticKeepPath: "a.png",
					referencedPaths: [],
					requiresReview: false,
				},
			},
		});
		expect(deriveActionPolicy(duplicateGroup, makeIndex())?.eligibility).toBe("eligible");
	});

	it("computes impact for a note-modifying action", () => {
		const issue = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		expect(deriveActionPolicy(issue, makeIndex({ inbound: { "notes/source.md": 3 } }))).toEqual({
			eligibility: "eligible",
			impact: {
				filesChanged: 1,
				filesTrashed: 0,
				inboundReferences: 3,
				coverageComplete: true,
			},
		});
	});

	it("computes impact for a trash action from the shared reference index", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png", "c.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png", "c.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["b.png"],
					requiresReview: true,
				},
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ inbound: { "a.png": 2, "b.png": 1 } })),
		).toEqual({
			eligibility: "review-required",
			impact: {
				filesChanged: 0,
				filesTrashed: 2,
				inboundReferences: 1,
				coverageComplete: true,
			},
		});
	});

	it("reports incomplete coverage in the impact", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.impact.coverageComplete,
		).toBe(false);
	});

	it("is deterministic: identical inputs produce deep-equal outputs and never mutate the issue", () => {
		const issue = makeIssue({
			classification: "confirmed",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		const index = makeIndex({ inbound: { "notes/source.md": 1 } });
		const before = JSON.stringify(issue);

		const first = deriveActionPolicy(issue, index);
		const second = deriveActionPolicy(issue, index);

		expect(first).toEqual(second);
		expect(JSON.stringify(issue)).toBe(before);
	});
});

describe("withActionPolicy", () => {
	it("returns issues without a fix action untouched (no new keys)", () => {
		const issue = makeIssue();
		const annotated = withActionPolicy(issue, makeIndex());
		expect(annotated).toBe(issue);
		expect("eligibility" in annotated).toBe(false);
		expect("impact" in annotated).toBe(false);
	});

	it("annotates fix-bearing issues and preserves the fingerprint and evidence", () => {
		const issue = makeIssue({
			evidence: { referenceCount: 0, coverageComplete: true },
			fingerprint: "stable-fingerprint",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "attachments/orphan.png" to trash',
				targetPaths: ["attachments/orphan.png"],
			},
		});
		const annotated = withActionPolicy(issue, makeIndex());
		expect(annotated).not.toBe(issue);
		expect(annotated.eligibility).toBe("review-required");
		expect(annotated.impact).toEqual({
			filesChanged: 0,
			filesTrashed: 1,
			inboundReferences: 0,
			coverageComplete: true,
		});
		expect(annotated.fingerprint).toBe("stable-fingerprint");
		expect(annotated.evidence).toEqual({ referenceCount: 0, coverageComplete: true });
	});
});
