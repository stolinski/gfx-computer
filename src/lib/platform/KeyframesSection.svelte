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
	import type { Keyframe } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import { evaluateKeyframeTrackAtMs } from './keyframe-track-evaluation';
	import { createTimelineTrackId } from './timeline-entity-identity';
	import { timelineHandle } from './timeline-handle.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import KeyframeChannelRow from './KeyframeChannelRow.svelte';
	import type { KeyframeChannelBounds } from './keyframe-channel-row';
	import { resolveKineticWordGeometry } from '$lib/utils/kinetic-word-geometry';
	import { isSpatialKeyframeChannel } from '$lib/utils/orientation-keyframe-channels';
	import { resolveOverlayPlacement } from '$lib/utils/overlay-placement';
	import { resolveDiagramPrimitiveGeometry } from '$lib/utils/diagram-geometry';

	// DaVinci-style keyframe rows (ADR-0035 §7), one `KeyframeChannelRow` per
	// property. Every mutation reaches the same revisioned Operation WebMCP
	// calls. Kinetic Word spatial rows may target one complete orientation
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

	const CHANNEL_INPUT: Record<string, KeyframeChannelBounds> = {
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
	const clipStartMs = $derived.by(() => {
		try {
			return (resolveCascadeTimings(engineState).get(selfKey)?.startFraction ?? 0) * durationMs;
		} catch {
			return 0;
		}
	});
	const playheadMs = $derived((timelineHandle.current?.time ?? 0) * 1000);
	const localMs = $derived(playheadMs - clipStartMs);

	// Kinetic Words and Overlays may replace their spatial group per orientation.
	function channelScope(channel: string): CompositionKeyframeChannelScope {
		const ownsGroups = kineticWord || overlay || (blockPrimitive && 'position' in blockPrimitive);
		return ownsGroups && isSpatialKeyframeChannel(channel) ? scope : 'shared';
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

	// Without its own group, an orientation row extends the shared track.
	function effectiveTrack(channel: string): Keyframe[] | undefined {
		const own = trackFor(channel);
		if (own || channelScope(channel) === 'shared' || scope === 'shared') return own;
		const hasOrientationGroup = owner?.animation?.orientationOverrides?.[scope] !== undefined;
		return hasOrientationGroup ? undefined : owner?.animation?.channels?.[channel];
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
				if (!blockPrimitive || !('position' in blockPrimitive)) return 1;
				const geometry = resolveDiagramPrimitiveGeometry(
					blockPrimitive,
					scope === 'shared' ? engineState.transport.orientation : scope
				);
				return geometry.scale ?? 1;
			}
			return channel === 'opacity' ? 1 : 0;
		}
		if (overlay && (channel === 'scale' || channel === 'rotation')) {
			const placement = resolveOverlayPlacement(
				overlay.position,
				scope === 'shared' ? engineState.transport.orientation : scope
			);
			return channel === 'scale' ? (placement.scale ?? 1) : (placement.rotation ?? 0);
		}
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
</script>

<InspectorSection {label} defaultOpen={false}>
	{#each channelNames as channel (channel)}
		<KeyframeChannelRow
			{channel}
			label={channel === 'rotation' ? 'rotation°' : channel}
			name={channel}
			bounds={CHANNEL_INPUT[channel]}
			track={trackFor(channel)}
			sourceTrack={trackFor(channel) ?? effectiveTrack(channel)}
			{clipStartMs}
			value={liveValue(channel)}
			seedValue={kineticWord ? staticValue(channel) : undefined}
			busy={operationBusy}
			{trackRowId}
			onTrackChange={(track) => void applyTrack(channel, track)}
		/>
	{/each}
	{#if operationMessage}
		<small class="operation-error">{operationMessage}</small>
	{/if}
</InspectorSection>

<style>
	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
