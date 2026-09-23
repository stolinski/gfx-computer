/**
 * Clean Light Pack manifest — the fourth Pack, per
 * `docs/packs/clean-light/aesthetic.md` (binding). The LIGHT point of the
 * catalog: where syntax is warm dark paper, editorial-mono is cool print on
 * dark fields, and crt-terminal is emissive glass, Clean Light is a white
 * studio — soft-neutral fields, white cards separated by thin rules and a
 * quiet layered shadow, one confident product blue. The design-YouTuber /
 * product-demo voice.
 *
 * Intake 2026-07-13 (playbook § 1 — measured, not remembered): field/card
 * whites and the quiet-shadow ramp from notion.com (4-layer black ramp at
 * 1–4% alpha, 18px blur @1x), hairlines and the cool ink family from
 * docs.stripe.com (#e3e8ee rules, #1a1f36 headings, #3c4257 body), the
 * Geist + Geist Mono voice and eyebrow-label grammar from vercel.com
 * (mono uppercase labels at ~0.07em, radius 6px, button weight 500).
 *
 * The structural claims a colour swap never touches:
 *   - **Depth is a quiet float.** `depth-treatment` is a blurred, low-alpha
 *     shadow — the "product screenshot floating on white" read. No stepped
 *     stack (syntax's), no glow (CRT's), not flat-none (editorial-mono's).
 *   - **Rules are thin.** Card boundaries are hairlines (~1px at 1080
 *     equivalent), never chunky borders.
 *   - **Light fields everywhere.** Full-frame backdrops are near-white —
 *     the catalog's first light-field pack; every additive atmosphere role
 *     is zeroed (flat, even studio light).
 *   - **Ink needs no armor.** Baked glyph text-shadows are dark-field dress;
 *     this Pack claims them off.
 */

import type { PackManifest } from '$lib/platform/packs/types';
import { cleanLightFonts } from './fonts';

