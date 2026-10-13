import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { compositionEditHistory } from './composition-edit-history';
import {
	runCompositionHistoryTransaction,
	type CompositionOperationOutcome,
	type CompositionOperationReceipt
} from './composition-edit-transaction';
import { runCreateCompositionFromStarterOperation } from './composition-lifecycle-operations';
import { compositionMeta } from './composition-meta.svelte';
import {
	runSetCompositionSceneBoundaryOperation,
	type SetCompositionSceneBoundaryRequest
} from './composition-scene-boundary-operations';
import { runAddCompositionSceneFromStarterOperation } from './composition-scene-operations';
import { filmToWireFormat } from './film-ingress';
import { filmFrameCount, filmSceneBoundaryOverlaps } from './film-playhead';
import { FILM_SCENE_BOUNDARY_KINDS, type FilmSceneBoundary } from './film-schema';
import { filmState, readOpenFilm } from './film-state.svelte';
import { inspectorRailMode } from './inspector-rail-mode.svelte';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
import { transitionEffectDefinitions } from './pipelines/transition-definition-registry';
import { layerSelection, sceneBoundarySelection, selectLayer } from './selection.svelte';
import { createTimelineTrackId } from './timeline-entity-identity';
import { userCompositionStore } from './user-composition-store';
import {
	WEBMCP_OPERATION_FAMILIES,
	WEBMCP_OPERATION_INVENTORY
} from './webmcp-operation-inventory';

import type { CompositionOperationFailure } from './composition-operation-preflight';

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

/** Starters of 6.7 s, 7 s, and 6 s: every Scene has room for a 1-second window on each side. */
const SCENE_STARTERS = ['lower-third', 'chapter-card-descent', 'counter-milestone'] as const;

function expectApplied(outcome: CompositionOperationOutcome): CompositionOperationReceipt {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error(`Expected a refusal but the operation answered ${outcome.status}.`);
	}
	return outcome;
}

function setBoundary(
	request: Omit<SetCompositionSceneBoundaryRequest, 'expectedRevision'>
): Promise<CompositionOperationOutcome> {
	return runSetCompositionSceneBoundaryOperation({
		expectedRevision: compositionEditHistory.revision,
		...request
	});
}

function snapshotOpenFilm(): string {
	return JSON.stringify(filmToWireFormat(readOpenFilm()));
}

function boundaries(): readonly FilmSceneBoundary[] {
	return readOpenFilm().boundaries;
}

beforeEach(async () => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
	sessionStore.loadUserComposition.mockResolvedValue(null);
	sessionStore.createUserComposition.mockResolvedValue(undefined);
	filmState.isSwappingScene = false;
	compositionMeta.persistenceError = null;

	// A stored Film of three Scenes, `scene-1` to `scene-3`, cut together.
	const created = await runCreateCompositionFromStarterOperation({
		starterSlug: SCENE_STARTERS[0]
	});
	if (created.status !== 'applied') throw new Error(created.message);
	for (const starterSlug of SCENE_STARTERS.slice(1)) {
		expectApplied(
			await runAddCompositionSceneFromStarterOperation({
				expectedRevision: compositionEditHistory.revision,
				starterSlug
			})
		);
	}
	expect(boundaries()).toEqual([{ kind: 'cut' }, { kind: 'cut' }]);
});

describe('motion.set-scene-boundary in the inventory', () => {
	const row = WEBMCP_OPERATION_INVENTORY.find((entry) => entry.id === 'motion.set-scene-boundary');

	it('is one motion row: an undoable write of one boundary, offered while the Film has two Scenes', () => {
		expect(row).toMatchObject({
			family: 'motion',
			toolName: 'gfx_motion_set_scene_boundary',
			effect: 'write',
			writes: ['/boundaries/*'],
			precondition: 'film-multi-scene',
			requiresExpectedRevision: true,
			undoable: true,
			focus: ['scene-boundary'],
			exposure: 'agent-tool'
		});
	});

	it('splits the boundary list between its two owners: membership and what each boundary is', () => {
		const ownerOf = (pointer: string): string[] =>
			WEBMCP_OPERATION_FAMILIES.filter((family) =>
				family.ownedPaths.some((path) => path.pointer === pointer)
			).map((family) => family.name);

		expect(ownerOf('/boundaries')).toEqual(['composition']);
		expect(ownerOf('/boundaries/*')).toEqual(['motion']);
	});
});

