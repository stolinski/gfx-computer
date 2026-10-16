<script lang="ts">
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import Field from '$lib/platform/Field.svelte';
	import OrientationCustomizeToggle from '$lib/platform/OrientationCustomizeToggle.svelte';
	import {
		ACTIONS_RUN_DEFAULT_LAYOUT,
		ACTIONS_RUN_DEFAULT_SIZES,
		type ActionsRunContent,
		type ActionsRunLayout
	} from './definition';

	let { overlay = $bindable() }: OverlayEditorProps<ActionsRunContent> = $props();

	const MAX_STEPS = 12;
	const MAX_TRIGGERS = 4;
	const SIZE_FIELDS: { key: keyof typeof ACTIONS_RUN_DEFAULT_SIZES; label: string; max: number }[] = [
		{ key: 'textSize', label: 'Text size', max: 10 },
		{ key: 'titleSize', label: 'Title size', max: 12 },
		{ key: 'paddingX', label: 'Padding X', max: 20 },
		{ key: 'paddingY', label: 'Padding Y', max: 20 },
		{ key: 'gap', label: 'Gap', max: 20 },
		{ key: 'radius', label: 'Corner', max: 10 }
	];

	const orientation = $derived(engineState.transport.orientation);
	const customLayout = $derived(overlay.content.orientationOverrides?.[orientation]);
	const layout = $derived<ActionsRunLayout>(
		customLayout ?? {
			x: overlay.content.x ?? ACTIONS_RUN_DEFAULT_LAYOUT.x,
			y: overlay.content.y ?? ACTIONS_RUN_DEFAULT_LAYOUT.y,
			width: overlay.content.width ?? ACTIONS_RUN_DEFAULT_LAYOUT.width,
			height: overlay.content.height ?? ACTIONS_RUN_DEFAULT_LAYOUT.height
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

	function setLayout(field: keyof ActionsRunLayout, event: Event, min: number): void {
		const n = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(n)) return;
		const target: ActionsRunLayout = customLayout ?? overlay.content;
		target[field] = Math.max(min, Math.min(1, n));
	}

	function setOptionalFraction(event: Event): number | undefined {
		const raw = (event.currentTarget as HTMLInputElement).value;
		const n = Number(raw);
		return raw.length > 0 && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
	}
</script>

<Field label="Repository">
	<input type="text" maxlength="40" bind:value={overlay.content.repository} />
</Field>
<Field label="Workflow">
	<input type="text" maxlength="32" bind:value={overlay.content.workflow} />
	<input type="number" aria-label="Run number" min="1" max="99999" step="1" bind:value={overlay.content.runNumber} />
</Field>
<Field label="Title">
	<input type="text" maxlength="48" bind:value={overlay.content.title} />
</Field>
<Field label="Job">
	<input type="text" maxlength="32" bind:value={overlay.content.job} />
</Field>
<Field label="Clock ×">
	<input type="number" min="1" max="600" step="1" bind:value={overlay.content.timeScale} />
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
			value={overlay.content[field.key] ?? ACTIONS_RUN_DEFAULT_SIZES[field.key]}
			oninput={(e) => {
				const n = Number((e.currentTarget as HTMLInputElement).value);
				if (Number.isFinite(n)) overlay.content[field.key] = Math.max(0, Math.min(field.max, n));
			}}
		/>
	</Field>
{/each}

{#each overlay.content.triggers as trigger, index (index)}
	<Field label={`Trigger ${index + 1}`}>
		<input type="text" maxlength="40" bind:value={trigger.text} />
		<input type="number" aria-label="Time" min="0" max="1" step="0.005" bind:value={trigger.at} />
		{#if overlay.content.triggers.length > 1}
			<button type="button" onclick={() => overlay.content.triggers.splice(index, 1)}>Remove</button>
		{/if}
	</Field>
{/each}
{#if overlay.content.triggers.length < MAX_TRIGGERS}
	<button type="button" onclick={() => overlay.content.triggers.push({ text: 'webhook', at: Math.min(1, (overlay.content.triggers.at(-1)?.at ?? 0) + 0.05) })}>Add trigger</button>
{/if}

{#each overlay.content.steps as step, index (index)}
	<Field label={`Step ${index + 1}`}>
		<input type="text" maxlength="40" bind:value={step.name} />
		<input type="number" aria-label="Starts" min="0" max="1" step="0.005" bind:value={step.at} />
		<input type="number" aria-label="Runs again at" min="0" max="1" step="0.005" value={step.rerunAt ?? ''} oninput={(e) => (step.rerunAt = setOptionalFraction(e))} />
		{#if overlay.content.steps.length > 1}
			<button type="button" onclick={() => overlay.content.steps.splice(index, 1)}>Remove</button>
		{/if}
	</Field>
{/each}
{#if overlay.content.steps.length < MAX_STEPS}
	<button type="button" onclick={() => overlay.content.steps.push({ name: 'Next step', at: Math.min(1, (overlay.content.steps.at(-1)?.at ?? 0) + 0.05) })}>Add step</button>
{/if}

<Field label="Crash">
	<input
		type="text"
		maxlength="64"
		value={overlay.content.crash?.message ?? ''}
		oninput={(e) => {
			const message = (e.currentTarget as HTMLInputElement).value;
			overlay.content.crash = message.length > 0 ? { at: overlay.content.crash?.at ?? 0.5, message, clock: overlay.content.crash?.clock } : undefined;
		}}
	/>
	{#if overlay.content.crash}
		<input type="number" aria-label="Crash time" min="0" max="1" step="0.005" bind:value={overlay.content.crash.at} />
		<input type="text" aria-label="Clock" maxlength="12" value={overlay.content.crash.clock ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; if (overlay.content.crash) overlay.content.crash.clock = v.length > 0 ? v : undefined; }} />
	{/if}
</Field>
<Field label="Resume">
	<input
		type="text"
		maxlength="48"
		value={overlay.content.resume?.label ?? ''}
		oninput={(e) => {
			const label = (e.currentTarget as HTMLInputElement).value;
			overlay.content.resume = label.length > 0 ? { at: overlay.content.resume?.at ?? 0.7, label } : undefined;
		}}
	/>
	{#if overlay.content.resume}
		<input type="number" aria-label="Resume time" min="0" max="1" step="0.005" bind:value={overlay.content.resume.at} />
	{/if}
</Field>
<Field label="Finishes">
	<input type="number" min="0" max="1" step="0.005" value={overlay.content.finishAt ?? ''} oninput={(e) => (overlay.content.finishAt = setOptionalFraction(e))} />
</Field>
