<script lang="ts">
	import { listSoundAssets } from './audio-assets';
	import type { SoundOverride } from './engine-schema';
	import { engineState, ensureMarkTimingAtIndex } from './engine-state.svelte';
	import { deselectLayer } from './selection.svelte';
	import { deriveSoundCues, resolveCueSample, type DerivedSoundCueSource } from './sound-cues';
	import type { SoundRailReference } from './timeline-entity-identity';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import SoundPicker from './SoundPicker.svelte';

	/**
	 * A cue selected on the timeline's Sound rail (ADR-0033 §9: "selecting a
	 * cue focuses it in the sidebar"). Derived cues edit the SOURCE MOTION's
	 * sound (the same SoundPicker the Layer inspectors use — the cue itself is
	 * never stored); manual cues and the bed edit their audioCues[] entry.
	 */
	interface Props {
		reference: SoundRailReference;
	}

	let { reference }: Props = $props();

	const soundAssets = listSoundAssets();

	const cue = $derived(
		reference.kind === 'derived'
			? deriveSoundCues(engineState).find((entry) => entry.id === reference.cueId)
			: undefined
	);
	const resolvedSample = $derived(cue ? resolveCueSample(cue) : null);

	const manualCue = $derived(
		reference.kind === 'manual'
			? engineState.audioCues.find((entry) => entry.id === reference.cueId)
			: undefined
	);

	interface MotionWindow {
		sound?: SoundOverride;
	}

	function soundCueSourceLabel(source: DerivedSoundCueSource): string {
		switch (source.kind) {
			case 'surface-transition':
				return `Surface ${source.phase}`;
			case 'mark-transition':
				return 'Mark draw-on';
			case 'checklist-item-strike':
				return 'Checklist item strike';
			case 'overlay-transition': {
				const overlay = engineState.overlays.find((entry) => entry.id === source.overlayId);
				return overlay ? `${overlay.type} ${source.phase}` : `Overlay ${source.phase}`;
			}
			case 'block-transition': {
				const block = (engineState.surface.diagram ?? []).find(
					(entry) => entry.id === source.blockId
				);
				return block ? `${block.type} ${source.phase}` : `Block ${source.phase}`;
			}
			case 'text-animation-transition': {
				const textAnimation = engineState.textAnimations.find(
					(entry) => entry.id === source.textAnimationId
				);
				return textAnimation
					? `Text · ${textAnimation.effect} ${source.phase}`
					: `Text animation ${source.phase}`;
			}
			case 'surface-message-transition':
				return 'Message bubble';
			case 'surface-message-tapback':
				return 'Tapback';
			case 'overlay-beat':
				return source.beat === 'press' ? 'Press beat' : 'Achievement beat';
			case 'motion-beat':
				return `Motion Beat ${source.beatId}`;
		}
	}

	const motion = $derived.by(
		(): { window?: MotionWindow; ensure?: () => MotionWindow; source: string } | null => {
			if (!cue) return null;
			const source = soundCueSourceLabel(cue.source);
			const target = cue.editTarget;
			if (!target) return { source };

			switch (target.kind) {
				case 'surface-transition':
					return { window: engineState.surface[target.phase], source };
				case 'mark-transition':
					return {
						window: engineState.marks.timings[target.markIndex],
						ensure: () => ensureMarkTimingAtIndex(target.markIndex),
						source
					};
				case 'checklist-item-strike': {
					const item = engineState.surface.content.items?.[target.itemIndex];
					return item?.strike ? { window: item.strike, source } : { source };
				}
				case 'overlay-transition': {
					const overlay = engineState.overlays.find((entry) => entry.id === target.overlayId);
					return overlay ? { window: overlay[target.phase], source } : { source };
				}
				case 'block-transition': {
					const block = (engineState.surface.diagram ?? []).find(
						(entry) => entry.id === target.blockId
					);
					return block ? { window: block[target.phase], source } : { source };
				}
				case 'text-animation-transition': {
					const textAnimation = engineState.textAnimations.find(
						(entry) => entry.id === target.textAnimationId
					);
					return textAnimation ? { window: textAnimation[target.phase], source } : { source };
				}
				case 'surface-message-transition': {
					const message = engineState.surface.content.messages?.[target.messageIndex];
					return message?.enter ? { window: message.enter, source } : { source };
				}
			}
		}
	);

	function humanize(slug: string): string {
		const text = slug.replace(/-/g, ' ');
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	function setCueFraction(key: 'start' | 'duration', value: string): void {
		if (!manualCue) return;
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		manualCue[key] = Math.max(0, Math.min(1, n));
	}

	function removeManualCue(): void {
		const index = engineState.audioCues.findIndex(
			(entry) => reference.kind === 'manual' && entry.id === reference.cueId
		);
		if (index >= 0) engineState.audioCues.splice(index, 1);
		deselectLayer();
	}
</script>

{#if cue && motion}
	<InspectorSection label={motion.source}>
		<Field label="Plays">
			<span class="cue-info">{resolvedSample ? humanize(resolvedSample) : 'Nothing (silent)'}</span>
		</Field>
		<Field label="At">
			<span class="cue-info">
				{(cue.start * engineState.transport.durationSeconds).toFixed(2)}s · {cue.event}
			</span>
		</Field>
		{#if motion.window || motion.ensure}
			<Field label="Sound">
				<SoundPicker cueId={cue.id} window={motion.window} ensure={motion.ensure} />
			</Field>
		{:else}
			<Field label="Sound">
				<span class="cue-info">Fixed per reaction type</span>
			</Field>
		{/if}
	</InspectorSection>
{:else if manualCue}
	<InspectorSection label={manualCue.kind === 'bed' ? 'Bed' : 'Manual cue'}>
		<Field label="Sample">
			<select bind:value={manualCue.assetSlug}>
				{#each soundAssets as slug (slug)}
					<option value={slug}>{humanize(slug)}</option>
				{/each}
			</select>
		</Field>
		<Field label="Window">
			<input
				type="number"
				min="0"
				max="1"
				step="any"
				value={Math.round(manualCue.start * 1000) / 1000}
				oninput={(e) => setCueFraction('start', (e.currentTarget as HTMLInputElement).value)}
			/>
			<input
				type="number"
				min="0"
				max="1"
				step="any"
				value={Math.round(manualCue.duration * 1000) / 1000}
				oninput={(e) => setCueFraction('duration', (e.currentTarget as HTMLInputElement).value)}
			/>
		</Field>
		<Field label="Volume">
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={manualCue.volume ?? 1}
				oninput={(e) => {
					manualCue.volume = Number((e.currentTarget as HTMLInputElement).value);
				}}
			/>
		</Field>
		<button type="button" class="remove-cue" onclick={removeManualCue}>Remove</button>
	</InspectorSection>
{:else}
	<InspectorSection label="Sound">
		<span class="cue-info">This cue no longer exists.</span>
	</InspectorSection>
{/if}

<style>
	.cue-info {
		color: var(--chrome-muted);
		font-size: 0.8125rem;
	}

	.remove-cue {
		background: var(--chrome-well);
		border: 1px solid var(--chrome-hairline);
		border-radius: 4px;
		color: #f0453d;
		cursor: pointer;
		font-size: 0.75rem;
		justify-self: start;
		padding: 0.2rem 0.6rem;
	}

	.remove-cue:hover {
		border-color: #f0453d;
	}
</style>