describe('motion.set-scene-boundary', () => {
	it('makes a cut a fade as one undoable Film-level edit, and names the boundary in Film pointers', async () => {
		const framesBefore = filmFrameCount(readOpenFilm());

		const receipt = expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'fade', durationMs: 1000 })
		);

		expect(boundaries()).toEqual([{ kind: 'fade', durationMs: 1000 }, { kind: 'cut' }]);
		expect(receipt.operationId).toBe('motion.set-scene-boundary');
		expect(receipt.revision).toBe(compositionEditHistory.revision);
		expect(receipt.changed).toEqual({
			pointers: ['/boundaries/0/kind', '/boundaries/0/durationMs'],
			total: 2,
			truncated: false
		});
		// A Film-level change names no Scene.
		expect(receipt).not.toHaveProperty('sceneId');
		expect(receipt.undoLabel).toBe('Set the boundary after Scene "scene-1" to fade');
		// The Film is one window shorter.
		expect(filmSceneBoundaryOverlaps(readOpenFilm())).toEqual([30, 0]);
		expect(filmFrameCount(readOpenFilm())).toBe(framesBefore - 30);
	});

	it('records one undo entry and advances the revision by one', async () => {
		const revision = compositionEditHistory.revision;
		const before = snapshotOpenFilm();

		expectApplied(await setBoundary({ outgoingSceneId: 'scene-2', kind: 'fade', durationMs: 500 }));

		expect(compositionEditHistory.revision).toBe(revision + 1);
		expect(boundaries()[1]).toEqual({ kind: 'fade', durationMs: 500 });

		runCompositionHistoryTransaction('undo', compositionEditHistory.revision);
		expect(snapshotOpenFilm()).toBe(before);
		runCompositionHistoryTransaction('redo', compositionEditHistory.revision);
		expect(boundaries()[1]).toEqual({ kind: 'fade', durationMs: 500 });
	});

	it('moves the Workspace focus to the boundary it set', async () => {
		selectLayer(createTimelineTrackId({ kind: 'surface' }));
		inspectorRailMode.switchToMedia();

		const receipt = expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-2', kind: 'fade', durationMs: 500 })
		);

		expect(receipt.focus).toEqual({ target: 'scene-boundary', boundaryIndex: 1 });
		expect(sceneBoundarySelection.boundaryIndex).toBe(1);
		expect(layerSelection.id).toBeNull();
		expect(inspectorRailMode.mode).toBe('inspector');
	});

	it.each(transitionEffectDefinitions())(
		'sets a $type boundary with the effect defaults, and loads its renderer first',
		async (definition) => {
			expectApplied(
				await setBoundary({ outgoingSceneId: 'scene-1', kind: definition.type, durationMs: 800 })
			);

			expect(boundaries()[0]).toEqual({
				kind: definition.type,
				durationMs: 800,
				params: definition.defaults().params
			});
			expect(pipelineRendererRuntime.current().transitions.has(definition.type)).toBe(true);
		}
	);

	it('keeps the duration when only the kind is set, and takes the new effect defaults', async () => {
		expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'fade', durationMs: 1000 })
		);

		expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'seeded-shatter', params: { seed: 7 } })
		);

		expect(boundaries()[0]).toMatchObject({
			kind: 'seeded-shatter',
			durationMs: 1000,
			params: { seed: 7, columns: 14 }
		});
	});

	it('sets one param of the same effect and keeps the others as they were', async () => {
		expectApplied(
			await setBoundary({
				outgoingSceneId: 'scene-1',
				kind: 'seeded-shatter',
				durationMs: 1000,
				params: { seed: 7, columns: 20 }
			})
		);

		const receipt = expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'seeded-shatter', params: { seed: 9 } })
		);

		expect(boundaries()[0]).toMatchObject({ durationMs: 1000, params: { seed: 9, columns: 20 } });
		expect(receipt.changed.pointers).toEqual(['/boundaries/0/params/seed']);
	});

	it('does not carry one effect params into another', async () => {
		expectApplied(
			await setBoundary({
				outgoingSceneId: 'scene-1',
				kind: 'mask-wipe',
				durationMs: 1000,
				params: { direction: 'up' }
			})
		);

		expectApplied(await setBoundary({ outgoingSceneId: 'scene-1', kind: 'sheet-peel' }));

		// Both effects have a `direction`; the peel takes its own default, not the wipe's.
		expect(boundaries()[0]).toMatchObject({ kind: 'sheet-peel', params: { direction: 'right' } });
	});

	it('makes a boundary a cut again', async () => {
		expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'fade', durationMs: 1000 })
		);

		expectApplied(await setBoundary({ outgoingSceneId: 'scene-1', kind: 'cut' }));

		expect(boundaries()).toEqual([{ kind: 'cut' }, { kind: 'cut' }]);
	});

	it('refuses a stale revision and applies nothing', async () => {
		const before = snapshotOpenFilm();

		const failure = expectFailed(
			await runSetCompositionSceneBoundaryOperation({
				expectedRevision: compositionEditHistory.revision - 1,
				outgoingSceneId: 'scene-1',
				kind: 'fade',
				durationMs: 1000
			})
		);

		expect(failure.code).toBe('stale_revision');
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('refuses the last Scene and an unknown Scene, naming the Scenes a boundary follows', async () => {
		for (const outgoingSceneId of ['scene-3', 'no-such-scene']) {
			const failure = expectFailed(await setBoundary({ outgoingSceneId, kind: 'cut' }));

			expect(failure.code).toBe('unknown_target');
			expect(failure.rejected).toBe(outgoingSceneId);
			expect(failure.alternatives).toEqual(['scene-1', 'scene-2']);
		}
	});

	it('refuses a kind that is not registered, naming every kind', async () => {
		const failure = expectFailed(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'star-wipe', durationMs: 500 })
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('star-wipe');
		expect(failure.alternatives).toEqual([...FILM_SCENE_BOUNDARY_KINDS]);
	});

	it('refuses arguments the kind does not take', async () => {
		const refusals: readonly Omit<SetCompositionSceneBoundaryRequest, 'expectedRevision'>[] = [
			{ outgoingSceneId: 'scene-1', kind: 'cut', durationMs: 500 },
			{ outgoingSceneId: 'scene-1', kind: 'cut', params: {} },
			{ outgoingSceneId: 'scene-1', kind: 'fade', durationMs: 500, params: {} },
			{ outgoingSceneId: 'scene-1', kind: 'mask-wipe', durationMs: 500, params: 'right' },
			// A cut has no duration to keep.
			{ outgoingSceneId: 'scene-1', kind: 'fade' }
		];
		const before = snapshotOpenFilm();

		for (const request of refusals) {
			expect(expectFailed(await setBoundary(request)).code).toBe('invalid_argument');
		}
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('reports a param the effect does not accept at its Film pointer', async () => {
		const failure = expectFailed(
			await setBoundary({
				outgoingSceneId: 'scene-2',
				kind: 'seeded-shatter',
				durationMs: 500,
				params: { columns: 400 }
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.findings.map((finding) => finding.path)).toEqual([
			'/boundaries/1/params/columns'
		]);
		expect(boundaries()[1]).toEqual({ kind: 'cut' });
	});

	it('reports a window its Scenes have no room for as a finding at the boundary duration', async () => {
		// Shorter than one frame at 30 fps, and longer than either Scene.
		const durations = [10, 60_000];
		const before = snapshotOpenFilm();

		for (const durationMs of durations) {
			const failure = expectFailed(
				await setBoundary({ outgoingSceneId: 'scene-1', kind: 'fade', durationMs })
			);

			expect(failure.code).toBe('semantic_invalid');
			expect(failure.findings.findings[0].path).toBe('/boundaries/0/durationMs');
			// A receipt bounds a finding's message; it still names the boundary.
			expect(failure.findings.findings[0].message).toMatch(/^The fade between Scene "scene-1"/);
		}
		expect(snapshotOpenFilm()).toBe(before);
	});

	it('refuses two windows that would meet inside the Scene between them', async () => {
		// The middle Scene runs 7 s: 4 s and 4 s of window do not fit in it.
		expectApplied(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'fade', durationMs: 4000 })
		);

		const failure = expectFailed(
			await setBoundary({ outgoingSceneId: 'scene-2', kind: 'fade', durationMs: 4000 })
		);

		expect(failure.code).toBe('semantic_invalid');
		expect(failure.findings.findings[0].path).toBe('/boundaries/1/durationMs');
		expect(boundaries()[1]).toEqual({ kind: 'cut' });
	});

	it('refuses while a Scene swap has engine state in transit', async () => {
		filmState.isSwappingScene = true;

		const failure = expectFailed(
			await setBoundary({ outgoingSceneId: 'scene-1', kind: 'fade', durationMs: 1000 })
		);
		filmState.isSwappingScene = false;

		expect(failure.code).toBe('precondition_unmet');
		expect(boundaries()[0]).toEqual({ kind: 'cut' });
	});
});
