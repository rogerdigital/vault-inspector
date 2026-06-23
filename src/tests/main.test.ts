import { describe, expect, it, vi } from "vitest";
import VaultInspectorPlugin, { migrateExcalidrawFrontmatterKey } from "../main";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { InspectorSettings } from "../settings/settings";
import type { InspectorView } from "../report/InspectorView";

describe("VaultInspectorPlugin", () => {
	it("binds scan callbacks when Obsidian restores the inspector view", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		let viewFactory: ((leaf: unknown) => InspectorView) | null = null;
		const leaf: { app?: unknown; view?: InspectorView } = {};
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [leaf]),
				revealLeaf: vi.fn(async () => {}),
			},
			vault: {
				getAbstractFileByPath: vi.fn(),
			},
		};

		(plugin as any).app = app;
		(plugin as any).registerView = vi.fn((_type, factory) => {
			viewFactory = factory;
		});
		(plugin as any).scanAndRender = vi.fn(async () => {});

		await plugin.onload();

		expect(viewFactory).not.toBeNull();
		leaf.app = app;
		leaf.view = viewFactory!(leaf);

		expect((leaf.view as any).onRunScan).toEqual(expect.any(Function));
		(leaf.view as any).onRunScan();
		await Promise.resolve();

		expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect((plugin as any).scanAndRender).toHaveBeenCalledWith(leaf.view);
	});
});

describe("migrateExcalidrawFrontmatterKey", () => {
	function makeSettings(keys: string[]): InspectorSettings {
		return { ...DEFAULT_SETTINGS, ignoredLargeMarkdownFrontmatterKeys: keys };
	}

	it("replaces legacy excalidraw key with excalidraw-plugin", () => {
		const settings = makeSettings(["excalidraw"]);
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw"],
		});
		expect(changed).toBe(true);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
		]);
	});

	it("replaces legacy key while preserving other custom keys", () => {
		const settings = makeSettings(["excalidraw", "canvas"]);
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw", "canvas"],
		});
		expect(changed).toBe(true);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
			"canvas",
		]);
	});

	it("dedupes when both legacy and correct keys are present", () => {
		const settings = makeSettings(["excalidraw", "excalidraw-plugin"]);
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw", "excalidraw-plugin"],
		});
		expect(changed).toBe(true);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual([
			"excalidraw-plugin",
		]);
	});

	it("is a no-op when loaded value has no legacy key", () => {
		const settings = makeSettings(["excalidraw-plugin"]);
		const original = [...settings.ignoredLargeMarkdownFrontmatterKeys];
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			ignoredLargeMarkdownFrontmatterKeys: ["excalidraw-plugin"],
		});
		expect(changed).toBe(false);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual(original);
	});

	it("is a no-op when nothing was persisted (fresh install)", () => {
		const settings = makeSettings([...DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys]);
		const original = [...settings.ignoredLargeMarkdownFrontmatterKeys];
		const changed = migrateExcalidrawFrontmatterKey(settings, null);
		expect(changed).toBe(false);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual(original);
	});

	it("is a no-op when persisted value omits this setting", () => {
		const settings = makeSettings([...DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys]);
		const original = [...settings.ignoredLargeMarkdownFrontmatterKeys];
		const changed = migrateExcalidrawFrontmatterKey(settings, {
			largeMarkdownBytes: 500,
		});
		expect(changed).toBe(false);
		expect(settings.ignoredLargeMarkdownFrontmatterKeys).toEqual(original);
	});
});
