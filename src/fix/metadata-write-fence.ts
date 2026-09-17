import type { App, EventRef, TFile } from "obsidian";

export type MutationFence = {
	readonly ready: boolean;
	mutate(file: TFile, content: string | null | undefined,
		write: (expectContent: (updated: string) => void) => Promise<void>): Promise<boolean>;
};

export const METADATA_NOT_READY =
	"Changes may already be saved, but metadata synchronization did not complete. " +
	"Remaining fixes in this batch were skipped. Run a fresh scan and review saved contents before retrying.";

export class MetadataWriteFence implements MutationFence {
	private poisoned = false;
	private disposed = false;
	private readonly cancel = new Set<() => void>();

	constructor(private readonly app: App, private readonly timeoutMs = 10000) {}

	get ready(): boolean { return !this.poisoned && !this.disposed; }

	async mutate(file: TFile, content: string | null | undefined,
		write: (expectContent: (updated: string) => void) => Promise<void>): Promise<boolean> {
		if (!this.ready) return false;
		const path = file.path;
		let relevant = false;
		let resolved = false;
		let writeDone = false;
		let done = false;
		let settle!: (value: boolean) => void;
		const waiting = new Promise<boolean>(resolve => { settle = resolve; });
		const metadataRefs: EventRef[] = [];
		const vaultRefs: EventRef[] = [];
		let timer: number | undefined;
		const finish = (success: boolean) => {
			if (done) return;
			done = true;
			if (!success) this.poisoned = true;
			for (const ref of metadataRefs) this.app.metadataCache.offref(ref);
			for (const ref of vaultRefs) this.app.vault.offref(ref);
			if (timer !== undefined) window.clearTimeout(timer);
			this.cancel.delete(cancel);
			settle(success);
		};
		const cancel = () => finish(false);
		const check = () => {
			if (!writeDone || !relevant || !resolved) return;
			if (content === null && this.app.vault.getAbstractFileByPath(path)) return;
			finish(true);
		};
		this.cancel.add(cancel);
		metadataRefs.push(this.app.metadataCache.on("changed", (changed, data) => {
			if (content === null || changed.path !== path) return;
			// A later change with other content invalidates earlier proof too.
			relevant = data === content;
			resolved = false;
		}));
		metadataRefs.push(this.app.metadataCache.on("deleted", deleted => {
			if (deleted.path !== path) return;
			relevant = content === null;
			resolved = false;
		}));
		if (content === null && file.extension !== "md") {
			vaultRefs.push(this.app.vault.on("delete", deleted => {
				if (deleted.path !== path) return;
				relevant = true;
				resolved = false;
			}));
		}
		metadataRefs.push(this.app.metadataCache.on("resolved", () => {
			if (!relevant) return;
			resolved = true;
			check();
		}));
		timer = window.setTimeout(cancel, this.timeoutMs);
		try {
			await write(updated => {
				content = updated;
				relevant = false;
				resolved = false;
			});
			writeDone = true;
			// process callbacks that return unchanged content do not schedule a cache event.
			if (content === undefined) finish(true);
			else check();
			return await waiting;
		} catch (error) {
			finish(false);
			throw error;
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const cancel of [...this.cancel]) cancel();
	}
}
