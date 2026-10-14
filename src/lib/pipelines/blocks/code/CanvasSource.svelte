<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import type { DiagramCode } from '$lib/platform/engine-schema';
	import { engineState, packState } from '$lib/platform/engine-state.svelte';
	import { getPack } from '$lib/platform/packs/registry';
	import { resolveTypographyColors } from '$lib/platform/packs/resolve';
	import { codeFrameAt, layoutCodeWalkthrough } from '$lib/utils/code-tokens';

	interface Props {
		block: DiagramCode;
	}

	let { block }: Props = $props();

	// The Pack's paired fill and ink are the panel's only appearance input.
	const colors = $derived(resolveTypographyColors(getPack(packState.slug), engineState.typography));
	const layout = $derived(layoutCodeWalkthrough(block));
	const frame = $derived(codeFrameAt(block, layout, animState.globalProgress));
</script>

<!-- Tokens ride `left`/`top`, not transform: a transformed descendant span
     quantizes the item's opacity in the HTML-in-canvas capture. -->
<pre
	class="code-panel"
	style:--code-fill={colors.paperColor}
	style:--code-ink={colors.inkColor}
	style:--code-columns={layout.columns}
	style:--code-lines={layout.lines}
	data-gfx-readable-id={`block:${block.id}:code`}
	data-gfx-readable-text={block.steps[0].code}
	data-gfx-text-role="diagram-caption">{#each frame as token (token.key)}<span
			class="code-token"
			data-code-role={token.role}
			style:left={`calc(var(--code-pad-inline) + ${token.column} * 1ch)`}
			style:top={`calc(var(--code-pad-block) + ${token.line} * var(--code-leading))`}
			style:opacity={token.opacity}>{token.content}</span
		>{/each}</pre>

<style>
	.code-panel {
		--code-leading: 1.5em;
		--code-pad-block: 1.1em;
		--code-pad-inline: 1.4em;

		background: var(--code-fill);
		block-size: calc(var(--code-lines) * var(--code-leading));
		border-radius: 0.6em;
		box-sizing: content-box;
		color: var(--code-ink);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: calc(2.1 * var(--cqmin));
		/* One glyph per grid cell: a ligature would draw `=>` as one arrow. */
		font-variant-ligatures: none;
		font-weight: 500;
		inline-size: calc(var(--code-columns) * 1ch);
		line-height: var(--code-leading);
		margin: 0;
		padding: var(--code-pad-block) var(--code-pad-inline);
		position: relative;
		text-shadow: none;
		white-space: pre;
	}

	.code-token {
		position: absolute;
		white-space: pre;
	}

	/* Each role keeps the ink's lightness and takes its own hue, so contrast on
	   the fill holds under every Pack. Comments and punctuation recede toward
	   the fill instead of taking a hue. */
	.code-token[data-code-role='keyword'] {
		color: oklch(from var(--code-ink) clamp(0.42, l, 0.82) 0.15 305);
	}

	.code-token[data-code-role='string'] {
		color: oklch(from var(--code-ink) clamp(0.42, l, 0.82) 0.15 145);
	}

	.code-token[data-code-role='number'] {
		color: oklch(from var(--code-ink) clamp(0.42, l, 0.82) 0.15 60);
	}

	.code-token[data-code-role='function'] {
		color: oklch(from var(--code-ink) clamp(0.42, l, 0.82) 0.15 250);
	}

	.code-token[data-code-role='type'] {
		color: oklch(from var(--code-ink) clamp(0.42, l, 0.82) 0.15 195);
	}

	.code-token[data-code-role='property'] {
		color: oklch(from var(--code-ink) clamp(0.42, l, 0.82) 0.15 15);
	}

	.code-token[data-code-role='comment'] {
		color: color-mix(in oklab, var(--code-ink) 50%, var(--code-fill));
		font-style: italic;
	}

	.code-token[data-code-role='punctuation'] {
		color: color-mix(in oklab, var(--code-ink) 70%, var(--code-fill));
	}
</style>
