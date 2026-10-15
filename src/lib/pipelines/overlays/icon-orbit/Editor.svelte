<script lang="ts">
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import Field from '$lib/platform/Field.svelte';
	import OrientationCustomizeToggle from '$lib/platform/OrientationCustomizeToggle.svelte';
	import { resolveIconOrbitRing, type IconOrbitRingValues } from '$lib/utils/icon-orbit-scene';
	import {
		ICON_ORBIT_DEFAULT_ICON_SIZE,
		ICON_ORBIT_DEFAULT_LABEL_SIZE,
		ICON_ORBIT_DEFAULT_STROKE_WIDTH,
		ICON_ORBIT_PASSES,
		type IconOrbitContent
	} from './definition';
	import { ICON_ORBIT_GLYPH_NAMES } from './icons';

	let { overlay = $bindable() }: OverlayEditorProps<IconOrbitContent> = $props();

	const MAX_ICONS = 12;

	const orientation = $derived(engineState.transport.orientation);
	const customRing = $derived(overlay.content.orientationOverrides?.[orientation]);
	const sharedRing = $derived<IconOrbitRingValues>({
		centerX: overlay.content.centerX ?? 0.5,
		radius: overlay.content.radius ?? 0.3,
		tilt: overlay.content.tilt ?? 0.18,
		iconSize: overlay.content.iconSize ?? ICON_ORBIT_DEFAULT_ICON_SIZE
	});
	const ring = $derived(
		resolveIconOrbitRing(sharedRing, overlay.content.orientationOverrides, orientation)
	);

	// Customize copies the ring this orientation shows now into its own
	// snapshot; turning it off returns the orientation to the shared ring.
	function toggleRingOverride(checked: boolean): void {
		const overrides = { ...overlay.content.orientationOverrides };
		if (checked) overrides[orientation] = { ...ring };
		else delete overrides[orientation];
		overlay.content.orientationOverrides =
			overrides.horizontal || overrides.vertical ? overrides : undefined;
	}

	function setRing(
		field: keyof IconOrbitRingValues,
		value: string,
		min: number,
		max: number
	): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		const clamped = Math.max(min, Math.min(max, n));
		const custom = overlay.content.orientationOverrides?.[orientation];
		if (custom) custom[field] = clamped;
		else overlay.content[field] = clamped;
	}

	function addIcon(): void {
		const icons = overlay.content.icons;
		const last = icons.at(-1);
		icons.push({
			icon: 'storage',
			launch: Math.min(1, (last?.launch ?? 0) + 0.08),
			launchX: 0.5,
			angle: -((last?.angle ?? 0) + 70),
			height: 0.3
		});
	}

	function removeIcon(index: number): void {
		overlay.content.icons.splice(index, 1);
	}
</script>

<Field label="Pass">
	<select bind:value={overlay.content.pass}>
		{#each ICON_ORBIT_PASSES as pass (pass)}
			<option value={pass}>{pass}</option>
		{/each}
	</select>
</Field>
<Field label="Ring">
	<OrientationCustomizeToggle customized={customRing !== undefined} onchange={toggleRingOverride} />
</Field>
<Field label="Centre">
	<input
		value={ring.centerX}
		oninput={(e) => setRing('centerX', (e.currentTarget as HTMLInputElement).value, 0, 1)}
		type="number"
		min="0"
		max="1"
		step="0.01"
	/>
</Field>
<Field label="Radius">
	<input
		value={ring.radius}
		oninput={(e) => setRing('radius', (e.currentTarget as HTMLInputElement).value, 0.05, 0.6)}
		type="number"
		min="0.05"
		max="0.6"
		step="0.01"
	/>
</Field>
<Field label="Tilt">
	<input
		value={ring.tilt}
		oninput={(e) => setRing('tilt', (e.currentTarget as HTMLInputElement).value, -0.4, 0.4)}
		type="number"
		min="-0.4"
		max="0.4"
		step="0.01"
	/>
</Field>
<Field label="Icon size">
	<input
		value={ring.iconSize}
		oninput={(e) => setRing('iconSize', (e.currentTarget as HTMLInputElement).value, 2, 40)}
		type="number"
		min="2"
		max="40"
		step="0.5"
	/>
</Field>
<Field label="Turn °/s">
	<input
		bind:value={overlay.content.turnDegreesPerSecond}
		type="number"
		min="-60"
		max="60"
		step="1"
	/>
</Field>
<Field label="Label size">
	<input
		value={overlay.content.labelSize ?? ICON_ORBIT_DEFAULT_LABEL_SIZE}
		oninput={(e) =>
			(overlay.content.labelSize = Number((e.currentTarget as HTMLInputElement).value))}
		type="number"
		min="0.5"
		max="10"
		step="0.1"
	/>
</Field>
<Field label="Stroke">
	<input
		value={overlay.content.strokeWidth ?? ICON_ORBIT_DEFAULT_STROKE_WIDTH}
		oninput={(e) =>
			(overlay.content.strokeWidth = Number((e.currentTarget as HTMLInputElement).value))}
		type="number"
		min="1"
		max="12"
		step="0.5"
	/>
</Field>
<Field label="Glow">
	<input bind:value={overlay.content.glow} type="number" min="0" max="2" step="0.05" />
</Field>
<Field label="Colour">
	<input
		type="color"
		value={overlay.content.color ?? '#9fd4ff'}
		oninput={(e) => (overlay.content.color = (e.currentTarget as HTMLInputElement).value)}
	/>
	{#if overlay.content.color}
		<button type="button" onclick={() => (overlay.content.color = undefined)}>Pack</button>
	{/if}
</Field>

{#each overlay.content.icons as icon, index (index)}
	<Field label={`Icon ${index + 1}`}>
		<select bind:value={icon.icon}>
			{#each ICON_ORBIT_GLYPH_NAMES as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
		<input
			type="text"
			aria-label={`Icon ${index + 1} label`}
			value={icon.label ?? ''}
			oninput={(e) => {
				const value = (e.currentTarget as HTMLInputElement).value;
				icon.label = value.length > 0 ? value : undefined;
			}}
		/>
		{#if overlay.content.icons.length > 1}
			<button type="button" onclick={() => removeIcon(index)}>Remove</button>
		{/if}
	</Field>
	<Field label="Launch">
		<input
			bind:value={icon.launch}
			type="number"
			min="0"
			max="1"
			step="0.01"
			aria-label="Launch time"
		/>
		<input
			bind:value={icon.launchX}
			type="number"
			min="0"
			max="1"
			step="0.01"
			aria-label="Launch from x"
		/>
	</Field>
	<Field label="Place">
		<input
			bind:value={icon.angle}
			type="number"
			min="-180"
			max="180"
			step="1"
			aria-label="Angle around you"
		/>
		<input bind:value={icon.height} type="number" min="0" max="1" step="0.01" aria-label="Height" />
	</Field>
{/each}
{#if overlay.content.icons.length < MAX_ICONS}
	<button type="button" onclick={addIcon}>Add icon</button>
{/if}
