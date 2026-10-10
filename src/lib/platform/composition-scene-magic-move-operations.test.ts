import { beforeEach, describe, expect, it, vi } from 'vitest';

import twoSceneMagicMoveFilmJson from '../../../scripts/fixtures/film-magic-move/two-scene-magic-move.film.json';

import { compositionEditHistory } from './composition-edit-history';
import {
	runCompositionHistoryTransaction,
	type CompositionOperationOutcome,
	type CompositionOperationReceipt
} from './composition-edit-transaction';
import { compositionMeta } from './composition-meta.svelte';
import { runSetCompositionSceneBoundaryOperation } from './composition-scene-boundary-operations';
import {
	runInspectCompositionSceneBoundaryMagicMoveOperation,
	runSetCompositionSceneBoundaryMagicMoveOperation,
	type CompositionSceneBoundaryMagicMoveInspection,
	type SetCompositionSceneBoundaryMagicMoveRequest
} from './composition-scene-magic-move-operations';
import { filmToWireFormat, parseFilm } from './film-ingress';
import type { Film, FilmMagicMovePair, FilmSceneBoundary } from './film-schema';
import { filmState, readOpenFilm } from './film-state.svelte';
import { applyFilm } from './preset';
import { sceneBoundarySelection } from './selection.svelte';
import {
	WEBMCP_OPERATION_INVENTORY,
	WEBMCP_RESULT_CHARACTER_BUDGET
} from './webmcp-operation-inventory';
import { readWebmcpCompositionPreconditions } from './webmcp-tool-preconditions';
import { cloneJsonValue } from '../utils/json-clone';

import type { CompositionOperationFailure } from './composition-operation-preflight';

vi.mock('./user-composition-store', () => ({
	userCompositionStore: {
		listUserCompositions: vi.fn(async () => []),
		loadUserComposition: vi.fn(async () => null),
		createUserComposition: vi.fn(),
		saveUserComposition: vi.fn(),
		deleteUserComposition: vi.fn(),
		inspectStorage: vi.fn()
	}
}));

const LOWER_THIRD_PAIR: FilmMagicMovePair = {
	from: { kind: 'overlay', id: 'lower-third' },
	to: { kind: 'overlay', id: 'lower-third' }
};

function expectApplied(outcome: CompositionOperationOutcome): CompositionOperationReceipt {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionOperationOutcome | CompositionSceneBoundaryMagicMoveInspection
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error(`Expected a refusal but the operation answered ${outcome.status}.`);
	}
	return outcome;
}

function setMagicMove(
	request: Omit<SetCompositionSceneBoundaryMagicMoveRequest, 'expectedRevision' | 'outgoingSceneId'>
): Promise<CompositionOperationOutcome> {
	return runSetCompositionSceneBoundaryMagicMoveOperation({
		expectedRevision: compositionEditHistory.revision,
		outgoingSceneId: 'outro',
		...request
	});
}

