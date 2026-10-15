<script lang="ts">
	import type { DiagramPrimitive } from './engine-schema';
	import BlockCodeFields from './BlockCodeFields.svelte';
	import BlockNodeHighlightFields from './BlockNodeHighlightFields.svelte';
	import BlockNodeLogoField from './BlockNodeLogoField.svelte';
	import BlockStatCalloutFields from './BlockStatCalloutFields.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';

	// The Block's content fields, per primitive type (ADR-0036 §7): node form,
	// text, logo, and highlighter swipe, label text, the stat roll's numbers/format/caption/window, edge
	// direction, and the shared Ink role. Stroke appearance never appears here
	// (it is the Pack's, not the composition's).
	interface Props {
		primitive: DiagramPrimitive;
	}

	let { primitive: el }: Props = $props();
</script>

<InspectorSection label={el.type}>
	{#if el.type === 'node'}
		<Field label="Form">
			<select
				value={el.form}
				onchange={(e) => {
					el.form = (e.currentTarget as HTMLSelectElement).value as typeof el.form;
				}}
			>
				<option value="box">box</option>
				<option value="pin">pin</option>
				<option value="dot">dot</option>
			</select>
		</Field>
		<Field label="Text">
			<input
				type="text"
				value={el.text ?? ''}
				oninput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					el.text = v.length > 0 ? v : undefined;
				}}
			/>
		</Field>
		<BlockNodeLogoField primitive={el} />
		<BlockNodeHighlightFields primitive={el} />
	{:else if el.type === 'label'}
		<Field label="Text">
			<input
				type="text"
				value={el.text}
				oninput={(e) => {
					el.text = (e.currentTarget as HTMLInputElement).value;
				}}
			/>
		</Field>
		<Field label="Voice">
			<select
				value={el.role ?? 'caption'}
				onchange={(e) => {
					el.role =
						(e.currentTarget as HTMLSelectElement).value === 'headline' ? 'headline' : undefined;
				}}
			>
				<option value="caption">caption</option>
				<option value="headline">headline</option>
			</select>
		</Field>
	{:else if el.type === 'stat-callout'}
		<BlockStatCalloutFields primitive={el} />
	{:else if el.type === 'code'}
		<BlockCodeFields primitive={el} />
	{:else if el.type === 'edge-arrow'}
		<Field label="Direction">
			<select
				value={el.direction ?? 'forward'}
				onchange={(e) => {
					el.direction = (e.currentTarget as HTMLSelectElement).value as typeof el.direction;
				}}
			>
				<option value="forward">forward</option>
				<option value="both">both</option>
				<option value="none">none</option>
			</select>
		</Field>
	{:else}
		<Field label="Caption">
			<input
				type="text"
				value={el.label ?? ''}
				oninput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					el.label = v.length > 0 ? v : undefined;
				}}
			/>
		</Field>
	{/if}
	{#if el.type !== 'code'}
		<!-- Ink is a Role SELECTION (which pen), not appearance (what the pen looks
	     like — still the Pack's): 'accent' routes the primitive to the Pack's
	     core accent-treatment for emphasis hierarchy. -->
		<Field label="Ink">
			<select
				value={el.ink ?? 'ink'}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					el.ink = v === 'accent' ? 'accent' : undefined;
				}}
			>
				<option value="ink">ink</option>
				<option value="accent">accent</option>
			</select>
		</Field>
	{/if}
</InspectorSection>
