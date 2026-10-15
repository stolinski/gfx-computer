import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const achievementIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'a compact corner notification whose authored focal beat confirms a completed task or celebrates an unlock',
	dimensions: [
		{
			name: 'fill-treatment',
			viaPack: 'achievement.plate',
			definition: 'The opaque notification plate behind the icon and copy.',
			probe: {
				kind: 'named-observation',
				region: 'the notification card body',
				expectation: 'the plate resolves from achievement.plate with no gradient or gloss.'
			}
		},
		{
			name: 'edge-treatment',
			viaPack: 'achievement.border',
			definition: 'The card border and its clean printed boundary.',
			probe: {
				kind: 'named-observation',
				region: 'the card perimeter',
				expectation: 'the border is visible, clean, and Pack-resolved.'
			}
		},
		{
			name: 'corner-treatment',
			viaPack: 'achievement.radius',
			definition: 'The corner radius of the notification plate.',
			probe: {
				kind: 'named-observation',
				region: 'all four card corners',
				expectation: 'all corners use the achievement.radius Role consistently.'
			}
		},
		{
			name: 'depth-treatment',
			viaPack: 'achievement.shadow',
			definition: 'The Pack-resolved depth treatment beneath the plate.',
			probe: {
				kind: 'named-observation',
				region: 'beneath the lower-right card edge',
				expectation: 'depth matches achievement.shadow and never becomes gaussian ambience.'
			}
		},
		{
			name: 'ink-hierarchy',
			viaPack: 'achievement.ink',
			definition: 'Primary title ink on the card.',
			probe: {
				kind: 'named-observation',
				region: 'the title',
				expectation: 'the title resolves from achievement.ink and remains the stable text read.'
			}
		},
		{
			name: 'muted-ink',
			viaPack: 'achievement.mutedInk',
			definition: 'The completed checklist title’s quieter landed ink.',
			probe: {
				kind: 'named-observation',
				region: 'the checklist title after its beat',
				expectation: 'the title quiets slightly through the Pack muted ink without disappearing.'
			}
		},
		{
			name: 'accent-treatment',
			viaPack: 'achievement.accent',
			definition: 'The kicker, chip, and star emphasis ink.',
			probe: {
				kind: 'named-observation',
				region: 'the kicker, chip, or star icon',
				expectation:
					'one Pack accent carries the notification emphasis, including the star icon and its ring.'
			}
		},
		{
			name: 'success-treatment',
			viaPack: 'achievement.success',
			definition: 'The semantic success ink used only by the checklist completion.',
			probe: {
				kind: 'named-observation',
				region: 'the drawn checklist check',
				expectation: 'success ink appears only as the check resolves.'
			}
		},
		{
			name: 'display-type',
			viaPack: 'achievement.font',
			definition: 'The display face used for the title.',
			probe: {
				kind: 'named-observation',
				region: 'the title letterforms',
				expectation: 'title typography resolves from achievement.font.'
			}
		},
		{
			name: 'label-type',
			viaPack: 'achievement.fontLabel',
			definition: 'The chrome face used for the uppercase kicker or chip.',
			probe: {
				kind: 'named-observation',
				region: 'the kicker or chip letterforms',
				expectation: 'label typography resolves from achievement.fontLabel.'
			}
		},
		{
			name: 'motion-form',
			definition:
				'The card crosses the right edge, settles once, performs one focal beat in its chosen motion, holds, and accelerates back through the same edge.',
			implementation:
				'src/lib/platform/OverlayMount.svelte edgeTransition right motion plus the pure achievement-motion.ts motionState functions (draw, pop) driven from animState.globalProgress and content.beat.',
			probe: {
				kind: 'named-observation',
				region: 'entry, authored focal beat, and exit frames',
				expectation:
					'the card travels decisively from and to the right edge; draw draws the ring’s glyph and quiets the title, pop pops the ringed icon and then the kicker; repeated frames are pixel-identical.'
			}
		},
		{
			name: 'frame-relationship',
			definition:
				'An upper-right compact card at 32% horizontal width, reflowing to 82% vertical width within platform safe areas.',
			implementation:
				'src/lib/pipelines/overlays/achievement/achievement-frame-layout.ts achievementFrameLayout plus top-right Overlay position with 10% right and 8% top insets.',
			probe: {
				kind: 'named-observation',
				region: 'the full horizontal and vertical frames',
				expectation:
					'the card is compact in horizontal and reflows wide in vertical without clipping or entering the top/action safe bands.'
			}
		}
	]
};
