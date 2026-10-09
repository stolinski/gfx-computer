import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { FrameRate } from '$lib/utils/composition-timing';

import {
	AUDIO_MIX_SAMPLE_RATE,
	audioMixSampleAtFrame,
	audioMixSampleCount,
	renderAudioMix,
	renderFilmAudioMix,
	type AudioMixServices,
	type FilmAudioMixScene,
	type VideoClipAudioDecodeRequest
} from './audio-mix';
import {
	createDefaultEngineState,
	type EngineState,
	type VideoAsset,
	type VideoClip
} from './engine-schema';
import type { VideoAssetAudioPcm } from './video-asset-audio-decoder';

const NTSC_2997: FrameRate = { fps: 29.97, num: 30000, den: 1001 };
const ASSET: VideoAsset = {
	id: 'asset-a',
	kind: 'video',
	name: 'Creator footage',
	assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
};

function silentState(): EngineState {
	const state = createDefaultEngineState();
	state.marks = { defaults: {}, timings: [] };
	state.surface = { type: 'plain', content: { body: [] } };
	state.media.assets = [ASSET];
	return state;
}

function videoClip(options: {
	id: string;
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartSeconds?: number;
	enabled?: boolean;
	gain?: number;
}): VideoClip {
	return {
		id: options.id,
		assetId: ASSET.id,
		timelineStartFrame: options.timelineStartFrame,
		durationFrames: options.durationFrames,
		sourceStartSeconds: options.sourceStartSeconds ?? 0,
		audio: { enabled: options.enabled ?? true, gain: options.gain ?? 1 }
	};
}

function testAudioBuffer(channelData: readonly Float32Array[]): AudioBuffer {
	return {
		length: channelData[0]?.length ?? 0,
		duration: (channelData[0]?.length ?? 0) / AUDIO_MIX_SAMPLE_RATE,
		numberOfChannels: channelData.length,
		sampleRate: AUDIO_MIX_SAMPLE_RATE,
		getChannelData: (channel: number) => channelData[channel],
		copyToChannel: (source: Float32Array, channel: number) => channelData[channel].set(source)
	} as unknown as AudioBuffer;
}

function stereoPcm(sampleCount: number, left: number, right = left): VideoAssetAudioPcm {
	return {
		sampleRate: AUDIO_MIX_SAMPLE_RATE,
		channels: [new Float32Array(sampleCount).fill(left), new Float32Array(sampleCount).fill(right)]
	};
}

function mixServices(
	options: {
		decode?: (request: VideoClipAudioDecodeRequest) => VideoAssetAudioPcm | null;
		cue?: AudioBuffer | null;
		onDecode?: (request: VideoClipAudioDecodeRequest) => void;
	} = {}
): AudioMixServices {
	return {
		decodeVideoClipAudio: async (request) => {
			options.onDecode?.(request);
			return options.decode?.(request) ?? null;
		},
		createCueDecodeContext: () => ({}) as BaseAudioContext,
		loadCueBuffer: () => (options.cue ? Promise.resolve(options.cue) : null),
		createOutputBuffer: ({ length, numberOfChannels }) =>
			testAudioBuffer(
				Array.from({ length: numberOfChannels ?? 1 }, () => new Float32Array(length ?? 0))
			)
	};
}

