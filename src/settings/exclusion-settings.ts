import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { SCANNER_IDS, SCANNER_LABELS, type ScannerId } from "../scanner/Issue";
import { getExclusionRules, normalizeExclusionRules, type ExclusionRule } from "../scanner/exclusions";
import { createEmptyIgnoredFoldersByScanner, type InspectorSettings } from "./settings";

export function replaceExclusionRules(settings: InspectorSettings, rules: ExclusionRule[]): void {
	settings.exclusionRules = normalizeExclusionRules(rules);
	settings.ignoredFolders = [];
	settings.ignoredFoldersByScanner = createEmptyIgnoredFoldersByScanner();
}

class ExclusionEditor extends Modal {
	constructor(app: App, private rule: ExclusionRule, private save: (rule: ExclusionRule) => Promise<boolean>) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Scan exclusion");
		const draft = structuredClone(this.rule);
		let all = draft.scanners === "all";
		const selected = new Set<ScannerId>(all ? [] : draft.scanners as ScannerId[]);
		const scannerRows: Setting[] = [];
		new Setting(this.contentEl).setName("Match by").addDropdown((dropdown) => dropdown
			.addOption("folder", "Folder").addOption("tag", "Tag").setValue(draft.kind)
			.onChange((value) => { draft.kind = value === "tag" ? "tag" : "folder"; }));
		new Setting(this.contentEl).setName("Folder or tag")
			.setDesc("Use a vault-relative folder or tag name. Tags include subtags and match inline tags and frontmatter tags. References from excluded notes remain available to other checks.")
			.addText((text) => text.setValue(draft.value).setPlaceholder("E.g. Archive or #archive")
				.onChange((value) => { draft.value = value; }));
		new Setting(this.contentEl).setName("Apply to").addDropdown((dropdown) => dropdown
			.addOption("all", "All scanners").addOption("selected", "Selected scanners")
			.setValue(all ? "all" : "selected").onChange((value) => {
				all = value === "all";
				for (const row of scannerRows) row.settingEl.hidden = all;
			}));
		for (const id of SCANNER_IDS) {
			const row = new Setting(this.contentEl).setName(SCANNER_LABELS[id]).addToggle((toggle) => {
				toggle.setValue(selected.has(id)).onChange((value) => {
					if (value) selected.add(id);
					else selected.delete(id);
				});
			});
			row.settingEl.hidden = all;
			row.settingEl.addClass("vi-exclusion-scanner");
			scannerRows.push(row);
		}
		new Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
				draft.scanners = all ? "all" : [...selected];
				const normalized = normalizeExclusionRules([draft]);
				if (!normalized.length) {
					new Notice("Enter a folder or tag and select at least one scanner.");
					return;
				}
				if (await this.save(normalized[0])) this.close();
			}));
	}

	onClose(): void { this.contentEl.empty(); }
}

export function exclusionSettingItems(plugin: VaultInspectorPlugin, refresh: () => void): {
	name: string; desc?: string; render: (setting: Setting) => void;
}[] {
	const rules = getExclusionRules(plugin.settings);
	const persist = async (updated: ExclusionRule[]): Promise<boolean> => {
		const previous = {
			exclusionRules: plugin.settings.exclusionRules,
			ignoredFolders: plugin.settings.ignoredFolders,
			ignoredFoldersByScanner: plugin.settings.ignoredFoldersByScanner,
		};
		replaceExclusionRules(plugin.settings, updated);
		try {
			await plugin.saveSettings();
		} catch {
			Object.assign(plugin.settings, previous);
			new Notice("Could not save scan exclusions. Check available disk space and vault permissions, then try again.");
			return false;
		}
		refresh();
		return true;
	};
	return [
		...rules.map((rule, index) => ({
			name: `${rule.kind === "tag" ? "Tag" : "Folder"}: ${rule.value}`,
			desc: rule.scanners === "all" ? "All scanners" : rule.scanners.map((id) => SCANNER_LABELS[id]).join(", "),
			render: (setting: Setting) => {
				setting.addButton((button) => button.setButtonText("Edit").onClick(() => {
					new ExclusionEditor(plugin.app, rule, async (updated) => {
						return persist(rules.map((existing, i) => i === index ? updated : existing));
					}).open();
				})).addButton((button) => button.setButtonText("Remove").onClick(async () => {
					await persist(rules.filter((_, i) => i !== index));
				}));
			},
		})),
		{
			name: "Add exclusion",
			desc: "Exclude folders or tagged notes from all or selected scanners. Tags include subtags, inline tags, and frontmatter tags. Excluded notes still contribute references to other checks.",
			render: (setting: Setting) => {
				setting.addButton((button) => button.setButtonText("Add exclusion").onClick(() => {
					new ExclusionEditor(plugin.app, { kind: "folder", value: "", scanners: "all" }, async (rule) => {
						return persist([...rules, rule]);
					}).open();
				}));
			},
		},
	];
}

/** Native Obsidian caches definitions; resolve the live rules only when rendered. */
export function exclusionSettingsDefinition(plugin: VaultInspectorPlugin): {
	name: string; desc: string; render: (setting: Setting) => void;
} {
	return {
		name: "Exclusion rules",
		desc: "Exclude folders or tagged notes from all or selected scanners.",
		render: (setting) => {
			const container = setting.settingEl;
			container.addClass("vi-exclusion-rules");
			const refresh = () => {
				container.empty();
				for (const item of exclusionSettingItems(plugin, refresh)) {
					const row = new Setting(container).setName(item.name);
					if (item.desc !== undefined) row.setDesc(item.desc);
					item.render(row);
				}
			};
			refresh();
		},
	};
}
