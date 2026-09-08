import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, posix, relative, sep } from "node:path";
import { CORE_SCHEMA, load, YAMLException } from "js-yaml";
import type { App, MetadataCache, TFile, Vault } from "obsidian";
import { extractBareUrls } from "../src/scanner/scanners/external-links";
import type { LinkReference } from "../src/scanner/link-reference";
import { parseMarkdownSource } from "../src/utils/markdown-source";

type LocalFile = TFile & {
	path: string;
	stat: {
		ctime: number;
		mtime: number;
		size: number;
	};
};

type LinkCacheEntry = LinkReference & { sourceRelative?: boolean };
type HeadingCacheEntry = { heading: string };
type TagCacheEntry = { tag: string };

type LocalMetadata = {
	links?: LinkCacheEntry[];
	embeds?: LinkCacheEntry[];
	frontmatterLinks?: LinkCacheEntry[];
	headings?: HeadingCacheEntry[];
	blocks?: Record<string, { id: string }>;
	tags?: TagCacheEntry[];
	frontmatter?: Record<string, unknown>;
};

type LocalMetadataCache = MetadataCache & {
	resolvedLinks: Record<string, Record<string, number>>;
	unresolvedLinks: Record<string, Record<string, number>>;
	getFileCache(file: TFile): LocalMetadata | null;
};

export async function createLocalApp(vaultPath: string): Promise<App> {
	const files = await collectFiles(vaultPath);
	// Lowercased path index: Obsidian resolves internal links case-insensitively.
	// Insertion order follows the sorted file list so fallback matches are stable;
	// if two files differ only by case, the later-sorted entry wins (degenerate
	// case, matching the deterministic basename fallback).
	const filePathIndex = new Map(
		files.map((file) => [file.path.toLowerCase(), file.path]),
	);
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const metadataByPath = new Map<string, LocalMetadata>();
	const resolvedLinks: Record<string, Record<string, number>> = {};
	const unresolvedLinks: Record<string, Record<string, number>> = {};

	for (const file of files.filter((item) => item.path.endsWith(".md"))) {
		const content = await readFile(join(vaultPath, file.path), "utf8");
		const metadata = parseMarkdownMetadata(content, file.path);
		metadataByPath.set(file.path, metadata);

		for (const link of [...metadata.links ?? [], ...metadata.embeds ?? [], ...metadata.frontmatterLinks ?? []]) {
			if (hasUriScheme(link.link)) continue;
			const fragmentAt = link.link.indexOf("#");
			const path = fragmentAt === -1 ? link.link : link.link.slice(0, fragmentAt);
			const fragment = fragmentAt === -1 ? null : link.link.slice(fragmentAt + 1);
			const target = link.sourceRelative ? decodeDestination(path) : path.trim();
			link.destination = {
				path: target,
				fragment: fragment !== null && link.sourceRelative ? decodeDestination(fragment) : fragment,
				resolvedPath: null,
			};
			if (!target) {
				if (fragment !== null) link.destination.resolvedPath = file.path;
				continue;
			}

			const resolved = resolveVaultPath(
				target,
				filePathIndex,
				file.path,
				link.sourceRelative ?? false,
			);
			link.destination.resolvedPath = resolved;
			if (resolved) {
				resolvedLinks[file.path] = {
					...resolvedLinks[file.path],
					[resolved]: (resolvedLinks[file.path]?.[resolved] ?? 0) + 1,
				};
			} else {
				unresolvedLinks[file.path] = {
					...unresolvedLinks[file.path],
					[link.link]: (unresolvedLinks[file.path]?.[link.link] ?? 0) + 1,
				};
			}
		}
	}

	const vault = {
		getMarkdownFiles: () => files.filter((file) => file.path.endsWith(".md")),
		getFiles: () => files,
		cachedRead: async (file: TFile) => readFile(join(vaultPath, file.path), "utf8"),
		readBinary: async (file: TFile) => {
			const data = await readFile(join(vaultPath, file.path));
			return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
		},
	} as unknown as Vault;

	const metadataCache = {
		resolvedLinks,
		unresolvedLinks,
		getFileCache: (file: TFile) => metadataByPath.get(file.path) ?? null,
		getFirstLinkpathDest: (linkPath: string, sourcePath: string) => {
			if (!linkPath || hasUriScheme(linkPath)) return null;
			const resolved = resolveVaultPath(
				linkPath, filePathIndex, sourcePath, /^\.{1,2}\//.test(linkPath),
			);
			return resolved ? filesByPath.get(resolved) ?? null : null;
		},
	} as LocalMetadataCache;

	return {
		vault,
		metadataCache,
	} as unknown as App;
}

async function collectFiles(vaultPath: string): Promise<LocalFile[]> {
	const files: LocalFile[] = [];
	await walk(vaultPath, files);
	files.sort((a, b) => a.path.localeCompare(b.path));
	return files;

	async function walk(dir: string, output: LocalFile[]): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const absolutePath = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(absolutePath, output);
				continue;
			}
			if (!entry.isFile()) continue;
			const info = await stat(absolutePath);
			output.push({
				path: relative(vaultPath, absolutePath).split(sep).join("/"),
				name: basename(absolutePath),
				basename: basename(absolutePath, extname(absolutePath)),
				extension: extname(absolutePath).replace(/^\./, ""),
				stat: {
					ctime: info.ctimeMs,
					mtime: info.mtimeMs,
					size: info.size,
				},
			} as LocalFile);
		}
	}
}

