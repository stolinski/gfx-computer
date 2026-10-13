import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { AudioPreview, type AudioPreviewServices } from './audio-preview';
import type { AudioMixRenderRequest } from './audio-mix';
import { createDefaultEngineState, type EngineState } from './engine-schema';

interface SourceStart {
	when: number;
	offset?: number;
	duration?: number;
}

class TestAudioBufferSource {
	buffer: AudioBuffer | null = null;
	onended: (() => void) | null = null;
	connections: AudioNode[] = [];
	starts: SourceStart[] = [];
	stopCount = 0;

	connect(destination: AudioNode): AudioNode {
		this.connections.push(destination);
		return destination;
	}

	start(when = 0, offset?: number, duration?: number): void {
		this.starts.push({ when, offset, duration });
	}

	stop(): void {
		this.stopCount += 1;
	}
}

class TestGain {
	gain = { value: 1 };
	connections: AudioNode[] = [];

	connect(destination: AudioNode): AudioNode {
		this.connections.push(destination);
		return destination;
	}
}

class TestAudioContext {
	readonly destination = {} as AudioDestinationNode;
	readonly sources: TestAudioBufferSource[] = [];
	readonly gains: TestGain[] = [];
	state: AudioContextState = 'running';
	currentTime = 0;
	resumeCount = 0;
	closeCount = 0;

	createGain(): GainNode {
		const gain = new TestGain();
		this.gains.push(gain);
		return gain as unknown as GainNode;
	}

	createBufferSource(): AudioBufferSourceNode {
		const source = new TestAudioBufferSource();
		this.sources.push(source);
		return source as unknown as AudioBufferSourceNode;
	}

	async resume(): Promise<void> {
		this.resumeCount += 1;
		this.state = 'running';
	}

	async close(): Promise<void> {
		this.closeCount += 1;
		this.state = 'closed';
	}
}

function testAudioBuffer(duration: number): AudioBuffer {
	const length = Math.round(duration * 48000);
	const channels = [new Float32Array(length), new Float32Array(length)];
	return {
		duration,
		length,
		numberOfChannels: 2,
		sampleRate: 48000,
		getChannelData: (channel: number) => channels[channel]
	} as unknown as AudioBuffer;
}

function silentState(): EngineState {
	const state = createDefaultEngineState();
	state.marks = { defaults: {}, timings: [] };
	state.surface = { type: 'plain', content: { body: [] } };
	state.textAnimations = [];
	state.overlays = [];
	state.audioCues = [];
	return state;
}

function videoClipState(options?: { enabled?: boolean; gain?: number }): EngineState {
	const state = silentState();
	state.media = {
		assets: [
			{
				id: 'asset-a',
				kind: 'video',
				name: 'A',
				assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
			}
		],
		videoTrack: {
			clips: [
				{
					id: 'clip-a',
					assetId: 'asset-a',
					timelineStartFrame: 0,
					durationFrames: 10000,
					sourceStartSeconds: 1.25,
					audio: { enabled: options?.enabled ?? true, gain: options?.gain ?? 1 }
				}
			]
		}
	};
	return state;
}

function cueState(): EngineState {
	const state = silentState();
	state.transport.durationSeconds = 10;
	state.audioCues = [
		{ id: 'manual', kind: 'cue', assetSlug: 'fixture', start: 0, duration: 1, volume: 0.5 }
	];
	return state;
}

function previewHarness(options?: {
	mixedAudio?: AudioBuffer | null;
	renderMixedAudio?: (request: AudioMixRenderRequest) => Promise<AudioBuffer | null>;
	loadCueBuffer?: () => Promise<AudioBuffer> | null;
}): {
	preview: AudioPreview;
	context: TestAudioContext;
	mixRequests: AudioMixRenderRequest[];
	getCueLoadCount(): number;
} {
	const context = new TestAudioContext();
	const mixRequests: AudioMixRenderRequest[] = [];
	let cueLoadCount = 0;
	const services: AudioPreviewServices = {
		createAudioContext: () => context as unknown as AudioContext,
		loadCueBuffer: () => {
			cueLoadCount += 1;
			return options?.loadCueBuffer?.() ?? Promise.resolve(testAudioBuffer(1));
		},
		renderMixedAudio: async (request) => {
			mixRequests.push(request);
			return options?.renderMixedAudio
				? options.renderMixedAudio(request)
				: (options?.mixedAudio ?? null);
		}
	};
	return {
		preview: new AudioPreview(services),
		context,
		mixRequests,
		getCueLoadCount: () => cueLoadCount
	};
}

