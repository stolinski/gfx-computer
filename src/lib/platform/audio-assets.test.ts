import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	assertSoundRegistryValid,
	FOLEY_CUE_NAMES,
	FOLEY_SOUND_SLUGS,
	isSoundAsset,
	listSoundAssets
} from './audio-assets';

describe('audio asset registry', () => {
	it('registers all 28 Foley cues as authored sound choices', () => {
		assert.equal(FOLEY_CUE_NAMES.length, 28);
		assert.equal(FOLEY_SOUND_SLUGS.length, 28);
		assert.deepEqual(listSoundAssets(), [...FOLEY_SOUND_SLUGS, 'bed-ambient-texture']);
		assert.ok(FOLEY_SOUND_SLUGS.every(isSoundAsset));
		assert.doesNotThrow(assertSoundRegistryValid);
	});

	it('keeps persisted Legacy Supers sample locks loadable through Foley aliases', () => {
		assert.equal(isSoundAsset('fwip-in'), true);
		assert.equal(isSoundAsset('thud-deep'), true);
		assert.equal(isSoundAsset('tick-snap'), true);
	});
});
