import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import type { FilmAudioMixRenderRequest } from './audio-mix';
import { createDefaultEngineState, type EngineState, type Preset } from './engine-schema';
import type { TransparentVideoExportOptions, VideoExportDownload } from './export-video';
import {
	buildCompositionExportPlan,
	compositionExportFrameAt,
	compositionExportSceneFrameAt,
	CompositionExportController,
	type CompositionExportControllerDependencies,
	type CompositionExportControllerServices,
	type CompositionExportUiState
} from './composition-export-controller';
import { FILM_SCHEMA_ID, type Film } from './film-schema';

function makePreset(name: string, opaque: boolean): Preset {
	const state = createDefaultEngineState();
	if (opaque) state.backgroundFill = '#000000';
	return { schema: 'gfx@1', name, pack: 'syntax', kind: 'fixture', state };
}

function makeState(options?: {
	format?: 'webm' | 'prores';
	orientation?: 'horizontal' | 'vertical';
	durationSeconds?: number;
	fps?: number;
	opaque?: boolean;
	videoTrack?: 'full' | 'gapped' | 'unused';
}): EngineState {
	const state = createDefaultEngineState();
	state.transport.format = options?.format ?? 'webm';
	state.transport.orientation = options?.orientation ?? 'horizontal';
	state.transport.durationSeconds = options?.durationSeconds ?? 4;
	state.transport.fps = options?.fps ?? 30;
	if (options?.opaque) state.backgroundFill = '#101010';
	if (options?.videoTrack) {
		state.media.assets = [
			{
				id: 'asset-a',
				kind: 'video',
				name: 'A',
				assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
			}
		];
		if (options.videoTrack !== 'unused') {
			const frameCount = Math.round(state.transport.durationSeconds * state.transport.fps);
			state.media.videoTrack.clips = [
				{
					id: 'clip-a',
					assetId: 'asset-a',
					timelineStartFrame: options.videoTrack === 'gapped' ? 1 : 0,
					durationFrames: options.videoTrack === 'gapped' ? frameCount - 1 : frameCount,
					sourceStartSeconds: 0,
					audio: { enabled: true, gain: 1 }
				}
			];
		}
	}
	return state;
}

/**
 * A Film of the given Scene states, cut to cut, with the first Scene's
 * transport as the Film's. One state is the one-Scene Film every lone
 * composition is.
 */
function filmOf(...states: EngineState[]): Film {
	const { orientation, fps, format } = states[0].transport;
	return {
		schema: FILM_SCHEMA_ID,
		name: 'Export fixture',
		pack: 'syntax',
		orientation,
		fps,
		format,
		scenes: states.map((state, sceneIndex) => ({
			id: `scene-${sceneIndex + 1}`,
			origin: null,
			state
		})),
		boundaries: states.slice(1).map(() => ({ kind: 'cut' }))
	};
}

describe('composition export plan', () => {
	it('classifies transparent WebM and preserves exact rational frame timing', () => {
		const plan = buildCompositionExportPlan({
			film: filmOf(makeState({ durationSeconds: 10.01, fps: 29.97 })),
			transition: null
		});

		assert.equal(plan.output, 'transparent');
		assert.equal(plan.codec, 'vp9-alpha');
		assert.deepEqual(plan.size, { width: 3840, height: 2160 });
		assert.deepEqual(plan.frameRate, { fps: 29.97, num: 30000, den: 1001 });
		assert.equal(plan.frameCount, 300);
		assert.equal(plan.videoFilename, 'gfx-overlay.webm');
		assert.equal(plan.wavFilename, 'gfx-overlay.wav');
	});

	it('keeps opaque ProRes on the existing 4444 lane at native vertical dimensions', () => {
		const plan = buildCompositionExportPlan({
			film: filmOf(makeState({ format: 'prores', orientation: 'vertical', opaque: true })),
			transition: null,
			request: { startTimecode: '01:00:08:00', filename: 'synced-piece.mov' }
		});

		assert.equal(plan.output, 'opaque');
		assert.equal(plan.codec, 'prores-4444');
		assert.deepEqual(plan.size, { width: 2160, height: 3840 });
		assert.equal(plan.basename, 'gfx-bumper');
		assert.equal(plan.videoFilename, 'synced-piece.mov');
		assert.equal(plan.wavFilename, 'gfx-bumper.wav');
	});

	it('classifies only fully covered Video-track WebM as native opaque output', () => {
		const plan = buildCompositionExportPlan({
			film: filmOf(makeState({ videoTrack: 'full', fps: 60 })),
			transition: null
		});

		assert.equal(plan.output, 'opaque');
		assert.equal(plan.codec, 'vp9-opaque');
		assert.equal(plan.basename, 'gfx-bumper');
		assert.deepEqual(plan.frameRate, { fps: 60, num: 60, den: 1 });
	});

	it('keeps unused Media and gapped clips on the alpha overlay lane', () => {
		for (const videoTrack of ['unused', 'gapped'] as const) {
			const plan = buildCompositionExportPlan({
				film: filmOf(makeState({ videoTrack, durationSeconds: 1, fps: 30 })),
				transition: null
			});
			assert.equal(plan.output, 'transparent');
			assert.equal(plan.codec, 'vp9-alpha');
			assert.equal(plan.basename, 'gfx-overlay');
		}
	});

	it('keeps gapped ProRes transparent classification on the 4444 codec lane', () => {
		const plan = buildCompositionExportPlan({
			film: filmOf(
				makeState({ format: 'prores', videoTrack: 'gapped', durationSeconds: 1, fps: 30 })
			),
			transition: null
		});
		assert.equal(plan.output, 'transparent');
		assert.equal(plan.codec, 'prores-4444');
		assert.equal(plan.videoFilename, 'gfx-overlay.mov');
	});

	it('classifies a transition as opaque only when both endpoint Presets are opaque', () => {
		const film = filmOf(makeState({ opaque: true }));
		const opaque = makePreset('Opaque', true);
		const transparent = makePreset('Transparent', false);

		assert.equal(
			buildCompositionExportPlan({ film, transition: { from: opaque, to: opaque } }).output,
			'opaque'
		);
		assert.equal(
			buildCompositionExportPlan({ film, transition: { from: opaque, to: transparent } }).output,
			'transparent'
		);
	});

	it('rejects a start timecode on the WebM lane', () => {
		assert.throws(
			() =>
				buildCompositionExportPlan({
					film: filmOf(makeState()),
					transition: null,
					request: { startTimecode: '01:00:08:00' }
				}),
			/A start timecode requires the ProRes format/
		);
	});
});

