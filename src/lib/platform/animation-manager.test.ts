import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { AnimationManager, type AnimationManifest } from './animation-manager';

function manifestWriting(slot: { value: number }): AnimationManifest {
	return {
		tweens: [
			{
				key: 'probe',
				start: 0.2,
				duration: 0.4,
				ease: 'none',
				from: 0,
				to: 1,
				onUpdate: (value) => {
					slot.value = value;
				}
			}
		]
	};
}

describe('AnimationManager', () => {
	it('restores the playhead value when an unchanged manifest re-seeds its slots', () => {
		const slot = { value: 0 };
		const manager = new AnimationManager();
		manager.rebuild(manifestWriting(slot));
		manager.progress(0.4);
		assert.ok(Math.abs(slot.value - 0.5) < 1e-9);

		// A rebuild (an orientation switch, an edit that leaves the tweens alone)
		// re-seeds the slot; the same position must still show the scrubbed value.
		slot.value = 0;
		manager.rebuild(manifestWriting(slot));
		manager.progress(0.4);
		assert.ok(Math.abs(slot.value - 0.5) < 1e-9, `got ${slot.value}`);
		manager.dispose();
	});
});
