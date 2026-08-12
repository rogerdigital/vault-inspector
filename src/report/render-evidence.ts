import type { Issue } from "../scanner/Issue";

export function renderFindingEvidence(container: HTMLElement, issue: Issue): void {
	container.createSpan({
		cls: `vi-classification-badge vi-classification-${issue.classification}`,
		text: issue.classification.toUpperCase(),
	});

	const explanation = container.createDiv({ cls: "vi-explanation" });
	renderRow(explanation, "Why", issue.explanation.why);
	if (issue.explanation.caveat?.trim()) {
		renderRow(explanation, "Caveat", issue.explanation.caveat);
	}
	renderRow(explanation, "Next", issue.explanation.nextStep);

	const disclosure = container.createEl("details", { cls: "vi-evidence-disclosure" });
	disclosure.addEventListener("click", (event) => event.stopPropagation());
	disclosure.createEl("summary", { text: "Evidence" });
	for (const key of Object.keys(issue.evidence).sort()) {
		renderRow(disclosure, key, String(issue.evidence[key]));
	}
}

function renderRow(container: HTMLElement, label: string, value: string): void {
	const row = container.createDiv({ cls: "vi-explanation-row" });
	row.createSpan({ cls: "vi-explanation-label", text: label });
	row.createSpan({ cls: "vi-explanation-value", text: value });
}
