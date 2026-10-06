<script lang="ts">
	import { engineState, packState } from './engine-state.svelte';
	import { getPack } from './packs/registry';
	import { resolveTypographyColors } from './packs/resolve';
	import { getRgbColorChannels } from '$lib/utils/color';

	// The control cluster for one optional typography colour (ADR-0038):
	// the swatch always shows the colour that renders — the explicit override
	// when authored, else the active Pack's core fill/ink. Editing writes an
	// explicit override; the revert affordance (only present while overridden)
	// clears it back to the Pack. Hosts supply their own row/label wrapper.

	interface Props {
		/** Which optional typography colour override this input edits. */
		field: 'paperColor' | 'inkColor';
	}

	let { field }: Props = $props();

	const isOverridden = $derived(engineState.typography[field] !== undefined);
	const resolved = $derived(
		resolveTypographyColors(getPack(packState.slug), engineState.typography)[field]
	);

	// <input type="color"> only accepts #rrggbb — expand shorthand hexes.
	const swatchValue = $derived.by(() => {
		try {
			const { red, green, blue } = getRgbColorChannels(resolved);
			return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
		} catch {
			return resolved;
		}
	});

	function handleInput(event: Event): void {
		engineState.typography[field] = (event.currentTarget as HTMLInputElement).value;
	}

	function clearOverride(): void {
		engineState.typography[field] = undefined;
	}
</script>

<input value={swatchValue} oninput={handleInput} type="color" />
{#if isOverridden}
	<button class="typo-reset" aria-label="Reset to Pack" title="Reset to Pack" onclick={clearOverride}>
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
	/* Quiet ghost control at the row's control scale — its presence alone marks
	   the row as overridden (an inherited row shows just the swatch). */
	.typo-reset {
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

	.typo-reset:hover {
		color: var(--chrome-text);
	}

	.typo-reset:focus-visible {
		outline: 1px solid #ffd608;
		outline-offset: 1px;
	}

	.typo-reset svg {
		block-size: 0.7rem;
		inline-size: 0.7rem;
	}
</style>
