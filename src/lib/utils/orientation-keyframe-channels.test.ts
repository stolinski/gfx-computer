import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { Keyframe } from '$lib/platform/engine-schema';

import {
	deleteOrientationKeyframe,
	isSpatialKeyframeChannel,
	resolveOrientationKeyframeChannels,
	type OrientationKeyframeAnimation
} from './orientation-keyframe-channels';

function track(...values: number[]): Keyframe[] {
	return values.map((value, index) =>
		index === 0 ? { atMs: 0, value } : { atMs: index * 100, value, ease: 'smooth' }
	);
}

function animation(): OrientationKeyframeAnimation<Partial<Record<string, Keyframe[]>>> {
	return {
		channels: { opacity: track(0, 1), x: track(0.1, 0) },
		orientationOverrides: {
			vertical: { x: track(0, 0.2), y: track(0.3), scale: track(1.4), rotation: track(0) }
		}
	};
}

describe('resolveOrientationKeyframeChannels', () => {
	it('replaces the spatial group in its orientation and keeps opacity shared', () => {
		const authored = animation();
		const vertical = resolveOrientationKeyframeChannels(authored, 'vertical');
		assert.equal(vertical.opacity, authored.channels?.opacity, 'opacity is the shared track');
		assert.equal(vertical.x, authored.orientationOverrides?.vertical?.x, 'by reference');
		assert.deepEqual(Object.keys(vertical).sort(), ['opacity', 'rotation', 'scale', 'x', 'y']);
		assert.equal(resolveOrientationKeyframeChannels(authored, 'horizontal'), authored.channels);
		assert.deepEqual(resolveOrientationKeyframeChannels(undefined, 'vertical'), {});
		assert.equal(isSpatialKeyframeChannel('rotation'), true);
		assert.equal(isSpatialKeyframeChannel('opacity'), false);
	});
});

describe('deleteOrientationKeyframe', () => {
	it('removes a key from the resolved track and normalizes the first ease', () => {
		const authored = animation();
		assert.equal(deleteOrientationKeyframe(authored, 'vertical', 'x', 0), true);
		assert.deepEqual(authored.orientationOverrides?.vertical?.x, [{ atMs: 100, value: 0.2 }]);
	});

	it('drops the whole orientation group when one of its tracks empties', () => {
		const authored = animation();
		deleteOrientationKeyframe(authored, 'vertical', 'y', 0);
		assert.equal(authored.orientationOverrides, undefined);
		assert.deepEqual(authored.channels?.x, track(0.1, 0), 'the shared path is untouched');
	});

	it('drops an emptied shared channel and reports a missing key', () => {
		const authored = animation();
		deleteOrientationKeyframe(authored, 'horizontal', 'opacity', 0);
		deleteOrientationKeyframe(authored, 'horizontal', 'opacity', 0);
		assert.equal(authored.channels?.opacity, undefined);
		assert.equal(deleteOrientationKeyframe(authored, 'horizontal', 'opacity', 0), false);
	});
});
