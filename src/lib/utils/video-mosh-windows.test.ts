import { describe, expect, it } from 'vitest';

import type { Media, VideoClip, VideoMoshWindow } from '$lib/platform/engine-schema';

import { resolveFrameRate } from './composition-timing';
import {
	createVideoMoshWindowDefaults,
	describeVideoMoshWindowFindings,
	listVideoMoshWindows,
	resolveActiveVideoMoshAtFrame,
	resolveVideoMoshWindowMaxFrames,
	videoTrackCoversFrameRange
} from './video-mosh-windows';

function clip(id: string, timelineStartFrame: number, durationFrames: number): VideoClip {
	return {
		id,
		assetId: 'asset',
		timelineStartFrame,
		durationFrames,
		sourceStartSeconds: 0,
		audio: { enabled: true, gain: 1 }
	};
}

function mosh(id: string, startFrame: number, durationFrames: number): VideoMoshWindow {
	return { id, startFrame, durationFrames, ...createVideoMoshWindowDefaults(durationFrames) };
}

function media(clips: VideoClip[], moshes?: VideoMoshWindow[]): Media {
	return {
		assets: [
			{
				id: 'asset',
				kind: 'video',
				name: 'Clip',
				assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
			}
		],
		videoTrack: moshes ? { clips, moshes } : { clips }
	};
}

describe('Mosh window geometry', () => {
	it('caps windows at three whole seconds of the transport rate', () => {
		expect(resolveVideoMoshWindowMaxFrames(resolveFrameRate(30))).toBe(90);
		expect(resolveVideoMoshWindowMaxFrames(resolveFrameRate(60))).toBe(180);
		// 29.97 fps: 89.91 frames fit, so the cap stays inside 3 seconds.
		expect(resolveVideoMoshWindowMaxFrames(resolveFrameRate(29.97))).toBe(89);
	});

	it('defaults a new window to a drag that heals over its last quarter', () => {
		expect(createVideoMoshWindowDefaults(40)).toEqual({
			motion: 'follow',
			blockSize: 16,
			bleed: 0.08,
			corruption: 0.15,
			seed: 0,
			healFrames: 10
		});
		expect(createVideoMoshWindowDefaults(1).healFrames).toBe(1);
	});

	it('treats an absent list as no windows', () => {
		expect(listVideoMoshWindows(media([clip('a', 0, 10)]))).toEqual([]);
	});

	it('resolves the owning window with half-open bounds', () => {
		const track = media([clip('a', 0, 100)], [mosh('one', 10, 5), mosh('two', 40, 3)]);
		expect(resolveActiveVideoMoshAtFrame(track, 9)).toBeNull();
		expect(resolveActiveVideoMoshAtFrame(track, 10)).toMatchObject({ localFrame: 0 });
		expect(resolveActiveVideoMoshAtFrame(track, 14)?.window.id).toBe('one');
		expect(resolveActiveVideoMoshAtFrame(track, 15)).toBeNull();
		expect(resolveActiveVideoMoshAtFrame(track, 42)).toMatchObject({ localFrame: 2 });
	});

	it('measures footage coverage across cuts and gaps', () => {
		const clips = [clip('a', 0, 10), clip('b', 10, 10), clip('c', 25, 5)];
		expect(videoTrackCoversFrameRange(clips, 5, 20)).toBe(true);
		expect(videoTrackCoversFrameRange(clips, 18, 22)).toBe(false);
		expect(videoTrackCoversFrameRange(clips, 25, 30)).toBe(true);
		expect(videoTrackCoversFrameRange(clips, 25, 31)).toBe(false);
	});

	it('finds no fault in a valid window over a cut', () => {
		const track = media([clip('a', 0, 50), clip('b', 50, 50)], [mosh('cut', 50, 30)]);
		expect(describeVideoMoshWindowFindings(track, 100, resolveFrameRate(30))).toEqual([]);
	});

	it('needs footage at the held frame', () => {
		const track = media([clip('b', 50, 50)], [mosh('cut', 50, 30)]);
		expect(describeVideoMoshWindowFindings(track, 100, resolveFrameRate(30))).toEqual([
			expect.objectContaining({ index: 0, field: 'startFrame' })
		]);
	});
});