describe('composition export plan of a Film', () => {
	const SCENE_SECONDS = [2, 1.5, 0.52];
	// Each Scene's duration becomes a frame count on its own, at the Film's exact
	// rate: 0.52 s is 12.48, 15.58, and 31.2 frames, so it rounds differently at
	// each rate and the Film is never a rounded sum of seconds.
	const RATES = [
		{ fps: 24, num: 24, den: 1, sceneFrameCounts: [48, 36, 12] },
		{ fps: 29.97, num: 30000, den: 1001, sceneFrameCounts: [60, 45, 16] },
		{ fps: 60, num: 60, den: 1, sceneFrameCounts: [120, 90, 31] }
	];

	for (const rate of RATES) {
		for (const sceneCount of [1, 2, 3]) {
			it(`plans ${sceneCount} Scene(s) at ${rate.fps} fps in whole frames`, () => {
				const film = filmOf(
					...SCENE_SECONDS.slice(0, sceneCount).map((durationSeconds) =>
						makeState({ durationSeconds, fps: rate.fps })
					)
				);
				const sceneFrameCounts = rate.sceneFrameCounts.slice(0, sceneCount);
				const startFrames = sceneFrameCounts.map((_count, sceneIndex) =>
					sceneFrameCounts.slice(0, sceneIndex).reduce((sum, count) => sum + count, 0)
				);
				const frameCount = sceneFrameCounts.reduce((sum, count) => sum + count, 0);

				const plan = buildCompositionExportPlan({ film, transition: null });

				assert.equal(plan.frameCount, frameCount);
				assert.equal(plan.fps, rate.fps);
				assert.deepEqual(plan.frameRate, { fps: rate.fps, num: rate.num, den: rate.den });
				assert.deepEqual(
					plan.scenes,
					sceneFrameCounts.map((sceneFrameCount, sceneIndex) => ({
						sceneId: `scene-${sceneIndex + 1}`,
						startFrame: startFrames[sceneIndex],
						frameCount: sceneFrameCount,
						durationSeconds: SCENE_SECONDS[sceneIndex]
					}))
				);
				// Film time ends where the last Scene's own duration ends, counted
				// from the frame that Scene starts on.
				const lastSceneIndex = sceneCount - 1;
				assert.equal(
					plan.durationSeconds,
					(startFrames[lastSceneIndex] * rate.den) / rate.num + SCENE_SECONDS[lastSceneIndex]
				);

				// Film timestamps run on without a seam; Scene time starts over at
				// each cut.
				for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
					const firstFrame = startFrames[sceneIndex];
					const lastFrame = firstFrame + sceneFrameCounts[sceneIndex] - 1;
					assert.deepEqual(compositionExportFrameAt(plan, firstFrame), {
						frame: firstFrame,
						timestamp: (firstFrame * rate.den) / rate.num
					});
					assert.deepEqual(compositionExportSceneFrameAt(plan, firstFrame), {
						sceneIndex,
						scene: plan.scenes[sceneIndex],
						frame: 0,
						timestamp: 0
					});
					assert.deepEqual(compositionExportSceneFrameAt(plan, lastFrame), {
						sceneIndex,
						scene: plan.scenes[sceneIndex],
						frame: sceneFrameCounts[sceneIndex] - 1,
						timestamp: ((sceneFrameCounts[sceneIndex] - 1) * rate.den) / rate.num
					});
				}
				assert.throws(() => compositionExportFrameAt(plan, frameCount), RangeError);
				assert.throws(() => compositionExportSceneFrameAt(plan, frameCount), RangeError);
				assert.throws(() => compositionExportSceneFrameAt(plan, -1), RangeError);
			});
		}
	}

	it('plans a one-Scene Film exactly as its Scene was planned as a lone composition', () => {
		// Written out from what the plan was before export knew about Films, so
		// this fails if a one-Scene export ever drifts from it.
		const plan = buildCompositionExportPlan({
			film: filmOf(makeState({ durationSeconds: 10.01, fps: 29.97 })),
			transition: null
		});
		const { scenes, ...planBeforeFilms } = plan;

		assert.deepEqual(planBeforeFilms, {
			format: 'webm',
			codec: 'vp9-alpha',
			output: 'transparent',
			size: { width: 3840, height: 2160 },
			durationSeconds: 10.01,
			fps: 29.97,
			frameRate: { fps: 29.97, num: 30000, den: 1001 },
			frameCount: 300,
			basename: 'gfx-overlay',
			videoFilename: 'gfx-overlay.webm',
			wavFilename: 'gfx-overlay.wav',
			startTimecode: undefined
		});
		assert.deepEqual(scenes, [
			{ sceneId: 'scene-1', startFrame: 0, frameCount: 300, durationSeconds: 10.01 }
		]);
		// A duration that is not a whole number of frames stays the authored one.
		assert.equal(
			buildCompositionExportPlan({
				film: filmOf(makeState({ durationSeconds: 4, fps: 29.97 })),
				transition: null
			}).durationSeconds,
			4
		);
	});

	it('takes the rate, orientation, and format from the Film', () => {
		const film = filmOf(makeState({ durationSeconds: 1, fps: 30 }), makeState({ fps: 30 }));
		film.fps = 60;
		film.orientation = 'vertical';
		film.format = 'prores';

		const plan = buildCompositionExportPlan({ film, transition: null });

		assert.equal(plan.fps, 60);
		assert.equal(plan.format, 'prores');
		assert.deepEqual(plan.size, { width: 2160, height: 3840 });
		assert.equal(plan.frameCount, 60 + 240);
	});

	it('is opaque only when every Scene is opaque', () => {
		const opaque = (): EngineState => makeState({ opaque: true, durationSeconds: 1 });
		const transparent = (): EngineState => makeState({ durationSeconds: 1 });
		const matrix: { scenes: EngineState[]; output: 'opaque' | 'transparent' }[] = [
			{ scenes: [opaque()], output: 'opaque' },
			{ scenes: [transparent()], output: 'transparent' },
			{ scenes: [opaque(), opaque()], output: 'opaque' },
			{ scenes: [opaque(), transparent()], output: 'transparent' },
			{ scenes: [transparent(), opaque()], output: 'transparent' },
			{ scenes: [transparent(), transparent()], output: 'transparent' },
			{ scenes: [opaque(), opaque(), opaque()], output: 'opaque' },
			{ scenes: [opaque(), transparent(), opaque()], output: 'transparent' }
		];

		for (const { scenes, output } of matrix) {
			const webm = buildCompositionExportPlan({ film: filmOf(...scenes), transition: null });
			assert.equal(webm.output, output);
			assert.equal(webm.codec, output === 'opaque' ? 'vp9-opaque' : 'vp9-alpha');
			assert.equal(
				webm.videoFilename,
				output === 'opaque' ? 'gfx-bumper.webm' : 'gfx-overlay.webm'
			);
			assert.equal(webm.wavFilename, output === 'opaque' ? 'gfx-bumper.wav' : 'gfx-overlay.wav');

			const proresFilm = filmOf(...scenes);
			proresFilm.format = 'prores';
			const prores = buildCompositionExportPlan({ film: proresFilm, transition: null });
			assert.equal(prores.output, output);
			assert.equal(prores.codec, 'prores-4444');
			assert.equal(
				prores.videoFilename,
				output === 'opaque' ? 'gfx-bumper.mov' : 'gfx-overlay.mov'
			);
		}
	});
});