export const cleanLightPack: PackManifest = {
	slug: 'clean-light',
	label: 'Clean Light',
	description:
		'White-studio minimal — soft-neutral light fields, white cards with thin rules and a quiet layered shadow, Geist + Geist Mono, one confident product blue. The design-YouTuber / product-demo voice.',
	fonts: cleanLightFonts,
	roles: {
		// ---------------- chart Block domain (ADR-0048) ----------------
		// Final chart-specific colour Roles. Structural edge/depth/light
		// dimensions intentionally land on the mandatory core fallback floor.
		'chart.mark': { kind: 'style', value: '#0075de' },
		'chart.series-2': { kind: 'style', value: '#16181d' },
		'chart.series-3': { kind: 'style', value: '#5b6472' },
		'chart.series-4': { kind: 'style', value: '#8fc2f0' },
		'chart.axis': { kind: 'style', value: '#16181d' },
		'chart.grid': { kind: 'style', value: '#c7ced8' },
		'chart.label': { kind: 'style', value: '#16181d' },
		'chart.annotation': { kind: 'style', value: '#0075de' },
		'chart.mark-fill': {
			kind: 'style',
			value: {
				seriesRoles: ['chart.mark', 'chart.series-2', 'chart.series-3', 'chart.series-4'],
				default: { mode: 'solid' },
				series: { mode: 'gradient', toRole: 'chart.axis', axis: 'block' },
				emphasis: { mode: 'gradient', toRole: 'chart.label', axis: 'inline' }
			}
		},

		// ---------------------------------------------------------------
		// Mandatory core vocabulary (ADR-0024 fallback floor).
		// ---------------------------------------------------------------
		// Card white (measured: notion.com cards are #ffffff on a #ffffff
		// field, separated by shadow alone); cool near-black ink (derived
		// between the measured stripe-docs heading #1a1f36 and notion's
		// rgba(0,0,0,.95)); the accent is the register's product blue
		// (measured: notion.com CTA #0075de).
		'fill-treatment': { kind: 'style', value: '#ffffff' },
		'ink-treatment': { kind: 'style', value: '#16181d' },
		'accent-treatment': { kind: 'style', value: '#0075de' },
		// The full-frame FIELD (ADR-0039 §3, `backgroundFill: 'pack'`): the
		// soft-neutral studio white the #ffffff cards float on (intake: notion's
		// field reads a step cooler than its cards on camera; shadow alone
		// separates them).
		'field-treatment': { kind: 'style', value: '#f6f7f8' },
		'field-ink-treatment': { kind: 'style', value: '#16181d' },
		// Die-cut clean silhouettes — nothing in this register tears or feathers.
		'edge-treatment': { kind: 'style', value: 'clean' },
		// THE structural signature: the quiet float. Straight-down offset with a
		// wide blur at low alpha — notion's measured outer ramp layer (4px/18px/
		// 0.04 @1x) scaled ×2 to 4K-reference px, alpha lifted to the ramp's
		// cumulative ~0.10 so it survives 4K→1080 compression.
		'depth-treatment': {
			kind: 'style',
			value: { hardOffset: { dx: 0, dy: 8, blur: 36, color: 'rgba(9, 13, 20, 0.1)' } }
		},
		// Even studio light — the field is lit flat; nothing stages a key.
		'light-treatment': { kind: 'style', value: 'none' },
		// The universal type voice (a pack switch IS the font switch) and the
		// mono eyebrow-label voice it pairs with (vercel.com grammar).
		'font-treatment': { kind: 'style', value: "'Geist', 'Inter', sans-serif" },
		'font-label-treatment': { kind: 'style', value: "'Geist Mono', ui-monospace, monospace" },
		'variable-weight-treatment': {
			kind: 'style',
			value: {
				fontFamily: "'Geist Variable', 'Geist', 'Inter', sans-serif",
				minimum: 100,
				rest: 500,
				maximum: 600
			}
		},

		// ---------------- plain Surface ----------------
		'plain.edge': { kind: 'style', value: 'clean' },
		'plain.depth': { kind: 'style', value: 'none' },

		// ---------------- chapter-card Surface ----------------
		'chapter-card.ink': { kind: 'style', value: '#16181d' },
		'chapter-card.base': { kind: 'style', value: '#16181d' },
		'chapter-card.kicker': { kind: 'style', value: '#0075de' },
		// One step darker than the card hairline (#e3e8ee): a rule that has to
		// read on the FIELD at video scale needs the extra step (broadcast
		// compression eats a 10%-contrast hairline).
		'chapter-card.rule': { kind: 'style', value: '#d0d7e0' },
		// WGSL backdrop — the light studio field: near-white top, the floor
		// deepening one neutral step so white cards separate; additive key
		// zeroed (flat, even light — the additive-tints-zero-with-black lever,
		// used deliberately).
		'chapter-card.backdrop': {
			kind: 'style',
			value: { top: '#f6f7f8', bottom: '#eef0f2', light: '#000000' }
		},

		// ---------------- pullquote-on-photo Surface ----------------
		'pullquote-on-photo.ink': { kind: 'style', value: '#16181d' },
		// Byline rides the slate secondary voice (measured stripe-docs body
		// #3c4257, lifted one step for the smaller role).
		'pullquote-on-photo.byline': { kind: 'style', value: '#5b6472' },
		'pullquote-on-photo.backdrop': {
			kind: 'style',
			value: { top: '#f6f7f8', bottom: '#eef0f2', light: '#000000', sweep: '#000000' }
		},

		// (No newspaper Roles: the photographed page is a fully immune faithful
		// artifact — ADR-0056 — so a quoted newspaper stays newsprint in the
		// white studio too.)

		// ---------------- title-sequence Surface ----------------
		'title-sequence.edge': { kind: 'style', value: 'none' },
		'title-sequence.depth': { kind: 'style', value: 'none' },
		'title-sequence.ink': { kind: 'style', value: '#16181d' },
		'title-sequence.kicker': { kind: 'style', value: '#0075de' },
		// Baked glyph shadows are dark-field dress — dark ink on a white field
		// needs no armor, and a dark halo on white reads as a rendering bug.
		'title-sequence.textShadow': { kind: 'style', value: 'none' },
		'title-sequence.backdrop': {
			kind: 'style',
			value: { top: '#f6f7f8', bottom: '#eef0f2', glow: '#000000' }
		},

		// ---------------- type-hero Surface ----------------
		'type-hero.edge': { kind: 'style', value: 'clean' },
		'type-hero.depth': { kind: 'style', value: 'none' },
		// Flat ink — the raked-light rim/carve is theatrical dark-field grammar;
		// on white it rendered as a warm-brown emboss (calibration 2026-07-13).
		'type-hero.light': { kind: 'style', value: 'none' },
		// Dark glyph armor off (same reasoning as title-sequence).
		'type-hero.textShadow': { kind: 'style', value: 'none' },
		'type-hero.text-base': { kind: 'style', value: '#16181d' },
		'type-hero.ink': { kind: 'style', value: '#16181d' },
		'type-hero.accent': { kind: 'style', value: '#0075de' },
		'type-hero.byline': { kind: 'style', value: '#5b6472' },
		// Semibold, not heavy — the understated display claim (vercel's h1
		// measures 400; 600 is the floor that still carries a 4K hero word).
		// Calibration judges whether it reads anemic (editorial-mono lesson).
		'type-hero.weight': { kind: 'style', value: '600' },
		'type-hero.stretch': { kind: 'style', value: 'normal' },
		// Flat light field: bands/motes are additive — zeroed deliberately;
		// top/bottom one neutral step apart (the light studio gradient). The
		// numeric fields decline the dark-field grade: vignette 0 (a 0.32
		// vignette reads as gray corner wash on white), grain 0 (luminance
		// noise reads as dirt on white), toe 1 (linear — the black-lift toe
		// darkens a light field).
		'type-hero.backdrop': {
			kind: 'style',
			value: {
				top: '#f6f7f8',
				bottom: '#eef0f2',
				warmBand: '#000000',
				coolBand: '#000000',
				particle: '#000000',
				vignette: 0,
				grain: 0,
				toe: 1
			}
		},

		// ---------------- Diagram Blocks (ADR-0036) ----------------
		// Thin rules everywhere: a 7px @4K plotter line (between crt's 6 and
		// syntax's 12) in the composition's ink, dead straight. Open chevrons —
		// filled marker triangles are felt-tip grammar, not product-diagram.
		'diagram.stroke': { kind: 'style', value: { color: 'ink', widthPx: 7, wobble: 0 } },
		'diagram.arrowhead': { kind: 'style', value: 'open-chevron' },
		// Diagram DOM chrome voice — the mono eyebrow family (read by
		// DiagramMount; NOT a core claim, so document substrates keep their faces).
		'diagram.font': { kind: 'style', value: "'Geist Mono', ui-monospace, monospace" },
		// Nodes are white product cards: hairline-and-shadow objects with blue
		// pins. UI furniture floats lower than hero cards — smaller offset/blur,
		// slightly firmer alpha so it still reads at node scale.
		'node.fill': { kind: 'style', value: '#ffffff' },
		'node.accent': { kind: 'style', value: '#0075de' },
		'node.ink': { kind: 'style', value: 'currentColor' },
		'node.depth': {
			kind: 'style',
			value: { hardOffset: { dx: 0, dy: 5, blur: 22, color: 'rgba(9, 13, 20, 0.12)' } }
		},
		'label.ink': { kind: 'style', value: 'currentColor' },
		'stat-callout.accent': { kind: 'style', value: '#0075de' },
		'stat-callout.ink': { kind: 'style', value: 'currentColor' },

		// ---------------- Annotation tool inks ----------------
		// One accent family — digital annotation (the screencast callout), not
		// pen physics: a soft selection wash for highlight, the product blue
		// for every stroke tool. An alert is the same blue doing a louder job,
		// never a second hue (Q4 discipline; the one-accent minimal claim).
		'highlight.fill': { kind: 'style', value: '#8fc2f0' },
		'underline.fill': { kind: 'style', value: '#0075de' },
		'strike.fill': { kind: 'style', value: '#0075de' },
		'circle.fill': { kind: 'style', value: '#0075de' },
		'box.fill': { kind: 'style', value: '#0075de' },

		// ---------------- Annotation focal chrome ----------------
		'tear-out.fill': { kind: 'style', value: '#ffffff' },

		// ---------------- Overlays ----------------
		// The Clean Light card: white plate, thin rule, quiet shadow, blue
		// accent — a product-UI object over footage.
		'lower-third.accent': { kind: 'style', value: '#0075de' },
		'lower-third.ink': { kind: 'style', value: '#16181d' },
		'lower-third.roleInk': { kind: 'style', value: '#5b6472' },
		'lower-third.plate': { kind: 'style', value: '#ffffff' },
		// The cinematic scrim base goes frosted-light for the variant that uses it.
		'lower-third.scrim': { kind: 'style', value: { color: '#eef1f4' } },
		'lower-third.textShadow': { kind: 'style', value: 'none' },
		// FORM dress (ADR-0023 appearance): the thin rule — 0.18cqmin ≈ 3.9px
		// @4K ≈ a 1px hairline at 1080 delivery (thinner vanishes on downscale —
		// the sub-pixel analog of the sub-pitch lesson); quiet rounding at ~5%
		// of the ~480px card (register center: stripe 4px–notion 16px @1x);
		// the measured notion shadow ramp ×2 with the two outer layers lifted
		// a step so the float survives compression; airy padding; the measured
		// vercel eyebrow tracking; semibold display weight.
		'lower-third.border': { kind: 'style', value: 'calc(0.18 * var(--cqmin)) solid #e3e8ee' },
		'lower-third.radius': { kind: 'style', value: 'calc(1.1 * var(--cqmin))' },
		'lower-third.shadow': {
			kind: 'style',
			value:
				'0 1px 2px rgba(9, 13, 20, 0.02), 0 2px 6px rgba(9, 13, 20, 0.04), 0 4px 16px rgba(9, 13, 20, 0.05), 0 8px 36px rgba(9, 13, 20, 0.08)'
		},
		'lower-third.pad': { kind: 'style', value: 'calc(3 * var(--cqmin)) calc(4.2 * var(--cqmin))' },
		'lower-third.gap': { kind: 'style', value: 'calc(0.9 * var(--cqmin))' },
		'lower-third.weight': { kind: 'style', value: '600' },
		'lower-third.tracking': { kind: 'style', value: '0.07em' },

		// Achievement notifications use the white-card product-film grammar:
		// cool ink/slate hierarchy, one blue for accent and success, a hairline,
		// and the quiet layered float rather than a chunky or emissive treatment.
		'achievement.plate': { kind: 'style', value: '#ffffff' },
		'achievement.ink': { kind: 'style', value: '#16181d' },
		'achievement.mutedInk': { kind: 'style', value: '#5b6472' },
		'achievement.accent': { kind: 'style', value: '#0075de' },
		'achievement.success': { kind: 'style', value: '#0075de' },
		'achievement.borderInk': { kind: 'style', value: '#d0d7e0' },
		'achievement.accentInk': { kind: 'style', value: '#ffffff' },
		'achievement.border': { kind: 'style', value: 'calc(0.18 * var(--cqmin)) solid #e3e8ee' },
		'achievement.radius': { kind: 'style', value: 'calc(1.1 * var(--cqmin))' },
		'achievement.shadow': {
			kind: 'style',
			value:
				'0 1px 2px rgba(9, 13, 20, 0.02), 0 2px 6px rgba(9, 13, 20, 0.04), 0 4px 16px rgba(9, 13, 20, 0.05), 0 8px 36px rgba(9, 13, 20, 0.08)'
		},
		'achievement.font': { kind: 'style', value: "'Geist', 'Inter', sans-serif" },
		'achievement.fontLabel': {
			kind: 'style',
			value: "'Geist Mono', ui-monospace, monospace"
		},
		'achievement.pad': {
			kind: 'style',
			value: 'calc(2.4 * var(--cqmin)) calc(3.2 * var(--cqmin))'
		},
		'achievement.gap': { kind: 'style', value: 'calc(1.2 * var(--cqmin))' },
		'achievement.tracking': { kind: 'style', value: '0.07em' },
		'achievement.weight': { kind: 'style', value: '600' },
		'achievement.kickerWeight': { kind: 'style', value: '500' },
		'source-url.plate': { kind: 'style', value: '#ffffff' },
		'source-url.ink': { kind: 'style', value: '#16181d' },
		'source-url.accent': { kind: 'style', value: '#0075de' },
		'source-url.border': { kind: 'style', value: 'calc(0.18 * var(--cqmin)) solid #e3e8ee' },
		'source-url.radius': { kind: 'style', value: 'calc(1.1 * var(--cqmin))' },
		'source-url.shadow': {
			kind: 'style',
			value:
				'0 1px 2px rgba(9, 13, 20, 0.02), 0 2px 6px rgba(9, 13, 20, 0.04), 0 4px 16px rgba(9, 13, 20, 0.05), 0 8px 36px rgba(9, 13, 20, 0.08)'
		},
		'source-url.fontLabel': { kind: 'style', value: "'Geist Mono', ui-monospace, monospace" },
		'source-url.pad': { kind: 'style', value: '0.5em 0.8em' },
		'source-url.tracking': { kind: 'style', value: '0.04em' },
		'source-url.weight': { kind: 'style', value: '600' },

		// Display echoes over footage run white — near-black ink vanishes on
		// dark footage; white + the quiet float is the register's overlay read.
		'watermark.ink': { kind: 'style', value: '#ffffff' },
		'watermark.accent': { kind: 'style', value: '#0075de' },
		'watermark.tracking': { kind: 'style', value: '0.07em' },
		'counter.ink': { kind: 'style', value: '#ffffff' },
		'instance-stack.ink': { kind: 'style', value: '#ffffff' },
		'dimensional-type.accent': { kind: 'style', value: '#0075de' },
		'dimensional-type.face': { kind: 'style', value: 'geist-700' },
		'dimensional-type.ink': { kind: 'style', value: '#16181d' },
		'text-3d.ink': { kind: 'style', value: '#ffffff' },

		// Paper tooth is not this register's material — the studio is
		// digital-clean (aesthetic.md anti-list: grain reads as dirt on white).
		// Categorical decline ('none', the house vocabulary): any authored
		// paper-grain goes inert, warmth cast included, and the inspector shows
		// it as pack · off. A NUMBER here would be a dial (quieter grain, still
		// live) — this pack declines the material outright.
		'paper-grain.strength': { kind: 'style', value: 'none' },

		// Tape is not this register's grammar (nothing is stuck down in a white
		// studio) — defensive values only, so a re-skinned Preset carrying tape
		// can never leak another pack's warm fibre tones.
		'washi-tape.grain-dark': { kind: 'style', value: 'rgba(13, 18, 26, 0.06)' },
		'washi-tape.grain-light': { kind: 'style', value: 'rgba(255, 255, 255, 0.05)' },

		// ---------------- motion primitives ----------------
		'cursor-trail.pointer': { kind: 'style', value: 'mac-pointer' },
		// Cool paper-blue persistence, soft falloff — the accent family at
		// screencast-cursor quietness.
		'cursor-trail.trailMaterial': { kind: 'style', value: { color: '#bfdcf9', softness: 0.4 } },

		// ---------------------------------------------------------------
		// FORM dress (ADR-0023 appearance) — the register's label grammar
		// corpus-wide: the measured mono-eyebrow tracking, semibold weight
		// (uniform 600 — hierarchy comes from size and the slate/ink split,
		// never from heavy cuts). Sentence case stays intrinsic — this pack
		// does not shout. (`lower-third.*` form roles live in Overlays above.)
		// ---------------------------------------------------------------
		'chapter-card.tracking': { kind: 'style', value: '0.07em' },
		'chapter-card.weight': { kind: 'style', value: '600' },
		'title-sequence.tracking': { kind: 'style', value: '0.07em' },
		'title-sequence.weight': { kind: 'style', value: '600' },
		'type-hero.tracking': { kind: 'style', value: '0.07em' },
		'pullquote-on-photo.tracking': { kind: 'style', value: '0.07em' },
		'instance-stack.weight': { kind: 'style', value: '600' },
		'text-3d.weight': { kind: 'style', value: '600' }
	}
};
