<script lang="ts">
	import {
		fillMissingRecordFields,
		readDottedPathValue,
		withDottedPathNumbers
	} from '$lib/utils/object';

	import { animState } from './anim-state.svelte';
	import { resolveCascadeTimings } from './cascade-timing';
	import { runSetCompositionEffectParamsOperation } from './composition-appearance-operations';
	import { compositionEditHistory } from './composition-edit-history';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import {
		runClearCompositionKeyframeChannelOperation,
		runSetCompositionKeyframeChannelOperation
	} from './composition-keyframe-cascade-operations';
	import {
		describeEffectNumericParam,
		resolveEffectParamsWithDefaults
	} from './effect-keyframe-channels';
	import type { Effect, Keyframe } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import KeyframeChannelRow from './KeyframeChannelRow.svelte';
	import { getEffectDefinition } from './pipelines/definition-registry';
	import { createTimelineTrackId } from './timeline-entity-identity';

	// One numeric Effect param as a keyframe row (ADR-0063 §9). Without a track
	// it edits the static param; ◆ starts a track at the playhead; with a track it
	// edits the keyframe there and shows the live value the animation manifest
	// drives. A frozen param, or an entry that is not an authored Effect (a Pack
	// chrome entry before its first edit), renders as a plain value row.

	interface Props {
		effect: Effect;
		path: string;
		label: string;
	}

	let { effect, path, label }: Props = $props();
	let operationMessage = $state<string | null>(null);
	let operationBusy = $state(false);

	const definition = $derived(getEffectDefinition(effect.type));
	const param = $derived(definition ? describeEffectNumericParam(definition, path) : null);
	const authored = $derived(engineState.effects.find((entry) => entry.id === effect.id) ?? null);
	const keyframeable = $derived(authored !== null && param !== null && !param.frozen);
	const track = $derived.by((): Keyframe[] | undefined => {
		const frames = keyframeable ? authored?.animation?.channels?.[path] : undefined;
		return frames && frames.length > 0 ? frames : undefined;
	});
	const trackRowId = $derived(createTimelineTrackId({ kind: 'effect', effectId: effect.id }));
	const clipStartMs = $derived.by(() => {
		const durationMs = engineState.transport.durationSeconds * 1000;
		try {
			return (
				(resolveCascadeTimings(engineState).get(`effect:${effect.id}`)?.startFraction ?? 0) *
				durationMs
			);
		} catch {
			return 0;
		}
	});

	function readNumber(source: unknown): number | undefined {
		const value = readDottedPathValue(source, path);
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	}

	const staticValue = $derived(
		readNumber(effect.params) ?? readNumber(definition?.defaults().params) ?? param?.min ?? 0
	);
	// The manifest's value at the playhead: a declared track, or sugar the
	// Effect's own timing fields expand into (frosted glass's grow and melt).
	const live = $derived(keyframeable ? animState.effectChannels[effect.id]?.[path] : undefined);
	// A sugar-driven param ignores its static value, so a typed value starts a
	// track (a declared channel takes the pen) instead of editing it unseen.
	const sugarDriven = $derived(!track && live !== undefined);
	const value = $derived.by(() => {
		const shown = live ?? staticValue;
		return param?.isInteger ? Math.round(shown) : Math.round(shown * 1000) / 1000;
	});

	async function runOperation(run: () => Promise<CompositionOperationOutcome>): Promise<void> {
		operationBusy = true;
		operationMessage = null;
		try {
			const outcome = await run();
			if (outcome.status === 'failed') operationMessage = outcome.message;
		} finally {
			operationBusy = false;
		}
	}

	function applyTrack(next: Keyframe[] | null): void {
		const subject = { kind: 'effect' as const, effectId: effect.id };
		void runOperation(() =>
			next === null
				? runClearCompositionKeyframeChannelOperation({
						expectedRevision: compositionEditHistory.revision,
						subject,
						channel: path
					})
				: runSetCompositionKeyframeChannelOperation({
						expectedRevision: compositionEditHistory.revision,
						subject,
						channel: path,
						keyframes: next
					})
		);
	}

	// The params with the written path's top-level parent filled from schema
	// defaults, so `region.x` lands even when the authored params omit `region`.
	function paramsForWrite(source: Record<string, unknown>): Record<string, unknown> {
		const [top] = path.split('.');
		if (top === path || !definition) return { ...source };
		const defaults = resolveEffectParamsWithDefaults(effect, definition);
		const fallback =
			defaults !== null && typeof defaults === 'object'
				? (defaults as Record<string, unknown>)[top]
				: undefined;
		return { ...source, [top]: fillMissingRecordFields(fallback, source[top]) };
	}

	function writeStatic(next: number): void {
		if (authored) {
			const params = withDottedPathNumbers(
				paramsForWrite($state.snapshot(authored.params) as Record<string, unknown>),
				{ [path]: next }
			);
			void runOperation(() =>
				runSetCompositionEffectParamsOperation({
					expectedRevision: compositionEditHistory.revision,
					effectId: authored.id,
					params
				})
			);
			return;
		}
		// A Pack chrome entry before its first edit: its params object materializes
		// the authored override on a top-level write, so write the top-level key.
		const params = effect.params as Record<string, unknown>;
		const [top] = path.split('.');
		params[top] = withDottedPathNumbers(paramsForWrite(params), { [path]: next })[top];
	}
</script>

<KeyframeChannelRow
	channel={path}
	{label}
	bounds={param ?? {}}
	{track}
	{clipStartMs}
	{value}
	{keyframeable}
	busy={operationBusy}
	{trackRowId}
	onTrackChange={applyTrack}
	onStaticChange={sugarDriven ? undefined : writeStatic}
/>
{#if operationMessage}
	<small class="operation-error">{operationMessage}</small>
{/if}

<style>
	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
