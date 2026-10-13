import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	hasUserImageSignature,
	userImageFormatForMime
} from './user-image-format-validation.ts';

describe('user image format validation', () => {
	it('recognizes supported MIME types and file signatures', () => {
		assert.equal(userImageFormatForMime('image/png')?.extension, 'png');
		assert.equal(userImageFormatForMime('image/jpeg')?.extension, 'jpg');
		assert.equal(userImageFormatForMime('image/webp')?.extension, 'webp');
		assert.equal(userImageFormatForMime('image/gif'), null);

		assert.equal(
			hasUserImageSignature(
				new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				'image/png'
			),
			true
		);
		assert.equal(hasUserImageSignature(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg'), true);
		assert.equal(
			hasUserImageSignature(
				new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
				'image/webp'
			),
			true
		);

		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		assert.equal(hasUserImageSignature(png, 'image/jpeg'), false);
		assert.equal(hasUserImageSignature(new Uint8Array(), 'image/webp'), false);
	});
});
