<script lang="ts">
	import { animState } from './anim-state.svelte';
	import { compositionEditHistory } from './composition-edit-history';
	import {
		runClearCompositionKeyframeChannelOperation,
		runSetCompositionKeyframeChannelOperation,
		type CompositionKeyframeChannelScope,
		type CompositionKeyframeSubject
	} from './composition-keyframe-cascade-operations';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import { resolveCascadeTimings } from './cascade-timing';
	import { ENGINE_EASES, type Ease, type Keyframe } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import { evaluateKeyframeTrackAtMs } from './keyframe-track-evaluation';
	import { keyframeSelection, selectKeyframe } from './selection.svelte';
	import { createKeyframeSelectionId, createTimelineTrackId } from './timeline-entity-identity';
	import { timelineHandle } from './timeline-handle.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import {
		isKineticWordSpatialChannel,
		resolveKineticWordGeometry
	} from '$lib/utils/kinetic-word-geometry';

	// DaVinci-style keyframe rows (ADR-0035 §7): one row per property showing
	// the value AT THE PLAYHEAD, with ◀ (jump to previous keyframe) · ◆ (add or
	// remove a keyframe at the playhead — filled when the playhead sits on one)
	// · ▶ (jump to next). Every mutation reaches the same revisioned Operation
	// WebMCP calls. Kinetic Word spatial rows may target one complete orientation
	// group; opacity and semantic weight always remain shared.

	interface ChannelOwner {
		animation?: {
			channels?: Partial<Record<string, Keyframe[] | undefined>>;
			orientationOverrides?: Partial<
				Record<'horizontal' | 'vertical', Partial<Record<string, Keyframe[] | undefined>>>
			>;
		};
	}

	interface Props {
		selfKey: string;
		channelNames: readonly string[];
		scope?: CompositionKeyframeChannelScope;
		label?: string;
	}

	let { selfKey, channelNames, scope = 'shared', label = 'Keyframes' }: Props = $props();
	let operationMessage = $state<string | null>(null);
	let operationBusy = $state(false);

	const easeOptions = Object.entries(ENGINE_EASES) as [Ease, (typeof ENGINE_EASES)[Ease]][];
	const CHANNEL_INPUT: Record<string, { min?: number; max?: number }> = {
		opacity: { min: 0, max: 1 },
		scale: { min: 0.1, max: 8 },
		weight: { min: 0, max: 1 }
	};

	const overlayIndex = $derived(
		selfKey === 'surface'
			? -1
			: engineState.overlays.findIndex((overlay) => selfKey === `overlay:${overlay.id}`)
	);
	const overlay = $derived(overlayIndex >= 0 ? engineState.overlays[overlayIndex] : null);
	const blockId = $derived(selfKey.startsWith('block:') ? selfKey.slice('block:'.length) : null);
	const kineticWord = $derived(
		blockId
			? (engineState.surface.typeField?.words.find((word) => word.id === blockId) ?? null)
			: null
	);
	const blockPrimitive = $derived(
		blockId
			? ((engineState.surface.diagram ?? []).find((primitive) => primitive.id === blockId) ?? null)
			: null
	);
	const owner = $derived<ChannelOwner | null>(
		selfKey === 'surface' ? engineState.surface : (kineticWord ?? blockPrimitive ?? overlay ?? null)
	);
	const subject = $derived.by((): CompositionKeyframeSubject | null => {
		if (selfKey === 'surface') return { kind: 'surface' };
		if (blockId) return { kind: 'block', blockId };
		if (overlay) return { kind: 'overlay', overlayId: overlay.id };
		return null;
	});
	const trackRowId = $derived(
		selfKey === 'surface'
			? createTimelineTrackId({ kind: 'surface' })
			: blockId
				? createTimelineTrackId({ kind: 'block', blockId })
				: createTimelineTrackId({
						kind: 'overlay',
						overlayId: selfKey.slice('overlay:'.length)
					})
	);

	const durationMs = $derived(engineState.transport.durationSeconds * 1000);
	const halfFrameMs = $derived(500 / engineState.transport.fps);
	const clipStartMs = $derived.by(() => {
		try {
			return (resolveCascadeTimings(engineState).get(selfKey)?.startFraction ?? 0) * durationMs;
		} catch {
			return 0;
		}
	});
	const playheadMs = $derived((timelineHandle.current?.time ?? 0) * 1000);
	const localMs = $derived(playheadMs - clipStartMs);

	function channelScope(channel: string): CompositionKeyframeChannelScope {
		return kineticWord && isKineticWordSpatialChannel(channel) ? scope : 'shared';
	}

	function trackFor(channel: string): Keyframe[] | undefined {
		const resolvedScope = channelScope(channel);
		if (resolvedScope === 'shared') {
			const track = owner?.animation?.channels?.[channel];
			return track && track.length > 0 ? track : undefined;
		}
		const track = owner?.animation?.orientationOverrides?.[resolvedScope]?.[channel];
		return track && track.length > 0 ? track : undefined;
	}

	function effectiveTrack(channel: string): Keyframe[] | undefined {
		const own = trackFor(channel);
		if (own || !kineticWord || !isKineticWordSpatialChannel(channel) || scope === 'shared') {
			return own;
		}
		const hasOrientationGroup = kineticWord.animation?.orientationOverrides?.[scope] !== undefined;
		return hasOrientationGroup ? undefined : kineticWord.animation?.channels?.[channel];
	}

	function keyframeIndexAtPlayhead(channel: string): number {
		const track = trackFor(channel);
		if (!track) return -1;
		return track.findIndex((frame) => Math.abs(frame.atMs - localMs) <= halfFrameMs);
	}

	function staticValue(channel: string): number {
		if (kineticWord) {
			const orientation = scope === 'shared' ? engineState.transport.orientation : scope;
			const geometry = resolveKineticWordGeometry(kineticWord, orientation);
			if (channel === 'scale') return geometry.scale;
			if (channel === 'rotation') return geometry.rotation;
			if (channel === 'weight') return 0.5;
			return channel === 'opacity' ? 1 : 0;
		}
		if (blockId) {
			if (channel === 'scale') {
				return blockPrimitive && 'scale' in blockPrimitive ? (blockPrimitive.scale ?? 1) : 1;
			}
			return channel === 'opacity' ? 1 : 0;
		}
		if (channel === 'scale') return overlay?.position.scale ?? 1;
		if (channel === 'rotation') return overlay?.position.rotation ?? 0;
		return channel === 'opacity' ? 1 : 0;
	}

	function liveValue(channel: string): number {
		if (kineticWord) {
			return round(
				evaluateKeyframeTrackAtMs(effectiveTrack(channel), localMs, staticValue(channel))
			);
		}
		if (selfKey === 'surface') {
			return round(trackFor(channel) ? animState.paperVisibility : 1);
		}
		if (blockId) {
			const slot = animState.blockChannels[blockId];
			if (slot) return round(slot[channel as keyof typeof slot] ?? 0);
			return staticValue(channel);
		}
		const slot = overlayIndex >= 0 ? animState.overlayChannels[overlayIndex] : null;
		if (slot) return round(slot[channel as keyof typeof slot] ?? 0);
		return staticValue(channel);
	}

	function round(value: number): number {
		return Math.round(value * 1000) / 1000;
	}

	function normalizeEases(track: Keyframe[]): void {
		track.forEach((frame, index) => {
			if (index === 0) delete frame.ease;
			else frame.ease ??= 'smooth';
		});
	}

	async function applyTrack(channel: string, track: Keyframe[] | null): Promise<void> {
		if (!subject) return;
		operationBusy = true;
		operationMessage = null;
		try {
			let outcome: CompositionOperationOutcome;
			if (track === null) {
				outcome = await runClearCompositionKeyframeChannelOperation({
					expectedRevision: compositionEditHistory.revision,
					subject,
					channel,
					scope: channelScope(channel)
				});
			} else {
				outcome = await runSetCompositionKeyframeChannelOperation({
					expectedRevision: compositionEditHistory.revision,
					subject,
					channel,
					scope: channelScope(channel),
					keyframes: track
				});
			}
			if (outcome.status === 'failed') operationMessage = outcome.message;
		} finally {
			operationBusy = false;
		}
	}

	function upsertTrack(channel: string, value: number): { track: Keyframe[]; index: number } {
		const atMs = Math.max(0, Math.min(localMs, durationMs - clipStartMs));
		const source = trackFor(channel) ?? effectiveTrack(channel) ?? [];
		const track = source.map((frame) => ({ ...frame }));
		const existing = source.findIndex((frame) => Math.abs(frame.atMs - localMs) <= halfFrameMs);
		if (existing >= 0 && track[existing]) {
			track[existing].value = value;
			normalizeEases(track);
			return { track, index: existing };
		}
		if (kineticWord && track.length === 0 && atMs > 0) {
			track.push({ atMs: 0, value: staticValue(channel) });
		}
		track.push({ atMs, value });
		track.sort((left, right) => left.atMs - right.atMs);
		normalizeEases(track);
		return { track, index: track.findIndex((frame) => frame.atMs === atMs) };
	}

	function toggleKeyframe(channel: string): void {
		const track = trackFor(channel);
		const at = keyframeIndexAtPlayhead(channel);
		if (track && at >= 0) {
			const next = track.map((frame) => ({ ...frame }));
			next.splice(at, 1);
			normalizeEases(next);
			void applyTrack(channel, next.length > 0 ? next : null);
			return;
		}
		const next = upsertTrack(channel, liveValue(channel));
		void applyTrack(channel, next.track);
		selectKeyframe(trackRowId, channel, next.index);
	}

	function jump(channel: string, direction: -1 | 1): void {
		const track = trackFor(channel);
		const transport = timelineHandle.current;
		if (!track || !transport) return;
		const candidates =
			direction === -1
				? track.filter((frame) => frame.atMs < localMs - halfFrameMs)
				: track.filter((frame) => frame.atMs > localMs + halfFrameMs);
		if (candidates.length === 0) return;
		const target = direction === -1 ? candidates[candidates.length - 1] : candidates[0];
		transport.seek((clipStartMs + target.atMs) / 1000);
		selectKeyframe(trackRowId, channel, track.indexOf(target));
	}

	function hasPrev(channel: string): boolean {
		return (trackFor(channel) ?? []).some((frame) => frame.atMs < localMs - halfFrameMs);
	}

	function hasNext(channel: string): boolean {
		return (trackFor(channel) ?? []).some((frame) => frame.atMs > localMs + halfFrameMs);
	}

	function setValue(channel: string, raw: string): void {
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		const input = CHANNEL_INPUT[channel];
		const next = upsertTrack(
			channel,
			Math.max(input?.min ?? -Infinity, Math.min(input?.max ?? Infinity, value))
		);
		void applyTrack(channel, next.track);
		selectKeyframe(trackRowId, channel, next.index);
	}

	function setEase(channel: string, value: string): void {
		const track = trackFor(channel);
		const at = keyframeIndexAtPlayhead(channel);
		if (!track || at <= 0) return;
		const next = track.map((frame) => ({ ...frame }));
		next[at].ease = value as Ease;
		void applyTrack(channel, next);
	}
