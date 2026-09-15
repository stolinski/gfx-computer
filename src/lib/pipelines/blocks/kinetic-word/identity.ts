/** Identity Spec for one first-class word in a Type Field (ADR-0063). */
import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const kineticWordIdentity: IdentitySpec = {
	kind: 'graphic',
	claim: 'one crisp, placed display or supporting word in a semantic phrase field',
	dimensions: [
		{
			name: 'fill-treatment',
			viaPack: 'ink-treatment',
			definition: 'The word ink, with an authored accent-role selection when requested.',
			probe: {
				kind: 'named-observation',
				region: 'a Kinetic Word glyph',
				expectation:
					'ink resolves from the composition field/ink chain, or from the Pack accent when the word selects accent.'
			}
		},
		{
			name: 'font-treatment',
			viaPack: 'variable-weight-treatment',
			definition: 'A real Pack-owned variable display face at its art-directed rest weight.',
			probe: {
				kind: 'named-observation',
				region: 'a Kinetic Word outline',
				expectation:
					'the exact Pack variable face is loaded, synthesis is disabled, and the static word uses the Pack rest wght coordinate.'
			}
		},
		{
			name: 'motion-form',
			implementation:
				'src/lib/platform/KineticTypeFieldMount.svelte — static in this substrate step; authored independent channels own later motion.',
			definition: 'No hidden intrinsic animation competes with authored word tracks.',
			probe: {
				kind: 'named-observation',
				region: 'a Kinetic Word across two scrubbed timestamps',
				expectation: 'static words remain pixel-stable until an authored word track owns motion.'
			}
		},
		{
			name: 'frame-relationship',
			implementation:
				'src/lib/utils/kinetic-word-geometry.ts and src/lib/platform/KineticTypeFieldMount.svelte — a complete orientation-resolved centre, scale, and rotation snapshot.',
			definition: 'Explicit normalized placement in the native composition frame.',
			probe: {
				kind: 'named-observation',
				region: 'each Kinetic Word against the frame',
				expectation:
					'the word centre, scale, and rotation match the active orientation snapshot without auto-layout.'
			}
		}
	]
};
