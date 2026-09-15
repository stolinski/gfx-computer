<script lang="ts">
	import type { KineticWord } from '$lib/platform/engine-schema';

	interface Props {
		block: KineticWord;
	}

	let { block }: Props = $props();
</script>

<span
	class="kinetic-word"
	class:kinetic-word--display={block.hierarchy === 'display'}
	data-gfx-readable-id={`block:${block.id}:text`}
	data-gfx-readable-text={block.text}
	data-gfx-text-role={block.hierarchy === 'display' ? 'surface-display' : 'surface-title'}
	>{block.text}</span
>

<style>
	.kinetic-word {
		color: var(--kinetic-word-ink, var(--ink, currentColor));
		display: inline-block;
		font-family: var(--variableWeightFont, var(--font, sans-serif));
		font-size: calc(5.2 * var(--cqmin));
		font-synthesis: none;
		font-variation-settings: 'wght' var(--variableWeightRest, 600);
		font-weight: var(--variableWeightRest, 600);
		letter-spacing: -0.035em;
		line-height: 0.9;
		white-space: nowrap;
	}

	.kinetic-word--display {
		font-size: calc(15 * var(--cqmin));
		letter-spacing: -0.065em;
		line-height: 0.82;
	}
</style>
