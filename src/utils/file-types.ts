import { getExtension } from "./paths";

const ATTACHMENT_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"svg",
	"webp",
	"mp3",
	"wav",
	"ogg",
	"mp4",
	"webm",
	"pdf",
	"zip",
	"docx",
	"xlsx",
	"pptx",
]);

export function isAttachment(path: string): boolean {
	const ext = getExtension(path);
	return ext !== "" && ATTACHMENT_EXTENSIONS.has(ext);
}

export function isMarkdown(path: string): boolean {
	const ext = getExtension(path);
	return ext === "md";
}
