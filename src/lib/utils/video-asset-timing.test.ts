import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { videoAssetPresentationTimestampAt } from './video-asset-timing';

describe('Video asset timing', () => {
	it('maps media-relative offsets onto absolute presentation timestamps', () => {
		assert.equal(
			videoAssetPresentationTimestampAt({
				firstTimestamp: 10.25,
				sourceTimeSeconds: 3.5 + (299 * 1001) / 30000
			}),
			10.25 + 3.5 + (299 * 1001) / 30000
		);
	});

	it('rejects invalid media-relative Source time', () => {
		assert.throws(
			() =>
				videoAssetPresentationTimestampAt({
					firstTimestamp: 10.25,
					sourceTimeSeconds: -0.01
				}),
			/Source time must be nonnegative/
		);
		assert.throws(
			() =>
				videoAssetPresentationTimestampAt({
					firstTimestamp: Number.NaN,
					sourceTimeSeconds: 0
				}),
			/inputs must be finite numbers/
		);
	});
});
