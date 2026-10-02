<script lang="ts">
	import {
		DEFAULT_CAPTIONS_BAND_Y,
		resolveCaptionsBandPlacement
	} from '$lib/utils/captions-band-placement';
	import { animState } from './anim-state.svelte';
	import { engineState, packState } from './engine-state.svelte';
	import { getPack } from './packs/registry';
	import {
		appearanceVarsToStyle,
		resolveAppearanceVars,
		resolveTypographyColors
	} from './packs/resolve';
	import { ENGINE_FONT_FAMILIES } from './engine-schema';
	import { cueWordWindows } from '$lib/utils/srt';
	import { resolveCaptionReadableText } from '$lib/utils/caption-readable-text';

	// The captions track (creator blocks, grilled 2026-07-09): time-coded cues
	// rendered TOPMOST (above overlays — broadcast captions sit over
	// everything). Two appearance lanes: the faithful social styles (karaoke /
	// word-pop — heavy white type with a hard outline and an accent on the
	// active word, deliberately pack-independent) and the `pack` style, which
	// dresses the line from the active Pack (core ink + font-treatment).
	// Everything is a pure function of the timeline clock — cues carry absolute
	// ms, per-word timing derives proportionally (cueWordWindows) — so preview
	// and export resolve identical pixels with no tweens and no CSS transitions.

	const captions = $derived(engineState.captions);
	const currentMs = $derived(
		animState.globalProgress * engineState.transport.durationSeconds * 1000
	);

	const activeCue = $derived(
		captions?.cues.find((cue) => currentMs >= cue.startMs && currentMs < cue.endMs) ?? null
	);
	const words = $derived(activeCue ? cueWordWindows(activeCue) : []);
	const activeWordIndex = $derived(
		words.findIndex((word) => currentMs >= word.startMs && currentMs < word.endMs)
	);
	const readable = $derived(resolveCaptionReadableText(captions, currentMs));

	const accent = $derived(captions?.accent ?? '#ffd608');
	// The band for the active orientation: its snapshot, else the shared values,
	// else the orientation-aware default. Vertical platforms occlude the bottom
	// ~21% (expanded-description state), so the C5 vertical band is 22–34% from
	// the bottom and 0.8 would sit under it; horizontal keeps 0.8.
	const band = $derived(
		captions ? resolveCaptionsBandPlacement(captions, engineState.transport.orientation) : null
	);
	const bandY = $derived(band?.y ?? DEFAULT_CAPTIONS_BAND_Y[engineState.transport.orientation]);
	const scale = $derived(band?.scale ?? 1);

	// Word-pop entrance: the word lands with a fast eased pop over its first
	// 120 ms — derived from the clock, resting at exactly 1 (capture-safe: the
	// mount never fades, and the scale is identity outside the pop window).
	const POP_MS = 120;
	const popScale = $derived.by(() => {
		if (activeWordIndex < 0) return 1;
		const word = words[activeWordIndex];
		const t = Math.max(0, Math.min(1, (currentMs - word.startMs) / POP_MS));
		if (t >= 1) return 1;
		const eased = 1 - (1 - t) * (1 - t);
		return 0.78 + 0.22 * eased;
	});

	// Pack lane (ADR-0038): line ink resolves typography override → Pack core;
	// the Pack's font-treatment voice rides the appearance vars (--font).
	const pack = $derived(getPack(packState.slug));
	const packVars = $derived(appearanceVarsToStyle(resolveAppearanceVars(pack, 'captions')));
	const packInk = $derived(resolveTypographyColors(pack, engineState.typography).inkColor);
	const packFontFallback = $derived(
		ENGINE_FONT_FAMILIES[engineState.typography.fontFamily]?.stack ??
			ENGINE_FONT_FAMILIES.sans.stack
	);
</script>

