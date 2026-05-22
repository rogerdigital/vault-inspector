import type { ScanRunner } from "./ScanRunner";
import { brokenLinksScanner } from "./scanners/broken-links";
import { duplicateFilesScanner } from "./scanners/duplicate-files";
import { emptyNotesScanner } from "./scanners/empty-notes";
import { externalLinksScanner } from "./scanners/external-links";
import { frontmatterTypesScanner } from "./scanners/frontmatter-types";
import { largeFilesScanner } from "./scanners/large-files";
import { orphanAttachmentsScanner } from "./scanners/orphan-attachments";
import { tagUsageScanner } from "./scanners/tag-usage";

export function registerDefaultScanners(scanRunner: ScanRunner): void {
	scanRunner.register(brokenLinksScanner);
	scanRunner.register(largeFilesScanner);
	scanRunner.register(orphanAttachmentsScanner);
	scanRunner.register(emptyNotesScanner);
	scanRunner.register(externalLinksScanner);
	scanRunner.register(duplicateFilesScanner);
	scanRunner.register(frontmatterTypesScanner);
	scanRunner.register(tagUsageScanner);
}
