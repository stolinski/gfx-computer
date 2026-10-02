import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	resolveSurfacePageAnchor,
	calculateFilmedPageLayout,
	calculateWebsiteShowcaseLayout,
	createEnterBlurCommitDeduper,
	normalizeWebsiteCaptureUrl,
	websiteDisplayUrl,
	websiteImageState
} from './website-showcase';

describe('website showcase utilities', () => {
	it('normalizes capture and display URLs', () => {
		assert.equal(normalizeWebsiteCaptureUrl('github.com/syntaxfm'), 'https://github.com/syntaxfm');
		assert.equal(websiteDisplayUrl('https://www.github.com/syntaxfm/'), 'github.com/syntaxfm');
		assert.throws(() => normalizeWebsiteCaptureUrl('file:///tmp/site.html'), /http or https/);
		assert.throws(() => normalizeWebsiteCaptureUrl(''), /required/);
	});

	it('deduplicates the Enter to blur event pair without suppressing later blurs', () => {
		const deduper = createEnterBlurCommitDeduper();
		assert.equal(deduper.shouldCommit('enter'), true);
		assert.equal(deduper.shouldCommit('blur'), false);
		assert.equal(deduper.shouldCommit('blur'), true);
	});

	it('centers the URL plate halfway across the browser chrome top edge inside both safe layouts', () => {
		for (const [orientation, width, height] of [
			['horizontal', 3840, 2160],
			['vertical', 2160, 3840]
		] as const) {
			const layout = calculateWebsiteShowcaseLayout(orientation, width, height);
			assert.equal(
				Math.round((layout.browser.width / layout.browser.screenshotHeight) * 10) / 10,
				1.6
			);
			assert.ok(layout.browser.x >= width * 0.05);
			assert.ok(
				layout.browser.x + layout.browser.width <=
					width * (orientation === 'vertical' ? 0.91 : 0.95)
			);
			assert.ok(layout.browser.y >= height * (orientation === 'vertical' ? 0.06 : 0.05));
			assert.equal(layout.urlPlate.centerX, layout.browser.x + layout.browser.width / 2);
			assert.equal(layout.urlPlate.centerY, layout.browser.y);
			assert.equal(layout.overlapHeight, layout.urlPlate.height / 2);
			assert.equal(
				layout.urlPlate.centerY + layout.overlapHeight,
				layout.browser.y + layout.urlPlate.height / 2
			);
			assert.ok(
				layout.urlPlate.centerY - layout.urlPlate.height / 2 >=
					height * (orientation === 'vertical' ? 0.06 : 0.05)
			);
			assert.ok(
				layout.browser.y + layout.browser.height <=
					height * (orientation === 'vertical' ? 0.84 : 0.95)
			);
			assert.ok(layout.urlPlate.fontSize >= (orientation === 'vertical' ? 64 : 48));
		}
	});

	it('distinguishes missing, loading, ready, and broken image states', () => {
		assert.equal(websiteImageState(undefined, '', ''), 'missing');
		assert.equal(websiteImageState('/image.png', '', ''), 'loading');
		assert.equal(websiteImageState('/image.png', '/image.png', ''), 'ready');
		assert.equal(websiteImageState('/image.png', '', '/image.png'), 'broken');
	});
});

describe('filmed page layout (ADR-0057)', () => {
	it('keeps a frame-wider capture at native density with page beyond every edge', () => {
		const layout = calculateFilmedPageLayout(3840, 2160, 5120, 4000, { x: 0.5, y: 0.45 });
		assert.equal(layout.scale, 1);
		assert.equal(layout.width, 5120);
		assert.equal(layout.height, 4000);
		assert.equal(layout.left, 1920 - 0.5 * 5120);
		assert.equal(layout.top, 1080 - 0.45 * 4000);
		assert.ok(layout.left < 0 && layout.left + layout.width > 3840);
		assert.ok(layout.top < 0 && layout.top + layout.height > 2160);
	});

	it('covers the vertical frame at native density and centres the anchored column', () => {
		const layout = calculateFilmedPageLayout(2160, 3840, 5120, 4000, { x: 0.5, y: 0.45 });
		assert.equal(layout.scale, 1);
		assert.equal(layout.left, 1080 - 0.5 * 5120);
		// The page is only 4000 tall: centring the anchor would expose its top edge, so it clamps.
		assert.equal(layout.top, 0);
		assert.ok(layout.top + layout.height >= 3840);
	});

	it('scales a small capture up only as far as covering the frame', () => {
		const layout = calculateFilmedPageLayout(3840, 2160, 2880, 5120, { x: 0.5, y: 0.25 });
		assert.ok(Math.abs(layout.scale - 3840 / 2880) < 1e-9);
		assert.equal(layout.width, 3840);
		assert.equal(layout.left, 0);
		assert.ok(Math.abs(layout.top - (1080 - 0.25 * layout.height)) < 1e-9);
	});

	it('clamps the anchor so no frame edge sees past the page', () => {
		const top = calculateFilmedPageLayout(3840, 2160, 5120, 4000, { x: 0, y: 0 });
		assert.equal(top.left, 0);
		assert.equal(top.top, 0);
		const bottom = calculateFilmedPageLayout(3840, 2160, 5120, 4000, { x: 1, y: 1 });
		assert.equal(bottom.left, 3840 - 5120);
		assert.equal(bottom.top, 2160 - 4000);
	});

	it('refuses empty frames or captures', () => {
		assert.throws(() => calculateFilmedPageLayout(0, 2160, 2880, 5120), /positive/);
		assert.throws(() => calculateFilmedPageLayout(3840, 2160, 0, 5120), /positive/);
	});
});

describe('resolveSurfacePageAnchor', () => {
	it('takes the orientation point, else the shared point, else the page centre', () => {
		const surface = {
			pageAnchor: { x: 0.54, y: 0.5 },
			pageAnchorOrientationOverrides: { vertical: { x: 0.3, y: 0.2 } }
		};
		assert.deepEqual(resolveSurfacePageAnchor(surface, 'vertical'), { x: 0.3, y: 0.2 });
		assert.deepEqual(resolveSurfacePageAnchor(surface, 'horizontal'), { x: 0.54, y: 0.5 });
		assert.deepEqual(resolveSurfacePageAnchor({}, 'vertical'), { x: 0.5, y: 0.5 });
	});
});
