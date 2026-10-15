/**
 * Identity Spec for the `icon-orbit` Overlay: glowing line icons that launch
 * from below the frame, spring into place around the subject, and circle them
 * in depth. Motion and depth are intrinsic (the physics is the point); the
 * glow colour concedes to the Pack.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const iconOrbitIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'glowing line icons that float up from below, drift into place around the subject, and circle them in depth, split into behind and in-front passes for compositing',
	dimensions: [
		{
			name: 'motion-form',
			definition:
				'Each icon is a heavily damped spring integrated at a fixed step from its launch: it floats up slowly with a sideways sway, settles into its place without shooting past it, then turns with the ring around the subject, still drifting a little.',
			implementation: 'src/lib/utils/icon-orbit-flight.ts — resolveIconOrbitFlight.',
			probe: {
				kind: 'named-observation',
				region: 'an icon in its first two seconds after launch',
				expectation:
					'the icon drifts up on a gently curving path, never streaks, and sheds a few twinkling motes that hang in the air.'
			}
		},
		{
			name: 'depth-treatment',
			definition:
				'Depth is the icon’s place on its orbit: nearer icons are larger and brighter, icons behind the subject are smaller, dimmer, and softer. The pass setting keeps only the icons behind or in front.',
			implementation: 'src/lib/utils/icon-orbit-scene.ts — resolveIconOrbitScene.',
			probe: {
				kind: 'named-observation',
				region: 'an icon crossing behind the subject',
				expectation:
					'it shrinks and softens as it goes behind; the behind pass shows it only while behind, the front pass only while in front.'
			}
		},
		{
			name: 'fill-treatment',
			viaPack: 'icon-orbit.glow',
			definition: 'The glow colour; the stroke core stays near white.',
			probe: {
				kind: 'named-observation',
				region: 'an icon bloom',
				expectation:
					'the bloom takes the Pack icon-orbit.glow colour unless the composition authors one.'
			}
		}
	]
};
