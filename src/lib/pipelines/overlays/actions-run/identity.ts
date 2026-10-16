/**
 * Identity Spec for the `actions-run` Overlay: a GitHub Actions run page whose
 * trigger line swaps, whose steps run, fail on a crash, and resume from the
 * failed step with the earlier steps restored rather than run again.
 */

import type { IdentitySpec } from '$lib/platform/pipelines/identity';

export const actionsRunIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'a recognizable GitHub Actions run page that crashes partway and resumes from the failed step without repeating the ones before it',
	packImmunity: {
		rationale:
			'The page is a found GitHub document: its light-theme palette, octicon status marks, layout, and interface type stay literal under every Pack so it reads instantly as GitHub. Placement, timing, and Effects remain composition-owned.'
	},
	dimensions: [
		{
			name: 'artifact-fidelity',
			definition:
				'The repository bar with the Actions tab current, the run title and number, the Triggered via / Status / Total duration summary, the job and its steps, and the Annotations box.',
			implementation:
				'src/lib/pipelines/overlays/actions-run/CanvasSource.svelte renders GitHub’s light Primer palette and octicon-shaped status marks.',
			probe: {
				kind: 'named-observation',
				region: 'the whole page under two Packs',
				expectation: 'it reads as a GitHub Actions run and is pixel-identical across Packs.'
			}
		},
		{
			name: 'motion-form',
			definition:
				'Steps spin while running and tick green as the next starts; a crash turns the running step and the run red and shows the error; a resume marks the earlier steps restored and runs the failed step again.',
			implementation: 'src/lib/utils/actions-run-scene.ts — resolveActionsRunScene.',
			probe: {
				kind: 'named-observation',
				region: 'the steps across the crash and the resume',
				expectation:
					'the failed step goes red, then after the resume the steps before it read restored and it runs again.'
			}
		}
	]
};
