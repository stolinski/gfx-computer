import lowerThirdPresetJson from '../presets/lower-third.json';

import type { FilmSceneOrigin } from './film-schema';
import type { StoredUserCompositionMeta } from './user-composition-record';

/**
 * Stored User composition records of both shapes (ADR-0068 §3), written as raw
 * JSON the way a store holds them. The record reader's tests and both stores'
 * tests read every one, so the disk store and the browser-scoped store are held
 * to the same answers. Not a deliverable.
 */
export interface StoredUserCompositionRecordFixture {
	/** A slug-safe name, used as the slug the record is stored at. */
	slug: string;
	meta: StoredUserCompositionMeta;
	/** The composition document beside `meta`: exactly one of the two shapes. */
	document: { preset: unknown } | { film: unknown };
	/**
	 * `opens`: reads, and opens as `presetDocument`. `scene-count-refused`: reads
	 * as a Film this build cannot open. `composition-refused`: does not read.
	 */
	outcome: 'opens' | 'scene-count-refused' | 'composition-refused';
	/** The standalone Preset document the record opens as; `null` when it does not open. */
	presetDocument: unknown;
	/** The origin of the first Scene of the Film the record reads as. */
	firstSceneOrigin: FilmSceneOrigin | null;
}

const SAVED_AT = '2026-10-01T12:00:00.000Z';

/** The corpus `lower-third` Preset as a current document: a deliverable with a description. */
const currentPresetDocument = { ...lowerThirdPresetJson, schema: 'gfx@1' };

const mediaLibraryPresetDocument = {
	...currentPresetDocument,
	name: 'Interview lower third',
	state: {
		...currentPresetDocument.state,
		media: {
			assets: [
				{
					id: 'interview-asset',
					kind: 'video',
					name: 'Interview',
					assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
				},
				{
					id: 'library-only-asset',
					kind: 'video',
					name: 'Library only',
					assetUrl: `/api/user-assets/${'b'.repeat(64)}.mov`
				}
			],
			videoTrack: {
				clips: [
					{
						id: 'interview-clip',
						assetId: 'interview-asset',
						timelineStartFrame: 0,
						durationFrames: 90,
						sourceStartSeconds: 1.5,
						audio: { enabled: false, gain: 0.65 }
					}
				]
			}
		}
	}
};

function filmDocumentOf(
	presetDocument: typeof currentPresetDocument,
	scenes: readonly { id: string; origin: FilmSceneOrigin | null }[]
): unknown {
	return {
		schema: 'gfx-film@1',
		name: presetDocument.name,
		description: presetDocument.description,
		pack: presetDocument.pack,
		orientation: presetDocument.state.transport.orientation,
		fps: presetDocument.state.transport.fps,
		format: presetDocument.state.transport.format,
		scenes: scenes.map((scene) => ({ ...scene, state: presetDocument.state })),
		boundaries: scenes.slice(1).map(() => ({ kind: 'cut' }))
	};
}

const filmSceneOrigin: FilmSceneOrigin = { slug: 'lower-third', contentKey: '0123456789abcdef' };

export const STORED_USER_COMPOSITION_RECORD_FIXTURES: readonly StoredUserCompositionRecordFixture[] =
	[
		{
			slug: 'legacy-plain',
			meta: { forkedFrom: null, savedAt: SAVED_AT },
			document: { preset: currentPresetDocument },
			outcome: 'opens',
			presetDocument: currentPresetDocument,
			firstSceneOrigin: null
		},
		{
			slug: 'legacy-forked',
			meta: { forkedFrom: 'lower-third', savedAt: SAVED_AT },
			document: { preset: { ...currentPresetDocument, name: 'My lower third' } },
			outcome: 'opens',
			presetDocument: { ...currentPresetDocument, name: 'My lower third' },
			// A legacy record kept the slug and never knew the content key.
			firstSceneOrigin: { slug: 'lower-third', contentKey: null }
		},
		{
			slug: 'legacy-media-library',
			meta: { forkedFrom: null, savedAt: SAVED_AT },
			document: { preset: mediaLibraryPresetDocument },
			outcome: 'opens',
			presetDocument: mediaLibraryPresetDocument,
			firstSceneOrigin: null
		},
		{
			// The corpus file as it is on disk still declares the Legacy Supers
			// schema id (ADR-0053), which Preset ingress folds onto the current one.
			slug: 'legacy-supers-schema',
			meta: { forkedFrom: null, savedAt: SAVED_AT },
			document: { preset: lowerThirdPresetJson },
			outcome: 'opens',
			presetDocument: currentPresetDocument,
			firstSceneOrigin: null
		},
		{
			slug: 'film-one-scene',
			meta: { forkedFrom: 'lower-third', savedAt: SAVED_AT },
			document: {
				film: filmDocumentOf(currentPresetDocument, [{ id: 'scene-1', origin: filmSceneOrigin }])
			},
			outcome: 'opens',
			presetDocument: currentPresetDocument,
			firstSceneOrigin: filmSceneOrigin
		},
		{
			slug: 'film-two-scenes',
			meta: { forkedFrom: null, savedAt: SAVED_AT },
			document: {
				film: filmDocumentOf(currentPresetDocument, [
					{ id: 'intro', origin: filmSceneOrigin },
					{ id: 'outro', origin: null }
				])
			},
			outcome: 'scene-count-refused',
			presetDocument: null,
			firstSceneOrigin: filmSceneOrigin
		},
		{
			slug: 'film-malformed',
			meta: { forkedFrom: null, savedAt: SAVED_AT },
			document: { film: { schema: 'gfx-film@1', name: 'No Scenes' } },
			outcome: 'composition-refused',
			presetDocument: null,
			firstSceneOrigin: null
		}
	];
