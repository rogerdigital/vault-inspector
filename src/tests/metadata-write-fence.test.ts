import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { MetadataWriteFence } from "../fix/metadata-write-fence";

function fixture() {
	vi.stubGlobal("window", globalThis);
	type Callback = (...args: unknown[]) => void;
	const listeners = new Map<object, { name: string; callback: Callback }>();
	const events = {
		on(name: string, callback: Callback) {
			const ref = {};
			listeners.set(ref, { name, callback });
			return ref;
		},
		offref(ref: object) { listeners.delete(ref); },
	};
	const emit = (name: string, ...args: unknown[]) => {
		for (const entry of [...listeners.values()]) {
			if (entry.name === name) entry.callback(...args);
		}
	};
	const file = { path: "Source.md", extension: "md" } as TFile;
	let exists = true;
	const app = {
		metadataCache: events,
		vault: { ...events, getAbstractFileByPath: () => exists ? file : null },
	} as unknown as App;
	const fence = new MetadataWriteFence(app, 100);
	return { file, fence, emit, listeners, remove: () => { exists = false; } };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("metadata write fence", () => {
	it("rejects early resolved and wrong content, then accepts the exact changed content plus resolved", async () => {
		const { file, fence, emit, listeners } = fixture();
		let finished = false;
		const waiting = fence.mutate(file, "new", async () => {}).then(value => {
			finished = true;
			return value;
		});
		emit("resolved");
		emit("changed", file, "old", {});
		emit("resolved");
		await Promise.resolve();
		expect(finished).toBe(false);
		emit("changed", file, "new", {});
		await Promise.resolve();
		expect(finished).toBe(false);
		emit("resolved");
		expect(await waiting).toBe(true);
		expect(listeners.size).toBe(0);
	});

	it("registers before write and accepts events fired inside modify", async () => {
		const { file, fence, emit, listeners } = fixture();
		expect(await fence.mutate(file, "new", async () => {
			expect(listeners.size).toBeGreaterThan(0);
			emit("changed", file, "new", {});
			emit("resolved");
		})).toBe(true);
		expect(listeners.size).toBe(0);
	});

	it("times out without throwing a successful write and removes listeners", async () => {
		vi.useFakeTimers();
		const { file, fence, listeners } = fixture();
		const write = vi.fn(async () => {});
		const waiting = fence.mutate(file, "new", write);
		await vi.advanceTimersByTimeAsync(100);
		expect(await waiting).toBe(false);
		expect(write).toHaveBeenCalledOnce();
		expect(fence.ready).toBe(false);
		expect(listeners.size).toBe(0);
		const secondWrite = vi.fn(async () => {});
		expect(await fence.mutate(file, "next", secondWrite)).toBe(false);
		expect(secondWrite).not.toHaveBeenCalled();
	});

	it("unload releases the waiter and removes all listeners", async () => {
		const { file, fence, listeners } = fixture();
		const waiting = fence.mutate(file, "new", async () => {});
		fence.dispose();
		expect(await waiting).toBe(false);
		expect(listeners.size).toBe(0);
	});

	it("preserves real write errors and still poisons the cache session", async () => {
		const { file, fence, listeners } = fixture();
		const error = new Error("write failed");
		await expect(fence.mutate(file, "new", async () => { throw error; })).rejects.toBe(error);
		expect(fence.ready).toBe(false);
		expect(listeners.size).toBe(0);
	});

	it("arms expected content in process before synchronous events", async () => {
		const { file, fence, emit } = fixture();
		expect(await fence.mutate(file, undefined, async expectContent => {
			expectContent("new");
			emit("changed", file, "new", {});
			emit("resolved");
		})).toBe(true);
	});

	it("does not await an event for an unchanged process result", async () => {
		const { file, fence, listeners } = fixture();
		expect(await fence.mutate(file, undefined, async () => {})).toBe(true);
		expect(listeners.size).toBe(0);
	});

	it("ignores other files and invalidates proof after conflicting source content", async () => {
		vi.useFakeTimers();
		const { file, fence, emit, listeners } = fixture();
		const waiting = fence.mutate(file, "new", async () => {});
		emit("changed", { path: "Other.md" }, "new", {});
		emit("resolved");
		emit("changed", file, "new", {});
		emit("changed", file, "different", {});
		emit("resolved");
		await vi.advanceTimersByTimeAsync(100);
		expect(await waiting).toBe(false);
		expect(listeners.size).toBe(0);
	});

	it("requires relevant deletion followed by resolution and actual path absence", async () => {
		const { file, fence, emit, remove, listeners } = fixture();
		let finished = false;
		const waiting = fence.mutate(file, null, async () => {}).then(value => {
			finished = true;
			return value;
		});
		emit("resolved");
		emit("deleted", { path: "Other.md" }, null);
		emit("resolved");
		await Promise.resolve();
		expect(finished).toBe(false);
		remove();
		emit("deleted", file, null);
		emit("resolved");
		expect(await waiting).toBe(true);
		expect(listeners.size).toBe(0);
	});
});
