import { describe, expect, it } from "vitest";
import type { FixAction } from "../scanner/Issue";
import * as confirmModal from "../fix/confirm-modal";

describe("confirm modal action summary", () => {
	it("describes note modifications and trashed files separately", () => {
		const actions: FixAction[] = [
			{
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove a broken link",
				targetPaths: ["Source.md"],
				linkText: "Missing",
			},
			{
				kind: "trash-file",
				label: "Delete",
				description: "Move duplicate files to trash",
				targetPaths: ["copy-a.png", "copy-b.png"],
			},
		];
		const summarizeFixActions = (
			confirmModal as unknown as {
				summarizeFixActions?: (value: FixAction[]) => unknown;
			}
		).summarizeFixActions;

		const summary = summarizeFixActions?.(actions) ?? null;

		expect(summary).toEqual({
			title: "Confirm batch fix (2 actions)",
			description: "This will modify 1 note and move 2 files to trash.",
			paths: ["Source.md", "copy-a.png", "copy-b.png"],
		});
	});
});