function inspectMagicMove(outgoingSceneId = 'outro'): CompositionSceneBoundaryMagicMoveInspection {
	const outcome = runInspectCompositionSceneBoundaryMagicMoveOperation({ outgoingSceneId });
	if (outcome.status !== 'inspected') {
		throw new Error(`Expected an inspection but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function boundary(): FilmSceneBoundary {
	return readOpenFilm().boundaries[0];
}

function snapshotOpenFilm(): string {
	return JSON.stringify(filmToWireFormat(readOpenFilm()));
}

/** The fixture Film, opened as a stored Film, with its boundary as given. */
function openFilm(mutate: (film: Film) => void = () => undefined): void {
	const film = parseFilm(cloneJsonValue(twoSceneMagicMoveFilmJson));
	mutate(film);
	applyFilm(film, { kind: 'deliverable' });
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'magic-move';
	compositionMeta.persistenceError = null;
}

/** The fixture with a plain fade, and a second Overlay shared by both Scenes. */
function openPlainFadeFilm(): void {
	openFilm((film) => {
		film.boundaries = [{ kind: 'fade', durationMs: 1000 }];
		for (const scene of film.scenes) {
			scene.state.overlays.push({ ...cloneJsonValue(scene.state.overlays[0]), id: 'speaker' });
		}
	});
}

const SPEAKER_PAIR: FilmMagicMovePair = {
	from: { kind: 'overlay', id: 'speaker' },
	to: { kind: 'overlay', id: 'speaker' }
};

beforeEach(() => {
	filmState.isSwappingScene = false;
	openPlainFadeFilm();
});

describe('the magic-move operations in the inventory', () => {
	it('are two motion rows on the boundary section: one read and one undoable write', () => {
		const rows = WEBMCP_OPERATION_INVENTORY.filter((row) => row.id.endsWith('magic-move'));

		expect(rows).toMatchObject([
			{
				id: 'motion.inspect-scene-boundary-magic-move',
				family: 'motion',
				effect: 'read',
				writes: [],
				precondition: 'film-window-boundary',
				requiresExpectedRevision: false,
				undoable: false,
				guiSurface: 'src/lib/platform/FilmSceneBoundarySection.svelte'
			},
			{
				id: 'motion.set-scene-boundary-magic-move',
				family: 'motion',
				effect: 'write',
				writes: ['/boundaries/*'],
				precondition: 'film-window-boundary',
				requiresExpectedRevision: true,
				undoable: true,
				focus: ['scene-boundary'],
				guiSurface: 'src/lib/platform/FilmSceneBoundarySection.svelte'
			}
		]);
	});

	it('are offered only while a boundary of the Film has a duration', () => {
		expect(readWebmcpCompositionPreconditions()['film-window-boundary']).toBe(true);

		openFilm((film) => {
			film.boundaries = [{ kind: 'cut' }];
		});
		expect(readWebmcpCompositionPreconditions()['film-window-boundary']).toBe(false);

		openPlainFadeFilm();
		filmState.isSwappingScene = true;
		expect(readWebmcpCompositionPreconditions()['film-window-boundary']).toBe(false);
		filmState.isSwappingScene = false;
	});
});

describe('motion.inspect-scene-boundary-magic-move', () => {
	it('reports the boundary, no pairs, the default ease, and every suggested pair', () => {
		const receipt = inspectMagicMove();

		expect(receipt).toMatchObject({
			operationId: 'motion.inspect-scene-boundary-magic-move',
			revision: compositionEditHistory.revision,
			outgoingSceneId: 'outro',
			incomingSceneId: 'brand-mark',
			kind: 'fade',
			durationMs: 1000,
			pairs: [],
			ease: 'smooth',
			suggestedPairs: [LOWER_THIRD_PAIR, SPEAKER_PAIR],
			suggestedPairTotal: 2,
			suggestedPairsTruncated: false,
			contentTrust: 'untrusted'
		});
		expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(WEBMCP_RESULT_CHARACTER_BUDGET);
	});

	it('reports the pairs and the ease a boundary carries', async () => {
		expectApplied(await setMagicMove({ pairs: [SPEAKER_PAIR], ease: 'sharp' }));

		expect(inspectMagicMove()).toMatchObject({ pairs: [SPEAKER_PAIR], ease: 'sharp' });
	});

	it('refuses a cut, the last Scene, and an unknown Scene', () => {
		expect(
			expectFailed(
				runInspectCompositionSceneBoundaryMagicMoveOperation({ outgoingSceneId: 'brand-mark' })
			).code
		).toBe('unknown_target');
		expect(
			expectFailed(
				runInspectCompositionSceneBoundaryMagicMoveOperation({ outgoingSceneId: 'nope' })
			)
		).toMatchObject({ code: 'unknown_target', alternatives: ['outro'] });

		openFilm((film) => {
			film.boundaries = [{ kind: 'cut' }];
		});
		expect(
			expectFailed(
				runInspectCompositionSceneBoundaryMagicMoveOperation({ outgoingSceneId: 'outro' })
			).code
		).toBe('precondition_unmet');
	});
});

describe('motion.set-scene-boundary-magic-move', () => {
	it('sets the pairs as one undoable Film-level edit, named in Film pointers', async () => {
		const revision = compositionEditHistory.revision;
		const before = snapshotOpenFilm();

		const receipt = expectApplied(await setMagicMove({ pairs: [LOWER_THIRD_PAIR] }));

		expect(boundary()).toEqual({
			kind: 'fade',
			durationMs: 1000,
			magicMove: { pairs: [LOWER_THIRD_PAIR] }
		});
		expect(receipt.operationId).toBe('motion.set-scene-boundary-magic-move');
		expect(compositionEditHistory.revision).toBe(revision + 1);
		expect(
			receipt.changed.pointers.every((pointer) => pointer.startsWith('/boundaries/0/magicMove'))
		).toBe(true);
		expect(receipt).not.toHaveProperty('sceneId');
		expect(receipt.focus).toEqual({ target: 'scene-boundary', boundaryIndex: 0 });
		expect(sceneBoundarySelection.boundaryIndex).toBe(0);
		expect(receipt.undoLabel).toBe('Carry 1 element across the boundary after Scene "outro"');

		runCompositionHistoryTransaction('undo', compositionEditHistory.revision);
		expect(snapshotOpenFilm()).toBe(before);
		runCompositionHistoryTransaction('redo', compositionEditHistory.revision);
		expect(boundary()).toHaveProperty('magicMove.pairs', [LOWER_THIRD_PAIR]);
	});

	it('replaces the whole list, in the order given, and keeps the ease', async () => {
		expectApplied(await setMagicMove({ pairs: [LOWER_THIRD_PAIR], ease: 'settled' }));

		expectApplied(await setMagicMove({ pairs: [SPEAKER_PAIR, LOWER_THIRD_PAIR] }));

		expect(boundary()).toHaveProperty('magicMove', {
			pairs: [SPEAKER_PAIR, LOWER_THIRD_PAIR],
			ease: 'settled'
		});

		expectApplied(await setMagicMove({ pairs: [SPEAKER_PAIR], ease: 'smooth' }));
		expect(boundary()).toHaveProperty('magicMove', { pairs: [SPEAKER_PAIR], ease: 'smooth' });
	});

	it('removes the magic move with an empty list, and can undo that', async () => {
		expectApplied(await setMagicMove({ pairs: [LOWER_THIRD_PAIR], ease: 'sharp' }));

		const receipt = expectApplied(await setMagicMove({ pairs: [] }));

		expect(boundary()).toEqual({ kind: 'fade', durationMs: 1000 });
		expect(receipt.undoLabel).toBe('Remove the magic move after Scene "outro"');
		runCompositionHistoryTransaction('undo', compositionEditHistory.revision);
		expect(boundary()).toHaveProperty('magicMove', { pairs: [LOWER_THIRD_PAIR], ease: 'sharp' });
	});

	it('refuses a stale revision and applies nothing', async () => {
		const before = snapshotOpenFilm();

		const failure = expectFailed(
			await runSetCompositionSceneBoundaryMagicMoveOperation({
				expectedRevision: compositionEditHistory.revision + 1,
				outgoingSceneId: 'outro',
				pairs: [LOWER_THIRD_PAIR]
			})
		);

		expect(failure.code).toBe('stale_revision');
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('refuses a cut, and arguments that do not add up', async () => {
		expect(expectFailed(await setMagicMove({ pairs: 'lower-third' })).code).toBe(
			'invalid_argument'
		);
		expect(expectFailed(await setMagicMove({ pairs: [], ease: 'smooth' })).code).toBe(
			'invalid_argument'
		);

		openFilm((film) => {
			film.boundaries = [{ kind: 'cut' }];
		});
		const failure = expectFailed(await setMagicMove({ pairs: [LOWER_THIRD_PAIR] }));
		expect(failure.code).toBe('precondition_unmet');
		expect(boundary()).toEqual({ kind: 'cut' });
	});

	it('reports a pair the format refuses at its Film pointer', async () => {
		const failure = expectFailed(
			await setMagicMove({
				pairs: [{ from: { kind: 'kinetic-word', id: 'a' }, to: LOWER_THIRD_PAIR.to }],
				ease: 'ease-in-out'
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings?.findings.map((finding) => finding.path)).toEqual(
			expect.arrayContaining([
				'/boundaries/0/magicMove/pairs/0/from/kind',
				'/boundaries/0/magicMove/ease'
			])
		);
		expect(boundary()).toEqual({ kind: 'fade', durationMs: 1000 });
	});

	it('reports a pair the Film cannot carry as a finding at the pair, and applies nothing', async () => {
		const failure = expectFailed(
			await setMagicMove({
				pairs: [{ from: { kind: 'overlay', id: 'missing' }, to: LOWER_THIRD_PAIR.to }]
			})
		);

		expect(failure.code).toBe('semantic_invalid');
		expect(failure.findings?.findings.map((finding) => finding.path)).toEqual([
			'/boundaries/0/magicMove/pairs/0/from/id'
		]);
		expect(boundary()).toEqual({ kind: 'fade', durationMs: 1000 });
	});

	it('refuses while a Scene swap has engine state in transit', async () => {
		filmState.isSwappingScene = true;

		expect(expectFailed(await setMagicMove({ pairs: [LOWER_THIRD_PAIR] })).code).toBe(
			'precondition_unmet'
		);
		filmState.isSwappingScene = false;
	});
});

describe('motion.set-scene-boundary on a boundary that carries a magic move', () => {
	beforeEach(async () => {
		expectApplied(await setMagicMove({ pairs: [LOWER_THIRD_PAIR], ease: 'sharp' }));
	});

	it('keeps the magic move when the boundary keeps a duration', async () => {
		expectApplied(
			await runSetCompositionSceneBoundaryOperation({
				expectedRevision: compositionEditHistory.revision,
				outgoingSceneId: 'outro',
				kind: 'fade',
				durationMs: 500
			})
		);
		expect(boundary()).toEqual({
			kind: 'fade',
			durationMs: 500,
			magicMove: { pairs: [LOWER_THIRD_PAIR], ease: 'sharp' }
		});

		expectApplied(
			await runSetCompositionSceneBoundaryOperation({
				expectedRevision: compositionEditHistory.revision,
				outgoingSceneId: 'outro',
				kind: 'mask-wipe'
			})
		);
		expect(boundary()).toMatchObject({
			kind: 'mask-wipe',
			durationMs: 500,
			magicMove: { pairs: [LOWER_THIRD_PAIR], ease: 'sharp' }
		});
	});

	it('drops the magic move when the boundary becomes a cut', async () => {
		expectApplied(
			await runSetCompositionSceneBoundaryOperation({
				expectedRevision: compositionEditHistory.revision,
				outgoingSceneId: 'outro',
				kind: 'cut'
			})
		);

		expect(boundary()).toEqual({ kind: 'cut' });
	});
});
