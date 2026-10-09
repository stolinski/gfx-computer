import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { runSetCompositionIdentityOperation } from './composition-document-operations';
import { compositionEditHistory } from './composition-edit-history';
import {
	runCompositionHistoryTransaction,
	type CompositionOperationOutcome,
	type CompositionOperationReceipt
} from './composition-edit-transaction';
import { runCreateCompositionFromStarterOperation } from './composition-lifecycle-operations';
import { compositionMeta } from './composition-meta.svelte';
import {
	runAddCompositionSceneFromStarterOperation,
	runRemoveCompositionSceneOperation,
	runReorderCompositionSceneOperation,
	runSelectCompositionSceneOperation,
	type CompositionSceneSelectionOutcome
} from './composition-scene-operations';
import { engineState, transitionState } from './engine-state.svelte';
import { FILM_FIRST_SCENE_ID, filmToWireFormat } from './film-ingress';
import { filmSceneFrameCount } from './film-playhead';
import { filmState, readOpenFilm } from './film-state.svelte';
import { posterKeyForPreset } from './posters';
import { applyPreset } from './preset';
import { getPresetBySlug } from './preset-catalog';
import { parsePresetIngress } from './preset-ingress';
import { userCompositionStore } from './user-composition-store';
import { resolveFrameRate } from '../utils/composition-timing';

import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { Preset } from './engine-schema';

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

const FIRST_STARTER = 'lower-third';
const SECOND_STARTER = 'chapter-card-descent';
const THIRD_STARTER = 'counter-milestone';

function requireStarter(slug: string): Preset {
	const starter = getPresetBySlug(slug);
	if (!starter) throw new Error(`The corpus holds no Starter "${slug}".`);
	return starter;
}

function expectApplied(outcome: CompositionOperationOutcome): CompositionOperationReceipt {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionOperationOutcome | CompositionSceneSelectionOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error(`Expected a refusal but the operation answered ${outcome.status}.`);
	}
	return outcome;
}

function sceneIds(): string[] {
	return filmState.scenes.map((scene) => scene.id);
}

function snapshotOpenFilm(): string {
	return JSON.stringify(filmToWireFormat(readOpenFilm()));
}

async function addScene(
	starterSlug: string,
	sceneIndex?: number
): Promise<CompositionOperationReceipt> {
	return expectApplied(
		await runAddCompositionSceneFromStarterOperation({
			expectedRevision: compositionEditHistory.revision,
			starterSlug,
			...(sceneIndex !== undefined ? { sceneIndex } : {})
		})
	);
}

/** A stored Film of three Scenes: `scene-1` (open), `scene-2`, `scene-3`. */
async function openThreeSceneFilm(): Promise<void> {
	await addScene(SECOND_STARTER);
	await addScene(THIRD_STARTER);
}

beforeEach(async () => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
	sessionStore.loadUserComposition.mockResolvedValue(null);
	sessionStore.createUserComposition.mockResolvedValue(undefined);
	transitionState.capturing = false;
	filmState.isSwappingScene = false;
	compositionMeta.persistenceError = null;

	// A stored one-Scene Film, open at revision 0.
	const created = await runCreateCompositionFromStarterOperation({ starterSlug: FIRST_STARTER });
	if (created.status !== 'applied') throw new Error(created.message);
});

