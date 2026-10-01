<script lang="ts">
	import { ENGINE_EASES, type Ease, type Keyframe } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import {
		clampKeyframeChannelValue,
		findKeyframeIndexAtPlayhead,
		findKeyframeJumpTarget,
		removeKeyframeAt,
		upsertKeyframeAtPlayhead,
		withKeyframeEase,
		type KeyframeChannelBounds
	} from './keyframe-channel-row';
	import { keyframeSelection, selectKeyframe } from './selection.svelte';
	import { createKeyframeSelectionId, type TimelineTrackId } from './timeline-entity-identity';
	import { timelineHandle } from './timeline-handle.svelte';

	// One DaVinci-style keyframe row (ADR-0035 §7, ADR-0063 §9): the value at the
	// playhead, then ◀ (previous keyframe) · ◆ (add or remove a keyframe at the
	// playhead, filled when parked on one) · ▶ (next keyframe), plus the ease
	// into the keyframe under the playhead. The owner decides what a track
	// change means; this row never writes the composition itself.

	interface Props {
		/** The channel key: keyframe selection ids and timeline diamonds use it. */
		channel: string;
		label: string;
		/** The name screen readers hear in the row's control labels. */
		name?: string;
		bounds?: KeyframeChannelBounds;
		/** The owner's own track for this channel; absent when it authors none. */
		track: readonly Keyframe[] | undefined;
		/** The track a new keyframe extends when it differs from `track`. */
		sourceTrack?: readonly Keyframe[];
		clipStartMs: number;
		/** The value shown: live at the playhead with a track, the static value without. */
		value: number;
		/** Seeds a new track's first keyframe at 0 with this value. */
		seedValue?: number;
		/** False renders a plain value row: no keyframe navigation. */
		keyframeable?: boolean;
		busy?: boolean;
		trackRowId: TimelineTrackId;
		onTrackChange(track: Keyframe[] | null): void;
		/** Without a track, a typed value edits the static value instead of starting a track. */
		onStaticChange?(value: number): void;
	}

	let {
		channel,
		label,
		name = label,
		bounds = {},
		track,
		sourceTrack,
		clipStartMs,
		value,
		seedValue,
		keyframeable = true,
		busy = false,
		trackRowId,
		onTrackChange,
		onStaticChange
	}: Props = $props();

	const easeOptions = Object.entries(ENGINE_EASES) as [Ease, (typeof ENGINE_EASES)[Ease]][];

	const durationMs = $derived(engineState.transport.durationSeconds * 1000);
	const position = $derived({
		localMs: (timelineHandle.current?.time ?? 0) * 1000 - clipStartMs,
		halfFrameMs: 500 / engineState.transport.fps,
		maxAtMs: durationMs - clipStartMs
	});
	const atIndex = $derived(findKeyframeIndexAtPlayhead(track, position));
	const onKeyframe = $derived(atIndex >= 0);
	const previous = $derived(findKeyframeJumpTarget(track, -1, position));
	const next = $derived(findKeyframeJumpTarget(track, 1, position));

	function startOrReplace(nextValue: number): void {
		const upserted = upsertKeyframeAtPlayhead(sourceTrack ?? track, nextValue, position, seedValue);
		onTrackChange(upserted.track);
		selectKeyframe(trackRowId, channel, upserted.index);
	}

	function toggleKeyframe(): void {
		if (track && onKeyframe) {
			onTrackChange(removeKeyframeAt(track, atIndex));
			return;
		}
		startOrReplace(value);
	}

	function jump(target: { frame: Keyframe; index: number } | undefined): void {
		const transport = timelineHandle.current;
		if (!target || !transport) return;
		transport.seek((clipStartMs + target.frame.atMs) / 1000);
		selectKeyframe(trackRowId, channel, target.index);
	}

	function setValue(raw: string): void {
		const parsed = clampKeyframeChannelValue(raw, bounds);
		if (parsed === null) return;
		if (!track && onStaticChange) {
			onStaticChange(parsed);
			return;
		}
		startOrReplace(parsed);
	}

	function setEase(ease: string): void {
		if (!track || atIndex <= 0) return;
		onTrackChange(withKeyframeEase(track, atIndex, ease as Ease));
	}
</script>

