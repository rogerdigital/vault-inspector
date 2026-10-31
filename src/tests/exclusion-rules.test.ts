import { describe, expect, it } from "vitest";
import { collectNoteTags, getExclusionRules, matchesExclusion, normalizeExclusionRules } from "../scanner/exclusions";
import { DEFAULT_SETTINGS } from "../settings/settings";

describe("exclusion rules", () => {
	it("normalizes values, merges matching scopes, and keeps global rules dominant", () => {
		expect(normalizeExclusionRules([
			{ kind: "tag", value: " #Clippings ", scanners: ["broken-links"] },
			{ kind: "tag", value: "clippings", scanners: ["tag-usage", "broken-links"] },
			{ kind: "folder", value: "archive\\", scanners: ["empty-notes"] },
			{ kind: "folder", value: "archive/", scanners: "all" },
			{ kind: "tag", value: "#", scanners: "all" },
		])).toEqual([
			{ kind: "folder", value: "archive", scanners: "all" },
			{ kind: "tag", value: "clippings", scanners: ["broken-links", "tag-usage"] },
		]);
	});
	it("retains legacy and new rules without mutating saved settings", () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ignoredFolders = ["archive"];
		settings.ignoredFoldersByScanner["broken-links"] = ["Templates"];
		settings.exclusionRules = [{ kind: "tag", value: "clippings", scanners: "all" }];
		const before = structuredClone(settings);
		expect(getExclusionRules(settings)).toHaveLength(3);
		expect(settings).toEqual(before);
	});
	it("collects actual metadata tags from both sources once", () => {
		expect(collectNoteTags({ frontmatter: { tags: ["clippings", "#work", null] }, tags: [{ tag: "#Clippings" }, { tag: "#work/web" }] } as any)).toEqual(["clippings", "work", "work/web"]);
		expect(collectNoteTags(undefined)).toEqual([]);
	});
	it("matches folder and tag boundaries without transitive attachment exclusion", () => {
		const rule = { kind: "tag", value: "work", scanners: "all" } as const;
		expect(matchesExclusion(rule, "Note.md", ["work/web/deep"])).toBe(true);
		expect(matchesExclusion(rule, "work/image.png", [])).toBe(false);
		expect(matchesExclusion(rule, "Note.md", ["workflow"])).toBe(false);
		const folder = { kind: "folder", value: "archive", scanners: "all" } as const;
		expect(matchesExclusion(folder, "archive/Note.md", [])).toBe(true);
		expect(matchesExclusion(folder, "archived/Note.md", [])).toBe(false);
	});
});
