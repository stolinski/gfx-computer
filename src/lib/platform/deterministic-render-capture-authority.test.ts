import { describe, expect, it, vi } from 'vite-plus/test';

import { deterministicFrameAddressFor } from '$lib/utils/deterministic-render-measurements';

import { seekDeterministicTimelineFrame } from './deterministic-render-capture-authority';
import { Timeline } from './timeline.svelte';

describe('deterministic runtime capture authority', () => {
	it('seeks the real Timeline to the exact rational frame before settling capture', async () => {
		// The order is the contract: a paint requested before the seek rasterizes the
		// previous frame in the `dom-rasterization` lane, which reads the DOM as soon
		// as the request lands rather than on the browser's paint tick.
		const order: string[] = [];
		const timeline = new Timeline({
			durationSeconds: 10.01,
			fps: 29.97,
			tick: (time) => order.push(`seek:${time}`)
		});
		const settleNextPaint = vi.fn(async () => {
			order.push('settle');
		});
		const flushDom = vi.fn(async () => {
			order.push('flush');
		});
		const frameRate = { num: 30_000, den: 1_001 };
		const address = deterministicFrameAddressFor(299, frameRate);

		const actual = await seekDeterministicTimelineFrame(
			{ address, frameRate },
			{
				timeline,
				fps: 29.97,
				settleNextPaint,
				flushDom
			}
		);

		expect(actual).toEqual({ address, activeFrameRate: frameRate });
		expect(timeline.time).toBe((299 * 1_001) / 30_000);
		expect(order).toEqual([`seek:${(299 * 1_001) / 30_000}`, 'flush', 'settle', 'flush']);
		expect(settleNextPaint).toHaveBeenCalledOnce();
	});

	it('rejects a caller timestamp that is not derived from the active rate', async () => {
		const timeline = new Timeline({ durationSeconds: 2, fps: 30, tick: () => undefined });
		await expect(
			seekDeterministicTimelineFrame(
				{
					address: { frameIndex: 1, timestampMicroseconds: 1 },
					frameRate: { num: 30, den: 1 }
				},
				{
					timeline,
					fps: 30,
					settleNextPaint: async () => undefined,
					flushDom: async () => undefined
				}
			)
		).rejects.toThrow(RangeError);
		expect(timeline.time).toBe(0);
	});

	it('rejects a mismatched rational rate even at frame zero', async () => {
		const timeline = new Timeline({ durationSeconds: 2, fps: 30, tick: () => undefined });
		await expect(
			seekDeterministicTimelineFrame(
				{
					address: { frameIndex: 0, timestampMicroseconds: 0 },
					frameRate: { num: 60, den: 1 }
				},
				{
					timeline,
					fps: 30,
					settleNextPaint: async () => undefined,
					flushDom: async () => undefined
				}
			)
		).rejects.toThrow('active composition frame rate');
		expect(timeline.time).toBe(0);
	});
});
