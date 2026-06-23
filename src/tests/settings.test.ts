import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings";

describe("DEFAULT_SETTINGS", () => {
	it("keeps external link checks opt-in by default", () => {
		expect(DEFAULT_SETTINGS.enabledScanners["external-links"]).toBe(false);
	});

	it("ignores Excalidraw markdown in large file checks by default", () => {
		expect(DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys).toContain("excalidraw-plugin");
		expect(DEFAULT_SETTINGS.ignoredLargeMarkdownPathPatterns).toEqual([]);
	});
});
