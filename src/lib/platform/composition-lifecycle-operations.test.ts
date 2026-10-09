import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { ACCEPTED_COMPOSITION_SCHEMA_IDS } from '../utils/legacy-supers-compatibility';
import { CompositionSessionStorageError } from './browser-user-composition-store';
import { compositionMeta } from './composition-meta.svelte';
import { engineState, packState, transitionState } from './engine-state.svelte';
import { PRESET_SCHEMA_ID } from './engine-schema';
import { filmFromPreset, filmToWireFormat } from './film-ingress';
import { filmState } from './film-state.svelte';
import { posterKeyForPreset } from './posters';
import { applyPreset } from './preset';
import { getPresetBySlug } from './preset-catalog';
import { parsePresetIngress } from './preset-ingress';
import { presetBase } from './preset-base.svelte';
import {
	BLANK_COMPOSITION_NAME,
	listStarterTemplateSlugs,
	runCreateBlankCompositionOperation,
	runCreateCompositionFromStarterOperation,
	runImportCompositionJsonOperation,
	runOpenCompositionOperation,
	storeUserCompositionUnderNewSlug,
	type CompositionLifecycleOutcome,
	type CompositionLifecycleReceipt
} from './composition-lifecycle-operations';
import { UserCompositionStarterSlugError } from './user-composition-store-errors';
import { userCompositionStore } from './user-composition-store';

import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { Preset } from './engine-schema';
import type { UserCompositionMeta } from './user-composition-store';

vi.mock('./user-composition-store', () => ({
	userCompositionStore: {
		listUserCompositions: vi.fn(),
		loadUserComposition: vi.fn(),
		createUserComposition: vi.fn(),
		saveUserComposition: vi.fn(),
		deleteUserComposition: vi.fn(),
		inspectStorage: vi.fn()
	}
}));

const sessionStore = vi.mocked(userCompositionStore);

/** The accepted composition schema id that is not the one writers emit (ADR-0053). */
const LEGACY_COMPOSITION_SCHEMA_ID = ACCEPTED_COMPOSITION_SCHEMA_IDS.find(
	(id) => id !== PRESET_SCHEMA_ID
);

const STARTER_SLUG = 'lower-third';

function sessionEntry(slug: string, preset: Preset): UserCompositionMeta {
	return {
		slug,
		name: preset.name,
		forkedFrom: null,
		savedAt: '2026-08-28T12:00:00.000Z',
		posterKey: null,
		durationSeconds: preset.state.transport.durationSeconds,
		surfaceType: preset.state.surface.type,
		media: preset.state.media,
		mediaStatus: 'ready'
	};
}

function expectApplied(outcome: CompositionLifecycleOutcome): CompositionLifecycleReceipt {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(outcome: CompositionLifecycleOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the lifecycle operation applied.');
	}
	return outcome;
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
	sessionStore.loadUserComposition.mockResolvedValue(null);
	sessionStore.createUserComposition.mockResolvedValue(undefined);
	sessionStore.deleteUserComposition.mockResolvedValue(undefined);

	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = false;
	compositionMeta.userCompositionSlug = null;
	compositionMeta.forkedFrom = null;
	compositionMeta.persistenceError = null;
});

