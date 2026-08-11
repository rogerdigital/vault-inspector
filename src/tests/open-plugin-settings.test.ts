import { describe, expect, it, vi } from "vitest";
import { openPluginSettings } from "../utils/open-plugin-settings";

describe("openPluginSettings", () => {
	it("opens settings before selecting the plugin tab", () => {
		const open = vi.fn();
		const openTabById = vi.fn();
		const app = { setting: { open, openTabById } };

		expect(openPluginSettings(app as any, "vault-inspector")).toBe(true);
		expect(open).toHaveBeenCalledOnce();
		expect(openTabById).toHaveBeenCalledWith("vault-inspector");
		expect(open.mock.invocationCallOrder[0]).toBeLessThan(
			openTabById.mock.invocationCallOrder[0],
		);
	});

	it.each([
		{},
		{ setting: {} },
		{ setting: { open: vi.fn() } },
		{ setting: { openTabById: vi.fn() } },
	])("returns false for unavailable or partial settings APIs", (app) => {
		expect(openPluginSettings(app as any, "vault-inspector")).toBe(false);
	});

	it("returns false when the runtime settings API throws", () => {
		const app = {
			setting: {
				open: vi.fn(() => { throw new Error("unavailable"); }),
				openTabById: vi.fn(),
			},
		};

		expect(openPluginSettings(app as any, "vault-inspector")).toBe(false);
		expect(app.setting.openTabById).not.toHaveBeenCalled();
	});
});