describe('composition export frame sequence', () => {
	it('maps every frame index to the exact rational timestamp', () => {
		const plan = buildCompositionExportPlan({
			film: filmOf(makeState({ durationSeconds: 10.01, fps: 29.97 })),
			transition: null
		});

		assert.deepEqual(compositionExportFrameAt(plan, 0), { frame: 0, timestamp: 0 });
		assert.deepEqual(compositionExportFrameAt(plan, 299), {
			frame: 299,
			timestamp: (299 * 1001) / 30000
		});
		assert.throws(() => compositionExportFrameAt(plan, 300), RangeError);
	});
});

interface ExportControllerHarness {
	controller: CompositionExportController;
	dependencies: CompositionExportControllerDependencies;
	uiStates: CompositionExportUiState[];
	downloads: string[];
	downloadSignals: AbortSignal[];
	preparedFrames: Array<{ frame: number; timestamp: number }>;
	renderedTimestamps: number[];
	animationProgresses: number[];
	audioRequests: FilmAudioMixRenderRequest[];
	muxedAudio: (AudioBuffer | null | undefined)[];
	wavAudio: AudioBuffer[];
	/** The timestamp the encoder was given for each frame: Film time. */
	encodedTimestamps: number[];
	/** Every Scene the export asked its bracket to show, in order. */
	shownSceneIds: string[];
	/** What the export did to its animation and its bracket, in order. */
	sceneLog: string[];
	getBracketOpenCount(): number;
	getBracketCloseCount(): number;
	getDisposedManagerCount(): number;
	getFailureCount(): number;
}

