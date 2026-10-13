import { describe, expect, it } from 'vite-plus/test';

import type { Captions } from '$lib/platform/engine-schema';
import { resolveCaptionReadableText } from './caption-readable-text';

const cues = [{ id: 'cue', startMs: 1000, endMs: 2000, text: 'one two' }];

describe('resolveCaptionReadableText', () => {
	it('uses the complete cue for karaoke and Pack captions', () => {
		for (const style of ['karaoke', 'pack'] as const) {
			expect(resolveCaptionReadableText({ style, cues }, 1000)).toEqual({
				id: 'caption:cue',
				text: 'one two',
				cueId: 'cue',
				wordIndex: null
			});
		}
	});

	it('uses only the exact half-open active word for word-pop', () => {
		const captions: Captions = { style: 'word-pop', cues };
		expect(resolveCaptionReadableText(captions, 1000)?.id).toBe('caption:cue:word:0');
		expect(resolveCaptionReadableText(captions, 1499)?.id).toBe('caption:cue:word:0');
		expect(resolveCaptionReadableText(captions, 1500)?.id).toBe('caption:cue:word:1');
		expect(resolveCaptionReadableText(captions, 2000)).toBeNull();
	});
});
