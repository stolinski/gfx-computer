<script lang="ts">
	import { onDestroy, untrack } from 'svelte';

	import {
		framesToSeconds,
		resolveFrameRate,
		secondsToFrames
	} from '$lib/utils/composition-timing';
	import {
		createVideoClipDragOrigin,
		type VideoClipDragMode,
		type VideoClipDragOrigin
	} from '$lib/utils/video-clip-edit';

	import {
		captureCompositionGestureOrigin,
		recordCompositionGestureEdit
	} from './composition-edit-transaction';
	import { compositionMediaInspection } from './composition-media-inspection.svelte';
	import type { Media, Preset, VideoClip } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import { inspectorRailMode } from './inspector-rail-mode.svelte';
	import { MEDIA_LIBRARY_ASSET_MIME } from './media-library-drag-transfer';
	import { layerSelection, selectVideoClip } from './selection.svelte';
	import { lockedLaneIds } from './timeline-lane-locks.svelte';
	import type { Timeline } from './timeline.svelte';
	import type {
		VideoTimelineClip,
		VideoTimelineTrack as VideoTimelineTrackModel
	} from './timeline-track';
	import {
		formatVideoTimelineSourceRange,
		resolveVideoTimelineDrop,
		resolveVideoTimelinePointerEdit,
		snapshotVideoTimelineClips
	} from './video-timeline-authoring';

	interface Props {
		track: VideoTimelineTrackModel;
		timeline: Timeline;
	}

	interface VideoClipPointerDragState {
		pointerId: number;
		captureElement: HTMLElement;
		originMedia: Media;
		clipId: string;
		mode: VideoClipDragMode;
		origin: VideoClipDragOrigin;
		pointerStartX: number;
		laneWidth: number;
		originalClips: VideoClip[];
		currentClip: VideoClip;
		/** The open composition at press, for the one undo entry the release records (ADR-0060 §6). */
		originDocument: Preset | null;
	}

	let { track, timeline }: Props = $props();
	let pointerDrag = $state.raw<VideoClipPointerDragState | null>(null);
	const frameRate = $derived(resolveFrameRate(engineState.transport.fps));
	const compositionFrameCount = $derived(
		Math.max(1, secondsToFrames(engineState.transport.durationSeconds, frameRate))
	);

	// Clip/asset membership is reactive; inspection is an external async cache.
	function ensureReferencedVideoAssetMetadata(): void {
		const referencedAssetIds = new Set(track.clips.map((clip) => clip.assetId));
		const assetUrls = new Set(
			engineState.media.assets
				.filter((asset) => referencedAssetIds.has(asset.id))
				.map((asset) => asset.assetUrl)
		);
		untrack(() => {
			for (const assetUrl of assetUrls) void compositionMediaInspection.ensure(assetUrl);
		});
	}

	$effect(ensureReferencedVideoAssetMetadata);

	function selectClip(clip: VideoTimelineClip): void {
		selectVideoClip(clip.clipId);
		inspectorRailMode.switchToInspector();
		const asset = engineState.media.assets.find((candidate) => candidate.id === clip.assetId);
		if (asset && compositionMediaInspection.read(asset.assetUrl).status !== 'ready') {
			void compositionMediaInspection.ensure(asset.assetUrl);
		}
	}

	function currentPlayheadFrame(): number {
		return Math.min(compositionFrameCount, Math.max(0, secondsToFrames(timeline.time, frameRate)));
	}

	function removePointerListeners(): void {
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerCancel);
	}

	function finishPointerDrag(shouldRollback: boolean): void {
		const state = pointerDrag;
		if (!state) return;
		const isOriginMediaActive = engineState.media === state.originMedia;
		pointerDrag = null;
		removePointerListeners();
		if (shouldRollback && isOriginMediaActive) {
			state.originMedia.videoTrack.clips = snapshotVideoTimelineClips(state.originalClips);
		} else if (isOriginMediaActive) {
			recordCompositionGestureEdit('Retime video clip', state.originDocument);
		}
		if (state.captureElement.hasPointerCapture(state.pointerId)) {
			state.captureElement.releasePointerCapture(state.pointerId);
		}
	}

	function handlePointerMove(event: PointerEvent): void {
		const state = pointerDrag;
		if (!state || event.pointerId !== state.pointerId) return;
		if (event.buttons === 0) {
			finishPointerDrag(false);
			return;
		}
		event.preventDefault();
		if (engineState.media !== state.originMedia) {
			finishPointerDrag(false);
			return;
		}
		const result = resolveVideoTimelinePointerEdit({
			clips: state.originalClips,
			origin: state.origin,
			mode: state.mode,
			pointerStartX: state.pointerStartX,
			pointerClientX: event.clientX,
			laneWidth: state.laneWidth,
			playheadFrame: currentPlayheadFrame()
		});
		state.originMedia.videoTrack.clips = result.clips;
		pointerDrag = { ...state, currentClip: result.clip };
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
		finishPointerDrag(false);
	}

	function handlePointerCancel(event: PointerEvent): void {
		if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
		finishPointerDrag(true);
	}

	function startClipPointerDrag(
		event: PointerEvent,
		clip: VideoTimelineClip,
		mode: VideoClipDragMode
	): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectClip(clip);
		// A locked lane still selects — lock guards edits, not inspection.
		if (lockedLaneIds.has(track.id)) return;
		const asset = engineState.media.assets.find((candidate) => candidate.id === clip.assetId);
		if (!asset) return;
		const inspection = compositionMediaInspection.read(asset.assetUrl);
		if (inspection.status !== 'ready' && mode !== 'move') return;

		if (pointerDrag) finishPointerDrag(false);
		const captureElement = event.currentTarget as HTMLElement;
		const laneElement = captureElement.closest<HTMLElement>('.video-timeline-lane');
		if (!laneElement) return;
		const laneRect = laneElement.getBoundingClientRect();
		if (laneRect.width <= 0) return;
		const originMedia = engineState.media;
		const originalClips = snapshotVideoTimelineClips(originMedia.videoTrack.clips);
		const canonicalClip = originalClips.find((candidate) => candidate.id === clip.clipId);
		if (!canonicalClip) {
			throw new Error(`Video timeline clip "${clip.clipId}" does not exist in the drag snapshot.`);
		}
		const sourceDurationSeconds =
			inspection.status === 'ready'
				? inspection.metadata.durationSeconds
				: canonicalClip.sourceStartSeconds +
					framesToSeconds(canonicalClip.durationFrames, frameRate);
		const origin = createVideoClipDragOrigin({
			clips: originalClips,
			clipId: clip.clipId,
			compositionFrameCount,
			sourceDurationSeconds,
			frameRate
		});
		pointerDrag = {
			pointerId: event.pointerId,
			captureElement,
			originMedia,
			clipId: clip.clipId,
			mode,
			origin,
			pointerStartX: event.clientX,
			laneWidth: laneRect.width,
			originalClips,
			currentClip: { ...origin.clip, audio: { ...origin.clip.audio } },
			originDocument: captureCompositionGestureOrigin()
		};
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerCancel);
		captureElement.setPointerCapture(event.pointerId);
	}

	function startClipInteriorDrag(event: PointerEvent, clip: VideoTimelineClip): void {
		startClipPointerDrag(event, clip, event.altKey ? 'slip' : 'move');
	}

	function handleDragOver(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes(MEDIA_LIBRARY_ASSET_MIME)) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = 'copy';
	}

	function handleDrop(event: DragEvent): void {
		if (!event.dataTransfer) return;
		event.preventDefault();
		event.stopPropagation();
		const laneElement = event.currentTarget as HTMLElement;
		const laneRect = laneElement.getBoundingClientRect();
		if (laneRect.width <= 0) return;
		const result = resolveVideoTimelineDrop({
			dataTransfer: event.dataTransfer,
			assets: engineState.media.assets,
			clips: engineState.media.videoTrack.clips,
			readInspection: (assetUrl) => compositionMediaInspection.read(assetUrl),
			pointerClientX: event.clientX,
			lane: { left: laneRect.left, width: laneRect.width },
			compositionFrameCount,
			playheadFrame: currentPlayheadFrame(),
			frameRate
		});
		if (result.status === 'metadata-not-ready') {
			void compositionMediaInspection.ensure(result.asset.assetUrl);
			return;
		}
		if (result.status !== 'created') return;
		engineState.media.videoTrack.clips = result.clips;
		selectVideoClip(result.selectedClipId);
		inspectorRailMode.switchToInspector();
	}

	onDestroy(() => finishPointerDrag(true));
