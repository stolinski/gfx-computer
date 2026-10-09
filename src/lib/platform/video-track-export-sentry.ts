import { resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';
import { videoTrackCoversFrames } from '$lib/utils/video-clip-resolution';

import type { EngineState } from './engine-schema';
import type { Film } from './film-schema';

export interface VideoTrackExportSentryContext {
	[key: string]: string | number | boolean | null;
	mediaAssetCount: number;
	videoClipCount: number;
	fullyCoversTransport: boolean;
	audibleClipCount: number;
	minimumSourceStartSeconds: number | null;
	maximumSourceStartSeconds: number | null;
	minimumGain: number | null;
	maximumGain: number | null;
}

/**
 * Privacy-safe aggregate export context. Never include Media/clip IDs, names,
 * URLs, bytes, codec/probe metadata, or creator content here.
 */
export function videoTrackExportSentryContext(
	state: Pick<EngineState, 'media' | 'transport'>
): VideoTrackExportSentryContext {
	const clips = state.media.videoTrack.clips;
	const frameRate = resolveFrameRate(state.transport.fps);
	const frameCount = Math.max(1, secondsToFrames(state.transport.durationSeconds, frameRate));
	let minimumSourceStartSeconds: number | null = null;
	let maximumSourceStartSeconds: number | null = null;
	let minimumGain: number | null = null;
	let maximumGain: number | null = null;
	let audibleClipCount = 0;
	for (const clip of clips) {
		minimumSourceStartSeconds = Math.min(
			minimumSourceStartSeconds ?? clip.sourceStartSeconds,
			clip.sourceStartSeconds
		);
		maximumSourceStartSeconds = Math.max(
			maximumSourceStartSeconds ?? clip.sourceStartSeconds,
			clip.sourceStartSeconds
		);
		minimumGain = Math.min(minimumGain ?? clip.audio.gain, clip.audio.gain);
		maximumGain = Math.max(maximumGain ?? clip.audio.gain, clip.audio.gain);
		if (clip.audio.enabled && clip.audio.gain > 0) audibleClipCount += 1;
	}

	return {
		mediaAssetCount: state.media.assets.length,
		videoClipCount: clips.length,
		fullyCoversTransport: videoTrackCoversFrames(clips, frameCount),
		audibleClipCount,
		minimumSourceStartSeconds,
		maximumSourceStartSeconds,
		minimumGain,
		maximumGain
	};
}

function minimumOfNullable(left: number | null, right: number | null): number | null {
	if (left === null) return right;
	return right === null ? left : Math.min(left, right);
}

function maximumOfNullable(left: number | null, right: number | null): number | null {
	if (left === null) return right;
	return right === null ? left : Math.max(left, right);
}

/**
 * The same aggregate for a whole Film, which is what an export renders: counts
 * are summed over the Scenes, the ranges span every Scene, and the Video track
 * fully covers the transport only when it covers every Scene. A one-Scene
 * Film's context is its Scene's.
 */
export function filmVideoTrackExportSentryContext(
	film: Pick<Film, 'scenes'>
): VideoTrackExportSentryContext {
	const [firstScene, ...laterScenes] = film.scenes;
	if (firstScene === undefined) {
		throw new RangeError('A Film has at least one Scene.');
	}
	let context = videoTrackExportSentryContext(firstScene.state);
	for (const scene of laterScenes) {
		const sceneContext = videoTrackExportSentryContext(scene.state);
		context = {
			mediaAssetCount: context.mediaAssetCount + sceneContext.mediaAssetCount,
			videoClipCount: context.videoClipCount + sceneContext.videoClipCount,
			fullyCoversTransport: context.fullyCoversTransport && sceneContext.fullyCoversTransport,
			audibleClipCount: context.audibleClipCount + sceneContext.audibleClipCount,
			minimumSourceStartSeconds: minimumOfNullable(
				context.minimumSourceStartSeconds,
				sceneContext.minimumSourceStartSeconds
			),
			maximumSourceStartSeconds: maximumOfNullable(
				context.maximumSourceStartSeconds,
				sceneContext.maximumSourceStartSeconds
			),
			minimumGain: minimumOfNullable(context.minimumGain, sceneContext.minimumGain),
			maximumGain: maximumOfNullable(context.maximumGain, sceneContext.maximumGain)
		};
	}
	return context;
}

export function videoTrackExportSentryTags(
	context: VideoTrackExportSentryContext
): Record<string, string | number | boolean> {
	return {
		'export.media_assets': context.mediaAssetCount,
		'export.video_clips': context.videoClipCount,
		'export.video_track_full_coverage': context.fullyCoversTransport,
		'export.video_clip_audio': context.audibleClipCount > 0
	};
}
