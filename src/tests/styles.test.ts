import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("styles.css", () => {
	it("avoids gap properties that trigger Obsidian compatibility warnings", async () => {
		const css = await readFile("styles.css", "utf8");

		expect(css).not.toMatch(/\b(?:row-|column-)?gap\s*:/);
	});

	it("styles the report controls disclosure with reachable click targets", async () => {
		const css = await readFile("styles.css", "utf8");

		for (const className of [
			"vi-controls-disclosure",
			"vi-controls-body",
			"vi-controls-actions",
		]) {
			expect(css, `missing .${className}`).toContain(`.${className}`);
		}
		expect(css).not.toContain(".vi-toolbar");
		expect(css).toMatch(/\.vi-controls-disclosure\s*>\s*summary\s*\{[^}]*min-height:\s*32px;/);
		expect(css).toMatch(/\.vi-controls-disclosure\s*>\s*summary:focus-visible\s*\{/);
		expect(css).toMatch(/\.vi-filter-btn:focus-visible\s*\{/);
		const disclosureStart = css.indexOf("/* Report controls disclosure */");
		const disclosureEnd = css.indexOf("/* Scanner sections */");
		expect(disclosureStart, "missing disclosure styles marker").not.toBe(-1);
		expect(disclosureEnd, "missing styles section after the disclosure").not.toBe(-1);
		const disclosureStyles = css.slice(disclosureStart, disclosureEnd);
		const margins = [...disclosureStyles.matchAll(/margin(?:-top|-right|-left|-bottom)?:\s*([^;]+);/g)]
			.map((match) => match[1].trim());
		expect(margins.length).toBeGreaterThan(0);
	});

	it("styles finding interpretation, lifecycle, and resolved report elements", async () => {
		const css = await readFile("styles.css", "utf8");
		const requiredClasses = [
			"vi-classification-badge",
			"vi-classification-confirmed",
			"vi-classification-candidate",
			"vi-classification-unverified",
			"vi-status-badge",
			"vi-status-new",
			"vi-status-persisting",
			"vi-status-resolved",
			"vi-explanation",
			"vi-explanation-row",
			"vi-explanation-label",
			"vi-explanation-value",
			"vi-evidence-disclosure",
			"vi-fix-state",
			"vi-fix-state-label",
			"vi-fix-state-reason",
			"vi-fix-review",
			"vi-fix-unavailable",
			"vi-comparison-note",
			"vi-resolved-section",
			"vi-resolved-header",
			"vi-resolved-chevron",
			"vi-resolved-body",
			"vi-resolved-item",
			"vi-resolved-scanner",
			"vi-resolved-title",
			"vi-resolved-ignored",
		];

		for (const className of requiredClasses) {
			expect(css, `missing .${className}`).toContain(`.${className}`);
		}
		const newReportStyles = css.slice(
			css.indexOf("/* Finding interpretation and lifecycle */"),
			css.indexOf("/* Ignored section */"),
		);
		const backgrounds = [...newReportStyles.matchAll(/background(?:-color)?\s*:\s*([^;]+);/g)]
			.map((match) => match[1].trim());
		expect(backgrounds.length).toBeGreaterThan(0);
		expect(backgrounds.every((value) => value.startsWith("var(--"))).toBe(true);
		expect(css).not.toMatch(/background(?:-color)?\s*:\s*#(?:fff|ffffff|f[0-9a-f]{5})\b/i);
	});

	it("styles the changes-first summary with a single primary hierarchy", async () => {
		const css = await readFile("styles.css", "utf8");

		for (const className of [
			"vi-changes-headline",
			"vi-changes-primary",
			"vi-changes-resolved",
			"vi-changes-secondary",
		]) {
			expect(css, `missing .${className}`).toContain(`.${className}`);
		}
		expect(css).toMatch(/\.vi-changes-headline\s*\{[^}]*display:\s*flex;/);
		expect(css).toMatch(/\.vi-changes-primary\s*\{[^}]*font-weight:\s*700;/);
		expect(css).toMatch(/\.vi-changes-resolved\s*\{[^}]*color:\s*var\(--text-success\);/);
		expect(css).toMatch(/\.vi-changes-secondary\s*\{[^}]*color:\s*var\(--text-muted\);/);

		expect(css).not.toMatch(/\.vi-stats?\s*[{,.]/);
		expect(css).not.toContain(".vi-changes-stats");
		expect(css).not.toContain(".vi-changes-title");
		expect(css).not.toContain(".vi-changes-meta");
	});

	it("keeps the changes summary and long explanation values usable below 500px", async () => {
		const css = await readFile("styles.css", "utf8");
		const mobile = css.match(/@media\s*\(max-width:\s*500px\)\s*\{([\s\S]*?)\n\}/)?.[1];

		expect(mobile).toBeDefined();
		expect(mobile).toContain(".vi-changes-headline");
		expect(mobile).toMatch(/\.vi-changes-secondary\s*\{[^}]*overflow-wrap:\s*anywhere;/);
		expect(mobile).toContain(".vi-explanation-value");
		expect(mobile).toMatch(/\.vi-explanation-value\s*\{[^}]*overflow-wrap:\s*anywhere;/);
		expect(mobile).toMatch(/\.vi-explanation-value\s*\{[^}]*min-width:\s*0;/);
		expect(mobile).toMatch(/\.vi-explanation-value\s*\{[^}]*white-space:\s*normal;/);
	});

	it("keeps large report export actions reachable on narrow screens", async () => {
		const css = await readFile("styles.css", "utf8");

		expect(css).toMatch(/\.vi-large-report-buttons\s*\{[^}]*flex-wrap:\s*wrap;/);
		expect(css).toMatch(/\.vi-large-report-buttons\s*>\s*\*\s*\{[^}]*margin:\s*8px 0 0 8px;/);
		expect(css).toMatch(/@media\s*\(max-width:\s*500px\)\s*\{[\s\S]*?\.vi-large-report-buttons\s*\{[^}]*flex-direction:\s*column;/);
		expect(css).toMatch(/@media\s*\(max-width:\s*500px\)\s*\{[\s\S]*?\.vi-large-report-buttons\s*>\s*\*\s*\{[^}]*width:\s*100%;/);
	});

	it("styles fix impact preview elements and keeps them readable on narrow screens", async () => {
		const css = await readFile("styles.css", "utf8");

		for (const className of [
			"vi-eligibility-badge",
			"vi-eligibility-eligible",
			"vi-eligibility-review-required",
			"vi-eligibility-blocked",
			"vi-impact-card",
			"vi-impact-card-muted",
			"vi-impact-card-title",
			"vi-impact-reason",
			"vi-impact-rows",
			"vi-impact-row",
			"vi-impact-row-path",
			"vi-impact-row-meta",
			"vi-impact-consequence",
			"vi-impact-reference-details",
			"vi-impact-keep",
			"vi-review-checkbox",
			"vi-bulk-excluded-note",
		]) {
			expect(css, `missing .${className}`).toContain(`.${className}`);
		}
		expect(css).not.toContain(".vi-issue-fix-reason");
		expect(css).not.toContain(".vi-impact-coverage");

		const impactStyles = css.slice(css.indexOf("/* Fix impact preview */"));
		expect(impactStyles.length).toBeGreaterThan(0);
		const backgrounds = [...impactStyles.matchAll(/background(?:-color)?\s*:\s*([^;]+);/g)]
			.map((match) => match[1].trim());
		expect(backgrounds.length).toBeGreaterThan(0);
		expect(backgrounds.every((value) => value.startsWith("var(--"))).toBe(true);
		expect(impactStyles).toMatch(/\.vi-impact-row\s*\{[^}]*flex-wrap:\s*wrap;/);
		expect(impactStyles).toMatch(/\.vi-impact-row-path\s*\{[^}]*overflow-wrap:\s*anywhere;/);
		expect(impactStyles).toMatch(/\.vi-impact-reference-details\s*>\s*summary\s*\{[^}]*min-height:\s*32px;/);
		expect(impactStyles).toMatch(/\.vi-impact-reference-details\s*>\s*summary:focus-visible\s*\{/);
		expect(impactStyles).toMatch(/\.vi-impact-reference-details\s*>\s*div\s*\{[^}]*overflow-wrap:\s*anywhere;/);

		const mobile = css.match(/@media\s*\(max-width:\s*500px\)\s*\{([\s\S]*?)\n\}/)?.[1];
		expect(mobile).toBeDefined();
		expect(mobile).toMatch(/\.vi-impact-row\s*\{[^}]*flex-direction:\s*column;/);
		expect(mobile).toMatch(/\.vi-bulk-excluded-note\s*\{[^}]*overflow-wrap:\s*anywhere;/);
	});

	it("keeps confirmed and eligible statuses compact and contrast-safe", async () => {
		const css = await readFile("styles.css", "utf8");

		expect(css).toMatch(
			/\.vi-classification-badge\s*\{[^}]*align-self:\s*flex-start;/,
		);
		for (const className of [
			"vi-classification-confirmed",
			"vi-eligibility-eligible",
		]) {
			const rule = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1];
			expect(rule, `missing .${className}`).toBeDefined();
			expect(rule).toContain("background: var(--background-secondary)");
			expect(rule).toContain("color: var(--text-success)");
			expect(rule).toContain("border: 1px solid var(--text-success)");
			expect(rule).not.toContain(
				"background: var(--background-modifier-success)",
			);
		}
	});
});
