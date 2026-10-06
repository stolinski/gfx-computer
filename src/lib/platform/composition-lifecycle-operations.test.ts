import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { ACCEPTED_COMPOSITION_SCHEMA_IDS } from '../utils/legacy-supers-compatibility';
import { CompositionSessionStorageError } from './browser-user-composition-store';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { engineState, packState, transitionState } from './engine-state.svelte';
import { PRESET_SCHEMA_ID } from './engine-schema';
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
	runRevertCompositionToStarterOperation,
	type CompositionLifecycleOutcome,
	type CompositionLifecycleReceipt
} from './composition-lifecycle-operations';
import { UserCompositionNotHeldError } from './user-composition-store-errors';
import { userCompositionStore } from './user-composition-store';

import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { Preset } from './engine-schema';
import type { UserCompositionMeta } from './user-composition-store';

vi.mock('./user-composition-store', () => ({
	userCompositionStore: {
		listUserCompositions: vi.fn(),
		loadUserComposition: vi.fn(),
		forkUserComposition: vi.fn(),
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
	sessionStore.forkUserComposition.mockResolvedValue(undefined);
	sessionStore.deleteUserComposition.mockResolvedValue(undefined);

	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = false;
	compositionMeta.userCompositionSlug = null;
	compositionMeta.forkedFrom = null;
	compositionMeta.persistenceError = null;
});

describe('creating a composition', () => {
	it('forks the blank Preset into the session and opens it at revision 0', async () => {
		const receipt = expectApplied(await runCreateBlankCompositionOperation());

		expect(receipt.slug).toBe('untitled');
		expect(receipt.name).toBe(BLANK_COMPOSITION_NAME);
		expect(receipt.forkedFrom).toBeNull();
		expect(receipt.revision).toBe(0);
		expect(receipt.focus).toBe('composition-root');
		expect(sessionStore.forkUserComposition).toHaveBeenCalledTimes(1);
		expect(presetBase.name).toBe(BLANK_COMPOSITION_NAME);
		expect(compositionMeta.isUserComposition).toBe(true);
		expect(compositionMeta.userCompositionSlug).toBe('untitled');
	});

	it('takes a free slug rather than overwriting a composition the session holds', async () => {
		const blank = parsePresetIngress(blankPresetJson);
		sessionStore.listUserCompositions.mockResolvedValue([sessionEntry('untitled', blank)]);

		const receipt = expectApplied(await runCreateBlankCompositionOperation());

		expect(receipt.slug).toBe('untitled-2');
		expect(sessionStore.forkUserComposition).toHaveBeenCalledWith(
			'untitled-2',
			expect.objectContaining({ name: BLANK_COMPOSITION_NAME }),
			null
		);
	});

	it('forks a named Starter without modifying the Starter itself', async () => {
		const receipt = expectApplied(
			await runCreateCompositionFromStarterOperation({ starterSlug: STARTER_SLUG })
		);

		expect(receipt.forkedFrom).toBe(STARTER_SLUG);
		expect(receipt.slug).not.toBe(STARTER_SLUG);
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
		expect(sessionStore.forkUserComposition).not.toHaveBeenCalled();
	});

	it('refuses to create anything while the transition snapshot path owns engine state', async () => {
		transitionState.capturing = true;

		expect(expectFailed(await runCreateBlankCompositionOperation()).code).toBe('precondition_unmet');
		expect(sessionStore.forkUserComposition).not.toHaveBeenCalled();
	});

	it('reports a session store that did not answer without opening anything', async () => {
		sessionStore.forkUserComposition.mockRejectedValue(new Error('The store went away'));

		const failure = expectFailed(await runCreateBlankCompositionOperation());

		expect(failure.code).toBe('storage_unavailable');
		expect(failure.message).toContain('The store went away');
		expect(compositionMeta.userCompositionSlug).toBeNull();
	});

	it('passes a full session through as the quota refusal it is, not a missing store', async () => {
		sessionStore.forkUserComposition.mockRejectedValue(
			new CompositionSessionStorageError('quota_exceeded', 'This browser session is full.')
		);

		const failure = expectFailed(await runCreateBlankCompositionOperation());

		expect(failure.code).toBe('quota_exceeded');
		expect(failure.message).toBe('This browser session is full.');
		expect(compositionMeta.userCompositionSlug).toBeNull();
	});
});

describe('opening a composition', () => {
	it('opens a session composition ahead of the corpus Preset it shadows', async () => {
		const stored = parsePresetIngress({ ...blankPresetJson, name: 'My lower third' });
		sessionStore.loadUserComposition.mockResolvedValue(stored);

		const receipt = expectApplied(await runOpenCompositionOperation({ slug: STARTER_SLUG }));

		expect(receipt.name).toBe('My lower third');
		expect(compositionMeta.isUserComposition).toBe(true);
		expect(engineState.overlays).toEqual([]);
	});

	it('opens a Starter read-only, writing nothing to the session', async () => {
		const receipt = expectApplied(await runOpenCompositionOperation({ slug: STARTER_SLUG }));

		expect(receipt.slug).toBe(STARTER_SLUG);
		expect(receipt.forkedFrom).toBeNull();
		expect(compositionMeta.isUserComposition).toBe(false);
		expect(sessionStore.forkUserComposition).not.toHaveBeenCalled();
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
		const [, stored] = sessionStore.forkUserComposition.mock.calls[0];
		expect(stored.schema).toBe(PRESET_SCHEMA_ID);
		expect(stored.name).toBe('Current piece');
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
		const [, stored] = sessionStore.forkUserComposition.mock.calls[0];
		expect(stored.state.media.assets.map((asset) => asset.assetUrl)).toEqual([legacyAssetUrl]);
		expect(stored.state.media.videoTrack.clips).toHaveLength(1);
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
		const [, stored] = sessionStore.forkUserComposition.mock.calls[0];
		expect(stored.state.media.assets[0].assetUrl).toBe(unreachableAssetUrl);
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
		expect(sessionStore.forkUserComposition).not.toHaveBeenCalled();
	});

	it('refuses a document the schema rejects and imports nothing', async () => {
		const failure = expectFailed(
			await runImportCompositionJsonOperation({ document: { schema: 'gfx@1', name: 'No state' } })
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.total).toBeGreaterThan(0);
		expect(sessionStore.forkUserComposition).not.toHaveBeenCalled();
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

describe('reverting to a Starter', () => {
	it('discards the fork and re-opens the pristine Starter', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = STARTER_SLUG;
		compositionMeta.forkedFrom = STARTER_SLUG;

		const receipt = expectApplied(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(sessionStore.deleteUserComposition).toHaveBeenCalledWith(STARTER_SLUG);
		expect(receipt.slug).toBe(STARTER_SLUG);
		expect(receipt.revision).toBe(0);
		expect(compositionMeta.isUserComposition).toBe(false);
		expect(engineState.overlays.map((overlay) => overlay.type)).toEqual(['lower-third']);
	});

	it('returns a fork made under its own slug to the Starter it recorded', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'lower-third-2';
		compositionMeta.forkedFrom = STARTER_SLUG;

		const receipt = expectApplied(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(sessionStore.deleteUserComposition).toHaveBeenCalledWith('lower-third-2');
		expect(receipt.slug).toBe(STARTER_SLUG);
	});

	// The reported defect: the fork was already gone — discarded from another tab,
	// or by a revert that had already landed — and the strict delete's refusal
	// stranded the composition on the fork it was trying to leave.
	it('opens the Starter when the store no longer holds the fork', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = STARTER_SLUG;
		compositionMeta.forkedFrom = STARTER_SLUG;
		sessionStore.deleteUserComposition.mockRejectedValue(
			new UserCompositionNotHeldError(
				STARTER_SLUG,
				`Failed to delete User composition "${STARTER_SLUG}": 404 Not Found: User composition "${STARTER_SLUG}" not found`
			)
		);

		const receipt = expectApplied(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(receipt.slug).toBe(STARTER_SLUG);
		expect(compositionMeta.isUserComposition).toBe(false);
		expect(engineState.overlays.map((overlay) => overlay.type)).toEqual(['lower-third']);
	});

	it('still refuses when the store would not answer at all', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = STARTER_SLUG;
		compositionMeta.forkedFrom = STARTER_SLUG;
		sessionStore.deleteUserComposition.mockRejectedValue(new Error('the store did not respond'));

		const failure = expectFailed(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('storage_unavailable');
		expect(compositionMeta.isUserComposition).toBe(true);
	});

	it('refuses when the open composition never came from a Starter', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.forkedFrom = null;

		const failure = expectFailed(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});

	it('refuses a stale revision before discarding any work', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = STARTER_SLUG;
		compositionMeta.forkedFrom = STARTER_SLUG;
		compositionEditHistory.recordApplied({
			label: 'Set composition identity',
			undo: () => {},
			redo: () => {}
		});

		const failure = expectFailed(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('stale_revision');
		expect(failure.movedSince).toEqual(['Set composition identity']);
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});

	it('refuses when no composition is open at all', async () => {
		const failure = expectFailed(
			await runRevertCompositionToStarterOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('no_composition_open');
	});
});
