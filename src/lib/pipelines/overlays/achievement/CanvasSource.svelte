<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { cqminLength } from '$lib/utils/frame-relative-length';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	import { achievementFrameLayout } from './achievement-frame-layout';
	import type { AchievementContent } from './achievement-content';
	import { ACHIEVEMENT_MOTION_DEFINITIONS } from './achievement-motion';
	import { resolveAchievementStyle } from './achievement-style';

	interface Props {
		content: AchievementContent;
	}

	let { content }: Props = $props();

	const style = $derived(resolveAchievementStyle(content));
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
	const motion = $derived(ACHIEVEMENT_MOTION_DEFINITIONS[style.motion].motionState(sinceBeatMs));
</script>

<aside
	class="achievement"
	data-overlay="achievement"
	data-icon={style.icon}
	data-motion={style.motion}
	data-gfx-shadow-owner="plate"
	style:inline-size={`${layout.width}px`}
	style:font-size={`${layout.width}px`}
	style:padding
	style:min-block-size={content.minHeight === undefined
		? undefined
		: `${Math.round(content.minHeight * frame.height)}px`}
>
	{#if style.icon !== 'none'}
		<!-- An empty ring in border ink; at the beat the glyph arrives and the ring
		     takes its done colour. -->
		<span class="achievement__icon" aria-hidden="true">
			<svg viewBox="0 0 100 100" style:opacity={motion.iconOpacity} style:scale={motion.iconScale}>
				<circle class="achievement__ring" cx="50" cy="50" r="44" />
				<circle
					class="achievement__ring achievement__ring--done"
					cx="50"
					cy="50"
					r="44"
					style:opacity={motion.completion}
				/>
				{#if style.icon === 'check'}
					<path
						class="achievement__check"
						d="M30 52 L45 66 L71 37"
						pathLength="1"
						stroke-dasharray="1"
						stroke-dashoffset={1 - motion.glyphDraw}
					/>
				{:else}
					<path
						class="achievement__star"
						d="M50 26 56.5 42 73 43.5 60.5 54.5 64.5 71 50 62 35.5 71 39.5 54.5 27 43.5 43.5 42Z"
						style:opacity={motion.glyphDraw}
					/>
				{/if}
			</svg>
		</span>
	{/if}

	<span class="achievement__copy">
		<span
			data-gfx-readable-id="kicker"
			data-gfx-text-role="overlay-corner-secondary"
			class={['achievement__kicker', { 'achievement__kicker--chip': style.kickerStyle === 'chip' }]}
			style:font-size={cqminLength(content.kickerSize)}
			style:opacity={motion.kickerOpacity}
			style:scale={motion.kickerScale}
		>
			{content.kicker}
		</span>
		<strong
			class="achievement__title"
			data-gfx-readable-id="title"
			data-gfx-text-role="overlay-corner-primary"
			style:font-size={cqminLength(content.titleSize)}
			style:color={`color-mix(in srgb, var(--ink) ${100 - motion.titleQuiet * 28}%, var(--mutedInk, var(--ink)) ${motion.titleQuiet * 28}%)`}
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

	.achievement[data-icon='none'] {
		grid-template-columns: 1fr;
	}

	.achievement__icon {
		display: grid;
		place-items: center;
	}

	.achievement__icon svg {
		display: block;
		inline-size: 72%;
		overflow: visible;
		transform-origin: center;
	}

	.achievement__ring {
		fill: none;
		stroke: var(--borderInk, var(--ink));
		stroke-width: 7;
	}

	/* A check is success; a star is the Pack's accent. */
	.achievement__ring--done {
		stroke: var(--success, var(--accent));
	}

	.achievement[data-icon='star'] .achievement__ring--done {
		stroke: var(--accent);
	}

	.achievement__check {
		fill: none;
		stroke: var(--success, var(--accent));
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 9;
	}

	.achievement__star {
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
</style>
