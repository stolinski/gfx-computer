import { describe, expect, it } from 'vitest';

import type { KineticWord } from './engine-schema';
import { applyKineticWordBeatChoreography } from './kinetic-word-beat-choreography';

function word(animation?: KineticWord['animation']): KineticWord {
	return {
		type: 'kinetic-word',
		id: 'move',
		text: 'MOVE',
		hierarchy: 'display',
		ink: 'accent',
		position: { x: 0.5, y: 0.5 },
		scale: 1,
		rotation: 0,
		animation
	};
}

describe('dual-speed beat choreography', () => {
	it('arrives with geometry settling over the motion band and weight hitting on the beat', () => {
		const target = word();
		const result = applyKineticWordBeatChoreography(target, { id: 'hit', atMs: 1200 }, 'arrive');
		expect(result).toEqual({ ok: true, channels: ['reveal', 'weight', 'tracking'] });
		const channels = target.animation?.channels;
		expect(channels?.reveal).toEqual([
			{ atMs: 840, value: -1, atBeat: 'hit', offsetMs: -360 },
			{ atMs: 1200, value: 0, ease: 'sharp', atBeat: 'hit', offsetMs: 0 }
		]);
		const reveal = channels?.reveal ?? [];
		const revealSpan = reveal[reveal.length - 1].atMs - reveal[0].atMs;
		expect(revealSpan).toBeGreaterThanOrEqual(250);
		expect(revealSpan).toBeLessThanOrEqual(400);
		const weight = channels?.weight ?? [];
		expect(weight.map((frame) => [frame.offsetMs, frame.value])).toEqual([
			[-80, 0.5],
			[0, 1],
			[200, 0.5]
		]);
		expect(weight[1].ease).toBe('sharp');
		expect(
			Math.max(...weight.map((frame) => frame.offsetMs ?? 0)) - (weight[0].offsetMs ?? 0)
		).toBeLessThan(revealSpan);
	});

	it('replaces keys inside the move window and keeps the rest', () => {
		const target = word({
			channels: {
				weight: [
					{ atMs: 0, value: 0.2 },
					{ atMs: 1150, value: 0.9, ease: 'smooth' },
					{ atMs: 3000, value: 0.4, ease: 'smooth' }
				]
			}
		});
		applyKineticWordBeatChoreography(target, { id: 'hit', atMs: 1200 }, 'strike');
		expect(target.animation?.channels?.weight?.map((frame) => frame.atMs)).toEqual([
			0, 1120, 1200, 1440, 3000
		]);
		expect(target.animation?.channels?.weight?.[0].ease).toBeUndefined();
	});

	it('refuses a beat too early for the move, without changing the word', () => {
		const target = word();
		const result = applyKineticWordBeatChoreography(target, { id: 'early', atMs: 100 }, 'arrive');
		expect(result.ok).toBe(false);
		expect(target.animation).toBeUndefined();
	});
});
