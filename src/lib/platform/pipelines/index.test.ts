import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { syntaxPack } from '$lib/packs/syntax/manifest';
import { PACK_REGISTRY } from '$lib/platform/packs/registry';
import {
	PIPELINE_DEFINITION_REGISTRY,
	REGISTERED_BLOCK_TYPES,
	getOverlayDefinition,
	resolveSurfaceTypographyColors
} from './definition-registry';
import {
	IDENTITY_REGISTRY,
	PACK_IMMUNE_PIPELINE_KEYS,
	filterPackAppearanceVarsForImmunity,
	isAppearanceSlotPackClaimable,
	isPackImmune,
	validateIdentityRegistry
} from './identity-registry';

const EXPECTED_PIPELINE_TYPE_IDS = [
	'paper',
	'plain',
	'newspaper',
	'pullquote-on-photo',
	'chapter-card',
	'title-sequence',
	'type-hero',
	'web-document',
	'website-screenshot',
	'brand-mark',
	'imessage',
	'checklist',
	'paragraph',
	'kinetic-word',
	'node',
	'edge-arrow',
	'label',
	'stat-callout',
	'timeline-segment',
	'bar-chart',
	'column-chart',
	'unit-grid-chart',
	'dot-field-chart',
	'highlight',
	'underline',
	'strike',
	'circle',
	'box',
	'side-note',
	'magnify',
	'lift-out',
	'line-chart',
	'tear-out',
	'isolate',
	'lower-third',
	'washi-tape',
	'watermark',
	'shader-fill',
	'cursor-trail',
	'counter',
	'dimensional-type',
	'instance-stack',
	'text-3d',
	'tweet-stack',
	'youtube-subscribe',
	'instagram-follow',
	'achievement',
	'source-url',
	'paper-grain',
	'chromatic-aberration',
	'crt-screen',
	'crt-tube',
	'ntsc-signal',
	'dithering',
	'pixelation',
	'halftone-dots',
	'halftone-cmyk',
	'water',
	'fluted-glass',
	'refractive-lens',
	'frosted-glass',
	'fluid-ripple',
	'cloth-bend',
	'tiled-deformation',
	'heatmap'
] as const;

