/**
 * Deterministic offline audio mix (ADR-0033 §6). The export's audio track is
 * a pure function of {Video-clip PCM + derived motion cues + manual cues +
 * bed + exact export frame plan}: `planAudioMix` computes the cue schedule
 * (pure, node-testable) and `renderAudioMix` sums every input at fixed sample
 * positions. No wall-clock participates, so the same composition renders a
 * byte-identical buffer every run. Preview uses this exact mix whenever
 * Video-clip audio participates; cue-only preview retains its low-latency scheduler.
 *
 * An export mixes the whole Film (`renderFilmAudioMix`,
 * [ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §6):
 * every Scene's own schedule, placed at the sample its Scene starts on and cut
 * at the sample its Scene ends on, summed Scene by Scene into one buffer. Two
 * Scenes that share a boundary window overlap in the buffer by that window, and
 * sound fades with the picture there: the outgoing Scene fades out across the
 * window and the incoming Scene fades in, on an equal-power curve
 * (`filmAudioMixSceneWindowGain`).
 */
import type { FrameRate } from '$lib/utils/composition-timing';
import { isEngineStateOpaque } from '$lib/utils/output-classification';
import { resolveVideoClipInterval } from '$lib/utils/video-clip-resolution';

import { loadSoundBuffer } from './audio-assets';
import type { EngineState, VideoAsset } from './engine-schema';
import { deriveSoundCues, isAudibleSoundCue, resolveCueSample } from './sound-cues.ts';
import { VideoAssetAudioDecoder, type VideoAssetAudioPcm } from './video-asset-audio-decoder';

/** Fixed mix rate — matches the bundled core WAVs; the muxer resamples if it must. */
export const AUDIO_MIX_SAMPLE_RATE = 48000;
export const AUDIO_MIX_CHANNELS = 2;

// Master headroom so stacked cues don't clip on encode.
const MASTER_GAIN = 0.8;
// Post-render ceiling: stacked cues can still sum past full scale, so the
// rendered buffer is peak-normalized down to this when it overshoots — a
// deterministic scale of every sample, preserving the mix balance.
const PEAK_CEILING = 0.98;
// Short release when a manual cue / bed window cuts a sample early — a hard
// stop mid-waveform clicks.
const RELEASE_SECONDS = 0.012;

export interface ScheduledSound {
	/** Bundled audio-asset slug to play. */
	slug: string;
	/** Absolute start, seconds from composition start. */
	when: number;
	/**
	 * Cap on played length in seconds — manual cues and the bed stop at their
	 * authored window. Derived one-shots play out naturally (null).
	 */
	windowSeconds: number | null;
	gain: number;
	source: 'derived' | 'manual' | 'bed';
	cueId: string;
}

/**
 * The full mix schedule, sorted by time: every audible derived cue resolved
 * through its per-motion override or the engine event default, plus every
 * manual cue and the bed from `audioCues[]`. Pure — this is the part of the §6
 * determinism contract that is checkable without Web Audio.
 */
export function planAudioMix(state: EngineState): ScheduledSound[] {
	const duration = state.transport.durationSeconds;
	const plan: ScheduledSound[] = [];
	const isBedEligible = isEngineStateOpaque(state);

	for (const cue of deriveSoundCues(state)) {
		if (!isAudibleSoundCue(cue)) {
			continue;
		}
		const slug = resolveCueSample(cue);
		if (slug === null) {
			continue;
		}
		plan.push({
			slug,
			when: cue.start * duration,
			windowSeconds: null,
			gain: 1,
			source: 'derived',
			cueId: cue.id
		});
	}

	for (const cue of state.audioCues) {
		if (cue.kind === 'bed' && !isBedEligible) continue;
		plan.push({
			slug: cue.assetSlug,
			when: cue.start * duration,
			windowSeconds: cue.duration * duration,
			gain: cue.volume ?? 1,
			source: cue.kind === 'bed' ? 'bed' : 'manual',
			cueId: cue.id
		});
	}

	return plan.sort((a, b) => a.when - b.when || a.cueId.localeCompare(b.cueId));
}

/**
 * Render the composition's audio into one AudioBuffer
 * (AUDIO_MIX_SAMPLE_RATE, stereo, exactly the whole-frame export duration). Returns
 * null when the composition schedules no sound — a silent piece must not
 * grow a silent audio track on export. Sounds whose asset slug is unknown
 * resolve to silence with a console.error (the boot gate catches engine-default
 * and signature samples; this guards authored asset typos).
 */
