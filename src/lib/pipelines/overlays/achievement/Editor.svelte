<script lang="ts">
	import { engineState } from '$lib/platform/engine-state.svelte';
	import Field from '$lib/platform/Field.svelte';
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';

	import type { AchievementContent } from './achievement-content';
	import { ACHIEVEMENT_DEFAULT_WIDTH } from './achievement-frame-layout';
	import {
		isAchievementVariantId,
		setAchievementBeat,
		setAchievementVariant,
		VARIANT_IDS,
		VARIANTS
	} from './variants';

	let { overlay = $bindable() }: OverlayEditorProps<AchievementContent> = $props();

	type AchievementSizeField = 'minHeight' | 'titleSize' | 'kickerSize' | 'paddingX' | 'paddingY';

	// Sizes are the author's (ADR-0070); an emptied field returns to the card's own size.
	function setSize(field: AchievementSizeField, input: HTMLInputElement): void {
		overlay.content[field] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : undefined;
	}

	function setWidth(input: HTMLInputElement): void {
		const orientation = engineState.transport.orientation;
		const width = { ...overlay.content.width };
		width[orientation] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : undefined;
		overlay.content.width =
			width.horizontal === undefined && width.vertical === undefined ? undefined : width;
	}

	function updateVariant(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (isAchievementVariantId(value)) {
			setAchievementVariant(overlay.content, value);
		}
	}
</script>

<Field label="Variant">
	<select value={overlay.content.variant} onchange={updateVariant}>
		{#each VARIANT_IDS as variant (variant)}
			<option value={variant}>{VARIANTS[variant].label}</option>
		{/each}
	</select>
</Field>

<Field label="Kicker">
	<input bind:value={overlay.content.kicker} type="text" />
</Field>

<Field label="Title">
	<input bind:value={overlay.content.title} type="text" />
</Field>

<Field label="Completion beat">
	<input
		value={overlay.content.beat}
		oninput={(event) => setAchievementBeat(overlay.content, event.currentTarget.valueAsNumber)}
		type="number"
		min="0"
		max="1"
		step="0.0025"
	/>
</Field>

<Field label="Width">
	<input
		value={overlay.content.width?.[engineState.transport.orientation] ??
			ACHIEVEMENT_DEFAULT_WIDTH[engineState.transport.orientation]}
		oninput={(event) => setWidth(event.currentTarget)}
		type="number"
		min="0.1"
		max="1"
		step="0.01"
	/>
</Field>

<Field label="Min height">
	<input
		value={overlay.content.minHeight ?? ''}
		oninput={(event) => setSize('minHeight', event.currentTarget)}
		type="number"
		min="0"
		max="1"
		step="0.01"
		placeholder="auto"
	/>
</Field>

<Field label="Title size">
	<input
		value={overlay.content.titleSize ?? ''}
		oninput={(event) => setSize('titleSize', event.currentTarget)}
		type="number"
		min="0.5"
		max="20"
		step="0.1"
		placeholder="auto"
	/>
</Field>

<Field label="Kicker size">
	<input
		value={overlay.content.kickerSize ?? ''}
		oninput={(event) => setSize('kickerSize', event.currentTarget)}
		type="number"
		min="0.5"
		max="20"
		step="0.1"
		placeholder="auto"
	/>
</Field>

<Field label="Padding">
	<input
		aria-label="Padding left and right"
		value={overlay.content.paddingX ?? ''}
		oninput={(event) => setSize('paddingX', event.currentTarget)}
		type="number"
		min="0"
		max="20"
		step="0.1"
		placeholder="auto"
	/>
	<input
		aria-label="Padding top and bottom"
		value={overlay.content.paddingY ?? ''}
		oninput={(event) => setSize('paddingY', event.currentTarget)}
		type="number"
		min="0"
		max="20"
		step="0.1"
		placeholder="auto"
	/>
</Field>
