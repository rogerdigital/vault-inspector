import { describe, expect, it } from "vitest";
import { describeFinding } from "../scanner/finding-presentation";

describe("describeFinding", () => {
	it("omits an absent caveat and preserves an explicit caveat", () => {
		expect(describeFinding(
			"confirmed",
			"The target does not exist.",
			"Correct the link target.",
		)).toEqual({
			classification: "confirmed",
			explanation: {
				why: "The target does not exist.",
				nextStep: "Correct the link target.",
			},
		});

		expect(describeFinding(
			"candidate",
			"No note reference was found.",
			"Review external references.",
			"CSS and Canvas references are outside the scan boundary.",
		).explanation.caveat).toBe(
			"CSS and Canvas references are outside the scan boundary.",
		);
	});
});