describe('creating a composition', () => {
	it('creates a Film from the blank Preset in the session and opens it at revision 0', async () => {
		const receipt = expectApplied(await runCreateBlankCompositionOperation());

		expect(receipt.slug).toBe('untitled');
		expect(receipt.name).toBe(BLANK_COMPOSITION_NAME);
		expect(receipt.forkedFrom).toBeNull();
		expect(receipt.revision).toBe(0);
		expect(receipt.focus).toBe('composition-root');
		expect(sessionStore.createUserComposition).toHaveBeenCalledTimes(1);
		expect(presetBase.name).toBe(BLANK_COMPOSITION_NAME);
		expect(compositionMeta.isUserComposition).toBe(true);
		expect(compositionMeta.userCompositionSlug).toBe('untitled');
	});

	it('takes a free slug rather than overwriting a composition the session holds', async () => {
		const blank = parsePresetIngress(blankPresetJson);
		sessionStore.listUserCompositions.mockResolvedValue([sessionEntry('untitled', blank)]);

		const receipt = expectApplied(await runCreateBlankCompositionOperation());

		expect(receipt.slug).toBe('untitled-2');
		expect(sessionStore.createUserComposition).toHaveBeenCalledWith(
			'untitled-2',
			expect.objectContaining({
				film: expect.objectContaining({ name: BLANK_COMPOSITION_NAME })
			})
		);
	});

	it('never takes a corpus slug, even one no session composition holds', async () => {
		const receipt = expectApplied(
			await runImportCompositionJsonOperation({
				document: { ...blankPresetJson, name: 'Lower third' }
			})
		);

		// `lower-third` is a Starter's own slug, so the new Film is numbered past it.
		expect(getPresetBySlug('lower-third')).not.toBeNull();
		expect(receipt.slug).toBe('lower-third-2');
	});

	it('creates a Film from a named Starter under a new slug, without modifying the Starter', async () => {
		const receipt = expectApplied(
			await runCreateCompositionFromStarterOperation({ starterSlug: STARTER_SLUG })
		);
		const starter = getPresetBySlug(STARTER_SLUG);
		if (!starter) throw new Error(`Expected the corpus to ship "${STARTER_SLUG}".`);

		expect(receipt.forkedFrom).toBe(STARTER_SLUG);
		// The receipt reports the new slug: the Starter's own is never stored under.
		expect(receipt.slug).toBe('lower-third-2');
		expect(compositionMeta.userCompositionSlug).toBe('lower-third-2');
		// The Film's one Scene is an owned copy that remembers where it came from.
		const [slug, stored] = sessionStore.createUserComposition.mock.calls[0];
		expect(slug).toBe('lower-third-2');
		expect(stored.film).toEqual(
			filmFromPreset(starter, { slug: STARTER_SLUG, contentKey: posterKeyForPreset(starter) })
		);
		expect(filmState.scenes[0].origin).toEqual({
			slug: STARTER_SLUG,
			contentKey: posterKeyForPreset(starter)
		});
		expect(receipt.name).toBe('Lower-third');
		expect(engineState.overlays.map((overlay) => overlay.type)).toEqual(['lower-third']);
		expect(getPresetBySlug(STARTER_SLUG)?.name).toBe('Lower-third');
	});

	it('refuses a Starter this engine does not ship and names the ones it does', async () => {
		const failure = expectFailed(
			await runCreateCompositionFromStarterOperation({ starterSlug: 'not-a-starter' })
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.rejected).toBe('not-a-starter');
		expect(failure.alternatives.length).toBeGreaterThan(0);
		expect(listStarterTemplateSlugs()).toContain(failure.alternatives[0]);
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
	});

	it('refuses to create anything while the transition snapshot path owns engine state', async () => {
		transitionState.capturing = true;

		expect(expectFailed(await runCreateBlankCompositionOperation()).code).toBe(
			'precondition_unmet'
		);
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
	});

	it('reports a session store that did not answer without opening anything', async () => {
		sessionStore.createUserComposition.mockRejectedValue(new Error('The store went away'));

		const failure = expectFailed(await runCreateBlankCompositionOperation());

		expect(failure.code).toBe('storage_unavailable');
		expect(failure.message).toContain('The store went away');
		expect(compositionMeta.userCompositionSlug).toBeNull();
	});

	it('passes a full session through as the quota refusal it is, not a missing store', async () => {
		sessionStore.createUserComposition.mockRejectedValue(
			new CompositionSessionStorageError('quota_exceeded', 'This browser session is full.')
		);

		const failure = expectFailed(await runCreateBlankCompositionOperation());

		expect(failure.code).toBe('quota_exceeded');
		expect(failure.message).toBe('This browser session is full.');
		expect(compositionMeta.userCompositionSlug).toBeNull();
	});

	it('reports a store that refused the slug without opening anything', async () => {
		sessionStore.createUserComposition.mockRejectedValue(
			new UserCompositionStarterSlugError('untitled')
		);

		const failure = expectFailed(await runCreateBlankCompositionOperation());

		expect(failure.code).toBe('storage_unavailable');
		expect(failure.message).toContain('is the slug of a Starter');
		expect(compositionMeta.userCompositionSlug).toBeNull();
	});
});

