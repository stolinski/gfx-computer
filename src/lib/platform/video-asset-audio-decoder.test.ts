import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	VIDEO_ASSET_AUDIO_SAMPLE_RATE,
	VideoAssetAudioDecoder,
	type DecodedVideoAssetAudioSample,
	type VideoAssetAudioDecoderBackend,
	type VideoAssetAudioDecoderMetadata
} from './video-asset-audio-decoder';

const ASSET_URL = `/api/user-assets/${'a'.repeat(64)}.mp4`;

function decodeRequest(
	overrides: {
		sourceStartSeconds?: number;
		sourceEndSeconds?: number;
		outputSampleCount?: number;
		signal?: AbortSignal;
	} = {}
): {
	sourceStartSeconds: number;
	sourceEndSeconds: number;
	outputSampleCount: number;
	signal?: AbortSignal;
} {
	return {
		sourceStartSeconds: overrides.sourceStartSeconds ?? 0,
		sourceEndSeconds:
			overrides.sourceEndSeconds ??
			(overrides.outputSampleCount ?? 1) / VIDEO_ASSET_AUDIO_SAMPLE_RATE,
		outputSampleCount: overrides.outputSampleCount ?? 1,
		...(overrides.signal ? { signal: overrides.signal } : {})
	};
}

function audioSample(options: {
	timestamp?: number;
	sampleRate?: number;
	channels: number[][];
}): DecodedVideoAssetAudioSample {
	const channels = options.channels.map((channel) => Float32Array.from(channel));
	return {
		timestamp: options.timestamp ?? 0,
		sampleRate: options.sampleRate ?? VIDEO_ASSET_AUDIO_SAMPLE_RATE,
		numberOfFrames: channels[0]?.length ?? 0,
		channels
	};
}

function fixtureBackend(options: {
	metadata?: VideoAssetAudioDecoderMetadata | null;
	samples?: DecodedVideoAssetAudioSample[];
	onRange?: (start: number, end: number) => void;
	onDispose?: () => void;
}): VideoAssetAudioDecoderBackend {
	return {
		initialize: async () =>
			options.metadata === undefined
				? { sourceFirstTimestamp: 0, audioFirstTimestamp: 0 }
				: options.metadata,
		async *samples(start, end) {
			options.onRange?.(start, end);
			for (const sample of options.samples ?? []) yield sample;
		},
		dispose: () => options.onDispose?.()
	};
}

function decoderWithBackend(backend: VideoAssetAudioDecoderBackend): VideoAssetAudioDecoder {
	return new VideoAssetAudioDecoder(ASSET_URL, { createBackend: () => backend });
}

function assertNear(actual: number, expected: number, epsilon = 1e-6): void {
	assert.ok(
		Math.abs(actual - expected) <= epsilon,
		`${actual} was not within ${epsilon} of ${expected}`
	);
}

