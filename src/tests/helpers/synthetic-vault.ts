import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SyntheticVaultSpec = {
	notes: number;
	attachments: number;
	seed?: number;
};

export type SyntheticVaultResult = {
	markdownFiles: number;
	attachmentFiles: number;
};

const SENTENCES = [
	"This sentence exists to give the note realistic prose volume.",
	"Deterministic filler keeps the generator reproducible from a fixed seed.",
	"Synthetic content stands in for a real vault without any user data.",
	"Repeated prose is fine because scanners only measure structure.",
];

const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1));

export async function generateSyntheticVault(
	vaultDir: string,
	spec: SyntheticVaultSpec,
): Promise<SyntheticVaultResult> {
	// Default seed pins the benchmark baseline: changing it changes every generated vault, and byte-reproducibility is a hard requirement for before/after comparisons.
	const seed = spec.seed ?? 20260829;
	let state = seed >>> 0;
	const nextRandom = (): number => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
	const randomInt = (min: number, max: number): number =>
		min + Math.floor(nextRandom() * (max - min + 1));

	const notePaths = Array.from(
		{ length: spec.notes },
		(_, index) => `notes/note-${String(index + 1).padStart(4, "0")}.md`,
	);
	const attachmentPaths = Array.from(
		{ length: spec.attachments },
		(_, index) => `attachments/asset-${String(index + 1).padStart(4, "0")}.png`,
	);

	for (let index = 0; index < notePaths.length; index++) {
		const lines: string[] = [
			`# Synthetic Note ${index + 1}`,
			"",
			`Deterministic prose paragraph for ${notePaths[index]}.`,
			SENTENCES[index % SENTENCES.length],
			"",
		];
		const linkCount = randomInt(1, 3);
		for (let link = 0; link < linkCount; link++) {
			const target = randomInt(1, spec.notes);
			lines.push(`- Related note: [[note-${String(target).padStart(4, "0")}]]`);
		}
		if (nextRandom() < 0.3) {
			lines.push(`- Stale link: [[missing-note-${randomInt(1, 999)}]]`);
		}
		if (spec.attachments > 0 && nextRandom() < 0.25) {
			const asset = randomInt(1, spec.attachments);
			lines.push(`- Attachment: ![[asset-${String(asset).padStart(4, "0")}.png]]`);
		}
		if (nextRandom() < 0.15) {
			const target = randomInt(1, spec.notes);
			lines.push(`- Cross reference: [see also](../notes/note-${String(target).padStart(4, "0")}.md)`);
		}
		await writePinned(join(vaultDir, notePaths[index]), `${lines.join("\n")}\n`);
	}

	for (let index = 0; index < attachmentPaths.length; index++) {
		const size = 1024 + ((index * 257) % 8192);
		const body = `synthetic-asset-${index + 1}: `.padEnd(size, "x");
		await writePinned(join(vaultDir, attachmentPaths[index]), body);
	}

	const duplicatePayload = "synthetic duplicate payload ".padEnd(2048, "d");
	await writePinned(
		join(vaultDir, "duplicates/copy-a/synthetic-report.bin"),
		duplicatePayload,
	);
	await writePinned(
		join(vaultDir, "duplicates/copy-b/synthetic-report.bin"),
		duplicatePayload,
	);

	return {
		markdownFiles: notePaths.length,
		attachmentFiles: attachmentPaths.length + 2,
	};
}

async function writePinned(absolutePath: string, content: string): Promise<void> {
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, content, "utf8");
	await utimes(absolutePath, FIXED_MTIME, FIXED_MTIME);
}
