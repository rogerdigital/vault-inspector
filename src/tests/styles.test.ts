import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("styles.css", () => {
	it("avoids gap properties that trigger Obsidian compatibility warnings", async () => {
		const css = await readFile("styles.css", "utf8");

		expect(css).not.toMatch(/\b(?:row-|column-)?gap\s*:/);
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

	it("keeps stats and long explanation values usable below 500px", async () => {
		const css = await readFile("styles.css", "utf8");
		const mobile = css.match(/@media\s*\(max-width:\s*500px\)\s*\{([\s\S]*?)\n\}/)?.[1];

		expect(mobile).toBeDefined();
		expect(mobile).toContain(".vi-stats");
		expect(mobile).toContain(".vi-explanation-value");
		expect(mobile).toMatch(/\.vi-explanation-value\s*\{[^}]*overflow-wrap:\s*anywhere;/);
		expect(mobile).toMatch(/\.vi-explanation-value\s*\{[^}]*min-width:\s*0;/);
		expect(mobile).toMatch(/\.vi-explanation-value\s*\{[^}]*white-space:\s*normal;/);
	});
});
