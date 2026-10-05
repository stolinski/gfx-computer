/**
 * Mosh window geometry on the Video track (ADR-0065): the frame cap, which
 * window owns a frame, and what makes a window invalid. Pure — shared by
 * semantic validation, the `media` operations, and the runtime.
 */
import type { Media, VideoClip, VideoMoshWindow } from '$lib/platform/engine-schema';

import type { FrameRate } from './composition-timing.ts';

/** The longest a Mosh window may run, in seconds of transport time (ADR-0065 §6). */
export const VIDEO_MOSH_WINDOW_MAX_SECONDS = 3;

/** A window's params without its placement, as the operations default them. */
export type VideoMoshWindowParams = Omit<VideoMoshWindow, 'id' | 'startFrame' | 'durationFrames'>;

/** One finding against one window, with the field an author fixes. */
export interface VideoMoshWindowFinding {
	index: number;
	field: keyof VideoMoshWindow;
	message: string;
}

/** The active window at a frame and how far into it the frame sits. */
export interface ResolvedActiveVideoMosh {
	window: VideoMoshWindow;
	/** 0 on `startFrame`, `durationFrames − 1` on the last moshed frame. */
	localFrame: number;
}

/** The Mosh windows of a Video track, empty when none are declared. */
export function listVideoMoshWindows(media: Media): readonly VideoMoshWindow[] {
	return media.videoTrack.moshes ?? [];
}

/** The longest window, in whole frames, that stays within the 3-second cap at `rate`. */
export function resolveVideoMoshWindowMaxFrames(rate: FrameRate): number {
	return Math.max(1, Math.floor((VIDEO_MOSH_WINDOW_MAX_SECONDS * rate.num) / rate.den));
}

/**
 * The params a new window gets when its author names only its placement:
 * a drag that heals over its last quarter.
 */
export function createVideoMoshWindowDefaults(durationFrames: number): VideoMoshWindowParams {
	return {
		motion: 'follow',
		blockSize: 16,
		bleed: 0.08,
		corruption: 0.15,
		seed: 0,
		healFrames: Math.max(1, Math.round(durationFrames * 0.25))
	};
}

/** The window owning `frame`, or null. Windows are half-open `[startFrame, startFrame + durationFrames)`. */
export function resolveActiveVideoMoshAtFrame(
	media: Media,
	frame: number
): ResolvedActiveVideoMosh | null {
	for (const window of listVideoMoshWindows(media)) {
		if (frame < window.startFrame) return null;
		if (frame < window.startFrame + window.durationFrames) {
			return { window, localFrame: frame - window.startFrame };
		}
	}
	return null;
}

/** True when ordered clips leave no gap anywhere in the half-open frame range. */
export function videoTrackCoversFrameRange(
	clips: readonly VideoClip[],
	fromFrame: number,
	toFrame: number
): boolean {
	let coveredUntil = fromFrame;
	for (const clip of clips) {
		const clipEnd = clip.timelineStartFrame + clip.durationFrames;
		if (clipEnd <= coveredUntil) continue;
		if (clip.timelineStartFrame > coveredUntil) return false;
		coveredUntil = clipEnd;
		if (coveredUntil >= toFrame) return true;
	}
	return coveredUntil >= toFrame;
}

/**
 * Every rule a set of windows must meet against its Video track and transport
 * (ADR-0065 §9). Footage must exist from the held frame through the window's
 * last frame: a window may not touch a gap.
 */
export function describeVideoMoshWindowFindings(
	media: Media,
	compositionFrameCount: number,
	rate: FrameRate
): VideoMoshWindowFinding[] {
	const findings: VideoMoshWindowFinding[] = [];
	const maxFrames = resolveVideoMoshWindowMaxFrames(rate);
	const seen = new Set<string>();
	const windows = listVideoMoshWindows(media);
	for (const [index, window] of windows.entries()) {
		const endFrame = window.startFrame + window.durationFrames;
		if (seen.has(window.id)) {
			findings.push({ index, field: 'id', message: `Duplicate Mosh window ID "${window.id}"` });
		}
		seen.add(window.id);
		if (window.durationFrames > maxFrames) {
			findings.push({
				index,
				field: 'durationFrames',
				message: `Mosh window "${window.id}" runs ${window.durationFrames} frames; the limit is ${maxFrames} (3 seconds at this frame rate)`
			});
		}
		if (endFrame > compositionFrameCount) {
			findings.push({
				index,
				field: 'durationFrames',
				message: `Mosh window "${window.id}" ends at frame ${endFrame}, beyond the composition's ${compositionFrameCount} frames`
			});
		}
		if (window.healFrames > window.durationFrames) {
			findings.push({
				index,
				field: 'healFrames',
				message: `Mosh window "${window.id}" heals over ${window.healFrames} frames but lasts only ${window.durationFrames}`
			});
		}
		const previous = windows[index - 1];
		if (previous && previous.startFrame + previous.durationFrames > window.startFrame) {
			findings.push({
				index,
				field: 'startFrame',
				message: `Mosh windows must be ordered and non-overlapping; "${window.id}" starts before "${previous.id}" ends`
			});
		}
		if (!videoTrackCoversFrameRange(media.videoTrack.clips, window.startFrame - 1, endFrame)) {
			findings.push({
				index,
				field: 'startFrame',
				message: `Mosh window "${window.id}" needs footage on every frame from its held frame ${window.startFrame - 1} through frame ${endFrame - 1}`
			});
		}
	}
	return findings;
}
