import { describe, expect, it } from 'vite-plus/test';

import {
	MIN_POSTER_CONTENT_FRACTION,
	POSTER_FRAME_CANDIDATE_FRACTIONS,
	choosePosterFrame,
	isPosterFrameUsable,
	posterCandidateTimestamps
} from './poster-frame-choice';

describe('posterCandidateTimestamps', () => {
	it('samples the run at the candidate fractions, midpoint first', () => {
		expect(posterCandidateTimestamps(10)).toEqual(
			POSTER_FRAME_CANDIDATE_FRACTIONS.map((fraction) => fraction * 10)
		);
		expect(posterCandidateTimestamps(10)[0]).toBe(5);
	});

	it('uses only the authored poster time when one is set, clamped to the run', () => {
		expect(posterCandidateTimestamps(10, 2.5)).toEqual([2.5]);
		expect(posterCandidateTimestamps(10, 40)).toEqual([10]);
	});

	it('refuses a duration or authored time it cannot photograph', () => {
		expect(() => posterCandidateTimestamps(0)).toThrow(TypeError);
		expect(() => posterCandidateTimestamps(10, -1)).toThrow(TypeError);
	});
});

describe('isPosterFrameUsable', () => {
	it('refuses a blank frame and one under the content floor', () => {
		expect(isPosterFrameUsable({ contentFraction: 0, isBlank: true })).toBe(false);
		expect(
			isPosterFrameUsable({ contentFraction: MIN_POSTER_CONTENT_FRACTION / 2, isBlank: false })
		).toBe(false);
		expect(
			isPosterFrameUsable({ contentFraction: MIN_POSTER_CONTENT_FRACTION, isBlank: false })
		).toBe(true);
	});
});

describe('choosePosterFrame', () => {
	it('keeps the preferred candidate when the others show about the same', () => {
		const chosen = choosePosterFrame([
			{ timestampSeconds: 5, contentFraction: 0.2, isBlank: false },
			{ timestampSeconds: 4, contentFraction: 0.22, isBlank: false },
			{ timestampSeconds: 6, contentFraction: 0.21, isBlank: false }
		]);
		expect(chosen?.timestampSeconds).toBe(5);
	});

	it('moves to a candidate that shows materially more', () => {
		const chosen = choosePosterFrame([
			{ timestampSeconds: 5, contentFraction: 0.02, isBlank: false },
			{ timestampSeconds: 4, contentFraction: 0.03, isBlank: false },
			{ timestampSeconds: 6, contentFraction: 0.3, isBlank: false }
		]);
		expect(chosen?.timestampSeconds).toBe(6);
	});

	it('skips blank and near-empty candidates', () => {
		const chosen = choosePosterFrame([
			{ timestampSeconds: 5, contentFraction: 0, isBlank: true },
			{ timestampSeconds: 4, contentFraction: 0.0001, isBlank: false },
			{ timestampSeconds: 6, contentFraction: 0.05, isBlank: false }
		]);
		expect(chosen?.timestampSeconds).toBe(6);
	});

	it('returns null when no candidate shows anything', () => {
		expect(
			choosePosterFrame([
				{ timestampSeconds: 5, contentFraction: 0, isBlank: true },
				{ timestampSeconds: 4, contentFraction: 0, isBlank: true }
			])
		).toBeNull();
		expect(choosePosterFrame([])).toBeNull();
	});
});
