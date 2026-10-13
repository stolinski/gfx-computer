import assert from 'node:assert/strict';

import { describe, it, vi } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { areDevelopmentOnlySurfacesServed } from '$lib/platform/public-runtime-profile.server';

import { load } from './+page.server';

// The poster store is a directory on disk; the load is checked against a
// listing this file states.
vi.mock('$lib/platform/poster-store.server', () => ({
	listPosterKeys: async () => ['0123456789abcdef']
}));

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

		assert.deepEqual(result, {
			slug: 'untitled-2',
			corpusPreset: null,
			// The Add to Film menu's poster knowledge: what the disk store holds,
			// and nothing on a public host, which has no poster store.
			posterKeys: areDevelopmentOnlySurfacesServed() ? ['0123456789abcdef'] : []
		});
	});
});
