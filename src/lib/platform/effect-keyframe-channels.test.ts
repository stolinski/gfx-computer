import assert from 'node:assert/strict';

import { describe, it } from 'vitest';
import { z } from 'zod';

import { listNumericLeafPaths } from '$lib/utils/zod-numeric-leaves';

import {
	listEffectKeyframeChannels,
	validateEffectKeyframeChannels
} from './effect-keyframe-channels';
import { PIPELINE_DEFINITION_REGISTRY } from './pipelines/definition-registry';
import type { EffectPipelineDefinition } from './pipelines/definition-types';

const REGISTERED_EFFECT_DEFINITIONS: readonly EffectPipelineDefinition[] = Object.values(
	PIPELINE_DEFINITION_REGISTRY.effects
);

function numericParamPaths(schema: unknown): string[] {
	assert.ok(schema instanceof z.ZodType);
	return listNumericLeafPaths(schema)
		.map((leaf) => leaf.path)
		.filter((path) => path.startsWith('params.'))
		.map((path) => path.slice('params.'.length));
}

describe('listEffectKeyframeChannels', () => {
	it('derives channels from every registered Effect schema', () => {
		for (const definition of REGISTERED_EFFECT_DEFINITIONS) {
			const channels = listEffectKeyframeChannels(definition).map((channel) => channel.path);
			const frozen = new Set(definition.frozenParams ?? []);
			assert.deepEqual(
				channels,
				numericParamPaths(definition.schema).filter((path) => !frozen.has(path)),
				`${definition.type} channels are its numeric params minus frozen ones`
			);
		}
	});

	it('freezes only real numeric params, including every seed', () => {
		for (const definition of REGISTERED_EFFECT_DEFINITIONS) {
			const numeric = new Set(numericParamPaths(definition.schema));
			for (const path of definition.frozenParams ?? []) {
				assert.ok(numeric.has(path), `${definition.type} freezes unknown param "${path}"`);
			}
			if (numeric.has('seed')) {
				assert.ok(
					definition.frozenParams?.includes('seed'),
					`${definition.type} declares a seed, so it must freeze it`
				);
			}
		}
	});

	it('keeps simulation kernel inputs frozen and GPU-side params live', () => {
		const fluid = listEffectKeyframeChannels(PIPELINE_DEFINITION_REGISTRY.effects.fluidRipple).map(
			(channel) => channel.path
		);
		assert.deepEqual(fluid, ['radius', 'refraction', 'highlights']);
		const cloth = listEffectKeyframeChannels(PIPELINE_DEFINITION_REGISTRY.effects.clothBend).map(
			(channel) => channel.path
		);
		assert.deepEqual(cloth, ['folds', 'perspective', 'shadow']);
	});

	it('reports bounds, the integer flag, and nested dotted paths', () => {
		const [pixelSize] = listEffectKeyframeChannels(PIPELINE_DEFINITION_REGISTRY.effects.pixelation);
		assert.deepEqual(pixelSize, { path: 'pixelSize', min: 1, max: 256, isInteger: true });

		const frost = listEffectKeyframeChannels(PIPELINE_DEFINITION_REGISTRY.effects.frostedGlass).map(
			(channel) => channel.path
		);
		for (const path of ['region.x', 'region.height', 'melt.center.x', 'melt.radius']) {
			assert.ok(frost.includes(path), `frosted glass exposes ${path}`);
		}
		assert.ok(!frost.includes('seed'));
		assert.ok(!frost.includes('tint'), 'colors are not channels');
	});
});

describe('validateEffectKeyframeChannels', () => {
	const pixelation = PIPELINE_DEFINITION_REGISTRY.effects.pixelation;
	const fluid = PIPELINE_DEFINITION_REGISTRY.effects.fluidRipple;
	const frost = PIPELINE_DEFINITION_REGISTRY.effects.frostedGlass;

	it('accepts in-range whole-number keyframes and nested paths', () => {
		assert.deepEqual(
			validateEffectKeyframeChannels(
				{
					channels: {
						pixelSize: [
							{ atMs: 0, value: 96 },
							{ atMs: 400, value: 1, ease: 'smooth' }
						]
					}
				},
				pixelation
			),
			[]
		);
		assert.deepEqual(
			validateEffectKeyframeChannels(
				{ channels: { 'region.x': [{ atMs: 0, value: 0.1 }] } },
				frost
			),
			[]
		);
		assert.deepEqual(validateEffectKeyframeChannels(undefined, pixelation), []);
	});

	it('rejects unknown, frozen, out-of-range, and fractional integer channels by path', () => {
		const unknown = validateEffectKeyframeChannels(
			{ channels: { blur: [{ atMs: 0, value: 1 }] } },
			pixelation
		);
		assert.deepEqual(unknown[0].path, ['animation', 'channels', 'blur']);
		assert.match(unknown[0].message, /not a keyframe channel of the pixelation Effect\. Channels: pixelSize/);

		const frozen = validateEffectKeyframeChannels(
			{ channels: { damping: [{ atMs: 0, value: 2 }] } },
			fluid
		);
		assert.deepEqual(frozen[0].path, ['animation', 'channels', 'damping']);
		assert.match(frozen[0].message, /frozen on the fluid-ripple Effect/);

		const outOfRange = validateEffectKeyframeChannels(
			{
				channels: {
					pixelSize: [
						{ atMs: 0, value: 48 },
						{ atMs: 200, value: 512, ease: 'sharp' }
					]
				}
			},
			pixelation
		);
		assert.deepEqual(outOfRange[0].path, ['animation', 'channels', 'pixelSize', 1, 'value']);
		assert.match(outOfRange[0].message, /outside the pixelSize channel's range 1\.\.256/);

		const fractional = validateEffectKeyframeChannels(
			{ channels: { pixelSize: [{ atMs: 0, value: 2.5 }] } },
			pixelation
		);
		assert.deepEqual(fractional[0].path, ['animation', 'channels', 'pixelSize', 0, 'value']);
		assert.match(fractional[0].message, /integer channel/);
	});
});
