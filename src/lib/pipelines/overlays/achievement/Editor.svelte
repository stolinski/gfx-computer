<script lang="ts">
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { findStringOption } from '$lib/utils/string';
	import Field from '$lib/platform/Field.svelte';
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';

	import type { AchievementContent } from './achievement-content';
	import { ACHIEVEMENT_DEFAULT_WIDTH } from './achievement-frame-layout';
	import { ACHIEVEMENT_MOTION_DEFINITIONS, ACHIEVEMENT_MOTIONS } from './achievement-motion';
	import {
		ACHIEVEMENT_ICONS,
		ACHIEVEMENT_KICKER_STYLES,
		resolveAchievementStyle,
		setAchievementBeat,
		setAchievementStyle
	} from './achievement-style';

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

	const style = $derived(resolveAchievementStyle(overlay.content));
</script>

<Field label="Icon">
	<select
		value={style.icon}
		onchange={(event) => {
			const icon = findStringOption(ACHIEVEMENT_ICONS, event.currentTarget.value);
			if (icon) setAchievementStyle(overlay.content, { icon });
		}}
	>
		{#each ACHIEVEMENT_ICONS as icon (icon)}
			<option value={icon}>{icon}</option>
		{/each}
	</select>
</Field>

<Field label="Kicker style">
	<select
		value={style.kickerStyle}
		onchange={(event) => {
			const kickerStyle = findStringOption(ACHIEVEMENT_KICKER_STYLES, event.currentTarget.value);
			if (kickerStyle) setAchievementStyle(overlay.content, { kickerStyle });
		}}
	>
		{#each ACHIEVEMENT_KICKER_STYLES as kickerStyle (kickerStyle)}
			<option value={kickerStyle}>{kickerStyle}</option>
		{/each}
	</select>
</Field>

<Field label="Motion">
	<select
		value={style.motion}
		onchange={(event) => {
			const motion = findStringOption(ACHIEVEMENT_MOTIONS, event.currentTarget.value);
			if (motion) setAchievementStyle(overlay.content, { motion });
		}}
	>
		{#each ACHIEVEMENT_MOTIONS as motion (motion)}
			<option value={motion}>{ACHIEVEMENT_MOTION_DEFINITIONS[motion].label}</option>
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
