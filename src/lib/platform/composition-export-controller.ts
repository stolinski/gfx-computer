import * as Sentry from '@sentry/sveltekit';

import { audioBufferToWavBytes } from '$lib/utils/audio-wav';
import { framesToSeconds, resolveFrameRate, type FrameRate } from '$lib/utils/composition-timing';
import { isEngineStateOpaque } from '$lib/utils/output-classification';
import { getVideoFrameSize, type VideoFrameSize } from '$lib/utils/video-frame';

import { AnimationManager, type AnimationManifest } from './animation-manager';
import {
	renderFilmAudioMix,
	type FilmAudioMixRenderRequest,
	type FilmAudioMixScene
} from './audio-mix';
import { exportWebMInBrowser } from './browser-webm-export';
import {
	isCompositionExportFormatAvailable,
	unavailableCompositionExportFormatMessage
} from './composition-export-formats';
import type { CompositionFrameRenderResult } from './composition-frame-renderer';
import { renderFilmBoundaryFrame, type FilmBoundaryFrameSurface } from './film-boundary-frame';
import {
	filmBoundaryWindowProgress,
	filmFrameCount,
	filmSceneBoundaryOverlaps,
	filmSceneFrameCount,
	filmSceneFrameOffsets
} from './film-playhead';
import {
	createFilmSceneFrameStepper,
	type FilmSceneFrameStepperDependencies
} from './film-scene-frame-stepper';
import type { Film, FilmSceneWindowBoundary } from './film-schema';
import { filmDurationSeconds } from './film-transport';
import { IS_HOSTED_ORIGIN } from './hosted-origin';
import {
	filmVideoTrackExportSentryContext,
	videoTrackExportSentryTags
} from './video-track-export-sentry';
import {
	downloadBlob,
	downloadVideoExport,
	exportTransparentProRes,
	exportTransparentWebM,
	type SyncExportRequest,
	type TransparentVideoExportOptions,
	type VideoExportDownload
} from './export-video';

export type CompositionExportCodec = 'vp9-alpha' | 'vp9-opaque' | 'prores-4444';
export type CompositionOutputClassification = 'transparent' | 'opaque';

export interface CompositionExportFrame {
	frame: number;
	timestamp: number;
}

/** Where one Scene of the Film sits in the export, and the clock it is scrubbed on. */
export interface CompositionExportScene {
	sceneId: string;
	/** The Film frame the Scene's frame 0 is rendered as. */
	startFrame: number;
	/** How many Film frames the Scene fills. */
	frameCount: number;
	/** The Scene's own `transport.durationSeconds`: what its 0..1 progress divides by. */
	durationSeconds: number;
}

/** One Film frame resolved to the Scene that renders it. */
export interface CompositionExportSceneFrame {
	sceneIndex: number;
	scene: CompositionExportScene;
	/** Frame inside the Scene, `0` to `scene.frameCount - 1`. */
	frame: number;
	/** Exact Scene time of `frame`, in seconds at the Film's rate. */
	timestamp: number;
}

/**
 * One boundary window of the Film: the Film frames two neighbouring Scenes
 * share, and the effect that composites them there.
 */
export interface CompositionExportBoundaryWindow {
	/** The Film's own boundary: a fade, or a transition effect with its params. */
	boundary: FilmSceneWindowBoundary;
	/** Index into `plan.scenes` of the outgoing Scene; the incoming one is the next. */
	outgoingSceneIndex: number;
	/** The first Film frame both Scenes are on: the incoming Scene's first frame. */
	startFrame: number;
	/** How many Film frames both Scenes are on. */
	frameCount: number;
}

/** One Film frame inside a boundary window, resolved to both Scenes that render it. */
export interface CompositionExportBoundaryFrame {
	window: CompositionExportBoundaryWindow;
	outgoing: CompositionExportSceneFrame;
	incoming: CompositionExportSceneFrame;
	/** `filmBoundaryWindowProgress` of this frame: 0 on the window's first frame, 1 on its last. */
	progress: number;
}

/**
 * The media contract of one export: the whole open Film
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §2, §9).
 * `frameCount`, `durationSeconds`, and the file names describe the Film. A
 * one-Scene Film's plan is the plan its Scene had as a lone composition.
 */
