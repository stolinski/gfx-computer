import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { getCaptureAsset, isCaptureAsset, listCaptureAssets } from './capture-assets';

describe('bundled capture registry', () => {
	it('lists the Syntax channel capture with its native size and provenance', () => {
		assert.ok(listCaptureAssets().includes('syntax-youtube-videos'));
		assert.equal(isCaptureAsset('syntax-youtube-videos'), true);
		assert.equal(isCaptureAsset('missing'), false);
		const asset = getCaptureAsset('syntax-youtube-videos');
		assert.ok(asset);
		assert.deepEqual(
			{ width: asset.width, height: asset.height, sourceUrl: asset.sourceUrl },
			{ width: 5120, height: 4000, sourceUrl: 'https://www.youtube.com/@syntaxfm/videos' }
		);
		assert.ok(asset.url.endsWith('.png'));
		assert.equal(getCaptureAsset('missing'), null);
	});
});
