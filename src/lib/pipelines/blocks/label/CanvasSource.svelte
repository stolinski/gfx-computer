<script lang="ts">
	import type { DiagramLabel } from '$lib/platform/engine-schema';

	interface Props {
		block: DiagramLabel;
	}

	let { block }: Props = $props();
</script>

<span
	class="diagram-label"
	class:diagram-label--explicit-wrap={block.wrap === 'explicit'}
	style:--label-font-size={block.fontSize}
	data-diagram-text-role={block.role ?? 'caption'}
	data-gfx-readable-id={`block:${block.id}:text`}
	data-gfx-readable-text={block.text}
	data-gfx-text-role={block.role === 'headline' ? 'diagram-headline' : 'diagram-caption'}
	>{block.text}</span
>

<style>
	/* A headline speaks in the label's Pack voice; a caption may take the Pack's
	   own caption face and style, else the same voice. An authored `fontSize`
	   (cqmin) replaces the role's native size. The primitive's live scale is
	   applied by the mount. */
	.diagram-label {
		color: var(--ink, currentColor);
		display: inline-block;
		font-family: var(--captionFont, var(--font, 'JetBrains Mono', ui-monospace, monospace));
		font-size: calc(var(--label-font-size, 2.75) * var(--cqmin));
		font-style: var(--captionStyle, normal);
		font-weight: 600;
		letter-spacing: 0.05em;
		line-height: 1.25;
		text-align: center;
		white-space: normal;
	}

	.diagram-label--explicit-wrap {
		white-space: pre-line;
	}

	.diagram-label[data-diagram-text-role='headline'] {
		font-family: var(--font, 'JetBrains Mono', ui-monospace, monospace);
		font-size: calc(var(--label-font-size, 5.1) * var(--cqmin));
		font-style: normal;
	}
</style>
