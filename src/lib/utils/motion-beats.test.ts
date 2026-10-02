import { describe, expect, it } from 'vitest';

import type { EngineState, KineticWord, MotionBeat } from '$lib/platform/engine-schema';
import { STANDARD_TRANSPORT_RATES, resolveFrameRate } from './composition-timing';
import {
	findMotionBeatSnap,
	listMotionBeatReferences,
	motionBeatAtMsForFrame,
	motionBeatFrame,
	moveMotionBeat,
	releaseMotionBeatReferences
} from './motion-beats';

function word(id: string, animation: KineticWord['animation']): KineticWord {
	return {
		type: 'kinetic-word',
		id,
		text: id.toUpperCase(),
		hierarchy: 'display',
		ink: 'ink',
		position: { x: 0.5, y: 0.5 },
		scale: 1,
		rotation: 0,
		animation
	};
}

function state(
	beats: MotionBeat[],
	words: KineticWord[]
): Pick<EngineState, 'surface' | 'motionBeats'> {
	return {
		motionBeats: beats,
		surface: {
			type: 'plain',
			content: {},
			typeField: {
				words,
				phrases: [{ id: 'one', wordIds: [words[0].id], focalWordId: words[0].id, beatId: 'hit' }]
			}
		} as EngineState['surface']
	};
}

describe('Motion Beat time', () => {
	it('lands a beat placed at a frame on that same frame at every standard rate', () => {
		for (const fps of STANDARD_TRANSPORT_RATES) {
			const rate = resolveFrameRate(fps);
			for (let frame = 0; frame <= Math.ceil(fps * 12); frame += 1) {
				expect(motionBeatFrame(motionBeatAtMsForFrame(frame, rate), rate)).toBe(frame);
			}
		}
	});

	it('places NTSC beats on whole milliseconds at or before the frame time', () => {
		const rate = resolveFrameRate(29.97);
		expect(motionBeatAtMsForFrame(30, rate)).toBe(1001);
		expect(motionBeatAtMsForFrame(1, rate)).toBe(33);
		expect(motionBeatFrame(1001, rate)).toBe(30);
		expect(motionBeatFrame(1000, rate)).toBe(30);
		expect(motionBeatAtMsForFrame(30, resolveFrameRate(30))).toBe(1000);
	});

	it('snaps to the nearest beat inside the threshold only', () => {
		const beats: MotionBeat[] = [
			{ id: 'a', atMs: 1000 },
			{ id: 'b', atMs: 1100 }
		];
		expect(findMotionBeatSnap(1040, beats, 50)?.id).toBe('a');
		expect(findMotionBeatSnap(1060, beats, 50)?.id).toBe('b');
		expect(findMotionBeatSnap(1500, beats, 50)).toBeNull();
	});
});

describe('Motion Beat references and moves', () => {
	it('moves a beat and every key bound to it, keeping the beats in time order', () => {
		const target = state(
			[
				{ id: 'hit', atMs: 1000 },
				{ id: 'later', atMs: 3000 }
			],
			[
				word('type', {
					channels: {
						weight: [
							{ atMs: 0, value: 0.5 },
							{ atMs: 900, value: 0.5, atBeat: 'hit', offsetMs: -100 },
							{ atMs: 1000, value: 1, ease: 'sharp', atBeat: 'hit', offsetMs: 0 },
							{ atMs: 5000, value: 0.5 }
						]
					}
				})
			]
		);
		expect(moveMotionBeat(target, 'hit', 4000)).toEqual({ ok: true });
		expect(target.motionBeats?.map((beat) => beat.id)).toEqual(['later', 'hit']);
		expect(
			target.surface.typeField?.words[0].animation?.channels?.weight?.map((frame) => frame.atMs)
		).toEqual([0, 3900, 4000, 5000]);
	});

	it('refuses a move that would cross a neighbouring key, without changing anything', () => {
		const target = state(
			[{ id: 'hit', atMs: 1000 }],
			[
				word('type', {
					channels: {
						weight: [
							{ atMs: 1000, value: 1, atBeat: 'hit', offsetMs: 0 },
							{ atMs: 1200, value: 0.5 }
						]
					}
				})
			]
		);
		const result = moveMotionBeat(target, 'hit', 1300);
		expect(result.ok).toBe(false);
		expect(target.motionBeats?.[0].atMs).toBe(1000);
		expect(target.surface.typeField?.words[0].animation?.channels?.weight?.[0].atMs).toBe(1000);
	});

	it('lists and releases references, keeping released keys at their times', () => {
		const target = state(
			[{ id: 'hit', atMs: 1000 }],
			[
				word('type', {
					channels: { reveal: [{ atMs: 1000, value: 0, atBeat: 'hit', offsetMs: 0 }] }
				})
			]
		);
		expect(listMotionBeatReferences(target, 'hit')).toEqual({
			phraseIds: ['one'],
			keyframes: [{ wordId: 'type', track: 'channels.reveal', index: 0 }]
		});
		releaseMotionBeatReferences(target, 'hit');
		expect(listMotionBeatReferences(target, 'hit')).toEqual({ phraseIds: [], keyframes: [] });
		expect(target.surface.typeField?.words[0].animation?.channels?.reveal?.[0]).toEqual({
			atMs: 1000,
			value: 0
		});
	});
});
