import * as Sentry from '@sentry/sveltekit';

import { waitForAbortableDelay } from '$lib/utils/abortable-delay';
import { audioBufferToWavBytes } from '$lib/utils/audio-wav';
import { framesToSeconds, resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';

import {
	exportSessionDeliveryFailureMessage,
	parseExportSessionDeliveryStatus
} from './export-session-delivery-status';
import { fontsReady } from './fonts';
import { EXPORT_AUDIO_UPLOAD_PART_BYTES } from './public-export-limits';
import {
	parseExportRuntimeLimits,
	PUBLIC_EXPORT_RUNTIME_LIMITS,
	type PublicExportRuntimeLimits
} from './public-runtime-contract';

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
 * origin lane leaves the file on the Node origin, to be downloaded exactly
 * once; the browser lane (`browser-webm-export.ts`, the hosted origin's only
 * lane) already holds the file in this page. `downloadVideoExport` delivers
 * either.
 */
export type VideoExportDownload =
	| {
			transport: 'origin';
			downloadUrl: string;
			/**
			 * Where this page reads how the download went. The browser saves the
			 * output itself, so the origin is the only one that knows when it landed.
			 */
			deliveryStatusUrl: string;
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
	options: Pick<
		TransparentVideoExportOptions,
		'fps' | 'durationSeconds' | 'hasBackground' | 'audio'
	>
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

/**
 * The export limits this page's origin enforces. The runtime profile is private
 * to the origin, so the page asks: a development host answers with the
 * Film-length envelope, a public host with the ratified one. The hosted origin
 * serves no `/api/export/` route at all and encodes in the browser inside the
 * public envelope, so its 404 resolves to the public limits rather than failing.
 */
export async function fetchServedExportRuntimeLimits(
	signal?: AbortSignal
): Promise<PublicExportRuntimeLimits> {
	const response = await fetch('/api/export/limits', { signal });
	if (response.status === 404) return PUBLIC_EXPORT_RUNTIME_LIMITS;
	if (!response.ok) throw await responseFailure(response, 'Export limits request failed');
	const limits = parseExportRuntimeLimits(await response.json());
	if (!limits) throw new Error('Export limits returned an invalid document.');
	return limits;
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
			// The bed goes up in ordered parts, each under the origin's per-request
			// body ceiling: a Film-length bed is larger than one request may be. Each
			// part names the byte it starts on, and the origin appends them in order.
			const wav = new Blob([wavBytes], { type: 'audio/wav' });
			for (let offset = 0; offset < wav.size; offset += EXPORT_AUDIO_UPLOAD_PART_BYTES) {
				signal?.throwIfAborted();
				const audioResponse = await fetch(`${activeSession.audioUrl}?offset=${offset}`, {
					method: 'PUT',
					signal,
					headers: { 'Content-Type': 'audio/wav' },
					body: wav.slice(offset, offset + EXPORT_AUDIO_UPLOAD_PART_BYTES, 'audio/wav')
				});
				if (!audioResponse.ok) {
					throw await responseFailure(audioResponse, 'Export audio upload failed');
				}
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
		if (
			!isRecord(value) ||
			typeof value.downloadUrl !== 'string' ||
			typeof value.deliveryStatusUrl !== 'string'
		) {
			throw new Error('Export completion returned an invalid download document.');
		}
		signal?.throwIfAborted();
		isComplete = true;
		return {
			transport: 'origin',
			downloadUrl: value.downloadUrl,
			deliveryStatusUrl: value.deliveryStatusUrl,
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
 * How often the page asks the origin how an export download is going. The
 * browser reports nothing about a download it is saving, so this is the
 * resolution at which a finished one is noticed.
 */
export const EXPORT_DELIVERY_STATUS_POLL_MS = 500;

/**
 * Wait until the origin says this session's one download ended, and answer with
 * the bytes it sent. Anything but a delivered file is the export's failure.
 *
 * The reads are not activity on the session (`ExportSessionStore.deliveryStatus`),
 * so this loop cannot keep an output alive that the browser never came for: the
 * session's idle timeout ends it, and the next read says it expired.
 */
async function waitForExportDelivery(
	deliveryStatusUrl: string,
	signal?: AbortSignal
): Promise<number> {
	while (true) {
		await waitForAbortableDelay(EXPORT_DELIVERY_STATUS_POLL_MS, signal);
		const response = await fetch(deliveryStatusUrl, { signal, cache: 'no-store' });
		if (!response.ok) {
			throw await responseFailure(response, 'Export delivery status request failed');
		}
		const status = parseExportSessionDeliveryStatus(await response.json());
		if (!status) throw new Error('Export delivery status returned an invalid document.');
		if (status.state === 'delivered') return status.outputBytes;
		if (status.state !== 'pending' && status.state !== 'downloading') {
			throw new Error(exportSessionDeliveryFailureMessage(status.state));
		}
	}
}

/**
 * Hand the encoded output to the browser, and answer only once the whole file
 * was delivered. Returns the number of bytes delivered.
 *
 * An origin-encoded export is never held in this page. The session's output URL
 * is handed to the browser as a download, so the bytes go from the network to
 * disk: a 4K ProRes Film is gigabytes per few seconds, and a Blob of it is more
 * than a browser's blob store holds (a 1.45 GB file failed with
 * `net::ERR_BLOB_OUT_OF_MEMORY` in an off-the-record context on an 8 GB machine,
 * 2026-10-09). The request is same-origin, so it carries the session credential
 * cookie exactly as a fetch did.
 *
 * A browser download is a transfer the page cannot observe, and a receipt for a
 * file that has not landed is what
 * [ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §7
 * forbids. So the page asks the one party that can see it: the origin answers
 * `delivered` only after it sent every byte and disposed of the session, and
 * until then this function has not returned. A download the browser refused,
 * the person stopped, or that never started ends the session on the origin's own
 * clocks and is this export's failure. The caller's `AbortSignal` stops the wait
 * and cancels the session, which ends a transfer still in flight.
 *
 * A browser-encoded export is already a Blob in the browser's blob storage, so
 * it is handed over directly; there is no session to cancel and no transfer to
 * observe.
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
		startBrowserDownload(exportedVideo.downloadUrl, filename);
		const deliveredBytes = await waitForExportDelivery(exportedVideo.deliveryStatusUrl, signal);
		isDelivered = true;
		return deliveredBytes;
	} finally {
		if (!isDelivered) await cancelExportSession(exportedVideo.cancelUrl);
	}
}

/** Ask the browser to save `url` under `filename`, through its own download machinery. */
function startBrowserDownload(url: string, filename: string): void {
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	try {
		startBrowserDownload(url, filename);
	} finally {
		URL.revokeObjectURL(url);
	}
}
