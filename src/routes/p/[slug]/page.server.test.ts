import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { load } from './+page.server';

function createLoadEvent(slug: string): Parameters<typeof load>[0] {
	return {
		params: { slug },
		url: new URL(`http://localhost/p/${slug}`)
	} as unknown as Parameters<typeof load>[0];
}

describe('/p/[slug] server load', () => {
	it('resolves the corpus Starter this build ships', async () => {
		const result = await load(createLoadEvent('blank'));

		assert.equal(result.slug, 'blank');
		assert.equal(result.corpusPreset?.name, blankPresetJson.name);
	});

	it('reports no corpus Preset for a slug only a session can hold', async () => {
		const result = await load(createLoadEvent('untitled-2'));

		assert.deepEqual(result, { slug: 'untitled-2', corpusPreset: null });
	});
});
