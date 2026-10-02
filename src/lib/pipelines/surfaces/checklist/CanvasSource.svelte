<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { resolveChecklistCardLayout } from '$lib/utils/checklist-card-placement';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	import { itemRevealAt, strikeProgressAt } from './schedule';

	interface Props {
		element?: HTMLElement | null;
	}

	let { element = $bindable<HTMLElement | null>(null) }: Props = $props();

	// A half-frame progress tracker: title + numbered tasks in the RIGHT half of
	// the horizontal frame (footage lives left), reflowing to the BOTTOM half on
	// vertical — unless the composition places the card itself
	// (`surface.checklistCard`, per orientation; ADR-0039 §4), in which case it
	// enters from the side of the frame it sits on. Layout is stable — every item reserves its final space from
	// frame 0, so the red strike rules (drawn by the reused `strike` Annotation
	// off each item's data-annotation-mark span) stay pinned to their phrases
	// as check-offs land. The done-dim rides each item's strike progress
	// (schedule.ts), frame-deterministic off the global timeline progress —
	// preview == export. NO CSS filter (it pixelates the HTML-in-Canvas
	// capture); the dim is fractional opacity on an untransformed row (the
	// imessage typing-dots precedent — transformed roots quantize, rows don't).
	// `chrome: 'none'` (ADR-0037 mode, reused per ADR-0040) drops the card
	// plate/border/shadow for bare type with a hard offset legibility shadow.
	// Appearance resolves from the active Pack (SurfaceMount vars): --plate /
	// --ink / --accent colors, --border / --radius / --shadow card form,
	// --font / --fontLabel voices, --textShadow for the bare mode.
	// The block flies in FROM THE RIGHT (slides left to rest) — a horizontal
	// travel as a fraction of frame WIDTH. settled-place keeps a small overshoot.
	const ENTER_TRAVEL_RATIO = 0.06;
	// Completed items quiet down to this opacity as their strike lands.
	const DONE_DIM_OPACITY = 0.55;

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const isVertical = $derived(frame.height > frame.width);
	const content = $derived(engineState.surface.content);
	const items = $derived(content.items ?? []);
	const title = $derived((content.title ?? '').trim());
	const logoUrl = $derived((content.logoUrl ?? '').trim());
	let failedLogoUrl = $state('');
	// Read with `?? 'window'` — a schema `.default()` is NOT reliably applied at
	// runtime for pre-existing presets/state (the validateOverlayContents
	// precedent). 'window' = the card plate; 'none' = bare type over footage.
	const isBare = $derived((engineState.surface.chrome ?? 'window') === 'none');
	const p = $derived(Math.max(0, Math.min(1, animState.globalProgress)));

	const card = $derived(
		resolveChecklistCardLayout(engineState.surface, engineState.transport.orientation)
	);
	const layout = $derived.by(() => {
		const width = frame.width * card.width;
		const x = Math.round(frame.width * card.x);
		// settled-place: the raw visibility OVERSHOOTS 1 on the `settled` ease,
		// so the travel offset dips past rest then settles back — placed with
		// intent. Opacity clamps to [0, 1]. Positive offset = to the RIGHT of
		// rest, so the block enters from the right and slides left home; a card
		// placed on the left half mirrors it.
		const raw = animState.paperVisibility;
		const visibility = Math.max(0, Math.min(1, raw));
		const direction = card.enterFrom === 'left' ? -1 : 1;
		const enterOffsetPx = Math.round(direction * (1 - raw) * frame.width * ENTER_TRAVEL_RATIO);
		const top =
			card.anchor === 'top' || card.authored ? `${Math.round(frame.height * card.y)}px` : '50%';
		return { x, width, enterOffsetPx, visibility, top, direction };
	});

	const titleFontPx = $derived(Math.round(layout.width * (isVertical ? 0.06 : 0.068)));
	const itemFontPx = $derived(Math.round(layout.width * 0.055));
	const padPx = $derived(Math.round(layout.width * 0.06));
	// Logo lockup: a LARGE white circular chip in place of the title row. The
	// bare-mode legibility shadow is the same hard (no-blur) offset the text
	// rows carry, scaled to the chip.
	const logoPx = $derived(Math.round(layout.width * 0.3));
	const logoShadowPx = $derived(Math.round(logoPx * 0.045));

	// Build-in reveal: an item with an authored `enter` fades + slides in from
	// the right on its own window, so the list can build up one item at a time
	// (stable layout — every row reserves its space, only visibility animates,
	// so nothing reflows). Absent enter → reveal 1 (present from the block
	// entrance). The slide overshoots (easeOutBack) to match the block's
	// settled-place character; opacity eases out.
	const itemSlidePx = $derived(layout.width * 0.05);
	const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
	function easeOutBack(t: number): number {
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
	}
	function itemReveal(index: number): { opacity: number; slidePx: number } {
		const item = items[index];
		const t = clamp01(itemRevealAt(item, p));
		// Opacity: easeOutQuad (quick to legible). Slide: easeOutBack (overshoot).
		const revealOpacity = 1 - (1 - t) ** 2;
		const doneDim = 1 - (1 - DONE_DIM_OPACITY) * strikeProgressAt(item, p);
		return {
			opacity: revealOpacity * doneDim,
			slidePx: layout.direction * (1 - easeOutBack(t)) * itemSlidePx
		};
	}
</script>

