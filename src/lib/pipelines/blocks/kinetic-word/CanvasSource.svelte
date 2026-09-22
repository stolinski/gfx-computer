<script lang="ts">
	import type { KineticWord } from '$lib/platform/engine-schema';
	import type { KineticWordGlyphFrame } from '$lib/utils/kinetic-word-glyphs';

	interface Props {
		block: KineticWord;
		/**
		 * Present while the word's `reveal` track is live: the word clips to its
		 * own line-box mask and each grapheme renders as an inline span carrying
		 * its own vertical mask offset. Inline (never inline-block) so the shaper
		 * still kerns across glyph boundaries.
		 */
		glyphs?: readonly KineticWordGlyphFrame[];
	}

	let { block, glyphs }: Props = $props();

	// A reveal of -1 parks the glyph one full mask height below its rest; the mask
	// is one line box plus the ascender/descender allowance the stylesheet pads.
	function glyphOffset(reveal: number): string | undefined {
		return reveal === 0 ? undefined : `calc(${-reveal} * (1lh + 0.44em))`;
	}
</script>

<span
	class="kinetic-word"
	class:kinetic-word--display={block.hierarchy === 'display'}
	class:kinetic-word--masked={glyphs !== undefined}
	data-gfx-readable-id={`block:${block.id}:text`}
	data-gfx-readable-text={block.text}
	data-gfx-text-role={block.hierarchy === 'display' ? 'surface-display' : 'surface-title'}
	>{#if glyphs}{#each glyphs as glyph, index (index)}<span
				class="kinetic-word__glyph"
				style:top={glyphOffset(glyph.reveal)}>{glyph.text}</span
			>{/each}{:else}{block.text}{/if}</span
>

<style>
	/* Placement pins ink, not the advance box: the mount measures the Pack
	   face's outer side bearings and its ink-versus-line-box centre, the margins
	   pull the box back by the bearings, and `top` re-centres the ink on `y`, so
	   a flush-left stack shows one flush edge and equal margins under every
	   face. The mask pads for overshoot and pulls back by the same amount, so
	   placement is unchanged. */
	.kinetic-word {
		color: var(--kinetic-word-ink, var(--ink, currentColor));
		display: block;
		font-family: var(--variableWeightFont, var(--font, sans-serif));
		font-size: calc(5.2 * var(--cqmin));
		font-synthesis: none;
		font-variation-settings: 'wght' var(--kinetic-word-weight, var(--variableWeightRest, 600));
		font-weight: var(--kinetic-word-weight, var(--variableWeightRest, 600));
		letter-spacing: var(--kinetic-word-letter-spacing, -0.035em);
		line-height: 0.9;
		margin-inline: calc(-1 * var(--kinetic-word-bearing-start, 0em))
			calc(-1 * var(--kinetic-word-bearing-end, 0em));
		position: relative;
		top: var(--kinetic-word-optical-y, 0em);
		white-space: nowrap;
	}

	.kinetic-word--display {
		font-size: calc(15 * var(--cqmin));
		letter-spacing: var(--kinetic-word-letter-spacing, -0.065em);
		line-height: 0.82;
	}

	.kinetic-word--masked {
		margin: -0.14em calc(-0.06em - var(--kinetic-word-bearing-end, 0em)) -0.3em
			calc(-0.06em - var(--kinetic-word-bearing-start, 0em));
		overflow: hidden;
		padding: 0.14em 0.06em 0.3em;
	}

	.kinetic-word__glyph {
		position: relative;
	}
</style>
