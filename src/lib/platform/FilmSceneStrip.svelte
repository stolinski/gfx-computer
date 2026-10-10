<script lang="ts">
	import { onDestroy } from 'svelte';

	import { compositionEditHistory } from './composition-edit-history';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import { compositionMeta } from './composition-meta.svelte';
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import {
		runSeekCompositionPlayheadOperation,
		type CompositionPlayheadSeekOutcome
	} from './composition-playhead-operations';
	import {
		runRemoveCompositionSceneOperation,
		runReorderCompositionSceneOperation,
		runSelectCompositionSceneOperation,
		type CompositionSceneSelectionOutcome
	} from './composition-scene-operations';
	import {
		filmFrameCount,
		filmSceneBoundaryOverlaps,
		filmSceneFrameCount,
		filmSceneFrameOffsets
	} from './film-playhead';
	import { moveCompositionWorkspaceFocus } from './composition-workspace-focus';
	import { filmSceneBoundaryKindLabel } from './film-scene-boundary-kind-label';
	import { filmSceneDisplayName } from './film-scene-display-name';
	import { readOpenFilmFrame } from './film-scene-selection';
	import { filmState, readOpenFilm } from './film-state.svelte';
	import { sceneBoundarySelection } from './selection.svelte';
	import FilmSceneStarterPicker from './FilmSceneStarterPicker.svelte';
	import { framesToSeconds, resolveFrameRate } from '$lib/utils/composition-timing';
	import { clampNumber } from '$lib/utils/math';

	// The Scene strip (ADR-0068 §10): the Scenes of the open Film in order, on
	// the Film clock, between the transport row and the Timeline. It is shown for
	// a stored Film, and for any open Film of more than one Scene, stored or not
	// (a legacy transition Preset opens as an unsaved two-Scene Film). A segment is as
	// wide as its Scene is long and starts on its Scene's first Film frame, so two
	// Scenes that share a boundary window overlap by that window. Clicking one opens that Scene at the Film frame
	// under the pointer; dragging one along the strip reorders it; the open
	// Scene's segment can be removed. Between two neighbouring segments is their
	// junction, the Scene boundary: the plain line of a cut, or the region the two
	// Scenes share for a fade or an effect. Selecting a junction opens the
	// boundary's fields in the inspector; a click inside its region also parks the
	// Film playhead on the frame under the pointer, which shows the exact frame.
	// The Timeline below keeps showing the open Scene on its own clock. An unsaved
	// one-Scene Starter has no strip: it is not a Film yet. `+` adds a Scene to a
	// stored Film only, as `composition.add-scene-from-starter` does.

	/** How far a press travels before it is a drag and not a click. */
	const SEGMENT_DRAG_THRESHOLD_PX = 4;

	interface SceneSegment {
		id: string;
		name: string;
		/** The Scene's start and length, as the strip states them. */
		timing: string;
		startFrame: number;
		frameCount: number;
		/** Frames this Scene shares with the one before it: the window of their boundary. */
		leadingOverlapFrames: number;
	}

	/** The boundary between two neighbouring Scenes, as the strip draws it. */
	interface SceneJunction {
		/** Index into the Film's boundaries: the boundary after Scene `boundaryIndex`. */
		boundaryIndex: number;
		/** What the junction is called: its kind and the two Scenes it sits between. */
		label: string;
		/** The first Film frame of the incoming Scene: where a cut falls and a window starts. */
		startFrame: number;
		/** Film frames the two Scenes share; 0 for a cut. */
		windowFrames: number;
	}

	const strip = $derived.by(() => {
		const film = readOpenFilm();
		const rate = resolveFrameRate(film.fps);
		const frameOffsets = filmSceneFrameOffsets(film);
		const overlapFrames = filmSceneBoundaryOverlaps(film);
		const segments: SceneSegment[] = film.scenes.map((scene, sceneIndex) => {
			const frameCount = filmSceneFrameCount(scene, rate);
			const startSeconds = Math.floor(framesToSeconds(frameOffsets[sceneIndex], rate));
			return {
				id: scene.id,
				name: filmSceneDisplayName(scene, sceneIndex),
				timing: `${Math.floor(startSeconds / 60)}:${String(startSeconds % 60).padStart(2, '0')} · ${framesToSeconds(frameCount, rate).toFixed(1)} s`,
				startFrame: frameOffsets[sceneIndex],
				frameCount,
				leadingOverlapFrames: sceneIndex === 0 ? 0 : overlapFrames[sceneIndex - 1]
			};
		});
		const junctions: SceneJunction[] = film.boundaries.map((boundary, boundaryIndex) => ({
			boundaryIndex,
			label: `${filmSceneBoundaryKindLabel(boundary.kind)} between ${segments[boundaryIndex].name} and ${segments[boundaryIndex + 1].name}`,
			startFrame: frameOffsets[boundaryIndex + 1],
			windowFrames: overlapFrames[boundaryIndex]
		}));
		return { segments, junctions, frameCount: filmFrameCount(film) };
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
		outcome:
			| CompositionOperationOutcome
			| CompositionSceneSelectionOutcome
			| CompositionPlayheadSeekOutcome
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

	async function selectJunction(event: MouseEvent, junction: SceneJunction): Promise<void> {
		moveCompositionWorkspaceFocus({
			target: 'scene-boundary',
			boundaryIndex: junction.boundaryIndex
		});
		// A pointer inside the region two Scenes share is on a Film frame: the
		// playhead parks there, and a paused playhead inside a window shows the
		// exact frame. A cut has no frames, and a keyboard activation no position.
		if (event.detail === 0 || junction.windowFrames === 0) return;
		reportFailure(
			await runSeekCompositionPlayheadOperation({
				frame: clampNumber(
					filmFrameAtClientX(event.clientX),
					junction.startFrame,
					junction.startFrame + junction.windowFrames - 1
				)
			})
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

	/**
	 * Move focus along the strip with the arrow keys, in the order the Film
	 * runs: a segment, the junction after it, the next segment. True when the key
	 * was an arrow.
	 */
	function moveStripFocus(event: KeyboardEvent): boolean {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
		const focusedEl = event.currentTarget as HTMLElement;
		const neighbour =
			event.key === 'ArrowLeft' ? focusedEl.previousElementSibling : focusedEl.nextElementSibling;
		if (
			neighbour instanceof HTMLButtonElement &&
			(neighbour.dataset.sceneId !== undefined || neighbour.dataset.boundaryIndex !== undefined)
		) {
			event.preventDefault();
			neighbour.focus();
		}
		return true;
	}

	function handleSegmentKeydown(event: KeyboardEvent, segment: SceneSegment): void {
		if (moveStripFocus(event)) return;
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

{#if compositionMeta.isUserComposition || strip.segments.length > 1}
	<div class="scene-strip" role="toolbar" aria-label="Scenes">
		<div class="scene-strip__track" bind:this={trackEl}>
			{#each strip.segments as segment, sceneIndex (segment.id)}
				{@const junction = strip.junctions[sceneIndex]}
				<button
					class="scene-strip__segment"
					class:is-dragging={drag?.isDragging === true && drag.sceneId === segment.id}
					type="button"
					title={segment.name}
					data-scene-id={segment.id}
					aria-pressed={segment.id === filmState.selectedSceneId}
					style:inline-size="{(segment.frameCount / strip.frameCount) * 100}%"
					style:margin-inline-start="{(-segment.leadingOverlapFrames / strip.frameCount) * 100}%"
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
				{#if junction}
					<button
						class="scene-strip__junction"
						class:is-cut={junction.windowFrames === 0}
						type="button"
						aria-label={junction.label}
						data-boundary-index={junction.boundaryIndex}
						aria-pressed={sceneBoundarySelection.boundaryIndex === junction.boundaryIndex}
						style:inset-inline-start="{(junction.startFrame / strip.frameCount) * 100}%"
						style:inline-size={junction.windowFrames === 0
							? null
							: `${(junction.windowFrames / strip.frameCount) * 100}%`}
						onclick={(event) => selectJunction(event, junction)}
						onkeydown={moveStripFocus}
					></button>
				{/if}
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
		{#if compositionMeta.isUserComposition}
			<FilmSceneStarterPicker />
		{/if}
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

	/* The junction between two segments: the Scene boundary. A boundary with a
	   duration covers the frames its two Scenes share, as a lighter band between
	   two hairlines. A cut shares none, so it is the segment's own end hairline
	   with a narrow target centred on it. Selection takes the open segment's
	   wash. */
	.scene-strip__junction {
		background: color-mix(in srgb, #ffffff 7%, transparent);
		border: 0;
		border-inline: 1px solid var(--chrome-hairline);
		box-sizing: border-box;
		cursor: pointer;
		inset-block: 0;
		padding: 0;
		position: absolute;
		transition: background 100ms ease;
	}

	.scene-strip__junction.is-cut {
		background: transparent;
		border-inline: 0;
		inline-size: 9px;
		translate: -50% 0;
	}

	.scene-strip__junction:hover {
		background: color-mix(in srgb, #ffffff 12%, transparent);
	}

	.scene-strip__junction[aria-pressed='true'] {
		background: color-mix(in srgb, #2de8ee 24%, transparent);
	}

	.scene-strip__junction:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: -2px;
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
