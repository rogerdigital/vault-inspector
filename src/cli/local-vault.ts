/* eslint-disable import/no-nodejs-modules -- CLI local vault adapter runs in Node. */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { App, MetadataCache, TFile, Vault } from "obsidian";
import { extractBareUrls } from "../scanner/scanners/external-links";

type LocalFile = TFile & {
	path: string;
	stat: {
		ctime: number;
		mtime: number;
		size: number;
	};
};

type LinkCacheEntry = { link: string };
type HeadingCacheEntry = { heading: string };
type TagCacheEntry = { tag: string };

type LocalMetadata = {
	links?: LinkCacheEntry[];
	embeds?: LinkCacheEntry[];
	headings?: HeadingCacheEntry[];
	tags?: TagCacheEntry[];
	frontmatter?: Record<string, unknown>;
};

type LocalMetadataCache = MetadataCache & {
	resolvedLinks: Record<string, Record<string, string>>;
	unresolvedLinks: Record<string, Record<string, number>>;
	getFileCache(file: TFile): LocalMetadata | null;
};

export async function createLocalApp(vaultPath: string): Promise<App> {
	const files = await collectFiles(vaultPath);
	const filePathIndex = new Set(files.map((file) => file.path));
	const metadataByPath = new Map<string, LocalMetadata>();
	const resolvedLinks: Record<string, Record<string, string>> = {};
	const unresolvedLinks: Record<string, Record<string, number>> = {};

	for (const file of files.filter((item) => item.path.endsWith(".md"))) {
		const content = await readFile(join(vaultPath, file.path), "utf8");
		const metadata = parseMarkdownMetadata(content);
		metadataByPath.set(file.path, metadata);

		for (const link of [...metadata.links ?? [], ...metadata.embeds ?? []]) {
			if (isExternalUrl(link.link)) continue;
			const target = normalizeLinkTarget(link.link);
			if (!target) continue;

			const resolved = resolveVaultPath(target, filePathIndex);
			if (resolved) {
				resolvedLinks[file.path] = {
					...resolvedLinks[file.path],
					[link.link]: resolved,
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
	const body = stripFrontmatter(content);
	const links: LinkCacheEntry[] = [];
	const embeds: LinkCacheEntry[] = [];

	for (const match of body.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
		const entry = { link: match[2] };
		if (match[1] === "!") embeds.push(entry);
		else links.push(entry);
	}

	for (const match of body.matchAll(/(!?)\[[^\]]*]\(([^)]+)\)/g)) {
		const entry = { link: match[2].trim() };
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
	const tags = [...body.matchAll(/(^|\s)#([A-Za-z0-9_/-]+)/g)].map((match) => ({
		tag: `#${match[2]}`,
	}));

	return {
		links,
		embeds,
		headings,
		tags,
		frontmatter,
	};
}

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
	if (!content.startsWith("---\n")) return undefined;
	const end = content.indexOf("\n---", 4);
	if (end === -1) return undefined;

	const parsed: Record<string, unknown> = {};
	for (const line of content.slice(4, end).split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
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
	if (!content.startsWith("---\n")) return content;
	const end = content.indexOf("\n---", 4);
	if (end === -1) return content;
	return content.slice(end + 4);
}

function normalizeLinkTarget(link: string): string {
	return link.split("|")[0].split("#")[0].trim();
}

function resolveVaultPath(target: string, filePathIndex: Set<string>): string | null {
	const candidates = [target, `${target}.md`];
	for (const candidate of candidates) {
		if (filePathIndex.has(candidate)) return candidate;
	}

	if (!target.includes("/")) {
		const targetBase = target.replace(/\.md$/i, "");
		const match = [...filePathIndex]
			.filter((path) => path.endsWith(".md"))
			.find((path) => basename(path, ".md") === targetBase);
		if (match) return match;
	}

	return null;
}

function isExternalUrl(text: string): boolean {
	return /^https?:\/\//i.test(text);
}
