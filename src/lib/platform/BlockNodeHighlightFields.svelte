<script lang="ts">
	import { ENGINE_EASES, type DiagramNode, type Ease } from './engine-schema';
	import { parseUnitIntervalInput } from './stage-camera-editing';
	import Field from './Field.svelte';
	import InspectorToggle from './InspectorToggle.svelte';

	// A node's highlighter swipe (ADR-0036 amendment 2026-10-14): when it draws
	// on, and optionally when it lifts off again. A new swipe starts on the node's
	// entrance end, so turning it on marks the node the moment it lands.
	interface Props {
		primitive: DiagramNode;
	}

	let { primitive: el }: Props = $props();

	const easeOptions = Object.entries(ENGINE_EASES) as [Ease, (typeof ENGINE_EASES)[Ease]][];
	const NEW_SWIPE_DURATION = 0.04;

	function toggleHighlight(checked: boolean): void {
		if (!checked) {
			el.highlight = undefined;
			return;
		}
		const start = Math.min(1, (el.enter?.start ?? 0) + (el.enter?.duration ?? 0));
		el.highlight = {
			start,
			duration: Math.min(NEW_SWIPE_DURATION, 1 - start),
			ease: 'smooth'
		};
	}

	function toggleLift(checked: boolean): void {
		const highlight = el.highlight;
		if (!highlight) return;
		if (!checked) {
			highlight.lift = undefined;
			return;
		}
		const start = Math.min(1, highlight.start + highlight.duration);
		highlight.lift = {
			start,
			duration: Math.min(NEW_SWIPE_DURATION, 1 - start),
			ease: 'smooth'
		};
	}
</script>

{#snippet windowFields(label: string, window: { start: number; duration: number; ease: Ease })}
	<Field {label}>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${label} start`}
			value={window.start}
			oninput={(e) => {
				const n = parseUnitIntervalInput((e.currentTarget as HTMLInputElement).value);
				if (n !== null) window.start = n;
			}}
		/>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${label} duration`}
			value={window.duration}
			oninput={(e) => {
				const n = parseUnitIntervalInput((e.currentTarget as HTMLInputElement).value);
				if (n !== null) window.duration = n;
			}}
		/>
		<select
			aria-label={`${label} ease`}
			value={window.ease}
			onchange={(e) => {
				window.ease = (e.currentTarget as HTMLSelectElement).value as Ease;
			}}
		>
			{#each easeOptions as [value, opt] (value)}
				<option {value}>{opt.label}</option>
			{/each}
		</select>
	</Field>
{/snippet}

<Field label="Highlight">
	<InspectorToggle checked={!!el.highlight} label="Highlighter swipe" onchange={toggleHighlight} />
</Field>
{#if el.highlight}
	{@render windowFields('Swipe', el.highlight)}
	<Field label="Lift">
		<InspectorToggle checked={!!el.highlight.lift} label="Lift the swipe" onchange={toggleLift} />
	</Field>
	{#if el.highlight.lift}
		{@render windowFields('Lift', el.highlight.lift)}
	{/if}
{/if}