export interface CompositionExportPlan {
	format: Film['format'];
	codec: CompositionExportCodec;
	output: CompositionOutputClassification;
	size: VideoFrameSize;
	/** Film time at the end of the last Scene (`filmDurationSeconds`). */
	durationSeconds: number;
	fps: number;
	frameRate: FrameRate;
	/** `filmFrameCount` of the Film. */
	frameCount: number;
	/** Every Scene in Film order, with the Film frames it fills. */
	scenes: readonly CompositionExportScene[];
	/** Every boundary window in Film order; empty for a Film of hard cuts. */
	boundaryWindows: readonly CompositionExportBoundaryWindow[];
	basename: 'gfx-overlay' | 'gfx-bumper';
	videoFilename: string;
	wavFilename: string;
	startTimecode?: string;
}

export interface CompositionExportUiState {
	isExporting: boolean;
	progress: number;
	status: string;
}

/**
 * What one export invocation really did. The GUI reads this as status text; the
 * `delivery` family turns it into a receipt or a corrective refusal, which is
 * why every way an export can end has its own case rather than collapsing into
 * "finished". A `delivered` outcome means the whole encoded file was delivered
 * to the browser — never that an encode was queued or a download was merely
 * started. For an origin-encoded export the origin is the witness: the browser
 * saves the file itself, and the origin says when it has sent every byte
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §7).
 */
export type CompositionExportOutcome =
	| {
			status: 'delivered';
			plan: CompositionExportPlan;
			/** Bytes delivered to the browser — the proof the download landed. */
			videoByteLength: number;
			/** The sidecar WAV filename, or null when audio stayed in the video. */
			wavFilename: string | null;
	  }
	| { status: 'busy' }
	| { status: 'unavailable'; message: string }
	| { status: 'cancelled' }
	| { status: 'failed'; message: string };

interface CompositionExportAnimationManager {
	rebuild(manifest: AnimationManifest): void;
	progress(fraction: number): void;
	dispose(): void;
}

/**
 * The export's hold on the open Film, as the controller uses it. The Workspace
 * supplies `beginOpenFilmExportBracket` (`./film-scene-selection.ts`), which
 * says what the hold guarantees.
 */
export interface CompositionExportFilmBracket {
	/** Make the Scene live and settled at its frame 0, without selecting it. */
	showScene(sceneId: string): Promise<void>;
	/** Put the Workspace back on the Scene and frame it was on. */
	close(): Promise<void>;
}

export interface CompositionExportControllerDependencies {
	/**
	 * The open Film, detached from live state. The export makes other Scenes
	 * live while it runs, so a Film that still pointed at engine state would
	 * change under the plan and the audio mix.
	 */
	readFilm(): Film;
	beginFilmExportBracket(): CompositionExportFilmBracket;
	readCanvas(): HTMLCanvasElement | OffscreenCanvas | null;
	isFrameRendererReady(): boolean;
	readSeparateWav(): boolean;
	pauseTimeline(): void;
	buildAnimationManifest(): AnimationManifest;
	writeGlobalProgress(fraction: number): void;
	waitForCompositionResources(signal: AbortSignal): Promise<void>;
	flushDom(): Promise<void>;
	settleCompositionPaint(signal: AbortSignal): Promise<void>;
	prepareCompositionFrame(frame: number, timestamp: number): Promise<void>;
	/**
	 * The two Scene targets and the composite of a boundary window frame, made
	 * ready for the export canvas. Asked for once, and only by a Film that has a
	 * boundary window.
	 */
	prepareFilmBoundaryFrameSurface(): FilmBoundaryFrameSurface;
	/** The canvas's current texture: where a finished Film frame is rendered for the encoder. */
	readCanvasOutputView(): GPUTextureView;
	renderCompositionFrame(
		outputView: GPUTextureView,
		timestamp: number
	): CompositionFrameRenderResult;
	/** The stepper's `setSoloOverlayIds`: the Overlays a magic move captures alone (ADR-0068 §5). */
	setSoloOverlayIds: FilmSceneFrameStepperDependencies['setSoloOverlayIds'];
	/** The stepper's `captureSoloOverlay`. */
	captureSoloOverlay: FilmSceneFrameStepperDependencies['captureSoloOverlay'];
	writeExportUiState(state: CompositionExportUiState): void;
}

