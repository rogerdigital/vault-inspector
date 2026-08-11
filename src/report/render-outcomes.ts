import {
	summarizeOperationOutcomes,
	type OperationOutcome,
} from "../fix/action-outcomes";

const OUTCOME_LABELS: Record<OperationOutcome["outcome"], string> = {
	ignored: "Ignored",
	restored: "Restored",
	excluded: "Excluded",
	fixed: "Fixed",
	"still-present": "Still present",
	skipped: "Skipped",
	failed: "Failed",
};

export function renderOperationOutcomes(
	container: HTMLElement,
	outcomes: OperationOutcome[],
	onDismiss: () => void,
): void {
	if (outcomes.length === 0) return;

	const panel = container.createDiv({ cls: "vi-outcomes" });
	const header = panel.createDiv({ cls: "vi-outcomes-header" });
	const summary = summarizeOperationOutcomes(outcomes);
	const counts: Array<[string, number]> = [
		["Fixed", summary.fixed],
		["Still present", summary.stillPresent],
		["Skipped", summary.skipped],
		["Failed", summary.failed],
		["Ignored", summary.ignored],
		["Restored", summary.restored],
		["Excluded", summary.excluded],
	];
	header.createDiv({
		cls: "vi-outcomes-summary",
		text: counts
			.filter(([, count]) => count > 0)
			.map(([label, count]) => `${label} ${count}`)
			.join(" · "),
		attr: { role: "status", "aria-live": "polite" },
	});

	const dismiss = header.createEl("button", {
		cls: "vi-outcomes-dismiss",
		text: "Dismiss",
		attr: { type: "button" },
	});
	dismiss.addEventListener("click", onDismiss);

	const details = panel.createEl("details", { cls: "vi-outcomes-details" });
	details.createEl("summary", { text: "Details" });
	const list = details.createEl("ul", { cls: "vi-outcomes-list" });
	for (const outcome of outcomes) {
		const item = list.createEl("li", { cls: "vi-outcome-item" });
		item.createSpan({
			cls: `vi-outcome-label vi-outcome-${outcome.outcome}`,
			text: OUTCOME_LABELS[outcome.outcome],
		});
		item.createDiv({ cls: "vi-outcome-message", text: outcome.message });
		if ("phase" in outcome && outcome.phase) {
			item.createDiv({
				cls: "vi-outcome-phase",
				text: `Phase: ${outcome.phase}`,
			});
		}
		if (outcome.affectedPaths.length > 0) {
			const paths = item.createEl("ul", { cls: "vi-outcome-paths" });
			for (const path of outcome.affectedPaths) {
				paths.createEl("li", { text: path });
			}
		}
	}
}
