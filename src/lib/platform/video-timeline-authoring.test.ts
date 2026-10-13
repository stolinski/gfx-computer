import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { resolveFrameRate } from '$lib/utils/composition-timing';
import { createVideoClipDragOrigin } from '$lib/utils/video-clip-edit';

import type { VideoAsset, VideoClip } from './engine-schema.ts';
import { MEDIA_LIBRARY_ASSET_MIME } from './media-library-drag-transfer.ts';
import {
	allocateVideoTimelineClipId,
	createVideoTimelineSnapOptions,
	formatVideoTimelineSourceRange,
	resolveVideoTimelineDrop,
	resolveVideoTimelinePointerEdit,
	videoTimelinePointerFrame
} from './video-timeline-authoring.ts';

const FRAME_RATE = resolveFrameRate(30);
const ASSET: VideoAsset = {
	id: 'camera',
	kind: 'video',
	name: 'Main camera',
	assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
};

function clip(overrides: Partial<VideoClip> = {}): VideoClip {
	return {
		id: 'selected',
		assetId: ASSET.id,
		timelineStartFrame: 100,
		durationFrames: 60,
		sourceStartSeconds: 4,
		audio: { enabled: true, gain: 1 },
		...overrides
	};
}

function transfer(assetId = ASSET.id): { getData(format: string): string } {
	return {
		getData: (format) =>
			format === MEDIA_LIBRARY_ASSET_MIME
				? JSON.stringify({ version: 1, type: 'media-library-asset', assetId })
				: ''
	};
}

describe('Video timeline Media drop adaptation', () => {
	it('creates selection-ready defaults at the exact legal destination frame', () => {
		const existing = [clip({ id: 'opening', timelineStartFrame: 0, durationFrames: 30 })];
		const result = resolveVideoTimelineDrop({
			dataTransfer: transfer(),
			assets: [ASSET],
			clips: existing,
			readInspection: () => ({
				status: 'ready',
				metadata: {
					durationSeconds: 2,
					displayWidth: 1920,
					displayHeight: 1080,
					rotation: 0,
					averageFrameRate: 30,
					videoCodec: 'h264',
					hasAudio: true
				}
			}),
			pointerClientX: 100,
			lane: { left: 0, width: 300 },
			compositionFrameCount: 300,
			playheadFrame: 0,
			frameRate: FRAME_RATE
		});
		assert.equal(result.status, 'created');
		if (result.status !== 'created') return;
		assert.equal(result.selectedClipId, 'camera:clip');
		assert.deepEqual(result.clip, {
			id: 'camera:clip',
			assetId: 'camera',
			timelineStartFrame: 100,
			durationFrames: 60,
			sourceStartSeconds: 0,
			audio: { enabled: true, gain: 1 }
		});
		assert.deepEqual(
			result.clips.map((entry) => entry.id),
			['opening', 'camera:clip']
		);
		assert.deepEqual(existing, [
			clip({ id: 'opening', timelineStartFrame: 0, durationFrames: 30 })
		]);
	});

	it('truncates a long source at the next clip while preserving the exact mid-gap drop frame', () => {
		const existing = [
			clip({ id: 'opening', timelineStartFrame: 0, durationFrames: 40 }),
			clip({ id: 'next', timelineStartFrame: 150, durationFrames: 30 })
		];
		const result = resolveVideoTimelineDrop({
			dataTransfer: transfer(),
			assets: [ASSET],
			clips: existing,
			readInspection: () => ({
				status: 'ready',
				metadata: {
					durationSeconds: 20,
					displayWidth: 1920,
					displayHeight: 1080,
					rotation: 0,
					averageFrameRate: 30,
					videoCodec: 'h264',
					hasAudio: true
				}
			}),
			pointerClientX: 70,
			lane: { left: 0, width: 300 },
			compositionFrameCount: 300,
			playheadFrame: 0,
			frameRate: FRAME_RATE
		});
		assert.equal(result.status, 'created');
		if (result.status !== 'created') return;
		assert.equal(result.clip.timelineStartFrame, 70);
		assert.equal(result.clip.durationFrames, 80);
		assert.deepEqual(
			result.clips.map((entry) => entry.id),
			['opening', 'camera:clip', 'next']
		);
	});

	it('rejects occupied destinations, composition end, and a full lane without relocating', () => {
		const metadata = {
			durationSeconds: 20,
			displayWidth: 1920,
			displayHeight: 1080,
			rotation: 0 as const,
			averageFrameRate: 30,
			videoCodec: 'h264',
			hasAudio: true
		};
		const base = {
			dataTransfer: transfer(),
			assets: [ASSET],
			readInspection: () => ({ status: 'ready' as const, metadata }),
			lane: { left: 0, width: 300 },
			compositionFrameCount: 300,
			playheadFrame: 0,
			frameRate: FRAME_RATE
		};
		assert.equal(
			resolveVideoTimelineDrop({
				...base,
				clips: [clip({ id: 'occupied', timelineStartFrame: 100, durationFrames: 40 })],
				pointerClientX: 120
			}).status,
			'no-legal-gap'
		);
		assert.equal(
			resolveVideoTimelineDrop({ ...base, clips: [], pointerClientX: 300 }).status,
			'no-legal-gap'
		);
		assert.equal(
			resolveVideoTimelineDrop({
				...base,
				clips: [clip({ id: 'full', timelineStartFrame: 0, durationFrames: 300 })],
				pointerClientX: 200
			}).status,
			'no-legal-gap'
		);
	});

	it('allocates stable unique IDs and rejects foreign or missing Media payloads', () => {
		const clips = [
			clip({ id: 'camera:clip' }),
			clip({ id: 'camera:clip:2', timelineStartFrame: 170 })
		];
		assert.equal(allocateVideoTimelineClipId('camera', clips), 'camera:clip:3');

		const base = {
			assets: [ASSET],
			clips: [],
			readInspection: () => ({ status: 'idle' as const }),
			pointerClientX: 0,
			lane: { left: 0, width: 300 },
			compositionFrameCount: 300,
			playheadFrame: 0,
			frameRate: FRAME_RATE
		};
		assert.deepEqual(
			resolveVideoTimelineDrop({ ...base, dataTransfer: { getData: () => 'text' } }),
			{ status: 'invalid-payload' }
		);
		assert.deepEqual(resolveVideoTimelineDrop({ ...base, dataTransfer: transfer('missing') }), {
			status: 'asset-not-found'
		});
	});

	it('returns the asset for best-effort inspection without editing when metadata is not ready', () => {
		const existing = [clip({ id: 'opening', timelineStartFrame: 0 })];
		const result = resolveVideoTimelineDrop({
			dataTransfer: transfer(),
			assets: [ASSET],
			clips: existing,
			readInspection: () => ({ status: 'probing' }),
			pointerClientX: 200,
			lane: { left: 0, width: 300 },
			compositionFrameCount: 300,
			playheadFrame: 0,
			frameRate: FRAME_RATE
		});
		assert.deepEqual(result, { status: 'metadata-not-ready', asset: ASSET });
		assert.equal(existing.length, 1);
	});
});