describe('Pipeline Definition Registry', () => {
	it('keeps the complete registered Pipeline type-id set unique', () => {
		const typeIds = [
			...Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces).map((renderer) => renderer.type),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.blocks).map((renderer) => renderer.type),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.annotations).map((renderer) => renderer.style),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.overlays).map((renderer) => renderer.type),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.effects).map((renderer) => renderer.type)
		];

		assert.deepEqual(typeIds.toSorted(), EXPECTED_PIPELINE_TYPE_IDS.toSorted());
		assert.equal(new Set(typeIds).size, typeIds.length);
		assert.deepEqual(
			REGISTERED_BLOCK_TYPES.toSorted(),
			[
				'paragraph',
				'kinetic-word',
				'node',
				'edge-arrow',
				'label',
				'stat-callout',
				'timeline-segment',
				'bar-chart',
				'column-chart',
				'line-chart',
				'unit-grid-chart',
				'dot-field-chart'
			].toSorted()
		);
	});

	it('validates definition-owned defaults without loading runtime renderers', () => {
		for (const definition of Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces)) {
			assert.equal(definition.defaults().type, definition.type);
		}
		for (const definition of Object.values(PIPELINE_DEFINITION_REGISTRY.overlays)) {
			assert.equal(definition.schema.safeParse(definition.defaults().content).success, true);
		}
		for (const definition of Object.values(PIPELINE_DEFINITION_REGISTRY.effects)) {
			assert.equal(
				definition.schema.safeParse({
					type: definition.type,
					id: `${definition.type}-default`,
					params: definition.defaults().params
				}).success,
				true
			);
		}
	});

	it('keeps deterministic readable declarations on renderer-free Overlay definitions', () => {
		for (const definition of Object.values(PIPELINE_DEFINITION_REGISTRY.overlays)) {
			assert.equal(
				typeof definition.readableText,
				'function',
				`${definition.type} is missing readable text metadata`
			);
		}
	});

	it('marks only plate-less display Overlays as field-ink consumers', () => {
		assert.equal(PIPELINE_DEFINITION_REGISTRY.overlays.counter.fieldInkOnBackground, true);
		assert.equal(PIPELINE_DEFINITION_REGISTRY.overlays.instanceStack.fieldInkOnBackground, true);
		assert.equal(PIPELINE_DEFINITION_REGISTRY.overlays.text3d.fieldInkOnBackground, true);
		assert.equal(getOverlayDefinition('lower-third')?.fieldInkOnBackground, undefined);
		assert.equal(getOverlayDefinition('source-url')?.fieldInkOnBackground, undefined);
	});

	it('keeps every visible registered Pipeline paired with a valid Identity Spec', () => {
		const registeredIdentityKeys = [
			...Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces).map(
				(renderer) => `surface:${renderer.type}`
			),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.blocks).map(
				(renderer) => `block:${renderer.type}`
			),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.annotations).map(
				(renderer) => `annotation:${renderer.style}`
			),
			...Object.values(PIPELINE_DEFINITION_REGISTRY.overlays).map(
				(renderer) => `overlay:${renderer.type}`
			)
		];
		const pipelineIdentityKeys = Object.keys(IDENTITY_REGISTRY).filter(
			(key) => key !== 'captions:track'
		);

		assert.deepEqual(registeredIdentityKeys.toSorted(), pipelineIdentityKeys.toSorted());
		assert.deepEqual(validateIdentityRegistry(syntaxPack), []);
		for (const pack of Object.values(PACK_REGISTRY)) {
			for (const role of [
				'chart.mark',
				'chart.axis',
				'chart.grid',
				'chart.label',
				'chart.annotation'
			]) {
				assert.ok(role in pack.roles, `${pack.slug} is missing ${role}`);
			}
		}
	});

	it('derives the complete FULL Pack-immunity set from Identity Specs', () => {
		const expectedImmuneKeys = [
			'overlay:instagram-follow',
			'overlay:shader-fill',
			'overlay:tweet-stack',
			'overlay:youtube-subscribe',
			'surface:imessage',
			'surface:newspaper',
			'surface:paper',
			'surface:web-document',
			'surface:website-screenshot'
		];

		assert.deepEqual(PACK_IMMUNE_PIPELINE_KEYS.toSorted(), expectedImmuneKeys);
		for (const pipelineKey of expectedImmuneKeys) assert.equal(isPackImmune(pipelineKey), true);
		assert.equal(isPackImmune('overlay:lower-third'), false);
	});

	it('answers per-slot claimability from the immunity declaration (ADR-0039 §2)', () => {
		// Full (newspaper / imessage / paper): nothing is claimable. The newspaper
		// went from partial to full immunity with ADR-0056 — a photographed page
		// has no chip or card shadow for a Pack to claim.
		assert.equal(isAppearanceSlotPackClaimable('surface:newspaper', 'accent'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:newspaper', 'kicker-ink'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:newspaper', 'depth'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:newspaper', 'fill'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:newspaper', 'ink'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:newspaper', 'edge'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:imessage', 'accent'), false);
		assert.equal(isAppearanceSlotPackClaimable('surface:paper', 'fill'), false);
		// No immunity: everything is claimable.
		assert.equal(isAppearanceSlotPackClaimable('overlay:lower-third', 'fill'), true);

		const vars = { '--fill': '#111111', '--accent': '#22d3ee', '--kicker-ink': '#0f151c' };
		assert.deepEqual(filterPackAppearanceVarsForImmunity('surface:newspaper', vars), {});
		assert.deepEqual(filterPackAppearanceVarsForImmunity('surface:imessage', vars), {});
		assert.deepEqual(filterPackAppearanceVarsForImmunity('overlay:lower-third', vars), vars);
	});

	it('resolves surface typography through substrate immunity (ADR-0039 §2)', () => {
		const syntax = PACK_REGISTRY.syntax;
		const cleanLight = PACK_REGISTRY['clean-light'];
		// Authored colours always win — composition content, not pack dress.
		assert.deepEqual(
			resolveSurfaceTypographyColors(cleanLight, 'paper', {
				paperColor: '#fdf9f1',
				inkColor: '#111111'
			}),
			{ paperColor: '#fdf9f1', inkColor: '#111111' }
		);
		// Unauthored on an immune document: intrinsic substrate, never pack cores.
		assert.deepEqual(resolveSurfaceTypographyColors(cleanLight, 'paper', {}), {
			paperColor: '#ffffff',
			inkColor: '#111111'
		});
		assert.deepEqual(resolveSurfaceTypographyColors(cleanLight, 'newspaper', {}), {
			paperColor: '#dadada',
			inkColor: '#1b1b1b'
		});
		// Non-document surfaces keep the ADR-0038 pack-core chain.
		assert.deepEqual(resolveSurfaceTypographyColors(syntax, 'plain', {}), {
			paperColor: '#f0e8d6',
			inkColor: '#1a1612'
		});
		assert.deepEqual(resolveSurfaceTypographyColors(cleanLight, 'plain', {}), {
			paperColor: '#ffffff',
			inkColor: '#16181d'
		});
	});
});
