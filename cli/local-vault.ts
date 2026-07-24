import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, posix, relative, sep } from "node:path";
import type { App, MetadataCache, TFile, Vault } from "obsidian";
import { extractBareUrls } from "../src/scanner/scanners/external-links";

type LocalFile = TFile & {
	path: string;
	stat: {
		ctime: number;
		mtime: number;
		size: number;
	};
};

type LinkCacheEntry = {
	link: string;
	original?: string;
	sourceRelative?: boolean;
};
type HeadingCacheEntry = { heading: string };
type TagCacheEntry = { tag: string };

type LocalMetadata = {
	links?: LinkCacheEntry[];
	embeds?: LinkCacheEntry[];
	frontmatterLinks?: LinkCacheEntry[];
	headings?: HeadingCacheEntry[];
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
	const filePathIndex = new Set(files.map((file) => file.path));
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const metadataByPath = new Map<string, LocalMetadata>();
	const resolvedLinks: Record<string, Record<string, number>> = {};
	const resolvedDestinations: Record<string, Record<string, string>> = {};
	const unresolvedLinks: Record<string, Record<string, number>> = {};

	for (const file of files.filter((item) => item.path.endsWith(".md"))) {
		const content = await readFile(join(vaultPath, file.path), "utf8");
		const metadata = parseMarkdownMetadata(content);
		metadataByPath.set(file.path, metadata);

		for (const link of [...metadata.links ?? [], ...metadata.embeds ?? []]) {
			if (hasUriScheme(link.link)) continue;
			const target = normalizeLinkTarget(link.link);
			if (!target) continue;

			const resolved = resolveVaultPath(
				target,
				filePathIndex,
				file.path,
				link.sourceRelative ?? false,
			);
			if (resolved) {
				resolvedLinks[file.path] = {
					...resolvedLinks[file.path],
					[resolved]: (resolvedLinks[file.path]?.[resolved] ?? 0) + 1,
				};
				resolvedDestinations[file.path] = {
					...resolvedDestinations[file.path],
					[link.link]: resolved,
					[target]: resolved,
				};
			} else {
				unresolvedLinks[file.path] = {
					...unresolvedLinks[file.path],
					[link.link]: 1,
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
			const target = normalizeLinkTarget(linkPath);
			if (!target || hasUriScheme(target)) return null;
			const resolved =
				resolvedDestinations[sourcePath]?.[linkPath] ??
				resolvedDestinations[sourcePath]?.[target] ??
				resolveVaultPath(
					target,
					filePathIndex,
					sourcePath,
					/^\.{1,2}\//.test(target),
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
			const absolutePath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.startsWith(".")) continue;
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

function parseMarkdownMetadata(content: string): LocalMetadata {
	const frontmatter = parseFrontmatter(content);
	const body = stripIgnoredMarkdownRegions(stripFrontmatter(content));
	const links: LinkCacheEntry[] = [];
	const embeds: LinkCacheEntry[] = [];
	const frontmatterLinks = extractFrontmatterWikiLinks(content);

	for (const match of body.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
		const entry = { link: match[2], original: match[0] };
		if (match[1] === "!") embeds.push(entry);
		else links.push(entry);
	}

	for (const match of body.matchAll(/(!?)\[[^\]]*]\(\s*(?:<([^>]+)>|([^)]+))\)/g)) {
		const target = match[2] ?? parseMarkdownDestination(match[3]);
		if (!target) continue;
		const entry = {
			link: target,
			original: match[0],
			sourceRelative: true,
		};
		if (match[1] === "!") embeds.push(entry);
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
		tags,
		frontmatter,
	};
}

function extractFrontmatterWikiLinks(content: string): LinkCacheEntry[] {
	const section = splitFrontmatter(content);
	if (!section.frontmatter) return [];

	return [...section.frontmatter.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => ({
		link: match[1],
	}));
}

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
	const section = splitFrontmatter(content);
	if (section.frontmatter === undefined) return undefined;

	const parsed: Record<string, unknown> = {};
	const lines = section.frontmatter.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (value === "") {
			const items: unknown[] = [];
			while (index + 1 < lines.length) {
				const itemMatch = /^\s+-\s+(.+?)\s*$/.exec(lines[index + 1]);
				if (!itemMatch) break;
				items.push(parseFrontmatterValue(itemMatch[1]));
				index++;
			}
			parsed[key] = items.length > 0 ? items : "";
			continue;
		}
		parsed[key] = parseFrontmatterValue(value);
	}
	return parsed;
}

function parseFrontmatterValue(value: string): unknown {
	if (value === "") return "";
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (value.startsWith("[") && value.endsWith("]")) {
		return value
			.slice(1, -1)
			.split(",")
			.map((item) => stripQuotes(item.trim()))
			.filter(Boolean);
	}
	return stripQuotes(value);
}

function stripQuotes(value: string): string {
	return value.replace(/^["']|["']$/g, "");
}

function stripFrontmatter(content: string): string {
	return splitFrontmatter(content).body;
}

function normalizeLinkTarget(link: string): string {
	return link.split("|")[0].split("#")[0].trim();
}

function resolveVaultPath(
	target: string,
	filePathIndex: Set<string>,
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
		if (filePathIndex.has(candidate)) return candidate;
	}

	if (!normalizedTarget.includes("/")) {
		if (extname(normalizedTarget)) {
			const fileMatch = [...filePathIndex].find(
				(path) => basename(path) === normalizedTarget,
			);
			if (fileMatch) return fileMatch;
		}
		const targetBase = normalizedTarget.replace(/\.md$/i, "");
		const match = [...filePathIndex]
			.filter((path) => path.endsWith(".md"))
			.find((path) => basename(path, ".md") === targetBase);
		if (match) return match;
	}

	return null;
}

function hasUriScheme(text: string): boolean {
	return /^[a-z][a-z\d+.-]*:/i.test(text);
}

function parseMarkdownDestination(rawDestination: string | undefined): string | null {
	if (!rawDestination) return null;
	const match = /^(\S+?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(
		rawDestination,
	);
	return match?.[1] ?? null;
}

function splitFrontmatter(content: string): {
	frontmatter?: string;
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
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
