<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { resolveTerminalRunScene } from '$lib/utils/terminal-run-scene';
	import { getVideoFrameSize } from '$lib/utils/video-frame';
	import {
		TERMINAL_RUN_DEFAULT_LAYOUT,
		TERMINAL_RUN_DEFAULT_SIZES,
		type TerminalRunContent
	} from './definition';

	interface Props {
		content: TerminalRunContent;
	}

	let { content }: Props = $props();

	const LINE_HEIGHT = 1.55;

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const durationSeconds = $derived(engineState.transport.durationSeconds);
	const unit = $derived(Math.min(frame.width, frame.height) / 100);
	const layout = $derived(
		content.orientationOverrides?.[engineState.transport.orientation] ?? {
			x: content.x ?? TERMINAL_RUN_DEFAULT_LAYOUT.x,
			y: content.y ?? TERMINAL_RUN_DEFAULT_LAYOUT.y,
			width: content.width ?? TERMINAL_RUN_DEFAULT_LAYOUT.width,
			height: content.height ?? TERMINAL_RUN_DEFAULT_LAYOUT.height
		}
	);
	const sizes = $derived({
		textSize: content.textSize ?? TERMINAL_RUN_DEFAULT_SIZES.textSize,
		titleSize: content.titleSize ?? TERMINAL_RUN_DEFAULT_SIZES.titleSize,
		paddingX: content.paddingX ?? TERMINAL_RUN_DEFAULT_SIZES.paddingX,
		paddingY: content.paddingY ?? TERMINAL_RUN_DEFAULT_SIZES.paddingY,
		radius: content.radius ?? TERMINAL_RUN_DEFAULT_SIZES.radius
	});
	const titleBarHeight = $derived(sizes.titleSize * unit * 2.4);
	const visibleRows = $derived(
		Math.max(
			1,
			Math.floor(
				(layout.height * frame.height - titleBarHeight - sizes.paddingY * unit * 2) /
					(sizes.textSize * unit * LINE_HEIGHT)
			)
		)
	);
	const scene = $derived(
		resolveTerminalRunScene(
			content,
			animState.globalProgress * durationSeconds,
			durationSeconds,
			visibleRows
		)
	);

	function px(value: number): string {
		return `${value}px`;
	}
</script>

<div
	class="terminal-run"
	data-overlay="terminal-run"
	style:left={px(layout.x * frame.width)}
	style:top={px(layout.y * frame.height)}
	style:inline-size={px(layout.width * frame.width)}
	style:block-size={px(layout.height * frame.height)}
	style:border-radius={px(sizes.radius * unit)}
>
	<header
		class="terminal-run__bar"
		style:block-size={px(titleBarHeight)}
		style:font-size={px(sizes.titleSize * unit)}
		style:padding-inline={px(sizes.titleSize * unit)}
	>
		<span class="terminal-run__lights" aria-hidden="true">
			<span style:background="#ff5f57"></span>
			<span style:background="#febc2e"></span>
			<span style:background="#28c840"></span>
		</span>
		<span class="terminal-run__title">{content.title}</span>
	</header>
	<ol
		class="terminal-run__screen"
		style:font-size={px(sizes.textSize * unit)}
		style:line-height={LINE_HEIGHT}
		style:padding={`${px(sizes.paddingY * unit)} ${px(sizes.paddingX * unit)}`}
	>
		{#each scene.rows as row (row.key)}
			<li class={`terminal-run__line is-${row.kind}`} style:opacity={row.opacity} data-gfx-readable-id={row.key}>
				{#if row.kind === 'command' || row.kind === 'prompt'}<span class="terminal-run__prompt"
						>{`${content.prompt} `}</span
					>{/if}{#if row.mark}<span class={`terminal-run__mark is-${row.mark.kind}`}
						>{`${row.mark.glyph} `}</span
					>{/if}{row.text}{#if row.hasCursor}<span
						class="terminal-run__cursor"
						style:opacity={scene.isCursorLit ? 1 : 0}
					></span>{/if}
			</li>
		{/each}
	</ol>
</div>

<style>
	/* A macOS terminal window in a One Dark-style theme, literal under every Pack (a found document). */
	.terminal-run {
		background: #1b1d23;
		border: 0.08em solid #3a3d45;
		box-shadow:
			0 1.5em 4em rgb(0 0 0 / 0.55),
			0 0.2em 0.6em rgb(0 0 0 / 0.3);
		box-sizing: border-box;
		color: #d7dae0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		pointer-events: none;
		position: absolute;
	}

	/* The app's global type scale would shrink these; the window sets its own. */
	.terminal-run :global(:where(ol, li, span)) {
		font-size: inherit;
	}

	.terminal-run__bar {
		align-items: center;
		background: #2a2c33;
		border-block-end: 0.06em solid #121317;
		box-sizing: border-box;
		color: #9da3ad;
		display: flex;
		flex: none;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-weight: 600;
		position: relative;
	}

	.terminal-run__lights {
		display: flex;
		gap: 0.5em;
	}

	.terminal-run__lights span {
		block-size: 0.75em;
		border-radius: 50%;
		inline-size: 0.75em;
	}

	.terminal-run__title {
		inset-inline: 0;
		position: absolute;
		text-align: center;
	}

	.terminal-run__screen {
		flex: 1;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		list-style: none;
		margin: 0;
		min-block-size: 0;
		overflow: hidden;
	}

	.terminal-run__line {
		white-space: pre;
	}

	.terminal-run__line.is-dim,
	.terminal-run__line.is-restored {
		color: #7f848e;
	}

	.terminal-run__line.is-info {
		color: #61afef;
	}

	.terminal-run__line.is-success {
		color: #98c379;
		font-weight: 700;
	}

	.terminal-run__line.is-error {
		color: #e06c75;
		font-weight: 700;
	}

	.terminal-run__prompt {
		color: #98c379;
		font-weight: 700;
	}

	.terminal-run__mark.is-spinner {
		color: #e5c07b;
	}

	.terminal-run__mark.is-done {
		color: #98c379;
	}

	.terminal-run__mark.is-failed {
		color: #e06c75;
	}

	.terminal-run__mark.is-restored {
		color: #7f848e;
	}

	.terminal-run__cursor {
		background: #d7dae0;
		block-size: 1.15em;
		display: inline-block;
		inline-size: 0.6em;
		margin-inline-start: 0.05em;
		vertical-align: text-bottom;
	}
</style>
