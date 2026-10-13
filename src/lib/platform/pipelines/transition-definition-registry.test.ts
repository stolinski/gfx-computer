import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	getTransitionEffectDefinition,
	transitionEffectDefinitions,
	transitionEffectTypes
} from './transition-definition-registry';

describe('transition Effect definition registry', () => {
	it('registers unique definitions whose defaults validate', () => {
		const definitions = transitionEffectDefinitions();
		const types = transitionEffectTypes();

		assert.deepEqual(types, ['mask-wipe', 'particle-dissolve', 'sheet-peel', 'seeded-shatter']);
		assert.equal(new Set(types).size, types.length);
		for (const definition of definitions) {
			assert.equal(definition.paramsSchema.safeParse(definition.defaults().params).success, true);
			assert.equal(getTransitionEffectDefinition(definition.type), definition);
		}
	});

	it('rejects invalid family parameters', () => {
		assert.equal(
			getTransitionEffectDefinition('particle-dissolve')?.paramsSchema.safeParse({
				seed: -1,
				density: 2,
				spread: 1,
				direction: 0,
				softness: 0,
				luminanceBias: 0
			}).success,
			false
		);
		assert.equal(
			getTransitionEffectDefinition('seeded-shatter')?.paramsSchema.safeParse({
				seed: 1,
				columns: 100,
				scatter: 0.1,
				rotation: 0.5,
				depth: 0.5,
				shadow: 0.5
			}).success,
			false
		);
	});
});
