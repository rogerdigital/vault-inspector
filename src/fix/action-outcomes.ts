import type { ScannerId } from "../scanner/Issue";

export type ActionOutcome = {
	fingerprint: string;
	outcome: "fixed" | "still-present" | "skipped" | "failed";
	message: string;
	affectedPaths: string[];
	phase?: "preflight" | "execution" | "verification";
};

export type DispositionOutcome = {
	fingerprint?: string;
	scannerId?: ScannerId;
	outcome: "ignored" | "restored" | "excluded" | "failed";
	message: string;
	affectedPaths: string[];
};

export type OperationOutcome = ActionOutcome | DispositionOutcome;

export function summarizeOperationOutcomes(outcomes: OperationOutcome[]) {
	return {
		ignored: outcomes.filter((item) => item.outcome === "ignored").length,
		restored: outcomes.filter((item) => item.outcome === "restored").length,
		excluded: outcomes.filter((item) => item.outcome === "excluded").length,
		fixed: outcomes.filter((item) => item.outcome === "fixed").length,
		stillPresent: outcomes.filter((item) => item.outcome === "still-present").length,
		skipped: outcomes.filter((item) => item.outcome === "skipped").length,
		failed: outcomes.filter((item) => item.outcome === "failed").length,
	};
}
