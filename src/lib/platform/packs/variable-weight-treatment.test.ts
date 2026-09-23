import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { PACK_REGISTRY } from './registry.ts';
import {
	isVariableWeightTreatment,
	mapNormalizedVariableWeight,
	resolveVariableWeightTreatment,
	variableWeightTreatmentAppearanceVars,
	VARIABLE_WEIGHT_CSS_VARS
} from './variable-weight-treatment.ts';

describe('variable weight treatment', () => {
	it('resolves a real ordered range from every catalog Pack', () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			const treatment = resolveVariableWeightTreatment(manifest);
			assert.ok(treatment, slug);
			assert.ok(treatment.minimum < treatment.maximum, slug);
			assert.ok(treatment.rest >= treatment.minimum, slug);
			assert.ok(treatment.rest <= treatment.maximum, slug);
			assert.ok(
				(manifest.fonts ?? []).some(
					(font) => font.family === firstFontFamily(treatment.fontFamily)
				),
				`${slug} declares ${treatment.fontFamily}`
			);
		}
	});

	it('maps minimum, rest, and maximum piecewise and clamps overshoot', () => {
		const treatment = {
			fontFamily: "'Example Variable', sans-serif",
			minimum: 200,
			rest: 650,
			maximum: 900
		};
		assert.equal(mapNormalizedVariableWeight(treatment, -1), 200);
		assert.equal(mapNormalizedVariableWeight(treatment, 0), 200);
		assert.equal(mapNormalizedVariableWeight(treatment, 0.25), 425);
		assert.equal(mapNormalizedVariableWeight(treatment, 0.5), 650);
		assert.equal(mapNormalizedVariableWeight(treatment, 0.75), 775);
		assert.equal(mapNormalizedVariableWeight(treatment, 1), 900);
		assert.equal(mapNormalizedVariableWeight(treatment, 2), 900);
	});

	it('emits the exact inherited CSS variable contract', () => {
		const vars = variableWeightTreatmentAppearanceVars(PACK_REGISTRY.syntax);
		assert.equal(
			vars[VARIABLE_WEIGHT_CSS_VARS.fontFamily],
			"'Space Grotesk Variable', 'Space Grotesk', 'Inter', sans-serif"
		);
		assert.equal(vars[VARIABLE_WEIGHT_CSS_VARS.minimum], '300');
		assert.equal(vars[VARIABLE_WEIGHT_CSS_VARS.rest], '650');
		assert.equal(vars[VARIABLE_WEIGHT_CSS_VARS.maximum], '700');
	});

	it('keeps malformed or absent claims inert', () => {
		assert.equal(isVariableWeightTreatment(null), false);
		assert.equal(
			isVariableWeightTreatment({
				fontFamily: 'Example',
				minimum: 900,
				rest: 500,
				maximum: 100
			}),
			false
		);
		const manifest = structuredClone(PACK_REGISTRY.syntax);
		delete manifest.roles['variable-weight-treatment'];
		assert.equal(resolveVariableWeightTreatment(manifest), null);
		assert.deepEqual(variableWeightTreatmentAppearanceVars(manifest), {});
	});
});

function firstFontFamily(stack: string): string {
	return (stack.split(',')[0] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
}
