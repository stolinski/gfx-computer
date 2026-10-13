import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { trackCompositionAuthoringDependencies } from './composition-authoring-dependencies';
import { createDefaultEngineState, type Stage } from './engine-schema';

describe('trackCompositionAuthoringDependencies', () => {
	it('synchronously deep-reads stage camera, focus, backdrop asset, and contrast', () => {
		const state = createDefaultEngineState();
		const reads: string[] = [];
		const stage = {
			type: 'depth',
			get camera() {
				reads.push('camera');
				return { move: 'push' as const, amount: 0.4, ease: 'smooth' as const };
			},
			get focus() {
				reads.push('focus');
				return { focusZ: 0.2, aperture: 0.5, band: 0.1 };
			},
			get backdrop() {
				reads.push('backdrop');
				return { image: { asset: 'coast-bedrock' }, contrast: 0.3 };
			}
		} satisfies Stage;
		state.stage = stage;

		trackCompositionAuthoringDependencies(state, 'syntax');

		assert.deepEqual(reads.sort(), ['backdrop', 'camera', 'focus']);
	});
});
