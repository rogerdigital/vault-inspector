import { describe, expect, it, vi } from "vitest";
import type { Setting } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { exclusionSettingItems, exclusionSettingsDefinition, replaceExclusionRules } from "../settings/exclusion-settings";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { getExclusionRules } from "../scanner/exclusions";

vi.mock("obsidian", async (importOriginal) => {
	const original = await importOriginal<typeof import("obsidian")>();
	return {
		...original,
		Setting: class {
			name = "";
			buttons = new Map<string, () => Promise<void>>();
			settingEl = { rows: [] as unknown[], empty() { this.rows = []; }, addClass: vi.fn() };
			constructor(container: { rows: unknown[] }) { container.rows.push(this); }
			setName(name: string) { this.name = name; return this; }
			setDesc() { return this; }
			addButton(callback: (button: unknown) => void) {
				let label = "";
				const button = {
					setButtonText: (value: string) => { label = value; return button; },
					onClick: (handler: () => Promise<void>) => { this.buttons.set(label, handler); return button; },
				};
				callback(button);
				return this;
			}
		},
	};
});

describe("exclusion settings", () => {
	it("persists effective rules once and clears compatibility fields", () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ignoredFolders = ["Archive"];
		settings.ignoredFoldersByScanner["empty-notes"] = ["Drafts"];
		const effective = getExclusionRules(settings);
		replaceExclusionRules(settings, [...effective, { kind: "tag", value: "#skip", scanners: ["empty-notes", "broken-links"] }]);
		expect(settings.ignoredFolders).toEqual([]);
		expect(Object.values(settings.ignoredFoldersByScanner).flat()).toEqual([]);
		expect(getExclusionRules(settings)).toHaveLength(3);
		expect(settings.exclusionRules).toContainEqual({ kind: "tag", value: "skip", scanners: ["broken-links", "empty-notes"] });
	});

	it("shows migrated rules and removes them without resurrecting legacy exclusions", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ignoredFolders = ["Archive"];
		settings.ignoredFoldersByScanner["empty-notes"] = ["Drafts"];
		const plugin = { settings, saveSettings: vi.fn(async () => {}) } as unknown as VaultInspectorPlugin;
		const refresh = vi.fn();
		const items = exclusionSettingItems(plugin, refresh);
		expect(items.map((item) => item.name)).toEqual(["Folder: Archive", "Folder: Drafts", "Add exclusion"]);
		let remove: (() => Promise<void>) | undefined;
		const button = {
			setButtonText: (label: string) => ({ onClick: (callback: () => Promise<void>) => { if (label === "Remove") remove = callback; } }),
		};
		const setting = { addButton(callback: (component: typeof button) => void) { callback(button); return this; } };
		items[0]!.render(setting as unknown as Setting);
		await remove!();
		expect(getExclusionRules(settings)).toEqual([{ kind: "folder", value: "Drafts", scanners: ["empty-notes"] }]);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(refresh).toHaveBeenCalledOnce();
	});
	it("restores legacy and current rules when saving a removal fails, then allows retry", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ignoredFolders = ["Archive"];
		settings.ignoredFoldersByScanner["empty-notes"] = ["Drafts"];
		settings.exclusionRules = [{ kind: "tag", value: "skip", scanners: "all" }];
		const before = structuredClone(settings);
		const saveSettings = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined);
		const plugin = { settings, saveSettings } as unknown as VaultInspectorPlugin;
		const refresh = vi.fn();
		let remove: (() => Promise<void>) | undefined;
		const button = {
			setButtonText: (label: string) => ({ onClick: (callback: () => Promise<void>) => { if (label === "Remove") remove = callback; } }),
		};
		const setting = { addButton(callback: (component: typeof button) => void) { callback(button); return this; } };
		exclusionSettingItems(plugin, refresh)[0]!.render(setting as unknown as Setting);
		await expect(remove!()).resolves.toBeUndefined();
		expect(settings).toEqual(before);
		expect(refresh).not.toHaveBeenCalled();
		await remove!();
		expect(getExclusionRules(settings)).toHaveLength(2);
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("cached definition renders live settings on reopen and refreshes the native container", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		const plugin = { settings, saveSettings: vi.fn(async () => {}) } as unknown as VaultInspectorPlugin;
		const definition = exclusionSettingsDefinition(plugin);
		const host = () => ({ settingEl: { rows: [] as { name: string; buttons: Map<string, () => Promise<void>> }[], empty() { this.rows = []; }, addClass: vi.fn() } });
		const first = host();
		definition.render(first as unknown as Setting);
		expect(first.settingEl.rows.map((row) => row.name)).toEqual(["Add exclusion"]);
		settings.exclusionRules = [{ kind: "tag", value: "skip", scanners: ["broken-links"] }];
		const reopened = host();
		definition.render(reopened as unknown as Setting);
		expect(reopened.settingEl.rows.map((row) => row.name)).toEqual(["Tag: skip", "Add exclusion"]);
		await reopened.settingEl.rows[0]!.buttons.get("Remove")!();
		expect(reopened.settingEl.rows.map((row) => row.name)).toEqual(["Add exclusion"]);
		expect(settings.exclusionRules).toEqual([]);
	});

});
