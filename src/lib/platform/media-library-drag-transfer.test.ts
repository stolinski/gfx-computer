import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	createMediaLibraryAssetDragPayload,
	MEDIA_LIBRARY_ASSET_MIME,
	parseMediaLibraryAssetDragTransfer,
	type MediaLibraryDragDataTransfer,
	writeMediaLibraryAssetDragTransfer
} from './media-library-drag-transfer';

class TestDataTransfer implements MediaLibraryDragDataTransfer {
	effectAllowed = 'none';
	readonly data = new Map<string, string>();

	setData(format: string, value: string): void {
		this.data.set(format, value);
	}

	getData(format: string): string {
		return this.data.get(format) ?? '';
	}
}

describe('Media library drag transfer', () => {
	it('creates and writes a versioned identity-only payload as a copy', () => {
		assert.deepEqual(createMediaLibraryAssetDragPayload('video-4'), {
			version: 1,
			type: 'media-library-asset',
			assetId: 'video-4'
		});
		const transfer = new TestDataTransfer();

		writeMediaLibraryAssetDragTransfer(transfer, 'video-4');

		assert.equal(transfer.effectAllowed, 'copy');
		assert.deepEqual(JSON.parse(transfer.getData(MEDIA_LIBRARY_ASSET_MIME)), {
			version: 1,
			type: 'media-library-asset',
			assetId: 'video-4'
		});
		assert.deepEqual(parseMediaLibraryAssetDragTransfer(transfer), {
			version: 1,
			type: 'media-library-asset',
			assetId: 'video-4'
		});
	});

	it('rejects malformed, unsupported, empty, and over-specified payloads', () => {
		const transfer = new TestDataTransfer();
		for (const value of [
			'{',
			JSON.stringify({ version: 2, type: 'media-library-asset', assetId: 'video-1' }),
			JSON.stringify({ version: 1, type: 'other', assetId: 'video-1' }),
			JSON.stringify({ version: 1, type: 'media-library-asset', assetId: '  ' }),
			JSON.stringify({
				version: 1,
				type: 'media-library-asset',
				assetId: 'video-1',
				assetUrl: '/not-transferable'
			})
		]) {
			transfer.setData(MEDIA_LIBRARY_ASSET_MIME, value);
			assert.equal(parseMediaLibraryAssetDragTransfer(transfer), null);
		}
	});
});