export interface CompositionExportControllerServices {
	createAnimationManager(): CompositionExportAnimationManager;
	renderAudio(request: FilmAudioMixRenderRequest): Promise<AudioBuffer | null>;
	exportWebM(options: TransparentVideoExportOptions): Promise<VideoExportDownload>;
	exportProRes(options: TransparentVideoExportOptions): Promise<VideoExportDownload>;
	/** Resolves with the delivered byte count once the whole file was delivered. */
	downloadVideo(video: VideoExportDownload, filename: string, signal: AbortSignal): Promise<number>;
	downloadBlob(blob: Blob, filename: string): void;
	encodeWav(audio: AudioBuffer): Uint8Array;
	reportFailure(message: string, error: unknown): void;
}

// The hosted origin has no encoder, so its WebM lane is the browser's and its
// ProRes lane does not exist; `buildCompositionExportPlan` refuses the format
// before this seam is reached, and the seam refuses again rather than reaching
// for a transport the origin answers 404 for.
const DEFAULT_SERVICES: CompositionExportControllerServices = {
	createAnimationManager: () => new AnimationManager(),
	renderAudio: renderFilmAudioMix,
	exportWebM: IS_HOSTED_ORIGIN ? exportWebMInBrowser : exportTransparentWebM,
	exportProRes: IS_HOSTED_ORIGIN
		? () => Promise.reject(new Error(unavailableCompositionExportFormatMessage('prores')))
		: exportTransparentProRes,
	downloadVideo: downloadVideoExport,
	downloadBlob,
	encodeWav: audioBufferToWavBytes,
	reportFailure: (message, error) => console.error(message, error)
};

function compositionExportErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unable to export overlay.';
}

function isCompositionExportCancellation(error: unknown, signal: AbortSignal): boolean {
	return signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
}

function assertNativeCanvasSize(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	size: VideoFrameSize
): void {
	if (canvas.width !== size.width || canvas.height !== size.height) {
		throw new Error(
			`Export canvas must be ${size.width}x${size.height}, got ${canvas.width}x${canvas.height}.`
		);
	}
}

/**
 * Resolve the immutable media contract used by one export invocation: the whole
 * Film, every Scene in order.
 *
 * Output is opaque only when every Scene is: a Film with one transparent Scene
 * is a transparent file, and an opaque Scene paints its fill inside it.
 */
export function buildCompositionExportPlan(options: {
	film: Film;
	request?: SyncExportRequest;
}): CompositionExportPlan {
	const { film, request } = options;
	const { fps, format, orientation } = film;
	if (!isCompositionExportFormatAvailable(format)) {
		throw new Error(unavailableCompositionExportFormatMessage(format));
	}
	if (request?.startTimecode && format !== 'prores') {
		throw new Error('A start timecode requires the ProRes format.');
	}

	const frameRate = resolveFrameRate(fps);
	const sceneStartFrames = filmSceneFrameOffsets(film);
	const scenes = film.scenes.map((scene, sceneIndex): CompositionExportScene => ({
		sceneId: scene.id,
		startFrame: sceneStartFrames[sceneIndex],
		frameCount: filmSceneFrameCount(scene, frameRate),
		durationSeconds: scene.state.transport.durationSeconds
	}));
	const boundaryWindows: CompositionExportBoundaryWindow[] = [];
	for (const [boundaryIndex, overlapFrames] of filmSceneBoundaryOverlaps(film).entries()) {
		const boundary = film.boundaries[boundaryIndex];
		if (boundary.kind === 'cut' || overlapFrames === 0) continue;
		boundaryWindows.push({
			boundary,
			outgoingSceneIndex: boundaryIndex,
			startFrame: sceneStartFrames[boundaryIndex + 1],
			frameCount: overlapFrames
		});
	}
	const isOpaque = film.scenes.every((scene) => isEngineStateOpaque(scene.state));
	const output: CompositionOutputClassification = isOpaque ? 'opaque' : 'transparent';
	const basename = isOpaque ? 'gfx-bumper' : 'gfx-overlay';
	const extension = format === 'prores' ? 'mov' : 'webm';
	const codec: CompositionExportCodec =
		format === 'prores' ? 'prores-4444' : isOpaque ? 'vp9-opaque' : 'vp9-alpha';

	return {
		format,
		codec,
		output,
		size: getVideoFrameSize(orientation),
		durationSeconds: filmDurationSeconds(film),
		fps,
		frameRate,
		frameCount: filmFrameCount(film),
		scenes,
		boundaryWindows,
		basename,
		videoFilename: request?.filename ?? `${basename}.${extension}`,
		wavFilename: `${basename}.wav`,
		startTimecode: request?.startTimecode
	};
}

