<script lang="ts" module>
	// Simple window clips use `left`/`right`/`move`; unified bars use the five
	// `trim-start`/`enter-zone`/`move`/`exit-zone`/`trim-end` handles (ADR-0034 §2a).
	export type TimelineClipDragMode = 'move' | 'left' | 'right' | UnifiedDragMode;

	export interface TimelineClipKeyframeDragTarget {
		channel: string;
		index: number;
		fraction: number;
	}
</script>

<script lang="ts">
	import { keyframeSelection } from './selection.svelte';
	import SoundClipWaveform from './SoundClipWaveform.svelte';
	import { createKeyframeSelectionId } from './timeline-entity-identity';
	import type { Timeline } from './timeline.svelte';
	import type { TimelineTrack, TimelineTransition } from './timeline-track';
	import type { UnifiedDragMode } from '$lib/utils/timeline-clip';

	// One clip bar on a lane: trim/zone handles, the label, and its keyframe
	// diamonds. Drag resolution lives in the outline (it owns the shared drag
	// state machine); this component reports drag starts.
	interface Props {
		track: TimelineTrack;
		transition: TimelineTransition;
		timeline: Timeline;
		onstartdrag: (
			event: PointerEvent,
			track: TimelineTrack,
			transition: TimelineTransition,
			mode: TimelineClipDragMode
		) => void;
		onstartkeyframedrag: (
			event: PointerEvent,
			track: TimelineTrack,
			transition: TimelineTransition,
			keyframe: TimelineClipKeyframeDragTarget
		) => void;
	}

	let { track, transition, timeline, onstartdrag, onstartkeyframedrag }: Props = $props();

	const isUnified = $derived(transition.unified !== undefined);
	const hasEnter = $derived(transition.unified?.enterStart !== undefined);
	const hasExit = $derived(transition.unified?.exitStart !== undefined);
	// enterZone / exitZone are the PERCEIVED ramp widths (ADR-0034 §2a):
	// computeUnifiedBar has already collapsed each ease's invisible tail,
	// so the standard ramp gradient + handles land on real motion edges.
	const enterPct = $derived((transition.enterZone ?? 0) * 100);
	const exitPct = $derived((transition.exitZone ?? 0) * 100);
	const label = $derived(transition.label ?? track.label);

	const isSelected = $derived(
		timeline.selection !== null &&
			timeline.selection.trackId === track.id &&
			timeline.selection.transitionId === transition.id
	);

	const playheadFraction = $derived(
		timeline.durationSeconds > 0 ? timeline.time / timeline.durationSeconds : 0
	);

	// A diamond is "at the playhead" within half a frame — same tolerance the
	// inspector's ◆ toggle uses, so both light together.
	const halfFrameFraction = $derived(
		timeline.durationSeconds > 0 && timeline.fps > 0
			? 0.5 / (timeline.fps * timeline.durationSeconds)
			: 0
	);

	interface ClipHandle {
		key: string;
		className: string;
		aria: string;
		mode: TimelineClipDragMode;
		inlineStyle?: string;
	}

	// Handles before the label: the left trim, then the enter-zone adjuster.
	const leadingHandles = $derived.by(() => {
		const handles: ClipHandle[] = [];
		if (isUnified ? hasEnter : transition.onUpdate !== undefined) {
			handles.push({
				key: 'left',
				className: 'track-handle--left',
				aria: `Trim ${label} start`,
				mode: isUnified ? 'trim-start' : 'left'
			});
		}
		if (isUnified && hasEnter && enterPct > 0) {
			handles.push({
				key: 'enter-zone',
				className: 'track-handle--enter-zone',
				aria: `Adjust ${label} enter fade`,
				mode: 'enter-zone',
				inlineStyle: `left: ${enterPct}%`
			});
		}
		return handles;
	});

	// Handles after the keyframes: the exit-zone adjuster, then the right trim.
	const trailingHandles = $derived.by(() => {
		const handles: ClipHandle[] = [];
		if (isUnified && hasExit && exitPct > 0) {
			handles.push({
				key: 'exit-zone',
				className: 'track-handle--exit-zone',
				aria: `Adjust ${label} exit fade`,
				mode: 'exit-zone',
				inlineStyle: `right: ${exitPct}%`
			});
		}
		if (isUnified ? hasExit : transition.onUpdate !== undefined) {
			handles.push({
				key: 'right',
				className: 'track-handle--right',
				aria: `Trim ${label} end`,
				mode: isUnified ? 'trim-end' : 'right'
			});
		}
		return handles;
	});