describe('deterministic audio mix', () => {
	it('places touching NTSC clips on shared absolute sample boundaries', async () => {
		const state = silentState();
		state.media.videoTrack.clips = [
			videoClip({ id: 'first', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 2 }),
			videoClip({ id: 'second', timelineStartFrame: 1, durationFrames: 1, sourceStartSeconds: 8 })
		];
		const requests: VideoClipAudioDecodeRequest[] = [];
		const rendered = await renderAudioMix(
			{ state, frameCount: 2, frameRate: NTSC_2997 },
			mixServices({
				onDecode: (request) => requests.push(request),
				decode: (request) =>
					stereoPcm(request.outputSampleCount, request.sourceStartSeconds === 2 ? 0.25 : 0.75)
			})
		);

		assert.equal(audioMixSampleAtFrame(1, NTSC_2997), 1602);
		assert.equal(audioMixSampleAtFrame(2, NTSC_2997), 3203);
		assert.deepEqual(
			requests.map(({ sourceStartSeconds, sourceEndSeconds, outputSampleCount }) => ({
				sourceStartSeconds,
				sourceEndSeconds,
				outputSampleCount
			})),
			[
				{
					sourceStartSeconds: 2,
					sourceEndSeconds: 2 + 1001 / 30000,
					outputSampleCount: 1602
				},
				{
					sourceStartSeconds: 8,
					sourceEndSeconds: 8 + 1001 / 30000,
					outputSampleCount: 1601
				}
			]
		);
		const left = rendered!.getChannelData(0);
		assert.equal(left[1601], 0.25);
		assert.equal(left[1602], 0.75);
		assert.equal(left.length, 3203);
	});

	it('leaves gaps and disabled clips silent while applying each clip gain', async () => {
		const frameRate: FrameRate = { fps: 30, num: 30, den: 1 };
		const state = silentState();
		state.media.videoTrack.clips = [
			videoClip({ id: 'opening', timelineStartFrame: 0, durationFrames: 1, gain: 0.5 }),
			videoClip({ id: 'muted', timelineStartFrame: 1, durationFrames: 1, enabled: false }),
			videoClip({ id: 'closing', timelineStartFrame: 3, durationFrames: 1, gain: 2 })
		];
		let decodeCalls = 0;
		const rendered = await renderAudioMix(
			{ state, frameCount: 4, frameRate },
			mixServices({
				decode: (request) => {
					decodeCalls += 1;
					return stereoPcm(request.outputSampleCount, 0.4);
				}
			})
		);

		const left = rendered!.getChannelData(0);
		assert.equal(decodeCalls, 2);
		assert.ok(left.subarray(0, 1600).every((sample) => Math.abs(sample - 0.2) < 1e-6));
		assert.ok(left.subarray(1600, 4800).every((sample) => sample === 0));
		assert.ok(left.subarray(4800).every((sample) => Math.abs(sample - 0.8) < 1e-6));
	});

	it('preserves legacy full-span audio while combining cues and bed in fixed order', async () => {
		const frameRate: FrameRate = { fps: 30, num: 30, den: 1 };
		const state = silentState();
		state.transport.durationSeconds = 1 / 30;
		state.media.videoTrack.clips = [
			videoClip({
				id: 'legacy-source-video-clip',
				timelineStartFrame: 0,
				durationFrames: 1,
				sourceStartSeconds: 18.25,
				gain: 0.8
			})
		];
		state.audioCues = [
			{ id: 'bed', kind: 'bed', assetSlug: 'fixture', start: 0, duration: 1, volume: 0.5 }
		];
		const sampleCount = audioMixSampleCount(1, frameRate);
		const rendered = await renderAudioMix(
			{ state, frameCount: 1, frameRate },
			mixServices({
				decode: (request) => stereoPcm(request.outputSampleCount, 0.25, 0.1),
				cue: testAudioBuffer([
					new Float32Array(sampleCount).fill(0.5),
					new Float32Array(sampleCount).fill(0.25)
				])
			})
		);

		assert.ok(Math.abs(rendered!.getChannelData(0)[0] - 0.4) < 1e-6);
		assert.ok(Math.abs(rendered!.getChannelData(1)[0] - 0.18) < 1e-6);
	});

	it('applies one final deterministic peak policy after clip and cue mixing', async () => {
		const frameRate: FrameRate = { fps: 30, num: 30, den: 1 };
		const state = silentState();
		state.media.videoTrack.clips = [
			videoClip({ id: 'full', timelineStartFrame: 0, durationFrames: 1 })
		];
		state.audioCues = [
			{ id: 'cue', kind: 'cue', assetSlug: 'fixture', start: 0, duration: 1, volume: 1 }
		];
		const sampleCount = audioMixSampleCount(1, frameRate);
		const rendered = await renderAudioMix(
			{ state, frameCount: 1, frameRate },
			mixServices({
				decode: (request) => stereoPcm(request.outputSampleCount, 0.8, 0.4),
				cue: testAudioBuffer([
					new Float32Array(sampleCount).fill(0.5),
					new Float32Array(sampleCount).fill(0.25)
				])
			})
		);

		assert.ok(Math.abs(rendered!.getChannelData(0)[0] - 0.98) < 1e-6);
		assert.ok(Math.abs(rendered!.getChannelData(1)[0] - 0.49) < 1e-6);
	});

	it('preserves cue-only behavior and emits no stream when every input is silent', async () => {
		const state = silentState();
		const frameRate: FrameRate = { fps: 30, num: 30, den: 1 };
		assert.equal(await renderAudioMix({ state, frameCount: 1, frameRate }, mixServices()), null);

		state.media.videoTrack.clips = [
			videoClip({ id: 'no-track', timelineStartFrame: 0, durationFrames: 1 })
		];
		assert.equal(await renderAudioMix({ state, frameCount: 1, frameRate }, mixServices()), null);

		state.media.videoTrack.clips = [];
		state.audioCues = [
			{ id: 'cue-only', kind: 'cue', assetSlug: 'fixture', start: 0, duration: 1, volume: 1 }
		];
		const sampleCount = audioMixSampleCount(1, frameRate);
		const rendered = await renderAudioMix(
			{ state, frameCount: 1, frameRate },
			mixServices({ cue: testAudioBuffer([new Float32Array(sampleCount).fill(0.25)]) })
		);
		assert.ok(Math.abs(rendered!.getChannelData(0)[0] - 0.2) < 1e-6);
		assert.ok(Math.abs(rendered!.getChannelData(1)[0] - 0.2) < 1e-6);
	});

	it('does not schedule a bed when Video clips leave transparent gaps', async () => {
		const state = silentState();
		state.transport.durationSeconds = 1;
		state.transport.fps = 2;
		state.media.videoTrack.clips = [
			videoClip({
				id: 'partial',
				timelineStartFrame: 1,
				durationFrames: 1,
				enabled: false
			})
		];
		state.audioCues = [
			{ id: 'ineligible-bed', kind: 'bed', assetSlug: 'fixture', start: 0, duration: 1 }
		];
		let cueLoads = 0;
		const services = mixServices({
			cue: testAudioBuffer([new Float32Array(AUDIO_MIX_SAMPLE_RATE)]),
			onDecode: () => undefined
		});
		services.loadCueBuffer = () => {
			cueLoads += 1;
			return Promise.resolve(testAudioBuffer([new Float32Array(AUDIO_MIX_SAMPLE_RATE)]));
		};

		assert.equal(
			await renderAudioMix(
				{ state, frameCount: 2, frameRate: { fps: 2, num: 2, den: 1 } },
				services
			),
			null
		);
		assert.equal(cueLoads, 0);
	});
});

