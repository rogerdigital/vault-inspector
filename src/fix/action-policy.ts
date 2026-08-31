import type {
	FixAction,
	FixEligibility,
	FixImpact,
	Issue,
} from "../scanner/Issue";
import {
	getInboundReference,
	type ReferenceIndex,
} from "../scanner/reference-index";

export type ActionPolicy = {
	eligibility: FixEligibility;
	impact: FixImpact;
};

/**
 * Derives the action policy for one finding. Pure: reads only the issue's
 * classification and fix action plus the shared reference index; never
 * mutates its inputs; never touches `evidence` or `fingerprint`, so policy
 * metadata cannot enter issue fingerprints. Returns null when the finding
 * carries no fix action.
 *
 * Eligibility rules, first match wins (blocked outranks review-required):
 * 1. unverified finding -> blocked;
 * 2. trash action while reference coverage is incomplete -> blocked;
 * 3. candidate finding -> review-required;
 * 4. incomplete action evidence -> review-required
 *    (remove-link-text without original+replacement, or a duplicate group
 *    flagged requiresReview: referenced copies must not be bulk-trashed);
 * 5. otherwise (confirmed, complete evidence) -> eligible.
 */
export function deriveActionPolicy(
	issue: Issue,
	index: ReferenceIndex,
): ActionPolicy | null {
	const action = issue.fixAction;
	if (!action) return null;

	const impact = computeImpact(action, index);

	let eligibility: FixEligibility;
	if (issue.classification === "unverified") {
		eligibility = "blocked";
	} else if (action.kind === "trash-file" && !impact.coverageComplete) {
		eligibility = "blocked";
	} else if (issue.classification !== "confirmed") {
		eligibility = "review-required";
	} else if (!actionEvidenceComplete(action)) {
		eligibility = "review-required";
	} else {
		eligibility = "eligible";
	}

	return { eligibility, impact };
}

/**
 * Returns a copy of the issue annotated with `eligibility` and `impact` when
 * it carries a fix action, or the issue itself (same reference, no new keys)
 * when it does not.
 */
export function withActionPolicy(
	issue: Issue,
	index: ReferenceIndex,
): Issue {
	const policy = deriveActionPolicy(issue, index);
	if (!policy) return issue;
	return {
		...issue,
		eligibility: policy.eligibility,
		impact: policy.impact,
	};
}

function actionEvidenceComplete(action: FixAction): boolean {
	if (action.kind === "remove-link-text") {
		return action.original !== undefined && action.replacement !== undefined;
	}
	// trash-file: a keep-one group with 2+ referenced paths demands an
	// explicit keep choice, so it is never bulk-eligible.
	return action.selection?.requiresReview !== true;
}

function computeImpact(action: FixAction, index: ReferenceIndex): FixImpact {
	const trashing = action.kind === "trash-file";
	const inboundReferences = action.targetPaths.reduce(
		(total, path) => total + (getInboundReference(index, path)?.count ?? 0),
		0,
	);
	return {
		filesChanged: trashing ? 0 : action.targetPaths.length,
		filesTrashed: trashing ? action.targetPaths.length : 0,
		inboundReferences,
		coverageComplete: index.coverageComplete,
	};
}