</script>

<div
	class="track-transition"
	class:track-transition--unified={isUnified}
	class:track-transition--selected={isSelected}
	class:track-transition--audio={transition.soundAssetSlug !== undefined}
	class:track-transition--ramp-in={!isUnified &&
		transition.ramp === 'in' &&
		transition.soundAssetSlug === undefined}
	class:track-transition--ramp-out={!isUnified && transition.ramp === 'out'}
	onpointerdown={(event) => onstartdrag(event, track, transition, 'move')}
	role="presentation"
	style:--track-color={transition.color ?? track.color ?? 'var(--chrome-muted)'}
	style:--enter-pct="{enterPct}%"
	style:--exit-pct="{exitPct}%"
	style:left="{transition.start * 100}%"
	style:width="{transition.duration * 100}%"
>
	{#each leadingHandles as handle (handle.key)}
		<button
			aria-label={handle.aria}
			class="track-handle {handle.className}"
			style={handle.inlineStyle}
			onpointerdown={(event) => onstartdrag(event, track, transition, handle.mode)}
			type="button"
		></button>
	{/each}
	{#if transition.soundAssetSlug !== undefined}
		<span class="track-cue-name">{label}</span>
		<SoundClipWaveform slug={transition.soundAssetSlug} />
	{:else}
		<span class="track-label">{label}</span>
	{/if}
	{#each transition.keyframes ?? [] as keyframe (`${keyframe.channel}:${keyframe.index}`)}
		<button
			aria-label="Retime {keyframe.channel} keyframe {keyframe.index + 1}"
			class="track-keyframe"
			class:track-keyframe--selected={keyframeSelection.id ===
				createKeyframeSelectionId(track.id, keyframe.channel, keyframe.index)}
			class:track-keyframe--playhead={Math.abs(keyframe.fraction - playheadFraction) <=
				halfFrameFraction}
			style:left="{transition.duration > 0
				? ((keyframe.fraction - transition.start) / transition.duration) * 100
				: 0}%"
			onpointerdown={(event) => onstartkeyframedrag(event, track, transition, keyframe)}
			type="button"
		></button>
	{/each}
	{#each trailingHandles as handle (handle.key)}
		<button
			aria-label={handle.aria}
			class="track-handle {handle.className}"
			style={handle.inlineStyle}
			onpointerdown={(event) => onstartdrag(event, track, transition, handle.mode)}
			type="button"
		></button>
	{/each}
</div>

<style>
	.track-transition {
		align-items: center;
		background: var(--track-color);
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
		color: rgb(14, 14, 16);
		cursor: grab;
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 500;
		display: flex;
		inset-block: 5px;
		padding-inline: 10px;
		position: absolute;
		touch-action: none;
	}

	/* Audio cue clips: a tinted well with a live waveform and the cue name in
	   the corner instead of a solid slab. Event markers are 12ms on the data
	   side; the well keeps a readable minimum width so the waveform and name
	   land, like a real NLE's audio event chips. */
	.track-transition--audio {
		background: color-mix(in srgb, var(--track-color) 26%, var(--chrome-deck, #131315));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--track-color) 55%, var(--chrome-deck, #131315));
		min-inline-size: 58px;
		padding-inline: 4px;
	}

	.track-cue-name {
		color: rgb(223 244 241 / 0.95);
		font-family: 'Paper Mono', monospace;
		font-size: 0.46rem;
		font-weight: 500;
		inset-block-start: 2px;
		inset-inline-start: 5px;
		letter-spacing: 0.08em;
		overflow: hidden;
		pointer-events: none;
		position: absolute;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Unified bar: the slab stays solid; enter/exit read as dark wedges laid
	   OVER it (each with a 1px boundary at its inner edge), so a fade is a
	   marked region of the clip — the clip never dissolves into the lane. The
	   zones are the PERCEIVED motion widths (the bar already excludes each
	   ease's tail), so the wedge ends land where the eye sees motion start. */
	.track-transition--unified {
		background:
			linear-gradient(to right, rgb(12 12 14 / 0.55), transparent) left / var(--enter-pct, 0%)
				100% no-repeat,
			linear-gradient(to left, rgb(12 12 14 / 0.55), transparent) right / var(--exit-pct, 0%)
				100% no-repeat,
			linear-gradient(rgb(12 12 14 / 0.4), rgb(12 12 14 / 0.4)) var(--enter-pct, 0%) 0 / 1px
				100% no-repeat,
			linear-gradient(rgb(12 12 14 / 0.4), rgb(12 12 14 / 0.4))
				calc(100% - var(--exit-pct, 0%)) 0 / 1px 100% no-repeat,
			var(--track-color);
	}

	.track-transition:active {
		cursor: grabbing;
	}

	/* Whole-bar ramps (beat chips) speak the same wedge language across their
	   full width instead of dissolving the chip. */
	.track-transition--ramp-in {
		background:
			linear-gradient(to right, rgb(12 12 14 / 0.55), transparent),
			var(--track-color);
	}

	.track-transition--ramp-out {
		background:
			linear-gradient(to left, rgb(12 12 14 / 0.55), transparent),
			var(--track-color);
	}

	.track-transition--selected {
		box-shadow:
			inset 0 0 0 1px rgba(0, 0, 0, 0.4),
			0 0 0 1.5px #2de8ee;
	}

	/* Selection makes the trim handles visible: cyan grab tabs riding the clip
	   ends — the 8px hit zones stay full-height underneath. */
	.track-transition--selected .track-handle--left::before,
	.track-transition--selected .track-handle--right::before {
		background: #2de8ee;
		block-size: 14px;
		border-radius: 2px;
		content: '';
		inline-size: 5px;
		inset-block-start: 50%;
		position: absolute;
		transform: translateY(-50%);
	}

	.track-transition--selected .track-handle--left::before {
		inset-inline-start: -2.5px;
	}

	.track-transition--selected .track-handle--right::before {
		inset-inline-end: -2.5px;
	}

	.track-handle {
		background: transparent;
		block-size: 100%;
		border: 0;
		border-radius: 0;
		cursor: ew-resize;
		padding: 0;
		touch-action: none;
	}

	/* Outer trim handles pinned to the bar edges, out of the label's flow. */
	.track-handle--left,
	.track-handle--right {
		inline-size: 8px;
		position: absolute;
		inset-block: 0;
	}

	.track-handle--left {
		inset-inline-start: 0;
	}

	.track-handle--right {
		inset-inline-end: 0;
	}

	.track-handle--left:hover,
	.track-handle--right:hover {
		background: rgba(0, 0, 0, 0.2);
	}

	/* Inner handles sit at absolute positions within the bar */
	.track-handle--enter-zone,
	.track-handle--exit-zone {
		background: transparent;
		block-size: 100%;
		border: 0;
		cursor: ew-resize;
		flex: none;
		padding: 0;
		position: absolute;
		touch-action: none;
		inline-size: 6px;
		transform: translateX(-50%);
	}

	.track-handle--enter-zone::after,
	.track-handle--exit-zone::after {
		background: rgba(0, 0, 0, 0.35);
		block-size: 60%;
		content: '';
		display: block;
		inline-size: 2px;
		margin: auto;
		position: absolute;
		inset: 0;
	}

	.track-handle--enter-zone:hover::after,
	.track-handle--exit-zone:hover::after {
		background: rgba(0, 0, 0, 0.7);
	}

	.track-label {
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Keyframe diamonds (ADR-0035) ── */

	.track-keyframe {
		background: rgba(0, 0, 0, 0.55);
		block-size: 7px;
		border: 0;
		border-radius: 1px;
		cursor: ew-resize;
		inline-size: 7px;
		padding: 0;
		position: absolute;
		top: 50%;
		touch-action: none;
		transform: translate(-50%, -50%) rotate(45deg);
		transition: background 100ms ease;
	}

	.track-keyframe:hover {
		background: rgba(0, 0, 0, 0.9);
	}

	/* Playhead parked on it → lit; selected → lit with a ring. Matches the
	   inspector row's ◆ so the two surfaces read as one system — both in the
	   transport cyan. */
	.track-keyframe--playhead {
		background: #2de8ee;
	}

	.track-keyframe--selected {
		background: #2de8ee;
		box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.65);
		transform: translate(-50%, -50%) rotate(45deg) scale(1.25);
	}
</style>
