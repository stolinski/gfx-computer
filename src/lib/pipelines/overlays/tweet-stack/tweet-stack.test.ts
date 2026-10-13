import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { parseXPostOEmbed, parseXStatusUrl } from '$lib/utils/x-post-oembed';

import { tweetStackOverlayRenderer } from './index';
import { TweetStackContentSchema } from './tweet-stack-content';
import { resolveTweetStackFrameLayout } from './tweet-stack-frame-layout';
import { resolveTweetStackCardMotion } from './tweet-stack-motion';

const posts = [
	{
		id: '20',
		url: 'https://x.com/jack/status/20',
		displayName: 'jack',
		handle: '@jack',
		body: 'just setting up my twttr',
		dateLabel: 'March 21, 2006',
		verified: false
	},
	{
		id: '463440424141459456',
		url: 'https://x.com/Interior/status/463440424141459456',
		displayName: 'US Department of the Interior',
		handle: '@Interior',
		body: 'Sunsets over Grand Teton.',
		dateLabel: 'May 5, 2014',
		verified: true
	}
] as const;

describe('tweet-stack Overlay', () => {
	it('parses strict unique X post content and renderer defaults', () => {
		assert.ok(
			TweetStackContentSchema.safeParse({ posts, pileStart: 0.08, pileWindow: 0.52, spread: 0.72 })
				.success
		);
		assert.ok(
			tweetStackOverlayRenderer.schema.safeParse(tweetStackOverlayRenderer.defaults().content)
				.success
		);
		assert.equal(TweetStackContentSchema.safeParse({ posts: [posts[0]] }).success, false);
		assert.equal(TweetStackContentSchema.safeParse({ posts: [posts[0], posts[0]] }).success, false);
		assert.equal(
			TweetStackContentSchema.safeParse({ posts, pileStart: 0.8, pileWindow: 0.4 }).success,
			false
		);
	});

	it('lands cards sequentially and deterministically', () => {
		const input = {
			cardCount: 4,
			globalProgress: 0.22,
			durationSeconds: 6,
			pileStart: 0.08,
			pileWindow: 0.52,
			spread: 0.72
		};
		const first = resolveTweetStackCardMotion({ ...input, cardIndex: 0 });
		const last = resolveTweetStackCardMotion({ ...input, cardIndex: 3 });
		assert.deepEqual(first, resolveTweetStackCardMotion({ ...input, cardIndex: 0 }));
		assert.ok(first.opacity > last.opacity, 'earlier cards arrive before later cards');
		assert.equal(last.opacity, 0);

		const landed = resolveTweetStackCardMotion({ ...input, cardIndex: 2, globalProgress: 0.7 });
		const held = resolveTweetStackCardMotion({ ...input, cardIndex: 2, globalProgress: 0.82 });
		assert.deepEqual(landed, held, 'the landed pile has no hold drift');
		assert.equal(landed.opacity, 1);
	});

	it('caps card zooms to an absolute broadcast timing window', () => {
		const base = {
			cardIndex: 0,
			cardCount: 8,
			durationSeconds: 10,
			pileStart: 0.05,
			pileWindow: 0.75,
			spread: 1
		};
		const entering = resolveTweetStackCardMotion({ ...base, globalProgress: 0.075 });
		const landed = resolveTweetStackCardMotion({ ...base, globalProgress: 0.076 });
		const held = resolveTweetStackCardMotion({ ...base, globalProgress: 0.2 });

		assert.ok(entering.scale < landed.scale, 'card is still zooming before 260 ms');
		assert.equal(entering.x, landed.x, 'card does not fly in from the side');
		assert.equal(entering.y, landed.y, 'card does not fly in vertically');
		assert.deepEqual(landed, held, 'card finishes zooming at 260 ms');
	});

	it('keeps an eight-card landed cluster visibly spread across the frame', () => {
		const landed = Array.from({ length: 8 }, (_value, cardIndex) =>
			resolveTweetStackCardMotion({
				cardIndex,
				cardCount: 8,
				globalProgress: 0.82,
				durationSeconds: 10,
				pileStart: 0.05,
				pileWindow: 0.75,
				spread: 1
			})
		);

		assert.ok(Math.min(...landed.map((card) => card.x)) <= -0.45);
		assert.ok(Math.max(...landed.map((card) => card.x)) >= 0.45);
		assert.ok(Math.min(...landed.map((card) => card.y)) <= -0.4);
		assert.ok(Math.max(...landed.map((card) => card.y)) >= 0.4);
	});

	it('exits in reverse pile order', () => {
		const common = {
			cardCount: 4,
			globalProgress: 0.91,
			durationSeconds: 6,
			pileStart: 0.08,
			pileWindow: 0.52,
			exitStart: 0.88,
			exitDuration: 0.08,
			spread: 0.72
		};
		const bottom = resolveTweetStackCardMotion({ ...common, cardIndex: 0 });
		const top = resolveTweetStackCardMotion({ ...common, cardIndex: 3 });
		assert.ok(top.opacity < bottom.opacity, 'top card leaves before the bottom card');
	});

	it('reflows landed cards into a Y-dominant vertical cluster', () => {
		const common = {
			cardIndex: 7,
			cardCount: 8,
			durationSeconds: 10,
			globalProgress: 0.89,
			pileStart: 0.05,
			pileWindow: 0.75,
			spread: 1
		};
		const horizontal = resolveTweetStackCardMotion({ ...common, orientation: 'horizontal' });
		const vertical = resolveTweetStackCardMotion({ ...common, orientation: 'vertical' });

		assert.ok(Math.abs(vertical.y) > Math.abs(vertical.x));
		assert.ok(Math.abs(horizontal.x) >= Math.abs(horizontal.y) * 0.9);
	});

	it('fits horizontal and vertical frame regions', () => {
		const horizontal = resolveTweetStackFrameLayout('horizontal', 3840, 2160);
		const vertical = resolveTweetStackFrameLayout('vertical', 2160, 3840);
		assert.ok(horizontal.stackWidth <= 3840 * 0.8);
		assert.ok(horizontal.stackHeight <= 2160 * 0.8);
		assert.ok(vertical.stackWidth <= 2160 * 0.96);
		assert.ok(vertical.stackHeight <= 3840 * 0.7);
		assert.ok(
			vertical.cardWidth > horizontal.cardWidth,
			'vertical cards reflow larger for readable type'
		);
	});
});

describe('X post oEmbed authoring import', () => {
	it('normalizes supported share URLs and rejects other hosts', () => {
		assert.deepEqual(parseXStatusUrl('https://twitter.com/jack/status/20?s=20'), {
			handle: 'jack',
			statusId: '20',
			url: 'https://x.com/jack/status/20'
		});
		assert.throws(() => parseXStatusUrl('https://example.com/jack/status/20'), TypeError);
	});

	it('extracts baked static post content from oEmbed HTML', () => {
		const imported = parseXPostOEmbed(
			{
				author_name: 'jack',
				author_url: 'https://x.com/jack',
				html: '<blockquote><p lang="en">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>'
			},
			'https://x.com/jack/status/20'
		);
		assert.deepEqual(imported, {
			id: '20',
			url: 'https://x.com/jack/status/20',
			displayName: 'jack',
			handle: '@jack',
			body: 'just setting up my twttr',
			dateLabel: 'March 21, 2006'
		});
	});
});