describe('opening a composition', () => {
	it('opens a session composition as the Film the store holds, with its Scene origin', async () => {
		const stored = parsePresetIngress({ ...blankPresetJson, name: 'My lower third' });
		const origin = { slug: STARTER_SLUG, contentKey: null };
		sessionStore.loadUserComposition.mockResolvedValue({
			film: filmFromPreset(stored, origin),
			legacyPresetEnvelope: { kind: 'deliverable' }
		});

		const receipt = expectApplied(await runOpenCompositionOperation({ slug: 'my-lower-third' }));

		expect(receipt.name).toBe('My lower third');
		expect(receipt.forkedFrom).toBe(STARTER_SLUG);
		expect(compositionMeta.isUserComposition).toBe(true);
		expect(filmState.scenes[0].origin).toEqual(origin);
		expect(presetBase.kind).toBe('deliverable');
		expect(engineState.overlays).toEqual([]);
	});

	it('opens the pristine Starter at a corpus slug, whatever the session holds there', async () => {
		// A record an older release stored under the Starter's slug never opens
		// here: the store is not even asked.
		sessionStore.loadUserComposition.mockResolvedValue({
			film: filmFromPreset(parsePresetIngress({ ...blankPresetJson, name: 'Shadow' }), null),
			legacyPresetEnvelope: { kind: 'deliverable' }
		});

		const receipt = expectApplied(await runOpenCompositionOperation({ slug: STARTER_SLUG }));

		expect(receipt.name).toBe('Lower-third');
		expect(compositionMeta.isUserComposition).toBe(false);
		expect(sessionStore.loadUserComposition).not.toHaveBeenCalled();
	});

	it('opens a Starter read-only, writing nothing to the session', async () => {
		const receipt = expectApplied(await runOpenCompositionOperation({ slug: STARTER_SLUG }));

		expect(receipt.slug).toBe(STARTER_SLUG);
		expect(receipt.forkedFrom).toBeNull();
		expect(compositionMeta.isUserComposition).toBe(false);
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
		expect(sessionStore.saveUserComposition).not.toHaveBeenCalled();
	});

	it('refuses a slug neither the session nor the corpus carries', async () => {
		const failure = expectFailed(await runOpenCompositionOperation({ slug: 'nothing-here' }));

		expect(failure.code).toBe('unknown_target');
		expect(failure.rejected).toBe('nothing-here');
	});
});

