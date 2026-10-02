<script lang="ts">
	import { motionBeatAtMsForFrame } from '$lib/utils/motion-beats';
	import { resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';
	import { compositionEditHistory } from './composition-edit-history';
	import type { CompositionOperationOutcome } from './composition-edit-transaction';
	import {
		runAddCompositionMotionBeatOperation,
		runRemoveCompositionMotionBeatOperation,
		runSetCompositionMotionBeatOperation
	} from './composition-motion-beat-operations';
	import {
		MOTION_BEAT_LIMIT,
		SOUND_EVENTS,
		type MotionBeat,
		type SoundEvent
	} from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import { timelineHandle } from './timeline-handle.svelte';

	// Motion Beats (ADR-0064): the composition's named time anchors. A new beat
	// lands on the playhead's frame; times are whole milliseconds. Every edit is
	// one undoable motion operation; the Timeline ruler shows and moves the same
	// beats.

	const beats = $derived(engineState.motionBeats ?? []);
	let operationMessage = $state<string | null>(null);

	async function run(operation: Promise<CompositionOperationOutcome>): Promise<void> {
		operationMessage = null;
		const outcome = await operation;
		if (outcome.status === 'failed') operationMessage = outcome.message;
	}

	function addBeatAtPlayhead(): void {
		const rate = resolveFrameRate(engineState.transport.fps);
		const frame = secondsToFrames(timelineHandle.current?.time ?? 0, rate);
		void run(
			runAddCompositionMotionBeatOperation({
				expectedRevision: compositionEditHistory.revision,
				atMs: motionBeatAtMsForFrame(frame, rate)
			})
		);
	}

	function moveBeat(beat: MotionBeat, raw: string): void {
		const atMs = Math.round(Number(raw));
		if (!Number.isFinite(atMs) || atMs === beat.atMs) return;
		void run(
			runSetCompositionMotionBeatOperation({
				expectedRevision: compositionEditHistory.revision,
				beatId: beat.id,
				atMs
			})
		);
	}

	function setSound(beat: MotionBeat, raw: string): void {
		const event = SOUND_EVENTS.find((candidate): candidate is SoundEvent => candidate === raw);
		void run(
			runSetCompositionMotionBeatOperation({
				expectedRevision: compositionEditHistory.revision,
				beatId: beat.id,
				sound: event ? { event } : null
			})
		);
	}

	function removeBeat(beat: MotionBeat): void {
		void run(
			runRemoveCompositionMotionBeatOperation({
				expectedRevision: compositionEditHistory.revision,
				beatId: beat.id,
				releaseKeyframes: true
			})
		);
	}
</script>

<InspectorSection
	label="Beats"
	summary={beats.length > 0 ? `${beats.length} ${beats.length === 1 ? 'beat' : 'beats'}` : 'None'}
>
	{#each beats as beat (beat.id)}
		<div class="beat-entry">
			<div class="beat-entry__header">
				<span class="beat-entry__label">{beat.id}</span>
				<button
					type="button"
					class="remove-btn"
					aria-label={`Remove beat ${beat.id}`}
					onclick={() => removeBeat(beat)}>×</button
				>
			</div>
			<Field label="Time">
				<input
					type="number"
					min="0"
					step="1"
					aria-label={`Beat ${beat.id} time`}
					value={beat.atMs}
					onchange={(event) => moveBeat(beat, event.currentTarget.value)}
				/>
				<span class="ins-unit">ms</span>
			</Field>
			<Field label="Sound">
				<select
					aria-label={`Beat ${beat.id} sound`}
					value={beat.sound?.event ?? ''}
					onchange={(event) => setSound(beat, event.currentTarget.value)}
				>
					<option value="">None</option>
					{#each SOUND_EVENTS as soundEvent (soundEvent)}
						<option value={soundEvent}>{soundEvent}</option>
					{/each}
				</select>
			</Field>
		</div>
	{/each}
	{#if operationMessage}
		<small class="operation-error">{operationMessage}</small>
	{/if}
	{#if beats.length < MOTION_BEAT_LIMIT}
		<button type="button" class="ins-add" onclick={addBeatAtPlayhead}>+ Beat</button>
	{/if}
</InspectorSection>

<style>
	.beat-entry {
		border-block-start: 1px solid var(--chrome-hairline);
		display: grid;
		gap: var(--vs-xs);
		padding-block-start: var(--vs-xs);
	}

	.beat-entry__header {
		align-items: center;
		display: flex;
		justify-content: space-between;
	}

	.beat-entry__label {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.72rem;
	}

	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
