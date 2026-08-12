import type {
	FindingClassification,
	FindingExplanation,
} from "./Issue";

export type FindingPresentation = {
	classification: FindingClassification;
	explanation: FindingExplanation;
};

export function describeFinding(
	classification: FindingClassification,
	why: string,
	nextStep: string,
	caveat?: string,
): FindingPresentation {
	return {
		classification,
		explanation: {
			why,
			...(caveat === undefined ? {} : { caveat }),
			nextStep,
		},
	};
}
