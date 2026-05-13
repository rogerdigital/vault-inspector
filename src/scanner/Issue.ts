export type ScannerId =
	| "broken-links"
	| "orphan-attachments"
	| "duplicate-files"
	| "frontmatter-types"
	| "tag-usage"
	| "large-files";

export type IssueSeverity = "info" | "warning" | "error";

export type Issue = {
	scannerId: ScannerId;
	severity: IssueSeverity;
	title: string;
	message: string;
	primaryPath?: string;
	relatedPaths: string[];
	evidence: Record<string, string | number | boolean>;
	fingerprint: string;
};

export type ScanResult = {
	startedAt: number;
	finishedAt: number;
	issues: Issue[];
	ignoredIssues: Issue[];
	filesScanned: number;
	scannersRun: ScannerId[];
};

export const SCANNER_IDS: ScannerId[] = [
	"broken-links",
	"orphan-attachments",
	"duplicate-files",
	"frontmatter-types",
	"tag-usage",
	"large-files",
];

export const SCANNER_LABELS: Record<ScannerId, string> = {
	"broken-links": "Broken Links",
	"orphan-attachments": "Orphan Attachments",
	"duplicate-files": "Duplicate Files",
	"frontmatter-types": "Frontmatter Types",
	"tag-usage": "Tag Usage",
	"large-files": "Large Files",
};
