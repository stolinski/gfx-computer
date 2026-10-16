/**
 * Identity Spec for the `terminal-run` Overlay: a macOS terminal window in
 * which an agent process prints its steps, gets killed, and is resumed from
 * the step it was on, the earlier steps restored rather than run again.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const terminalRunIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'an agent process in a real-looking terminal: it prints its steps, is killed partway, and a resume picks up at the step it was on',
	packImmunity: {
		rationale:
			'The window is a found terminal: its macOS chrome, dark theme, monospace type, and ANSI-style colours stay literal under every Pack so it reads instantly as a terminal. Placement, timing, and Effects remain composition-owned.'
	},
	dimensions: [
		{
			name: 'artifact-fidelity',
			definition:
				'Traffic-light title bar with the window title, a monospace screen, a green prompt, spinner and tick marks, coloured info, success and error lines, and a block cursor.',
			implementation:
				'src/lib/pipelines/overlays/terminal-run/CanvasSource.svelte renders the literal window chrome and theme.',
			probe: {
				kind: 'named-observation',
				region: 'the window under two Packs',
				expectation: 'it reads as a terminal and is pixel-identical across Packs.'
			}
		},
		{
			name: 'motion-form',
			definition:
				'Lines print at their times, a replacing line redraws the one above it, commands type out, a step spins until the next line prints and then ticks or crosses, and the cursor blinks while the prompt waits.',
			implementation: 'src/lib/utils/terminal-run-scene.ts — resolveTerminalRunScene.',
			probe: {
				kind: 'named-observation',
				region: 'the steps across the kill and the resume',
				expectation:
					'the step running at the kill crosses red; after the resume the earlier steps print dim as restored and the run finishes.'
			}
		}
	]
};
