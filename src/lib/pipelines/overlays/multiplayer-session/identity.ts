/**
 * Identity Spec for the `multiplayer-session` Overlay: one agent window that
 * several people work in at once. Their named cursors fly in, type into the
 * shared prompt side by side, send, fork child runs, and all see the same
 * paused state. The window's colours concede to the Pack; the people's
 * colours are content.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const multiplayerSessionIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'one agent window that several people use at the same time: named cursors type into a shared prompt together, steer and fork the run, and see the same saved state',
	dimensions: [
		{
			name: 'motion-form',
			definition:
				'Cursors glide on eased paths between the things they act on (their caret while typing, the send button, a new fork card, the approval card) and drift slightly at rest; run-log lines grow in from the prompt and push older lines up.',
			implementation:
				'src/lib/utils/multiplayer-session-scene.ts — resolveMultiplayerSessionScene.',
			probe: {
				kind: 'named-observation',
				region: 'two people typing at the same time',
				expectation:
					'each draft grows on its own row in its person’s colour, with that person’s cursor riding its caret.'
			}
		},
		{
			name: 'fill-treatment',
			viaPack: 'multiplayer-session.window',
			definition: 'The window and fork-card fill; the ink is the Pack field ink.',
			probe: {
				kind: 'named-observation',
				region: 'the window body',
				expectation: 'the window takes the Pack field colour unless the composition authors one.'
			}
		},
		{
			name: 'accent-treatment',
			viaPack: 'multiplayer-session.accent',
			definition: 'The send button, the waiting state, and the approval card.',
			probe: {
				kind: 'named-observation',
				region: 'the approval card',
				expectation: 'it takes the Pack accent unless the composition authors one.'
			}
		}
	]
};