describe('composition.add-scene-from-starter', () => {
	it('appends an owned, named copy of the Starter with a cut, as one undoable edit', async () => {
		const starter = requireStarter(SECOND_STARTER);
		const before = snapshotOpenFilm();

		const receipt = await addScene(SECOND_STARTER);

		expect(receipt.operationId).toBe('composition.add-scene-from-starter');
		expect(receipt.revision).toBe(1);
		expect(receipt.changed).toEqual({
			pointers: ['/scenes', '/boundaries'],
			total: 2,
			truncated: false
		});
		// A Film-level change names Film pointers and no Scene.
		expect(receipt).not.toHaveProperty('sceneId');
		expect(receipt.undoLabel).toBe(`Add Scene "${starter.name}"`);
		expect(receipt.focus).toEqual({ target: 'composition-root' });

		const film = readOpenFilm();
		expect(sceneIds()).toEqual([FILM_FIRST_SCENE_ID, 'scene-2']);
		expect(film.boundaries).toEqual([{ kind: 'cut' }]);
		expect(film.scenes[1].name).toBe(starter.name);
		expect(film.scenes[1].origin).toEqual({
			slug: SECOND_STARTER,
			contentKey: posterKeyForPreset(starter)
		});
		expect(film.scenes[1].state.surface.type).toBe(starter.state.surface.type);
		// The Scene that was open stays open, and no Scene was selected on the way.
		expect(filmState.selectedSceneId).toBe(FILM_FIRST_SCENE_ID);
		expect(compositionEditHistory.editsSince(0)).toEqual([
			{ revision: 1, label: `Add Scene "${starter.name}"` }
		]);

		expectApplied(runCompositionHistoryTransaction('undo', 1));
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('owns its copy: editing the Scene never reaches the Starter', async () => {
		await addScene(SECOND_STARTER);
		const starterDuration = requireStarter(SECOND_STARTER).state.transport.durationSeconds;

		await runSelectCompositionSceneOperation({ sceneId: 'scene-2' });
		engineState.transport.durationSeconds = starterDuration + 1;

		expect(requireStarter(SECOND_STARTER).state.transport.durationSeconds).toBe(starterDuration);
	});

	it('mints ids that are unique within the Film and adds at an index', async () => {
		await addScene(SECOND_STARTER);
		await addScene(THIRD_STARTER, 0);
		await addScene(THIRD_STARTER, 1);

		expect(sceneIds()).toEqual(['scene-3', 'scene-4', FILM_FIRST_SCENE_ID, 'scene-2']);
		expect(new Set(sceneIds()).size).toBe(4);
		expect(readOpenFilm().boundaries).toHaveLength(3);
	});

	it('plays the added Scene under the Film’s Pack and transport', async () => {
		expectApplied(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Launch film' })
		);
		engineState.transport.fps = 24;

		await addScene(SECOND_STARTER);

		const film = readOpenFilm();
		expect(film.fps).toBe(24);
		expect(film.scenes[1].state.transport.fps).toBe(24);
		expect(film.scenes[1].state.transport.orientation).toBe(film.orientation);
		// The Film keeps its own name; the Scene keeps its Starter's.
		expect(film.name).toBe('Launch film');
		expect(film.scenes[1].name).toBe(requireStarter(SECOND_STARTER).name);
	});

	it('refuses an unsaved Starter, which is not a Film yet', async () => {
		applyPreset(parsePresetIngress(blankPresetJson));
		compositionMeta.isUserComposition = false;
		compositionMeta.userCompositionSlug = 'blank';

		const failure = expectFailed(
			await runAddCompositionSceneFromStarterOperation({
				expectedRevision: 0,
				starterSlug: SECOND_STARTER
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.rejected).toBe('blank');
		expect(sceneIds()).toEqual([FILM_FIRST_SCENE_ID]);
	});

	it('refuses a Starter the engine does not ship, an index outside the Film, and a stale revision', async () => {
		const before = snapshotOpenFilm();

		const unknown = expectFailed(
			await runAddCompositionSceneFromStarterOperation({
				expectedRevision: 0,
				starterSlug: 'not-a-starter'
			})
		);
		expect(unknown.code).toBe('unknown_target');
		expect(unknown.rejected).toBe('not-a-starter');
		expect(unknown.alternatives.length).toBeGreaterThan(0);

		const outside = expectFailed(
			await runAddCompositionSceneFromStarterOperation({
				expectedRevision: 0,
				starterSlug: SECOND_STARTER,
				sceneIndex: 2
			})
		);
		expect(outside.code).toBe('invalid_argument');
		expect(outside.alternatives).toEqual(['0', '1']);

		const stale = expectFailed(
			await runAddCompositionSceneFromStarterOperation({
				expectedRevision: 7,
				starterSlug: SECOND_STARTER
			})
		);
		expect(stale.code).toBe('stale_revision');

		expect(snapshotOpenFilm()).toBe(before);
		expect(compositionEditHistory.revision).toBe(0);
	});
});

describe('composition.remove-scene', () => {
	beforeEach(openThreeSceneFilm);

	it('removes a Scene with one boundary, as one undoable edit', async () => {
		const before = snapshotOpenFilm();
		const revision = compositionEditHistory.revision;

		const receipt = expectApplied(
			await runRemoveCompositionSceneOperation({ expectedRevision: revision, sceneId: 'scene-2' })
		);

		expect(receipt.revision).toBe(revision + 1);
		expect(receipt.changed.pointers).toEqual(['/scenes', '/boundaries']);
		expect(receipt.undoLabel).toBe('Remove Scene "scene-2"');
		expect(sceneIds()).toEqual([FILM_FIRST_SCENE_ID, 'scene-3']);
		expect(readOpenFilm().boundaries).toEqual([{ kind: 'cut' }]);
		// The open Scene was not the one removed, so it stays open.
		expect(filmState.selectedSceneId).toBe(FILM_FIRST_SCENE_ID);

		expectApplied(runCompositionHistoryTransaction('undo', revision + 1));
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('opens the next Scene when the open one is removed, and the one before when it was last', async () => {
		expectApplied(
			await runRemoveCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: FILM_FIRST_SCENE_ID
			})
		);
		expect(sceneIds()).toEqual(['scene-2', 'scene-3']);
		expect(filmState.selectedSceneId).toBe('scene-2');
		expect(engineState.surface.type).toBe(requireStarter(SECOND_STARTER).state.surface.type);

		await runSelectCompositionSceneOperation({ sceneId: 'scene-3' });
		expectApplied(
			await runRemoveCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: 'scene-3'
			})
		);
		expect(sceneIds()).toEqual(['scene-2']);
		expect(filmState.selectedSceneId).toBe('scene-2');
		expect(readOpenFilm().boundaries).toEqual([]);
	});

	it('restores the removed Scene and reopens it on undo', async () => {
		const revision = compositionEditHistory.revision;
		expectApplied(
			await runRemoveCompositionSceneOperation({
				expectedRevision: revision,
				sceneId: FILM_FIRST_SCENE_ID
			})
		);

		expectApplied(runCompositionHistoryTransaction('undo', revision + 1));

		expect(sceneIds()).toEqual([FILM_FIRST_SCENE_ID, 'scene-2', 'scene-3']);
		expect(filmState.selectedSceneId).toBe(FILM_FIRST_SCENE_ID);
	});

	it('refuses the Film’s last Scene, an unknown Scene, and a stale revision', async () => {
		const unknown = expectFailed(
			await runRemoveCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: 'scene-9'
			})
		);
		expect(unknown.code).toBe('unknown_target');
		expect(unknown.alternatives).toEqual([FILM_FIRST_SCENE_ID, 'scene-2', 'scene-3']);

		const stale = expectFailed(
			await runRemoveCompositionSceneOperation({ expectedRevision: 0, sceneId: 'scene-2' })
		);
		expect(stale.code).toBe('stale_revision');
		expect(sceneIds()).toHaveLength(3);

		for (const sceneId of ['scene-2', 'scene-3']) {
			expectApplied(
				await runRemoveCompositionSceneOperation({
					expectedRevision: compositionEditHistory.revision,
					sceneId
				})
			);
		}
		const last = expectFailed(
			await runRemoveCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: FILM_FIRST_SCENE_ID
			})
		);
		expect(last.code).toBe('precondition_unmet');
		expect(last.rejected).toBe(FILM_FIRST_SCENE_ID);
		expect(sceneIds()).toEqual([FILM_FIRST_SCENE_ID]);
	});
});

