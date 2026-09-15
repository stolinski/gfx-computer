/**
 * Sentry Pack manifest — the first customer pack promoted through the User
 * Pack drafting lane (ADR-0055, playbook § 7), per
 * `docs/packs/sentry/aesthetic.md` (binding). Where clean-light is a white
 * studio and crt-terminal is a phosphor screen, Sentry is a **night-mode
 * product console**: a rich-black violet field with a soft wash, cards a step
 * lighter than the field, white Rubik, one hot-pink accent word, blurple UI
 * furniture, and lime as the signal voice.
 *
 * Intake 2026-09-01 (playbook § 1 — measured, not remembered) from
 * sentry.io/welcome: the page's CSS custom properties (`--color-rich-black
 * #1f1633`, `--color-utility-black #181225`, `--color-hot-pink #fd44b0`,
 * `--color-blurple #6a5fc1`, `--color-dk-blurple #4e2a9a`, `--color-gray-2
 * #ececf1`, `--color-gray-3 #cfcfdb`, `--active-accent-end #c2ef4e`), computed
 * styles (main `#1f1633`; buttons Rubik 700/500, 14px caps, 0.2px tracking,
 * 8px radius on 36–40px; feature cards 12px radius on ~230px behind a 2px
 * gradient hairline; CTA gradient #fa7faa → #ff9691 → #ffb287), and eyedropped
 * pixels of the rendered page (card interior #2e225c, hero wash #2f1c48, lower
 * field #181225, the accent word #fd3ca7).
 *
 * The structural claims a colour swap never touches:
 *   - **Edges are neon.** A card is defined by a hot-pink hairline and the
 *     bloom it throws, not by a shadow it casts: `depth-treatment` is a pink
 *     glow rig, and every card form role pairs a hairline border with a neon
 *     box-shadow. Syntax's stepped shadow, clean-light's quiet float, and
 *     crt-terminal's phosphor bloom are all other packs' grammar.
 *   - **Cards are a step lighter than the field**, never darker and never the
 *     field itself (measured: #2e225c on #1f1633) — the console's panels.
 *   - **The field has a wash.** Full-frame backdrops run from the hero's
 *     violet wash at the top down to utility black, with a dark-blurple key.
 *   - **Digital-clean.** No paper tooth, no tape, no torn fibre; die-cut
 *     silhouettes, flat light, text without armor.
 */

import type { PackManifest } from '$lib/platform/packs/types';
import { sentryFonts } from './fonts';

/** The neon bloom every card throws: hot pink at two radii, 4K-reference px. */
const NEON_SHADOW = '0 0 24px rgba(253, 68, 176, 0.35), 0 0 72px rgba(253, 68, 176, 0.16)';
/** The hairline: 2px on the site's ~230px card ≈ 0.9% of the element. */
const NEON_BORDER = 'calc(0.22 * var(--cqmin)) solid #fd44b0';
/** 12px on the site's ~230px card ≈ 5% of the element. */
const CARD_RADIUS = 'calc(1.2 * var(--cqmin))';
/** Nav and button tracking measures 0.2px at 14px ≈ 0.014em; claimed at the nearest legible step. */
const LABEL_TRACKING = '0.02em';

