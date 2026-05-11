import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { inferType, typesAreCompatible } from "../../utils/frontmatter-type";
import type { PropType } from "../../utils/frontmatter-type";

export const frontmatterTypesScanner = {
	id: "frontmatter-types" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const ignoredProps = new Set(ctx.ignoredProperties);
		const propertyTypes = new Map<string, Map<PropType, string[]>>();

		for (const file of ctx.markdownFiles) {
			if (isIgnored(file.path, ctx.ignoredFolders)) continue;

			const cache = ctx.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;
			if (!frontmatter) continue;

			for (const [key, value] of Object.entries(frontmatter)) {
				if (key === "position") continue;
				if (ignoredProps.has(key)) continue;

				const type = inferType(value);
				let typeMap = propertyTypes.get(key);
				if (!typeMap) {
					typeMap = new Map();
					propertyTypes.set(key, typeMap);
				}
				const paths = typeMap.get(type) ?? [];
				paths.push(file.path);
				typeMap.set(type, paths);
			}
		}

		for (const [prop, typeMap] of propertyTypes) {
			if (typeMap.size <= 1) continue;

			const types = Array.from(typeMap.keys());
			// Check if all types are mutually compatible
			let hasDrift = false;
			for (let i = 0; i < types.length - 1; i++) {
				for (let j = i + 1; j < types.length; j++) {
					if (!typesAreCompatible(types[i], types[j])) {
						hasDrift = true;
						break;
					}
				}
				if (hasDrift) break;
			}

			if (!hasDrift) continue;

			const typeSummary = types
				.map((t) => {
					const count = typeMap.get(t)?.length ?? 0;
					return `${t} (${count})`;
				})
				.join(", ");

			const allPaths: string[] = [];
			for (const paths of typeMap.values()) {
				allPaths.push(...paths);
			}

			issues.push({
				scannerId: "frontmatter-types",
				severity: "warning",
				title: "Frontmatter type drift",
				message: `Property "${prop}" has mixed types: ${typeSummary}`,
				relatedPaths: allPaths.slice(0, 10),
				evidence: {
					property: prop,
					types: typeSummary,
					fileCount: allPaths.length,
				},
				fingerprint: generateFingerprint("frontmatter-types", undefined, {
					property: prop,
					types: types.sort().join(","),
				}),
			});
		}

		return issues;
	},
};

function isIgnored(path: string, ignoredFolders: string[]): boolean {
	for (const folder of ignoredFolders) {
		if (path.startsWith(folder + "/") || path === folder) return true;
	}
	return false;
}