/** Exact rational Film frame index → Film timestamp mapping for preview/export parity. */
export function compositionExportFrameAt(
	plan: Pick<CompositionExportPlan, 'frameCount' | 'frameRate'>,
	frame: number
): CompositionExportFrame {
	if (!Number.isInteger(frame) || frame < 0 || frame >= plan.frameCount) {
		throw new RangeError(`Export frame ${frame} is outside 0..${plan.frameCount - 1}.`);
	}
	return { frame, timestamp: framesToSeconds(frame, plan.frameRate) };
}

function compositionExportSceneFrameOf(
	plan: Pick<CompositionExportPlan, 'frameRate' | 'scenes'>,
	sceneIndex: number,
	frame: number
): CompositionExportSceneFrame {
	const scene = plan.scenes[sceneIndex];
	const sceneFrame = frame - scene.startFrame;
	return {
		sceneIndex,
		scene,
		frame: sceneFrame,
		timestamp: framesToSeconds(sceneFrame, plan.frameRate)
	};
}

/**
 * The Scene that renders one Film frame, and the Scene frame and Scene time it
 * is scrubbed to. A frame belongs to the first Scene that has not ended by
 * then, the rule `resolveFilmFrame` uses, so export and the Film transport
 * agree on which Scene owns every frame. Inside a boundary window that is the
 * outgoing Scene, and `compositionExportBoundaryFrameAt` gives both.
 */
export function compositionExportSceneFrameAt(
	plan: Pick<CompositionExportPlan, 'frameCount' | 'frameRate' | 'scenes'>,
	frame: number
): CompositionExportSceneFrame {
	if (!Number.isInteger(frame) || frame < 0 || frame >= plan.frameCount) {
		throw new RangeError(`Export frame ${frame} is outside 0..${plan.frameCount - 1}.`);
	}
	let sceneIndex = 0;
	while (plan.scenes[sceneIndex].startFrame + plan.scenes[sceneIndex].frameCount <= frame) {
		sceneIndex += 1;
	}
	return compositionExportSceneFrameOf(plan, sceneIndex, frame);
}

/**
 * Both Scenes that render one Film frame inside a boundary window, each with
 * its own Scene frame and Scene time, and the window's progress there; `null`
 * for a frame one Scene renders alone. `resolveFilmBoundaryWindowFrame` is the
 * same rule on the Film.
 */
export function compositionExportBoundaryFrameAt(
	plan: Pick<CompositionExportPlan, 'frameCount' | 'frameRate' | 'scenes' | 'boundaryWindows'>,
	frame: number
): CompositionExportBoundaryFrame | null {
	if (!Number.isInteger(frame) || frame < 0 || frame >= plan.frameCount) {
		throw new RangeError(`Export frame ${frame} is outside 0..${plan.frameCount - 1}.`);
	}
	const window = plan.boundaryWindows.find(
		(candidate) =>
			frame >= candidate.startFrame && frame < candidate.startFrame + candidate.frameCount
	);
	if (!window) return null;
	return {
		window,
		outgoing: compositionExportSceneFrameOf(plan, window.outgoingSceneIndex, frame),
		incoming: compositionExportSceneFrameOf(plan, window.outgoingSceneIndex + 1, frame),
		progress: filmBoundaryWindowProgress(frame - window.startFrame, window.frameCount)
	};
}

/**
 * Every Scene of the Film as the one mix places it: where it starts, how long
 * it runs, and the frames of the boundary windows it opens and closes in, which
 * its sound fades across with the picture.
 */
export function compositionExportAudioMixScenes(
	film: Film,
	plan: Pick<CompositionExportPlan, 'scenes' | 'boundaryWindows'>
): FilmAudioMixScene[] {
	const windowFrameCountAfterScene = (sceneIndex: number): number =>
		plan.boundaryWindows.find((window) => window.outgoingSceneIndex === sceneIndex)?.frameCount ??
		0;
	return film.scenes.map((scene, sceneIndex) => ({
		state: scene.state,
		startFrame: plan.scenes[sceneIndex].startFrame,
		frameCount: plan.scenes[sceneIndex].frameCount,
		leadingWindowFrameCount: sceneIndex > 0 ? windowFrameCountAfterScene(sceneIndex - 1) : 0,
		trailingWindowFrameCount: windowFrameCountAfterScene(sceneIndex)
	}));
}

