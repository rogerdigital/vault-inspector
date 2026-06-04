import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings";

describe("DEFAULT_SETTINGS", () => {
	it("keeps external link checks opt-in by default", () => {
		expect(DEFAULT_SETTINGS.enabledScanners["external-links"]).toBe(false);
	});
});
