import type { ScanContext } from "./ScanContext";
import { hasUriScheme, resolveVaultLinkTargets } from "../utils/vault-links";

export type ReferenceSourceKind = "note-link" | "embed" | "frontmatter" | "canvas";

export type ReferenceCoverageFailure = {
	path: string;
	reason: "malformed-json" | "read-failed" | "unexpected-shape";
	detail?: string;
};

export type InboundReference = {
	count: number;
	kinds: ReferenceSourceKind[];
	sources: string[];
};

export type ReferenceIndex = {
	inboundByPath: Map<string, InboundReference>;
	canvasFiles: string[];
	coverageFailures: ReferenceCoverageFailure[];
	coverageComplete: boolean;
};

/**
 * Placeholder index used in two-phase construction (contexts assembled
 * before a scan) and in tests; it is not a real scan result.
 */
export function makeEmptyReferenceIndex(): ReferenceIndex {
	return {
		inboundByPath: new Map(),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: true,
	};
}

export function getInboundReference(
	index: ReferenceIndex,
	path: string,
): InboundReference | undefined {
	return index.inboundByPath.get(path);
}

export function isReferenced(index: ReferenceIndex, path: string): boolean {
	return index.inboundByPath.has(path);
}

type CanvasNode = {
	type?: unknown;
	file?: unknown;
};

/**
 * Builds the shared reference index: which vault paths are referenced, how
 * often, through which source kinds (note links, embeds, frontmatter links,
 * Canvas file nodes), from which source files.
 *
 * Malformed or unreadable Canvas files are recorded as coverage failures and
 * mark the index incomplete; they never abort the scan. Consumers must treat
 * "no inbound references" as candidate evidence only while coverage is
 * incomplete, and must remember that CSS, Dataview, publishing pipelines,
 * and external applications can reference files outside this index.
 */
export async function buildReferenceIndex(
	ctx: Pick<
		ScanContext,
		"metadataCache" | "vault" | "markdownFiles" | "allFiles" | "filePathIndex"
	>,
): Promise<ReferenceIndex> {
	const inboundByPath = new Map<string, InboundReference>();
	const coverageFailures: ReferenceCoverageFailure[] = [];
	const canvasFiles: string[] = [];

	const addReference = (
		targetPath: string,
		sourcePath: string,
		kind: ReferenceSourceKind,
	): void => {
		const entry =
			inboundByPath.get(targetPath) ?? { count: 0, kinds: [], sources: [] };
		entry.count += 1;
		if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
		if (!entry.sources.includes(sourcePath)) entry.sources.push(sourcePath);
		inboundByPath.set(targetPath, entry);
	};

	const resolveTarget = (link: string, sourcePath: string): string | null => {
		// Guard the getFirstLinkpathDest branch; the fallback path re-checks
		// internally via hasUriScheme.
		if (!link || hasUriScheme(link)) return null;
		if (typeof ctx.metadataCache.getFirstLinkpathDest === "function") {
			return ctx.metadataCache.getFirstLinkpathDest(link, sourcePath)?.path ?? null;
		}
		return resolveVaultLinkTargets(ctx, link, sourcePath)[0] ?? null;
	};

	for (const file of ctx.markdownFiles) {
		const cache = ctx.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const link of cache.links ?? []) {
			const resolved = resolveTarget(link.link, file.path);
			if (resolved) addReference(resolved, file.path, "note-link");
		}
		for (const embed of cache.embeds ?? []) {
			const resolved = resolveTarget(embed.link, file.path);
			if (resolved) addReference(resolved, file.path, "embed");
		}
		for (const link of cache.frontmatterLinks ?? []) {
			const resolved = resolveTarget(link.link, file.path);
			if (resolved) addReference(resolved, file.path, "frontmatter");
		}
	}

	for (const file of ctx.allFiles) {
		if (file.extension !== "canvas") continue;
		canvasFiles.push(file.path);

		let content: string;
		try {
			content = await ctx.vault.cachedRead(file);
		} catch (error) {
			coverageFailures.push({
				path: file.path,
				reason: "read-failed",
				detail: error instanceof Error ? error.message : String(error),
			});
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch (error) {
			coverageFailures.push({
				path: file.path,
				reason: "malformed-json",
				detail: error instanceof Error ? error.message : String(error),
			});
			continue;
		}

		const nodes = isCanvasDocument(parsed) ? parsed.nodes : null;
		if (nodes === null) {
			coverageFailures.push({ path: file.path, reason: "unexpected-shape" });
			continue;
		}
		for (const node of nodes) {
			const canvasNode = node as CanvasNode | null;
			if (
				canvasNode === null ||
				canvasNode.type !== "file" ||
				typeof canvasNode.file !== "string" ||
				canvasNode.file === ""
			) {
				continue;
			}
			const resolved = resolveTarget(canvasNode.file, file.path);
			if (resolved) addReference(resolved, file.path, "canvas");
		}
	}

	for (const entry of inboundByPath.values()) {
		entry.kinds.sort();
		entry.sources.sort();
	}

	return {
		inboundByPath,
		canvasFiles,
		coverageFailures,
		coverageComplete: coverageFailures.length === 0,
	};
}

type CanvasDocument = {
	nodes: unknown[];
};

function isCanvasDocument(value: unknown): value is CanvasDocument {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as CanvasDocument).nodes)
	);
}
