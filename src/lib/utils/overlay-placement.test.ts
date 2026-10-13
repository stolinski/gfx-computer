import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import type { OverlayPosition } from '$lib/platform/engine-schema';

import {
	cloneOverlayPlacement,
	resolveOverlayPlacement,
	resolveOverlayPlacementCenter
} from './overlay-placement';

describe('resolveOverlayPlacement', () => {
	const position: OverlayPosition = {
		anchor: 'bottom-left',
		offset: { x: 0.06, y: 0.08 },
		scale: 1,
		orientationOverrides: {
			vertical: {
				anchor: 'bottom-center',
				offset: { x: 0, y: 0.2 },
				scale: 0.9,
				rotation: 2
			}
		}
	};

	it('uses shared placement when the target has no override', () => {
		assert.equal(resolveOverlayPlacement(position, 'horizontal'), position);
	});

	it('uses the complete target-specific snapshot when present', () => {
		assert.deepEqual(resolveOverlayPlacement(position, 'vertical'), {
			anchor: 'bottom-center',
			offset: { x: 0, y: 0.2 },
			scale: 0.9,
			rotation: 2
		});
	});

	it('clones placement geometry without carrying nested overrides', () => {
		const clone = cloneOverlayPlacement(position);

		assert.deepEqual(clone, {
			anchor: 'bottom-left',
			offset: { x: 0.06, y: 0.08 },
			scale: 1,
			rotation: undefined,
			rect: undefined
		});
		assert.notEqual(clone.offset, position.offset);
		assert.equal('orientationOverrides' in clone, false);
	});
});

describe('resolveOverlayPlacementCenter', () => {
	const extents = { width: 0.3, height: 0.1 };

	it('insets an edge anchor by the offset and the element\'s own half extents', () => {
		assert.deepEqual(
			resolveOverlayPlacementCenter({ anchor: 'top-left', offset: { x: 0.05, y: 0.08 } }, extents),
			{ x: 0.2, y: 0.13 }
		);
		const bottomRight = resolveOverlayPlacementCenter(
			{ anchor: 'bottom-right', offset: { x: 0.05, y: 0.08 } },
			extents
		);
		assert.ok(Math.abs(bottomRight.x - 0.8) < 1e-12);
		assert.ok(Math.abs(bottomRight.y - 0.87) < 1e-12);
	});

	it('centres a centre anchor and ignores its offset, as the mount does', () => {
		assert.deepEqual(
			resolveOverlayPlacementCenter({ anchor: 'center', offset: { x: 0.2, y: 0.2 } }, extents),
			{ x: 0.5, y: 0.5 }
		);
		assert.deepEqual(
			resolveOverlayPlacementCenter({ anchor: 'bottom-center', offset: { x: 0, y: 0.1 } }, extents),
			{ x: 0.5, y: 0.85 }
		);
	});

	it('shifts every anchor by a motion delta, right and down positive', () => {
		const delta = { x: 0.1, y: -0.05 };
		assert.deepEqual(
			resolveOverlayPlacementCenter({ anchor: 'center' }, extents, delta),
			{ x: 0.6, y: 0.45 }
		);
		const anchored = resolveOverlayPlacementCenter(
			{ anchor: 'bottom-right', offset: { x: 0.05, y: 0.08 } },
			extents,
			delta
		);
		assert.ok(Math.abs(anchored.x - 0.9) < 1e-12);
		assert.ok(Math.abs(anchored.y - 0.82) < 1e-12);
	});

	it('uses the middle of a normalized rect', () => {
		const centre = resolveOverlayPlacementCenter(
			{ anchor: 'normalized-rect', rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.2 } },
			extents
		);
		assert.ok(Math.abs(centre.x - 0.3) < 1e-12);
		assert.ok(Math.abs(centre.y - 0.3) < 1e-12);
	});
});