function createHarness(options?: {
	state?: EngineState;
	film?: Film;
	showScene?: (sceneId: string) => Promise<void>;
	audio?: AudioBuffer | null;
	separateWav?: boolean;
	renderAudio?: (request: FilmAudioMixRenderRequest) => Promise<AudioBuffer | null>;
	exportWebM?: (options: TransparentVideoExportOptions) => Promise<VideoExportDownload>;
	downloadVideo?: (
		video: VideoExportDownload,
		filename: string,
		signal: AbortSignal
	) => Promise<number>;
}): ExportControllerHarness {
	const film = options?.film ?? filmOf(options?.state ?? makeState({ durationSeconds: 2, fps: 2 }));
	const shownSceneIds: string[] = [];
	const sceneLog: string[] = [];
	let bracketOpenCount = 0;
	let bracketCloseCount = 0;
	const uiStates: CompositionExportUiState[] = [];
	const downloads: string[] = [];
	const downloadSignals: AbortSignal[] = [];
	const preparedFrames: Array<{ frame: number; timestamp: number }> = [];
	const renderedTimestamps: number[] = [];
	const animationProgresses: number[] = [];
	const audioRequests: FilmAudioMixRenderRequest[] = [];
	const muxedAudio: (AudioBuffer | null | undefined)[] = [];
	const wavAudio: AudioBuffer[] = [];
	const encodedTimestamps: number[] = [];
	let disposedManagerCount = 0;
	let failureCount = 0;

	const defaultExport = async (
		exportOptions: TransparentVideoExportOptions
	): Promise<VideoExportDownload> => {
		muxedAudio.push(exportOptions.audio);
		const frameCount = exportOptions.frameCount ?? 0;
		for (let frame = 0; frame < frameCount; frame += 1) {
			const timestamp = exportOptions.timestampForFrame?.(frame) ?? -1;
			encodedTimestamps.push(timestamp);
			await exportOptions.renderFrame(frame, timestamp);
			exportOptions.onProgress?.((frame + 1) / frameCount);
		}
		return {
			transport: 'origin',
			downloadUrl: '/api/export/sessions/test/output',
			deliveryStatusUrl: '/api/export/sessions/test',
			cancelUrl: '/api/export/sessions/test'
		};
	};

	const services: CompositionExportControllerServices = {
		createAnimationManager: () => ({
			rebuild: () => {
				sceneLog.push('rebuild');
			},
			progress: (fraction) => animationProgresses.push(fraction),
			dispose: () => {
				sceneLog.push('dispose');
				disposedManagerCount += 1;
			}
		}),
		renderAudio: async (request) => {
			audioRequests.push(request);
			return options?.renderAudio ? options.renderAudio(request) : (options?.audio ?? null);
		},
		exportWebM: options?.exportWebM ?? defaultExport,
		exportProRes: defaultExport,
		downloadVideo: async (video, filename, signal) => {
			downloadSignals.push(signal);
			if (options?.downloadVideo) return options.downloadVideo(video, filename, signal);
			downloads.push(filename);
			return 4096;
		},
		downloadBlob: (_blob, filename) => downloads.push(filename),
		encodeWav: (audio) => {
			wavAudio.push(audio);
			return new Uint8Array([1, 2, 3]);
		},
		reportFailure: () => {
			failureCount += 1;
		}
	};

	const dependencies: CompositionExportControllerDependencies = {
		readFilm: () => film,
		readTransition: () => null,
		beginFilmExportBracket: () => {
			bracketOpenCount += 1;
			return {
				showScene: async (sceneId) => {
					shownSceneIds.push(sceneId);
					sceneLog.push(`show ${sceneId}`);
					await options?.showScene?.(sceneId);
				},
				close: async () => {
					sceneLog.push('close');
					bracketCloseCount += 1;
				}
			};
		},
		readCanvas: () => ({ width: 3840, height: 2160 }) as OffscreenCanvas,
		isFrameRendererReady: () => true,
		readSeparateWav: () => options?.separateWav ?? false,
		pauseTimeline: vi.fn(),
		buildAnimationManifest: () => ({ tweens: [] }),
		writeGlobalProgress: () => undefined,
		waitForCompositionResources: async () => undefined,
		flushDom: async () => undefined,
		settleCompositionPaint: async () => undefined,
		prepareCompositionFrame: async (frame, timestamp) => {
			preparedFrames.push({ frame, timestamp });
		},
		renderCompositionFrame: (timestamp) => {
			renderedTimestamps.push(timestamp);
			sceneLog.push(`render ${timestamp}`);
			return 'flat';
		},
		writeExportUiState: (next) => uiStates.push(next)
	};

	return {
		controller: new CompositionExportController(services),
		dependencies,
		uiStates,
		downloads,
		downloadSignals,
		preparedFrames,
		renderedTimestamps,
		animationProgresses,
		audioRequests,
		muxedAudio,
		wavAudio,
		encodedTimestamps,
		shownSceneIds,
		sceneLog,
		getBracketOpenCount: () => bracketOpenCount,
		getBracketCloseCount: () => bracketCloseCount,
		getDisposedManagerCount: () => disposedManagerCount,
		getFailureCount: () => failureCount
	};
}

