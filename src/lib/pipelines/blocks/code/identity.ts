/**
 * Identity Spec for the `code` diagram Block — a syntax-highlighted panel that
 * walks through Code steps, gliding the tokens two steps share and dimming the
 * lines a step does not highlight. The Pack supplies only the panel's fill and
 * ink; every token colour is derived from that pair, so no Pack Role exists.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const codeIdentity: IdentitySpec = {
	kind: 'graphic',
	claim: 'syntax-highlighted code that morphs between steps and dims what is not in focus',
	dimensions: [
		{
			name: 'fill-treatment',
			implementation:
				'src/lib/pipelines/blocks/code/CanvasSource.svelte — the panel paints the Pack fill-treatment and plain tokens the Pack ink-treatment (resolveTypographyColors, overrides first).',
			definition: 'Panel background and plain-token ink.',
			probe: {
				kind: 'named-observation',
				region: 'the code panel and its plain identifiers',
				expectation: 'panel = Pack fill, plain tokens = Pack ink, under every Pack.'
			}
		},
		{
			name: 'accent-treatment',
			implementation:
				'src/lib/pipelines/blocks/code/CanvasSource.svelte — each syntax role is oklch(from ink) at the ink lightness with a fixed hue per role; comments and punctuation mix ink toward the fill.',
			definition: 'Syntax colours, derived from the ink.',
			probe: {
				kind: 'named-observation',
				region: 'keywords, strings, and function names',
				expectation:
					'roles read as distinct hues at the ink lightness, so they hold contrast on the fill under every Pack.'
			}
		},
		{
			name: 'motion-form',
			implementation:
				'src/lib/utils/code-tokens.ts codeFrameAt — over a step move window, shared tokens glide between grid cells on the move ease, leaving tokens fade over the first half, arriving tokens over the second; driven by animState.globalProgress.',
			definition: 'The magic move between Code steps.',
			probe: {
				kind: 'named-observation',
				region: 'the panel at the middle of a move window',
				expectation:
					'tokens kept by both steps are in flight between their two places; nothing jumps at the window edges; preview and export match.'
			}
		},
		{
			name: 'frame-relationship',
			implementation:
				'src/lib/platform/DiagramMount.svelte positionStyle — the panel centres on its authored position; its size is the widest and tallest step, so it never resizes between steps.',
			definition: 'Where the panel sits and how big it is.',
			probe: {
				kind: 'named-observation',
				region: 'panel bounds across every step',
				expectation: 'the panel holds one size and place for the whole walkthrough.'
			}
		}
	]
};
