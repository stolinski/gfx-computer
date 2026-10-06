<script lang="ts">
	import {
		defaultItemEnter,
		defaultStrikeWindow
	} from '$lib/pipelines/surfaces/checklist/schedule';
	import { engineState } from './engine-state.svelte';
	import type { ChecklistItem } from './engine-schema';
	import { layerSelection } from './selection.svelte';
	import { parseTimelineTrackId } from './timeline-entity-identity';
	import { uploadUserImage } from '$lib/platform/user-image-upload-transport';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import Field from './Field.svelte';

	// The checklist items editor (ADR-0040): per-item text / checked /
	// static-vs-animated strike / build-in, plus the card logo. Per-item strike
	// timing stays on the checklist-item timeline tracks.
	const items = $derived(engineState.surface.content.items ?? []);

	// A selected checklist-item timeline row (canvas item click or timeline
	// gutter) highlights its item entry.
	const selectedItemIndex = $derived.by(() => {
		const identity = layerSelection.id ? parseTimelineTrackId(layerSelection.id) : null;
		return identity?.kind === 'checklist-item' ? identity.index : null;
	});

	let logoUploadSequence = 0;

	async function handleLogoFileChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const uploadSequence = ++logoUploadSequence;
		input.setCustomValidity('');
		const file = input.files?.[0];
		if (!file) return;

		try {
			const logoUrl = await uploadUserImage(file);
			if (uploadSequence === logoUploadSequence) {
				engineState.surface.content.logoUrl = logoUrl;
			}
		} catch (error: unknown) {
			console.error('Logo image upload failed', error);
			if (uploadSequence === logoUploadSequence) {
				input.setCustomValidity(
					error instanceof Error ? error.message : 'Logo image upload failed'
				);
				input.reportValidity();
			}
		} finally {
			input.value = '';
		}
	}

	function addItem(): void {
		const list = (engineState.surface.content.items ??= []);
		// In a build-in list, a new item builds in too — staggered after the
		// others — so it animates on and lands on the timeline like its siblings,
		// not a bare item that only appears in the canvas.
		const buildsIn = list.some((item) => item.enter !== undefined);
		list.push({
			text: '',
			checked: false,
			...(buildsIn ? { enter: defaultItemEnter(list.length) } : {})
		});
	}

	function removeItem(index: number): void {
		engineState.surface.content.items?.splice(index, 1);
	}

	// Unchecking strips a stale strike window — an unchecked item carries no
	// strike at all (the schema's contract).
	function itemCheckedToggle(item: ChecklistItem, checked: boolean): void {
		item.checked = checked;
		if (!checked) {
			item.strike = undefined;
		}
	}

	// Static = no window (fully struck from frame 0); Animated materializes the
	// default mid-clip draw-on window, re-timed on the item's timeline track.
	function itemStrikeModeChange(item: ChecklistItem, value: string): void {
		item.strike = value === 'animated' ? (item.strike ?? defaultStrikeWindow()) : undefined;
	}

	// Build-in: the item reveals on its own staggered entrance (the list builds
	// up one item at a time); off = present from the block entrance. Timing is
	// then a draggable clip on the item's timeline row.
	function itemBuildInToggle(item: ChecklistItem, index: number, buildsIn: boolean): void {
		item.enter = buildsIn ? (item.enter ?? defaultItemEnter(index)) : undefined;
	}
</script>

<InspectorSection label="Checklist">
	<Field label="Logo">
		<input
			accept="image/png,image/jpeg,image/webp"
			aria-label="Choose logo image"
			onchange={handleLogoFileChange}
			type="file"
		/>
		{#if engineState.surface.content.logoUrl}
			<button
				type="button"
				class="clear-btn"
				aria-label="Remove logo"
				onclick={() => (engineState.surface.content.logoUrl = undefined)}>×</button
			>
		{/if}
	</Field>
	{#each items as item, index (index)}
		<div class="item-entry" class:item-entry--selected={selectedItemIndex === index} data-item-row={index}>
			<div class="item-entry__header">
				<span class="item-entry__num">{index + 1}</span>
				<input type="text" aria-label={`Item ${index + 1} text`} bind:value={item.text} />
				<button
					type="button"
					class="remove-btn"
					aria-label={`Remove item ${index + 1}`}
					onclick={() => removeItem(index)}>×</button
				>
			</div>
			<Field label="Build in">
				<InspectorToggle
					checked={item.enter !== undefined}
					label={`Item ${index + 1} builds in`}
					onchange={(buildsIn) => itemBuildInToggle(item, index, buildsIn)}
				/>
			</Field>
			<Field label="Checked">
				<InspectorToggle
					checked={item.checked}
					label={`Item ${index + 1} checked`}
					onchange={(checked) => itemCheckedToggle(item, checked)}
				/>
			</Field>
			{#if item.checked}
				<Field label="Strike">
					<select
						value={item.strike ? 'animated' : 'static'}
						onchange={(e) => itemStrikeModeChange(item, (e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="static">Static (struck at open)</option>
						<option value="animated">Animated (draws on cue)</option>
					</select>
				</Field>
			{/if}
		</div>
	{/each}
	<button type="button" class="ins-add" onclick={addItem}>+ Add item</button>
</InspectorSection>

<style>
	/* A checklist item entry: hairline-separated sub-group, per task. */
	.item-entry {
		border-block-start: 1px solid var(--chrome-hairline);
		border-inline-start: 2px solid transparent;
		display: grid;
		gap: var(--vs-xs);
		padding-block-start: var(--vs-s);
		padding-inline-start: var(--vs-xs);
	}

	.item-entry--selected {
		border-inline-start-color: #ffd608;
	}

	.item-entry__header {
		align-items: center;
		display: flex;
		gap: var(--vs-xs);
	}

	.item-entry__header input {
		flex: 1 1 auto;
	}

	.item-entry__num {
		color: var(--chrome-muted);
		flex: none;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}

	.remove-btn,
	.clear-btn {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex: none;
		font-size: 1rem;
		line-height: 1;
		padding: 0 var(--vs-xs);
	}

	.remove-btn:hover,
	.clear-btn:hover {
		color: #f0453d;
	}
</style>
