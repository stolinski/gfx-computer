import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { resolveCaptionsBandPlacement } from './captions-band-placement';

describe('resolveCaptionsBandPlacement', () => {
	it('takes the orientation default when nothing is authored', () => {
		assert.deepEqual(resolveCaptionsBandPlacement({}, 'horizontal'), { y: 0.8, scale: 1 });
		assert.deepEqual(resolveCaptionsBandPlacement({}, 'vertical'), { y: 0.75, scale: 1 });
	});

	it('applies shared values to both orientations without a snapshot', () => {
		const shared = { y: 0.9, scale: 1.2 };
		assert.deepEqual(resolveCaptionsBandPlacement(shared, 'vertical'), shared);
	});

	it('replaces the shared band with the active orientation snapshot as one unit', () => {
		const captions = {
			y: 0.9,
			scale: 1.2,
			orientationOverrides: { vertical: { y: 0.66, scale: 1 } }
		};
		assert.deepEqual(resolveCaptionsBandPlacement(captions, 'vertical'), { y: 0.66, scale: 1 });
		assert.deepEqual(resolveCaptionsBandPlacement(captions, 'horizontal'), { y: 0.9, scale: 1.2 });
	});
});