describe('Video timeline pointer adaptation', () => {
	const clips = [
		clip({ id: 'previous', timelineStartFrame: 20, durationFrames: 40 }),
		clip(),
		clip({ id: 'next', timelineStartFrame: 190, durationFrames: 30 })
	];
	const origin = createVideoClipDragOrigin({
		clips,
		clipId: 'selected',
		compositionFrameCount: 300,
		sourceDurationSeconds: 20,
		frameRate: FRAME_RATE
	});

	function edit(mode: 'move' | 'trim-left' | 'trim-right' | 'slip', pointerClientX: number) {
		return resolveVideoTimelinePointerEdit({
			clips,
			origin,
			mode,
			pointerStartX: 100,
			pointerClientX,
			laneWidth: 300,
			playheadFrame: 75
		});
	}

	it('routes move and both trim handles from one immutable integer-frame origin', () => {
		const moved = edit('move', 120);
		assert.equal(moved.frameDelta, 20);
		assert.equal(moved.clip.timelineStartFrame, 120);
		assert.equal(moved.clip.durationFrames, 60);

		const left = edit('trim-left', 110);
		assert.equal(left.clip.timelineStartFrame, 110);
		assert.equal(left.clip.durationFrames, 50);
		assert.equal(left.clip.sourceStartSeconds, 4 + 10 / 30);

		const right = edit('trim-right', 120);
		assert.equal(right.clip.timelineStartFrame, 100);
		assert.equal(right.clip.durationFrames, 80);
		assert.equal(origin.clip.timelineStartFrame, 100);
		assert.equal(clips[1].timelineStartFrame, 100);
		assert.notEqual(moved.clips, clips);
	});

	it('routes Alt/Option slip as source-only motion', () => {
		const slipped = edit('slip', 115);
		assert.equal(slipped.frameDelta, 15);
		assert.equal(slipped.clip.sourceStartSeconds, 4.5);
		assert.equal(slipped.clip.timelineStartFrame, 100);
		assert.equal(slipped.clip.durationFrames, 60);
	});

	it('rounds pointer coordinates to exact frames and snaps to playhead and other clip edges', () => {
		assert.equal(videoTimelinePointerFrame(104.6, { left: 5, width: 200 }, 200), 100);
		assert.equal(videoTimelinePointerFrame(-10, { left: 5, width: 200 }, 200), 0);
		assert.deepEqual(
			createVideoTimelineSnapOptions({
				clips,
				compositionFrameCount: 300,
				playheadFrame: 75.4,
				laneWidth: 300,
				excludedClipId: 'selected'
			}),
			{ targetFrames: [0, 20, 60, 75, 190, 220, 300], thresholdFrames: 6 }
		);
		const snapped = edit('move', 128);
		assert.equal(snapped.frameDelta, 28);
		assert.equal(snapped.clip.timelineStartFrame, 130);
		assert.equal(snapped.clip.timelineStartFrame + snapped.clip.durationFrames, 190);
	});

	it('formats direct slip feedback as a mono-ready Source range', () => {
		assert.equal(formatVideoTimelineSourceRange(clip(), FRAME_RATE), 'Source 4.00–6.00s');
	});
});
