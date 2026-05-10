import type { ScannerId } from "./Issue";

export function generateFingerprint(
	scannerId: ScannerId,
	primaryPath: string | undefined,
	evidence: Record<string, string | number | boolean>,
): string {
	const stableEvidence = Object.keys(evidence)
		.sort()
		.map((k) => `${k}=${evidence[k]}`)
		.join("&");
	const raw = `${scannerId}:${primaryPath ?? ""}:${stableEvidence}`;
	return hashString(raw);
}

function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
	}
	return (hash >>> 0).toString(36);
}
