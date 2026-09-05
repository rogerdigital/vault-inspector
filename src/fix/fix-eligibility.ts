import type { FixEligibility, Issue } from "../scanner/Issue";

/**
 * One eligibility view shared by the confirmation model, the modal
 * controls, the report rows, and the bulk-selection gate. A missing field
 * (hand-built issue) degrades to review-required: fixable only through an
 * explicit per-item decision, never silently.
 */
export function resolveEligibility(issue: Issue): FixEligibility {
	return issue.eligibility ?? "review-required";
}

export type EligibilityExplanation = { status: string; reason: string };

const REVIEW_REQUIRED_REASON = "Review this finding before allowing its fix to run.";

/**
 * Sentence-case status and reason for the modal and the report row. The
 * status ALWAYS derives from `resolveEligibility` so the tier and its
 * explanation can never disagree; the reason picks the first matching
 * condition. The reason branches are ORDERED: specific safety conditions
 * (unverified, incomplete coverage, ambiguous duplicates) take precedence
 * over generic fallbacks — do not reorder.
 */
export function describeEligibility(
	issue: Issue,
): EligibilityExplanation {
	const action = issue.fixAction;
	if (!action) {
		return {
			status: "No fix available",
			reason: "This finding has no fix action.",
		};
	}
	const eligibility = resolveEligibility(issue);
	const status = eligibility === "blocked"
		? "Fix unavailable"
		: eligibility === "review-required"
			? "Review before fixing"
			: "Ready to fix";

	let reason: string;
	if (issue.classification === "unverified") {
		reason = "The finding could not be verified, so its fix cannot run.";
	} else if (
		action.kind === "trash-file"
		&& issue.impact?.coverageComplete === false
	) {
		reason = "Some references could not be checked, so files cannot be moved to trash safely.";
	} else if (action.selection?.requiresReview === true) {
		reason = "Several copies are referenced. Choose which location to keep before continuing.";
	} else if (issue.classification !== "confirmed") {
		reason = REVIEW_REQUIRED_REASON;
	} else if (
		action.kind === "remove-link-text"
		&& (action.original === undefined || action.replacement === undefined)
	) {
		reason = "The replacement text is incomplete, so review is required.";
	} else if (eligibility === "blocked") {
		reason = "This fix cannot run in the current state.";
	} else {
		reason = eligibility === "review-required"
			? REVIEW_REQUIRED_REASON
			: "The fix is confirmed and its evidence is complete.";
	}
	return { status, reason };
}
