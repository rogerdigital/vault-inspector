import type { CachedMetadata } from "obsidian";
import { SCANNER_IDS, type ScannerId } from "./Issue";
import type { ScanContext } from "./ScanContext";
import type { InspectorSettings } from "../settings/settings";
import { isIgnoredPath, isInFolder, normalizePath } from "../utils/paths";
import { normalizeTagName } from "../utils/tags";

export type ExclusionRule = {
	kind: "folder" | "tag";
	value: string;
	scanners: "all" | ScannerId[];
};

/** Canonical additive rules: merge identical conditions, sort scopes and values. */
export function normalizeExclusionRules(rules: ExclusionRule[]): ExclusionRule[] {
	const merged = new Map<string, ExclusionRule>();
	for (const rule of rules) {
		const value = rule.kind === "tag" ? normalizeTagName(rule.value).toLowerCase() : normalizePath(rule.value.trim());
		if (!value) continue;
		const scanners = rule.scanners === "all" ? "all" : SCANNER_IDS.filter((id) => rule.scanners.includes(id));
		if (scanners !== "all" && !scanners.length) continue;
		const key = JSON.stringify([rule.kind, value]);
		const previous = merged.get(key);
		const scope = previous?.scanners === "all" || scanners === "all" ? "all"
			: SCANNER_IDS.filter((id) => scanners.includes(id) || previous?.scanners.includes(id));
		merged.set(key, { kind: rule.kind, value, scanners: scope });
	}
	return [...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, rule]) => rule);
}

export function getExclusionRules(settings: InspectorSettings): ExclusionRule[] {
	return normalizeExclusionRules([
		...(settings.exclusionRules ?? []),
		...settings.ignoredFolders.map((value): ExclusionRule => ({ kind: "folder", value, scanners: "all" })),
		...SCANNER_IDS.flatMap((id) => (settings.ignoredFoldersByScanner[id] ?? [])
			.map((value): ExclusionRule => ({ kind: "folder", value, scanners: [id] }))),
	]);
}

export function collectNoteTags(cache: CachedMetadata | null | undefined): string[] {
	const frontmatter: unknown = cache?.frontmatter?.tags;
	const values: unknown[] = Array.isArray(frontmatter) ? frontmatter : typeof frontmatter === "string" ? [frontmatter] : [];
	return [...new Set([
		...values.filter((value): value is string => typeof value === "string"),
		...(cache?.tags ?? []).map((tag) => tag.tag),
	].map((tag) => normalizeTagName(tag).toLowerCase()).filter(Boolean))];
}

export function matchesExclusion(rule: ExclusionRule, path: string, tags: readonly string[]): boolean {
	return rule.kind === "folder" ? isInFolder(path, rule.value)
		: tags.some((tag) => tag === rule.value || tag.startsWith(`${rule.value}/`));
}

/** Only subjects are excluded. All file/destination/reference indexes remain complete. */
export function isExcludedFile(ctx: ScanContext, path: string): boolean {
	return ctx.excludedPaths?.has(path) === true || isIgnoredPath(path, ctx.ignoredFolders);
}
