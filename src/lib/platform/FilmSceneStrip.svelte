<script lang="ts">
	import { onDestroy } from 'svelte';

	import { compositionEditHistory } from './composition-edit-history';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import { compositionMeta } from './composition-meta.svelte';
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import {
		runRemoveCompositionSceneOperation,
		runReorderCompositionSceneOperation,
		runSelectCompositionSceneOperation,
		type CompositionSceneSelectionOutcome
	} from './composition-scene-operations';
	import { filmFrameCount, filmSceneFrameCount, filmSceneFrameOffsets } from './film-playhead';
	import { filmSceneDisplayName } from './film-scene-display-name';
	import { readOpenFilmFrame } from './film-scene-selection';
	import { filmState, readOpenFilm } from './film-state.svelte';
	import FilmSceneStarterPicker from './FilmSceneStarterPicker.svelte';
	import { framesToSeconds, resolveFrameRate } from '$lib/utils/composition-timing';
	import { clampNumber } from '$lib/utils/math';

	// The Scene strip (ADR-0068 §10): the Scenes of a stored Film in order, on
	// the Film clock, between the transport row and the Timeline. A segment is as
	// wide as its Scene is long. Clicking one opens that Scene at the Film frame
	// under the pointer; dragging one along the strip reorders it; the open
	// Scene's segment can be removed. The Timeline below keeps showing the open
	// Scene on its own clock. An unsaved Starter has no strip: it is not a Film
	// yet.

	/** How far a press travels before it is a drag and not a click. */
	const SEGMENT_DRAG_THRESHOLD_PX = 4;

	interface SceneSegment {
		id: string;
		name: string;
		/** The Scene's start and length, as the strip states them. */
		timing: string;
		startFrame: number;
		frameCount: number;
	}

	const strip = $derived.by(() => {
		const film = readOpenFilm();
		const rate = resolveFrameRate(film.fps);
		const frameOffsets = filmSceneFrameOffsets(film);
		const segments: SceneSegment[] = film.scenes.map((scene, sceneIndex) => {
			const frameCount = filmSceneFrameCount(scene, rate);
			const startSeconds = Math.floor(framesToSeconds(frameOffsets[sceneIndex], rate));
			return {
				id: scene.id,
				name: filmSceneDisplayName(scene, sceneIndex),
				timing: `${Math.floor(startSeconds / 60)}:${String(startSeconds % 60).padStart(2, '0')} · ${framesToSeconds(frameCount, rate).toFixed(1)} s`,
				startFrame: frameOffsets[sceneIndex],
				frameCount
			};
		});
		return { segments, frameCount: filmFrameCount(film) };
	});

	const selectedSegment = $derived(
		strip.segments.find((segment) => segment.id === filmState.selectedSceneId)
	);

	let trackEl = $state<HTMLDivElement | null>(null);
	let drag = $state<{
		sceneId: string;
		startX: number;
		offsetX: number;
		isDragging: boolean;
	} | null>(null);
	// A drag ends in a click on the segment it started on; that click is not a selection.
	let suppressNextClick = false;

	function reportFailure(
		outcome: CompositionOperationOutcome | CompositionSceneSelectionOutcome
	): void {
		if (outcome.status === 'failed') {
			compositionMeta.persistenceError = describeCompositionOperationFailure(outcome);
		}
	}

	/** The Film frame under a pointer position, held inside the Film. */
	function filmFrameAtClientX(clientX: number): number {
		const rect = trackEl?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return 0;
		return clampNumber(
			Math.floor(((clientX - rect.left) / rect.width) * strip.frameCount),
			0,
			strip.frameCount - 1
		);
	}

	async function selectSegment(event: MouseEvent, segment: SceneSegment): Promise<void> {
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		// A keyboard activation has no pointer position (`detail` is 0): it opens
		// the Scene and leaves where its playhead goes to the operation.
		reportFailure(
			await runSelectCompositionSceneOperation(
				event.detail === 0
					? { sceneId: segment.id }
					: {
							sceneId: segment.id,
							sceneFrame: clampNumber(
								filmFrameAtClientX(event.clientX) - segment.startFrame,
								0,
								segment.frameCount - 1
							)
						}
			)
		);
	}

	async function removeSelectedScene(): Promise<void> {
		reportFailure(
			await runRemoveCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: filmState.selectedSceneId
			})
		);
	}

	function handleSegmentKeydown(event: KeyboardEvent, segment: SceneSegment): void {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			const segmentEl = event.currentTarget as HTMLElement;
			const neighbour =
				event.key === 'ArrowLeft' ? segmentEl.previousElementSibling : segmentEl.nextElementSibling;
			if (neighbour instanceof HTMLButtonElement && neighbour.dataset.sceneId !== undefined) {
				event.preventDefault();
				neighbour.focus();
			}
			return;
		}
		if (
			(event.key === 'Delete' || event.key === 'Backspace') &&
			segment.id === filmState.selectedSceneId &&
			strip.segments.length > 1
		) {
			event.preventDefault();
			event.stopPropagation();
			void removeSelectedScene();
		}
	}

	function handleSegmentPointerDown(event: PointerEvent, segment: SceneSegment): void {
		if (event.button !== 0 || strip.segments.length < 2) return;
		drag = { sceneId: segment.id, startX: event.clientX, offsetX: 0, isDragging: false };
		window.addEventListener('pointermove', handleDragMove);
		window.addEventListener('pointerup', handleDragEnd);
		window.addEventListener('pointercancel', handleDragCancel);
	}

	function handleDragMove(event: PointerEvent): void {
		if (!drag) return;
		const offsetX = event.clientX - drag.startX;
		drag = {
			...drag,
			offsetX,
			isDragging: drag.isDragging || Math.abs(offsetX) >= SEGMENT_DRAG_THRESHOLD_PX
		};
	}

	function releaseDrag(): void {
		drag = null;
		window.removeEventListener('pointermove', handleDragMove);
		window.removeEventListener('pointerup', handleDragEnd);
		window.removeEventListener('pointercancel', handleDragCancel);
	}

	function handleDragCancel(): void {
		releaseDrag();
	}

	onDestroy(releaseDrag);

	async function handleDragEnd(event: PointerEvent): Promise<void> {
		const ended = drag;
		releaseDrag();
		if (!ended?.isDragging) return;
		suppressNextClick = true;
		// The Scene lands where the pointer let go: at the place of the segment
		// under it.
		const dropFrame = filmFrameAtClientX(event.clientX);
		const toSceneIndex = strip.segments.findLastIndex((segment) => segment.startFrame <= dropFrame);
		reportFailure(
			await runReorderCompositionSceneOperation({
				expectedRevision: compositionEditHistory.revision,
				sceneId: ended.sceneId,
				toSceneIndex
			})
		);
	}