</script>

<InspectorSection {label} defaultOpen={false}>
	{#each channelNames as channel (channel)}
		{@const track = trackFor(channel)}
		{@const atIndex = keyframeIndexAtPlayhead(channel)}
		{@const onKeyframe = atIndex >= 0}
		<div class="kf-row" class:kf-row--keyed={track !== undefined}>
			<span class="kf-row__name">{channel === 'rotation' ? 'rotation°' : channel}</span>
			<input
				class="kf-row__value"
				aria-label="{channel} value at playhead"
				type="number"
				min={CHANNEL_INPUT[channel]?.min}
				max={CHANNEL_INPUT[channel]?.max}
				step="any"
				value={liveValue(channel)}
				disabled={operationBusy}
				onchange={(e) => setValue(channel, (e.currentTarget as HTMLInputElement).value)}
			/>
			<div class="kf-row__nav">
				<button
					type="button"
					class="kf-row__jump"
					aria-label="Previous {channel} keyframe"
					disabled={operationBusy || !hasPrev(channel)}
					onclick={() => jump(channel, -1)}
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
						? `Remove ${channel} keyframe at playhead`
						: `Add ${channel} keyframe at playhead`}
					aria-pressed={onKeyframe}
					disabled={operationBusy}
					onclick={() => toggleKeyframe(channel)}
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
					aria-label="Next {channel} keyframe"
					disabled={operationBusy || !hasNext(channel)}
					onclick={() => jump(channel, 1)}
				>
					<svg width="7" height="9" viewBox="0 0 7 9" aria-hidden="true">
						<path d="M1 .8v7.4l5.2-3.7z" fill="currentColor" />
					</svg>
				</button>
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
					aria-label="{channel} keyframe ease"
					value={track?.[atIndex]?.ease ?? 'smooth'}
					disabled={operationBusy}
					onchange={(e) => setEase(channel, (e.currentTarget as HTMLSelectElement).value)}
				>
					{#each easeOptions as [value, option] (value)}
						<option {value}>{option.label}</option>
					{/each}
				</select>
			</div>
		{/if}
	{/each}
	{#if operationMessage}
		<small class="operation-error">{operationMessage}</small>
	{/if}
</InspectorSection>

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

	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
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