<article
	bind:this={element}
	class="checklist surface"
	data-checklist-card
	class:checklist--bare={isBare}
	style:inline-size={`${layout.width}px`}
	style:left={`${layout.x}px`}
	style:top={layout.top}
	style:transform={card.anchor === 'top'
		? `translateX(${layout.enterOffsetPx}px)`
		: `translate(${layout.enterOffsetPx}px, -50%)`}
	style:opacity={layout.visibility}
	style:padding={isBare ? '0' : `${padPx}px ${Math.round(padPx * 1.15)}px`}
>
	{#if logoUrl && failedLogoUrl !== logoUrl}
		<div
			class="cl-logo"
			style:inline-size={`${logoPx}px`}
			style:block-size={`${logoPx}px`}
			style:margin-block-end={`${Math.round(logoPx * 0.22)}px`}
			style:box-shadow={isBare ? `${logoShadowPx}px ${logoShadowPx}px 0 rgba(5, 5, 4, 0.85)` : ''}
		>
			<img src={logoUrl} alt="" crossorigin="anonymous" onerror={() => (failedLogoUrl = logoUrl)} />
		</div>
	{:else if title}
		<h2
			class="cl-title"
			data-text-anim-slot="title"
			data-gfx-readable-id="surface:checklist:title"
			data-gfx-text-role="surface-title"
			style:font-size={`${titleFontPx}px`}
			style:margin-block-end={`${Math.round(titleFontPx * 0.65)}px`}
		>
			{title}
		</h2>
	{/if}

	<!-- Stable list: every row reserves its space; per-item build-in reveal
	     (opacity + slide) and the strike + dim animate in place — no reflow. -->
	<ol class="cl-items" style:row-gap={`${Math.round(itemFontPx * 0.55)}px`}>
		{#each items as item, index (index)}
			{@const reveal = itemReveal(index)}
			<li
				class="cl-item"
				data-item-index={index}
				style:font-size={`${itemFontPx}px`}
				style:opacity={reveal.opacity}
				style:transform={`translateX(${reveal.slidePx}px)`}
			>
				<span class="cl-item__num" aria-hidden="true">{index + 1}</span>
				<span
					class="cl-item__body"
					data-gfx-readable-id={`surface:checklist:item:${index}`}
					data-gfx-text-role="surface-body"
				>
					{#if item.checked}
						<!-- INLINE mark span: its client rects hug the word, so the strike
						     reaches only the text width — not the full grid column. -->
						<span class="cl-item__mark" data-annotation-mark="strike">{item.text}</span>
					{:else}
						{item.text}
					{/if}
				</span>
			</li>
		{/each}
	</ol>
</article>

<style>
	/*
	 * The flat channel card: plate + border + stepped shadow all resolve from
	 * the active Pack (specific → core fallback, ADR-0024). Fallbacks keep a
	 * Pack that only dresses in colour looking sane: plate rides the core
	 * --fill, form slots fall back to a plain rounded plate.
	 */
	.checklist {
		box-sizing: border-box;
		color: var(--ink, #f7f6f2);
		font-family: var(--font, inherit);
		position: absolute;
		transform-origin: center;
	}

	.checklist:not(.checklist--bare) {
		background-color: var(--plate, var(--fill, #141413));
		border: var(--border, none);
		border-radius: var(--radius, 16px);
		box-shadow: var(--shadow, none);
	}

	/* Bare mode is bare: the frame around the type stays genuinely transparent so
	   the footage reads through (the identity-spec chrome-mode claim). */
	.checklist--bare {
		background-color: transparent;
	}

	.cl-title {
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.05;
		margin: 0;
		text-transform: uppercase;
	}

	/* Logo lockup: the circle is deliberately WHITE regardless of Pack — the
	   uploaded mark's legibility is the point (faithful-artifact reasoning, like
	   the iMessage avatar). Plain background + border-radius; no filter — the
	   HTML-in-Canvas capture rasterizes it. */
	.cl-logo {
		background-color: #ffffff;
		border-radius: 50%;
		display: grid;
		margin-inline: auto;
		place-items: center;
	}

	.cl-logo img {
		block-size: 68%;
		inline-size: 68%;
		object-fit: contain;
	}

	.cl-items {
		display: grid;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.cl-item {
		align-items: baseline;
		column-gap: 0.55em;
		display: grid;
		grid-template-columns: 1.5em 1fr;
		line-height: 1.3;
	}

	/* The text cell fills the 1fr column; the mark span inside it stays inline so
	   its client rects (the strike geometry) hug the word, not the column. */
	.cl-item__body {
		min-inline-size: 0;
	}

	.cl-item__mark {
		/* Inline: getClientRects returns per-line boxes hugging the text. */
		display: inline;
	}

	/* Mono numbers — the channel's chrome voice; the composition's mono thread. */
	.cl-item__num {
		color: var(--accent, #ffd54a);
		font-family: var(--fontLabel, ui-monospace, monospace);
		font-weight: 700;
	}

	/*
	 * Bare mode: no plate — the type floats on footage, legibility carried by a
	 * hard (no-blur) offset shadow in the card's flat-depth register. Plain
	 * text-shadow, no filter — the HTML-in-Canvas capture rasterizes it.
	 */
	.checklist--bare .cl-title,
	.checklist--bare .cl-item {
		text-shadow: var(--textShadow, 0.05em 0.055em 0 rgba(5, 5, 4, 0.85));
	}
</style>
