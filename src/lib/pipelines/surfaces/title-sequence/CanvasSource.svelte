<script lang="ts">
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	interface Props {
		element?: HTMLElement | null;
	}

	let { element = $bindable<HTMLElement | null>(null) }: Props = $props();

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const isVertical = $derived(engineState.transport.orientation === 'vertical');
	// Kicker size as a fraction of frame width, sized so the smallest-cap Pack
	// face (Sentry's, cap ≈ 0.70 em) clears the surface-label cap-height floor
	// (24 px horizontal, 32 px vertical): 0.022 × 2160 = 47.5 px → 33.3 px caps
	// in the tall frame. Matches the type-hero subtitle.
	const KICKER_SIZE_HORIZONTAL = 0.012;
	const KICKER_SIZE_VERTICAL = 0.022;

	const content = $derived(engineState.surface.content);
	const hasTitle = $derived((content.title ?? '').trim().length > 0);
	const hasKicker = $derived((content.kicker ?? '').trim().length > 0);
</script>

<!--
	No style:opacity here. copyElementImageToTexture cannot capture a DOM element's
	CSS opacity<1 (captures transparent — see docs/critic-captures/text-fade-bug-investigation.md);
	the article stays opaque and the title-sequence-drop shaderPass fades the captured
	surface by paperVisibility on the GPU.
-->
<article
	bind:this={element}
	class="title-sequence-source surface"
	style:block-size={`${frame.height}px`}
	style:inline-size={`${frame.width}px`}
>
	{#if hasKicker}
		{#key content.kicker}
			<span
				class="title-sequence-source__kicker"
				data-text-anim-slot="kicker"
				data-gfx-readable-id="surface:title-sequence:kicker"
				data-gfx-text-role="surface-label"
				style:font-size={`${frame.width * (isVertical ? KICKER_SIZE_VERTICAL : KICKER_SIZE_HORIZONTAL)}px`}
			>
				{content.kicker}
			</span>
		{/key}
	{/if}

	{#if hasTitle}
		{#key content.title}
			<h2
				class="title-sequence-source__title"
				data-text-anim-slot="title"
				data-gfx-readable-id="surface:title-sequence:title"
				data-gfx-text-role="surface-title"
				style:font-size={`${frame.width * 0.088}px`}
			>
				{content.title}
			</h2>
		{/key}
	{/if}
</article>

<style>
	/*
	 * Title-sequence Surface — layout only. The drop motion, motion-blur trail,
	 * impact flash, settle shake, and atmospheric backdrop all live in the
	 * shaderPass (title-sequence-drop). This CanvasSource renders the title
	 * statically at its resting position; the shader animates the text via
	 * UV offset, so the text appears to fall from above and land into view.
	 */
	.title-sequence-source {
		background-color: transparent;
		box-sizing: border-box;
		color: var(--ink);
		display: block;
		inset-block-start: 0;
		inset-inline-start: 0;
		position: relative;
	}

	/*
	 * Off-centre staging: the title block anchors to the lower-left as a
	 * left-aligned L (kicker → title share one left edge at 8%), leaving the
	 * upper-right — where the warm key glow sits (glowOrigin 0.82, 0.16) — as
	 * shaped negative space. Shadows fall down-left, agreeing with the key.
	 * The shader drops the captured text into this resting position.
	 */
	.title-sequence-source__kicker {
		/* Extra slot → chains to the accent core (kicker is accent-family), never a literal (ADR-0024). */
		color: var(--kicker, var(--accent));
		font-family: var(--fontLabel, var(--font, 'JetBrains Mono', ui-monospace, monospace));
		/* Pack status-voice drive (`title-sequence.kickerWeight` / `.kickerDim`):
		   an emissive Pack whose chrome eats small-text luminance must run its
		   kicker at full drive and weight to hold the G5 floor; silent → today's. */
		font-weight: var(--kickerWeight, 500);
		inset-block-start: 51%;
		inset-inline-start: 8%;
		/* Pack label dress (`title-sequence.tracking` / `.case`); the optical
		   indent equals the tracking so both ride `--tracking`; silent → today's. */
		letter-spacing: var(--tracking, 0.3em);
		opacity: var(--kickerDim, 0.88);
		padding-inline-start: var(--tracking, 0.3em);
		position: absolute;
		/* Pack shadow claim (`title-sequence.textShadow`); an emissive Pack
		   claims 'none' (depth is bloom); silent → today's. */
		text-shadow: var(--textShadow, -0.02em 0.04em 0.1em rgba(0, 0, 0, 0.85));
		text-transform: var(--case, uppercase);
		transform: translateY(-50%);
	}

	.title-sequence-source__title {
		color: var(--ink);
		font-family: var(--font, 'Inter', 'Helvetica Neue', system-ui, sans-serif);
		font-stretch: condensed;
		font-style: normal;
		/* Pack title weight (`title-sequence.weight`); silent → today's 900. */
		font-weight: var(--weight, 900);
		inline-size: 84%;
		inset-block-start: 63%;
		inset-inline-start: 8%;
		letter-spacing: -0.02em;
		line-height: 0.92;
		margin: 0;
		position: absolute;
		text-align: left;
		text-shadow: var(--textShadow, -0.03em 0.08em 0.18em rgba(0, 0, 0, 0.9));
		text-transform: uppercase;
		text-wrap: balance;
		transform: translateY(-50%);
	}
</style>
