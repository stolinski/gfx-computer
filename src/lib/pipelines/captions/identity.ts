/**
 * Identity Spec for the captions track (creator blocks, grilled 2026-07-09).
 * Two appearance lanes by design: the faithful social styles (karaoke /
 * word-pop — the register creators expect over footage, pack-independent by
 * intent but NOT declared pack-immune, because the third style exists) and
 * the `pack` style, which dresses the line from the active Pack. Rendered by
 * `src/lib/platform/CaptionsMount.svelte`, topmost in every render path.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const captionsIdentity: IdentitySpec = {
	kind: 'graphic',
	claim: 'broadcast captions welded to speech — social karaoke/word-pop or the Pack’s own line',
	dimensions: [
		{
			name: 'style-fidelity',
			definition:
				'The karaoke and word-pop styles read as the social-caption register creators expect: heavy white type, hard outline, accent on the spoken word — independent of the active Pack. The `pack` style instead takes the Pack’s ink and type voice.',
			implementation:
				'src/lib/platform/CaptionsMount.svelte — karaoke/word-pop carry literal social styling (white 800-weight, 4-way text-shadow outline, accent pill/ink); the pack style resolves ink via resolveTypographyColors (typography override → Pack core ink-treatment, ADR-0038) and type via the Pack’s --font appearance var.',
			probe: {
				kind: 'named-observation',
				region: 'the caption band at 200% under two Packs, once per style',
				expectation:
					'karaoke/word-pop render identically under both Packs; the pack style visibly re-dresses (ink + type voice change).'
			}
		},
		{
			name: 'temporal-weld',
			definition:
				'Cues carry absolute milliseconds (SRT’s clock): captions sit on speech and must not stretch when the transport re-times. Per-word timing derives proportionally within each cue.',
			implementation:
				'src/lib/platform/engine-schema.ts CaptionsSchema (startMs/endMs) + src/lib/utils/srt.ts cueWordWindows — the active cue/word is a pure function of the timeline clock (globalProgress × transport ms); no tweens, no CSS transitions.',
			probe: {
				kind: 'named-observation',
				region: 'the same cue boundary frame across two captures',
				expectation:
					'cue swaps land on their exact ms in every run (pixel-identical re-captures); word highlight advances through the line proportionally.'
			}
		},
		{
			name: 'motion-form',
			definition:
				'Word-pop entrance: the word lands with a fast eased pop (120 ms) resting at exactly 1; karaoke’s highlight cuts word-to-word (captions cut, they don’t float). Cue enter/exit are hard cuts, faithful to broadcast captions.',
			implementation:
				'src/lib/platform/CaptionsMount.svelte popScale — derived from the clock, identity outside the pop window (capture-safe: the mount never fades, no lingering transforms).',
			probe: {
				kind: 'named-observation',
				region: 'frames across a word boundary in word-pop style',
				expectation:
					'the incoming word pops from ~0.78 scale to rest within 120 ms and holds at exactly 1; nothing drifts.'
			}
		},
		{
			name: 'frame-relationship',
			definition:
				'A centred caption band whose vertical position and scale are composition data; the band clears platform-UI safe zones in both orientations.',
			implementation:
				'src/lib/platform/CaptionsMount.svelte — band centre and scale from the active orientation snapshot, else captions.y / captions.scale (resolveCaptionsBandPlacement), max-inline-size 78%; topmost (above overlays) in flat and split render paths.',
			probe: {
				kind: 'named-observation',
				region: 'the caption band in horizontal and vertical demos',
				expectation:
					'the band centres on its authored y, clears the G3 bands, and renders above overlay content.'
			}
		}
	]
};
