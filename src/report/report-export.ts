export const MAX_SAFE_VAULT_REPORT_BYTES = 1024 * 1024;

export type LargeReportExportDecision = "summary" | "full" | null;

export function getUtf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function getReportExportPreflight(report: string): {
	byteLength: number;
	requiresConfirmation: boolean;
} {
	const byteLength = getUtf8ByteLength(report);
	return {
		byteLength,
		requiresConfirmation: byteLength > MAX_SAFE_VAULT_REPORT_BYTES,
	};
}

export function requiresLargeReportConfirmation(report: string): boolean {
	return getReportExportPreflight(report).requiresConfirmation;
}
