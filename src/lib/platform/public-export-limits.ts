/**
 * Request-time enforcement of the bounded public export envelope (ADR-0052).
 *
 * `public-runtime-contract.ts` ratifies the numbers; this module decides whether
 * one request, upload, or still-open session fits inside them, and names the
 * bound it missed alongside what would have fit. Every check is pure and
 * allocation-free, so the export transport can refuse a session before it
 * spawns ffmpeg or creates a work directory.
 *
 * Frame pixel dimensions are deliberately not checked here. The envelope is
 * sized so that only native-target work fits, but the transport still accepts
 * whatever size the client rendered, so the layout-contract and render-matrix
 * harnesses can drive reduced-size sweeps through the same lane.
 */

import {
	PUBLIC_EXPORT_RUNTIME_LIMITS,
	RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME,
	type PublicExportRuntimeLimits
} from '$lib/platform/public-runtime-contract';
import {
	formatFrameRateRational,
	framesToSeconds,
	resolveFrameRate
} from '$lib/utils/composition-timing';

/** The ratified bound a refused export request, upload, or session exceeded. */
export type PublicExportLimitName =
	| 'concurrentSessions'
	| 'controlDocumentBytes'
	| 'frameRate'
	| 'frameCount'
	| 'durationSeconds'
	| 'audioBytes'
	| 'audioPartBytes'
	| 'frameBytes'
	| 'sessionUploadBytes'
	| 'outputBytes'
	| 'sessionIdleMs'
	| 'sessionLifetimeMs';

export interface PublicExportLimitRejection {
	limit: PublicExportLimitName;
	/** Status the export transport answers with. */
	status: number;
	/** Names the bound, the value that was asked for, and what would fit. */
	message: string;
}

/**
 * Ceiling on the JSON control document that opens a session. The document is a
 * handful of scalars, so anything larger is refused from its declared length
 * before a byte of the body is read.
 */
export const EXPORT_CONTROL_DOCUMENT_MAX_BYTES = 4_096;

/** The session-shaping fields the envelope is decided from. */
export interface ExportEnvelopeRequest {
	format: 'webm' | 'prores';
	fps: number;
	frameCount: number;
	audioBytes: number;
}

export function findExportControlDocumentRejection(
	declaredBytes: number | null
): PublicExportLimitRejection | null {
	if (declaredBytes === null || declaredBytes <= EXPORT_CONTROL_DOCUMENT_MAX_BYTES) return null;
	return {
		limit: 'controlDocumentBytes',
		status: 413,
		message: `Export session metadata declares ${declaredBytes} bytes; the limit is ${EXPORT_CONTROL_DOCUMENT_MAX_BYTES}.`
	};
}

/**
 * Admission control for the whole host. Two native-resolution encodes already
 * saturate a modest origin, so a third caller is turned away rather than queued
 * — the slot a finished, cancelled, or expired session releases is immediately
 * available to whoever asks next.
 */
export function findExportConcurrencyRejection(
	activeSessions: number,
	maxConcurrentSessions: number
): PublicExportLimitRejection | null {
	if (activeSessions < maxConcurrentSessions) return null;
	return {
		limit: 'concurrentSessions',
		status: 429,
		message: `The export host is already running ${activeSessions} of ${maxConcurrentSessions} concurrent sessions. Retry once one finishes.`
	};
}

/**
 * Whether a well-formed session request fits the envelope — the public one
 * unless the caller passes the limits its host serves. The message names the
 * bound without calling it public, because a development host refuses against
 * a longer envelope with the same words. Duration is
 * measured from the exact frame-rate rational, never the display literal, so a
 * 900-frame 59.94 request is correctly seen as 15.015 seconds rather than 15.
 */
export function findExportEnvelopeRejection(
	request: ExportEnvelopeRequest,
	limits: PublicExportRuntimeLimits = PUBLIC_EXPORT_RUNTIME_LIMITS
): PublicExportLimitRejection | null {
	const rate = resolveFrameRate(request.fps);
	if (rate.num / rate.den > limits.maxFrameRate) {
		return {
			limit: 'frameRate',
			status: 400,
			message: `Export runs at ${formatFrameRateRational(rate)} fps; the limit is ${limits.maxFrameRate} fps.`
		};
	}
	if (request.frameCount > limits.maxFrameCount) {
		return {
			limit: 'frameCount',
			status: 400,
			message: `Export asks for ${request.frameCount} frames; the limit is ${limits.maxFrameCount}.`
		};
	}
	const durationSeconds = framesToSeconds(request.frameCount, rate);
	if (durationSeconds > limits.maxDurationSeconds) {
		const admissibleFrames = Math.floor((limits.maxDurationSeconds * rate.num) / rate.den);
		return {
			limit: 'durationSeconds',
			status: 400,
			message: `Export spans ${durationSeconds.toFixed(3)} seconds; the limit is ${limits.maxDurationSeconds} seconds (${admissibleFrames} frames at ${formatFrameRateRational(rate)} fps).`
		};
	}
	if (request.audioBytes > limits.maxAudioBytes) {
		return {
			limit: 'audioBytes',
			status: 413,
			message: `Export declares ${request.audioBytes} bytes of audio; the limit is ${limits.maxAudioBytes}.`
		};
	}
	const projectedOutputBytes =
		request.frameCount * RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME[request.format];
	if (projectedOutputBytes > limits.maxOutputBytes) {
		return {
			limit: 'outputBytes',
			status: 413,
			message: `A ${request.frameCount}-frame ${request.format} export is projected at ${projectedOutputBytes} bytes; the limit is ${limits.maxOutputBytes}.`
		};
	}
	return null;
}