/**
 * Owns one export operation at a time. Workspace remains the composition root:
 * it supplies live Svelte/DOM/GPU callbacks, while this controller owns media
 * planning, deterministic stepping, audio/video handoff, state, and cleanup.
 */
export class CompositionExportController {
	readonly #services: CompositionExportControllerServices;
	#activeAbortController: AbortController | null = null;
	#uiState: CompositionExportUiState = { isExporting: false, progress: 0, status: '' };
	#isDisposed = false;

	constructor(services: CompositionExportControllerServices = DEFAULT_SERVICES) {
		this.#services = services;
	}

	async export(
		dependencies: CompositionExportControllerDependencies,
		request?: SyncExportRequest,
		externalSignal?: AbortSignal
	): Promise<CompositionExportOutcome> {
		if (this.#isDisposed || this.#activeAbortController) {
			return { status: 'busy' };
		}
		if (externalSignal?.aborted) {
			return { status: 'cancelled' };
		}

		const canvas = dependencies.readCanvas();
		if (!canvas || !dependencies.isFrameRendererReady()) {
			this.#publish(dependencies, { status: 'Stage is unavailable.' });
			return { status: 'unavailable', message: 'Stage is unavailable.' };
		}

		let film: Film;
		let plan: CompositionExportPlan;
		try {
			film = dependencies.readFilm();
			plan = buildCompositionExportPlan({ film, request });
			assertNativeCanvasSize(canvas, plan.size);
		} catch (error) {
			const message = compositionExportErrorMessage(error);
			this.#publish(dependencies, { status: message });
			return { status: 'unavailable', message };
		}

		const abortController = new AbortController();
		const { signal } = abortController;
		// A caller's own signal cancels the same run the Export button cancels;
		// there is one export at a time and one way to stop it.
		const relayExternalAbort = (): void => abortController.abort();
		externalSignal?.addEventListener('abort', relayExternalAbort, { once: true });
		this.#activeAbortController = abortController;
		const animationManager = this.#services.createAnimationManager();

		dependencies.pauseTimeline();
		this.#publish(dependencies, { isExporting: true, progress: 0, status: '' });

		// Opened inside the `try`, so whatever happens next the `finally` puts the
		// author's Scene and frame back.
		let filmBracket: CompositionExportFilmBracket | null = null;
		try {
			const activeFilmBracket = dependencies.beginFilmExportBracket();
			filmBracket = activeFilmBracket;
			// Every frame is rendered by the Scene frame stepper. A cut is exact
			// because the stepper awaits the swap: the incoming Scene is live, its
			// resources are in, and its animation is rebuilt before its first frame
			// is scrubbed.
			const sceneFrameStepper = createFilmSceneFrameStepper({
				scenes: plan.scenes,
				frameRate: plan.frameRate,
				animation: animationManager,
				showScene: (sceneId) => activeFilmBracket.showScene(sceneId),
				waitForCompositionResources: dependencies.waitForCompositionResources,
				buildAnimationManifest: dependencies.buildAnimationManifest,
				writeGlobalProgress: dependencies.writeGlobalProgress,
				flushDom: dependencies.flushDom,
				settleCompositionPaint: dependencies.settleCompositionPaint,
				prepareCompositionFrame: dependencies.prepareCompositionFrame,
				renderCompositionFrame: dependencies.renderCompositionFrame,
				setSoloOverlayIds: dependencies.setSoloOverlayIds,
				captureSoloOverlay: dependencies.captureSoloOverlay
			});

			await sceneFrameStepper.showScene(plan.scenes[0].sceneId, signal);
			const audio = await this.#services.renderAudio({
				scenes: compositionExportAudioMixScenes(film, plan),
				frameCount: plan.frameCount,
				frameRate: plan.frameRate,
				signal
			});
			signal.throwIfAborted();