</script>

{#if compositionMeta.isUserComposition}
	<div class="scene-strip" role="toolbar" aria-label="Scenes">
		<div class="scene-strip__track" bind:this={trackEl}>
			{#each strip.segments as segment (segment.id)}
				<button
					class="scene-strip__segment"
					class:is-dragging={drag?.isDragging === true && drag.sceneId === segment.id}
					type="button"
					title={segment.name}
					data-scene-id={segment.id}
					aria-pressed={segment.id === filmState.selectedSceneId}
					style:inline-size="{(segment.frameCount / strip.frameCount) * 100}%"
					style:translate={drag?.isDragging === true && drag.sceneId === segment.id
						? `${drag.offsetX}px 0`
						: null}
					onclick={(event) => selectSegment(event, segment)}
					onkeydown={(event) => handleSegmentKeydown(event, segment)}
					onpointerdown={(event) => handleSegmentPointerDown(event, segment)}
				>
					<span class="scene-strip__name">{segment.name}</span>
					<span class="scene-strip__timing">{segment.timing}</span>
				</button>
			{/each}
			{#if selectedSegment && strip.segments.length > 1}
				<button
					class="scene-strip__remove"
					type="button"
					aria-label="Remove {selectedSegment.name}"
					style:inset-inline-start="{((selectedSegment.startFrame + selectedSegment.frameCount) /
						strip.frameCount) *
						100}%"
					onclick={removeSelectedScene}>×</button
				>
			{/if}
			<span
				class="scene-strip__playhead"
				aria-hidden="true"
				style:inset-inline-start="{(readOpenFilmFrame() / strip.frameCount) * 100}%"
			></span>
		</div>
		<FilmSceneStarterPicker />
	</div>
{/if}

<style>
	/* One thin deck row on the Film clock. It sits in the Timeline's first grid
	   row; the Timeline takes the rest (`.workspace__timeline`). */
	.scene-strip {
		background: var(--chrome-deck, #131315);
		block-size: 30px;
		border-block-end: 1px solid var(--chrome-hairline);
		display: flex;
		grid-row: 1;
		min-inline-size: 0;
	}

	.scene-strip__track {
		display: flex;
		flex: 1;
		min-inline-size: 0;
		position: relative;
	}

	/* A segment is a lane head laid on its side: the same deck tone, label
	   weights, and selection wash as a Timeline gutter row. The hairline at its
	   end is the Scene boundary. */
	.scene-strip__segment {
		align-items: baseline;
		background: transparent;
		border: 0;
		border-inline-end: 1px solid var(--chrome-hairline);
		box-sizing: border-box;
		color: var(--chrome-text);
		cursor: pointer;
		display: flex;
		flex: none;
		gap: 8px;
		min-inline-size: 0;
		overflow: hidden;
		padding: 0 10px;
		text-align: start;
		transition: background 100ms ease;
		user-select: none;
		white-space: nowrap;
	}

	.scene-strip__segment:hover {
		background: color-mix(in srgb, #ffffff 3%, var(--chrome-deck, #131315));
	}

	.scene-strip__segment[aria-pressed='true'] {
		background: color-mix(in srgb, #2de8ee 12%, var(--chrome-deck, #131315));
		/* Room for the remove control that rides the open segment's end. */
		padding-inline-end: 22px;
	}

	.scene-strip__segment:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: -2px;
	}

	.scene-strip__segment.is-dragging {
		cursor: grabbing;
		opacity: 0.85;
		transition: none;
		z-index: 1;
	}

	.scene-strip__name {
		font-size: 0.71875rem;
		font-weight: 550;
		line-height: 30px;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The timing gives way before the name does. */
	.scene-strip__timing {
		color: var(--chrome-muted);
		flex-shrink: 1000;
		font-family: 'Paper Mono', monospace;
		font-size: 0.5625rem;
		font-variant-numeric: tabular-nums;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The Timeline's lane remove control, riding the end of the open segment. */
	.scene-strip__remove {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font-size: 0.9rem;
		inset-block: 0;
		line-height: 1;
		padding: 0 6px;
		position: absolute;
		transition: color 100ms ease;
		translate: -100% 0;
	}

	.scene-strip__remove:hover {
		color: #e6322a;
	}

	.scene-strip__remove:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: -2px;
	}

	/* The Film playhead, in the transport cyan the Timeline's playhead uses. */
	.scene-strip__playhead {
		background: #2de8ee;
		inline-size: 1.5px;
		inset-block: 0;
		pointer-events: none;
		position: absolute;
		translate: -50% 0;
	}
</style>
