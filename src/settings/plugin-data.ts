import type { InspectorSettings } from "./settings";
import { isScanSnapshot, type ScanSnapshot } from "../snapshot/scan-snapshot";
import { parseScanHistory, type ScanHistoryEntry } from "../snapshot/scan-history";

export type PersistedPluginData = {
	settings: InspectorSettings;
	lastSuccessfulSnapshot?: ScanSnapshot;
	scanHistory?: ScanHistoryEntry[];
};

export type ParsedPluginData = {
	settings: Partial<InspectorSettings>;
	lastSuccessfulSnapshot: ScanSnapshot | null;
	scanHistory: ScanHistoryEntry[];
	legacy: boolean;
};

export function parsePluginData(value: unknown): ParsedPluginData {
	if (!isRecord(value)) {
		return {
			settings: {},
			lastSuccessfulSnapshot: null,
			scanHistory: [],
			legacy: true,
		};
	}

	if (isRecord(value.settings)) {
		return {
			settings: value.settings,
			lastSuccessfulSnapshot: isScanSnapshot(value.lastSuccessfulSnapshot)
				? value.lastSuccessfulSnapshot
				: null,
			scanHistory: parseScanHistory(value.scanHistory),
			legacy: false,
		};
	}

	return {
		settings: value,
		lastSuccessfulSnapshot: null,
		scanHistory: [],
		legacy: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