<div class="kf-row" class:kf-row--keyed={track !== undefined}>
	<span class="kf-row__name">{label}</span>
	<input
		class="kf-row__value"
		aria-label="{name} value at playhead"
		type="number"
		min={bounds.min}
		max={bounds.max}
		step={bounds.isInteger ? 1 : 'any'}
		{value}
		disabled={busy}
		onchange={(event) => setValue(event.currentTarget.value)}
	/>
	<div class="kf-row__nav">
		{#if keyframeable}
			<button
				type="button"
				class="kf-row__jump"
				aria-label="Previous {name} keyframe"
				disabled={busy || !previous}
				onclick={() => jump(previous)}
			>
				<svg width="7" height="9" viewBox="0 0 7 9" aria-hidden="true">
					<path d="M6 .8v7.4L.8 4.5z" fill="currentColor" />
				</svg>
			</button>
			<button
				type="button"
				class="kf-row__toggle"
				class:kf-row__toggle--on={onKeyframe}
				aria-label={onKeyframe
					? `Remove ${name} keyframe at playhead`
					: `Add ${name} keyframe at playhead`}
				aria-pressed={onKeyframe}
				disabled={busy}
				onclick={toggleKeyframe}
			>
				<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
					<rect
						x="2.4"
						y="2.4"
						width="5.2"
						height="5.2"
						transform="rotate(45 5 5)"
						fill={onKeyframe ? 'currentColor' : 'none'}
						stroke="currentColor"
						stroke-width="1.2"
					/>
				</svg>
			</button>
			<button
				type="button"
				class="kf-row__jump"
				aria-label="Next {name} keyframe"
				disabled={busy || !next}
				onclick={() => jump(next)}
			>
				<svg width="7" height="9" viewBox="0 0 7 9" aria-hidden="true">
					<path d="M1 .8v7.4l5.2-3.7z" fill="currentColor" />
				</svg>
			</button>
		{/if}
	</div>
</div>
{#if onKeyframe && atIndex > 0}
	<div
		class="kf-ease"
		data-selected={keyframeSelection.id ===
			createKeyframeSelectionId(trackRowId, channel, atIndex) || undefined}
	>
		<span class="kf-ease__label">ease into</span>
		<select
			aria-label="{name} keyframe ease"
			value={track?.[atIndex]?.ease ?? 'smooth'}
			disabled={busy}
			onchange={(event) => setEase(event.currentTarget.value)}
		>
			{#each easeOptions as [easeValue, option] (easeValue)}
				<option value={easeValue}>{option.label}</option>
			{/each}
		</select>
	</div>
{/if}

<style>
	/* name · value-at-playhead · ◀ ◆ ▶ — the DaVinci row, on the shared
	   field grid (§9): label column, control edge, nav flush right. */
	.kf-row {
		align-items: center;
		column-gap: var(--vs-s);
		display: grid;
		grid-template-columns: var(--ins-label-w, 5.5rem) minmax(0, 1fr) auto;
	}

	.kf-row__name {
		color: var(--chrome-muted);
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: capitalize;
		white-space: nowrap;
	}

	/* A property that carries keyframes reads as "authored" — primary text,
	   never yellow (yellow means selection, and the ◆ already lights when
	   the playhead parks on a keyframe). */
	.kf-row--keyed .kf-row__name {
		color: var(--chrome-text);
	}

	.kf-row__value {
		min-inline-size: 0;
	}

	.kf-row__nav {
		align-items: center;
		display: flex;
		gap: 2px;
	}

	.kf-row__jump,
	.kf-row__toggle {
		align-items: center;
		background: transparent;
		block-size: 20px;
		border: 0;
		border-radius: 4px;
		color: var(--chrome-muted);
		cursor: pointer;
		display: flex;
		inline-size: 20px;
		justify-content: center;
		padding: 0;
		transition:
			color 120ms ease,
			background-color 120ms ease;
	}

	.kf-row__jump:hover:not(:disabled),
	.kf-row__toggle:hover {
		background: var(--chrome-raised);
		color: var(--chrome-text);
	}

	/* Disabled stays visibly present — a rest state, not a hole in the row. */
	.kf-row__jump:disabled,
	.kf-row__toggle:disabled {
		color: var(--chrome-muted);
		cursor: default;
		opacity: 0.4;
	}

	/* Playhead parked on a keyframe → the diamond lights, in the same transport
	   cyan as the timeline diamonds so the two surfaces read as one system. */
	.kf-row__toggle--on {
		color: #2de8ee;
	}

	/* Ease-into for the keyframe under the playhead — only visible parked;
	   sits on the same grid so the select shares the control edges. */
	.kf-ease {
		align-items: center;
		column-gap: var(--vs-s);
		display: grid;
		grid-template-columns: var(--ins-label-w, 5.5rem) minmax(0, 1fr);
	}

	.kf-ease__label {
		color: var(--chrome-muted);
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}
</style>
