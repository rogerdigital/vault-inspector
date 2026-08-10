import { describe, expect, it } from "vitest";
import type { FixAction, Issue } from "../scanner/Issue";
import {
	createSingleUseResolver,
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
});