describe('AudioPreview', () => {
	it('plays one exact Source-plus-cue mix from the explicit current playhead', async () => {
		const state = videoClipState();
		state.transport.durationSeconds = 10.01;
		state.transport.fps = 29.97;
		state.audioCues = [
			{ id: 'overlap', kind: 'cue', assetSlug: 'fixture', start: 0.2, duration: 0.1 }
		];
		const mixed = testAudioBuffer(10.01);
		const harness = previewHarness({ mixedAudio: mixed });
		harness.context.currentTime = 4;

		await harness.preview.start(state, () => 2.5);

		assert.equal(harness.mixRequests.length, 1);
		assert.equal(harness.mixRequests[0].frameCount, 300);
		assert.deepEqual(harness.mixRequests[0].frameRate, {
			fps: 29.97,
			num: 30000,
			den: 1001
		});
		assert.equal(harness.mixRequests[0].signal?.aborted, false);
		assert.equal(harness.getCueLoadCount(), 0);
		assert.equal(harness.context.sources.length, 1);
		assert.equal(harness.context.sources[0].buffer, mixed);
		assert.deepEqual(harness.context.sources[0].starts, [
			{ when: 4.03, offset: 2.5, duration: 7.51 }
		]);
		assert.equal(harness.context.sources[0].connections[0], harness.context.destination);
	});

	it('reads the current Timeline playhead after asynchronous Source decode completes', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let resolveMix!: (buffer: AudioBuffer) => void;
		const mixed = new Promise<AudioBuffer>((resolve) => {
			resolveMix = resolve;
		});
		const harness = previewHarness({
			renderMixedAudio: async () => {
				markStarted();
				return mixed;
			}
		});
		let playhead = 0;
		const pending = harness.preview.start(videoClipState(), () => playhead);
		await started;
		playhead = 1.25;
		resolveMix(testAudioBuffer(4));

		await pending;

		assert.deepEqual(harness.context.sources[0].starts, [
			{ when: 0.03, offset: 1.25, duration: 2.75 }
		]);
	});

	it('keeps the low-latency per-cue path when Video-clip audio is absent', async () => {
		const harness = previewHarness();
		harness.context.currentTime = 1;

		await harness.preview.start(cueState(), () => 0.2);

		assert.equal(harness.mixRequests.length, 0);
		assert.equal(harness.getCueLoadCount(), 1);
		assert.equal(harness.context.gains[0].gain.value, 0.8);
		assert.equal(harness.context.gains[1].gain.value, 0.5);
		assert.deepEqual(harness.context.sources[0].starts, [
			{ when: 1.03, offset: 0.2, duration: 0.8 }
		]);
	});

	it('uses the cue-only path when Video-clip audio is disabled or has zero gain', async () => {
		for (const state of [videoClipState({ enabled: false }), videoClipState({ gain: 0 })]) {
			state.audioCues = cueState().audioCues;
			const harness = previewHarness();

			await harness.preview.start(state, () => 0);

			assert.equal(harness.mixRequests.length, 0);
			assert.equal(harness.getCueLoadCount(), 1);
			assert.equal(harness.context.sources.length, 1);
		}
	});

	it('stays silent when an enabled Video clip has no audio track and no cues', async () => {
		const harness = previewHarness({ mixedAudio: null });

		await harness.preview.start(videoClipState(), () => 0);

		assert.equal(harness.mixRequests.length, 1);
		assert.equal(harness.context.sources.length, 0);
		assert.equal(harness.getCueLoadCount(), 0);
	});

	it('absorbs pause cancellation during Source decode and schedules no stale source', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let decodeSignal: AbortSignal | undefined;
		const harness = previewHarness({
			renderMixedAudio: async ({ signal }) => {
				decodeSignal = signal;
				markStarted();
				return new Promise<AudioBuffer | null>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		});

		const pending = harness.preview.start(videoClipState(), () => 0);
		await started;
		harness.preview.stop();
		await pending;

		assert.equal(decodeSignal?.aborted, true);
		assert.equal(harness.context.sources.length, 0);
	});

	it('stops the active mix and starts a fresh playhead slice on loop restart', async () => {
		const harness = previewHarness({ mixedAudio: testAudioBuffer(4) });
		let playhead = 1.5;
		await harness.preview.start(videoClipState(), () => playhead);
		const firstSource = harness.context.sources[0];
		playhead = 0;

		await harness.preview.start(videoClipState(), () => playhead);

		assert.equal(firstSource.stopCount, 1);
		assert.equal(harness.mixRequests.length, 2);
		assert.deepEqual(harness.context.sources[1].starts, [{ when: 0.03, offset: 0, duration: 4 }]);
	});

	it('stops active playback on pause and keeps scrub inert', async () => {
		const harness = previewHarness({ mixedAudio: testAudioBuffer(4) });
		assert.equal(harness.context.sources.length, 0);
		await harness.preview.start(videoClipState(), () => 1);

		harness.preview.stop();

		assert.equal(harness.context.sources[0].stopCount, 1);
		assert.equal(harness.context.sources.length, 1);
	});

	it('still rejects real Video mix failures for Workspace reporting', async () => {
		const harness = previewHarness({
			renderMixedAudio: async () => {
				throw new Error('decode failed');
			}
		});

		await assert.rejects(
			harness.preview.start(videoClipState(), () => 0),
			/decode failed/
		);
	});
});