export interface AudioMixRenderRequest {
	state: EngineState;
	frameCount: number;
	frameRate: FrameRate;
	signal?: AbortSignal;
}

/** One Scene of a Film as the mix places it. */
export interface FilmAudioMixScene {
	state: EngineState;
	/**
	 * The Film frame the Scene starts on. After a boundary window this is the
	 * window's first frame, before the Scene ahead of it has ended.
	 */
	startFrame: number;
	/** How many Film frames the Scene fills. */
	frameCount: number;
	/**
	 * Frames of the boundary window the Scene opens in: its first frames, shared
	 * with the Scene before it. The Scene's sound fades in across them. 0 or
	 * absent after a cut and for the first Scene.
	 */
	leadingWindowFrameCount?: number;
	/**
	 * Frames of the boundary window the Scene closes in: its last frames, shared
	 * with the Scene after it. The Scene's sound fades out across them. 0 or
	 * absent before a cut and for the last Scene.
	 */
	trailingWindowFrameCount?: number;
}

/** The whole Film's mix: every Scene in Film order, over the Film's frame count. */
export interface FilmAudioMixRenderRequest {
	scenes: readonly FilmAudioMixScene[];
	/** Frames in the whole Film; the buffer is exactly this long. */
	frameCount: number;
	frameRate: FrameRate;
	signal?: AbortSignal;
}

export interface AudioMixServices {
	decodeVideoClipAudio(request: VideoClipAudioDecodeRequest): Promise<VideoAssetAudioPcm | null>;
	createCueDecodeContext(): BaseAudioContext;
	loadCueBuffer(slug: string, context: BaseAudioContext): Promise<AudioBuffer> | null;
	createOutputBuffer(options: AudioBufferOptions): AudioBuffer;
}

export interface VideoClipAudioDecodeRequest {
	asset: VideoAsset;
	sourceStartSeconds: number;
	sourceEndSeconds: number;
	outputSampleCount: number;
	signal?: AbortSignal;
}

const DEFAULT_AUDIO_MIX_SERVICES: AudioMixServices = {
	decodeVideoClipAudio: async (request) => {
		return new VideoAssetAudioDecoder(request.asset.assetUrl).decode({
			sourceStartSeconds: request.sourceStartSeconds,
			sourceEndSeconds: request.sourceEndSeconds,
			outputSampleCount: request.outputSampleCount,
			...(request.signal ? { signal: request.signal } : {})
		});
	},
	createCueDecodeContext: () =>
		new OfflineAudioContext(AUDIO_MIX_CHANNELS, 1, AUDIO_MIX_SAMPLE_RATE),
	loadCueBuffer: loadSoundBuffer,
	createOutputBuffer: (options) => new AudioBuffer(options)
};

/** Exact destination sample boundary for an absolute transport frame. */
export function audioMixSampleAtFrame(frame: number, frameRate: FrameRate): number {
	if (!Number.isInteger(frame) || frame < 0) {
		throw new TypeError('Audio mix frame must be a nonnegative integer.');
	}
	return Math.round((frame * frameRate.den * AUDIO_MIX_SAMPLE_RATE) / frameRate.num);
}

/** Exact 48 kHz sample count for a whole-frame export at an exact rational rate. */
export function audioMixSampleCount(frameCount: number, frameRate: FrameRate): number {
	if (!Number.isInteger(frameCount) || frameCount < 0) {
		throw new TypeError('Audio mix frame count must be a nonnegative integer.');
	}
	return audioMixSampleAtFrame(frameCount, frameRate);
}

export function hasAudibleVideoClipAudio(state: Pick<EngineState, 'media'>): boolean {
	return state.media.videoTrack.clips.some((clip) => clip.audio.enabled && clip.audio.gain > 0);
}

type MixChannels = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

function emptyMixChannels(outputSampleCount: number): MixChannels {
	return [new Float32Array(outputSampleCount), new Float32Array(outputSampleCount)];
}

function assertDecodedClipAudio(pcm: VideoAssetAudioPcm, expectedSampleCount: number): void {
	if (
		pcm.sampleRate !== AUDIO_MIX_SAMPLE_RATE ||
		pcm.channels.some((channel) => channel.length !== expectedSampleCount)
	) {
		throw new TypeError('Decoded Video clip audio does not match the deterministic mix format.');
	}
}

