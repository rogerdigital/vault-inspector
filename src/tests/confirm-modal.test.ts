import { describe, expect, it } from "vitest";
import type { FixAction, Issue } from "../scanner/Issue";
import {
	buildConfirmationPlan,
	buildImpactRows,
	createSingleUseResolver,
	describeEligibility,
	groupByEligibility,
	resolveEligibility,
	shouldAskForKeep,
	summarizeFixActions,
} from "../fix/confirm-modal";
import {
	buildFixDecisionState,
	resolveDecisionAction,
} from "../fix/fix-decisions";

describe("confirm modal action summary", () => {
	it("describes note modifications and trashed files separately", () => {
		const actions: FixAction[] = [
			{
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove a broken link",
				targetPaths: ["Source.md"],
				linkText: "Missing",
			},
			{
				kind: "trash-file",
				label: "Delete",
				description: "Move duplicate files to trash",
				targetPaths: ["copy-a.png", "copy-b.png"],
			},
		];
		const summary = summarizeFixActions(actions);

		expect(summary).toEqual({
			title: "Confirm batch fix (2 actions)",
			description: "This will modify 1 note and move 2 files to trash.",
			paths: ["Source.md", "copy-a.png", "copy-b.png"],
		});
	});

	it("previews a user-selected duplicate keep path", () => {
		const issue: Issue = {
			scannerId: "duplicate-files",
			severity: "warning",
			classification: "confirmed",
			explanation: {
				why: "Test evidence confirms this fixture.",
				nextStep: "Review the test fixture.",
			},
			title: "Duplicate files (hash-identical)",
			message: "3 files have identical content",
			relatedPaths: ["a.md", "b.md", "c.md"],
			evidence: { count: 3, paths: "a.md, b.md, c.md" },
			fingerprint: "duplicates",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "a.md" and move 2 duplicate(s) to trash',
				targetPaths: ["b.md", "c.md"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.md", "b.md", "c.md"],
					automaticKeepPath: "a.md",
				},
			},
		};
		const state = buildFixDecisionState(
			[issue],
			"always-ask",
			new Map([["duplicates", "c.md"]]),
		);
		const actions = state.decisions
			.map((decision) => resolveDecisionAction(issue, decision))
			.filter((action): action is FixAction => action !== null);

		expect(state.complete).toBe(true);
		expect(summarizeFixActions(actions)).toEqual({
			title: "Confirm fix",
			description: 'Keep "c.md" and move 2 duplicate(s) to trash',
			paths: ["a.md", "b.md"],
		});
	});

	it("settles a modal result only once", () => {
		const values: Array<string | null> = [];
		const settle = createSingleUseResolver<string | null>(
			(value) => values.push(value),
		);

		expect(settle("confirmed")).toBe(true);
		expect(settle(null)).toBe(false);
		expect(values).toEqual(["confirmed"]);
	});

	it("asks for a keep choice in always-ask mode or when review is required", () => {
		const plain = { kind: "keep-one" as const, candidatePaths: ["a.md"], automaticKeepPath: "a.md" };
		const review = {
			kind: "keep-one" as const,
			candidatePaths: ["a.md", "b.md"],
			automaticKeepPath: "a.md",
			referencedPaths: ["a.md", "b.md"],
			requiresReview: true,
		};

		expect(shouldAskForKeep("always-ask", plain)).toBe(true);
		expect(shouldAskForKeep("always-ask", review)).toBe(true);
		expect(shouldAskForKeep("automatic", plain)).toBe(false);
		expect(shouldAskForKeep("automatic", review)).toBe(true);
	});

	it("gates an automatic-mode review group on an explicit keep choice", () => {
		const issue: Issue = {
			scannerId: "duplicate-files",
			severity: "warning",
			classification: "confirmed",
			explanation: {
				why: "Test evidence confirms this fixture.",
				nextStep: "Review the test fixture.",
			},
			title: "Duplicate files (hash-identical)",
			message: "3 files have identical content",
			relatedPaths: ["a.md", "b.md", "c.md"],
			evidence: { count: 3, paths: "a.md, b.md, c.md" },
			fingerprint: "duplicates",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "a.md" and move 2 duplicate(s) to trash',
				targetPaths: ["b.md", "c.md"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.md", "b.md", "c.md"],
					automaticKeepPath: "a.md",
					referencedPaths: ["a.md", "b.md"],
					requiresReview: true,
				},
			},
		};

		const incomplete = buildFixDecisionState([issue], "automatic", new Map());
		expect(incomplete.complete).toBe(false);

		const decided = buildFixDecisionState(
			[issue],
			"automatic",
			new Map([["duplicates", "c.md"]]),
		);
		expect(decided.complete).toBe(true);
		const action = decided.decisions
			.map((decision) => resolveDecisionAction(issue, decision))
			.find((action): action is FixAction => action !== null);
		expect(action?.targetPaths).toEqual(["a.md", "b.md"]);
	});
});

function makeFixIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "orphan-attachments",
		severity: "warning",
		classification: "candidate",
		explanation: { why: "why", nextStep: "next step" },
		title: "Orphan attachment",
		message: "This attachment is not referenced by any note",
		primaryPath: "attachments/orphan.png",
		relatedPaths: [],
		evidence: {},
		fingerprint: "orphan",
		fixAction: {
			kind: "trash-file",
			label: "Delete",
			description: 'Move "attachments/orphan.png" to trash',
			targetPaths: ["attachments/orphan.png"],
		},
		...overrides,
	};
}