describe('composition export controller lifecycle', () => {
	it('steps shared frames, reports progress, downloads video plus separate WAV, and cleans up', async () => {
		const audio = {} as AudioBuffer;
		const harness = createHarness({ audio, separateWav: true });

		await harness.controller.export(harness.dependencies);

		assert.deepEqual(harness.preparedFrames, [
			{ frame: 0, timestamp: 0 },
			{ frame: 1, timestamp: 0.5 },
			{ frame: 2, timestamp: 1 },
			{ frame: 3, timestamp: 1.5 }
		]);
		assert.deepEqual(harness.renderedTimestamps, [0, 0.5, 1, 1.5]);
		assert.deepEqual(harness.animationProgresses, [0, 0.25, 0.5, 0.75]);
		assert.deepEqual(harness.downloads, ['gfx-overlay.webm', 'gfx-overlay.wav']);
		assert.equal(harness.audioRequests.length, 1);
		assert.equal(harness.audioRequests[0].frameCount, 4);
		assert.deepEqual(harness.audioRequests[0].frameRate, { fps: 2, num: 2, den: 1 });
		assert.equal(harness.muxedAudio[0], audio);
		assert.equal(harness.wavAudio[0], audio);
		assert.deepEqual(harness.uiStates[0], { isExporting: true, progress: 0, status: '' });
		assert.deepEqual(
			harness.uiStates.filter((entry) => entry.isExporting).map((entry) => entry.progress),
			[0, 0.25, 0.5, 0.75, 1]
		);
		assert.equal(harness.uiStates.at(-1)?.isExporting, false);
		assert.equal(harness.getDisposedManagerCount(), 1);
		assert.equal(harness.getFailureCount(), 0);
	});

	it('passes the same final mix to ProRes and the separate WAV', async () => {
		const audio = {} as AudioBuffer;
		const harness = createHarness({
			state: makeState({ format: 'prores', durationSeconds: 1, fps: 1 }),
			audio,
			separateWav: true
		});

		await harness.controller.export(harness.dependencies);

		assert.equal(harness.muxedAudio[0], audio);
		assert.equal(harness.wavAudio[0], audio);
		assert.deepEqual(harness.downloads, ['gfx-overlay.mov', 'gfx-overlay.wav']);
	});

	it('publishes an encoder failure and releases the animation manager', async () => {
		const harness = createHarness({
			exportWebM: async () => {
				throw new Error('encoder failed');
			}
		});

		await harness.controller.export(harness.dependencies);

		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.uiStates.at(-1)?.isExporting, false);
		assert.equal(harness.uiStates.at(-1)?.status, 'encoder failed');
		assert.equal(harness.getDisposedManagerCount(), 1);
		assert.equal(harness.getFailureCount(), 1);
	});

	it('stops before render when asynchronous frame preparation fails', async () => {
		const harness = createHarness();
		harness.dependencies.prepareCompositionFrame = async () => {
			throw new Error('source frame unavailable');
		};

		await harness.controller.export(harness.dependencies);

		assert.deepEqual(harness.renderedTimestamps, []);
		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.uiStates.at(-1)?.status, 'source frame unavailable');
		assert.equal(harness.uiStates.at(-1)?.isExporting, false);
		assert.equal(harness.getDisposedManagerCount(), 1);
		assert.equal(harness.getFailureCount(), 1);
	});

	it('waits for resources before manifest construction and settles each paint before render', async () => {
		const calls: string[] = [];
		const harness = createHarness({ state: makeState({ durationSeconds: 1, fps: 1 }) });
		harness.dependencies.waitForCompositionResources = async () => {
			calls.push('resources');
		};
		harness.dependencies.buildAnimationManifest = () => {
			calls.push('manifest');
			return { tweens: [] };
		};
		harness.dependencies.flushDom = async () => {
			calls.push('flush');
		};
		harness.dependencies.settleCompositionPaint = async () => {
			calls.push('paint');
		};
		harness.dependencies.prepareCompositionFrame = async () => {
			calls.push('prepare');
		};
		harness.dependencies.renderCompositionFrame = () => {
			calls.push('render');
			return 'flat';
		};

		await harness.controller.export(harness.dependencies);

		assert.deepEqual(calls, ['resources', 'manifest', 'flush', 'paint', 'prepare', 'render']);
	});

	it('aborts an active encoder without reporting failure or downloading partial output', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const harness = createHarness({
			exportWebM: async ({ signal }) => {
				markStarted();
				return new Promise<VideoExportDownload>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		});

		const pending = harness.controller.export(harness.dependencies);
		await started;
		harness.controller.cancel();
		await pending;

		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.uiStates.at(-1)?.isExporting, false);
		assert.equal(harness.uiStates.at(-1)?.status, '');
		assert.equal(harness.getDisposedManagerCount(), 1);
		assert.equal(harness.getFailureCount(), 0);
	});

	it('passes cancellation into audio rendering and never starts the encoder', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const harness = createHarness({
			renderAudio: async ({ signal }) => {
				markStarted();
				return new Promise<AudioBuffer | null>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		});

		const pending = harness.controller.export(harness.dependencies);
		await started;
		harness.controller.cancel();
		await pending;

		assert.equal(harness.audioRequests[0].signal?.aborted, true);
		assert.deepEqual(harness.muxedAudio, []);
		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.getFailureCount(), 0);
	});

	it('fails before allocation when the canvas is not at the orientation native size', async () => {
		const harness = createHarness();
		harness.dependencies.readCanvas = () => ({ width: 1920, height: 1080 }) as OffscreenCanvas;

		await harness.controller.export(harness.dependencies);

		assert.match(harness.uiStates.at(-1)?.status ?? '', /must be 3840x2160/);
		assert.equal(harness.getDisposedManagerCount(), 0);
	});
});