function scaleMixChannels(channels: MixChannels, gain: number): void {
	for (const channel of channels) {
		for (let sample = 0; sample < channel.length; sample += 1) {
			channel[sample] *= gain;
		}
	}
}

/**
 * The samples one Scene sounds over in the Film's buffer: from the sample its
 * first frame starts on to the sample its last frame ends on. Nothing a Scene
 * schedules is written outside this span, so a hard cut is hard for sound too.
 * The spans of two Scenes that share a boundary window overlap by the window,
 * and there both Scenes are summed, each under its window gain.
 */
interface FilmAudioMixSceneSpan {
	startSample: number;
	sampleCount: number;
	/** The Scene's fades, or `null` when it sits between two cuts. */
	windows: FilmAudioMixSceneWindows | null;
}

/**
 * The two boundary windows of one Scene, in samples counted from the Scene's
 * start sample. A side with no window has a count of 0.
 */
export interface FilmAudioMixSceneWindows {
	/** Samples of the leading window: `0` to this, the Scene fades in. */
	fadeInSampleCount: number;
	/** The first sample of the trailing window. */
	fadeOutStartSample: number;
	/** Samples of the trailing window: from `fadeOutStartSample`, the Scene fades out. */
	fadeOutSampleCount: number;
}

/**
 * The gain a Scene's sound takes at one of its samples because of its boundary
 * windows: 1 outside both, an equal-power fade-in across the leading window,
 * and an equal-power fade-out across the trailing one.
 *
 * With `t` the sample's position in its window, from 0 on the window's first
 * sample towards 1 at its end, the incoming Scene is multiplied by
 * `sin(t × π/2)` and the outgoing Scene by `cos(t × π/2)`. Both Scenes count
 * `t` on the same samples, so the two gains squared always sum to 1.
 *
 * Equal-power rather than linear: two Scenes' sounds are unrelated signals, so
 * their powers add, not their amplitudes. Linear gains of 0.5 and 0.5 at
 * mid-window carry half the power of either Scene alone, a dip of 3 dB that is
 * heard as the sound sagging through every boundary. The sine and cosine pair
 * holds the summed power level across the whole window.
 */
export function filmAudioMixSceneWindowGain(
	windows: FilmAudioMixSceneWindows,
	sceneSample: number
): number {
	let gain = 1;
	if (sceneSample < windows.fadeInSampleCount) {
		gain *= Math.sin((sceneSample / windows.fadeInSampleCount) * (Math.PI / 2));
	}
	if (windows.fadeOutSampleCount > 0 && sceneSample >= windows.fadeOutStartSample) {
		gain *= Math.cos(
			((sceneSample - windows.fadeOutStartSample) / windows.fadeOutSampleCount) * (Math.PI / 2)
		);
	}
	return gain;
}

function assertWindowFrameCount(frameCount: number, sceneFrameCount: number): void {
	if (!Number.isInteger(frameCount) || frameCount < 0 || frameCount > sceneFrameCount) {
		throw new TypeError(
			'An audio mix Scene window is a whole number of frames, no longer than its Scene.'
		);
	}
}

function filmAudioMixSceneSpan(
	scene: FilmAudioMixScene,
	frameRate: FrameRate,
	outputSampleCount: number
): FilmAudioMixSceneSpan {
	if (!Number.isInteger(scene.frameCount) || scene.frameCount < 1) {
		throw new TypeError('An audio mix Scene runs a positive whole number of frames.');
	}
	const startSample = audioMixSampleAtFrame(scene.startFrame, frameRate);
	const endSample = audioMixSampleAtFrame(scene.startFrame + scene.frameCount, frameRate);
	if (endSample > outputSampleCount) {
		throw new RangeError('An audio mix Scene extends beyond the Film the mix was asked for.');
	}
	const leadingWindowFrameCount = scene.leadingWindowFrameCount ?? 0;
	const trailingWindowFrameCount = scene.trailingWindowFrameCount ?? 0;
	assertWindowFrameCount(leadingWindowFrameCount, scene.frameCount);
	assertWindowFrameCount(trailingWindowFrameCount, scene.frameCount);
	if (leadingWindowFrameCount === 0 && trailingWindowFrameCount === 0) {
		return { startSample, sampleCount: endSample - startSample, windows: null };
	}
	// Window ends are Film frames turned into samples, the same way for both
	// Scenes of a window, so the two fades cover exactly the same samples.
	const fadeOutStartSample =
		audioMixSampleAtFrame(
			scene.startFrame + scene.frameCount - trailingWindowFrameCount,
			frameRate
		) - startSample;
	return {
		startSample,
		sampleCount: endSample - startSample,
		windows: {
			fadeInSampleCount:
				audioMixSampleAtFrame(scene.startFrame + leadingWindowFrameCount, frameRate) - startSample,
			fadeOutStartSample,
			fadeOutSampleCount: endSample - startSample - fadeOutStartSample
		}
	};
}

