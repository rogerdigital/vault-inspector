import { describe, expect, it, vi } from "vitest";
import VaultInspectorPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { SCANNER_IDS } from "../scanner/Issue";
import { createScanSnapshot } from "../snapshot/scan-snapshot";

describe("DEFAULT_SETTINGS", () => {
	it("keeps external link checks opt-in by default", () => {
		expect(DEFAULT_SETTINGS.enabledScanners["external-links"]).toBe(false);
	});

	it("ignores Excalidraw markdown in large file checks by default", () => {
		expect(DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys).toContain("excalidraw-plugin");
		expect(DEFAULT_SETTINGS.ignoredLargeMarkdownPathPatterns).toEqual([]);
	});

	it("defaults duplicate cleanup to always ask", () => {
		expect(DEFAULT_SETTINGS.duplicateKeepMode).toBe("always-ask");
	});

	it("loads old settings with the safe duplicate keep default", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.loadData = vi.fn(async () => ({
			duplicateHashMaxBytes: 2 * 1024 * 1024,
		}));

		await plugin.loadSettings();

		expect(plugin.settings.duplicateKeepMode).toBe("always-ask");
	});

	it("preserves an explicit automatic duplicate keep mode", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.loadData = vi.fn(async () => ({
			duplicateKeepMode: "automatic",
		}));

		await plugin.loadSettings();

		expect(plugin.settings.duplicateKeepMode).toBe("automatic");
	});

	it("preserves persisted scanner choices while filling newly added scanner defaults", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.loadData = vi.fn(async () => ({
			enabledScanners: {
				"broken-links": false,
			},
		}));

		await plugin.loadSettings();

		expect(plugin.settings.enabledScanners["broken-links"]).toBe(false);
		expect(plugin.settings.enabledScanners["empty-notes"]).toBe(
			DEFAULT_SETTINGS.enabledScanners["empty-notes"],
		);
		expect(plugin.settings.enabledScanners["external-links"]).toBe(
			DEFAULT_SETTINGS.enabledScanners["external-links"],
		);
	});

	it("defines an empty ignored-folder list for every scanner", () => {
		expect(Object.keys(DEFAULT_SETTINGS.ignoredFoldersByScanner)).toEqual(SCANNER_IDS);
		for (const scannerId of SCANNER_IDS) {
			expect(DEFAULT_SETTINGS.ignoredFoldersByScanner[scannerId]).toEqual([]);
		}
	});

	it("fills scanner-specific ignored-folder defaults for old settings", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.loadData = vi.fn(async () => ({
			ignoredFolders: ["archive"],
		}));

		await plugin.loadSettings();

		expect(plugin.settings.ignoredFolders).toEqual(["archive"]);
		expect(Object.keys(plugin.settings.ignoredFoldersByScanner)).toEqual(SCANNER_IDS);
		for (const scannerId of SCANNER_IDS) {
			expect(plugin.settings.ignoredFoldersByScanner[scannerId]).toEqual([]);
		}
	});

	it("preserves partial scanner-specific ignored folders and fills missing scanners", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.loadData = vi.fn(async () => ({
			ignoredFoldersByScanner: {
				"broken-links": ["syncTrash"],
			},
		}));

		await plugin.loadSettings();

		expect(plugin.settings.ignoredFoldersByScanner["broken-links"]).toEqual(["syncTrash"]);
		expect(plugin.settings.ignoredFoldersByScanner["duplicate-files"]).toEqual([]);
		expect(Object.keys(plugin.settings.ignoredFoldersByScanner)).toEqual(SCANNER_IDS);
	});

	it("deep-merges settings from the persistence envelope and restores its snapshot", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		const snapshot = createScanSnapshot({
			startedAt: 1,
			finishedAt: 2,
			issues: [],
			ignoredIssues: [],
			filesScanned: 0,
			scannersRun: [],
		}, "profile", "0.5.0", 100);
		plugin.loadData = vi.fn(async () => ({
			settings: {
				enabledScanners: { "broken-links": false },
				ignoredFoldersByScanner: { "empty-notes": ["Templates"] },
			},
			lastSuccessfulSnapshot: snapshot,
		}));

		await plugin.loadSettings();

		expect(plugin.settings.enabledScanners["broken-links"]).toBe(false);
		expect(plugin.settings.enabledScanners["duplicate-files"]).toBe(
			DEFAULT_SETTINGS.enabledScanners["duplicate-files"],
		);
		expect(plugin.settings.ignoredFoldersByScanner["empty-notes"])
			.toEqual(["Templates"]);
		expect(plugin.settings.ignoredFoldersByScanner["broken-links"]).toEqual([]);
		expect(plugin.lastSuccessfulSnapshot).toEqual(snapshot);
	});
});