// The `delivery` family turns these outcomes into a receipt or a corrective
// refusal, so every way an export can end has to be distinguishable from the
// outside — never a bare resolution a caller would read as success.
describe('composition export outcome', () => {
	it('reports the delivered plan and the sidecar it also downloaded', async () => {
		const harness = createHarness({ audio: {} as AudioBuffer, separateWav: true });

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'delivered');
		if (outcome.status !== 'delivered') return;
		assert.equal(outcome.plan.videoFilename, 'gfx-overlay.webm');
		assert.equal(outcome.videoByteLength, 4096);
		assert.equal(outcome.wavFilename, 'gfx-overlay.wav');
	});

	it('hands the running export cancellation down into the download', async () => {
		const harness = createHarness();

		await harness.controller.export(harness.dependencies);

		assert.equal(harness.downloadSignals.length, 1);
		assert.equal(harness.downloadSignals[0].aborted, false);
	});

	it('reports a refused download as failed rather than a delivered file', async () => {
		const harness = createHarness({
			audio: {} as AudioBuffer,
			separateWav: true,
			downloadVideo: async () => {
				throw new Error('Export output is not ready.');
			}
		});

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'failed');
		assert.equal(outcome.status === 'failed' && outcome.message, 'Export output is not ready.');
		// The sidecar rides the same run, so a video nobody received ships no WAV.
		assert.deepEqual(harness.downloads, []);
	});

	it('reports a download the caller stopped as cancelled, with no receipt', async () => {
		let markDownloadStarted = (): void => undefined;
		const downloadStarted = new Promise<void>((resolve) => {
			markDownloadStarted = resolve;
		});
		const harness = createHarness({
			downloadVideo: async (_video, _filename, signal) => {
				markDownloadStarted();
				return new Promise<number>((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		});
		const caller = new AbortController();

		const pending = harness.controller.export(harness.dependencies, undefined, caller.signal);
		await downloadStarted;
		caller.abort();

		assert.equal((await pending).status, 'cancelled');
		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.getFailureCount(), 0);
	});

	it('reports no sidecar when the audio stayed inside the video', async () => {
		const harness = createHarness({ audio: {} as AudioBuffer });

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status === 'delivered' && outcome.wavFilename, null);
	});

	it('reports an encoder failure as failed, carrying the message', async () => {
		const harness = createHarness({
			exportWebM: async () => {
				throw new Error('encoder failed');
			}
		});

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'failed');
		assert.equal(outcome.status === 'failed' && outcome.message, 'encoder failed');
	});

	it('reports an unavailable stage separately from a failed encode', async () => {
		const harness = createHarness();
		harness.dependencies.isFrameRendererReady = () => false;

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'unavailable');
	});

	it('stops an in-flight export from the caller own signal and reports cancelled', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const harness = createHarness({
			exportWebM: async ({ signal }) => {
				markStarted();
				return new Promise<VideoExportDownload>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		});
		const caller = new AbortController();

		const pending = harness.controller.export(harness.dependencies, undefined, caller.signal);
		await started;
		caller.abort();

		assert.equal((await pending).status, 'cancelled');
		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.getFailureCount(), 0);
	});

	it('never starts an export whose caller has already withdrawn', async () => {
		const harness = createHarness();
		const caller = new AbortController();
		caller.abort();

		const outcome = await harness.controller.export(harness.dependencies, undefined, caller.signal);

		assert.equal(outcome.status, 'cancelled');
		assert.deepEqual(harness.uiStates, []);
	});

	it('reports a second concurrent export as busy rather than silently dropping it', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let releaseExport = (): void => undefined;
		const harness = createHarness({
			exportWebM: async () => {
				markStarted();
				await new Promise<void>((resolve) => {
					releaseExport = resolve;
				});
				return {
					transport: 'origin',
					downloadUrl: '/api/export/sessions/test/output',
					deliveryStatusUrl: '/api/export/sessions/test',
					cancelUrl: '/api/export/sessions/test'
				};
			}
		});

		const pending = harness.controller.export(harness.dependencies);
		await started;
		const second = await harness.controller.export(harness.dependencies);
		releaseExport();
		await pending;

		assert.equal(second.status, 'busy');
	});
});

