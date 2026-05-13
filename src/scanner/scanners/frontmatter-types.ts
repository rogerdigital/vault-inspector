import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { inferType, typesAreCompatible } from "../../utils/frontmatter-type";
import type { PropType } from "../../utils/frontmatter-type";
import { isIgnoredPath } from "../../utils/paths";

export const frontmatterTypesScanner = {
	id: "frontmatter-types" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const ignoredProps = new Set(ctx.ignoredProperties);
		const propertyTypes = new Map<string, Map<PropType, string[]>>();

		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

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
			const nonNullTypes = Array.from(typeMap.keys()).filter((t) => t !== "null");
			if (nonNullTypes.length <= 1) continue;

			let hasIncompatible = false;
			let hasDateAmbiguity = false;

			for (let i = 0; i < nonNullTypes.length - 1; i++) {
				for (let j = i + 1; j < nonNullTypes.length; j++) {
					if (!typesAreCompatible(nonNullTypes[i], nonNullTypes[j])) {
						hasIncompatible = true;
					}
					if (
						(nonNullTypes[i] === "string" && nonNullTypes[j] === "date") ||
						(nonNullTypes[i] === "date" && nonNullTypes[j] === "string")
					) {
						hasDateAmbiguity = true;
					}
				}
			}

			if (!hasIncompatible && !hasDateAmbiguity) continue;

			const severity = hasIncompatible ? "warning" : "info";
			const title = hasIncompatible
				? "Frontmatter type drift"
				: "Frontmatter type ambiguity";

			const types = Array.from(typeMap.keys());
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
				severity,
				title,
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
