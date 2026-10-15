<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import {
		NODE_DEFAULT_BORDER_WIDTH,
		NODE_DEFAULT_FONT_SIZE,
		NODE_DEFAULT_PADDING_X,
		NODE_DEFAULT_PADDING_Y,
		type DiagramNode
	} from '$lib/platform/engine-schema';
	import { diagramNodeHighlightSpanAt } from '$lib/utils/diagram-node-highlight';

	interface Props {
		block: DiagramNode;
	}

	let { block }: Props = $props();

	const highlightSpan = $derived(
		block.highlight ? diagramNodeHighlightSpanAt(block.highlight, animState.globalProgress) : null
	);
	// Once most of the word is under the marker, the word takes the marker's ink.
	const isHighlighted = $derived(
		highlightSpan !== null && highlightSpan.to - highlightSpan.from > 0.5
	);
</script>

{#snippet highlighter()}
	{#if highlightSpan && highlightSpan.to > highlightSpan.from}
		<span
			class="node__highlight"
			aria-hidden="true"
			style:inset-inline-start="{highlightSpan.from * 100}%"
			style:inline-size="calc({(highlightSpan.to - highlightSpan.from) * 100}% + 0.44em)"
		></span>
	{/if}
{/snippet}

{#if block.form === 'box'}
	<span
		class="node node--box"
		style:--node-font-size={block.fontSize ?? NODE_DEFAULT_FONT_SIZE}
		style:--node-padding-x={block.paddingX ?? NODE_DEFAULT_PADDING_X}
		style:--node-padding-y={block.paddingY ?? NODE_DEFAULT_PADDING_Y}
		style:--node-border-width={block.borderWidth ?? NODE_DEFAULT_BORDER_WIDTH}
	>
		<span class="node__box-depth" aria-hidden="true"></span>
		<span
			class="node__box-face"
			class:node--highlighted={isHighlighted}
			data-diagram-text-role="caption"
			data-gfx-readable-id={`block:${block.id}:text`}
			data-gfx-readable-text={block.text ?? ''}
			data-gfx-text-role="diagram-caption"
			><span class="node__marked">{@render highlighter()}{block.text ?? ''}</span></span
		>
	</span>
{:else if block.form === 'pin'}
	<span class="node node--pin" style:--node-font-size={block.fontSize}>
		<!-- Shadow is an offset SVG path, never a CSS filter — filters promote
		     compositing layers, which drop out of the HTML-in-Canvas capture. -->
		<svg class="node__pin-mark" viewBox="0 0 52 65" aria-hidden="true">
			<path
				class="node__pin-shadow"
				d="M27 5C14.8 5 5 14.9 5 27.1 5 43.6 27 63 27 63s22-19.4 22-35.9C49 14.9 39.2 5 27 5Z"
			/>
			<path
				class="node__pin-body"
				d="M24 2C11.8 2 2 11.9 2 24.1 2 40.6 24 60 24 60s22-19.4 22-35.9C46 11.9 36.2 2 24 2Z"
			/>
			<circle class="node__pin-core" cx="24" cy="23" r="8.5" />
		</svg>
		{#if block.text}
			<span
				class="node__pin-text"
				class:node--highlighted={isHighlighted}
				data-diagram-text-role="caption"
				data-gfx-readable-id={`block:${block.id}:text`}
				data-gfx-readable-text={block.text}
				data-gfx-text-role="diagram-caption"
				><span class="node__marked">{@render highlighter()}{block.text}</span></span
			>
		{/if}
	</span>
{:else}
	<span class="node node--dot" style:--node-font-size={block.fontSize}>
		<span class="node__dot-mark"></span>
		{#if block.text}
			<span
				class="node__dot-text"
				class:node--highlighted={isHighlighted}
				data-diagram-text-role="caption"
				data-gfx-readable-id={`block:${block.id}:text`}
				data-gfx-readable-text={block.text}
				data-gfx-text-role="diagram-caption"
				><span class="node__marked">{@render highlighter()}{block.text}</span></span
			>
		{/if}
	</span>
{/if}

<style>
	.node {
		align-items: center;
		display: inline-flex;
		line-height: 1;
		white-space: nowrap;
	}

	/* Box — the flowchart card: Pack fill (mount-guaranteed, ADR-0024), a
	   structural backing plate plus continuous cast-shadow falloff, and ink that
	   follows the fill's luminance. The plate is geometry rather than a
	   zero-blur CSS shadow, preserving hard-offset Pack depth without claiming a
	   physically impossible hard-edged shadow. */
	.node--box {
		box-shadow: var(--node-shadow, none);
		color: var(--node-box-ink);
		font-size: calc(var(--node-font-size) * var(--cqmin));
		font-weight: var(--weight, 700);
		letter-spacing: var(--tracking, 0.01em);
		position: relative;
	}
	.node__box-depth,
	.node__box-face {
		box-sizing: border-box;
		inset: 0;
	}
	.node__box-depth {
		background: var(--node-depth-plate, transparent);
		position: absolute;
		translate: var(--node-depth-x, 0) var(--node-depth-y, 0);
	}
	.node__box-face {
		background: var(--fill);
		border: calc(var(--node-border-width) * var(--cqmin)) solid var(--node-box-ink);
		padding: calc(var(--node-padding-y) * var(--cqmin)) calc(var(--node-padding-x) * var(--cqmin));
		position: relative;
	}

	/* Pin — the map marker: Pack accent body, punched core. */
	.node--pin {
		flex-direction: column;
		gap: calc(0.7 * var(--cqmin));
	}

	.node__pin-mark {
		display: block;
		inline-size: calc(3.6 * var(--cqmin));
	}

	.node__pin-shadow {
		fill: rgb(0 0 0 / 0.4);
	}

	.node__pin-body {
		fill: var(--accent);
		stroke: var(--ink, currentColor);
		stroke-width: 3;
	}

	.node__pin-core {
		fill: var(--ink, currentColor);
	}

	.node__pin-text,
	.node__dot-text {
		font-family: var(--font, 'JetBrains Mono', ui-monospace, monospace);
		font-size: calc(var(--node-font-size, 2) * var(--cqmin));
		font-weight: 700;
		letter-spacing: 0.06em;
	}

	/* Highlight — a chisel-marker swipe behind the word, drawn on left to right.
	   Rotation and skew are transforms, never filters, so the swipe survives the
	   HTML-in-Canvas capture. */
	.node__marked {
		isolation: isolate;
		position: relative;
	}

	.node__highlight {
		background: var(--node-highlight);
		border-radius: 0.04em 0.16em 0.06em 0.2em;
		inset-block: 0.14em -0.02em;
		margin-inline-start: -0.22em;
		position: absolute;
		rotate: -1.6deg;
		transform: skewX(-6deg);
		z-index: -1;
	}

	.node--highlighted {
		color: var(--node-highlight-ink);
	}

	/* Dot — the quiet point marker. */
	.node--dot {
		gap: calc(1 * var(--cqmin));
	}

	.node__dot-mark {
		background: var(--accent);
		border: calc(0.24 * var(--cqmin)) solid var(--ink, currentColor);
		border-radius: 50%;
		block-size: calc(1.9 * var(--cqmin));
		display: inline-block;
		inline-size: calc(1.9 * var(--cqmin));
	}
</style>
