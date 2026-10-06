import * as Sentry from '@sentry/sveltekit';

import { audioBufferToWavBytes } from '$lib/utils/audio-wav';
import { framesToSeconds, resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';

import { fontsReady } from './fonts';

export interface TransparentVideoExportOptions {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	durationSeconds: number;
	fps: number;
	/** Optional precomputed frame plan supplied by the composition export controller. */
	frameCount?: number;
	timestampForFrame?: (frame: number) => number;
	renderFrame: (frame: number, timestamp: number) => void | Promise<void>;
	onProgress?: (progress: number) => void;
	signal?: AbortSignal;
	/** True when backgroundFill is set — output is opaque (VP9 alpha discarded). */
	hasBackground?: boolean;
	/**
	 * The composition's deterministic offline audio mix (ADR-0033 §6), baked
	 * into the deliverable as its audio track. null/absent = no audio track —
	 * a soundless piece must not carry a silent stream.
	 */
	audio?: AudioBuffer | null;
	/**
	 * Optional non-drop `HH:MM:SS:FF` start timecode stamped into the ProRes
	 * .mov's tmcd track (ADR-0042) so the NLE lands the piece at its
	 * edit-authored frame. A sync-session value, never Preset data (the Preset
	 * carries no edit anchor). Ignored by the WebM path — Matroska carries no
	 * start-timecode concept.
	 */
	startTimecode?: string;
}

/**
 * Agent-facing export request (ADR-0042 marker-sync loop): supply the
 * embedded start timecode and the sync export filename
 * (`<slug>__<TC>__<frames>f__v<version>.mov`). The GUI export button passes
 * neither — its downloads keep the `gfx-overlay` / `gfx-bumper` names.
 */
export interface SyncExportRequest {
	startTimecode?: string;
	filename?: string;
}

/**
 * Where an encoded export is, which is decided by which lane encoded it. The
 * origin lane leaves the file on the Node origin, to be fetched exactly once;
 * the browser lane (`browser-webm-export.ts`, the hosted origin's only lane)
 * already holds the file in this page. `downloadVideoExport` delivers either.
 */
export type VideoExportDownload =
	| {
			transport: 'origin';
			downloadUrl: string;
			/**
			 * The session's own cancel URL. Carried out of the encode so a download
			 * that never lands releases the encoded file now rather than at the
			 * session's idle timeout — the origin holds no visitor output it is not
			 * actively delivering
			 * ([ADR-0052](../../../docs/adr/0052-public-runtime-and-retention-architecture.md)).
			 */
			cancelUrl: string;
	  }
	| {
			transport: 'browser';
			/** The finished file, in the browser's blob storage rather than the page heap. */
			file: Blob;
	  };

interface ExportSessionControl {
	sessionId: string;
	audioUrl: string;
	frameUrlTemplate: string;
	completeUrl: string;
	cancelUrl: string;
}

declare global {
	interface Window {
		/**
		 * Workspace-bound export seam (peer to `__gfxTimeline`): lets a scripted
		 * runner drive the real export path with a `SyncExportRequest` and stop it
		 * with a signal. Set while a Workspace is mounted. It resolves to the
		 * Workspace's `CompositionExportOutcome`, typed `unknown` here because
		 * naming it would point this module back at the controller that imports it.
		 */
		__gfxExport?: (request?: SyncExportRequest, signal?: AbortSignal) => Promise<unknown>;
	}
}

/**
 * Span attributes shared by every export transaction, the browser lane's
 * included (docs/sentry-dev-flow.md). `export.route` is the `/p/<slug>` path —
 * the per-composition dimension for "which pieces are slow to export" charts.
 */
export function exportSpanAttributes(
	options: Pick<TransparentVideoExportOptions, 'fps' | 'durationSeconds' | 'hasBackground' | 'audio'>
): Record<string, string | number | boolean> {
	return {
		'export.fps': options.fps,
		'export.duration_seconds': options.durationSeconds,
		'export.opaque': options.hasBackground === true,
		'export.has_audio': options.audio != null,
		'export.route': typeof window !== 'undefined' ? window.location.pathname : ''
	};
}

async function canvasFrameToPng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
	if (canvas instanceof OffscreenCanvas) {
		return canvas.convertToBlob({ type: 'image/png' });
	}

	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((result) => {
			if (result) {
				resolve(result);
			} else {
				reject(new Error('Failed to encode canvas frame as PNG.'));
			}
		}, 'image/png');
	});
}

