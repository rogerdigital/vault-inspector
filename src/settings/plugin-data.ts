import type { InspectorSettings } from "./settings";
import { isScanSnapshot, type ScanSnapshot } from "../snapshot/scan-snapshot";

export type PersistedPluginData = {
	settings: InspectorSettings;
	lastSuccessfulSnapshot?: ScanSnapshot;
};

export type ParsedPluginData = {
	settings: Partial<InspectorSettings>;
	lastSuccessfulSnapshot: ScanSnapshot | null;
	legacy: boolean;
};

export function parsePluginData(value: unknown): ParsedPluginData {
	if (!isRecord(value)) {
		return {
			settings: {},
			lastSuccessfulSnapshot: null,
			legacy: true,
		};
	}

	if (isRecord(value.settings)) {
		return {
			settings: value.settings,
			lastSuccessfulSnapshot: isScanSnapshot(value.lastSuccessfulSnapshot)
				? value.lastSuccessfulSnapshot
				: null,
			legacy: false,
		};
	}

	return {
		settings: value,
		lastSuccessfulSnapshot: null,
		legacy: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