describe('composition.reorder-scene', () => {
	beforeEach(openThreeSceneFilm);

	it('moves a Scene, keeps the boundary list, and undoes as one edit', async () => {
		const before = snapshotOpenFilm();
		const revision = compositionEditHistory.revision;

		const receipt = expectApplied(
			await runReorderCompositionSceneOperation({
				expectedRevision: revision,
				sceneId: 'scene-3',
				toSceneIndex: 0
			})
		);

		expect(receipt.revision).toBe(revision + 1);
		expect(receipt.changed).toEqual({ pointers: ['/scenes'], total: 1, truncated: false });
		expect(receipt.undoLabel).toBe('Move Scene "scene-3"');
		expect(sceneIds()).toEqual(['scene-3', FILM_FIRST_SCENE_ID, 'scene-2']);
		expect(readOpenFilm().boundaries).toEqual([{ kind: 'cut' }, { kind: 'cut' }]);
		// Moving a Scene does not change which one is open.
		expect(filmState.selectedSceneId).toBe(FILM_FIRST_SCENE_ID);

		expectApplied(runCompositionHistoryTransaction('undo', revision + 1));
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('applies nothing when the Scene is already there', async () => {
		const revision = compositionEditHistory.revision;

		const receipt = expectApplied(
			await runReorderCompositionSceneOperation({
				expectedRevision: revision,
				sceneId: 'scene-2',
				toSceneIndex: 1
			})
		);

		expect(receipt.revision).toBe(revision);
		expect(receipt.undoLabel).toBeNull();
		expect(receipt.changed.total).toBe(0);
	});

	it('refuses an unknown Scene, an index outside the Film, and a stale revision', async () => {
		const before = snapshotOpenFilm();
		const revision = compositionEditHistory.revision;

		expect(
			expectFailed(
				await runReorderCompositionSceneOperation({
					expectedRevision: revision,
					sceneId: 'scene-9',
					toSceneIndex: 0
				})
			).code
		).toBe('unknown_target');
		const outside = expectFailed(
			await runReorderCompositionSceneOperation({
				expectedRevision: revision,
				sceneId: 'scene-2',
				toSceneIndex: 3
			})
		);
		expect(outside.code).toBe('invalid_argument');
		expect(outside.alternatives).toEqual(['0', '2']);
		expect(
			expectFailed(
				await runReorderCompositionSceneOperation({
					expectedRevision: 0,
					sceneId: 'scene-2',
					toSceneIndex: 0
				})
			).code
		).toBe('stale_revision');

		expect(snapshotOpenFilm()).toBe(before);
	});
});

describe('composition.select-scene', () => {
	beforeEach(openThreeSceneFilm);

	it('opens another Scene, advances the revision once, and records no undo entry', async () => {
		const revision = compositionEditHistory.revision;
		const undoLabel = compositionEditHistory.undoLabel;
		const film = readOpenFilm();

		const outcome = await runSelectCompositionSceneOperation({ sceneId: 'scene-2' });

		expect(outcome).toEqual({
			status: 'selected',
			operationId: 'composition.select-scene',
			revision: revision + 1,
			sceneId: 'scene-2',
			sceneIndex: 1,
			sceneFrame: 0,
			sceneFrameCount: filmSceneFrameCount(film.scenes[1], resolveFrameRate(film.fps)),
			focus: 'timeline-playhead'
		});
		expect(filmState.selectedSceneId).toBe('scene-2');
		expect(engineState.surface.type).toBe(requireStarter(SECOND_STARTER).state.surface.type);
		// Selection is not an edit: the last undo entry is still the last edit.
		expect(compositionEditHistory.undoLabel).toBe(undoLabel);
	});

	it('makes a revision read before the selection stale for the next edit', async () => {
		const revisionBefore = compositionEditHistory.revision;
		await runSelectCompositionSceneOperation({ sceneId: 'scene-2' });

		const stale = expectFailed(
			await runRemoveCompositionSceneOperation({
				expectedRevision: revisionBefore,
				sceneId: 'scene-3'
			})
		);

		expect(stale.code).toBe('stale_revision');
		expect(stale.movedSince).toEqual(['Select Scene "scene-2"']);
	});

	it('changes nothing when the Scene is already open', async () => {
		const revision = compositionEditHistory.revision;

		const outcome = await runSelectCompositionSceneOperation({ sceneId: FILM_FIRST_SCENE_ID });

		expect(outcome).toMatchObject({ status: 'selected', revision, sceneIndex: 0 });
		expect(compositionEditHistory.revision).toBe(revision);
	});

	it('refuses an unknown Scene and a frame outside the Scene, selecting nothing', async () => {
		const revision = compositionEditHistory.revision;
		const film = readOpenFilm();
		const frameCount = filmSceneFrameCount(film.scenes[1], resolveFrameRate(film.fps));

		const unknown = expectFailed(await runSelectCompositionSceneOperation({ sceneId: 'scene-9' }));
		expect(unknown.code).toBe('unknown_target');
		expect(unknown.alternatives).toEqual([FILM_FIRST_SCENE_ID, 'scene-2', 'scene-3']);

		const outside = expectFailed(
			await runSelectCompositionSceneOperation({ sceneId: 'scene-2', sceneFrame: frameCount })
		);
		expect(outside.code).toBe('invalid_argument');
		expect(outside.alternatives).toEqual(['0', String(frameCount - 1)]);

		expect(filmState.selectedSceneId).toBe(FILM_FIRST_SCENE_ID);
		expect(compositionEditHistory.revision).toBe(revision);
	});

	it('waits out a Scene swap that has not settled', async () => {
		filmState.isSwappingScene = true;

		expect(
			expectFailed(await runSelectCompositionSceneOperation({ sceneId: 'scene-2' })).code
		).toBe('precondition_unmet');
	});
});

describe('the boundary list across a run of Scene edits', () => {
	it('always holds one boundary per pair of neighbours', async () => {
		const expectOneBoundaryPerPair = (): void => {
			const film = readOpenFilm();
			expect(film.boundaries).toHaveLength(film.scenes.length - 1);
		};

		await addScene(SECOND_STARTER);
		expectOneBoundaryPerPair();
		await addScene(THIRD_STARTER, 0);
		expectOneBoundaryPerPair();
		expectApplied(
			await runReorderCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: 'scene-2',
				toSceneIndex: 0
			})
		);
		expectOneBoundaryPerPair();
		expectApplied(
			await runRemoveCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: 'scene-3'
			})
		);
		expectOneBoundaryPerPair();
		expect(sceneIds()).toEqual(['scene-2', FILM_FIRST_SCENE_ID]);
	});
});