/**
 * Sum the first `sampleCount` samples of `pcm` at `destinationStartSample`.
 * `sceneStartSample` is where `pcm` starts inside its Scene, which is what the
 * Scene's window gain is read at.
 */
function sumPcmIntoMix(
	channels: MixChannels,
	pcm: VideoAssetAudioPcm,
	destinationStartSample: number,
	sampleCount: number,
	gain: number,
	windows: FilmAudioMixSceneWindows | null,
	sceneStartSample: number
): void {
	for (let channel = 0; channel < AUDIO_MIX_CHANNELS; channel += 1) {
		const output = channels[channel];
		const input = pcm.channels[channel];
		if (windows === null) {
			for (let sample = 0; sample < sampleCount; sample += 1) {
				output[destinationStartSample + sample] += input[sample] * gain;
			}
			continue;
		}
		for (let sample = 0; sample < sampleCount; sample += 1) {
			output[destinationStartSample + sample] +=
				input[sample] * gain * filmAudioMixSceneWindowGain(windows, sceneStartSample + sample);
		}
	}
}

/**
 * Decode every audible Video clip of one Scene and sum it into the mix, at the
 * Scene's start sample plus the clip's own sample inside the Scene. Returns the
 * mix channels, which this allocates on first use; `null` in and no audible
 * clip is `null` out. A clip covering the whole mix donates its decoded buffers
 * directly (no copy); anything else is summed at its exact destination sample.
 *
 * Clip samples are counted on the Scene's own frame grid, so a clip sounds the
 * same in a Film as in its Scene alone. At a fractional rate that count can run
 * one sample past the Scene's span in the Film; the span wins.
 */
async function mixSceneVideoClipAudio(
	channels: MixChannels | null,
	scene: FilmAudioMixScene,
	span: FilmAudioMixSceneSpan,
	frameRate: FrameRate,
	outputSampleCount: number,
	services: AudioMixServices,
	signal: AbortSignal | undefined
): Promise<MixChannels | null> {
	const { state } = scene;

	for (const clip of state.media.videoTrack.clips) {
		if (!clip.audio.enabled || clip.audio.gain === 0) continue;
		const asset = state.media.assets.find((candidate) => candidate.id === clip.assetId);
		if (!asset) {
			throw new Error(`Video clip "${clip.id}" references missing asset "${clip.assetId}".`);
		}
		const interval = resolveVideoClipInterval(clip, frameRate);
		if (interval.timelineEndFrame > scene.frameCount) {
			throw new RangeError(`Video clip "${clip.id}" extends beyond the audio mix transport.`);
		}
		const sceneStartSample = audioMixSampleAtFrame(interval.timelineStartFrame, frameRate);
		const sceneEndSample = audioMixSampleAtFrame(interval.timelineEndFrame, frameRate);
		const clipSampleCount = sceneEndSample - sceneStartSample;
		const clipPcm = await services.decodeVideoClipAudio({
			asset,
			sourceStartSeconds: interval.sourceStartSeconds,
			sourceEndSeconds: interval.sourceEndSeconds,
			outputSampleCount: clipSampleCount,
			...(signal ? { signal } : {})
		});
		signal?.throwIfAborted();
		if (!clipPcm) continue;
		assertDecodedClipAudio(clipPcm, clipSampleCount);

		const destinationStartSample = span.startSample + sceneStartSample;
		const canAdoptClipBuffer =
			channels === null &&
			span.windows === null &&
			destinationStartSample === 0 &&
			clipSampleCount === outputSampleCount;
		if (canAdoptClipBuffer) {
			channels = [clipPcm.channels[0], clipPcm.channels[1]];
			if (clip.audio.gain !== 1) {
				scaleMixChannels(channels, clip.audio.gain);
			}
			continue;
		}

		channels ??= emptyMixChannels(outputSampleCount);
		sumPcmIntoMix(
			channels,
			clipPcm,
			destinationStartSample,
			Math.min(clipSampleCount, span.sampleCount - sceneStartSample),
			clip.audio.gain,
			span.windows,
			sceneStartSample
		);
	}

	return channels;
}

