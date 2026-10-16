<script lang="ts">
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import Field from '$lib/platform/Field.svelte';
	import OrientationCustomizeToggle from '$lib/platform/OrientationCustomizeToggle.svelte';
	import {
		TERMINAL_RUN_DEFAULT_LAYOUT,
		TERMINAL_RUN_DEFAULT_SIZES,
		TERMINAL_RUN_LINE_KINDS,
		type TerminalRunContent,
		type TerminalRunLayout
	} from './definition';

	let { overlay = $bindable() }: OverlayEditorProps<TerminalRunContent> = $props();

	const MAX_LINES = 40;
	const SIZE_FIELDS: { key: keyof typeof TERMINAL_RUN_DEFAULT_SIZES; label: string; max: number }[] = [
		{ key: 'textSize', label: 'Text size', max: 10 },
		{ key: 'titleSize', label: 'Title size', max: 10 },
		{ key: 'paddingX', label: 'Padding X', max: 20 },
		{ key: 'paddingY', label: 'Padding Y', max: 20 },
		{ key: 'radius', label: 'Corner', max: 10 }
	];

	const orientation = $derived(engineState.transport.orientation);
	const customLayout = $derived(overlay.content.orientationOverrides?.[orientation]);
	const layout = $derived<TerminalRunLayout>(
		customLayout ?? {
			x: overlay.content.x ?? TERMINAL_RUN_DEFAULT_LAYOUT.x,
			y: overlay.content.y ?? TERMINAL_RUN_DEFAULT_LAYOUT.y,
			width: overlay.content.width ?? TERMINAL_RUN_DEFAULT_LAYOUT.width,
			height: overlay.content.height ?? TERMINAL_RUN_DEFAULT_LAYOUT.height
		}
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

	function setLayout(field: keyof TerminalRunLayout, event: Event, min: number): void {
		const n = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(n)) return;
		const target: TerminalRunLayout = customLayout ?? overlay.content;
		target[field] = Math.max(min, Math.min(1, n));
	}

	function addLine(): void {
		const last = overlay.content.lines.at(-1);
		overlay.content.lines.push({ kind: 'output', text: 'output', at: Math.min(1, (last?.at ?? 0) + 0.04) });
	}
</script>

<Field label="Title">
	<input type="text" maxlength="48" bind:value={overlay.content.title} />
</Field>
<Field label="Prompt">
	<input type="text" maxlength="32" bind:value={overlay.content.prompt} />
</Field>
<Field label="Layout">
	<OrientationCustomizeToggle customized={customLayout !== undefined} onchange={toggleLayoutOverride} />
</Field>
<Field label="Place">
	<input type="number" aria-label="Left" min="0" max="1" step="0.01" value={layout.x} oninput={(e) => setLayout('x', e, 0)} />
	<input type="number" aria-label="Top" min="0" max="1" step="0.01" value={layout.y} oninput={(e) => setLayout('y', e, 0)} />
</Field>
<Field label="Size">
	<input type="number" aria-label="Width" min="0.2" max="1" step="0.01" value={layout.width} oninput={(e) => setLayout('width', e, 0.2)} />
	<input type="number" aria-label="Height" min="0.2" max="1" step="0.01" value={layout.height} oninput={(e) => setLayout('height', e, 0.2)} />
</Field>
{#each SIZE_FIELDS as field (field.key)}
	<Field label={field.label}>
		<input
			type="number"
			min="0"
			max={field.max}
			step="0.1"
			value={overlay.content[field.key] ?? TERMINAL_RUN_DEFAULT_SIZES[field.key]}
			oninput={(e) => {
				const n = Number((e.currentTarget as HTMLInputElement).value);
				if (Number.isFinite(n)) overlay.content[field.key] = Math.max(0, Math.min(field.max, n));
			}}
		/>
	</Field>
{/each}

{#each overlay.content.lines as line, index (index)}
	<Field label={`Line ${index + 1}`}>
		<select bind:value={line.kind}>
			{#each TERMINAL_RUN_LINE_KINDS as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>
		<input type="number" aria-label="Time" min="0" max="1" step="0.005" bind:value={line.at} />
		{#if overlay.content.lines.length > 1}
			<button type="button" onclick={() => overlay.content.lines.splice(index, 1)}>Remove</button>
		{/if}
	</Field>
	{#if line.kind !== 'prompt'}
		<Field label="Text">
			<input type="text" maxlength="72" bind:value={line.text} />
			{#if line.kind === 'command'}
				<input type="number" aria-label="Typing time" min="0.001" max="1" step="0.005" value={line.duration ?? 0.05} oninput={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(n) && n > 0) line.duration = Math.min(1, n); }} />
			{/if}
		</Field>
	{/if}
	{#if index > 0}
		<Field label="Redraws above">
			<input type="checkbox" checked={line.replaces ?? false} onchange={(e) => (line.replaces = (e.currentTarget as HTMLInputElement).checked || undefined)} />
		</Field>
	{/if}
{/each}
{#if overlay.content.lines.length < MAX_LINES}
	<button type="button" onclick={addLine}>Add line</button>
{/if}
