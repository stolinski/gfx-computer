<script lang="ts">
	import { getRgbColorChannels } from '$lib/utils/color';

	// One optional authored colour (ADR-0070): the swatch always shows the colour
	// that renders — the authored value when set, else the Pack's. Editing writes
	// the authored value; the reset, present only while one is set, returns the
	// element to its Pack colour. Hosts supply their own row and label.

	interface Props {
		/** The authored colour, or `undefined` while the Pack's colour renders. */
		value: string | undefined;
		/** The colour that renders without an authored value. */
		packColor: string;
		label: string;
		onchange: (value: string | undefined) => void;
	}

	let { value, packColor, label, onchange }: Props = $props();

	// <input type="color"> only accepts #rrggbb.
	const swatchValue = $derived.by(() => {
		try {
			const { red, green, blue } = getRgbColorChannels(value ?? packColor);
			return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
		} catch {
			return '#000000';
		}
	});
</script>

<input
	aria-label={label}
	value={swatchValue}
	oninput={(event) => onchange(event.currentTarget.value)}
	type="color"
/>
{#if value !== undefined}
	<button
		class="authored-color-reset"
		aria-label="Reset to Pack"
		title="Reset to Pack"
		onclick={() => onchange(undefined)}
	>
		<svg viewBox="0 0 12 12" aria-hidden="true">
			<path
				d="M6 2.2a3.8 3.8 0 1 1-3.5 2.4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.3"
				stroke-linecap="round"
			/>
			<path
				d="M2.1 1.5v3.1h3.1"
				fill="none"
				stroke="currentColor"
				stroke-width="1.3"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
{/if}

<style>
	.authored-color-reset {
		background: none;
		block-size: 1.1rem;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		display: grid;
		inline-size: 1.1rem;
		padding: 0;
		place-items: center;
		transition: color 120ms ease;
	}

	.authored-color-reset:hover {
		color: var(--chrome-text);
	}

	.authored-color-reset:focus-visible {
		outline: 1px solid #ffd608;
		outline-offset: 1px;
	}

	.authored-color-reset svg {
		block-size: 0.7rem;
		inline-size: 0.7rem;
	}
</style>
