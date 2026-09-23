/**
 * Syntax Pack manifest — per ADR-0014. Resolves every appearance Role
 * referenced by a registered Pipeline's Identity Spec `viaPack` clause (per
 * ADR-0019). Role keys follow the `<pipeline-type>.<role-id>` convention so
 * the engine's boot validator can pair a Pipeline's declared viaPack list
 * against the Pack's resolution.
 *
 * Per ADR-0023 a Pack is appearance only: colour, edge/depth/light treatment,
 * font, material, asset. Motion and frame-relationship are intrinsic to the
 * Pipeline and are NOT Roles here. Hex codes, font stacks, and structural
 * treatments that previously lived inline in the shipped Presets land here.
 * Adding a new Pack means copying this file, renaming the slug, and rewriting
 * every entry to a new channel's vocabulary — the Pipelines never change.
 */

import type { PackManifest } from '$lib/platform/packs/types';
import { syntaxFonts } from './fonts';

export const syntaxPack: PackManifest = {
	slug: 'syntax',
	label: 'Syntax',
	description:
		'The Syntax.fm house style (github.com/randyrektor/syntax-overlay): flat warm-black fields, bordered cards with chunky stepped shadows, Space Grotesk display + Space Mono chrome, one loud #ffd54a yellow. Substrate ≠ chrome: quoted documents keep their own physics.',
	fonts: syntaxFonts,
	roles: {
		// ---------------- chart Block domain (ADR-0048) ----------------
		// Final chart-specific colour Roles. Structural edge/depth/light
		// dimensions intentionally land on the mandatory core fallback floor.
		'chart.mark': { kind: 'style', value: '#ffd54a' },
		'chart.series-2': { kind: 'style', value: '#ff474e' },
		'chart.series-3': { kind: 'style', value: '#00fff5' },
		'chart.series-4': { kind: 'style', value: '#1f5aff' },
		'chart.axis': { kind: 'style', value: '#f7f6f2' },
		'chart.grid': { kind: 'style', value: '#454441' },
		'chart.label': { kind: 'style', value: '#f7f6f2' },
		'chart.annotation': { kind: 'style', value: '#ffd54a' },
		'chart.mark-fill': {
			kind: 'style',
			value: {
				seriesRoles: ['chart.mark', 'chart.series-2', 'chart.series-3', 'chart.series-4'],
				default: { mode: 'solid' },
				series: { mode: 'gradient', toRole: 'chart.axis', axis: 'inline' },
				emphasis: { mode: 'ordered-dither', toRole: 'chart.grid', matrix: '4x4', cellPx: 8 }
			}
		},

		// ---------------------------------------------------------------
		// Core / channel-level Roles (Pack vocabulary, not Pipeline-scoped).
		// The seven mandatory cores (fill/ink/accent/field/edge/depth/light) are
		// the ADR-0024 fallback floor every Pack must supply; the boot validator
		// (`validatePackCoreVocabulary`) refuses a Pack missing any of them.
		// ---------------------------------------------------------------
		// Colour cores ground in what syntax actually renders: the warm cream
		// paper and near-black ink of the channel's card system (render-is-truth
		// — measured from the pre-ADR-0056 newsprint clipping, which the paper
		// family still prints), and the accent is the canonical channel yellow
		// (aesthetic.md § Palette, the highlighter/kicker yellow).
		'fill-treatment': { kind: 'style', value: '#f0e8d6' },
		'ink-treatment': { kind: 'style', value: '#1a1612' },
		// The full-frame FIELD (ADR-0039 §3, `backgroundFill: 'pack'`): the flat
		// warm black every syntax full-frame piece sits on (calibration
		// 2026-07-09 — the brand field is flat, never a lit gradient).
		'field-treatment': { kind: 'style', value: '#0e0e0d' },
		// Primary channel text paired with that warm-black field.
		'field-ink-treatment': { kind: 'style', value: '#f7f6f2' },
		// Brand yellow per the real overlay system (github.com/randyrektor/
		// syntax-overlay, calibration 2026-07-09) — was #fabf47, which belongs to
		// the physical-highlighter mark defaults, not the chrome accent.
		'accent-treatment': { kind: 'style', value: '#ffd54a' },
		// The pack-wide type voice (2026-07-09): every chrome family inherits
		// Grotesk display + Space Mono labels automatically (a pack switch IS the
		// font switch); document substrates hardcode their faces in the
		// CanvasSource and never consume the voice vars.
		'font-treatment': { kind: 'style', value: "'Space Grotesk', 'Inter', sans-serif" },
		'font-label-treatment': { kind: 'style', value: "'Space Mono', ui-monospace, monospace" },
		'variable-weight-treatment': {
			kind: 'style',
			value: {
				fontFamily: "'Space Grotesk Variable', 'Space Grotesk', 'Inter', sans-serif",
				minimum: 300,
				rest: 650,
				maximum: 700
			}
		},
		// Core structural edge vocabulary (five values: clean/soft/irregular/
		// torn/none, resolved by resolveEdgeTreatment → the shared edge-treatment
		// ShaderPass). Brand ruling 2026-07-09: chrome never tears — clean is the
		// default; quoted-document substrates keep their own edge physics.
		'edge-treatment': {
			kind: 'style',
			value: 'clean'
		},
		'depth-treatment': {
			kind: 'style',
			value: { hardOffset: { dx: 8, dy: 8, blur: 0, color: 'fg' } }
		},
		'light-treatment': {
			kind: 'style',
			value: { direction: 'upper-left', intensity: 0.45 }
		},

		// ---------------- plain Surface ----------------
		'plain.edge': { kind: 'style', value: 'clean' },
		'plain.depth': { kind: 'style', value: { offset: { dx: 8, dy: 8, blur: 0 } } },

		// ---------------- chapter-card Surface ----------------
		'chapter-card.edge': { kind: 'style', value: 'clean' },
		'chapter-card.depth': { kind: 'style', value: { hardOffset: { dx: 10, dy: 10, blur: 0 } } },
		// Consumed color Roles (render-is-truth — match what CanvasSource paints).
		// Warm off-white (not pure #fff): agrees with the upper-right warm key and
		// keeps Q17 emphasis headroom — matches the preset's declared inkColor.
		'chapter-card.ink': { kind: 'style', value: '#f7f6f2' },
		'chapter-card.base': { kind: 'style', value: '#f7f6f2' },
		'chapter-card.kicker': { kind: 'style', value: '#ffd54a' },
		'chapter-card.rule': { kind: 'style', value: '#454441' },
		// WGSL backdrop tints — FLAT brand field (2026-07-09): the light is
		// additive so #000000 zeroes it; top == bottom kills the gradient (and
		// makes the baked camera dolly a no-op on the flat field).
		'chapter-card.backdrop': {
			kind: 'style',
			value: { top: '#0e0e0d', bottom: '#0e0e0d', light: '#000000' }
		},

		// ---------------- checklist Surface (ADR-0040) ----------------
		// The house card system (aesthetic.md § The Card System, values at the 4K
		// frame): warm-dark plate, visible border, rounded corners, the stepped
		// hard-offset shadow. Numbers speak Space Mono in the channel yellow;
		// item text speaks Grotesk. The bare (`chrome: 'none'`) mode's hard
		// legibility shadow rides the same shadow ink as the stepped stack.
		'checklist.plate': { kind: 'style', value: '#141413' },
		'checklist.ink': { kind: 'style', value: '#f7f6f2' },
		'checklist.accent': { kind: 'style', value: '#ffd54a' },
		'checklist.border': { kind: 'style', value: '6px solid #454441' },
		'checklist.radius': { kind: 'style', value: '16px' },
		'checklist.shadow': {
			kind: 'style',
			value:
				'4px 4px 0 0 #050504, 8px 8px 0 0 #050504, 12px 12px 0 0 #050504, 16px 16px 0 0 #050504, 20px 20px 0 0 #050504, 24px 24px 0 0 #050504, 28px 28px 0 0 #050504, 32px 32px 0 0 #050504, 36px 36px 0 0 #050504, 40px 40px 0 0 #050504'
		},
		'checklist.font': { kind: 'style', value: "'Space Grotesk', 'Inter', sans-serif" },
		'checklist.fontLabel': { kind: 'style', value: "'Space Mono', ui-monospace, monospace" },
		'checklist.textShadow': { kind: 'style', value: '0.05em 0.055em 0 rgba(5, 5, 4, 0.85)' },
		// Structural: the CSS shadow stack above IS the depth dress (the
		// lower-third precedent), so the structural depth Role stays flat; the
		// border/radius carry the edge claim.
		'checklist.edge': { kind: 'style', value: 'clean' },
		'checklist.depth': { kind: 'style', value: 'none' },

		// ---------------- pullquote-on-photo Surface ----------------
		// Consumed color Roles (render-is-truth — match what CanvasSource paints).
		'pullquote-on-photo.ink': { kind: 'style', value: '#ffffff' },
		'pullquote-on-photo.byline': { kind: 'style', value: '#f4ecdc' },
		// WGSL backdrop tints (render-is-truth — exact byte conversions of the
		// pullquote-photo-backdrop pass's vec3f constants): near-black gradient,
		// warm-neutral upper-left light, warm entrance sweep band.
		'pullquote-on-photo.backdrop': {
			kind: 'style',
			value: { top: '#0e0e0d', bottom: '#0e0e0d', light: '#000000', sweep: '#000000' }
		},

		// (No newspaper Roles: the photographed page is a fully immune faithful
		// artifact — ADR-0056 — its sheet, ink, and type live in
		// `newsprint-substrate.ts` and the Surface's CanvasSource.)

		// ---------------- title-sequence Surface ----------------
		'title-sequence.edge': { kind: 'style', value: 'none' },
		'title-sequence.depth': { kind: 'style', value: 'none' },
		// Consumed color Roles (render-is-truth — match what CanvasSource paints).
		'title-sequence.ink': { kind: 'style', value: '#f7f6f2' },
		'title-sequence.kicker': { kind: 'style', value: '#ffd54a' },
		// WGSL backdrop tints — FLAT brand field (2026-07-09): additive glow
		// zeroed, gradient flattened; the atmosphere grammar is not the brand.
		'title-sequence.backdrop': {
			kind: 'style',
			value: { top: '#0e0e0d', bottom: '#0e0e0d', glow: '#000000' }
		},

		// ---------------- type-hero Surface ----------------
		'type-hero.edge': { kind: 'style', value: 'clean' },
		'type-hero.depth': { kind: 'style', value: 'none' },
		// The raked-light dimension at full strength (render-is-truth — the
		// identity spec's viaPack seam resolves here; intensity 1 packs the
		// pass's original constants, bit-identical to the pre-routing render).
		'type-hero.light': { kind: 'style', value: { intensity: 1 } },
		// Consumed color Roles — brand tokens (syntax-overlay repo, 2026-07-09):
		// #f7f6f2 text, #ffd54a accent, #c9c6bc byline; the amber/sand warms
		// read as generic template, not Syntax.
		'type-hero.text-base': { kind: 'style', value: '#f7f6f2' },
		'type-hero.ink': { kind: 'style', value: '#f7f6f2' },
		'type-hero.accent': { kind: 'style', value: '#ffd54a' },
		'type-hero.byline': { kind: 'style', value: '#c9c6bc' },
		'type-hero.weight': { kind: 'style', value: '700' },
		'type-hero.stretch': { kind: 'style', value: 'normal' },
		// WGSL backdrop tints. The brand field is FLAT warm black (calibration
		// 2026-07-09: drifting atmosphere bands + particle motes read as another
		// channel's cinematic grammar, not Syntax) — bands/motes are additive in
		// the pass, so pure black zeroes them; top == bottom kills the gradient.
		// The letterform rim/carve grade stays intrinsic to the pass.
		'type-hero.backdrop': {
			kind: 'style',
			value: {
				top: '#0e0e0d',
				bottom: '#0e0e0d',
				warmBand: '#000000',
				coolBand: '#000000',
				particle: '#000000'
			}
		},

		// ---------------- Diagram Blocks (ADR-0036) ----------------
		// One pen for the whole diagram, in the composition's ink (the 'ink'
		// sentinel resolves to the typography.inkColor override → core
		// ink-treatment, ADR-0038 — so strokes flip with the preset over
		// footage). Arrowheads are solid marker triangles. wobble 0: the docu
		// register wants clean documentary rules — the hand-drawn jitter read as
		// jank on the timeline axis, not charm (calibration verdict 2026-07-09).
		'diagram.stroke': { kind: 'style', value: { color: 'ink', widthPx: 12, wobble: 0 } },
		'diagram.arrowhead': { kind: 'style', value: 'solid-triangle' },
		// Diagram DOM chrome voice — Space Mono (read by DiagramMount ahead of the
		// engine typography voice; NOT a core font-treatment claim, which would
		// override document substrates' own faces).
		'diagram.font': { kind: 'style', value: "'Space Mono', ui-monospace, monospace" },
		// Node forms: white collage-card boxes (the zine cut-out), accent pins
		// and dots; the box shadow rides the core hard-offset depth rig.
		'node.fill': { kind: 'style', value: '#ffffff' },
		'node.accent': { kind: 'style', value: '#ffd54a' },
		// The node's border/stroke/glyphs ride the inherited composition colour
		// (render-is-truth: the CanvasSource paints `var(--ink, currentColor)`);
		// claimed explicitly so the core `ink-treatment` fallback can't repaint it.
		'node.ink': { kind: 'style', value: 'currentColor' },
		'node.depth': {
			kind: 'style',
			value: { hardOffset: { dx: 8, dy: 8, blur: 0, color: 'rgba(0, 0, 0, 0.85)' } }
		},
		// Caption + stat voices ride the composition ink / channel accent.
		'label.ink': { kind: 'style', value: 'currentColor' },
		'stat-callout.accent': { kind: 'style', value: '#ffd54a' },
		'stat-callout.ink': { kind: 'style', value: 'currentColor' },

		// ---------------- Annotation tool inks ----------------
		'highlight.fill': { kind: 'style', value: '#fabf47' },
		'underline.fill': { kind: 'style', value: '#00fff5' },
		'strike.fill': { kind: 'style', value: '#ff474e' },
		'circle.fill': { kind: 'style', value: '#ff474e' },
		'box.fill': { kind: 'style', value: '#1f5aff' },

		// ---------------- Annotation focal chrome ----------------
		'tear-out.fill': { kind: 'style', value: '#ffffff' },

		// ---------------- Overlays ----------------
		// The Syntax house card (calibration 2026-07-09, matched to the real
		// live-stream overlays — github.com/randyrektor/syntax-overlay): a FLAT
		// warm-dark card with a visible border, rounded corners, and the signature
		// chunky stepped hard-offset shadow. No gloss, no gradients, no glow —
		// the earlier "cinematic" scrim/flare dress read as generic template.
		// Values are the repo's, scaled ×2 for the 4K frame (repo authored ~1080p).
		'lower-third.accent': { kind: 'style', value: '#ffd54a' },
		'lower-third.ink': { kind: 'style', value: '#f7f6f2' },
		'lower-third.roleInk': { kind: 'style', value: '#c9c6bc' },
		'lower-third.plate': { kind: 'style', value: '#141413' },
		// Chrome scales with the CARD's proportions, not the frame's resolution
		// (first pass converted the repo's 1080p values ×2 and rendered hairline).
		// Repo card ≈ 95px tall: border 2px ≈ 2.1% of card height, radius 8px ≈
		// 8.4%, shadow 10 × 1px steps ≈ 10.5% total, pad 14/20 ≈ 15%/21%. Our
		// card ≈ 480px @4K → the same ratios below.
		'lower-third.border': { kind: 'style', value: '10px solid #454441' },
		'lower-third.radius': { kind: 'style', value: '40px' },
		'lower-third.shadow': {
			kind: 'style',
			value:
				'5px 5px 0 0 #050504, 10px 10px 0 0 #050504, 15px 15px 0 0 #050504, 20px 20px 0 0 #050504, 25px 25px 0 0 #050504, 30px 30px 0 0 #050504, 35px 35px 0 0 #050504, 40px 40px 0 0 #050504, 45px 45px 0 0 #050504, 50px 50px 0 0 #050504'
		},
		'lower-third.pad': { kind: 'style', value: '68px 100px 72px 96px' },
		'lower-third.gap': { kind: 'style', value: '20px' },
		'lower-third.weight': { kind: 'style', value: '700' },
		'lower-third.tracking': { kind: 'style', value: '0.08em' },
		// The cinematic scrim base stays claimed for the variant that uses it.
		'lower-third.scrim': { kind: 'style', value: { color: '#08060a' } },

		// Consumed appearance Roles wired into the overlay CanvasSources
		// (render-is-truth — values match what each CanvasSource paints).
		'achievement.plate': { kind: 'style', value: '#141413' },
		'achievement.ink': { kind: 'style', value: '#f7f6f2' },
		'achievement.mutedInk': { kind: 'style', value: '#8a8883' },
		'achievement.accent': { kind: 'style', value: '#ffd54a' },
		'achievement.success': { kind: 'style', value: '#3dd816' },
		'achievement.borderInk': { kind: 'style', value: '#454441' },
		'achievement.accentInk': { kind: 'style', value: '#0a0a09' },
		'achievement.border': { kind: 'style', value: '6px solid #454441' },
		'achievement.radius': { kind: 'style', value: '16px' },
		'achievement.shadow': {
			kind: 'style',
			value:
				'4px 4px 0 0 #050504, 8px 8px 0 0 #050504, 12px 12px 0 0 #050504, 16px 16px 0 0 #050504, 20px 20px 0 0 #050504, 24px 24px 0 0 #050504, 28px 28px 0 0 #050504, 32px 32px 0 0 #050504, 36px 36px 0 0 #050504, 40px 40px 0 0 #050504'
		},
		'achievement.font': { kind: 'style', value: "'Space Grotesk', 'Inter', sans-serif" },
		'achievement.fontLabel': { kind: 'style', value: "'Space Mono', ui-monospace, monospace" },
		'achievement.pad': { kind: 'style', value: '0.048em 0.058em' },
		'achievement.gap': { kind: 'style', value: '0.045em' },
		'achievement.tracking': { kind: 'style', value: '0.08em' },
		'achievement.weight': { kind: 'style', value: '700' },
		'achievement.kickerWeight': { kind: 'style', value: '700' },
		'source-url.plate': { kind: 'style', value: '#141413' },
		'source-url.ink': { kind: 'style', value: '#f7f6f2' },
		'source-url.accent': { kind: 'style', value: '#ffd54a' },
		'source-url.border': { kind: 'style', value: '6px solid #454441' },
		'source-url.radius': { kind: 'style', value: '16px' },
		'source-url.shadow': {
			kind: 'style',
			value:
				'4px 4px 0 0 #050504, 8px 8px 0 0 #050504, 12px 12px 0 0 #050504, 16px 16px 0 0 #050504, 20px 20px 0 0 #050504'
		},
		'source-url.fontLabel': { kind: 'style', value: "'Space Mono', ui-monospace, monospace" },
		'source-url.pad': { kind: 'style', value: '0.5em 0.8em' },
		'source-url.tracking': { kind: 'style', value: '0.02em' },
		'source-url.weight': { kind: 'style', value: '700' },
		'watermark.ink': { kind: 'style', value: '#f7f6f2' },
		'watermark.accent': { kind: 'style', value: '#ffd54a' },
		'counter.ink': { kind: 'style', value: '#ffd54a' },
		'instance-stack.ink': { kind: 'style', value: '#ffd54a' },
		'dimensional-type.accent': { kind: 'style', value: '#ffd54a' },
		'dimensional-type.face': { kind: 'style', value: 'space-grotesk-700' },
		'dimensional-type.ink': { kind: 'style', value: '#f7f6f2' },
		'text-3d.ink': { kind: 'style', value: '#ffd54a' },
		// Washi-tape procedural grain — the dark/light fibre stops in the tape's
		// gradient stack (alpha-bound; previously inline literals, now Pack-routed).
		// The tape tint is the channel's physical-highlighter yellow — measured
		// from the collage system, deliberately NOT the chrome accent #ffd54a
		// (the same split as the highlight mark). Unauthored tapes ride this;
		// packs silent on the slot fall to their core accent.
		'washi-tape.color': { kind: 'style', value: '#fabf47' },
		'washi-tape.grain-dark': { kind: 'style', value: 'rgba(0, 0, 0, 0.08)' },
		'washi-tape.grain-light': { kind: 'style', value: 'rgba(255, 255, 255, 0.06)' },
		// ---------------- motion-primitives v1 (Phase 4.2-4.4) ----------------
		'cursor-trail.pointer': { kind: 'style', value: 'mac-pointer' },
		// Trail material — the CanvasSource composes this one colour at several
		// alphas (rgb-channel var, via resolveColorChannels) for the velocity
		// fade; `softness` sets the gradient falloff midpoint. A warm off-white
		// realises the channel's long-declared `linear-fade-warm` intent.
		'cursor-trail.trailMaterial': {
			kind: 'style',
			value: { color: '#ffe9c8', softness: 0.35 }
		}
	}
};
