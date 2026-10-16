<script lang="ts">
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import Field from '$lib/platform/Field.svelte';
	import OrientationCustomizeToggle from '$lib/platform/OrientationCustomizeToggle.svelte';
	import { resolveDuplicatePileupLayout } from '$lib/utils/duplicate-pileup-scene';
	import {
		DUPLICATE_PILEUP_ARRANGEMENTS,
		DUPLICATE_PILEUP_DEFAULT_LAYOUT,
		DUPLICATE_PILEUP_DEFAULT_SIZES,
		DUPLICATE_PILEUP_PANEL_KINDS,
		type DuplicatePileupContent,
		type DuplicatePileupLayout
	} from './definition';

	let { overlay = $bindable() }: OverlayEditorProps<DuplicatePileupContent> = $props();

	const MAX_PANELS = 3;
	const MAX_COPIES = 12;
	const SIZE_FIELDS: { key: keyof typeof DUPLICATE_PILEUP_DEFAULT_SIZES; label: string; max: number }[] = [
		{ key: 'textSize', label: 'Text size', max: 10 },
		{ key: 'titleSize', label: 'Title size', max: 10 },
		{ key: 'labelSize', label: 'Stamp size', max: 12 },
		{ key: 'paddingX', label: 'Padding X', max: 20 },
		{ key: 'paddingY', label: 'Padding Y', max: 20 },
		{ key: 'gap', label: 'Gap', max: 20 },
		{ key: 'radius', label: 'Corner', max: 10 }
	];

	const orientation = $derived(engineState.transport.orientation);
	const customLayout = $derived(overlay.content.orientationOverrides?.[orientation]);
	const layout = $derived(
		resolveDuplicatePileupLayout(
			{
				x: overlay.content.x ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.x,
				y: overlay.content.y ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.y,
				width: overlay.content.width ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.width,
				height: overlay.content.height ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.height,
				arrangement: overlay.content.arrangement ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.arrangement
			},
			overlay.content.orientationOverrides,
			orientation
		)
	);

	// Customize copies the layout this orientation shows now into its own
	// snapshot; turning it off returns the orientation to the shared layout.
	function toggleLayoutOverride(checked: boolean): void {
		const overrides = { ...overlay.content.orientationOverrides };
		if (checked) overrides[orientation] = { ...layout };
		else delete overrides[orientation];
		overlay.content.orientationOverrides =
			overrides.horizontal || overrides.vertical ? overrides : undefined;
	}

	function setLayout<K extends keyof DuplicatePileupLayout>(field: K, value: DuplicatePileupLayout[K]): void {
		const target: DuplicatePileupLayout = overlay.content.orientationOverrides?.[orientation] ?? overlay.content;
		target[field] = value;
	}

	function numberFrom(event: Event, min: number, max: number): number | undefined {
		const n = Number((event.currentTarget as HTMLInputElement).value);
		return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined;
	}

	function addPanel(): void {
		const last = overlay.content.panels.at(-1);
		const at = Math.min(1, (last?.at ?? 0) + 0.1);
		overlay.content.panels.push({ kind: 'inbox', title: 'Primary', at, item: 'Your report', copies: [at] });
	}
</script>

<Field label="Layout">
	<OrientationCustomizeToggle customized={customLayout !== undefined} onchange={toggleLayoutOverride} />
</Field>
<Field label="Place">
	<input type="number" aria-label="Left" min="0" max="1" step="0.01" value={layout.x} oninput={(e) => { const n = numberFrom(e, 0, 1); if (n !== undefined) setLayout('x', n); }} />
	<input type="number" aria-label="Top" min="0" max="1" step="0.01" value={layout.y} oninput={(e) => { const n = numberFrom(e, 0, 1); if (n !== undefined) setLayout('y', n); }} />
</Field>
<Field label="Panel size">
	<input type="number" aria-label="Width" min="0.1" max="1" step="0.01" value={layout.width} oninput={(e) => { const n = numberFrom(e, 0.1, 1); if (n !== undefined) setLayout('width', n); }} />
	<input type="number" aria-label="Height" min="0.1" max="1" step="0.01" value={layout.height} oninput={(e) => { const n = numberFrom(e, 0.1, 1); if (n !== undefined) setLayout('height', n); }} />