			// Made on the first boundary window frame, so a Film of hard cuts
			// allocates no Scene targets.
			let boundaryFrameSurface: FilmBoundaryFrameSurface | null = null;
			const renderFrame: TransparentVideoExportOptions['renderFrame'] = async (frame) => {
				signal.throwIfAborted();
				const boundaryFrame = compositionExportBoundaryFrameAt(plan, frame);
				if (boundaryFrame === null) {
					const sceneFrame = compositionExportSceneFrameAt(plan, frame);
					await sceneFrameStepper.renderSceneFrame({
						sceneId: sceneFrame.scene.sceneId,
						sceneFrame: sceneFrame.frame,
						readOutputView: dependencies.readCanvasOutputView,
						signal
					});
					return;
				}
				// Inside a window both Scenes are live on the frame: each is stepped
				// to its own Scene frame and rendered into its own target, then the
				// boundary's effect composites the two into the canvas.
				boundaryFrameSurface ??= dependencies.prepareFilmBoundaryFrameSurface();
				await renderFilmBoundaryFrame({
					stepper: sceneFrameStepper,
					surface: boundaryFrameSurface,
					boundary: boundaryFrame.window.boundary,
					outgoing: {
						sceneId: boundaryFrame.outgoing.scene.sceneId,
						sceneFrame: boundaryFrame.outgoing.frame
					},
					incoming: {
						sceneId: boundaryFrame.incoming.scene.sceneId,
						sceneFrame: boundaryFrame.incoming.frame
					},
					progress: boundaryFrame.progress,
					readOutputView: dependencies.readCanvasOutputView,
					signal
				});
			};

			const exportOptions: TransparentVideoExportOptions = {
				canvas,
				durationSeconds: plan.durationSeconds,
				fps: plan.fps,
				frameCount: plan.frameCount,
				timestampForFrame: (frame) => compositionExportFrameAt(plan, frame).timestamp,
				onProgress: (progress) => {
					if (!signal.aborted) this.#publish(dependencies, { progress });
				},
				renderFrame,
				audio,
				signal
			};

			const videoTrackContext = filmVideoTrackExportSentryContext(film);
			const video = await Sentry.withScope(async (scope) => {
				scope.setTags(videoTrackExportSentryTags(videoTrackContext));
				scope.setContext('media_video_track', videoTrackContext);
				return plan.format === 'prores'
					? this.#services.exportProRes({
							...exportOptions,
							startTimecode: plan.startTimecode
						})
					: this.#services.exportWebM({
							...exportOptions,
							hasBackground: plan.output === 'opaque'
						});
			});
			signal.throwIfAborted();
			// The receipt below is only reachable once this resolves, so a download
			// that never completed cannot be reported as a delivered file.
			const videoByteLength = await this.#services.downloadVideo(video, plan.videoFilename, signal);

			let wavFilename: string | null = null;
			if (dependencies.readSeparateWav() && audio) {
				signal.throwIfAborted();
				const wavBytes = new Uint8Array(this.#services.encodeWav(audio));
				this.#services.downloadBlob(new Blob([wavBytes], { type: 'audio/wav' }), plan.wavFilename);
				wavFilename = plan.wavFilename;
			}
			return { status: 'delivered', plan, videoByteLength, wavFilename };
		} catch (error) {
			if (isCompositionExportCancellation(error, signal)) {
				return { status: 'cancelled' };
			}
			const message = compositionExportErrorMessage(error);
			this.#services.reportFailure('Unable to export overlay.', error);
			this.#publish(dependencies, { status: message });
			return { status: 'failed', message };
		} finally {
			externalSignal?.removeEventListener('abort', relayExternalAbort);
			animationManager.dispose();
			// After the export's own animation is gone, so the Scene the bracket
			// settles back is driven by the Workspace's alone. A restore that fails
			// is reported; it never replaces the outcome the export already has.
			await filmBracket?.close().catch((error: unknown) => {
				this.#services.reportFailure('Unable to restore the Workspace after export.', error);
			});
			if (this.#activeAbortController === abortController) {
				this.#activeAbortController = null;
			}
			this.#publish(dependencies, { isExporting: false });
		}
	}

	cancel(): void {
		this.#activeAbortController?.abort();
	}

	dispose(): void {
		if (this.#isDisposed) return;
		this.#isDisposed = true;
		this.cancel();
	}

	#publish(
		dependencies: CompositionExportControllerDependencies,
		patch: Partial<CompositionExportUiState>
	): void {
		this.#uiState = { ...this.#uiState, ...patch };
		dependencies.writeExportUiState({ ...this.#uiState });
	}
}