describe('importing a composition document', () => {
	it('imports a Legacy Supers document as a session composition', async () => {
		expect(LEGACY_COMPOSITION_SCHEMA_ID).toBeDefined();

		const receipt = expectApplied(
			await runImportCompositionJsonOperation({
				document: {
					...blankPresetJson,
					schema: LEGACY_COMPOSITION_SCHEMA_ID,
					name: 'Imported piece'
				}
			})
		);

		expect(receipt.name).toBe('Imported piece');
		expect(receipt.slug).toBe('imported-piece');
		expect(presetBase.name).toBe('Imported piece');
		expect(packState.slug).toBe('syntax');
		expect(receipt.legacyUpgrades).toEqual(['legacy-schema-id']);
	});

	it('round-trips a current document without reporting an upgrade it did not need', async () => {
		const receipt = expectApplied(
			await runImportCompositionJsonOperation({
				document: { ...blankPresetJson, schema: PRESET_SCHEMA_ID, name: 'Current piece' }
			})
		);

		expect(receipt.legacyUpgrades).toEqual([]);
		const [, stored] = sessionStore.createUserComposition.mock.calls[0];
		// A Preset document is lifted to a one-Scene Film that came from no Starter.
		expect(stored.film.schema).toBe('gfx-film@1');
		expect(stored.film.name).toBe('Current piece');
		expect(stored.film.scenes.map((scene) => scene.origin)).toEqual([null]);
	});

	it('imports a gfx-film@1 document as the Film it is', async () => {
		const film = filmFromPreset(
			parsePresetIngress({ ...blankPresetJson, kind: 'deliverable', name: 'Exported film' }),
			{ slug: STARTER_SLUG, contentKey: '0123456789abcdef' }
		);

		const receipt = expectApplied(
			await runImportCompositionJsonOperation({
				document: JSON.parse(JSON.stringify(filmToWireFormat(film)))
			})
		);

		expect(receipt.slug).toBe('exported-film');
		expect(receipt.name).toBe('Exported film');
		expect(receipt.forkedFrom).toBe(STARTER_SLUG);
		expect(receipt.legacyUpgrades).toEqual([]);
		const [, stored] = sessionStore.createUserComposition.mock.calls[0];
		expect(stored).toEqual({ film, legacyPresetEnvelope: { kind: 'deliverable' } });
	});

	it('refuses a Film document the schema rejects, and one longer than the Workspace plays', async () => {
		const film = filmToWireFormat(filmFromPreset(parsePresetIngress(blankPresetJson), null)) as {
			scenes: { id: string }[];
			boundaries: unknown[];
		};

		const malformed = expectFailed(
			await runImportCompositionJsonOperation({
				document: { schema: 'gfx-film@1', name: 'No Scenes' }
			})
		);
		expect(malformed.code).toBe('schema_invalid');
		expect(malformed.findings.total).toBeGreaterThan(0);

		const twoScenes = expectFailed(
			await runImportCompositionJsonOperation({
				document: {
					...film,
					scenes: [film.scenes[0], { ...film.scenes[0], id: 'scene-2' }],
					boundaries: [{ kind: 'cut' }]
				}
			})
		);
		expect(twoScenes.code).toBe('precondition_unmet');
		expect(twoScenes.message).toContain('this build opens one-Scene Films only');
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
	});

	it('upgrades a legacy Source video into the Media library it imports as', async () => {
		const legacyAssetUrl = `/api/user-assets/${'a'.repeat(64)}.mp4`;
		const receipt = expectApplied(
			await runImportCompositionJsonOperation({
				document: {
					...blankPresetJson,
					name: 'Legacy source video',
					state: {
						...blankPresetJson.state,
						sourceVideo: { assetUrl: legacyAssetUrl, sourceOffsetSeconds: 0 }
					}
				}
			})
		);

		// The corpus Preset this document is cut from still carries the previous
		// namespace's schema id, so both upgrades are reported — they are separate
		// legacy shapes, and a receipt that folded them together would hide one.
		expect(receipt.legacyUpgrades).toContain('legacy-source-video');
		const [, stored] = sessionStore.createUserComposition.mock.calls[0];
		const { media } = stored.film.scenes[0].state;
		expect(media.assets.map((asset) => asset.assetUrl)).toEqual([legacyAssetUrl]);
		expect(media.videoTrack.clips).toHaveLength(1);
	});

	it('imports media whose bytes are out of reach, leaving it there to repair', async () => {
		// A composition exported from another session names assets by content
		// address. Whether this browser can read those bytes is a reachability
		// question the Media family answers at inspection time; the document
		// itself is sound, so refusing it here would strand work nothing is wrong
		// with.
		const unreachableAssetUrl = `/api/user-assets/${'b'.repeat(64)}.mov`;
		const receipt = expectApplied(
			await runImportCompositionJsonOperation({
				document: {
					...blankPresetJson,
					name: 'Unreachable media',
					state: {
						...blankPresetJson.state,
						media: {
							assets: [
								{
									id: 'video-a',
									kind: 'video',
									name: 'Interview.mov',
									assetUrl: unreachableAssetUrl
								}
							],
							videoTrack: { clips: [] }
						}
					}
				}
			})
		);

		expect(receipt.findings.total).toBe(0);
		const [, stored] = sessionStore.createUserComposition.mock.calls[0];
		expect(stored.film.scenes[0].state.media.assets[0].assetUrl).toBe(unreachableAssetUrl);
	});

	it('names the Media reference to correct when that is all that blocked the import', async () => {
		const failure = expectFailed(
			await runImportCompositionJsonOperation({
				document: {
					...blankPresetJson,
					state: {
						...blankPresetJson.state,
						media: {
							assets: [],
							videoTrack: {
								clips: [
									{
										id: 'clip-a',
										assetId: 'video-a',
										timelineStartFrame: 0,
										durationFrames: 12,
										sourceStartSeconds: 0,
										audio: { enabled: true, gain: 1 }
									}
								]
							}
						}
					}
				}
			})
		);

		expect(failure.code).toBe('semantic_invalid');
		expect(failure.message).toContain('Media');
		expect(failure.findings.findings[0].path).toBe('/state/media/videoTrack/clips/0/assetId');
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
	});

	it('refuses a document the schema rejects and imports nothing', async () => {
		const failure = expectFailed(
			await runImportCompositionJsonOperation({ document: { schema: 'gfx@1', name: 'No state' } })
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.total).toBeGreaterThan(0);
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
		expect(presetBase.name).toBe('Blank');
	});

	it('refuses a document the engine could not load and imports nothing', async () => {
		const failure = expectFailed(
			await runImportCompositionJsonOperation({
				document: { ...blankPresetJson, pack: 'not-a-registered-pack' }
			})
		);

		expect(failure.code).toBe('semantic_invalid');
		expect(failure.findings.findings[0].path).toBe('/pack');
		expect(packState.slug).toBe('syntax');
	});
});

