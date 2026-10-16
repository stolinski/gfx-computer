/**
 * Identity Spec for the `duplicate-pileup` Overlay: a Gmail inbox and a GitHub
 * pull-request list where the same email and the same pull request keep
 * arriving after a restart, until a collapse folds every duplicate back into
 * the one real copy.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const duplicatePileupIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'the same email and pull request piling up as duplicates after a restart, then folding back into one copy each',
	packImmunity: {
		rationale:
			'The panels are found Gmail and GitHub documents: their light-theme palettes, row anatomy, and interface type stay literal under every Pack so they read instantly as the real products. Placement, timing, and Effects remain composition-owned.'
	},
	dimensions: [
		{
			name: 'artifact-fidelity',
			definition:
				'An inbox row has a checkbox, star, bold sender, subject and grey snippet, and time; a pull request row has the green open-PR octicon, bold title, label, and "#n opened … by" line.',
			implementation:
				'src/lib/pipelines/overlays/duplicate-pileup/CanvasSource.svelte renders the literal Gmail and GitHub light palettes.',
			probe: {
				kind: 'named-observation',
				region: 'each panel under two Packs',
				expectation: 'each reads as Gmail or GitHub and is pixel-identical across Packs.'
			}
		},
		{
			name: 'motion-form',
			definition:
				'Each copy drops in at the top of its list, highlighted as new, and pushes the others down; panels lean further as duplicates pile up; the collapse slides every duplicate into the real copy and straightens the panels.',
			implementation: 'src/lib/utils/duplicate-pileup-scene.ts — resolveDuplicatePileupScene.',
			probe: {
				kind: 'named-observation',
				region: 'a panel after its third copy',
				expectation: 'three identical rows, the newest on top and highlighted, the panel leaning.'
			}
		}
	]
};
