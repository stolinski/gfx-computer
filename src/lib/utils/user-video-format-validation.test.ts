import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { hasUserVideoSignature, userVideoFormatForMime } from './user-video-format-validation';

describe('user video format validation', () => {
	it('recognizes the supported MIME types and container signatures', () => {
		assert.equal(userVideoFormatForMime('video/mp4')?.extension, 'mp4');
		assert.equal(userVideoFormatForMime('video/quicktime')?.extension, 'mov');
		assert.equal(userVideoFormatForMime('video/webm; codecs=vp9')?.extension, 'webm');
		assert.equal(userVideoFormatForMime('video/avi'), null);

		const iso = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
		assert.equal(hasUserVideoSignature(iso, 'video/mp4'), true);
		assert.equal(hasUserVideoSignature(iso, 'video/quicktime'), true);
		assert.equal(
			hasUserVideoSignature(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm'),
			true
		);
		assert.equal(hasUserVideoSignature(iso, 'video/webm'), false);
		assert.equal(hasUserVideoSignature(new Uint8Array(), 'video/mp4'), false);
	});
});
