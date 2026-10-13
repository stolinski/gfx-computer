import { describe, expect, it } from 'vite-plus/test';

import { createDefaultEngineState } from './engine-schema';
import { deriveDeterministicReadingPlan } from './deterministic-reading-plan';

describe('deriveDeterministicReadingPlan', () => {
	it('groups stacked marks on one segment and resolves cascade timing', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 10;
		state.surface.content.body = [
			{
				type: 'paragraph',
				segments: [{ text: 'three marked words', markStyles: ['highlight', 'underline'] }]
			}
		];
		state.marks.timings = [
			{ start: 0.2, duration: 0.1, ease: 'smooth' },
			{
				start: 0,
				duration: 0.05,
				ease: 'smooth',
				cascade: { anchor: { mark: 0 }, event: 'end', offsetMs: 100 }
			}
		];
		state.surface.exit = { start: 0.8, duration: 0.1, ease: 'smooth' };
		const plan = deriveDeterministicReadingPlan(state);
		expect(plan.status).toBe('available');
		if (plan.status === 'available') {
			const postMark = plan.windows.filter((entry) => entry.kind === 'post-mark');
			expect(postMark).toHaveLength(1);
			expect(postMark[0]).toMatchObject({
				readingId: 'post-mark:0:18:body',
				kind: 'post-mark',
				wordCount: 3,
				endMilliseconds: 8000,
				requiredMilliseconds: 1350
			});
			expect(postMark[0].startMilliseconds).toBeCloseTo(3600);
		}
	});

	it('uses complete message mark authority and renderer fallback timing', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 10;
		state.surface.type = 'imessage';
		state.surface.content.body = [];
		state.surface.content.messages = [
			{
				from: 'them',
				text: [
					{
						type: 'paragraph',
						segments: [{ text: 'message fallback mark', markStyles: ['highlight'] }]
					}
				]
			}
		];
		state.marks.timings = [];
		const plan = deriveDeterministicReadingPlan(state);
		expect(plan.status).toBe('available');
		if (plan.status === 'available') {
			const postMark = plan.windows.find((entry) => entry.kind === 'post-mark');
			expect(postMark).toMatchObject({
				readingId: 'post-mark:0:21:body',
				kind: 'post-mark',
				wordCount: 3,
				endMilliseconds: 8600,
				requiredMilliseconds: 1350
			});
			expect(postMark?.startMilliseconds).toBeCloseTo(5800);
		}
	});

	it('derives overlay hierarchy and every caption cue from authored content', () => {
		const state = createDefaultEngineState();
		state.transport.durationSeconds = 5;
		state.surface.content.body = [];
		state.marks.timings = [];
		state.overlays = [
			{
				id: 'lower',
				type: 'lower-third',
				content: { variant: 'standard', kicker: 'LIVE', title: 'Ada Lovelace' },
				position: { anchor: 'bottom-left' },
				enter: { start: 0.1, duration: 0.1, ease: 'smooth' },
				exit: { start: 0.8, duration: 0.1, ease: 'smooth' }
			}
		];
		state.captions = {
			style: 'word-pop',
			cues: [
				{ id: 'a', text: 'first cue', startMs: 1000, endMs: 2200 },
				{ id: 'b', text: 'second cue', startMs: 2200, endMs: 3600 }
			]
		};
		const plan = deriveDeterministicReadingPlan(state);
		expect(plan.status).toBe('available');
		if (plan.status === 'available') {
			expect(plan.windows.map((entry) => entry.readingId)).toEqual([
				'overlay:lower',
				'speech-caption:a',
				'speech-caption:b'
			]);
			expect(plan.windows[0]).toMatchObject({
				wordCount: 3,
				startMilliseconds: 1000,
				endMilliseconds: 4000,
				requiredMilliseconds: 1800
			});
		}
	});
});