/**
 * Bytes of the audio bed the page puts in one upload request. The bed is
 * uploaded in ordered parts, because a Film-length bed is larger than the one
 * request body the Node adapter admits (`BODY_SIZE_LIMIT`, which every profile
 * sets to `maxFrameBytes`). Half that ceiling, so a part fits with room to
 * spare; `public-export-limits.test.ts` holds it under every profile's ceiling.
 */
export const EXPORT_AUDIO_UPLOAD_PART_BYTES = 32 * 1024 * 1024;

/**
 * Whether one more part of the audio bed still fits: on its own, under the
 * per-request ceiling, and against the total the session declared when it
 * opened, which admission already held to `maxAudioBytes`. Called once with the
 * declared `Content-Length` before the body is read, then again as bytes
 * arrive, so a caller that lies about its length is cut off at the same bound.
 */
export function findExportAudioPartRejection(
	partBytes: number,
	session: { audioBytesReceived: number; request: { audioBytes: number } },
	limits: PublicExportRuntimeLimits = PUBLIC_EXPORT_RUNTIME_LIMITS
): PublicExportLimitRejection | null {
	if (partBytes > limits.maxFrameBytes) {
		return {
			limit: 'audioPartBytes',
			status: 413,
			message: `Export audio part is ${partBytes} bytes; the limit is ${limits.maxFrameBytes} per request.`
		};
	}
	const audioBytes = session.audioBytesReceived + partBytes;
	if (audioBytes > session.request.audioBytes) {
		return {
			limit: 'audioBytes',
			status: 413,
			message: `Export session has uploaded ${audioBytes} bytes of audio; it declared ${session.request.audioBytes}.`
		};
	}
	return null;
}

/**
 * Bytes one session may ingest in total: its declared audio bed plus one
 * per-frame ceiling for each frame it declared. Frames stream into the encoder
 * and are never stored, so this is not a disk reservation — it is the byte-level
 * backstop for the shape the caller declared.
 *
 * The per-frame ceiling and the frame-index bookkeeping normally bind first, so
 * a well-behaved transport never reaches this one; it holds the guarantee
 * independently of that bookkeeping, which is why it is checked on every chunk.
 */
export function exportSessionUploadCeilingBytes(
	request: { frameCount: number; audioBytes: number },
	limits: PublicExportRuntimeLimits = PUBLIC_EXPORT_RUNTIME_LIMITS
): number {
	return request.audioBytes + request.frameCount * limits.maxFrameBytes;
}

/**
 * Whether a frame body of `frameBytes` still fits, both on its own and against
 * everything the session has already ingested. Called once with the declared
 * `Content-Length` before the body is read, then again as bytes arrive, so a
 * caller that lies about its length is cut off at the same bound.
 */
export function findExportFrameBytesRejection(
	frameBytes: number,
	session: { uploadedBytes: number; uploadCeilingBytes: number },
	limits: PublicExportRuntimeLimits = PUBLIC_EXPORT_RUNTIME_LIMITS
): PublicExportLimitRejection | null {
	if (frameBytes > limits.maxFrameBytes) {
		return {
			limit: 'frameBytes',
			status: 413,
			message: `Export frame is ${frameBytes} bytes; the limit is ${limits.maxFrameBytes} per frame.`
		};
	}
	const sessionBytes = session.uploadedBytes + frameBytes;
	if (sessionBytes > session.uploadCeilingBytes) {
		return {
			limit: 'sessionUploadBytes',
			status: 413,
			message: `Export session has uploaded ${sessionBytes} bytes; its total limit is ${session.uploadCeilingBytes}.`
		};
	}
	return null;
}

/** Whether the encoded output the host produced fits the public output ceiling. */
export function findExportOutputRejection(
	outputBytes: number,
	limits: PublicExportRuntimeLimits = PUBLIC_EXPORT_RUNTIME_LIMITS
): PublicExportLimitRejection | null {
	if (outputBytes <= limits.maxOutputBytes) return null;
	return {
		limit: 'outputBytes',
		status: 413,
		message: `Export output is ${outputBytes} bytes; the limit is ${limits.maxOutputBytes}.`
	};
}

/**
 * Whether a session has outlived one of its two clocks: time since its last
 * activity, or time since it was created. Both answer 410 — the session and its
 * work directory are gone, so the caller opens a new export instead of retrying
 * this one.
 */
export function findExportSessionExpiryRejection(elapsed: {
	idleMs: number;
	ageMs: number;
	idleTimeoutMs: number;
	maxLifetimeMs: number;
}): PublicExportLimitRejection | null {
	if (elapsed.ageMs >= elapsed.maxLifetimeMs) {
		return {
			limit: 'sessionLifetimeMs',
			status: 410,
			message: `Export session passed its ${elapsed.maxLifetimeMs} ms lifetime and was removed. Start a new export.`
		};
	}
	if (elapsed.idleMs >= elapsed.idleTimeoutMs) {
		return {
			limit: 'sessionIdleMs',
			status: 410,
			message: `Export session was idle longer than ${elapsed.idleTimeoutMs} ms and was removed. Start a new export.`
		};
	}
	return null;
}
