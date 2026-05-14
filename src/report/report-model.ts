import type { ScanResult } from "../scanner/Issue";

export type ReportModel = {
	result: ScanResult | null;
	isScanning: boolean;
	filterScanner: string | null;
	filterSeverity: string | null;
	showIgnored: boolean;
	enableFixActions: boolean;
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
};
