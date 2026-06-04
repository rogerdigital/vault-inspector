import { describe, expect, it, vi } from "vitest";
import VaultInspectorPlugin from "../main";
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
