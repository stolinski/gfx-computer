import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { evaluateKeyframeTrackAtMs } from './keyframe-track-evaluation';

describe('evaluateKeyframeTrackAtMs', () => {
	it('holds endpoints and deterministically interpolates the active eased segment', () => {
		const track = [
			{ atMs: 100, value: 0 },
			{ atMs: 300, value: 1, ease: 'sharp' as const },
			{ atMs: 700, value: 0.25, ease: 'settled' as const }
		];
		assert.equal(evaluateKeyframeTrackAtMs(track, 0, 0.5), 0);
		assert.equal(evaluateKeyframeTrackAtMs(track, 100, 0.5), 0);
		assert.equal(evaluateKeyframeTrackAtMs(track, 700, 0.5), 0.25);
		assert.equal(evaluateKeyframeTrackAtMs(track, 900, 0.5), 0.25);
		const firstReplay = evaluateKeyframeTrackAtMs(track, 220, 0.5);
		const secondReplay = evaluateKeyframeTrackAtMs(track, 220, 0.5);
		assert.equal(firstReplay, secondReplay);
		assert.ok(firstReplay > 0 && firstReplay < 1);
	});

	it('uses the caller fallback for an absent track', () => {
		assert.equal(evaluateKeyframeTrackAtMs(undefined, 400, 1.25), 1.25);
	});
});
