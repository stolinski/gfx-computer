<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';

	import {
		captureCompositionGestureOrigin,
		recordCompositionGestureEdit
	} from './composition-edit-transaction';
	import type { Preset } from './engine-schema';
	import {
		clearKeyframeSelection,
		keyframeSelection,
		selectKeyframe,
		selectLayer,
		selectSoundRailReference,
		deselectLayer
	} from './selection.svelte';
	import {
		createKeyframeSelectionId,
		parseKeyframeSelectionId,
		type TimelineTrackId
	} from './timeline-entity-identity';
	import { lockedLaneIds } from './timeline-lane-locks.svelte';
	import type { Timeline } from './timeline.svelte';
	import {
		isVideoTimelineTrack,
		type ClipKeyframe,
		type TimelineTrack,
		type TimelineTransition
	} from './timeline-track';
	import CascadeTethers from './CascadeTethers.svelte';
	import { compositionEditHistory } from './composition-edit-history';
	import { runSetCompositionMotionBeatOperation } from './composition-motion-beat-operations';
	import { engineState } from './engine-state.svelte';
	import {
		findMotionBeatSnap,
		motionBeatAtMsForFrame,
		moveMotionBeat
	} from '$lib/utils/motion-beats';
	import { resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';
	import TimelineAddMenu from './TimelineAddMenu.svelte';
	import TimelineClipBar, {
		type TimelineClipDragMode,
		type TimelineClipKeyframeDragTarget
	} from './TimelineClipBar.svelte';
	import TimelineGutterRow from './TimelineGutterRow.svelte';
	import VideoTimelineTrack from './VideoTimelineTrack.svelte';
	import {
		resolveUnifiedDrag,
		resolveWindowClipDrag,
		type UnifiedDragMode,
		type UnifiedDragOrigin
	} from '$lib/utils/timeline-clip';
	import { formatClockTime } from '$lib/utils/composition-timing';

	interface Props {
		timeline: Timeline;
		tracks: TimelineTrack[];
	}

	let { timeline, tracks }: Props = $props();

	// ─── Track area drag state ──────────────────────────────────────────────────

	// Every editing drag carries the open composition as it stood at press, so
	// the release can record one undo entry for whatever the drag wrote
	// (ADR-0060 §6) — the writers on the transitions mutate live state directly.
	interface TransitionDragState {
		kind: 'transition';
		trackId: TimelineTrackId;
		transitionId: string;
		label: string;
		mode: TimelineClipDragMode;
		origin: { start: number; duration: number };
		/** Captured at drag start for unified bars; absent for simple window clips. */
		unifiedOrigin?: UnifiedDragOrigin;
		pointerStartX: number;
		containerWidth: number;
		document: Preset | null;
	}

	interface SeekDragState {
		kind: 'seek';
		containerWidth: number;
		containerLeft: number;
	}

	// A keyframe diamond drag (ADR-0035 §7): retimes ONE keyframe's atMs through
	// the transition's write-through retimer. A press without a real move is a
	// SELECT: the playhead seeks to the keyframe (DaVinci behaviour).
	interface KeyframeDragState {
		kind: 'keyframe';
		trackId: TimelineTrackId;
		transitionId: string;
		channel: string;
		index: number;
		originFraction: number;
		pointerStartX: number;
		containerWidth: number;
		moved: boolean;
		document: Preset | null;
	}

	// A Motion Beat flag drag (ADR-0064): previews the move live on the beat and
	// its bound keys, frame-snapped, then commits one motion operation on
	// release. A press without a move seeks to the beat.
	interface BeatDragState {
		kind: 'beat';
		beatId: string;
		originAtMs: number;
		pointerStartX: number;
		containerWidth: number;
		moved: boolean;
	}

	type DragState = TransitionDragState | SeekDragState | KeyframeDragState | BeatDragState;

	const motionBeats = $derived(engineState.motionBeats ?? []);
	// Drags snap to a beat within this many pixels.
	const BEAT_SNAP_PX = 8;

	function beatSnapThresholdMs(containerWidth: number): number {
		return containerWidth > 0
			? (BEAT_SNAP_PX / containerWidth) * timeline.durationSeconds * 1000
			: 0;
	}

	/** A fraction snapped to the nearest beat within reach, and that beat. */
	function snapFractionToBeat(
		fraction: number,
		containerWidth: number
	): { fraction: number; beatId: string | null } {
		const durationMs = timeline.durationSeconds * 1000;
		if (durationMs <= 0) return { fraction, beatId: null };
		const beat = findMotionBeatSnap(
			fraction * durationMs,
			motionBeats,
			beatSnapThresholdMs(containerWidth)
		);
		return beat
			? { fraction: beat.atMs / durationMs, beatId: beat.id }
			: { fraction, beatId: null };
	}

	// DOM references for the two scroll-synced row areas. The track column itself
	// remains the seek surface and playhead positioning context.
	let gutterBodyEl: HTMLDivElement | null = null;
	let trackAreaEl: HTMLDivElement | null = null;
	let dragState: DragState | null = null;

	function attachGutterBody(element: HTMLDivElement): () => void {
		gutterBodyEl = element;
		return () => {
			if (gutterBodyEl === element) gutterBodyEl = null;
		};
	}

	function attachTrackArea(element: HTMLDivElement): () => void {
		trackAreaEl = element;
		return () => {
			if (trackAreaEl === element) trackAreaEl = null;
		};
	}

	const playheadFraction = $derived(
		timeline.durationSeconds > 0 ? timeline.time / timeline.durationSeconds : 0
	);

	// ─── Row model ──────────────────────────────────────────────────────────────
	// The timeline is a flat NLE table: one 36px row per track, plus one 46px
	// automation sub-lane per keyframed channel of the SELECTED clip (its value
	// curve with draggable diamonds). Both columns render the same row sequence,
	// so scrollTop sync keeps row N pinned to lane N.

	const LANE_ROW_HEIGHT = 36;
	const AUTOMATION_ROW_HEIGHT = 46;

	interface TrackRow {
		kind: 'track';
		rowKey: string;
		track: TimelineTrack;
	}

	interface AutomationRow {
		kind: 'automation';
		rowKey: string;
		track: TimelineTrack;
		transition: TimelineTransition;
		channel: string;
		keyframes: ClipKeyframe[];
	}

	type OutlineRow = TrackRow | AutomationRow;

	const outlineRows = $derived.by(() => {
		const rows: OutlineRow[] = [];
		for (const track of tracks) {
			rows.push({ kind: 'track', rowKey: track.id, track });
			const selection = timeline.selection;
			if (!selection || selection.trackId !== track.id) continue;
			const transition = track.transitions.find(
				(candidate) => candidate.id === selection.transitionId
			);
			if (!transition?.keyframes?.length) continue;
			const byChannel = new SvelteMap<string, ClipKeyframe[]>();
			for (const keyframe of transition.keyframes) {
				const bucket = byChannel.get(keyframe.channel);
				if (bucket) bucket.push(keyframe);
				else byChannel.set(keyframe.channel, [keyframe]);
			}
			for (const [channel, keyframes] of byChannel) {
				rows.push({
					kind: 'automation',
					rowKey: `${track.id}::${transition.id}::${channel}`,
					track,
					transition,
					channel,
					keyframes
				});
			}
		}
		return rows;
	});

	// Row-centre offsets for the cascade tethers, prefix-summed over real row
	// heights (sub-lanes shift everything below them).
	const rowCenterYByTrackId = $derived.by(() => {
		const centers = new SvelteMap<string, number>();
		let offsetY = 0;
		for (const row of outlineRows) {
			const height = row.kind === 'track' ? LANE_ROW_HEIGHT : AUTOMATION_ROW_HEIGHT;
			if (row.kind === 'track') centers.set(row.track.id, offsetY + height / 2);
			offsetY += height;
		}
		return centers;
	});

	const rowsContentHeight = $derived(
		outlineRows.reduce(
			(total, row) => total + (row.kind === 'track' ? LANE_ROW_HEIGHT : AUTOMATION_ROW_HEIGHT),
			0
		)
	);

	// The sub-lane's curve geometry: x is percent of the clip span, y percent of
	// the sub-lane (top-padded), normalized over the channel's value range.
	function automationPoints(
		row: AutomationRow
	): { keyframe: ClipKeyframe; x: number; y: number }[] {
		const { transition, keyframes } = row;
		const values = keyframes.map((keyframe) => keyframe.value);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min;
		return keyframes.map((keyframe) => ({
			keyframe,
			x:
				transition.duration > 0
					? ((keyframe.fraction - transition.start) / transition.duration) * 100
					: 0,
			y: span > 0 ? 82 - ((keyframe.value - min) / span) * 64 : 50
		}));
	}

	// ─── Ruler scale ─────────────────────────────────────────────────────────────
	// Labeled seconds at a step that keeps labels readable at any duration, with
	// finer unlabeled ticks between them.

	const rulerStepSeconds = $derived.by(() => {
		const duration = timeline.durationSeconds;
		if (duration <= 8) return 1;
		if (duration <= 16) return 2;
		if (duration <= 45) return 5;
		return 10;
	});

	const rulerSeconds = $derived.by(() => {
		const duration = timeline.durationSeconds;
		if (duration <= 0) return [];
		const seconds: number[] = [];
		// Stop early enough that the last label never clips the right edge.
		for (let second = 0; second <= duration - rulerStepSeconds * 0.35; second += rulerStepSeconds) {
			seconds.push(second);
		}
		return seconds;
	});

	// Minor tick spacing as a fraction of the strip: quarter-seconds while the
	// label step is 1s, whole seconds otherwise.
	const rulerTickPercent = $derived.by(() => {
		const duration = timeline.durationSeconds;
		if (duration <= 0) return 10;
		const minorStep = rulerStepSeconds === 1 ? 0.25 : 1;
		return (100 * minorStep) / duration;
	});

	function formatRulerSecond(totalSeconds: number): string {
		const m = Math.floor(totalSeconds / 60);
		const s = totalSeconds % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	// ─── Scroll sync ─────────────────────────────────────────────────────────────
	// gutterBodyEl and trackAreaEl share identical grid structures (ruler + rows
	// with gap:4px, grid-auto-rows:28px), so syncing scrollTop keeps them aligned.

	let suppressGutterScroll = false;
	let suppressTrackScroll = false;

	function onGutterScroll(event: Event): void {
		if (suppressGutterScroll) return;
		suppressTrackScroll = true;
		if (trackAreaEl) trackAreaEl.scrollTop = (event.target as HTMLElement).scrollTop;
		suppressTrackScroll = false;
	}

	function onTrackScroll(event: Event): void {
		if (suppressTrackScroll) return;
		suppressGutterScroll = true;
		if (gutterBodyEl) gutterBodyEl.scrollTop = (event.target as HTMLElement).scrollTop;
		suppressGutterScroll = false;
	}

	// ─── Track area drag ────────────────────────────────────────────────────────

	function clampFraction(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	function getTrackAreaRect(): { width: number; left: number } | null {
		if (!trackAreaEl) return null;
		const rect = trackAreaEl.getBoundingClientRect();
		return { width: rect.width, left: rect.left };
	}

	function applyTransitionDrag(state: TransitionDragState, event: PointerEvent): void {
		const track = tracks.find((c) => c.id === state.trackId);
		const transition = track?.transitions.find((c) => c.id === state.transitionId);
		if (!transition) return;

		const delta = (event.clientX - state.pointerStartX) / state.containerWidth;

		// Unified clip bar: resolve the dragged handle into new enter/exit ramps and
		// persist each through its writer (ADR-0034 §2a).
		if (state.unifiedOrigin && transition.unified) {
			const result = resolveUnifiedDrag(state.mode as UnifiedDragMode, delta, state.unifiedOrigin);
			if (result.enter) transition.unified.setEnter?.(result.enter.start, result.enter.duration);
			if (result.exit) transition.unified.setExit?.(result.exit.start, result.exit.duration);
			return;
		}

		// Simple window clip (stagger / roll / dwell …): move + trim left/right.
		if (!transition.onUpdate) return;
		transition.onUpdate(
			resolveWindowClipDrag(state.mode as 'move' | 'left' | 'right', delta, state.origin, {
				minStart: transition.minStart ?? 0,
				maxStart: transition.maxStart ?? 1,
				minDuration: transition.minDuration ?? 0.02,
				maxDuration: transition.maxDuration ?? 1
			})
		);
	}

	function applySeekDrag(state: SeekDragState, event: PointerEvent): void {
		const fraction = clampFraction(
			(event.clientX - state.containerLeft) / state.containerWidth,
			0,
			1
		);
		timeline.seek(
			snapFractionToBeat(fraction, state.containerWidth).fraction * timeline.durationSeconds
		);
	}

	function applyKeyframeDrag(state: KeyframeDragState, event: PointerEvent): void {
		const track = tracks.find((c) => c.id === state.trackId);
		const transition = track?.transitions.find((c) => c.id === state.transitionId);
		if (!transition?.onKeyframeRetime) return;
		const delta = (event.clientX - state.pointerStartX) / state.containerWidth;
		// Sub-pixel jitter is a click, not a retime.
		if (!state.moved && Math.abs(delta) < 0.0005) return;
		state.moved = true;
		const snapped = snapFractionToBeat(state.originFraction + delta, state.containerWidth);
		transition.onKeyframeRetime(state.channel, state.index, snapped.fraction, snapped.beatId);
	}

	function beatAtMsForPointer(state: BeatDragState, event: PointerEvent): number {
		const durationMs = timeline.durationSeconds * 1000;
		const deltaMs = ((event.clientX - state.pointerStartX) / state.containerWidth) * durationMs;
		const rate = resolveFrameRate(engineState.transport.fps);
		const atMs = clampFraction(state.originAtMs + deltaMs, 0, durationMs);
		return motionBeatAtMsForFrame(secondsToFrames(atMs / 1000, rate), rate);
	}

	function applyBeatDrag(state: BeatDragState, event: PointerEvent): void {
		if (!state.moved && Math.abs(event.clientX - state.pointerStartX) < 2) return;
		state.moved = true;
		// A position that would reorder a bound key is skipped; the beat holds
		// its last valid place.
		moveMotionBeat(engineState, state.beatId, beatAtMsForPointer(state, event));
	}

	async function commitBeatDrag(state: BeatDragState): Promise<void> {
		const beat = motionBeats.find((entry) => entry.id === state.beatId);
		if (!beat) return;
		const target = beat.atMs;
		moveMotionBeat(engineState, state.beatId, state.originAtMs);
		if (target === state.originAtMs) return;
		await runSetCompositionMotionBeatOperation({
			expectedRevision: compositionEditHistory.revision,
			beatId: state.beatId,
			atMs: target
		});
	}

	function startBeatDrag(event: PointerEvent, beatId: string, atMs: number): void {
		if (event.button !== 0) return;
		const rect = getTrackAreaRect();
		if (!rect) return;
		event.preventDefault();
		event.stopPropagation();
		dragState = {
			kind: 'beat',
			beatId,
			originAtMs: atMs,
			pointerStartX: event.clientX,
			containerWidth: rect.width,
			moved: false
		};
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!dragState) return;
		if (dragState.kind === 'transition') {
			applyTransitionDrag(dragState, event);
		} else if (dragState.kind === 'keyframe') {
			applyKeyframeDrag(dragState, event);
		} else if (dragState.kind === 'beat') {
			applyBeatDrag(dragState, event);
		} else {
			applySeekDrag(dragState, event);
		}
	}

	function handlePointerUp(): void {
		// A keyframe press that never became a drag SEEKS to the keyframe — the
		// diamond is a navigation target as much as a handle.
		if (dragState?.kind === 'keyframe' && !dragState.moved) {
			timeline.seek(dragState.originFraction * timeline.durationSeconds);
		}
		// One undo entry per editing gesture; a press that moved nothing records none.
		if (dragState?.kind === 'transition') {
			recordCompositionGestureEdit(`Retime ${dragState.label}`, dragState.document);
		} else if (dragState?.kind === 'keyframe' && dragState.moved) {
			recordCompositionGestureEdit('Move keyframe', dragState.document);
		} else if (dragState?.kind === 'beat') {
			if (dragState.moved) void commitBeatDrag(dragState);
			else timeline.seek(dragState.originAtMs / 1000);
		}
		dragState = null;
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
	}

	function startTransitionDrag(
		event: PointerEvent,
		track: TimelineTrack,
		transition: TimelineTransition,
		mode: TimelineClipDragMode
	): void {
		if (event.button !== 0) return;
		const rect = getTrackAreaRect();
		if (!rect) return;
		event.preventDefault();
		event.stopPropagation();
		// Sound-rail cues focus individually in the sidebar (ADR-0033 §9); every
		// other lane selects its Layer.
		if (transition.soundReference) {
			selectSoundRailReference(transition.soundReference);
		} else {
			selectLayer(track.id);
		}
		timeline.selectTransition(track.id, transition.id);
		// A locked lane still selects — lock guards edits, not inspection.
		if (lockedLaneIds.has(track.id)) return;
		const u = transition.unified;
		dragState = {
			kind: 'transition',
			trackId: track.id,
			transitionId: transition.id,
			label: track.label,
			mode,
			origin: { start: transition.start, duration: transition.duration },
			unifiedOrigin: u
				? {
						enterStart: u.enterStart,
						enterDuration: u.enterDuration,
						exitStart: u.exitStart,
						exitDuration: u.exitDuration,
						enterLandFrac: u.enterLandFrac,
						exitLandFrac: u.exitLandFrac
					}
				: undefined,
			pointerStartX: event.clientX,
			containerWidth: rect.width,
			document: captureCompositionGestureOrigin()
		};
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	}

	function startKeyframeDrag(
		event: PointerEvent,
		track: TimelineTrack,
		transition: TimelineTransition,
		keyframe: TimelineClipKeyframeDragTarget
	): void {
		if (event.button !== 0) return;
		const rect = getTrackAreaRect();
		if (!rect) return;
		event.preventDefault();
		event.stopPropagation();
		selectLayer(track.id);
		selectKeyframe(track.id, keyframe.channel, keyframe.index);
		// Locked lane: the diamond still selects + seeks (navigation), never retimes.
		if (lockedLaneIds.has(track.id)) {
			timeline.seek(keyframe.fraction * timeline.durationSeconds);
			return;
		}
		dragState = {
			kind: 'keyframe',
			trackId: track.id,
			transitionId: transition.id,
			channel: keyframe.channel,
			index: keyframe.index,
			originFraction: keyframe.fraction,
			pointerStartX: event.clientX,
			containerWidth: rect.width,
			moved: false,
			document: captureCompositionGestureOrigin()
		};
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	}

	function startSeekDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		const rect = getTrackAreaRect();
		if (!rect) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('.track-transition, [data-video-timeline-clip]')) return;
		event.preventDefault();
		deselectLayer();
		timeline.clearSelection();
		dragState = {
			kind: 'seek',
			containerWidth: rect.width,
			containerLeft: rect.left
		};
		applySeekDrag(dragState, event);
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	}

	// Delete/Backspace removes the selected keyframe diamond — unless the user
	// is typing in a field. The writer lives on the transition (buildTracks).
	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Delete' && event.key !== 'Backspace') return;
		const key = keyframeSelection.id;
		if (!key) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'SELECT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable)
		) {
			return;
		}
		const identity = parseKeyframeSelectionId(key);
		if (!identity) return;
		const track = tracks.find((t) => t.id === identity.trackId);
		const transition = track?.transitions.find((t) => t.onKeyframeDelete !== undefined);
		if (!transition?.onKeyframeDelete) return;
		event.preventDefault();
		const origin = captureCompositionGestureOrigin();
		transition.onKeyframeDelete(identity.channel, identity.index);
		recordCompositionGestureEdit('Delete keyframe', origin);
		clearKeyframeSelection();
	}

	onDestroy(() => {
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="outline">
	<!-- LEFT: gutter column — header strip / scrollable rows / add footer -->
	<div class="outline__gutter-col">
		<!-- Empty corner: holds the gutter's share of the top strip so layer rows
		     align with the track lanes (the back/name breadcrumb lives above the
		     canvas, not in the layers panel). -->
		<div class="gutter__corner" aria-hidden="true"></div>

		<!-- Scrollable rows — scroll-synced with the track lanes; row N aligns
		     with lane N because both bodies start below the shared top strip. -->
		<div
			class="outline__gutter"
			{@attach attachGutterBody}
			onscroll={onGutterScroll}
			role="presentation"
		>
			{#each outlineRows as row (row.rowKey)}
				{#if row.kind === 'track'}
					<TimelineGutterRow track={row.track} />
				{:else}
					<div class="gutter__subrow">└ {row.channel}</div>
				{/if}
			{/each}
		</div>

		<TimelineAddMenu />
	</div>

	<!-- RIGHT: track column — ruler strip / scrollable lanes / playhead -->
	<div class="outline__track-col" onpointerdown={startSeekDrag} role="presentation">
		<div class="track-ruler" aria-hidden="true" style:--tick-step="{rulerTickPercent}%">
			{#each rulerSeconds as second (second)}
				<span class="track-ruler__label" style:left="{(second / timeline.durationSeconds) * 100}%">
					{formatRulerSecond(second)}
				</span>
			{/each}
		</div>

		<div
			class="outline__tracks"
			{@attach attachTrackArea}
			onscroll={onTrackScroll}
			role="presentation"
		>
			<CascadeTethers
				{tracks}
				rowCenterY={rowCenterYByTrackId}
				contentBlockSize={rowsContentHeight}
			/>
			{#each outlineRows as row (row.rowKey)}
				{#if row.kind === 'track'}
					{#if isVideoTimelineTrack(row.track)}
						<VideoTimelineTrack track={row.track} {timeline} />
					{:else}
						<div class="track-lane">
							{#each row.track.transitions as transition (transition.id)}
								<TimelineClipBar
									track={row.track}
									{transition}
									{timeline}
									onstartdrag={startTransitionDrag}
									onstartkeyframedrag={startKeyframeDrag}
								/>
							{/each}
						</div>
					{/if}
				{:else}
					<div class="automation-lane" style:--automation-color={row.track.color ?? '#7d93b2'}>
						<div
							class="automation-lane__span"
							style:left="{row.transition.start * 100}%"
							style:width="{row.transition.duration * 100}%"
						>
							<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
								<polyline
									points={automationPoints(row)
										.map((point) => `${point.x},${point.y}`)
										.join(' ')}
									vector-effect="non-scaling-stroke"
								/>
							</svg>
							{#each automationPoints(row) as point (point.keyframe.index)}
								<button
									aria-label="Retime {row.channel} keyframe {point.keyframe.index + 1}"
									class="automation-key"
									class:automation-key--selected={keyframeSelection.id ===
										createKeyframeSelectionId(row.track.id, row.channel, point.keyframe.index)}
									style:left="{point.x}%"
									style:top="{point.y}%"
									onpointerdown={(event) =>
										startKeyframeDrag(event, row.track, row.transition, point.keyframe)}
									type="button"
								></button>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>

		{#if timeline.durationSeconds > 0}
			{#each motionBeats as beat (beat.id)}
				<div
					class="track-beat"
					style:left="{(beat.atMs / (timeline.durationSeconds * 1000)) * 100}%"
				>
					<button
						class="track-beat__flag"
						type="button"
						data-motion-beat={beat.id}
						aria-label="Motion Beat {beat.id} at {beat.atMs} ms"
						title="{beat.id} · {beat.atMs} ms"
						onpointerdown={(event) => startBeatDrag(event, beat.id, beat.atMs)}>{beat.id}</button
					>
				</div>
			{/each}
		{/if}

		<div class="track-playhead" style:left="{playheadFraction * 100}%">
			<span class="track-playhead__flag">{formatClockTime(timeline.time)}</span>
		</div>
	</div>
</div>

<style>
	/* ── Shell ── */

	.outline {
		/* Shared top-strip height: the gutter header and the track ruler are both
		   --strip-h tall, so the rows body and lanes body start at the same Y and
		   row N aligns with lane N. Rows are a flat table — every row sizes itself
		   (36px lanes, 46px automation sub-lanes) identically in both columns. */
		--strip-h: 28px;
		--lane-row-h: 35px;
		--automation-row-h: 45px;
		--lane-hairline: #1a1a1e;
		block-size: 100%;
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		overflow: hidden;
	}

	/* ── Gutter column: header strip / scrollable rows / add footer ── */

	.outline__gutter-col {
		border-inline-end: 1px solid var(--chrome-hairline);
		display: grid;
		grid-template-rows: var(--strip-h) minmax(0, 1fr) auto;
		min-block-size: 0;
		overflow: hidden;
	}

	/* Deck-toned top-strip corner — offsets the rows by --strip-h so they line
	   up with the lanes; the hairline continues the ruler's strip band. */
	.gutter__corner {
		background: var(--chrome-deck, #131315);
		border-block-end: 1px solid var(--chrome-hairline);
	}

	/* Scrollable rows: block flow with self-sized rows, mirroring
	   .outline__tracks exactly so scrollTop sync keeps each row on its lane. */
	.outline__gutter {
		min-block-size: 0;
		overflow-y: auto;
	}

	/* Automation sub-lane's head: the channel word, engraved and right-aligned
	   toward its lane. */
	.gutter__subrow {
		align-items: center;
		background: var(--chrome-deck, #131315);
		block-size: var(--automation-row-h);
		border-block-end: 1px solid var(--lane-hairline);
		color: var(--chrome-muted);
		display: flex;
		font-family: 'Paper Mono', monospace;
		font-size: 0.53rem;
		font-weight: var(--fw-semibold);
		justify-content: flex-end;
		letter-spacing: 0.14em;
		padding-inline-end: 10px;
		text-transform: uppercase;
	}

	/* ── Track column: ruler strip / scrollable lanes / playhead ── */

	.outline__track-col {
		cursor: pointer;
		display: grid;
		grid-template-rows: var(--strip-h) minmax(0, 1fr);
		min-block-size: 0;
		overflow: hidden;
		position: relative;
		touch-action: none;
	}

	/* Lanes mirror .outline__gutter exactly so scrollTop sync keeps each lane
	   pinned to its gutter row. */
	.outline__tracks {
		min-block-size: 0;
		overflow-x: hidden;
		overflow-y: auto;
		position: relative;
	}

	/* The selected clip's value curve, spanning exactly the clip's window. */
	.automation-lane {
		block-size: var(--automation-row-h);
		border-block-end: 1px solid var(--lane-hairline);
		position: relative;
	}

	.automation-lane__span {
		background: color-mix(in srgb, var(--automation-color) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--automation-color) 22%, transparent);
		border-radius: 4px;
		inset-block: 4px;
		position: absolute;
	}

	.automation-lane__span svg {
		block-size: 100%;
		inline-size: 100%;
		inset: 0;
		position: absolute;
	}

	.automation-lane__span polyline {
		fill: none;
		stroke: var(--automation-color);
		stroke-width: 1.5;
	}

	/* Diamond keys on the curve — same grammar as the clip-bar diamonds and the
	   inspector's ◆: transport cyan, drag to retime, press to seek. */
	.automation-key {
		background: #2de8ee;
		block-size: 8px;
		border: 0;
		border-radius: 1px;
		cursor: ew-resize;
		inline-size: 8px;
		padding: 0;
		position: absolute;
		touch-action: none;
		transform: translate(-50%, -50%) rotate(45deg);
	}

	.automation-key--selected {
		box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.65);
		transform: translate(-50%, -50%) rotate(45deg) scale(1.3);
	}

	/* A ruler that earns the name: labeled seconds over short minor ticks pinned
	   to the strip's bottom edge, on the deck band. --tick-step is the
	   minor-tick spacing as a fraction of the composition, set inline. */
	.track-ruler {
		background-color: var(--chrome-deck, #131315);
		background-image: repeating-linear-gradient(
			to right,
			var(--chrome-hairline) 0 1px,
			transparent 1px var(--tick-step, 10%)
		);
		background-position: bottom;
		background-repeat: no-repeat;
		background-size: 100% 8px;
		block-size: 100%;
		border-block-end: 1px solid var(--chrome-hairline);
		overflow: hidden;
		position: relative;
	}

	.track-ruler__label {
		color: var(--chrome-muted, #8a8a90);
		font-family: 'Paper Mono', monospace;
		font-size: 0.5625rem;
		font-variant-numeric: tabular-nums;
		font-weight: 400;
		inset-block-start: 4px;
		position: absolute;
		transform: translateX(4px);
	}

	.track-lane {
		block-size: var(--lane-row-h);
		border-block-end: 1px solid var(--lane-hairline);
		position: relative;
	}

	/* A Motion Beat: a dotted guide through every lane and a draggable flag in
	   the ruler strip, in the warm marker tone so it never reads as the
	   playhead. */
	.track-beat {
		block-size: 100%;
		border-inline-start: 1px dashed color-mix(in srgb, #f2b33d 55%, transparent);
		inline-size: 0;
		inset-block: 0;
		pointer-events: none;
		position: absolute;
	}

	.track-beat__flag {
		background: #f2b33d;
		border: 0;
		border-radius: 0 3px 3px 0;
		color: #2a1c02;
		cursor: ew-resize;
		font-family: 'Paper Mono', monospace;
		font-size: 0.5rem;
		font-weight: 700;
		inset-block-start: 15px;
		line-height: 1;
		padding: 2px 4px;
		pointer-events: auto;
		position: absolute;
		white-space: nowrap;
	}

	.track-playhead {
		background: #2de8ee;
		block-size: 100%;
		inline-size: 1.5px;
		inset-block: 0;
		pointer-events: none;
		position: absolute;
		transform: translateX(-50%);
	}

	/* The playhead states its timecode — a flag riding the line inside the ruler
	   strip, in the transport cyan. */
	.track-playhead__flag {
		background: #2de8ee;
		border-radius: 3px 3px 3px 0;
		color: #062b2e;
		font-family: 'Paper Mono', monospace;
		font-size: 0.56rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		inset-block-start: 4px;
		inset-inline-start: 1px;
		line-height: 1;
		padding: 3px 5px;
		position: absolute;
		transform: translateX(-50%);
		white-space: nowrap;
	}
</style>
