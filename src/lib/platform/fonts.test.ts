import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

import { PACK_REGISTRY } from './packs/registry.ts';
import { registerLoadedUserPack, unregisterLoadedUserPack } from './user-pack-runtime.svelte.ts';

const loadedSpecs: string[] = [];
const fakeFontSet = {
	load: vi.fn(async (spec: string) => {
		loadedSpecs.push(spec);
		return [];
	}),
	ready: Promise.resolve(),
	add: vi.fn()
};

let fontsReady: typeof import('./fonts.ts').fontsReady;

beforeAll(async () => {
	vi.stubGlobal('document', { fonts: fakeFontSet });
	({ fontsReady } = await import('./fonts.ts'));
});

afterAll(() => {
	vi.unstubAllGlobals();
});

const BUILTIN_SPEC_COUNT = Object.values(PACK_REGISTRY)
	.flatMap((pack) => pack.fonts ?? [])
	.reduce((count, font) => count + (font.weights ?? [400]).length, 0);

describe('fontsReady', () => {
	it('sweeps every built-in Pack face once', async () => {
		await fontsReady();
		assert.equal(loadedSpecs.length, BUILTIN_SPEC_COUNT);
		assert.ok(loadedSpecs.includes('normal 400 1em "JetBrains Mono"'));
		assert.ok(loadedSpecs.includes('normal 650 1em "Space Grotesk Variable"'));
		assert.ok(loadedSpecs.includes('normal 900 1em "Playfair Display Variable"'));
	});

	it('gates on a User Pack loaded into the runtime without repeating the built-in sweep', async () => {
		loadedSpecs.length = 0;
		registerLoadedUserPack('my-brand', {
			manifest: {
				...PACK_REGISTRY['clean-light'],
				slug: 'my-brand',
				fonts: [{ family: 'My Brand Face', weights: [500, 700] }]
			},
			forkedFrom: 'clean-light',
			savedAt: '2026-09-01T12:00:00.000Z',
			contentHash: 'a'.repeat(64),
			fontFaces: []
		});
		await fontsReady();
		assert.deepEqual(loadedSpecs, [
			'normal 500 1em "My Brand Face"',
			'normal 700 1em "My Brand Face"'
		]);
	});

	it('re-arms on every call as packs load and unload', async () => {
		loadedSpecs.length = 0;
		registerLoadedUserPack('other-brand', {
			manifest: {
				...PACK_REGISTRY['clean-light'],
				slug: 'other-brand',
				fonts: [{ family: 'Another Face', style: 'italic' }]
			},
			forkedFrom: 'clean-light',
			savedAt: '2026-09-01T12:00:00.000Z',
			contentHash: 'b'.repeat(64),
			fontFaces: []
		});
		await fontsReady();
		assert.deepEqual(loadedSpecs, [
			'normal 500 1em "My Brand Face"',
			'normal 700 1em "My Brand Face"',
			'italic 400 1em "Another Face"'
		]);

		loadedSpecs.length = 0;
		unregisterLoadedUserPack('my-brand');
		unregisterLoadedUserPack('other-brand');
		await fontsReady();
		assert.deepEqual(loadedSpecs, []);
	});
});
