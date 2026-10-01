import { describe, expect, it } from 'vitest';

import {
	CAPABILITY_VOCABULARY_MEMBER_LIMIT,
	runInspectCapabilityLimitsOperation,
	runInspectCapabilityVocabularyOperation
} from './composition-capability-operations';
import { PUBLIC_EXPORT_RUNTIME_LIMITS } from './public-runtime-contract';
import {
	readWebmcpDerivedEnums,
	readWebmcpVocabularySections
} from './webmcp-derived-tool-schemas';
import { REGISTERED_EFFECT_TYPES, REGISTERED_OVERLAY_TYPES } from './pipelines/definition-registry';
import { STANDARD_TRANSPORT_RATES } from '../utils/composition-timing';
import {
	WEBMCP_RESULT_CHARACTER_BUDGET,
	WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET
} from './webmcp-operation-inventory';

describe('capability vocabulary', () => {
	it('answers one section from the live registry rather than a stored copy', () => {
		const receipt = runInspectCapabilityVocabularyOperation({ section: 'overlay-type' });

		expect(receipt.section).toBe('overlay-type');
		expect(receipt.members).toEqual(
			REGISTERED_OVERLAY_TYPES.slice(0, CAPABILITY_VOCABULARY_MEMBER_LIMIT)
		);
		expect(receipt.total).toBe(REGISTERED_OVERLAY_TYPES.length);
	});

	it('answers every declared section, with no composition open', () => {
		const vocabulary = readWebmcpDerivedEnums();

		for (const section of readWebmcpVocabularySections()) {
			const receipt = runInspectCapabilityVocabularyOperation({ section });
			expect(receipt.total, `${section} answered with nothing`).toBe(vocabulary[section].length);
			expect(receipt.members.length).toBeLessThanOrEqual(CAPABILITY_VOCABULARY_MEMBER_LIMIT);
			expect(receipt.truncated).toBe(receipt.total > CAPABILITY_VOCABULARY_MEMBER_LIMIT);
		}
	});

	it('stays inside the result budget for every section', () => {
		for (const section of readWebmcpVocabularySections()) {
			const serialized = JSON.stringify(runInspectCapabilityVocabularyOperation({ section }));
			expect(serialized.length, `${section} overruns the result budget`).toBeLessThanOrEqual(
				WEBMCP_RESULT_CHARACTER_BUDGET
			);
		}
	});

	it("lists one Effect's keyframe channels with bounds, inside the budget for every Effect", () => {
		const receipt = runInspectCapabilityVocabularyOperation({
			section: 'effect-type',
			effectType: 'pixelation'
		});
		expect(receipt.effectChannels).toEqual({
			effectType: 'pixelation',
			channels: [{ path: 'pixelSize', min: 1, max: 256, isInteger: true }]
		});
		expect(
			runInspectCapabilityVocabularyOperation({ section: 'overlay-type', effectType: 'pixelation' })
				.effectChannels
		).toBeUndefined();

		for (const effectType of REGISTERED_EFFECT_TYPES) {
			const serialized = JSON.stringify(
				runInspectCapabilityVocabularyOperation({ section: 'effect-type', effectType })
			);
			expect(serialized.length, `${effectType} overruns the result budget`).toBeLessThanOrEqual(
				WEBMCP_RESULT_CHARACTER_BUDGET
			);
		}
	});
});

describe('capability limits', () => {
	it('reports the ratified public envelope and the result budgets', () => {
		const receipt = runInspectCapabilityLimitsOperation();

		expect(receipt.transport).toEqual({
			maxDurationSeconds: PUBLIC_EXPORT_RUNTIME_LIMITS.maxDurationSeconds,
			maxFrameRate: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameRate,
			maxFrameCount: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount,
			rates: STANDARD_TRANSPORT_RATES
		});
		expect(receipt.output.maxOutputBytes).toBe(PUBLIC_EXPORT_RUNTIME_LIMITS.maxOutputBytes);
		expect(receipt.exportSession.maxConcurrent).toBe(
			PUBLIC_EXPORT_RUNTIME_LIMITS.maxConcurrentSessions
		);
		expect(receipt.result).toEqual({
			characterBudget: WEBMCP_RESULT_CHARACTER_BUDGET,
			wholeDocumentCharacterBudget: WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET
		});
	});
});
