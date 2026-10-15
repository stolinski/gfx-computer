/**
 * Identity Spec for the `duplicate-pileup` Overlay: an inbox and a pull-request
 * list where the same email and the same pull request keep arriving after a
 * restart, until a collapse folds every duplicate back into the one real copy.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const duplicatePileupIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'the same email and pull request piling up as duplicates after a restart, then folding back into one copy each',
	dimensions: [
		{
			name: 'motion-form',
			definition:
				'Each copy drops in at the top of its list and pushes the others down; panels lean further as duplicates pile up; the collapse slides every duplicate into the real copy and straightens the panels.',
			implementation: 'src/lib/utils/duplicate-pileup-scene.ts — resolveDuplicatePileupScene.',
			probe: {
				kind: 'named-observation',
				region: 'a panel after its third copy',
				expectation: 'three rows, the newest on top, the two duplicates tinted and tagged, the panel leaning.'
			}
		},
		{
			name: 'fill-treatment',
			viaPack: 'duplicate-pileup.window',
			definition: 'The panel fill; the ink is the Pack field ink.',
			probe: {
				kind: 'named-observation',
				region: 'a panel body',
				expectation: 'the panel takes the Pack colour unless the composition authors one.'
			}
		},
		{
			name: 'accent-treatment',
			viaPack: 'duplicate-pileup.alert',
			definition: 'Duplicate rows, the count badge, and the restart stamp.',
			probe: {
				kind: 'named-observation',
				region: 'a duplicate row',
				expectation: 'its tint and tag take the Pack alert colour unless authored.'
			}
		},
		{
			name: 'good-treatment',
			viaPack: 'duplicate-pileup.good',
			definition: 'The clean state after the collapse: the count, the "once" tag, and the stamp.',
			probe: {
				kind: 'named-observation',
				region: 'the collapse stamp',
				expectation: 'it takes the Pack good colour unless authored.'
			}
		}
	]
};