describe("fix impact preview policy", () => {
	it("treats a missing eligibility field as review-required", () => {
		expect(resolveEligibility(makeFixIssue())).toBe("review-required");
	});

	it("explains each eligibility tier with a sentence-case reason", () => {
		const unverified = makeFixIssue({
			classification: "unverified",
			eligibility: "blocked",
		});
		const incompleteCoverage = makeFixIssue({
			classification: "confirmed",
			eligibility: "blocked",
			impact: {
				filesChanged: 0,
				filesTrashed: 1,
				inboundReferences: 0,
				coverageComplete: false,
			},
		});
		const reviewGroup = makeFixIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			eligibility: "review-required",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["a.png", "b.png"],
					requiresReview: true,
				},
			},
		});
		const candidate = makeFixIssue({ eligibility: "review-required" });
		const missingReplacement = makeFixIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			eligibility: "review-required",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
			},
		});
		const eligible = makeFixIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			eligibility: "eligible",
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

		expect(describeEligibility(unverified)).toEqual({
			status: "Blocked",
			reason: "The finding is unverified, so its fix cannot run.",
		});
		expect(describeEligibility(incompleteCoverage)).toEqual({
			status: "Blocked",
			reason:
				"Reference coverage is incomplete, so files cannot be moved to trash safely.",
		});
		expect(describeEligibility(reviewGroup)).toEqual({
			status: "Review required",
			reason:
				"Several copies are referenced, so an explicit keep choice is required.",
		});
		expect(describeEligibility(candidate)).toEqual({
			status: "Review required",
			reason: "The finding needs review before its fix can run.",
		});
		expect(describeEligibility(missingReplacement)).toEqual({
			status: "Review required",
			reason: "The replacement text is not fully specified.",
		});
		expect(describeEligibility(eligible)).toEqual({
			status: "Eligible",
			reason: "The fix is confirmed and its evidence is complete.",
		});
	});

	it("groups fix-bearing issues by tier and ignores fix-less issues", () => {
		const eligible = makeFixIssue({
			classification: "confirmed",
			eligibility: "eligible",
		});
		const review = makeFixIssue({ eligibility: "review-required" });
		const blocked = makeFixIssue({
			classification: "unverified",
			eligibility: "blocked",
		});
		const missingField = makeFixIssue();

		const groups = groupByEligibility([
			eligible,
			review,
			blocked,
			missingField,
			{ ...makeFixIssue(), fixAction: undefined },
		]);

		expect(groups.eligible).toEqual([eligible]);
		expect(groups.reviewRequired).toEqual([review, missingField]);
		expect(groups.blocked).toEqual([blocked]);
	});

	it("never makes blocked actions actionable", () => {
		const plan = buildConfirmationPlan(
			[makeFixIssue({ classification: "unverified", eligibility: "blocked" })],
			"automatic",
			new Map(),
			new Set(["orphan"]),
		);
		expect(plan.actionable).toEqual([]);
		expect(plan.complete).toBe(false);
	});

	it("excludes unapproved review-required items but keeps the rest of the batch complete", () => {
		const eligible = makeFixIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			eligibility: "eligible",
			primaryPath: "notes/source.md",
			fingerprint: "link",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		const plan = buildConfirmationPlan(
			[eligible, makeFixIssue({ eligibility: "review-required" })],
			"automatic",
			new Map(),
			new Set(),
		);
		expect(plan.groups.reviewRequired).toHaveLength(1);
		expect(plan.actionable).toEqual([eligible]);
		expect(plan.complete).toBe(true);
	});

	it("approves a review-required duplicate group through an explicit keep choice", () => {
		const group = makeFixIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			eligibility: "review-required",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fingerprint: "dupes",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["a.png", "b.png"],
					requiresReview: true,
				},
			},
		});

		const undecided = buildConfirmationPlan(
			[group],
			"automatic",
			new Map(),
			new Set(),
		);
		expect(undecided.actionable).toEqual([]);
		expect(undecided.complete).toBe(false);

		const decided = buildConfirmationPlan(
			[group],
			"automatic",
			new Map([["dupes", "a.png"]]),
			new Set(),
		);
		expect(decided.actionable).toEqual([group]);
		expect(decided.complete).toBe(true);
	});

	it("approves a non-duplicate review-required item only through its fingerprint", () => {
		const issue = makeFixIssue({ eligibility: "review-required" });
		expect(
			buildConfirmationPlan([issue], "automatic", new Map(), new Set())
				.complete,
		).toBe(false);
		expect(
			buildConfirmationPlan([issue], "automatic", new Map(), new Set(["orphan"]))
				.complete,
		).toBe(true);
	});

	it("requires a keep choice for eligible duplicate groups in always-ask mode", () => {
		const group = makeFixIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			eligibility: "eligible",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fingerprint: "dupes",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
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
		expect(
			buildConfirmationPlan([group], "always-ask", new Map(), new Set())
				.complete,
		).toBe(false);
		expect(
			buildConfirmationPlan(
				[group],
				"always-ask",
				new Map([["dupes", "b.png"]]),
				new Set(),
			).complete,
		).toBe(true);
	});

	it("builds impact rows with size and modified date, degrading to explicit unknowns", () => {
		const mtime = Date.UTC(2026, 7, 29);
		const rows = buildImpactRows(
			["a.png", "gone.png"],
			new Map([["a.png", { size: 2048, mtime }]]),
		);
		expect(rows).toEqual([
			{
				path: "a.png",
				size: "2.0 KB",
				mtime: new Date(mtime).toLocaleDateString(),
			},
			{
				path: "gone.png",
				size: "Size unknown",
				mtime: "Modified date unknown",
			},
		]);
	});
});
