import { describe, expect, it } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import { COMPARISON_VERSION, createScanSnapshot } from "../snapshot/scan-snapshot";
import type { ScanHistoryEntry } from "../snapshot/scan-history";
import { parsePluginData } from "../settings/plugin-data";

function makeSnapshot() {
	const issue: Issue = {
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
		title: "Broken link",
		message: "Missing target",
		primaryPath: "Source.md",
		relatedPaths: ["Missing.md"],
		evidence: { linkText: "Missing" },
		explanation: {
			why: "The target does not exist.",
			nextStep: "Update or remove the link.",
		},
		fingerprint: "broken-link-1",
	};
	const result: ScanResult = {
		startedAt: 1,
		finishedAt: 2,
		issues: [issue],
		ignoredIssues: [],
		filesScanned: 1,
		scannersRun: ["broken-links"],
	};
	return createScanSnapshot(result, "profile-1", "0.5.0", 100);
}

function makeHistoryEntry(createdAt: number): ScanHistoryEntry {
	return {
		schemaVersion: 1,
		createdAt,
		toolVersion: "0.7.0",
		scanProfile: "profile-1",
		comparisonVersion: COMPARISON_VERSION,
		trigger: "manual",
		filesScanned: 2,
		scannersRun: ["broken-links"],
		totals: {
			active: 1,
			ignored: 0,
			newIssues: 1,
			persistingIssues: 0,
			resolvedIssues: 0,
		},
		severityCounts: { error: 1, warning: 0, info: 0 },
		classificationCounts: { confirmed: 1, candidate: 0, unverified: 0 },
	};
}

describe("parsePluginData", () => {
	it("treats a flat settings object as legacy plugin data with empty history", () => {
		const value = {
			largeMarkdownBytes: 2048,
			enabledScanners: { "broken-links": false },
		};

		expect(parsePluginData(value)).toEqual({
			settings: value,
			lastSuccessfulSnapshot: null,
			scanHistory: [],
			legacy: true,
		});
	});

	it("parses a valid settings and snapshot envelope without history", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();

		expect(parsePluginData({ settings, lastSuccessfulSnapshot })).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [],
			legacy: false,
		});
	});

	it("parses history entries from the envelope", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();
		const newest = makeHistoryEntry(2);
		const oldest = makeHistoryEntry(1);

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [newest, oldest],
		})).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [newest, oldest],
			legacy: false,
		});
	});

	it("discards invalid history entries without discarding settings or the snapshot", () => {
		const settings = { ignoredFolders: ["Archive"] };
		const lastSuccessfulSnapshot = makeSnapshot();
		const valid = makeHistoryEntry(2);

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [valid, { schemaVersion: 1 }, null],
		})).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [valid],
			legacy: false,
		});
	});

	it("treats a non-array scanHistory as empty without affecting the envelope", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: "corrupted",
		})).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [],
			legacy: false,
		});
	});

	it("discards only an invalid snapshot from an otherwise valid envelope", () => {
		const settings = { ignoredFolders: ["Archive"] };

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot: { schemaVersion: 1 },
		})).toEqual({
			settings,
			lastSuccessfulSnapshot: null,
			scanHistory: [],
			legacy: false,
		});
	});

	it.each([null, undefined, "settings", 7, [], true])(
		"treats non-record data %j as empty legacy data",
		(value) => {
			expect(parsePluginData(value)).toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
				scanHistory: [],
				legacy: true,
			});
		},
	);

	it("preserves a structurally valid snapshot from another comparison version", () => {
		const snapshot = makeSnapshot();
		snapshot.comparisonVersion = COMPARISON_VERSION + 1;

		expect(parsePluginData({ settings: {}, lastSuccessfulSnapshot: snapshot }))
			.toEqual({
				settings: {},
				lastSuccessfulSnapshot: snapshot,
				scanHistory: [],
				legacy: false,
			});
	});

	it("discards a snapshot with an unsupported schema version", () => {
		const snapshot = makeSnapshot() as unknown as Record<string, unknown>;
		snapshot.schemaVersion = 2;

		expect(parsePluginData({ settings: {}, lastSuccessfulSnapshot: snapshot }))
			.toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
				scanHistory: [],
				legacy: false,
			});
	});

	it("discards a snapshot with unknown fields", () => {
		const snapshot = makeSnapshot() as unknown as Record<string, unknown>;
		snapshot.responseBody = "must not be persisted";

		expect(parsePluginData({ settings: {}, lastSuccessfulSnapshot: snapshot }))
			.toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
				scanHistory: [],
				legacy: false,
			});
	});
});
