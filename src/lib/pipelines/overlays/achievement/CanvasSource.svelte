<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { cqminLength } from '$lib/utils/frame-relative-length';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	import { achievementFrameLayout } from './achievement-frame-layout';
	import type { AchievementContent } from './achievement-content';
	import { VARIANTS } from './variants';

	interface Props {
		content: AchievementContent;
	}

	let { content }: Props = $props();

	const variantId = $derived(content.variant ?? 'checklist-complete');
	const variant = $derived(VARIANTS[variantId]);
	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const layout = $derived(
		achievementFrameLayout(
			engineState.transport.orientation,
			frame.width,
			frame.height,
			content.width?.[engineState.transport.orientation]
		)
	);
	// Authored sizes (ADR-0070) win over the Pack's padding and the card's own
	// width-relative text sizes; absent, those stay as they are.
	const padding = $derived(
		content.paddingX === undefined && content.paddingY === undefined
			? undefined
			: `${cqminLength(content.paddingY) ?? '0.048em'} ${cqminLength(content.paddingX) ?? '0.058em'}`
	);
	const durationMs = $derived(engineState.transport.durationSeconds * 1000);
	const sinceBeatMs = $derived((animState.globalProgress - (content.beat ?? 0.3375)) * durationMs);
	const motion = $derived(variant.motionState(sinceBeatMs));
	const titleCompletion = $derived(variantId === 'checklist-complete' ? motion.completion : 0);
</script>

<aside
	class="achievement achievement--{variantId}"
	data-overlay="achievement"
	data-variant={variantId}
	data-gfx-shadow-owner="plate"
	style:inline-size={`${layout.width}px`}
	style:font-size={`${layout.width}px`}
	style:padding
	style:min-block-size={content.minHeight === undefined
		? undefined
		: `${Math.round(content.minHeight * frame.height)}px`}
>
	<span class="achievement__icon" aria-hidden="true">
		{#if variantId === 'checklist-complete'}
			<svg class="achievement__checkbox" viewBox="0 0 100 100">
				<rect
					class="achievement__box-fill"
					x="8"
					y="8"
					width="84"
					height="84"
					rx="14"
					style:opacity={motion.completion * 0.18}
				/>
				<rect x="8" y="8" width="84" height="84" rx="14" fill="none" />
				<path
					d="M25 52 L43 70 L77 32"
					fill="none"
					pathLength="1"
					stroke-dasharray="1"
					stroke-dashoffset={1 - motion.checkDraw}
				/>
			</svg>
		{:else}
			<svg
				class="achievement__medal"
				viewBox="0 0 100 100"
				style:opacity={motion.medalOpacity}
				style:scale={motion.medalScale}
			>
				<path class="achievement__medal-rim" d="M50 3 91 26v48L50 97 9 74V26Z" />
				<path class="achievement__medal-field" d="M50 14 81 32v36L50 86 19 68V32Z" />
				<path
					class="achievement__medal-spark"
					d="M50 24 57 42 76 50 57 58 50 76 43 58 24 50 43 42Z"
				/>
			</svg>
		{/if}
	</span>

	<span class="achievement__copy">
		<span
			data-gfx-readable-id="kicker"
			data-gfx-text-role="overlay-corner-secondary"
			class={['achievement__kicker', { 'achievement__kicker--chip': variantId === 'unlocked' }]}
			style:font-size={cqminLength(content.kickerSize)}
			style:opacity={variantId === 'unlocked' ? motion.chipOpacity : 1}
			style:scale={variantId === 'unlocked' ? motion.chipScale : 1}
		>
			{content.kicker}
		</span>
		<strong
			class="achievement__title"
			data-gfx-readable-id="title"
			data-gfx-text-role="overlay-corner-primary"
			style:font-size={cqminLength(content.titleSize)}
			style:color={`color-mix(in srgb, var(--ink) ${100 - titleCompletion * 28}%, var(--mutedInk, var(--ink)) ${titleCompletion * 28}%)`}
		>
			{content.title}
		</strong>
	</span>
</aside>

<style>
	.achievement {
		align-items: center;
		background: var(--plate, var(--fill));
		border: var(--border, 0.003em solid var(--ink));
		border-radius: var(--radius, 0.014em);
		box-shadow: var(--shadow, none);
		box-sizing: border-box;
		color: var(--ink);
		display: grid;
		font-family: var(--font, sans-serif);
		gap: var(--gap, 0.04em);
		grid-template-columns: 0.23fr 0.77fr;
		padding: var(--pad, 0.048em 0.058em);
	}

	.achievement--unlocked {
		grid-template-columns: 0.28fr 0.72fr;
	}

	.achievement__icon {
		display: grid;
		place-items: center;
	}

	.achievement__icon svg {
		display: block;
		inline-size: 72%;
		overflow: visible;
	}

	.achievement__checkbox rect:last-of-type {
		stroke: var(--borderInk, var(--ink));
		stroke-width: 7;
	}

	.achievement__box-fill {
		fill: var(--success, var(--accent));
	}

	.achievement__checkbox path {
		stroke: var(--success, var(--accent));
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 10;
	}

	.achievement__medal {
		transform-origin: center;
	}

	.achievement__medal-rim {
		fill: var(--accent);
		stroke: var(--borderInk, var(--ink));
		stroke-width: 4;
	}

	.achievement__medal-field {
		fill: var(--accentInk, var(--plate, var(--fill)));
	}

	.achievement__medal-spark {
		fill: var(--accent);
	}

	.achievement__copy {
		display: flex;
		flex-direction: column;
		gap: 0.012em;
		min-inline-size: 0;
	}

	.achievement__kicker {
		align-self: flex-start;
		color: var(--accent);
		font-family: var(--fontLabel, var(--font, monospace));
		font-size: 0.05em;
		font-weight: var(--kickerWeight, var(--weight, 700));
		letter-spacing: var(--tracking, 0.08em);
		line-height: 1.15;
		text-transform: uppercase;
		transform-origin: left center;
	}

	.achievement__kicker--chip {
		background: var(--accent);
		color: var(--accentInk, var(--plate, var(--fill)));
		padding: 0.32em 0.5em 0.36em;
	}

	.achievement__title {
		color: var(--ink);
		font-size: 0.084em;
		font-weight: var(--weight, 700);
		letter-spacing: -0.02em;
		line-height: 1.05;
		overflow-wrap: anywhere;
	}

	.achievement--unlocked .achievement__icon svg {
		inline-size: 86%;
	}

	.achievement--unlocked .achievement__copy {
		gap: 0.016em;
	}

	.achievement--unlocked .achievement__kicker {
		font-size: 0.05em;
	}

	.achievement--unlocked .achievement__title {
		font-size: 0.084em;
	}
</style>
