export type ScannerId =
	| "broken-links"
	| "orphan-attachments"
	| "empty-notes"
	| "external-links"
	| "duplicate-files"
	| "frontmatter-types"
	| "tag-usage"
	| "large-files";

export type IssueSeverity = "info" | "warning" | "error";

export type FixActionKind = "trash-file" | "remove-link-text";

export type KeepOneSelection = {
	kind: "keep-one";
	candidatePaths: string[];
	automaticKeepPath: string;
	/** Paths in the group with inbound references (sorted). */
	referencedPaths?: string[];
	/** True when 2+ paths have inbound references: an explicit keep choice is required even in automatic mode. */
	requiresReview?: boolean;
};

export type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
	/** Exact literal source syntax the fix locates, e.g. "[[Missing|Label]]". */
	original?: string;
	/** Text substituted in place of `original`; "" removes the range. */
	replacement?: string;
	selection?: KeepOneSelection;
};

/**
 * Whether a fix action may execute, derived centrally from the finding's
 * classification, action-evidence completeness, and reference coverage.
 * Never part of a fingerprint.
 */
export type FixEligibility = "eligible" | "review-required" | "blocked";

/**
 * Impact preview for a fix action, derived from the shared reference index.
 * Plain JSON values only. Never part of a fingerprint.
 */
export type FixImpact = {
	filesChanged: number;
	filesTrashed: number;
	inboundReferences: number;
	coverageComplete: boolean;
};

export type FindingClassification = "confirmed" | "candidate" | "unverified";

export type FindingExplanation = {
	why: string;
	caveat?: string;
	nextStep: string;
};

export type Issue = {
	scannerId: ScannerId;
	severity: IssueSeverity;
	title: string;
	message: string;
	classification: FindingClassification;
	explanation: FindingExplanation;
	primaryPath?: string;
	relatedPaths: string[];
	evidence: Record<string, string | number | boolean>;
	fingerprint: string;
	fixAction?: FixAction;
	/** Policy decision for `fixAction`; absent when there is no fix action. */
	eligibility?: FixEligibility;
	/** Impact preview for `fixAction`; absent when there is no fix action. */
	impact?: FixImpact;
};

export type ScanResult = {
	startedAt: number;
	finishedAt: number;
	issues: Issue[];
	ignoredIssues: Issue[];
	filesScanned: number;
	scannersRun: ScannerId[];
};

export type ScanProgress = {
	type: "scanner-start" | "scanner-progress" | "scanner-complete" | "scanner-skipped";
	scannerId: ScannerId;
	scannerIndex: number;
	scannerTotal: number;
	phase?: string;
	current?: number;
	total?: number;
	message?: string;
	elapsedMs: number;
};

export type ScanProgressCallback = (progress: ScanProgress) => void;

export const SCANNER_IDS: ScannerId[] = [
	"broken-links",
	"orphan-attachments",
	"empty-notes",
	"external-links",
	"duplicate-files",
	"frontmatter-types",
	"tag-usage",
	"large-files",
];

export const SCANNER_LABELS: Record<ScannerId, string> = {
	"broken-links": "Broken Links",
	"orphan-attachments": "Orphan Attachments",
	"empty-notes": "Empty Notes",
	"external-links": "External Links",
	"duplicate-files": "Duplicate Files",
	"frontmatter-types": "Frontmatter Types",
	"tag-usage": "Tag Usage",
	"large-files": "Large Files",
};
