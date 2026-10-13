import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { cuesToSrt, cueWordWindows, parseSrt } from './srt.ts';

describe('SRT utilities', () => {
	it('parses, serializes, and validates subtitle cues', () => {
		// Standard SRT with sequence numbers, CRLF, and a multi-line cue.
		const sample = [
			'1',
			'00:00:00,400 --> 00:00:01,900',
			"Here's the thing",
			'',
			'2',
			'00:00:02,000 --> 00:00:03,400',
			'about shipping',
			'fast',
			''
		].join('\r\n');

		const cues = parseSrt(sample);
		assert.equal(cues.length, 2);
		assert.deepEqual(cues[0], { id: 'cue-1', startMs: 400, endMs: 1900, text: "Here's the thing" });
		assert.equal(cues[1].text, 'about shipping fast');
		assert.equal(cues[1].startMs, 2000);

		// VTT-style dot separators + no sequence numbers parse too.
		const dotted = parseSrt('00:00:01.250 --> 00:00:02.500\nhello world');
		assert.equal(dotted[0].startMs, 1250);
		assert.equal(dotted[0].endMs, 2500);

		// Round-trip: cues → SRT → cues is stable.
		const rebuilt = parseSrt(cuesToSrt(cues));
		assert.deepEqual(rebuilt, cues);

		// Word windows: proportional by length, contiguous, exact at the ends.
		const windows = cueWordWindows({ id: 'w', startMs: 1000, endMs: 2000, text: 'go be great' });
		assert.equal(windows.length, 3);
		assert.equal(windows[0].startMs, 1000);
		assert.equal(windows[2].endMs, 2000);
		assert.equal(windows[0].endMs, windows[1].startMs);
		assert.ok(windows[2].endMs - windows[2].startMs > windows[0].endMs - windows[0].startMs);

		// Malformed input fails fast.
		assert.throws(() => parseSrt('not a subtitle'));
		assert.throws(() => parseSrt('00:00:02,000 --> 00:00:01,000\nbackwards'));
	});
});
