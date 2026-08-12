export function normalizeTagName(value: string): string {
	return value.trim().replace(/^#/, "");
}