{#if captions && activeCue}
	<div class="captions" style:top="{bandY * 100}%" style:--caption-scale={scale}>
		{#if captions.style === 'karaoke'}
			<p
				class="captions__line captions__line--karaoke"
				style:--caption-accent={accent}
				data-gfx-readable-id={readable?.id}
				data-gfx-readable-text={readable?.text}
				data-gfx-text-role="caption-social"
			>
				{#each words as word, index (index)}<span
						class="captions__word"
						class:captions__word--active={index === activeWordIndex}>{word.text}</span
					>{/each}
			</p>
		{:else if captions.style === 'word-pop'}
			{#if activeWordIndex >= 0}
				<p
					class="captions__line captions__line--word-pop"
					style:--caption-accent={accent}
					style:scale={popScale !== 1 ? String(popScale) : undefined}
					data-gfx-readable-id={readable?.id}
					data-gfx-readable-text={readable?.text}
					data-gfx-text-role="caption-social"
				>
					{words[activeWordIndex].text}
				</p>
			{/if}
		{:else}
			<p
				class="captions__line captions__line--pack"
				style="{packVars};color:{packInk};--caption-pack-font:{packFontFallback}"
				data-gfx-readable-id={readable?.id}
				data-gfx-readable-text={readable?.text}
				data-gfx-text-role="caption-social"
			>
				{activeCue.text}
			</p>
		{/if}
	</div>
{/if}

<style>
	/* Topmost layer: broadcast captions sit above overlays (their z-index 1). */
	.captions {
		display: flex;
		inset-inline: 0;
		justify-content: center;
		pointer-events: none;
		position: absolute;
		z-index: 2;
	}

	.captions__line {
		margin: 0;
		max-inline-size: 78%;
		text-align: center;
		translate: 0 -50%;
	}

	/* The faithful social register (pack-independent by design): heavy white
	   type with a hard multi-directional outline + drop — the caption look
	   creators expect over footage. Plain text-shadow: capture-safe. The whole
	   treatment rides --caption-scale with the type: an outline that stayed at
	   its base width would vanish proportionally at scale 4 (0.9% of a 396px
	   cap) and swamp the glyph at 0.25. */
	.captions__line--karaoke,
	.captions__line--word-pop {
		color: #ffffff;
		font-family: 'Inter Variable', Inter, 'Segoe UI', Arial, sans-serif;
		font-weight: 800;
		letter-spacing: 0.01em;
		line-height: 1.25;
		text-shadow:
			calc(0.19 * var(--cqmin) * var(--caption-scale, 1)) 0 0 rgb(0 0 0 / 0.9),
			calc(-0.19 * var(--cqmin) * var(--caption-scale, 1)) 0 0 rgb(0 0 0 / 0.9),
			0 calc(0.19 * var(--cqmin) * var(--caption-scale, 1)) 0 rgb(0 0 0 / 0.9),
			0 calc(-0.19 * var(--cqmin) * var(--caption-scale, 1)) 0 rgb(0 0 0 / 0.9),
			0 calc(0.3 * var(--cqmin) * var(--caption-scale, 1))
				calc(0.9 * var(--cqmin) * var(--caption-scale, 1)) rgb(0 0 0 / 0.55);
	}

	/* Social karaoke is a statement, not a subtitle — CapCut/TikTok-register
	   type (~95px caps at 4K, G4 caption band), wrapping to two lines when the
	   cue needs it (C1 allows two). */
	.captions__line--karaoke {
		font-size: calc(6 * var(--cqmin) * var(--caption-scale, 1));
	}

	/* Words are inline-block — that's both the wrap opportunity (there is no
	   literal space between the spans; Svelte trims whitespace-only nodes) and
	   the em-based word gap, so spacing rides font-size and --caption-scale
	   for free. */
	.captions__word {
		border-radius: 0.14em;
		display: inline-block;
		padding-inline: 0.08em;
	}

	.captions__word:not(:last-child) {
		margin-inline-end: 0.26em;
	}

	/* The spoken word rides the accent pill — the karaoke highlight. */
	.captions__word--active {
		background: var(--caption-accent, #ffd608);
		color: #111111;
		text-shadow: none;
	}

	.captions__line--word-pop {
		font-size: calc(8.5 * var(--cqmin) * var(--caption-scale, 1));
		text-transform: uppercase;
	}

	/* The Pack lane (ADR-0038): the active Pack's ink + type voice dress the
	   line — same composition, different publication. */
	.captions__line--pack {
		font-family: var(--font, var(--caption-pack-font));
		font-size: calc(4 * var(--cqmin) * var(--caption-scale, 1));
		font-weight: 600;
		line-height: 1.3;
	}
</style>
