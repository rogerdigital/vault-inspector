import { describe, expect, it, vi } from "vitest";
import type { App, SettingDefinitionGroup } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { SCANNER_IDS, SCANNER_LABELS } from "../scanner/Issue";
import {
	InspectorSettingTab,
	parseFolderList,
} from "../settings/settings-tab";
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
			"Automatic scanning",
			"Fix actions",
			"Thresholds",
			"Tags",
			"Ignored items",
			"Scanner-specific ignored folders",
			"Export",
		]);

		const namesByHeading = new Map(
			groups.map((group) => [
				group.heading,
				(group.items ?? []).map((item) => item.name),
			]),
		);
		expect(namesByHeading.get("Enabled scanners")).toEqual(
			SCANNER_IDS.map((id) => SCANNER_LABELS[id]),
		);
		expect(namesByHeading.get("Ignored items")).toEqual([
			"Ignored folders (comma-separated)",
			"Ignore unresolved note links",
			"Ignored frontmatter properties (comma-separated)",
		]);
		expect(namesByHeading.get("Scanner-specific ignored folders")).toEqual(
			SCANNER_IDS.map((id) => SCANNER_LABELS[id]),
		);
		expect(namesByHeading.get("Automatic scanning")).toEqual([
			"Automatic scan interval (hours)",
			"Automatic scan network checks",
		]);
		expect(names).toEqual(expect.arrayContaining([
			"Enable fix actions",
			"Duplicate file keep mode",
			"Large Markdown threshold (kb)",
			"Duplicate hash cap (mb)",
			"Report folder",
		]));
	});
});

describe("parseFolderList", () => {
	it("normalizes comma-separated folder lists", () => {
		expect(parseFolderList(" syncTrash, drafts, syncTrash, ,templates "))
			.toEqual(["syncTrash", "drafts", "templates"]);
	});

	it("returns an empty array for blank input", () => {
		expect(parseFolderList("   ")).toEqual([]);
	});
});
