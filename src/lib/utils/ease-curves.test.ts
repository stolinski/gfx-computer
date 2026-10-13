import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { evaluateNamedEase, NAMED_EASE_CURVES } from './ease-curves.ts';

describe('evaluateNamedEase', () => {
	it('starts at 0 and lands at 1 for every named curve', () => {
		for (const ease of NAMED_EASE_CURVES) {
			assert.equal(evaluateNamedEase(ease, 0), 0, ease);
			assert.equal(evaluateNamedEase(ease, 1), 1, ease);
			assert.equal(evaluateNamedEase(ease, -0.5), 0, `${ease} clamps below 0`);
			assert.equal(evaluateNamedEase(ease, 1.5), 1, `${ease} clamps above 1`);
		}
	});

	it('decelerates: smooth and sharp pass the midpoint early and never overshoot', () => {
		for (const ease of ['smooth', 'sharp'] as const) {
			let previous = 0;
			for (let step = 1; step <= 20; step += 1) {
				const value = evaluateNamedEase(ease, step / 20);
				assert.ok(value >= previous, `${ease} is monotone`);
				assert.ok(value <= 1, `${ease} never overshoots`);
				previous = value;
			}
			assert.ok(evaluateNamedEase(ease, 0.5) > 0.8, `${ease} is front-loaded`);
		}
	});

	it('settled and bouncy overshoot past 1 before landing, like their tweens', () => {
		let settledPeak = 0;
		let bouncyPeak = 0;
		for (let step = 1; step < 100; step += 1) {
			settledPeak = Math.max(settledPeak, evaluateNamedEase('settled', step / 100));
			bouncyPeak = Math.max(bouncyPeak, evaluateNamedEase('bouncy', step / 100));
		}
		assert.ok(settledPeak > 1 && settledPeak < 1.1);
		assert.ok(bouncyPeak > 1 && bouncyPeak < 1.5);
	});
});
