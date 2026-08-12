import { describe, expect, it } from "vitest";
import {
	buildFixDecisionState,
	getFreshFixAction,
	resolveDecisionAction,
} from "../fix/fix-decisions";
import type { FixAction, Issue } from "../scanner/Issue";

function makeDuplicateIssue(
	fingerprint = "duplicates",
	paths = ["a.md", "b.md", "c.md"],
): Issue {
	const sorted = paths.slice().sort();
	const automaticKeepPath = sorted[0];
	const action: FixAction = {
		kind: "trash-file",
		label: "Delete duplicates",
		description:
			`Keep "${automaticKeepPath}" and move ${sorted.length - 1} duplicate(s) to trash`,
		targetPaths: sorted.slice(1),
		selection: {
			kind: "keep-one",
			candidatePaths: sorted,
			automaticKeepPath,
		},
	};
	return {
		scannerId: "duplicate-files",
		severity: "warning",
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: "Duplicate files (hash-identical)",
		message: `${sorted.length} files have identical content`,
		relatedPaths: sorted,
		evidence: { count: sorted.length, paths: sorted.join(", ") },
		fingerprint,
		fixAction: action,
	};
}

function makePlainIssue(): Issue {
	return {
		scannerId: "empty-notes",
		severity: "warning",
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: "Empty note",
		message: "Empty note",
		primaryPath: "empty.md",
		relatedPaths: [],
		evidence: {},
		fingerprint: "empty",
		fixAction: {
			kind: "trash-file",
			label: "Delete empty note",
			description: "Move empty.md to trash",
			targetPaths: ["empty.md"],
		},
	};
}

describe("fix decisions", () => {
	it("requires an explicit keep path in always-ask mode", () => {
		const state = buildFixDecisionState(
			[makeDuplicateIssue()],
			"always-ask",
			new Map(),
		);

		expect(state.complete).toBe(false);
		expect(state.decisions).toEqual([]);
	});

	it("builds automatic and mixed decisions", () => {
		const state = buildFixDecisionState(
			[makeDuplicateIssue(), makePlainIssue()],
			"automatic",
			new Map(),
		);

		expect(state).toEqual({
			complete: true,
			decisions: [
				{ fingerprint: "duplicates", keepPath: "a.md" },
				{ fingerprint: "empty" },
			],
		});
	});

	it.each(["a.md", "b.md", "c.md"])(
		"removes every duplicate except selected keep path %s",
		(keepPath) => {
			const issue = makeDuplicateIssue();
			const action = resolveDecisionAction(issue, {
				fingerprint: issue.fingerprint,
				keepPath,
			});

			expect(action?.targetPaths).toEqual(
				["a.md", "b.md", "c.md"].filter((path) => path !== keepPath),
			);
			expect(action?.targetPaths).not.toContain(keepPath);
		},
	);

	it("rebuilds a duplicate action from an unchanged fresh candidate set", () => {
		const requested = makeDuplicateIssue();
		const fresh = makeDuplicateIssue();

		const action = getFreshFixAction(requested, fresh, {
			fingerprint: requested.fingerprint,
			keepPath: "c.md",
		});

		expect(action?.targetPaths).toEqual(["a.md", "b.md"]);
	});

	it("rejects changed candidate sets and missing keep paths", () => {
		const requested = makeDuplicateIssue();

		expect(getFreshFixAction(
			requested,
			makeDuplicateIssue("duplicates", ["a.md", "b.md"]),
			{ fingerprint: "duplicates", keepPath: "b.md" },
		)).toBeNull();
		expect(getFreshFixAction(
			requested,
			makeDuplicateIssue(),
			{ fingerprint: "duplicates", keepPath: "missing.md" },
		)).toBeNull();
	});

	it("keeps exact matching behavior for non-duplicate actions", () => {
		const requested = makePlainIssue();
		const fresh = makePlainIssue();

		expect(getFreshFixAction(
			requested,
			fresh,
			{ fingerprint: "empty" },
		)).toEqual(fresh.fixAction);

		fresh.fixAction = {
			...fresh.fixAction!,
			targetPaths: ["changed.md"],
		};
		expect(getFreshFixAction(
			requested,
			fresh,
			{ fingerprint: "empty" },
		)).toBeNull();
	});
});