export const sentryPack: PackManifest = {
	slug: 'sentry',
	label: 'Sentry',
	description:
		'Night-mode product console — rich-black violet field with a soft wash, panels a step lighter behind neon hot-pink hairlines, white Rubik, blurple UI, lime as the signal voice. The sentry.io welcome page as a pack.',
	fonts: sentryFonts,
	roles: {
		// ---------------- chart Block domain (ADR-0048) ----------------
		// The site's own data palette: hot pink first, blurple, then the lime
		// signal and the CTA gradient's peach as the fourth series. Axis and
		// labels are white on the dark field; the grid is a dark-violet step.
		'chart.mark': { kind: 'style', value: '#fd44b0' },
		'chart.series-2': { kind: 'style', value: '#6a5fc1' },
		'chart.series-3': { kind: 'style', value: '#c2ef4e' },
		'chart.series-4': { kind: 'style', value: '#ffb287' },
		'chart.axis': { kind: 'style', value: '#ffffff' },
		'chart.grid': { kind: 'style', value: '#3a2b63' },
		'chart.label': { kind: 'style', value: '#ffffff' },
		'chart.annotation': { kind: 'style', value: '#fd44b0' },
		'chart.mark-fill': {
			kind: 'style',
			value: {
				seriesRoles: ['chart.mark', 'chart.series-2', 'chart.series-3', 'chart.series-4'],
				default: { mode: 'solid' },
				series: { mode: 'solid' },
				// The emphasised mark sweeps pink → white along the bar: the neon read.
				emphasis: { mode: 'gradient', toRole: 'chart.label', axis: 'inline' }
			}
		},

		// ---------------------------------------------------------------
		// Mandatory core vocabulary (ADR-0024 fallback floor).
		// ---------------------------------------------------------------
		// Card violet (measured: the "Errors" panel interior #2e225c); white ink
		// (measured: headings and body #ffffff); the hot-pink accent
		// (`--color-hot-pink #fd44b0`; the hero's accent word renders #fd3ca7).
		'fill-treatment': { kind: 'style', value: '#2e225c' },
		'ink-treatment': { kind: 'style', value: '#ffffff' },
		'accent-treatment': { kind: 'style', value: '#fd44b0' },
		// The full-frame FIELD (ADR-0039 §3, `backgroundFill: 'pack'`): the
		// site's rich black (`main` measures #1f1633). Cards sit a step lighter
		// on it, never on it — the console-panel read.
		'field-treatment': { kind: 'style', value: '#1f1633' },
		'field-ink-treatment': { kind: 'style', value: '#ffffff' },
		// Die-cut clean silhouettes — a product console tears nothing.
		'edge-treatment': { kind: 'style', value: 'clean' },
		// THE structural signature: depth is a neon bloom, not a shadow. Hot
		// pink at moderate intensity — the halo the site's gradient hairlines
		// throw onto the field.
		'depth-treatment': {
			kind: 'style',
			value: { glow: { radius: 28, color: '#fd44b0', intensity: 0.5 } }
		},
		// Flat console light — the wash lives in the backdrops, not a key.
		'light-treatment': { kind: 'style', value: 'none' },
		// One family everywhere (a pack switch IS the font switch): the site's
		// Rubik for display, body, and labels; hierarchy is weight and case.
		'font-treatment': { kind: 'style', value: "'Rubik', 'Inter', sans-serif" },
		'font-label-treatment': { kind: 'style', value: "'Rubik', 'Inter', sans-serif" },
		'variable-weight-treatment': {
			kind: 'style',
			value: {
				fontFamily: "'Rubik Variable', 'Rubik', 'Inter', sans-serif",
				minimum: 300,
				rest: 650,
				maximum: 700
			}
		},

		// ---------------- plain Surface ----------------
		'plain.edge': { kind: 'style', value: 'clean' },
		'plain.depth': { kind: 'style', value: 'none' },

		// ---------------- chapter-card Surface ----------------
		'chapter-card.ink': { kind: 'style', value: '#ffffff' },
		'chapter-card.base': { kind: 'style', value: '#ffffff' },
		'chapter-card.kicker': { kind: 'style', value: '#fd44b0' },
		// A dark-blurple rule reads on the field where a pink one would shout.
		'chapter-card.rule': { kind: 'style', value: '#4e2a9a' },
		// WGSL backdrop — the field wash: the hero's violet peak (eyedropped
		// #2f1c48) at the top down to the page's utility black (#181225), with a
		// dark-blurple additive key for the glow the hero throws.
		'chapter-card.backdrop': {
			kind: 'style',
			value: { top: '#2f1c48', bottom: '#181225', light: '#4e2a9a' }
		},

		// ---------------- pullquote-on-photo Surface ----------------
		'pullquote-on-photo.ink': { kind: 'style', value: '#ffffff' },
		// Bylines ride the site's gray-3 (`--color-gray-3 #cfcfdb`).
		'pullquote-on-photo.byline': { kind: 'style', value: '#cfcfdb' },
		'pullquote-on-photo.backdrop': {
			kind: 'style',
			value: { top: '#2f1c48', bottom: '#181225', light: '#4e2a9a', sweep: '#000000' }
		},

		// (No newspaper Roles: the photographed page is a fully immune faithful
		// artifact — ADR-0056.)

		// ---------------- title-sequence Surface ----------------
		// Display type stays crisp: the neon is the cards' property, never the
		// glyphs' (the site's hero carries no glow, and a halo on a 4K word
		// would read as bloom smear). White ink needs no armor on the field.
		'title-sequence.edge': { kind: 'style', value: 'none' },
		'title-sequence.depth': { kind: 'style', value: 'none' },
		'title-sequence.ink': { kind: 'style', value: '#ffffff' },
		'title-sequence.kicker': { kind: 'style', value: '#fd44b0' },
		'title-sequence.textShadow': { kind: 'style', value: 'none' },
		'title-sequence.backdrop': {
			kind: 'style',
			value: { top: '#2f1c48', bottom: '#181225', glow: '#4e2a9a' }
		},

		// ---------------- type-hero Surface ----------------
		'type-hero.edge': { kind: 'style', value: 'clean' },
		'type-hero.depth': { kind: 'style', value: 'none' },
		// Flat ink — the raked rim/carve is theatrical grammar; the console is lit flat.
		'type-hero.light': { kind: 'style', value: 'none' },
		'type-hero.textShadow': { kind: 'style', value: 'none' },
		'type-hero.text-base': { kind: 'style', value: '#ffffff' },
		'type-hero.ink': { kind: 'style', value: '#ffffff' },
		'type-hero.accent': { kind: 'style', value: '#fd44b0' },
		'type-hero.byline': { kind: 'style', value: '#cfcfdb' },
		// Bold display: the site's h1 measures 700 (its custom hero face); Rubik
		// 700 is the real cut that carries the same weight.
		'type-hero.weight': { kind: 'style', value: '700' },
		'type-hero.stretch': { kind: 'style', value: 'normal' },
		// The wash plus the hero's scattered star specks: a lavender particle
		// (the site's `--color-lt-violet` family lifted to read on the field);
		// bands zeroed (additive tints zero with black — the wash is enough).
		'type-hero.backdrop': {
			kind: 'style',
			value: {
				top: '#2f1c48',
				bottom: '#181225',
				warmBand: '#000000',
				coolBand: '#000000',
				particle: '#8d78ff'
			}
		},

		// ---------------- Diagram Blocks (ADR-0036) ----------------
		// Plotter-straight rules in the composition's ink; open chevrons — the
		// product-diagram read, not felt-tip. Diagram chrome speaks Rubik.
		'diagram.stroke': { kind: 'style', value: { color: 'ink', widthPx: 7, wobble: 0 } },
		'diagram.arrowhead': { kind: 'style', value: 'open-chevron' },
		'diagram.font': { kind: 'style', value: "'Rubik', 'Inter', sans-serif" },
		// Nodes are console panels: card violet with a smaller neon halo.
		'node.fill': { kind: 'style', value: '#2e225c' },
		'node.accent': { kind: 'style', value: '#fd44b0' },
		'node.ink': { kind: 'style', value: 'currentColor' },
		'node.depth': {
			kind: 'style',
			value: { glow: { radius: 18, color: '#fd44b0', intensity: 0.45 } }
		},
		'label.ink': { kind: 'style', value: 'currentColor' },
		'stat-callout.accent': { kind: 'style', value: '#fd44b0' },
		'stat-callout.ink': { kind: 'style', value: 'currentColor' },

		// ---------------- Annotation tool inks ----------------
		// The highlighter is a light tone by construction: the band multiplies
		// onto whatever it marks, so a dark fill plates over ink where every
		// other pack's highlighter tints it (measured: a dark blurple band moved
		// 2.73% of an immune captured web page; the 2% immunity margin holds
		// only for highlighter-luminance fills). The site's very-light purple
		// (`--color-v-lt-purple`) is the pack's own tint at that luminance.
		// Every stroke tool is the pink.
		'highlight.fill': { kind: 'style', value: '#e2abe0' },
		'underline.fill': { kind: 'style', value: '#fd44b0' },
		'strike.fill': { kind: 'style', value: '#fd44b0' },
		'circle.fill': { kind: 'style', value: '#fd44b0' },
		'box.fill': { kind: 'style', value: '#fd44b0' },

		// ---------------- Annotation focal chrome ----------------
		'tear-out.fill': { kind: 'style', value: '#2e225c' },

		// ---------------- Overlays ----------------
		// The Sentry card: a violet panel with a neon hairline and its bloom,
		// white ink, gray-3 role line, pink accent — a console panel over footage.
		'lower-third.accent': { kind: 'style', value: '#fd44b0' },
		'lower-third.ink': { kind: 'style', value: '#ffffff' },
		'lower-third.roleInk': { kind: 'style', value: '#cfcfdb' },
		'lower-third.plate': { kind: 'style', value: '#2e225c' },
		// The cinematic scrim goes a violet step above the field (measured field-below-hero #231939).
		'lower-third.scrim': { kind: 'style', value: { color: '#231939' } },
		'lower-third.textShadow': { kind: 'style', value: 'none' },
		'lower-third.border': { kind: 'style', value: NEON_BORDER },
		'lower-third.radius': { kind: 'style', value: CARD_RADIUS },
		'lower-third.shadow': { kind: 'style', value: NEON_SHADOW },
		'lower-third.pad': { kind: 'style', value: 'calc(3 * var(--cqmin)) calc(4.2 * var(--cqmin))' },
		'lower-third.gap': { kind: 'style', value: 'calc(0.9 * var(--cqmin))' },
		'lower-third.weight': { kind: 'style', value: '700' },
		'lower-third.tracking': { kind: 'style', value: LABEL_TRACKING },

		// Achievement notifications are console toasts: the same panel grammar,
		// lime for success (the site's "Root Cause" / "Seer" signal voice),
		// dark ink on a pink accent plate (the site's dark-on-bright buttons).
		'achievement.plate': { kind: 'style', value: '#2e225c' },
		'achievement.ink': { kind: 'style', value: '#ffffff' },
		'achievement.mutedInk': { kind: 'style', value: '#cfcfdb' },
		'achievement.accent': { kind: 'style', value: '#fd44b0' },
		'achievement.success': { kind: 'style', value: '#c2ef4e' },
		'achievement.borderInk': { kind: 'style', value: '#fd44b0' },
		'achievement.accentInk': { kind: 'style', value: '#1f1633' },
		'achievement.border': { kind: 'style', value: NEON_BORDER },
		'achievement.radius': { kind: 'style', value: CARD_RADIUS },
		'achievement.shadow': { kind: 'style', value: NEON_SHADOW },
		'achievement.font': { kind: 'style', value: "'Rubik', 'Inter', sans-serif" },
		'achievement.fontLabel': { kind: 'style', value: "'Rubik', 'Inter', sans-serif" },
		'achievement.pad': {
			kind: 'style',
			value: 'calc(2.4 * var(--cqmin)) calc(3.2 * var(--cqmin))'
		},
		'achievement.gap': { kind: 'style', value: 'calc(1.2 * var(--cqmin))' },
		'achievement.tracking': { kind: 'style', value: LABEL_TRACKING },
		'achievement.weight': { kind: 'style', value: '700' },
		'achievement.kickerWeight': { kind: 'style', value: '500' },
		'source-url.plate': { kind: 'style', value: '#2e225c' },
		'source-url.ink': { kind: 'style', value: '#ffffff' },
		'source-url.accent': { kind: 'style', value: '#fd44b0' },
		'source-url.border': { kind: 'style', value: NEON_BORDER },
		'source-url.radius': { kind: 'style', value: CARD_RADIUS },
		'source-url.shadow': { kind: 'style', value: NEON_SHADOW },
		'source-url.fontLabel': { kind: 'style', value: "'Rubik', 'Inter', sans-serif" },
		'source-url.pad': { kind: 'style', value: '0.5em 0.8em' },
		'source-url.tracking': { kind: 'style', value: LABEL_TRACKING },
		'source-url.weight': { kind: 'style', value: '700' },

		// Display echoes over footage run white with the pink accent.
		'watermark.ink': { kind: 'style', value: '#ffffff' },
		'watermark.accent': { kind: 'style', value: '#fd44b0' },
		'watermark.tracking': { kind: 'style', value: LABEL_TRACKING },
		'counter.ink': { kind: 'style', value: '#ffffff' },
		'instance-stack.ink': { kind: 'style', value: '#ffffff' },
		'dimensional-type.accent': { kind: 'style', value: '#fd44b0' },
		'dimensional-type.face': { kind: 'style', value: 'rubik-700' },
		'dimensional-type.ink': { kind: 'style', value: '#ffffff' },
		'text-3d.ink': { kind: 'style', value: '#ffffff' },

		// Paper tooth is not this register's material — the console is
		// digital-clean (aesthetic.md anti-list). Categorical decline: any
		// authored paper-grain goes inert and the inspector shows pack · off.
		'paper-grain.strength': { kind: 'style', value: 'none' },

		// Tape is not this grammar (nothing is stuck to a screen) — defensive
		// values only, so a re-skinned Preset carrying tape cannot leak another
		// pack's warm fibre tones onto the violet.
		'washi-tape.grain-dark': { kind: 'style', value: 'rgba(20, 10, 40, 0.08)' },
		'washi-tape.grain-light': { kind: 'style', value: 'rgba(255, 255, 255, 0.05)' },

		// ---------------- motion primitives ----------------
		'cursor-trail.pointer': { kind: 'style', value: 'mac-pointer' },
		// Lavender persistence (the site's `--color-v-lt-purple` family), soft falloff.
		'cursor-trail.trailMaterial': { kind: 'style', value: { color: '#b392f0', softness: 0.5 } },

		// ---------------------------------------------------------------
		// FORM dress (ADR-0023 appearance) — the site's label grammar
		// corpus-wide: near-flat tracking, bold display, medium labels.
		// (`lower-third.*` form roles live in Overlays above.)
		// ---------------------------------------------------------------
		'chapter-card.tracking': { kind: 'style', value: LABEL_TRACKING },
		'chapter-card.weight': { kind: 'style', value: '700' },
		'title-sequence.tracking': { kind: 'style', value: LABEL_TRACKING },
		'title-sequence.weight': { kind: 'style', value: '700' },
		'type-hero.tracking': { kind: 'style', value: LABEL_TRACKING },
		'pullquote-on-photo.tracking': { kind: 'style', value: LABEL_TRACKING },
		'instance-stack.weight': { kind: 'style', value: '700' },
		'text-3d.weight': { kind: 'style', value: '700' }
	}
};
