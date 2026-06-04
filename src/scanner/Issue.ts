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

export type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
};

export type Issue = {
	scannerId: ScannerId;
	severity: IssueSeverity;
	title: string;
	message: string;
	primaryPath?: string;
	relatedPaths: string[];
	evidence: Record<string, string | number | boolean>;
	fingerprint: string;
	fixAction?: FixAction;
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