function parseMarkdownMetadata(content: string, filePath: string): LocalMetadata {
	const frontmatter = parseFrontmatter(content, filePath);
	const source = parseMarkdownSource(content);
	const body = stripIgnoredMarkdownRegions(stripFrontmatter(content));
	const links: LinkCacheEntry[] = [];
	const embeds: LinkCacheEntry[] = [];
	const frontmatterLinks = extractFrontmatterWikiLinks(content);

	for (const match of body.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
		// Obsidian's LinkCache.link holds only the target portion (alias stripped,
		// heading kept); the alias lives in the display text.
		const entry = { link: match[2].split("|")[0], original: match[0] };
		if (match[1] === "!") embeds.push(entry);
		else links.push(entry);
	}

	for (const link of source.links) {
		const entry = {
			link: link.destination,
			original: link.original,
			sourceRelative: true,
		};
		if (link.kind === "image") embeds.push(entry);
		else links.push(entry);
	}

	for (const url of extractBareUrls(content)) {
		if (!links.some((link) => link.link === url) && !embeds.some((embed) => embed.link === url)) {
			links.push({ link: url });
		}
	}

	const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => ({
		heading: match[1].trim(),
	}));
	const tags = [...body.matchAll(/(^|\s)#([\p{L}\p{N}\p{M}_/-]+)/gu)].map((match) => ({
		tag: `#${match[2]}`,
	}));

	return {
		links,
		embeds,
		frontmatterLinks,
		headings,
		blocks: Object.fromEntries(source.blockIds.map((id) => [id, { id }])),
		tags,
		frontmatter,
	};
}

function extractFrontmatterWikiLinks(content: string): LinkCacheEntry[] {
	const section = splitFrontmatter(content);
	if (!section.frontmatter) return [];

	// Wiki aliases are display text, including in frontmatter.
	return [...section.frontmatter.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => ({
		link: match[1].split("|")[0],
	}));
}

function parseFrontmatter(content: string, filePath: string): Record<string, unknown> | undefined {
	const section = splitFrontmatter(content);
	if (section.frontmatter === undefined) return undefined;

	let value: unknown;
	try {
		value = load(section.frontmatter, { schema: CORE_SCHEMA });
	} catch (error) {
		// Parser messages/reasons/snippets can contain private property values.
		// YAML marks are zero-based; frontmatter starts on the note's second line.
		const mark = error instanceof YAMLException ? error.mark : undefined;
		throw new Error(`${filePath}:${(mark?.line ?? 0) + 2}:${(mark?.column ?? 0) + 1}: Invalid frontmatter YAML`);
	}
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${filePath}:2:1: Invalid frontmatter: expected a mapping`);
	}
	return value as Record<string, unknown>;
}

function stripFrontmatter(content: string): string {
	return splitFrontmatter(content).body;
}

function decodeDestination(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		// Invalid percent escapes remain literal filenames instead of aborting scans.
		return value;
	}
}

function resolveVaultPath(
	target: string,
	filePathIndex: Map<string, string>,
	sourcePath: string,
	sourceRelative: boolean,
): string | null {
	if (hasUriScheme(target)) return null;

	const normalizedTarget = posix.normalize(target.replace(/^\/+/, ""));
	const sourceDirectory = posix.dirname(sourcePath);
	const candidateTargets = sourceRelative || !target.includes("/")
		? [
			posix.normalize(posix.join(sourceDirectory, normalizedTarget)),
			normalizedTarget,
		]
		: [normalizedTarget];
	const candidates = candidateTargets.flatMap((candidate) => [
		candidate,
		`${candidate}.md`,
	]);
	for (const candidate of candidates) {
		const resolved = filePathIndex.get(candidate.toLowerCase());
		if (resolved) return resolved;
	}

	if (!normalizedTarget.includes("/")) {
		if (extname(normalizedTarget)) {
			const wanted = normalizedTarget.toLowerCase();
			const fileMatch = [...filePathIndex.values()].find(
				(path) => basename(path).toLowerCase() === wanted,
			);
			if (fileMatch) return fileMatch;
		}
		const targetBase = normalizedTarget.replace(/\.md$/i, "").toLowerCase();
		const match = [...filePathIndex.entries()]
			.filter(([lowerPath]) => lowerPath.endsWith(".md"))
			.find(([lowerPath]) => basename(lowerPath, ".md") === targetBase);
		if (match) return match[1];
	}

	return null;
}

function hasUriScheme(text: string): boolean {
	return /^[a-z][a-z\d+.-]*:/i.test(text);
}

function splitFrontmatter(content: string): {
	frontmatter?: string;
	body: string;
} {
	const match = /^\uFEFF?---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/.exec(content);
	if (!match) return { body: content };
	return {
		frontmatter: match[1],
		body: content.slice(match[0].length),
	};
}

function stripIgnoredMarkdownRegions(content: string): string {
	return maskMarkdown(
		maskMarkdown(
			maskMarkdown(content, /<!--[\s\S]*?-->/g),
			/^[ \t]*(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^[ \t]*\1[^\r\n]*$/gm,
		),
		/(`+)[^\r\n]*?\1/g,
	);
}

function maskMarkdown(content: string, pattern: RegExp): string {
	return content.replace(pattern, (match) => match.replace(/[^\r\n]/g, " "));
}
