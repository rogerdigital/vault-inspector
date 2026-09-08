/** Adapter-only resolution, kept separate from verbatim link and original syntax. */
export type LinkDestination = {
	path: string;
	fragment: string | null;
	/** Null is authoritative: consumers must not retry using another syntax. */
	resolvedPath: string | null;
};

/** Native Obsidian metadata omits destination and uses its normal resolver. */
export type LinkReference = {
	link: string;
	original?: string;
	destination?: LinkDestination;
};
