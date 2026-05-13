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
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		h1 = ((h1 << 5) - h1 + c) | 0;
		h2 = ((h2 << 5) - h2 + c) | 0;
	}
	return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
