import assert from 'node:assert/strict';

import { describe, it } from 'vitest';
import { z } from 'zod';

import { listNumericLeafPaths } from '$lib/utils/zod-numeric-leaves';
import {
	DEFAULT_REFRACTIVE_LENS_REGION,
	packAspectPreservingOpticalRegion,
	type NormalizedOpticalRegion
} from '$lib/utils/optical-geometry';

import {
	listEffectKeyframeChannels,
	resolveEffectParamsWithChannelValues,
	validateEffectKeyframeChannels
} from './effect-keyframe-channels';
import type { Effect, Keyframe } from './engine-schema';
import { PIPELINE_DEFINITION_REGISTRY } from './pipelines/definition-registry';
import type { EffectPipelineDefinition } from './pipelines/definition-types';

const REGISTERED_EFFECT_DEFINITIONS: readonly EffectPipelineDefinition[] = Object.values(
	PIPELINE_DEFINITION_REGISTRY.effects
);

function numericParamPaths(schema: unknown): string[] {
	assert.ok(schema instanceof z.ZodType);
	return listNumericLeafPaths(schema)
		.map((leaf) => leaf.path)
		.filter(
			(path) => path.startsWith('params.') && !path.startsWith('params.orientationOverrides.')
		)
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

function effectEntry(type: string, params: unknown, animation: Effect['animation']): Effect {
	return { type, id: `${type}-entry`, params, animation };
}

function track(...values: number[]): Keyframe[] {
	return values.map((value, index) =>
		index === 0 ? { atMs: 0, value } : { atMs: index * 200, value, ease: 'smooth' }
	);
}

describe('validateEffectKeyframeChannels', () => {
	const pixelation = PIPELINE_DEFINITION_REGISTRY.effects.pixelation;
	const fluid = PIPELINE_DEFINITION_REGISTRY.effects.fluidRipple;
	const frost = PIPELINE_DEFINITION_REGISTRY.effects.frostedGlass;

	it('accepts in-range whole-number keyframes and nested paths whose parents exist', () => {
		const animated = effectEntry(
			'pixelation',
			{ pixelSize: 48 },
			{
				channels: { pixelSize: track(96, 1) }
			}
		);
		assert.deepEqual(validateEffectKeyframeChannels(animated, pixelation), []);
		// `region` and `melt.center` are filled from schema defaults when absent.
		const regionOnly = effectEntry('frosted-glass', {}, { channels: { 'region.x': track(0.1) } });
		assert.deepEqual(validateEffectKeyframeChannels(regionOnly, frost), []);
		const meltCenter = effectEntry(
			'frosted-glass',
			{ melt: {} },
			{
				channels: { 'melt.center.x': track(0.4) }
			}
		);
		assert.deepEqual(validateEffectKeyframeChannels(meltCenter, frost), []);
		assert.deepEqual(
			validateEffectKeyframeChannels(
				effectEntry('pixelation', { pixelSize: 48 }, undefined),
				pixelation
			),
			[]
		);
	});

	it('rejects unknown, frozen, parentless, out-of-range, and fractional integer channels by path', () => {
		const [unknown] = validateEffectKeyframeChannels(
			effectEntry('pixelation', {}, { channels: { blur: track(1) } }),
			pixelation
		);
		assert.deepEqual(unknown.path, ['animation', 'channels', 'blur']);
		assert.match(
			unknown.message,
			/not a keyframe channel of the pixelation Effect\. Channels: pixelSize/
		);

		const [frozen] = validateEffectKeyframeChannels(
			effectEntry('fluid-ripple', {}, { channels: { damping: track(2) } }),
			fluid
		);
		assert.deepEqual(frozen.path, ['animation', 'channels', 'damping']);
		assert.match(frozen.message, /frozen on the fluid-ripple Effect/);

		const [parentless] = validateEffectKeyframeChannels(
			effectEntry('frosted-glass', {}, { channels: { 'melt.radius': track(0.3) } }),
			frost
		);
		assert.deepEqual(parentless.path, ['animation', 'channels', 'melt.radius']);
		assert.match(parentless.message, /needs a melt block in params/);

		const [outOfRange] = validateEffectKeyframeChannels(
			effectEntry('pixelation', {}, { channels: { pixelSize: track(48, 512) } }),
			pixelation
		);
		assert.deepEqual(outOfRange.path, ['animation', 'channels', 'pixelSize', 1, 'value']);
		assert.match(outOfRange.message, /outside the pixelSize channel's range 1\.\.256/);

		const [fractional] = validateEffectKeyframeChannels(
			effectEntry('pixelation', {}, { channels: { pixelSize: track(2.5) } }),
			pixelation
		);
		assert.deepEqual(fractional.path, ['animation', 'channels', 'pixelSize', 0, 'value']);
		assert.match(fractional.message, /integer channel/);
	});
});

describe('resolveEffectParamsWithChannelValues', () => {
	it('fills schema defaults, sets driven paths, and rounds integer channels', () => {
		const pixelation = PIPELINE_DEFINITION_REGISTRY.effects.pixelation;
		assert.deepEqual(
			resolveEffectParamsWithChannelValues(
				effectEntry('pixelation', {}, undefined),
				pixelation,
				{ pixelSize: 31.6 },
				'horizontal'
			),
			{ pixelSize: 32 }
		);

		const frost = PIPELINE_DEFINITION_REGISTRY.effects.frostedGlass;
		const authored = { coverage: 0.5, region: { x: 0.1, y: 0.2, width: 0.4, height: 0.4 } };
		const resolved = resolveEffectParamsWithChannelValues(
			effectEntry('frosted-glass', authored, undefined),
			frost,
			{ 'region.x': 0.35, seed: 9 },
			'horizontal'
		) as { coverage: number; region: { x: number; y: number }; seed: number };
		assert.equal(resolved.region.x, 0.35);
		assert.equal(resolved.region.y, 0.2);
		assert.equal(resolved.coverage, 0.5);
		// A frozen param is never driven, even if a value arrives for it.
		assert.equal(resolved.seed, 4107);
		assert.equal(authored.region.x, 0.1, 'the authored params are not mutated');
	});
});

describe('per-orientation optical params (ADR-0039 §4, ADR-0063 §11)', () => {
	const lens = PIPELINE_DEFINITION_REGISTRY.effects.refractiveLens;
	const params = {
		region: { x: 0.1, y: 0.3, width: 0.28, height: 0.4 },
		orientationOverrides: { vertical: { region: { x: 0.2, y: 0.5, width: 0.6, height: 0.3 } } }
	};

	it('never lists snapshot leaves as keyframe channels', () => {
		const channels = listEffectKeyframeChannels(lens).map((channel) => channel.path);
		assert.ok(channels.includes('region.x'));
		assert.ok(!channels.some((path) => path.startsWith('orientationOverrides')));
	});

	it('replaces the region as one static unit in its orientation and keeps region channels shared', () => {
		const effect = effectEntry('refractive-lens', params, undefined);
		const vertical = resolveEffectParamsWithChannelValues(
			effect,
			lens,
			{ 'region.x': 0.36, magnification: 1.5 },
			'vertical'
		) as { region: NormalizedOpticalRegion; magnification: number };
		// Authored in the tall frame's own fractions, it lands there after the
		// renderer's canonical conversion.
		const packed = packAspectPreservingOpticalRegion(
			vertical.region as NormalizedOpticalRegion,
			DEFAULT_REFRACTIVE_LENS_REGION,
			{ width: 2160, height: 3840 }
		);
		const authored = params.orientationOverrides.vertical.region;
		[authored.x, authored.y, authored.width, authored.height].forEach((value, index) =>
			assert.ok(Math.abs(packed[index] - value) < 1e-9, `component ${index}`)
		);
		assert.equal(vertical.magnification, 1.5, 'channels outside the snapshot still drive');

		const horizontal = resolveEffectParamsWithChannelValues(
			effect,
			lens,
			{ 'region.x': 0.36 },
			'horizontal'
		) as { region: { x: number; y: number } };
		assert.equal(horizontal.region.x, 0.36);
		assert.equal(horizontal.region.y, 0.3);
	});

	it('rejects an incomplete snapshot region', () => {
		const result = lens.schema.safeParse({
			type: 'refractive-lens',
			id: 'lens',
			params: { orientationOverrides: { vertical: { region: { x: 0.2, y: 0.5 } } } }
		});
		assert.equal(result.success, false);
	});
});
