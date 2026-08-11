import { describe, expect, it } from "vitest";
import {
	summarizeOperationOutcomes,
	type OperationOutcome,
} from "../fix/action-outcomes";

describe("summarizeOperationOutcomes", () => {
	it("counts mixed action and disposition outcomes", () => {
		const outcomes: OperationOutcome[] = [
			{ fingerprint: "ignored", outcome: "ignored", message: "Ignored", affectedPaths: ["a.md"] },
			{ fingerprint: "restored", outcome: "restored", message: "Restored", affectedPaths: ["b.md"] },
			{ scannerId: "large-files", outcome: "excluded", message: "Excluded", affectedPaths: ["generated"] },
			{ fingerprint: "fixed", outcome: "fixed", message: "Fixed", affectedPaths: ["c.md"] },
			{ fingerprint: "present", outcome: "still-present", message: "Still present", affectedPaths: ["d.md"], phase: "verification" },
			{ fingerprint: "skipped", outcome: "skipped", message: "Skipped", affectedPaths: ["e.md"], phase: "preflight" },
			{ fingerprint: "failed", outcome: "failed", message: "Failed", affectedPaths: ["f.md"], phase: "execution" },
			{ outcome: "failed", message: "Save failed", affectedPaths: [] },
		];

		expect(summarizeOperationOutcomes(outcomes)).toEqual({
			ignored: 1,
			restored: 1,
			excluded: 1,
			fixed: 1,
			stillPresent: 1,
			skipped: 1,
			failed: 2,
		});
	});

	it("returns zeroes for no outcomes", () => {
		expect(summarizeOperationOutcomes([])).toEqual({
			ignored: 0,
			restored: 0,
			excluded: 0,
			fixed: 0,
			stillPresent: 0,
			skipped: 0,
			failed: 0,
		});
	});
});
