import { describe, expect, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import {
	COMPOSITION_FINDING_MESSAGE_MAX_LENGTH,
	boundCompositionFindings,
	collectCompositionSemanticFindings,
	collectCompositionValidationFindings,
	describeCompositionSchemaFindings,
	diffCompositionValidationFindings,
	type CompositionValidationFinding
} from './composition-validation-findings';
import { parsePresetIngress, PresetIngressSchema } from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import type { Preset } from './engine-schema';

function loadBlankDocument(): Preset {
	return parsePresetIngress(blankPresetJson);
}

function finding(
	overrides: Partial<CompositionValidationFinding> = {}
): CompositionValidationFinding {
	return {
		source: 'lint',
		rule: 'A1',
		severity: 'warn',
		path: 'state.overlays',
		message: 'An Overlay sits outside the action-safe area.',
		...overrides
	};
}

describe('composition schema findings', () => {
	it('names the exact field the schema rejected as a composition pointer', () => {
		const document = loadBlankDocument();
		document.state.transport.durationSeconds = 0;
		const parsed = PresetIngressSchema.safeParse(presetToWireFormat(document));
		expect(parsed.success).toBe(false);
		if (parsed.success) return;

		const findings = describeCompositionSchemaFindings(parsed.error);

		expect(findings[0].source).toBe('schema');
		expect(findings[0].severity).toBe('error');
		expect(findings[0].rule).toBeNull();
		expect(findings.map((entry) => entry.path)).toContain('/state/transport/durationSeconds');
	});
});

describe('composition semantic findings', () => {
	it('reports an unregistered Pack against the field that names it', () => {
		const document = loadBlankDocument();
		document.pack = 'not-a-registered-pack';

		const findings = collectCompositionSemanticFindings(document);

		expect(findings).toHaveLength(1);
		expect(findings[0].source).toBe('semantic');
		expect(findings[0].path).toBe('/pack');
		expect(findings[0].message.length).toBeLessThanOrEqual(COMPOSITION_FINDING_MESSAGE_MAX_LENGTH);
	});

	it('finds nothing wrong with a loadable composition', () => {
		expect(collectCompositionSemanticFindings(loadBlankDocument())).toEqual([]);
	});
});

describe('composition validation findings', () => {
	it('carries both the semantic and the static-linter checks', () => {
		const document = loadBlankDocument();
		document.pack = 'not-a-registered-pack';

		const sources = new Set(
			collectCompositionValidationFindings(document).map((entry) => entry.source)
		);

		expect(sources.has('semantic')).toBe(true);
		expect(sources.has('lint')).toBe(true);
	});
});

describe('composition validation finding delta', () => {
	it('separates the findings an edit introduced from the ones it resolved', () => {
		const stayed = finding({ rule: 'A1' });
		const cleared = finding({ rule: 'G5', message: 'Ink and paper do not separate.' });
		const appeared = finding({ rule: 'Q3', message: 'Title falls below the cap-height floor.' });

		expect(diffCompositionValidationFindings([stayed, cleared], [stayed, appeared])).toEqual({
			appeared: [appeared],
			cleared: [cleared]
		});
	});

	it('treats two findings from different checks at one path as distinct', () => {
		const lintFinding = finding({ source: 'lint', path: '/pack', rule: 'G5' });
		const semanticFinding = finding({ source: 'semantic', path: '/pack', rule: null });

		expect(diffCompositionValidationFindings([lintFinding], [semanticFinding]).appeared).toEqual([
			semanticFinding
		]);
	});
});

describe('bounded composition findings', () => {
	it('keeps the true total when it trims the list', () => {
		expect(boundCompositionFindings([finding(), finding({ rule: 'A2' })], 1)).toEqual({
			findings: [finding()],
			total: 2,
			truncated: true
		});
	});

	it('rejects a limit that is not a non-negative integer', () => {
		expect(() => boundCompositionFindings([], 1.5)).toThrow(TypeError);
	});
});
