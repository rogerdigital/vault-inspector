import type {
	FindingClassification,
	Issue,
	IssueSeverity,
} from "../scanner/Issue";
import type { CurrentFindingStatus } from "../scanner/result-diff";
import {
	describeEligibility,
	resolveEligibility,
} from "../fix/fix-eligibility";

export type PresentationToken = {
	label: string;
	className: string;
};

export type LifecyclePresentation = PresentationToken & {
	showOnCard: boolean;
};

export type FixPresentation = {
	actionLabel: string | null;
	stateLabel: string | null;
	reason: string | null;
	className: string;
};

const CLASSIFICATIONS: Record<FindingClassification, PresentationToken> = {
	confirmed: {
		label: "Confirmed",
		className: "vi-classification-confirmed",
	},
	candidate: {
		label: "Needs review",
		className: "vi-classification-candidate",
	},
	unverified: {
		label: "Could not verify",
		className: "vi-classification-unverified",
	},
};

const SEVERITY_LABELS: Record<IssueSeverity, string> = {
	error: "Errors",
	warning: "Warnings",
	info: "Info",
};

export function presentSeverity(severity: IssueSeverity): string {
	return SEVERITY_LABELS[severity];
}

export function presentClassification(
	classification: FindingClassification,
): PresentationToken {
	return CLASSIFICATIONS[classification];
}

export function presentLifecycle(
	status: CurrentFindingStatus,
): LifecyclePresentation {
	return status === "new"
		? { label: "New", className: "vi-status-new", showOnCard: true }
		: {
				label: "Previously found",
				className: "vi-status-persisting",
				showOnCard: false,
			};
}

export function presentFix(issue: Issue): FixPresentation | null {
	if (!issue.fixAction) return null;
	const eligibility = resolveEligibility(issue);
	const explanation = describeEligibility(issue);
	if (eligibility === "eligible") {
		return {
			actionLabel: "Fix this issue",
			stateLabel: null,
			reason: null,
			className: "vi-fix-ready",
		};
	}
	if (eligibility === "review-required") {
		return {
			actionLabel: "Review fix",
			stateLabel: explanation.status,
			reason: explanation.reason,
			className: "vi-fix-review",
		};
	}
	return {
		actionLabel: null,
		stateLabel: explanation.status,
		reason: explanation.reason,
		className: "vi-fix-unavailable",
	};
}