describe('deterministic audio mix of a Film', () => {
	const RATE_30: FrameRate = { fps: 30, num: 30, den: 1 };
	// One frame at 30 fps.
	const FRAME_SAMPLES = 1600;

	/** A Scene of `frameCount` frames at 30 fps with nothing scheduled. */
	function sceneState(frameCount: number): EngineState {
		const state = silentState();
		state.transport.fps = 30;
		state.transport.durationSeconds = frameCount / 30;
		return state;
	}

	function cue(
		id: string,
		assetSlug: string,
		start: number,
		volume = 1
	): EngineState['audioCues'][number] {
		return { id, kind: 'cue', assetSlug, start, duration: 1, volume };
	}

	/** Mono cue buffers by slug, each a constant level. */
	function filmMixServices(
		options: {
			cues?: Record<string, { sampleCount: number; level: number }>;
			decode?: (request: VideoClipAudioDecodeRequest) => VideoAssetAudioPcm | null;
			log?: string[];
		} = {}
	): AudioMixServices {
		return {
			decodeVideoClipAudio: async (request) => {
				options.log?.push(`clip ${request.sourceStartSeconds}`);
				return options.decode?.(request) ?? null;
			},
			createCueDecodeContext: () => {
				options.log?.push('context');
				return {} as BaseAudioContext;
			},
			loadCueBuffer: (slug) => {
				options.log?.push(`cue ${slug}`);
				const entry = options.cues?.[slug];
				return entry
					? Promise.resolve(
							testAudioBuffer([new Float32Array(entry.sampleCount).fill(entry.level)])
						)
					: null;
			},
			createOutputBuffer: ({ length, numberOfChannels }) =>
				testAudioBuffer(
					Array.from({ length: numberOfChannels ?? 1 }, () => new Float32Array(length ?? 0))
				)
		};
	}

	function filmScenes(
		...scenes: { state: EngineState; frameCount: number }[]
	): FilmAudioMixScene[] {
		let startFrame = 0;
		return scenes.map((scene) => {
			const placed = { state: scene.state, startFrame, frameCount: scene.frameCount };
			startFrame += scene.frameCount;
			return placed;
		});
	}

	function sameBytes(left: Float32Array, right: Float32Array): boolean {
		return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(
			Buffer.from(right.buffer, right.byteOffset, right.byteLength)
		);
	}

	it('places each Scene sound at its Scene start in samples', async () => {
		const first = sceneState(2);
		first.audioCues = [cue('first-cue', 'tick', 0)];
		const second = sceneState(2);
		second.audioCues = [cue('second-cue', 'tick', 0.5)];

		const rendered = await renderFilmAudioMix(
			{
				scenes: filmScenes({ state: first, frameCount: 2 }, { state: second, frameCount: 2 }),
				frameCount: 4,
				frameRate: RATE_30
			},
			filmMixServices({ cues: { tick: { sampleCount: 400, level: 0.25 } } })
		);

		const left = rendered!.getChannelData(0);
		assert.equal(left.length, audioMixSampleCount(4, RATE_30));
		// Scene 1's cue sits on Film sample 0.
		assert.ok(Math.abs(left[0] - 0.2) < 1e-6);
		assert.ok(Math.abs(left[399] - 0.2) < 1e-6);
		assert.equal(left[400], 0);
		// Scene 2 starts on Film frame 2 (sample 3200); its cue is half-way in.
		const secondCueSample = audioMixSampleAtFrame(2, RATE_30) + FRAME_SAMPLES;
		assert.equal(secondCueSample, 4800);
		assert.equal(left[secondCueSample - 1], 0);
		assert.ok(Math.abs(left[secondCueSample] - 0.2) < 1e-6);
		assert.ok(Math.abs(left[secondCueSample + 399] - 0.2) < 1e-6);
		assert.equal(left[secondCueSample + 400], 0);
	});

	it('cuts a cue that would run past its Scene at the Scene end, with no tail and no fade', async () => {
		const first = sceneState(2);
		// Starts half-way through a 3200-sample Scene and is 2000 samples long.
		first.audioCues = [cue('long-cue', 'long', 0.5)];
		const second = sceneState(2);

		const rendered = await renderFilmAudioMix(
			{
				scenes: filmScenes({ state: first, frameCount: 2 }, { state: second, frameCount: 2 }),
				frameCount: 4,
				frameRate: RATE_30
			},
			filmMixServices({ cues: { long: { sampleCount: 2000, level: 0.25 } } })
		);

		const left = rendered!.getChannelData(0);
		const cut = audioMixSampleAtFrame(2, RATE_30);
		// Full level right up to the cut: a hard cut is hard for sound too.
		assert.ok(Math.abs(left[cut - 1] - 0.2) < 1e-6);
		assert.ok(left.subarray(cut).every((sample) => sample === 0));
	});

	it('keeps Video-clip audio inside its Scene span at a fractional rate', async () => {
		// One frame each at 30000/1001: Film samples 0, 1602, 3203. Scene 2 alone
		// is 1602 samples; inside the Film it owns 1601.
		const first = silentState();
		first.media.videoTrack.clips = [
			videoClip({ id: 'first', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 2 })
		];
		const second = silentState();
		second.media.videoTrack.clips = [
			videoClip({ id: 'second', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 8 })
		];
		const requests: number[] = [];

		const rendered = await renderFilmAudioMix(
			{
				scenes: filmScenes({ state: first, frameCount: 1 }, { state: second, frameCount: 1 }),
				frameCount: 2,
				frameRate: NTSC_2997
			},
			filmMixServices({
				decode: (request) => {
					requests.push(request.outputSampleCount);
					return stereoPcm(
						request.outputSampleCount,
						request.sourceStartSeconds === 2 ? 0.25 : 0.75
					);
				}
			})
		);

		const left = rendered!.getChannelData(0);
		// Each clip is decoded as it is in its Scene alone.
		assert.deepEqual(requests, [1602, 1602]);
		assert.equal(left.length, 3203);
		assert.equal(left[1601], 0.25);
		assert.equal(left[1602], 0.75);
		assert.equal(left[3202], 0.75);
	});

	it('is exactly as long as the Film in frames, however the Scene counts round', async () => {
		const scenes = [7, 11, 13].map((frameCount) => {
			const state = silentState();
			state.audioCues = [cue('cue', 'tick', 0)];
			return { state, frameCount };
		});

		const rendered = await renderFilmAudioMix(
			{ scenes: filmScenes(...scenes), frameCount: 31, frameRate: NTSC_2997 },
			filmMixServices({ cues: { tick: { sampleCount: 100, level: 0.25 } } })
		);

		assert.equal(rendered!.length, audioMixSampleCount(31, NTSC_2997));
		assert.equal(rendered!.length, Math.round((31 * 1001 * 48000) / 30000));
		// Each cue sits on the sample its Scene's first frame starts on.
		const left = rendered!.getChannelData(0);
		for (const startFrame of [0, 7, 18]) {
			const startSample = audioMixSampleAtFrame(startFrame, NTSC_2997);
			assert.ok(Math.abs(left[startSample] - 0.2) < 1e-6);
			if (startSample > 0) assert.equal(left[startSample - 1], 0);
		}
	});

	it('sums in one fixed order: Scene by Scene, and clips before cues inside a Scene', async () => {
		const first = sceneState(1);
		first.media.videoTrack.clips = [
			videoClip({
				id: 'first-clip',
				timelineStartFrame: 0,
				durationFrames: 1,
				sourceStartSeconds: 1,
				gain: 0.7
			})
		];
		// Same start: the plan orders these by cue id, not by array position.
		first.audioCues = [cue('b-cue', 'b', 0, 0.9), cue('a-cue', 'a', 0, 0.6)];
		const second = sceneState(1);
		second.media.videoTrack.clips = [
			videoClip({
				id: 'second-clip',
				timelineStartFrame: 0,
				durationFrames: 1,
				sourceStartSeconds: 2
			})
		];
		second.audioCues = [cue('c-cue', 'c', 0), cue('a-again', 'a', 0)];
		const log: string[] = [];

		const rendered = await renderFilmAudioMix(
			{
				scenes: filmScenes({ state: first, frameCount: 1 }, { state: second, frameCount: 1 }),
				frameCount: 2,
				frameRate: RATE_30
			},
			filmMixServices({
				log,
				decode: (request) => stereoPcm(request.outputSampleCount, 0.1),
				cues: {
					a: { sampleCount: FRAME_SAMPLES, level: 0.2 },
					b: { sampleCount: FRAME_SAMPLES, level: 0.3 },
					c: { sampleCount: FRAME_SAMPLES, level: 0.05 }
				}
			})
		);

		// Scene 1's clip, then Scene 1's cues, then Scene 2's clip, then the one
		// cue Scene 2 adds. A slug decoded for an earlier Scene is not decoded again.
		assert.deepEqual(log, ['clip 1', 'context', 'cue a', 'cue b', 'clip 2', 'cue c']);

		// The same single-precision accumulation, written out in that order.
		const clip = Math.fround(0.1);
		const a = Math.fround(0.2);
		const b = Math.fround(0.3);
		let expected = Math.fround(0 + clip * 0.7);
		expected = Math.fround(expected + a * 0.6 * 0.8 * 1);
		expected = Math.fround(expected + b * 0.9 * 0.8 * 1);
		assert.equal(rendered!.getChannelData(0)[0], expected);
		assert.equal(rendered!.getChannelData(0)[FRAME_SAMPLES - 1], expected);
	});

	it('applies the peak ceiling once, to the whole Film', async () => {
		const loud = sceneState(1);
		loud.media.videoTrack.clips = [
			videoClip({ id: 'loud', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 1 })
		];
		const quiet = sceneState(1);
		quiet.media.videoTrack.clips = [
			videoClip({ id: 'quiet', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 2 })
		];

		const rendered = await renderFilmAudioMix(
			{
				scenes: filmScenes({ state: loud, frameCount: 1 }, { state: quiet, frameCount: 1 }),
				frameCount: 2,
				frameRate: RATE_30
			},
			filmMixServices({
				decode: (request) =>
					stereoPcm(request.outputSampleCount, request.sourceStartSeconds === 1 ? 1.4 : 0.7)
			})
		);

		const left = rendered!.getChannelData(0);
		// One scale for both Scenes, so the quiet Scene stays half the loud one.
		assert.ok(Math.abs(left[0] - 0.98) < 1e-6);
		assert.ok(Math.abs(left[FRAME_SAMPLES] - 0.49) < 1e-6);
	});

	it('sounds on each side of a cut exactly as each Scene does alone', async () => {
		const makeFirst = (): EngineState => {
			const state = sceneState(2);
			state.media.videoTrack.clips = [
				videoClip({
					id: 'first-clip',
					timelineStartFrame: 1,
					durationFrames: 1,
					sourceStartSeconds: 1,
					gain: 0.5
				})
			];
			state.audioCues = [cue('first-cue', 'a', 0.75, 0.6)];
			return state;
		};
		const makeSecond = (): EngineState => {
			const state = sceneState(3);
			state.media.videoTrack.clips = [
				videoClip({
					id: 'second-clip',
					timelineStartFrame: 0,
					durationFrames: 2,
					sourceStartSeconds: 2
				})
			];
			state.audioCues = [cue('second-cue', 'b', 0, 0.9), cue('late-cue', 'a', 0.9)];
			return state;
		};
		const services = (): AudioMixServices =>
			filmMixServices({
				decode: (request) =>
					stereoPcm(request.outputSampleCount, request.sourceStartSeconds === 1 ? 0.3 : 0.1, 0.05),
				cues: {
					a: { sampleCount: 3000, level: 0.2 },
					b: { sampleCount: 500, level: 0.3 }
				}
			});

		const film = await renderFilmAudioMix(
			{
				scenes: filmScenes(
					{ state: makeFirst(), frameCount: 2 },
					{ state: makeSecond(), frameCount: 3 }
				),
				frameCount: 5,
				frameRate: RATE_30
			},
			services()
		);
		const firstAlone = await renderAudioMix(
			{ state: makeFirst(), frameCount: 2, frameRate: RATE_30 },
			services()
		);
		const secondAlone = await renderAudioMix(
			{ state: makeSecond(), frameCount: 3, frameRate: RATE_30 },
			services()
		);

		const cut = audioMixSampleAtFrame(2, RATE_30);
		for (const channel of [0, 1]) {
			const filmChannel = film!.getChannelData(channel);
			assert.equal(filmChannel.length, firstAlone!.length + secondAlone!.length);
			assert.ok(sameBytes(filmChannel.subarray(0, cut), firstAlone!.getChannelData(channel)));
			assert.ok(sameBytes(filmChannel.subarray(cut), secondAlone!.getChannelData(channel)));
		}
		// Not a silent pass: there is sound on both sides of the cut.
		assert.ok(film!.getChannelData(0)[cut - 1] !== 0);
		assert.ok(film!.getChannelData(0)[cut] !== 0);
	});

	it('is the lone composition mix, byte for byte, for a one-Scene Film', async () => {
		const makeState = (): EngineState => {
			const state = sceneState(3);
			state.media.videoTrack.clips = [
				videoClip({
					id: 'opening',
					timelineStartFrame: 0,
					durationFrames: 1,
					sourceStartSeconds: 1,
					gain: 0.5
				}),
				videoClip({
					id: 'closing',
					timelineStartFrame: 2,
					durationFrames: 1,
					sourceStartSeconds: 2,
					gain: 2
				})
			];
			state.audioCues = [cue('b', 'b', 0.1, 0.9), cue('a', 'a', 0.1, 0.6), cue('late', 'a', 0.8)];
			return state;
		};
		const services = (log?: string[]): AudioMixServices =>
			filmMixServices({
				log,
				decode: (request) => stereoPcm(request.outputSampleCount, 0.45, 0.2),
				cues: {
					a: { sampleCount: 3000, level: 0.2 },
					b: { sampleCount: 500, level: 0.3 }
				}
			});
		const loneLog: string[] = [];
		const filmLog: string[] = [];

		const lone = await renderAudioMix(
			{ state: makeState(), frameCount: 3, frameRate: RATE_30 },
			services(loneLog)
		);
		const film = await renderFilmAudioMix(
			{
				scenes: [{ state: makeState(), startFrame: 0, frameCount: 3 }],
				frameCount: 3,
				frameRate: RATE_30
			},
			services(filmLog)
		);

		for (const channel of [0, 1]) {
			assert.ok(sameBytes(film!.getChannelData(channel), lone!.getChannelData(channel)));
		}
		assert.deepEqual(filmLog, loneLog);
		// Clips are decoded before any cue, as the lone mix always did.
		assert.deepEqual(loneLog, ['clip 1', 'clip 2', 'context', 'cue a', 'cue b']);
	});

	it('adopts a whole-Film clip buffer only for a one-Scene Film', async () => {
		const state = sceneState(1);
		state.media.videoTrack.clips = [
			videoClip({ id: 'full', timelineStartFrame: 0, durationFrames: 1, gain: 0.5 })
		];
		const decoded = stereoPcm(FRAME_SAMPLES, -0);

		const rendered = await renderFilmAudioMix(
			{ scenes: [{ state, startFrame: 0, frameCount: 1 }], frameCount: 1, frameRate: RATE_30 },
			filmMixServices({ decode: () => decoded })
		);

		// The adopted buffer keeps its negative zero; a sum into zeros would not.
		assert.ok(Object.is(rendered!.getChannelData(0)[0], -0));
	});

	it('emits no stream when no Scene schedules a sound, and one when a later Scene does', async () => {
		const silent = sceneState(1);
		const sounding = sceneState(1);
		sounding.audioCues = [cue('cue', 'tick', 0)];
		const services = (): AudioMixServices =>
			filmMixServices({ cues: { tick: { sampleCount: 100, level: 0.25 } } });

		assert.equal(
			await renderFilmAudioMix(
				{
					scenes: filmScenes(
						{ state: silent, frameCount: 1 },
						{ state: sceneState(1), frameCount: 1 }
					),
					frameCount: 2,
					frameRate: RATE_30
				},
				services()
			),
			null
		);
		const rendered = await renderFilmAudioMix(
			{
				scenes: filmScenes({ state: silent, frameCount: 1 }, { state: sounding, frameCount: 1 }),
				frameCount: 2,
				frameRate: RATE_30
			},
			services()
		);
		const left = rendered!.getChannelData(0);
		assert.ok(left.subarray(0, FRAME_SAMPLES).every((sample) => sample === 0));
		assert.ok(Math.abs(left[FRAME_SAMPLES] - 0.2) < 1e-6);
	});

	it('refuses a Scene that runs past the Film and a clip that runs past its Scene', async () => {
		const state = sceneState(1);
		await assert.rejects(
			renderFilmAudioMix(
				{ scenes: [{ state, startFrame: 1, frameCount: 2 }], frameCount: 2, frameRate: RATE_30 },
				filmMixServices()
			),
			RangeError
		);

		const overhanging = sceneState(1);
		overhanging.media.videoTrack.clips = [
			videoClip({ id: 'overhang', timelineStartFrame: 0, durationFrames: 2 })
		];
		await assert.rejects(
			renderFilmAudioMix(
				{
					scenes: filmScenes(
						{ state: overhanging, frameCount: 1 },
						{ state: sceneState(1), frameCount: 1 }
					),
					frameCount: 2,
					frameRate: RATE_30
				},
				filmMixServices({ decode: (request) => stereoPcm(request.outputSampleCount, 0.1) })
			),
			/extends beyond the audio mix transport/
		);
	});

	it('stops between Scenes when the export is cancelled', async () => {
		const first = sceneState(1);
		first.media.videoTrack.clips = [
			videoClip({ id: 'first', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 1 })
		];
		const second = sceneState(1);
		second.media.videoTrack.clips = [
			videoClip({ id: 'second', timelineStartFrame: 0, durationFrames: 1, sourceStartSeconds: 2 })
		];
		const abortController = new AbortController();
		const log: string[] = [];

		await assert.rejects(
			renderFilmAudioMix(
				{
					scenes: filmScenes({ state: first, frameCount: 1 }, { state: second, frameCount: 1 }),
					frameCount: 2,
					frameRate: RATE_30,
					signal: abortController.signal
				},
				filmMixServices({
					log,
					decode: (request) => {
						abortController.abort();
						return stereoPcm(request.outputSampleCount, 0.1);
					}
				})
			)
		);
		assert.deepEqual(log, ['clip 1']);
	});
});