async function responseFailure(response: Response, fallback: string): Promise<Error> {
	const message = await response.text();
	return new Error(message || `${fallback} with status ${response.status}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createExportSession(options: {
	format: 'webm' | 'prores';
	fps: number;
	frameCount: number;
	opaque: boolean;
	audioBytes: number;
	startTimecode?: string;
	signal?: AbortSignal;
}): Promise<ExportSessionControl> {
	const { signal, ...metadata } = options;
	const response = await fetch('/api/export/sessions', {
		method: 'POST',
		signal,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(metadata)
	});
	if (!response.ok) throw await responseFailure(response, 'Export session creation failed');
	const value: unknown = await response.json();
	if (
		!isRecord(value) ||
		typeof value.sessionId !== 'string' ||
		typeof value.audioUrl !== 'string' ||
		typeof value.frameUrlTemplate !== 'string' ||
		typeof value.completeUrl !== 'string' ||
		typeof value.cancelUrl !== 'string'
	) {
		throw new Error('Export session returned an invalid control document.');
	}
	return {
		sessionId: value.sessionId,
		audioUrl: value.audioUrl,
		frameUrlTemplate: value.frameUrlTemplate,
		completeUrl: value.completeUrl,
		cancelUrl: value.cancelUrl
	};
}

async function cancelExportSession(cancelUrl: string): Promise<void> {
	await fetch(cancelUrl, { method: 'DELETE', keepalive: true }).catch(() => undefined);
}

async function exportCanvasVideo(
	format: 'webm' | 'prores',
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
		startTimecode,
		frameCount: plannedFrameCount,
		timestampForFrame,
		signal
	} = options;
	await fontsReady();
	signal?.throwIfAborted();

	const rate = resolveFrameRate(fps);
	const frameCount = plannedFrameCount ?? Math.max(1, secondsToFrames(durationSeconds, rate));
	const yieldEvery = Math.max(1, Math.round(rate.num / rate.den));
	const wavBytes = audio ? audioBufferToWavBytes(audio) : null;
	let session: ExportSessionControl | null = null;
	let isComplete = false;
	try {
		session = await createExportSession({
			format,
			fps,
			frameCount,
			opaque: hasBackground === true,
			audioBytes: wavBytes?.byteLength ?? 0,
			startTimecode,
			signal
		});
		const activeSession = session;
		if (wavBytes) {
			const audioResponse = await fetch(activeSession.audioUrl, {
				method: 'PUT',
				signal,
				headers: { 'Content-Type': 'audio/wav' },
				body: new Blob([wavBytes], { type: 'audio/wav' })
			});
			if (!audioResponse.ok) {
				throw await responseFailure(audioResponse, 'Export audio upload failed');
			}
		}

		await Sentry.startSpan({ name: 'export.render-frames', op: 'export.render' }, async () => {
			for (let frame = 0; frame < frameCount; frame += 1) {
				signal?.throwIfAborted();
				const timestamp = timestampForFrame?.(frame) ?? framesToSeconds(frame, rate);
				await renderFrame(frame, timestamp);
				signal?.throwIfAborted();
				const png = await canvasFrameToPng(canvas);
				const frameResponse = await fetch(
					activeSession.frameUrlTemplate.replace('{frame}', String(frame)),
					{
						method: 'PUT',
						signal,
						headers: { 'Content-Type': 'image/png' },
						body: png
					}
				);
				if (!frameResponse.ok) {
					throw await responseFailure(frameResponse, `Export frame ${frame} upload failed`);
				}
				onProgress?.((frame + 1) / frameCount);
				if ((frame + 1) % yieldEvery === 0) {
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				}
			}
		});

		const response = await fetch(activeSession.completeUrl, { method: 'POST', signal });
		if (!response.ok) throw await responseFailure(response, `${format} export failed`);
		const value: unknown = await response.json();
		if (!isRecord(value) || typeof value.downloadUrl !== 'string') {
			throw new Error('Export completion returned an invalid download document.');
		}
		signal?.throwIfAborted();
		isComplete = true;
		return {
			transport: 'origin',
			downloadUrl: value.downloadUrl,
			cancelUrl: activeSession.cancelUrl
		};
	} finally {
		if (session && !isComplete) await cancelExportSession(session.cancelUrl);
	}
}

export async function exportTransparentWebM({
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
}: TransparentVideoExportOptions): Promise<VideoExportDownload> {
	// The whole export is its own Sentry transaction: total wall-clock is the
	// headline metric, the render-loop and encode-upload children break it down.
	return Sentry.startSpan(
		{
			name: 'export.webm',
			op: 'export',
			forceTransaction: true,
			attributes: exportSpanAttributes({ fps, durationSeconds, hasBackground, audio })
		},
		async (exportSpan) => {
			const rate = resolveFrameRate(fps);
			const frameCount = plannedFrameCount ?? Math.max(1, secondsToFrames(durationSeconds, rate));
			exportSpan.setAttribute('export.frames', frameCount);
			return Sentry.startSpan({ name: 'export.encode', op: 'export.encode' }, () =>
				exportCanvasVideo('webm', {
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
				})
			);
		}
	);
}

export async function exportTransparentProRes({
	canvas,
	durationSeconds,
	fps,
	renderFrame,
	onProgress,
	audio,
	startTimecode,
	frameCount: plannedFrameCount,
	timestampForFrame,
	signal
}: TransparentVideoExportOptions): Promise<VideoExportDownload> {
	// Same transaction shape as the WebM path — see exportTransparentWebM.
	return Sentry.startSpan(
		{
			name: 'export.prores',
			op: 'export',
			forceTransaction: true,
			attributes: exportSpanAttributes({ fps, durationSeconds, audio })
		},
		async (exportSpan) => {
			const rate = resolveFrameRate(fps);
			const frameCount = plannedFrameCount ?? Math.max(1, secondsToFrames(durationSeconds, rate));
			exportSpan.setAttribute('export.frames', frameCount);
			return Sentry.startSpan({ name: 'export.encode', op: 'export.encode' }, () =>
				exportCanvasVideo('prores', {
					canvas,
					durationSeconds,
					fps,
					renderFrame,
					onProgress,
					audio,
					startTimecode,
					frameCount: plannedFrameCount,
					timestampForFrame,
					signal
				})
			);
		}
	);
}

/**
 * Hand the encoded output to the browser, and answer only once the browser
 * really has it. Returns the number of bytes it received.
 *
 * The output is fetched rather than linked. An `<a download>` pointed at the
 * session URL starts a transfer the page cannot observe: it has no status, no
 * byte count, and no way to be stopped, so an export would report a delivered
 * file while the download was still running — or had already been refused —
 * which is the receipt [ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §7
 * forbids. Fetching gives the transfer all three, including the caller's
 * `AbortSignal`, and the server's own refusal text becomes the export's failure
 * message instead of a silent non-download.
 *
 * `Response.blob()` is what keeps this affordable: the bytes live in the
 * browser's blob storage, which spills to disk, rather than in the page's heap.
 * A full-length public export runs to `PUBLIC_EXPORT_RUNTIME_LIMITS.maxOutputBytes`,
 * far past what an in-page buffer should hold.
 *
 * A browser-encoded export is already a Blob in that storage, so it is handed
 * over directly; there is no session to cancel and no transfer to observe.
 */
export async function downloadVideoExport(
	exportedVideo: VideoExportDownload,
	filename: string,
	signal?: AbortSignal
): Promise<number> {
	if (exportedVideo.transport === 'browser') {
		signal?.throwIfAborted();
		downloadBlob(exportedVideo.file, filename);
		return exportedVideo.file.size;
	}
	let isDelivered = false;
	try {
		signal?.throwIfAborted();
		const response = await fetch(exportedVideo.downloadUrl, { signal });
		if (!response.ok) throw await responseFailure(response, 'Export download failed');
		const declaredLength = response.headers.get('content-length');
		const file = await response.blob();
		// The output response declares its exact size, so a transfer that ended
		// early is a torn file — never a delivered one.
		if (declaredLength !== null && file.size !== Number(declaredLength)) {
			throw new Error(`Export download ended at ${file.size} bytes; expected ${declaredLength}.`);
		}
		signal?.throwIfAborted();
		downloadBlob(file, filename);
		isDelivered = true;
		return file.size;
	} finally {
		if (!isDelivered) await cancelExportSession(exportedVideo.cancelUrl);
	}
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	try {
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
	} finally {
		URL.revokeObjectURL(url);
	}
}