describe('VideoAssetAudioDecoder', () => {
	it('copies stereo 48 kHz samples at exact source-relative positions', async () => {
		let requestedRange: readonly [number, number] | null = null;
		const decoder = decoderWithBackend(
			fixtureBackend({
				metadata: { sourceFirstTimestamp: 10, audioFirstTimestamp: 10 },
				samples: [
					audioSample({
						timestamp: 12,
						channels: [
							[0.1, 0.2, 0.3, 0.4],
							[1, 0.9, 0.8, 0.7]
						]
					})
				],
				onRange: (start, end) => {
					requestedRange = [start, end];
				}
			})
		);

		const result = await decoder.decode(
			decodeRequest({
				sourceStartSeconds: 2,
				sourceEndSeconds: 2 + 4 / VIDEO_ASSET_AUDIO_SAMPLE_RATE,
				outputSampleCount: 4
			})
		);

		assert.deepEqual(requestedRange, [12, 12 + 4 / VIDEO_ASSET_AUDIO_SAMPLE_RATE]);
		assert.deepEqual([...result!.channels[0]], [...Float32Array.from([0.1, 0.2, 0.3, 0.4])]);
		assert.deepEqual([...result!.channels[1]], [...Float32Array.from([1, 0.9, 0.8, 0.7])]);
	});

	it('duplicates mono and linearly resamples 44.1 kHz input to 48 kHz', async () => {
		const ramp = Array.from({ length: 441 }, (_, index) => index / 441);
		const decoder = decoderWithBackend(
			fixtureBackend({ samples: [audioSample({ sampleRate: 44100, channels: [ramp] })] })
		);

		const result = await decoder.decode(decodeRequest({ outputSampleCount: 480 }));

		assert.equal(result!.channels[0].length, 480);
		assert.deepEqual(result!.channels[0], result!.channels[1]);
		assertNear(result!.channels[0][240], 220.5 / 441);
	});

	it('uses the fixed multichannel downmix matrix without applying clip gain', async () => {
		const decoder = decoderWithBackend(
			fixtureBackend({
				samples: [audioSample({ channels: [[1], [2], [3], [4], [5], [6]] })]
			})
		);

		const result = await decoder.decode(decodeRequest());

		assertNear(result!.channels[0][0], 1 + 3 * Math.SQRT1_2 + 4 * 0.5 + 5 * Math.SQRT1_2);
		assertNear(result!.channels[1][0], 2 + 3 * Math.SQRT1_2 + 4 * 0.5 + 6 * Math.SQRT1_2);
	});

	it('preserves an audio-track delayed start as leading silence', async () => {
		const delayedFrames = 96;
		const decoder = decoderWithBackend(
			fixtureBackend({
				metadata: {
					sourceFirstTimestamp: 10,
					audioFirstTimestamp: 10 + delayedFrames / VIDEO_ASSET_AUDIO_SAMPLE_RATE
				},
				samples: [
					audioSample({
						timestamp: 10 + delayedFrames / VIDEO_ASSET_AUDIO_SAMPLE_RATE,
						channels: [
							[0.75, 0.5],
							[0.25, 0.125]
						]
					})
				]
			})
		);

		const result = await decoder.decode(decodeRequest({ outputSampleCount: 100 }));

		assert.ok(result!.channels[0].subarray(0, delayedFrames).every((value) => value === 0));
		assertNear(result!.channels[0][96], 0.75);
		assertNear(result!.channels[1][97], 0.125);
		assert.ok(result!.channels[0].subarray(98).every((value) => value === 0));
	});

	it('returns no PCM for a missing track, empty output, or a range with no samples', async () => {
		let disposed = 0;
		const missingTrack = decoderWithBackend(
			fixtureBackend({ metadata: null, onDispose: () => (disposed += 1) })
		);
		assert.equal(await missingTrack.decode(decodeRequest({ outputSampleCount: 10 })), null);
		assert.equal(disposed, 1);

		let createdBackends = 0;
		const emptyOutput = new VideoAssetAudioDecoder(ASSET_URL, {
			createBackend: () => {
				createdBackends += 1;
				return fixtureBackend({});
			}
		});
		assert.equal(await emptyOutput.decode(decodeRequest({ outputSampleCount: 0 })), null);
		assert.equal(createdBackends, 0);

		const emptyRange = decoderWithBackend(fixtureBackend({ samples: [] }));
		assert.equal(await emptyRange.decode(decodeRequest({ outputSampleCount: 10 })), null);
	});

	it('clips samples crossing both source trim boundaries', async () => {
		let requestedRange: readonly [number, number] | null = null;
		const decoder = decoderWithBackend(
			fixtureBackend({
				samples: [
					audioSample({
						channels: [
							[0, 1, 2, 3, 4],
							[10, 11, 12, 13, 14]
						]
					})
				],
				onRange: (start, end) => {
					requestedRange = [start, end];
				}
			})
		);

		const result = await decoder.decode(
			decodeRequest({
				sourceStartSeconds: 2 / VIDEO_ASSET_AUDIO_SAMPLE_RATE,
				sourceEndSeconds: 4 / VIDEO_ASSET_AUDIO_SAMPLE_RATE,
				outputSampleCount: 2
			})
		);

		assert.deepEqual(requestedRange, [
			2 / VIDEO_ASSET_AUDIO_SAMPLE_RATE,
			4 / VIDEO_ASSET_AUDIO_SAMPLE_RATE
		]);
		assert.deepEqual([...result!.channels[0]], [2, 3]);
		assert.deepEqual([...result!.channels[1]], [12, 13]);
	});

	it('disposes an in-flight decoder once when cancellation interrupts iteration', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let rejectWait!: (error: Error) => void;
		const wait = new Promise<void>((_resolve, reject) => {
			rejectWait = reject;
		});
		let disposeCount = 0;
		const backend: VideoAssetAudioDecoderBackend = {
			initialize: async () => ({ sourceFirstTimestamp: 0, audioFirstTimestamp: 0 }),
			async *samples() {
				markStarted();
				await wait;
				yield audioSample({ channels: [[0], [0]] });
			},
			dispose: () => {
				disposeCount += 1;
				rejectWait(new Error('decoder disposed'));
			}
		};
		const decoder = decoderWithBackend(backend);
		const controller = new AbortController();
		const pending = decoder.decode(
			decodeRequest({ outputSampleCount: 100, signal: controller.signal })
		);
		await started;
		const reason = new DOMException('Export cancelled', 'AbortError');
		controller.abort(reason);

		await assert.rejects(pending, (error: unknown) => error === reason);
		assert.equal(disposeCount, 1);
	});
});
