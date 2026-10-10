<script lang="ts">
	import { compositionEditHistory } from './composition-edit-history';
	import { compositionMeta } from './composition-meta.svelte';
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import {
		runSetCompositionSceneBoundaryOperation,
		type SetCompositionSceneBoundaryRequest
	} from './composition-scene-boundary-operations';
	import { filmSceneBoundaryKindLabel } from './film-scene-boundary-kind-label';
	import { FILM_SCENE_BOUNDARY_KINDS, isFilmTransitionEffectBoundary } from './film-schema';
	import { filmState } from './film-state.svelte';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { sceneBoundarySelection } from './selection.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import { cloneJsonValue } from '$lib/utils/json-clone';

	// The Scene boundary selected on the Scene strip (ADR-0068 §4, §10): its
	// kind, its duration, and a transition effect's own editor. Every change runs
	// `motion.set-scene-boundary`, the operation an agent's tool runs.

	/** How long a cut lasts when it is first made a fade or an effect. */
	const NEW_WINDOW_DURATION_MS = 1000;

	type SceneBoundaryEdit = Omit<SetCompositionSceneBoundaryRequest, 'expectedRevision'>;

	const selected = $derived.by(() => {
		const { boundaryIndex } = sceneBoundarySelection;
		if (boundaryIndex === null) return null;
		const boundary = filmState.boundaries[boundaryIndex];
		const outgoingScene = filmState.scenes[boundaryIndex];
		return boundary && outgoingScene ? { boundary, outgoingSceneId: outgoingScene.id } : null;
	});

	// Raised when an edit is refused, so every field is made again from the
	// boundary the Film still holds instead of keeping the value it refused.
	let refusedEditCount = $state(0);

	// An effect's editor writes into the params it is handed, so it is handed a
	// copy; the copy becomes the boundary's params only through the operation.
	const effectParams = $derived.by(() => {
		void refusedEditCount;
		return selected && isFilmTransitionEffectBoundary(selected.boundary)
			? cloneJsonValue(selected.boundary.params)
			: null;
	});

	const EffectEditor = $derived(
		selected && isFilmTransitionEffectBoundary(selected.boundary)
			? (pipelineRendererRuntime.current().transitions.get(selected.boundary.kind)?.Editor ?? null)
			: null
	);

	// One edit runs at a time, and the latest one asked for while it runs is the
	// next: an operation is refused while the canvas is rendering the boundary's
	// exact frame, so a value set meanwhile waits for it instead of being lost.
	let waitingEdit: SceneBoundaryEdit | null = null;
	let isApplyingEdit = false;

	async function applyEdit(edit: SceneBoundaryEdit): Promise<void> {
		waitingEdit = edit;
		if (isApplyingEdit) return;
		isApplyingEdit = true;
		try {
			while (waitingEdit !== null) {
				const next = waitingEdit;
				waitingEdit = null;
				const outcome = await runSetCompositionSceneBoundaryOperation({
					expectedRevision: compositionEditHistory.revision,
					...next
				});
				if (outcome.status === 'failed') {
					compositionMeta.persistenceError = describeCompositionOperationFailure(outcome);
					refusedEditCount += 1;
				}
			}
		} finally {
			isApplyingEdit = false;
		}
	}

	function reportUnexpectedFailure(cause: unknown): void {
		console.error('The Scene boundary could not be set.', cause);
	}

	function setKind(event: Event): void {
		if (!selected) return;
		const kind = (event.currentTarget as HTMLSelectElement).value;
		applyEdit({
			outgoingSceneId: selected.outgoingSceneId,
			kind,
			...(selected.boundary.kind === 'cut' && kind !== 'cut'
				? { durationMs: NEW_WINDOW_DURATION_MS }
				: {})
		}).catch(reportUnexpectedFailure);
	}

	function setDuration(event: Event): void {
		if (!selected) return;
		applyEdit({
			outgoingSceneId: selected.outgoingSceneId,
			kind: selected.boundary.kind,
			durationMs: Number((event.currentTarget as HTMLInputElement).value)
		}).catch(reportUnexpectedFailure);
	}

	function setEffectParams(): void {
		if (!selected || effectParams === null) return;
		applyEdit({
			outgoingSceneId: selected.outgoingSceneId,
			kind: selected.boundary.kind,
			params: cloneJsonValue(effectParams)
		}).catch(reportUnexpectedFailure);
	}
</script>

{#if selected}
	<InspectorSection label="Boundary" summary={filmSceneBoundaryKindLabel(selected.boundary.kind)}>
		{#key refusedEditCount}
			<Field label="Kind">
				<select value={selected.boundary.kind} onchange={setKind}>
					{#each FILM_SCENE_BOUNDARY_KINDS as kind (kind)}
						<option value={kind}>{filmSceneBoundaryKindLabel(kind)}</option>
					{/each}
				</select>
			</Field>
			{#if selected.boundary.kind !== 'cut'}
				<Field label="Duration">
					<input
						type="number"
						min="1"
						step="10"
						value={selected.boundary.durationMs}
						onchange={setDuration}
					/>
					<span class="ins-unit">ms</span>
				</Field>
			{/if}
			{#if EffectEditor && effectParams !== null}
				<EffectEditor params={effectParams} onchange={setEffectParams} />
			{/if}
		{/key}
	</InspectorSection>
{/if}