/**
 * Decode each scheduled slug that `buffers` does not hold yet, in parallel,
 * through the one decode-only context. An unknown slug is held as `null`, so it
 * is reported once however many Scenes schedule it.
 */
async function loadScheduledCueBuffers(
	playable: readonly ScheduledSound[],
	buffers: Map<string, AudioBuffer | null>,
	readDecodeContext: () => BaseAudioContext,
	services: AudioMixServices,
	signal: AbortSignal | undefined
): Promise<void> {
	const slugs = [...new Set(playable.map((entry) => entry.slug))].filter(
		(slug) => !buffers.has(slug)
	);
	const context = slugs.length > 0 ? readDecodeContext() : null;
	await Promise.all(
		slugs.map(async (slug) => {
			signal?.throwIfAborted();
			const pending = context ? services.loadCueBuffer(slug, context) : null;
			if (pending === null) {
				console.error(`Audio mix: unknown sound asset "${slug}"; scheduling silence.`);
				buffers.set(slug, null);
				return;
			}
			buffers.set(slug, await pending);
		})
	);
	signal?.throwIfAborted();
}

function sumCueIntoMix(
	channels: MixChannels,
	buffer: AudioBuffer,
	entry: ScheduledSound,
	span: FilmAudioMixSceneSpan,
	sceneStartSample: number,
	playFrames: number,
	rampStart: number
): void {
	const startFrame = span.startSample + sceneStartSample;
	const { windows } = span;
	for (let channel = 0; channel < AUDIO_MIX_CHANNELS; channel += 1) {
		const out = channels[channel];
		// Mono samples feed both output channels; stereo maps per channel.
		const src = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
		if (windows === null) {
			for (let i = 0; i < playFrames; i += 1) {
				const release = i >= rampStart ? 1 - (i - rampStart) / (playFrames - rampStart) : 1;
				out[startFrame + i] += src[i] * entry.gain * MASTER_GAIN * release;
			}
			continue;
		}
		for (let i = 0; i < playFrames; i += 1) {
			const release = i >= rampStart ? 1 - (i - rampStart) / (playFrames - rampStart) : 1;
			out[startFrame + i] +=
				src[i] *
				entry.gain *
				MASTER_GAIN *
				release *
				filmAudioMixSceneWindowGain(windows, sceneStartSample + i);
		}
	}
}

/**
 * Sum one Scene's scheduled cues (derived cues, manual cues, and beds alike) at
 * their exact sample positions, in fixed plan order. Positions are counted from
 * the Scene's start sample, a cue that would run past the Scene's span is cut
 * there, and every sample takes the Scene's window gain.
 */
function mixScheduledSounds(
	channels: MixChannels,
	playable: readonly ScheduledSound[],
	buffers: ReadonlyMap<string, AudioBuffer | null>,
	span: FilmAudioMixSceneSpan
): void {
	const releaseFrames = Math.round(RELEASE_SECONDS * AUDIO_MIX_SAMPLE_RATE);

	for (const entry of playable) {
		const buffer = buffers.get(entry.slug);
		if (!buffer) {
			continue;
		}

		const startFrame = Math.round(Math.max(0, entry.when) * AUDIO_MIX_SAMPLE_RATE);
		const windowFrames =
			entry.windowSeconds !== null
				? Math.round(entry.windowSeconds * AUDIO_MIX_SAMPLE_RATE)
				: buffer.length;
		const playFrames = Math.min(buffer.length, windowFrames, span.sampleCount - startFrame);
		if (playFrames <= 0) {
			continue;
		}
		// Release ramp only when the window cuts the sample early — a hard stop
		// mid-waveform clicks; a sample playing out (or hitting its Scene's own
		// end) keeps its natural tail.
		const cutEarly = entry.windowSeconds !== null && buffer.length > windowFrames;
		const rampStart = cutEarly ? Math.max(0, playFrames - releaseFrames) : playFrames;

		sumCueIntoMix(channels, buffer, entry, span, startFrame, playFrames, rampStart);
	}
}

