/**
 * The browser export lane: encode the composition to WebM inside the page with
 * Mediabunny over WebCodecs, so the hosted origin never receives a frame
 * ([ADR-0052](../../../docs/adr/0052-public-runtime-and-retention-architecture.md)
 * amendment).
 *
 * This is the lane the Node origin's ffmpeg transport replaced in July 2026 for
 * alpha quality: VP9's alpha side data showed dark halos at transparent edges.
 * Half of that cause was dither residue in the frames themselves, which the
 * premultiplied-alpha-aware present pass fixed in the same change and which is
 * still in place; what remains is the encoder's own alpha handling, and that is
 * measured by `pnpm verify:hosted-export` rather than assumed.
 *
 * The frame plan, the timestamps, and the render callback are exactly the origin
 * lane's (`export-video.ts`), so the two lanes step the same frames at the same
 * times; only where a rendered frame goes differs.
 */
import * as Sentry from '@sentry/sveltekit';
import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	Output,
	QUALITY_HIGH,
	WebMOutputFormat
} from 'mediabunny';

import { framesToSeconds, resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';

import {
	exportSpanAttributes,
	type TransparentVideoExportOptions,
	type VideoExportDownload
} from './export-video';
import { fontsReady } from './fonts';
import { findExportEnvelopeRejection } from './public-export-limits';
import { PUBLIC_EXPORT_RUNTIME_LIMITS } from './public-runtime-contract';

function nextAnimationFrame(): Promise<void> {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Render every frame of the plan into a VP9 WebM in this page and hand back the
 * finished file. A transparent piece keeps its alpha; a full-frame piece
 * discards it, so the output class matches the origin lane's. The offline audio
 * mix, when present, becomes the Opus track. Aborting cancels the encoder and
 * releases whatever it had written.
 *
 * An export outside the public envelope is refused before a frame renders, in
 * the words the Node lane's session admission uses. This lane is the hosted
 * origin's, which has no session to refuse at, and it buffers the whole file in
 * the page — so a Film-length piece must stop here, not at an exhausted tab.
 */
export async function exportWebMInBrowser(
	options: TransparentVideoExportOptions
): Promise<VideoExportDownload> {
	const {
		canvas,
		durationSeconds,
		fps,
		renderFrame,
		onProgress,
		hasBackground,
		audio,
		frameCount: plannedFrameCount,
		timestampForFrame,
		signal
	} = options;
	const rate = resolveFrameRate(fps);
	const frameCount = plannedFrameCount ?? Math.max(1, secondsToFrames(durationSeconds, rate));
	// No WAV is uploaded on this lane, so the audio bound has nothing to measure;
	// the duration bound already limits how long the mix can be.
	const overEnvelope = findExportEnvelopeRejection(
		{ format: 'webm', fps, frameCount, audioBytes: 0 },
		PUBLIC_EXPORT_RUNTIME_LIMITS
	);
	if (overEnvelope) throw new Error(overEnvelope.message);

	return Sentry.startSpan(
		{
			name: 'export.webm',
			op: 'export',
			forceTransaction: true,
			attributes: {
				...exportSpanAttributes({ fps, durationSeconds, hasBackground, audio }),
				'export.lane': 'browser'
			}
		},
		async (exportSpan) => {
			// Channel typefaces must be loaded before frame 0 or the export bakes in
			// OS fallbacks; the origin lane gates the same way.
			await fontsReady();
			signal?.throwIfAborted();

			const frameDuration = rate.den / rate.num;
			const yieldEvery = Math.max(1, Math.round(rate.num / rate.den));
			exportSpan.setAttribute('export.frames', frameCount);

			const target = new BufferTarget();
			const output = new Output({ format: new WebMOutputFormat(), target });
			const video = new CanvasSource(canvas, {
				codec: 'vp9',
				bitrate: QUALITY_HIGH,
				alpha: hasBackground ? 'discard' : 'keep'
			});
			output.addVideoTrack(video, { frameRate: rate.num / rate.den });
			// The baked audio track (ADR-0033 §6): the offline mix is one AudioBuffer
			// spanning the whole piece, added once at timestamp 0. A soundless piece
			// carries no audio track at all rather than a silent one.
			const audioSource = audio
				? new AudioBufferSource({ codec: 'opus', bitrate: QUALITY_HIGH })
				: null;
			if (audioSource) output.addAudioTrack(audioSource);

			let isFinalized = false;
			try {
				await output.start();
				if (audioSource && audio) await audioSource.add(audio);
				await Sentry.startSpan({ name: 'export.render-frames', op: 'export.render' }, async () => {
					for (let frame = 0; frame < frameCount; frame += 1) {
						signal?.throwIfAborted();
						const timestamp = timestampForFrame?.(frame) ?? framesToSeconds(frame, rate);
						await renderFrame(frame, timestamp);
						signal?.throwIfAborted();
						await video.add(timestamp, frameDuration);
						onProgress?.((frame + 1) / frameCount);
						if ((frame + 1) % yieldEvery === 0) await nextAnimationFrame();
					}
				});
				await Sentry.startSpan({ name: 'export.encode', op: 'export.encode' }, () =>
					output.finalize()
				);
				isFinalized = true;
			} finally {
				// A cancelled or failed encode releases the encoder now; an output that
				// was never started has nothing to release and cancel() says so.
				if (!isFinalized) await output.cancel().catch(() => undefined);
			}

			if (!target.buffer) {
				throw new Error('Browser WebM export finished without producing a file.');
			}
			return {
				transport: 'browser',
				file: new Blob([target.buffer], { type: 'video/webm' })
			};
		}
	);
}
