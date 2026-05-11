import { getExtension } from "./paths";

const ATTACHMENT_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"pdf",
	"mp3",
	"mp4",
	"wav",
	"mov",
	"zip",
]);

export function isAttachment(path: string): boolean {
	const ext = getExtension(path);
	return ext !== "" && ATTACHMENT_EXTENSIONS.has(ext);
}

export function isMarkdown(path: string): boolean {
	const ext = getExtension(path);
	return ext === "md";
}
