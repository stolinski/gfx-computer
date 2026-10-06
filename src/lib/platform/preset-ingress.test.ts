import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import lowerThirdPresetJson from '$lib/presets/lower-third.json';

import { PRESET_SCHEMA_ID } from './engine-schema';
import { presetToWireFormat } from './preset-pure';
import {
	LEGACY_SOURCE_VIDEO_ASSET_ID,
	LEGACY_SOURCE_VIDEO_CLIP_ID,
	PresetIngressSchema,
	readCompositionLegacyUpgrades
} from './preset-ingress';

const LEGACY_ASSET_URL = `/api/user-assets/${'a'.repeat(64)}.mp4`;

function legacyPreset(): unknown {
	return {
		...blankPresetJson,
		state: {
			...blankPresetJson.state,
			transport: {
				...blankPresetJson.state.transport,
				durationSeconds: 10.01,
				fps: 29.97
			},
			sourceVideo: {
				assetUrl: LEGACY_ASSET_URL,
				sourceOffsetSeconds: 18.25,
				includeAudio: false,
				volume: 0.8
			}
		}
	};
}

// A shipped corpus composition, re-declared under each namespace. ADR-0053:
// `gfx@1` and `supers@1` name the same document shape, so these two inputs must
// be indistinguishable everywhere downstream of ingress.
function compositionDeclaring(schema: string): unknown {
	return { ...lowerThirdPresetJson, schema };
}

describe('Legacy Supers composition schema id', () => {
	it('folds every accepted id onto the id writers emit', () => {
		assert.equal(
			PresetIngressSchema.parse(compositionDeclaring('supers@1')).schema,
			PRESET_SCHEMA_ID
		);
		assert.equal(PresetIngressSchema.parse(compositionDeclaring('gfx@1')).schema, PRESET_SCHEMA_ID);
	});

	it('renders identically under either id — the parsed composition is deep-equal', () => {
		const legacy = PresetIngressSchema.parse(compositionDeclaring('supers@1'));
		const current = PresetIngressSchema.parse(compositionDeclaring('gfx@1'));

		// The parsed Preset is the renderer's only input, so equality here is
		// pixel equivalence: no downstream reader can tell the two ids apart.
		assert.deepEqual(current, legacy);
		assert.deepEqual(presetToWireFormat(current), presetToWireFormat(legacy));
	});

	it('round-trips a legacy composition back through ingress unchanged', () => {
		const legacy = PresetIngressSchema.parse(compositionDeclaring('supers@1'));
		const reparsed = PresetIngressSchema.parse(presetToWireFormat(legacy));
		assert.deepEqual(reparsed, legacy);
	});

	it('rejects an id that belongs to neither namespace instead of folding it', () => {
		const result = PresetIngressSchema.safeParse(compositionDeclaring('supers@2'));

		assert.equal(result.success, false);
		if (result.success) return;
		assert.equal(result.error.issues[0]?.path.join('.'), 'schema');
	});
});

describe('Preset ingress migration', () => {
	it('normalizes legacy Source video into one deterministic full-span Video clip', () => {
		const first = PresetIngressSchema.parse(legacyPreset());
		const second = PresetIngressSchema.parse(legacyPreset());

		assert.equal('sourceVideo' in first.state, false);
		assert.deepEqual(first.state.media, {
			assets: [
				{
					id: LEGACY_SOURCE_VIDEO_ASSET_ID,
					kind: 'video',
					name: 'Source video',
					assetUrl: LEGACY_ASSET_URL
				}
			],
			videoTrack: {
				clips: [
					{
						id: LEGACY_SOURCE_VIDEO_CLIP_ID,
						assetId: LEGACY_SOURCE_VIDEO_ASSET_ID,
						timelineStartFrame: 0,
						durationFrames: 300,
						sourceStartSeconds: 18.25,
						audio: { enabled: false, gain: 0.8 }
					}
				]
			}
		});
		assert.deepEqual(second.state.media, first.state.media);
	});

	it('materializes legacy audio defaults without persisting probe metadata', () => {
		const input = legacyPreset() as { state: Record<string, unknown> };
		input.state.sourceVideo = { assetUrl: LEGACY_ASSET_URL };

		const preset = PresetIngressSchema.parse(input);

		assert.deepEqual(preset.state.media.videoTrack.clips[0].audio, {
			enabled: true,
			gain: 1
		});
		assert.deepEqual(Object.keys(preset.state.media.assets[0]).sort(), [
			'assetUrl',
			'id',
			'kind',
			'name'
		]);
	});

	it('rejects input containing both legacy sourceVideo and canonical media', () => {
		const input = legacyPreset() as { state: Record<string, unknown> };
		input.state.media = { assets: [], videoTrack: { clips: [] } };

		const result = PresetIngressSchema.safeParse(input);

		assert.equal(result.success, false);
		if (result.success) return;
		assert.equal(result.error.issues[0]?.path.join('.'), 'state');
		assert.match(result.error.issues[0]?.message ?? '', /both legacy sourceVideo and canonical media/);
	});

	it('rejects invalid legacy input instead of silently stripping it', () => {
		const input = legacyPreset() as { state: Record<string, unknown> };
		input.state.sourceVideo = { assetUrl: '/tmp/source.mp4' };

		const result = PresetIngressSchema.safeParse(input);

		assert.equal(result.success, false);
		if (result.success) return;
		assert.equal(result.error.issues[0]?.path.join('.'), 'state.sourceVideo.assetUrl');
		assert.match(result.error.issues[0]?.message ?? '', /content-addressed/);
	});
});

describe('reading which legacy upgrades a document needs', () => {
	it('names both legacy shapes a document carries', () => {
		assert.deepEqual(readCompositionLegacyUpgrades(legacyPreset()), [
			'legacy-schema-id',
			'legacy-source-video'
		]);
	});

	it('reports nothing for a document already on the current shape', () => {
		const current = { ...blankPresetJson, schema: PRESET_SCHEMA_ID };

		assert.deepEqual(readCompositionLegacyUpgrades(current), []);
	});

	it('reports nothing for a value that is not a document at all', () => {
		assert.deepEqual(readCompositionLegacyUpgrades(null), []);
		assert.deepEqual(readCompositionLegacyUpgrades([blankPresetJson]), []);
		assert.deepEqual(readCompositionLegacyUpgrades({ schema: 'not-a-known-id' }), []);
	});
});