</Field>
<Field label="Arrange">
	<select value={layout.arrangement} onchange={(e) => setLayout('arrangement', (e.currentTarget as HTMLSelectElement).value as DuplicatePileupLayout['arrangement'])}>
		{#each DUPLICATE_PILEUP_ARRANGEMENTS as arrangement (arrangement)}
			<option value={arrangement}>{arrangement}</option>
		{/each}
	</select>
</Field>
{#each SIZE_FIELDS as field (field.key)}
	<Field label={field.label}>
		<input
			type="number"
			min="0"
			max={field.max}
			step="0.1"
			value={overlay.content[field.key] ?? DUPLICATE_PILEUP_DEFAULT_SIZES[field.key]}
			oninput={(e) => { const n = numberFrom(e, 0, field.max); if (n !== undefined) overlay.content[field.key] = n; }}
		/>
	</Field>
{/each}

<Field label="Restart">
	<input
		type="text"
		maxlength="32"
		value={overlay.content.restart?.label ?? ''}
		oninput={(e) => {
			const label = (e.currentTarget as HTMLInputElement).value;
			overlay.content.restart = label.length > 0 ? { label, at: overlay.content.restart?.at ?? 0.3 } : undefined;
		}}
	/>
	{#if overlay.content.restart}
		<input type="number" aria-label="Restart time" min="0" max="1" step="0.005" bind:value={overlay.content.restart.at} />
	{/if}
</Field>
<Field label="Collapse">
	<input
		type="text"
		maxlength="40"
		value={overlay.content.collapse?.label ?? ''}
		oninput={(e) => {
			const label = (e.currentTarget as HTMLInputElement).value;
			overlay.content.collapse = label.length > 0 ? { label, at: overlay.content.collapse?.at ?? 0.8 } : undefined;
		}}
	/>
	{#if overlay.content.collapse}
		<input type="number" aria-label="Collapse time" min="0" max="1" step="0.005" bind:value={overlay.content.collapse.at} />
	{/if}
</Field>

{#each overlay.content.panels as panel, index (index)}
	<Field label={`Panel ${index + 1}`}>
		<select bind:value={panel.kind}>
			{#each DUPLICATE_PILEUP_PANEL_KINDS as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>
		<input type="text" aria-label="Title" maxlength="24" bind:value={panel.title} />
		<input type="number" aria-label="Appears at" min="0" max="1" step="0.005" bind:value={panel.at} />
		{#if overlay.content.panels.length > 1}
			<button type="button" onclick={() => overlay.content.panels.splice(index, 1)}>Remove</button>
		{/if}
	</Field>
	<Field label="Item">
		<input type="text" aria-label="Item" maxlength="48" bind:value={panel.item} />
		<input type="text" aria-label="Meta" maxlength="40" value={panel.meta ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; panel.meta = v.length > 0 ? v : undefined; }} />
		{#if panel.kind === 'inbox'}
			<input type="text" aria-label="Snippet" maxlength="60" value={panel.snippet ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; panel.snippet = v.length > 0 ? v : undefined; }} />
			<input type="text" aria-label="Time" maxlength="12" value={panel.time ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; panel.time = v.length > 0 ? v : undefined; }} />
		{:else}
			<input type="text" aria-label="Label" maxlength="20" value={panel.label ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; panel.label = v.length > 0 ? v : undefined; }} />
			<input type="number" aria-label="First number" min="1" max="99999" step="1" value={panel.number ?? ''} oninput={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); panel.number = Number.isInteger(n) && n >= 1 ? Math.min(99999, n) : undefined; }} />
		{/if}
	</Field>
	{#each panel.copies.keys() as copyIndex (copyIndex)}
		<Field label={copyIndex === 0 ? 'Arrives' : `Copy ${copyIndex + 1}`}>
			<input type="number" min="0" max="1" step="0.005" bind:value={panel.copies[copyIndex]} />
			{#if panel.copies.length > 1}
				<button type="button" onclick={() => panel.copies.splice(copyIndex, 1)}>Remove</button>
			{/if}
		</Field>
	{/each}
	{#if panel.copies.length < MAX_COPIES}
		<button type="button" onclick={() => panel.copies.push(Math.min(1, (panel.copies.at(-1) ?? 0) + 0.03))}>Add copy</button>
	{/if}
{/each}
{#if overlay.content.panels.length < MAX_PANELS}
	<button type="button" onclick={addPanel}>Add panel</button>
{/if}
