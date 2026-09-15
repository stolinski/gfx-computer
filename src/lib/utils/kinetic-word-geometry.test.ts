import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { KineticWord } from '$lib/platform/engine-schema';
import {
	resolveKineticWordChannelKeyframes,
	resolveKineticWordGeometry
} from './kinetic-word-geometry';

function kineticWord(): KineticWord {
	return {
		type: 'kinetic-word',
		id: 'type',
		text: 'TYPE',
		hierarchy: 'display',
		ink: 'accent',
		position: { x: 0.4, y: 0.5 },
		scale: 1,
		rotation: 0,
		orientationOverrides: {
			vertical: { position: { x: 0.55, y: 0.42 }, scale: 1.2, rotation: -4 }
		},
		animation: {
			channels: {
				opacity: [{ atMs: 0, value: 1 }],
				x: [{ atMs: 0, value: -0.1 }],
				y: [{ atMs: 0, value: 0 }],
				scale: [{ atMs: 0, value: 1 }],
				rotation: [{ atMs: 0, value: 0 }],
				weight: [{ atMs: 0, value: 0.5 }]
			},
			orientationOverrides: {
				vertical: {
					x: [{ atMs: 0, value: 0.08 }],
					y: [{ atMs: 0, value: -0.04 }],
					scale: [{ atMs: 0, value: 1.3 }],
					rotation: [{ atMs: 0, value: 6 }]
				}
			}
		}
	};
}

describe('Kinetic Word orientation resolution', () => {
	it('resolves placement independently from motion channels', () => {
		const word = kineticWord();
		assert.deepEqual(resolveKineticWordGeometry(word, 'horizontal'), {
			position: { x: 0.4, y: 0.5 },
			scale: 1,
			rotation: 0
		});
		assert.deepEqual(resolveKineticWordGeometry(word, 'vertical'), {
			position: { x: 0.55, y: 0.42 },
			scale: 1.2,
			rotation: -4
		});
	});

	it('keeps shared opacity and weight while replacing all spatial tracks', () => {
		const word = kineticWord();
		const horizontal = resolveKineticWordChannelKeyframes(word, 'horizontal');
		const vertical = resolveKineticWordChannelKeyframes(word, 'vertical');
		assert.equal(horizontal.x?.[0]?.value, -0.1);
		assert.equal(vertical.x?.[0]?.value, 0.08);
		assert.equal(vertical.y?.[0]?.value, -0.04);
		assert.equal(vertical.scale?.[0]?.value, 1.3);
		assert.equal(vertical.rotation?.[0]?.value, 6);
		assert.equal(vertical.opacity, horizontal.opacity);
		assert.equal(vertical.weight, horizontal.weight);
	});
});