</script>

<div
	class="video-timeline-lane"
	role="group"
	aria-label="Video timeline track"
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
	{#each track.clips as clip (clip.clipId)}
		{@const activeClip = pointerDrag?.clipId === clip.clipId ? pointerDrag.currentClip : null}
		{@const isSlipping = pointerDrag?.clipId === clip.clipId && pointerDrag.mode === 'slip'}
		<div
			class="video-timeline-clip"
			class:video-timeline-clip--selected={layerSelection.id === clip.id}
			data-video-timeline-clip
			style:left="{(clip.timelineStartFrame / compositionFrameCount) * 100}%"
			style:width="{(clip.durationFrames / compositionFrameCount) * 100}%"
		>
			<button
				class="video-timeline-clip__handle video-timeline-clip__handle--left"
				type="button"
				aria-label={`Trim ${clip.label} video clip start`}
				onpointerdown={(event) => startClipPointerDrag(event, clip, 'trim-left')}
				onclick={() => selectClip(clip)}
			></button>
			<button
				class="video-timeline-clip__body"
				type="button"
				aria-label={`Move ${clip.label} video clip. Hold Alt or Option to slip source.`}
				aria-pressed={layerSelection.id === clip.id}
				onpointerdown={(event) => startClipInteriorDrag(event, clip)}
				onclick={() => selectClip(clip)}
			>
				<span class:video-timeline-clip__source={isSlipping}>
					{isSlipping && activeClip
						? formatVideoTimelineSourceRange(activeClip, frameRate)
						: `${clip.label} · ${framesToSeconds(clip.durationFrames, frameRate).toFixed(1)} s`}
				</span>
			</button>
			<button
				class="video-timeline-clip__handle video-timeline-clip__handle--right"
				type="button"
				aria-label={`Trim ${clip.label} video clip end`}
				onpointerdown={(event) => startClipPointerDrag(event, clip, 'trim-right')}
				onclick={() => selectClip(clip)}
			></button>
		</div>
	{/each}
</div>

<style>
	.video-timeline-lane {
		block-size: var(--lane-row-h, 36px);
		border-block-end: 1px solid var(--lane-hairline, #1a1a1e);
		position: relative;
	}

	/* Media clips read as filmstrip — a neutral slab with sprocket bands top and
	   bottom, light text. Kind color stays out of the way of the layer palette. */
	.video-timeline-clip {
		background:
			repeating-linear-gradient(to right, rgb(0 0 0 / 0.4) 0 3px, transparent 3px 11px) top /
				100% 4px no-repeat,
			repeating-linear-gradient(to right, rgb(0 0 0 / 0.4) 0 3px, transparent 3px 11px) bottom /
				100% 4px no-repeat,
			#33363e;
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.4);
		color: #dcdce2;
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 500;
		inset-block: 5px;
		min-inline-size: 1px;
		position: absolute;
		touch-action: none;
	}

	.video-timeline-clip--selected {
		box-shadow:
			inset 0 0 0 1px rgb(0 0 0 / 0.4),
			0 0 0 1.5px #2de8ee;
	}

	.video-timeline-clip__body {
		align-items: center;
		background: transparent;
		block-size: 100%;
		border: 1px solid transparent;
		border-radius: 4px;
		color: inherit;
		cursor: grab;
		display: flex;
		font: inherit;
		inline-size: 100%;
		justify-content: center;
		overflow: hidden;
		padding-inline: 10px;
		touch-action: none;
		transition:
			border-color 100ms ease,
			opacity 100ms ease;
	}

	.video-timeline-clip__body:hover {
		opacity: 0.88;
	}

	.video-timeline-clip__body:focus-visible {
		border-color: #e8e8ea;
		outline: none;
	}

	.video-timeline-clip__body:active {
		cursor: grabbing;
	}

	.video-timeline-clip__body span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.video-timeline-clip__source {
		font-family: 'Paper Mono', monospace;
		font-weight: 600;
	}

	.video-timeline-clip__handle {
		background: transparent;
		block-size: 100%;
		border: 0 solid transparent;
		cursor: ew-resize;
		inline-size: 8px;
		inset-block: 0;
		padding: 0;
		position: absolute;
		touch-action: none;
		transition:
			border-color 100ms ease,
			opacity 100ms ease;
		z-index: 1;
	}

	.video-timeline-clip__handle:hover,
	.video-timeline-clip__handle:focus-visible {
		border-color: rgb(232 232 234 / 0.65);
		opacity: 0.78;
		outline: none;
	}

	.video-timeline-clip__handle--left {
		border-inline-end-width: 1px;
		inset-inline-start: 0;
	}

	.video-timeline-clip__handle--right {
		border-inline-start-width: 1px;
		inset-inline-end: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.video-timeline-clip__body,
		.video-timeline-clip__handle {
			transition-duration: 0ms;
		}
	}
</style>
