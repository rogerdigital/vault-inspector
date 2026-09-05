import type { Issue } from "../scanner/Issue";
import { presentClassification } from "./presentation";

export function renderFindingEvidence(container: HTMLElement, issue: Issue): void {
	const classification = presentClassification(issue.classification);
	container.createSpan({
		cls: `vi-classification-badge ${classification.className}`,
		text: classification.label,
	});

	const explanation = container.createDiv({ cls: "vi-explanation" });
	renderRow(explanation, "Why", issue.explanation.why);
	if (issue.explanation.caveat?.trim()) {
		renderRow(explanation, "Keep in mind", issue.explanation.caveat);
	}
	renderRow(explanation, "Recommended next step", issue.explanation.nextStep);

	const disclosure = container.createEl("details", {
		cls: "vi-evidence-disclosure",
	});
	disclosure.addEventListener("click", (event) => event.stopPropagation());
	disclosure.createEl("summary", { text: "Technical evidence" });
	for (const key of Object.keys(issue.evidence).sort()) {
		renderRow(disclosure, key, String(issue.evidence[key]));
	}
}

function renderRow(container: HTMLElement, label: string, value: string): void {
	const row = container.createDiv({ cls: "vi-explanation-row" });
	row.createSpan({ cls: "vi-explanation-label", text: label });
	row.createSpan({ cls: "vi-explanation-value", text: value });
}