describe('composition export of a Film of several Scenes', () => {
	// 2 frames, then 3 frames, at 2 fps: a cut after Film frame 1.
	function twoSceneFilm(): Film {
		return filmOf(
			makeState({ durationSeconds: 1, fps: 2 }),
			makeState({ durationSeconds: 1.5, fps: 2 })
		);
	}

	it('renders every Scene on its own clock and hands the encoder Film time', async () => {
		const harness = createHarness({ film: twoSceneFilm() });

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'delivered');
		assert.equal(outcome.status === 'delivered' && outcome.plan.frameCount, 5);
		assert.deepEqual(harness.encodedTimestamps, [0, 0.5, 1, 1.5, 2]);
		assert.deepEqual(harness.preparedFrames, [
			{ frame: 0, timestamp: 0 },
			{ frame: 1, timestamp: 0.5 },
			{ frame: 0, timestamp: 0 },
			{ frame: 1, timestamp: 0.5 },
			{ frame: 2, timestamp: 1 }
		]);
		assert.deepEqual(harness.renderedTimestamps, [0, 0.5, 0, 0.5, 1]);
		assert.deepEqual(harness.animationProgresses, [0, 0.5, 0, 0.5 / 1.5, 1 / 1.5]);
		assert.deepEqual(
			harness.uiStates.filter((entry) => entry.isExporting).map((entry) => entry.progress),
			[0, 0.2, 0.4, 0.6, 0.8, 1]
		);
	});

	it('awaits the Scene swap and rebuilds its animation before the first frame of each Scene', async () => {
		const harness = createHarness({ film: twoSceneFilm() });

		await harness.controller.export(harness.dependencies);

		assert.deepEqual(harness.shownSceneIds, ['scene-1', 'scene-2']);
		assert.deepEqual(harness.sceneLog, [
			'show scene-1',
			'rebuild',
			'render 0',
			'render 0.5',
			'show scene-2',
			'rebuild',
			'render 0',
			'render 0.5',
			'render 1',
			'dispose',
			'close'
		]);
	});

	it('does not scrub a Scene until its swap has settled', async () => {
		let releaseSwap = (): void => undefined;
		let markSwapStarted = (): void => undefined;
		const swapStarted = new Promise<void>((resolve) => {
			markSwapStarted = resolve;
		});
		const harness = createHarness({
			film: twoSceneFilm(),
			showScene: (sceneId) => {
				if (sceneId !== 'scene-2') return Promise.resolve();
				markSwapStarted();
				return new Promise<void>((resolve) => {
					releaseSwap = resolve;
				});
			}
		});

		const pending = harness.controller.export(harness.dependencies);
		await swapStarted;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		assert.deepEqual(harness.renderedTimestamps, [0, 0.5]);
		releaseSwap();
		await pending;
		assert.deepEqual(harness.renderedTimestamps, [0, 0.5, 0, 0.5, 1]);
	});

	it('mixes one track for the Film, each Scene placed on its Film frames', async () => {
		const film = twoSceneFilm();
		const harness = createHarness({ film });

		await harness.controller.export(harness.dependencies);

		assert.equal(harness.audioRequests.length, 1);
		assert.equal(harness.audioRequests[0].frameCount, 5);
		assert.deepEqual(harness.audioRequests[0].frameRate, { fps: 2, num: 2, den: 1 });
		assert.deepEqual(
			harness.audioRequests[0].scenes.map(({ startFrame, frameCount }) => ({
				startFrame,
				frameCount
			})),
			[
				{ startFrame: 0, frameCount: 2 },
				{ startFrame: 2, frameCount: 3 }
			]
		);
		assert.equal(harness.audioRequests[0].scenes[0].state, film.scenes[0].state);
		assert.equal(harness.audioRequests[0].scenes[1].state, film.scenes[1].state);
	});

	it('passes the Film classification to the WebM lane', async () => {
		const hasBackground: (boolean | undefined)[] = [];
		const recordLane = async (
			exportOptions: TransparentVideoExportOptions
		): Promise<VideoExportDownload> => {
			hasBackground.push(exportOptions.hasBackground);
			return {
				transport: 'origin',
				downloadUrl: '/api/export/sessions/test/output',
				deliveryStatusUrl: '/api/export/sessions/test',
				cancelUrl: '/api/export/sessions/test'
			};
		};
		const mixed = createHarness({
			film: filmOf(
				makeState({ durationSeconds: 1, fps: 2, opaque: true }),
				makeState({ durationSeconds: 1, fps: 2 })
			),
			exportWebM: recordLane
		});
		const opaque = createHarness({
			film: filmOf(
				makeState({ durationSeconds: 1, fps: 2, opaque: true }),
				makeState({ durationSeconds: 1, fps: 2, opaque: true })
			),
			exportWebM: recordLane
		});

		await mixed.controller.export(mixed.dependencies);
		await opaque.controller.export(opaque.dependencies);

		assert.deepEqual(hasBackground, [false, true]);
		assert.deepEqual(mixed.downloads, ['gfx-overlay.webm']);
		assert.deepEqual(opaque.downloads, ['gfx-bumper.webm']);
	});
});

