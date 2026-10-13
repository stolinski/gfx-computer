import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { clothBendEffectRenderer } from './cloth-bend';
import { fluidRippleEffectRenderer } from './fluid-ripple';
import { tiledDeformationEffectRenderer } from './tiled-deformation';

const context = {
	progress: 0.5,
	timestamp: 0.9,
	canvasWidth: 3840,
	canvasHeight: 2160
};

describe('simulation-driven material Effects', () => {
	it('validates defaults and resolves repeated fluid frames deterministically', () => {
		const params = fluidRippleEffectRenderer.defaults().params;
		assert.equal(
			fluidRippleEffectRenderer.schema.safeParse({ type: 'fluid-ripple', id: 'fluid', params })
				.success,
			true
		);
		assert.deepEqual(
			fluidRippleEffectRenderer.pass.pack(params, context),
			fluidRippleEffectRenderer.pass.pack(params, context)
		);
		const before = fluidRippleEffectRenderer.pass.pack(params, { ...context, timestamp: 0.1 }) as {
			amplitude: number;
		};
		const after = fluidRippleEffectRenderer.pass.pack(params, context) as { amplitude: number };
		assert.equal(before.amplitude, 0);
		assert.notEqual(after.amplitude, 0);
		const onset = fluidRippleEffectRenderer.pass.pack(params, {
			...context,
			timestamp: params.impulseAtSeconds
		}) as { amplitude: number };
		const developed = fluidRippleEffectRenderer.pass.pack(params, {
			...context,
			timestamp: params.impulseAtSeconds + 0.25
		}) as { amplitude: number };
		assert.ok(Math.abs(onset.amplitude) > 0);
		assert.ok(Math.abs(onset.amplitude) < Math.abs(developed.amplitude) * 0.2);
	});

	it('replays cloth state deterministically and validates its pin mode', () => {
		const params = clothBendEffectRenderer.defaults().params;
		const first = clothBendEffectRenderer.pass.pack(params, context) as { bend: number };
		const repeated = clothBendEffectRenderer.pass.pack(params, context) as { bend: number };
		assert.deepEqual(repeated, first);
		assert.notEqual(first.bend, 0);
		assert.equal(
			clothBendEffectRenderer.schema.safeParse({
				type: 'cloth-bend',
				id: 'cloth',
				params: { ...params, pinnedEdge: 'corner' }
			}).success,
			false
		);
	});

	it('requires an ordered tiled reveal window', () => {
		const params = tiledDeformationEffectRenderer.defaults().params;
		assert.equal(
			tiledDeformationEffectRenderer.schema.safeParse({
				type: 'tiled-deformation',
				id: 'tiles',
				params
			}).success,
			true
		);
		assert.equal(
			tiledDeformationEffectRenderer.schema.safeParse({
				type: 'tiled-deformation',
				id: 'tiles',
				params: { ...params, revealFrom: 0.8, revealTo: 0.4 }
			}).success,
			false
		);
	});
});
