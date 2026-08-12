import { describe, expect, it } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import { COMPARISON_VERSION, createScanSnapshot } from "../snapshot/scan-snapshot";
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

describe("parsePluginData", () => {
	it("treats a flat settings object as legacy plugin data", () => {
		const value = {
			largeMarkdownBytes: 2048,
			enabledScanners: { "broken-links": false },
		};

		expect(parsePluginData(value)).toEqual({
			settings: value,
			lastSuccessfulSnapshot: null,
			legacy: true,
		});
	});

	it("parses a valid settings and snapshot envelope", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();

		expect(parsePluginData({ settings, lastSuccessfulSnapshot })).toEqual({
			settings,
			lastSuccessfulSnapshot,
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
			legacy: false,
		});
	});

	it.each([null, undefined, "settings", 7, [], true])(
		"treats non-record data %j as empty legacy data",
		(value) => {
			expect(parsePluginData(value)).toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
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
				legacy: false,
			});
	});
});