describe('composition export bracket', () => {
	function twoSceneFilm(): Film {
		return filmOf(
			makeState({ durationSeconds: 1, fps: 2 }),
			makeState({ durationSeconds: 1.5, fps: 2 })
		);
	}

	it('opens one bracket and closes it after a delivered export', async () => {
		const harness = createHarness({ film: twoSceneFilm() });

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'delivered');
		assert.equal(harness.getBracketOpenCount(), 1);
		assert.equal(harness.getBracketCloseCount(), 1);
		// The Workspace is given back before the export reports it is over.
		assert.equal(harness.sceneLog.at(-1), 'close');
		assert.equal(harness.uiStates.at(-1)?.isExporting, false);
	});

	it('closes the bracket when a frame fails part-way through the second Scene', async () => {
		const harness = createHarness({ film: twoSceneFilm() });
		let renders = 0;
		harness.dependencies.renderCompositionFrame = () => {
			renders += 1;
			return renders === 4 ? 'unavailable' : 'flat';
		};

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'failed');
		assert.deepEqual(harness.shownSceneIds, ['scene-1', 'scene-2']);
		assert.equal(harness.getBracketCloseCount(), 1);
		assert.deepEqual(harness.downloads, []);
	});

	it('closes the bracket when a Scene swap fails', async () => {
		const harness = createHarness({
			film: twoSceneFilm(),
			showScene: async (sceneId) => {
				if (sceneId === 'scene-2') throw new Error('Composition root is unavailable.');
			}
		});

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'failed');
		assert.equal(
			outcome.status === 'failed' && outcome.message,
			'Composition root is unavailable.'
		);
		assert.deepEqual(harness.renderedTimestamps, [0, 0.5]);
		assert.equal(harness.getBracketCloseCount(), 1);
	});

	it('closes the bracket when the export is cancelled mid-Film', async () => {
		const harness = createHarness({ film: twoSceneFilm() });
		harness.dependencies.prepareCompositionFrame = async () => {
			if (harness.shownSceneIds.length === 2) harness.controller.cancel();
		};

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'cancelled');
		assert.equal(harness.getBracketCloseCount(), 1);
		assert.deepEqual(harness.downloads, []);
		assert.equal(harness.getFailureCount(), 0);
	});

	it('closes the bracket when the audio mix is cancelled before a frame renders', async () => {
		let markStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const harness = createHarness({
			film: twoSceneFilm(),
			renderAudio: async ({ signal }) => {
				markStarted();
				return new Promise<AudioBuffer | null>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		});

		const pending = harness.controller.export(harness.dependencies);
		await started;
		harness.controller.cancel();

		assert.equal((await pending).status, 'cancelled');
		assert.equal(harness.getBracketCloseCount(), 1);
	});

	it('keeps the export outcome when putting the Workspace back fails, and reports it', async () => {
		const harness = createHarness({ film: twoSceneFilm() });
		const beginFilmExportBracket = harness.dependencies.beginFilmExportBracket;
		harness.dependencies.beginFilmExportBracket = () => ({
			...beginFilmExportBracket(),
			close: () => Promise.reject(new Error('Composition root is unavailable.'))
		});

		const outcome = await harness.controller.export(harness.dependencies);

		assert.equal(outcome.status, 'delivered');
		assert.equal(harness.getFailureCount(), 1);
		assert.equal(harness.uiStates.at(-1)?.isExporting, false);
	});

	it('opens no bracket for an export that never starts', async () => {
		const harness = createHarness();
		harness.dependencies.isFrameRendererReady = () => false;

		await harness.controller.export(harness.dependencies);

		assert.equal(harness.getBracketOpenCount(), 0);
	});
});
