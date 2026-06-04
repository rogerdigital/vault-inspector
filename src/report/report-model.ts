import type { ScanResult } from "../scanner/Issue";
import type { ScanProgress } from "../scanner/Issue";

export type ReportModel = {
	result: ScanResult | null;
	isScanning: boolean;
	scanProgress: ScanProgress | null;
	scanStartedAt: number | null;
	filterScanner: string | null;
	filterSeverity: string | null;
	enableFixActions: boolean;
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
	ignoredExpanded: boolean;
	ignoredSelectionMode: boolean;
	ignoredSelectedFingerprints: Set<string>;
};
