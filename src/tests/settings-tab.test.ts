import { describe, expect, it, vi } from "vitest";
import type { App, SettingDefinitionGroup } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { SCANNER_IDS, SCANNER_LABELS } from "../scanner/Issue";
import { InspectorSettingTab } from "../settings/settings-tab";
import { DEFAULT_SETTINGS } from "../settings/settings";

describe("InspectorSettingTab", () => {
	it("defines every setting for Obsidian 1.13+ search", () => {
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			saveSettings: vi.fn(),
		} as unknown as VaultInspectorPlugin;
		const tab = new InspectorSettingTab({} as App, plugin);

		const definitions = tab.getSettingDefinitions();
		const groups = definitions.filter(
			(definition): definition is SettingDefinitionGroup =>
				"type" in definition && definition.type === "group",
		);
		const names = groups.flatMap((group) =>
			(group.items ?? []).map((item) => item.name),
		);

		expect(groups.map((group) => group.heading)).toEqual([
			"Enabled scanners",
			"Fix actions",
			"Thresholds",
			"Tags",
			"Ignored items",
			"Export",
		]);
		expect(names).toEqual([
			...SCANNER_IDS.map((id) => SCANNER_LABELS[id]),
			"Enable fix actions",
			"Duplicate file keep mode",
			"Large Markdown threshold (kb)",
			"Large attachment threshold (mb)",
			"Ignored large Markdown frontmatter keys",
			"Ignored large Markdown path patterns",
			"Duplicate hash cap (mb)",
			"Empty note word threshold",
			"Watched tags (comma-separated)",
			"Low usage tag threshold",
			"Ignored folders (comma-separated)",
			"Ignored frontmatter properties (comma-separated)",
			"Report folder",
		]);
	});
});
