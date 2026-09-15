import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	applyTextAnimationUnitVariableWeight,
	resolveTextAnimationVariableWeightTreatment,
	stabilizeTextAnimationVariableWeightLayout
} from './unit-style';
import { VARIABLE_WEIGHT_CSS_VARS } from '$lib/platform/packs/variable-weight-treatment';

const TREATMENT = {
	fontFamily: "'Example Variable', sans-serif",
	minimum: 200,
	rest: 650,
	maximum: 900
};

describe('text-animation variable weight styles', () => {
	it('reads the inherited Pack coordinate contract from computed style', () => {
		const element = document.createElement('span');
		element.style.setProperty(VARIABLE_WEIGHT_CSS_VARS.fontFamily, TREATMENT.fontFamily);
		element.style.setProperty(VARIABLE_WEIGHT_CSS_VARS.minimum, String(TREATMENT.minimum));
		element.style.setProperty(VARIABLE_WEIGHT_CSS_VARS.rest, String(TREATMENT.rest));
		element.style.setProperty(VARIABLE_WEIGHT_CSS_VARS.maximum, String(TREATMENT.maximum));
		document.body.append(element);

		assert.deepEqual(resolveTextAnimationVariableWeightTreatment(element), TREATMENT);
		element.remove();
	});

	it('writes a real wght axis and clears it for an ordinary effect', () => {
		const element = document.createElement('span');
		applyTextAnimationUnitVariableWeight(element, 0.25, TREATMENT);
		assert.equal(element.style.fontFamily, '"Example Variable", sans-serif');
		assert.equal(element.style.fontWeight, '425');
		assert.equal(element.style.fontVariationSettings, '"wght" 425');
		assert.equal(element.style.fontSynthesis, 'none');

		applyTextAnimationUnitVariableWeight(element, undefined, TREATMENT);
		assert.equal(element.style.fontFamily, '');
		assert.equal(element.style.fontWeight, '');
		assert.equal(element.style.fontVariationSettings, '');
		assert.equal(element.style.fontSynthesis, '');
	});

	it('locks the unit box to settled weight geometry without retaining measurement styles', () => {
		const element = document.createElement('span');
		element.style.fontFamily = 'Static Face';
		element.style.fontWeight = '400';
		element.style.letterSpacing = '0.03em';
		Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 172 });

		stabilizeTextAnimationVariableWeightLayout(element, TREATMENT, {
			normalizedWeight: 0.5,
			letterSpacingEm: 0
		});
		assert.equal(element.style.inlineSize, '172px');
		assert.equal(
			element.dataset.gfxVariableWeightLayoutLock,
			"'Example Variable', sans-serif|0.5|0"
		);
		assert.equal(element.style.fontFamily, '"Static Face"');
		assert.equal(element.style.fontWeight, '400');
		assert.equal(element.style.letterSpacing, '0.03em');
		assert.equal(element.style.fontVariationSettings, '');
		assert.equal(element.style.fontSynthesis, '');

		stabilizeTextAnimationVariableWeightLayout(element, TREATMENT, null);
		assert.equal(element.style.inlineSize, '');
		assert.equal(element.dataset.gfxVariableWeightLayoutLock, undefined);
	});

	it('does not synthesize weight when the active Pack has no capability', () => {
		const element = document.createElement('span');
		applyTextAnimationUnitVariableWeight(element, 1, null);
		assert.equal(element.style.fontFamily, '');
		assert.equal(element.style.fontWeight, '');
		assert.equal(element.style.fontVariationSettings, '');
	});
});
