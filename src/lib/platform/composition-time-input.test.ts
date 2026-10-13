import { describe, expect, it } from 'vite-plus/test';

import {
	resolveCompositionFractionTime,
	resolveCompositionFrameTime
} from './composition-time-input';

const GRID = { durationSeconds: 6, fps: 30 };

describe('composition time input', () => {
	it('keeps legacy fractions and frames unchanged', () => {
		expect(resolveCompositionFractionTime(0.25, GRID)).toBe(0.25);
		expect(resolveCompositionFrameTime(90, GRID)).toBe(90);
	});

	it('normalizes direct seconds, milliseconds, and frames to fractions', () => {
		expect(resolveCompositionFractionTime({ seconds: 1.5 }, GRID)).toBe(0.25);
		expect(resolveCompositionFractionTime({ milliseconds: 120 }, GRID)).toBeCloseTo(0.02);
		expect(resolveCompositionFractionTime({ frames: 45 }, GRID)).toBe(0.25);
	});

	it('normalizes direct time units and editor timecode to exact frames', () => {
		expect(resolveCompositionFrameTime({ seconds: 3 }, GRID)).toBe(90);
		expect(resolveCompositionFrameTime({ milliseconds: 3000 }, GRID)).toBe(90);
		expect(resolveCompositionFrameTime({ frames: 90 }, GRID)).toBe(90);
		expect(resolveCompositionFrameTime({ timecode: '00:00:03:00' }, GRID)).toBe(90);
	});
});