/** Deterministic post-render ceiling: scale every sample down when the sum overshoots. */
function applyPeakCeiling(channels: MixChannels): void {
	let peak = 0;
	for (const data of channels) {
		for (const sample of data) {
			peak = Math.max(peak, Math.abs(sample));
		}
	}
	if (peak > PEAK_CEILING) {
		scaleMixChannels(channels, PEAK_CEILING / peak);
	}
}

/**
 * Render a whole Film's audio into one AudioBuffer (AUDIO_MIX_SAMPLE_RATE,
 * stereo, exactly `audioMixSampleCount(frameCount, frameRate)` long), or `null`
 * when no Scene schedules a sound.
 *
 * Each Scene is planned on its own (`planAudioMix`) and placed at the sample
 * its Scene starts on. The sum runs in one fixed order: Scene by Scene in Film
 * order, and inside a Scene its Video clips and then its cues, as a lone
 * composition always summed. Inside a boundary window that order puts the
 * outgoing Scene's sounds before the incoming Scene's, the outgoing ones
 * fading out and the incoming ones fading in (`filmAudioMixSceneWindowGain`);
 * cues, beds, and Video-clip audio all take the same gain. A Scene between two
 * cuts takes none: its samples are summed by the same arithmetic as before
 * windows could fade, so a Film of cuts mixes to the same bytes. The peak
 * ceiling is applied once, to the whole Film, so the balance between Scenes is
 * the authored one.
 *
 * Throws a `RangeError` when a Scene runs past `frameCount`.
 */
export async function renderFilmAudioMix(
	request: FilmAudioMixRenderRequest,
	services: AudioMixServices = DEFAULT_AUDIO_MIX_SERVICES
): Promise<AudioBuffer | null> {
	const { scenes, frameCount, frameRate, signal } = request;
	const outputSampleCount = audioMixSampleCount(frameCount, frameRate);

	// Web Audio is used ONLY to decode (resampled to the mix rate). The
	// summing itself is plain JS in fixed plan order — an OfflineAudioContext
	// graph sums overlapping sources in unspecified order, and float addition
	// is non-associative, so three-plus overlapping cues broke byte-identity
	// by ±1 ULP. Hand-mixing keeps the §6 contract literal: same inputs →
	// same bytes.
	let channels: MixChannels | null = null;
	let cueDecodeContext: BaseAudioContext | null = null;
	const readCueDecodeContext = (): BaseAudioContext => {
		cueDecodeContext ??= services.createCueDecodeContext();
		return cueDecodeContext;
	};
	const cueBuffers = new Map<string, AudioBuffer | null>();

	for (const scene of scenes) {
		const span = filmAudioMixSceneSpan(scene, frameRate, outputSampleCount);
		const sceneSeconds = span.sampleCount / AUDIO_MIX_SAMPLE_RATE;
		const playable = planAudioMix(scene.state).filter((entry) => entry.when < sceneSeconds);
		signal?.throwIfAborted();

		channels = await mixSceneVideoClipAudio(
			channels,
			scene,
			span,
			frameRate,
			outputSampleCount,
			services,
			signal
		);
		if (playable.length === 0) continue;

		await loadScheduledCueBuffers(playable, cueBuffers, readCueDecodeContext, services, signal);
		channels ??= emptyMixChannels(outputSampleCount);
		mixScheduledSounds(channels, playable, cueBuffers, span);
	}
	if (channels === null) return null;

	applyPeakCeiling(channels);

	const rendered = services.createOutputBuffer({
		length: outputSampleCount,
		numberOfChannels: AUDIO_MIX_CHANNELS,
		sampleRate: AUDIO_MIX_SAMPLE_RATE
	});
	rendered.copyToChannel(channels[0], 0);
	rendered.copyToChannel(channels[1], 1);
	return rendered;
}

/**
 * Render one composition's audio: the Film mix of that one Scene, starting on
 * frame 0. Preview mixes the live Scene through this.
 */
export function renderAudioMix(
	request: AudioMixRenderRequest,
	services: AudioMixServices = DEFAULT_AUDIO_MIX_SERVICES
): Promise<AudioBuffer | null> {
	const { state, frameCount, frameRate, signal } = request;
	return renderFilmAudioMix(
		{
			scenes: [{ state, startFrame: 0, frameCount }],
			frameCount,
			frameRate,
			...(signal ? { signal } : {})
		},
		services
	);
}
