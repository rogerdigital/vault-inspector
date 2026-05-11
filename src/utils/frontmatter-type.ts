export type PropType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "array"
	| "null";

export function inferType(value: unknown): PropType {
	if (value === null || value === undefined) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "string") {
		// ISO date pattern
		if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
		return "string";
	}
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	return "string";
}

export function typesAreCompatible(a: PropType, b: PropType): boolean {
	if (a === b) return true;
	if (a === "null" || b === "null") return true;
	// date and string are compatible
	if (
		(a === "date" && b === "string") ||
		(a === "string" && b === "date")
	)
		return true;
	return false;
}