// What the preset route does on the first edit to a Starter it opened
// (ADR-0068 §3): the edited document becomes a new Film under a new slug, and
// the route replaces its URL with that slug.
describe('the first edit to an opened Starter', () => {
	it('stores the edited document as a new Film under a new slug, never the Starter slug', async () => {
		const starter = getPresetBySlug(STARTER_SLUG);
		if (!starter) throw new Error(`Expected the corpus to ship "${STARTER_SLUG}".`);
		sessionStore.listUserCompositions.mockResolvedValue([sessionEntry('lower-third-2', starter)]);
		const edited = {
			film: filmFromPreset(
				{ ...starter, state: { ...starter.state, overlays: [] } },
				{ slug: STARTER_SLUG, contentKey: posterKeyForPreset(starter) }
			),
			legacyPresetEnvelope: { kind: starter.kind }
		};

		const slug = await storeUserCompositionUnderNewSlug(edited);

		// Named after the Starter, and numbered past the corpus slug and the stored one.
		expect(slug).toBe('lower-third-3');
		expect(sessionStore.createUserComposition).toHaveBeenCalledTimes(1);
		expect(sessionStore.createUserComposition).toHaveBeenCalledWith('lower-third-3', edited);
		expect(sessionStore.saveUserComposition).not.toHaveBeenCalled();
		expect(edited.film.scenes[0].origin?.slug).toBe(STARTER_SLUG);
	});

	it('lets a store refusal reach the route, which reports it', async () => {
		sessionStore.createUserComposition.mockRejectedValue(
			new CompositionSessionStorageError('quota_exceeded', 'This browser session is full.')
		);
		const blank = parsePresetIngress(blankPresetJson);

		await expect(
			storeUserCompositionUnderNewSlug({
				film: filmFromPreset(blank, { slug: 'blank', contentKey: null }),
				legacyPresetEnvelope: { kind: blank.kind }
			})
		).rejects.toThrow('This browser session is full.');
	});
});
