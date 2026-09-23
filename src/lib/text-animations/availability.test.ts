import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { PACK_REGISTRY } from '$lib/platform/packs/registry';

import { textEffectUnavailableReason } from './availability';
import { TEXT_EFFECT_CATALOG } from './catalog';

describe('text effect target availability', () => {
	it('allows Weight Resolve on a Pack-dressed title with a real treatment', () => {
		const effect = TEXT_EFFECT_CATALOG.get('weight-resolve');
		assert.ok(effect);
		assert.equal(
			textEffectUnavailableReason(effect, {
				slotKey: 'title',
				pipelineKey: 'surface:type-hero',
				pack: PACK_REGISTRY.syntax
			}),
			null
		);
	});

	it('refuses body-scale and Pack-immune targets correctively', () => {
		const effect = TEXT_EFFECT_CATALOG.get('weight-resolve');
		assert.ok(effect);
		assert.equal(
			textEffectUnavailableReason(effect, {
				slotKey: 'body',
				pipelineKey: 'surface:type-hero',
				pack: PACK_REGISTRY.syntax
			}),
			'title-scale-required'
		);
		assert.equal(
			textEffectUnavailableReason(effect, {
				slotKey: 'title',
				pipelineKey: 'surface:paper',
				pack: PACK_REGISTRY.syntax
			}),
			'pack-appearance-blocked'
		);
	});

	it('refuses a Pack with no real variable-weight treatment', () => {
		const effect = TEXT_EFFECT_CATALOG.get('weight-resolve');
		assert.ok(effect);
		const pack = structuredClone(PACK_REGISTRY.syntax);
		delete pack.roles['variable-weight-treatment'];
		assert.equal(
			textEffectUnavailableReason(effect, {
				slotKey: 'title',
				pipelineKey: 'surface:type-hero',
				pack
			}),
			'variable-weight-unavailable'
		);
	});
});
