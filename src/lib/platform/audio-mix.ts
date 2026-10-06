/**
 * Deterministic offline audio mix (ADR-0033 §6). The export's audio track is
 * a pure function of {Video-clip PCM + derived motion cues + manual cues +
 * bed + exact export frame plan}: `planAudioMix` computes the cue schedule
 * (pure, node-testable) and `renderAudioMix` sums every input at fixed sample
 * positions. No wall-clock participates, so the same composition renders a
 * byte-identical buffer every run. Preview uses this exact mix whenever
 * Video-clip audio participates; cue-only preview retains its low-latency scheduler.
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

function sumPcmIntoMix(
	channels: MixChannels,
	pcm: VideoAssetAudioPcm,
	destinationStartSample: number,
	gain: number
): void {
	for (let channel = 0; channel < AUDIO_MIX_CHANNELS; channel += 1) {
		const output = channels[channel];
		const input = pcm.channels[channel];
		for (let sample = 0; sample < input.length; sample += 1) {
			output[destinationStartSample + sample] += input[sample] * gain;
		}
	}
}

/**
 * Decode every audible Video clip and sum it into fresh mix channels. A clip
 * covering the whole transport donates its decoded buffers directly (no copy);
 * anything else is summed at its exact destination sample.
 */
async function mixVideoClipAudio(
	state: EngineState,
	frameRate: FrameRate,
	outputSampleCount: number,
	services: AudioMixServices,
	signal: AbortSignal | undefined
): Promise<MixChannels | null> {
	let channels: MixChannels | null = null;

	for (const clip of state.media.videoTrack.clips) {
		if (!clip.audio.enabled || clip.audio.gain === 0) continue;
		const asset = state.media.assets.find((candidate) => candidate.id === clip.assetId);
		if (!asset) {
			throw new Error(`Video clip "${clip.id}" references missing asset "${clip.assetId}".`);
		}
		const interval = resolveVideoClipInterval(clip, frameRate);
		const destinationStartSample = audioMixSampleAtFrame(interval.timelineStartFrame, frameRate);
		const destinationEndSample = audioMixSampleAtFrame(interval.timelineEndFrame, frameRate);
		if (destinationEndSample > outputSampleCount) {
			throw new RangeError(`Video clip "${clip.id}" extends beyond the audio mix transport.`);
		}
		const clipSampleCount = destinationEndSample - destinationStartSample;
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

		const canAdoptClipBuffer =
			channels === null &&
			destinationStartSample === 0 &&
			destinationEndSample === outputSampleCount;
		if (canAdoptClipBuffer) {
			channels = [clipPcm.channels[0], clipPcm.channels[1]];
			if (clip.audio.gain !== 1) {
				scaleMixChannels(channels, clip.audio.gain);
			}
			continue;
		}

		channels ??= emptyMixChannels(outputSampleCount);
		sumPcmIntoMix(channels, clipPcm, destinationStartSample, clip.audio.gain);
	}

	return channels;
}

/** Decode every distinct scheduled slug once, in parallel, through the decode-only context. */
async function loadScheduledCueBuffers(
	playable: readonly ScheduledSound[],
	services: AudioMixServices,
	signal: AbortSignal | undefined
): Promise<Map<string, AudioBuffer>> {
	const context = playable.length > 0 ? services.createCueDecodeContext() : null;
	const slugs = [...new Set(playable.map((entry) => entry.slug))];
	const buffers = new Map<string, AudioBuffer>();
	await Promise.all(
		slugs.map(async (slug) => {
			signal?.throwIfAborted();
			const pending = context ? services.loadCueBuffer(slug, context) : null;
			if (pending === null) {
				console.error(`Audio mix: unknown sound asset "${slug}"; scheduling silence.`);
				return;
			}
			buffers.set(slug, await pending);
		})
	);
	signal?.throwIfAborted();
	return buffers;
}

function sumCueIntoMix(
	channels: MixChannels,
	buffer: AudioBuffer,
	entry: ScheduledSound,
	startFrame: number,
	playFrames: number,
	rampStart: number
): void {
	for (let channel = 0; channel < AUDIO_MIX_CHANNELS; channel += 1) {
		const out = channels[channel];
		// Mono samples feed both output channels; stereo maps per channel.
		const src = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
		for (let i = 0; i < playFrames; i += 1) {
			const release = i >= rampStart ? 1 - (i - rampStart) / (playFrames - rampStart) : 1;
			out[startFrame + i] += src[i] * entry.gain * MASTER_GAIN * release;
		}
	}
}

/** Sum every scheduled cue at its exact sample position, in fixed plan order. */
function mixScheduledSounds(
	channels: MixChannels,
	playable: readonly ScheduledSound[],
	buffers: ReadonlyMap<string, AudioBuffer>,
	outputSampleCount: number
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
		const playFrames = Math.min(buffer.length, windowFrames, outputSampleCount - startFrame);
		if (playFrames <= 0) {
			continue;
		}
		// Release ramp only when the window cuts the sample early — a hard stop
		// mid-waveform clicks; a sample playing out (or hitting the piece's own
		// end) keeps its natural tail.
		const cutEarly = entry.windowSeconds !== null && buffer.length > windowFrames;
		const rampStart = cutEarly ? Math.max(0, playFrames - releaseFrames) : playFrames;

		sumCueIntoMix(channels, buffer, entry, startFrame, playFrames, rampStart);
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

export async function renderAudioMix(
	request: AudioMixRenderRequest,
	services: AudioMixServices = DEFAULT_AUDIO_MIX_SERVICES
): Promise<AudioBuffer | null> {
	const { state, frameCount, frameRate, signal } = request;
	const plan = planAudioMix(state);
	const outputSampleCount = audioMixSampleCount(frameCount, frameRate);
	const duration = outputSampleCount / AUDIO_MIX_SAMPLE_RATE;
	const playable = plan.filter((entry) => entry.when < duration);
	signal?.throwIfAborted();

	const clipChannels = await mixVideoClipAudio(state, frameRate, outputSampleCount, services, signal);
	if (playable.length === 0 && clipChannels === null) return null;

	// Web Audio is used ONLY to decode (resampled to the mix rate). The
	// summing itself is plain JS in fixed plan order — an OfflineAudioContext
	// graph sums overlapping sources in unspecified order, and float addition
	// is non-associative, so three-plus overlapping cues broke byte-identity
	// by ±1 ULP. Hand-mixing keeps the §6 contract literal: same inputs →
	// same bytes.
	const buffers = await loadScheduledCueBuffers(playable, services, signal);

	const channels = clipChannels ?? emptyMixChannels(outputSampleCount);
	mixScheduledSounds(channels, playable, buffers, outputSampleCount);
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
