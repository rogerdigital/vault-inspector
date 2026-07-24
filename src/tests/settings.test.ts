import { describe, expect, it, vi } from "vitest";
import VaultInspectorPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings/settings";

describe("DEFAULT_SETTINGS", () => {
	it("keeps external link checks opt-in by default", () => {
		expect(DEFAULT_SETTINGS.enabledScanners["external-links"]).toBe(false);
	});

	it("ignores Excalidraw markdown in large file checks by default", () => {
		expect(DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys).toContain("excalidraw-plugin");
		expect(DEFAULT_SETTINGS.ignoredLargeMarkdownPathPatterns).toEqual([]);
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
});
