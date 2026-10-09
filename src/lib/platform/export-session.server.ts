import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Writable } from 'node:stream';

import * as Sentry from '@sentry/sveltekit';
import { createReadableStream } from '@sveltejs/kit/node';

import {
	EXPORT_CLEANUP_RECEIPT_HISTORY,
	exportCleanupReasonForExpiry,
	findExportCleanupLeak,
	type ExportCleanupReason,
	type ExportCleanupReceipt
} from '$lib/platform/public-export-cleanup';
import {
	exportSessionUploadCeilingBytes,
	findExportAudioPartRejection,
	findExportConcurrencyRejection,
	findExportControlDocumentRejection,
	findExportEnvelopeRejection,
	findExportFrameBytesRejection,
	findExportOutputRejection,
	findExportSessionExpiryRejection,
	type PublicExportLimitRejection
} from '$lib/platform/public-export-limits';
import {
	createExportSessionIdentity,
	EXPORT_ENCODER_FAILURE_MESSAGE,
	findExportRequestOriginRefusal,
	FOREIGN_EXPORT_SESSION_CREDENTIAL_REFUSAL,
	formatExportSessionCredentialCookie,
	isExportSessionIdentity,
	isMatchingExportCredential,
	MISSING_EXPORT_SESSION_CREDENTIAL_REFUSAL,
	PUBLIC_EXPORT_DOWNLOAD_HEADERS,
	readExportSessionCredentialCookie,
	redactExportDiagnostic,
	type PublicExportSecurityRefusal
} from '$lib/platform/public-export-security';
import {
	parsePublicRuntimeConfig,
	PUBLIC_EXPORT_RUNTIME_LIMITS,
	type PublicExportRuntimeLimits
} from '$lib/platform/public-runtime-contract';
import {
	exportRuntimeLimitsForProfile,
	parsePublicRuntimeProfile
} from '$lib/platform/public-runtime-deployment';
import {
	dropTimecodeToFrames,
	formatFrameRateRational,
	isDropTimecode,
	isNonDropTimecode,
	resolveFrameRate,
	type FrameRate
} from '$lib/utils/composition-timing';
import {
	isSweptExportDirectoryName,
	type SweptExportDirectoryPrefix
} from '$lib/utils/legacy-supers-compatibility';

export type ExportSessionFormat = 'webm' | 'prores';

export interface ExportSessionRequest {
	format: ExportSessionFormat;
	fps: number;
	frameCount: number;
	opaque: boolean;
	audioBytes: number;
	startTimecode?: string;
}

export interface CreatedExportSession {
	sessionId: string;
	audioUrl: string;
	frameUrlTemplate: string;
	completeUrl: string;
	cancelUrl: string;
}

export interface OpenedExportSession {
	document: CreatedExportSession;
	/**
	 * `Set-Cookie` value the create response must send. It carries the private
	 * credential every later request for this session has to present, and it is
	 * the only place that credential ever appears.
	 */
	credentialCookie: string;
}

export interface CompletedExportSession {
	downloadUrl: string;
}

interface ExportEncoder {
	child: ChildProcessWithoutNullStreams;
	exit: Promise<number>;
	hasExited: boolean;
	stderrTail: string;
}

interface ExportSession {
	id: string;
	/** Private per-session secret; only the browser that opened the session holds it. */
	credential: string;
	request: ExportSessionRequest;
	rate: FrameRate;
	workDir: string;
	audioPath: string;
	outputPath: string;
	nextFrame: number;
	/**
	 * Bytes of the audio bed written to `audioPath` so far. Parts arrive in
	 * order, so this is also the byte the next part has to start on.
	 */
	audioBytesReceived: number;
	/** True once the whole declared bed has arrived. */
	hasAudio: boolean;
	isBusy: boolean;
	status: 'created' | 'encoding' | 'ready' | 'downloading';
	encoder: ExportEncoder | null;
	abortController: AbortController;
	createdAt: number;
	lastActiveAt: number;
	/** Audio plus frame bytes this session has ingested, against its ceiling. */
	uploadedBytes: number;
	uploadCeilingBytes: number;
	idleTimer: ReturnType<typeof setTimeout> | null;
	lifetimeTimer: ReturnType<typeof setTimeout> | null;
	/**
	 * Ends an in-flight download: releases the descriptor the response is reading
	 * the output through and closes the body. Set for as long as a download is
	 * streaming, so a disposal is not reduced to unlinking a file another part of
	 * the same process is still holding open.
	 */
	closeDownload: (() => Promise<void>) | null;
	cleanupPromise: Promise<ExportCleanupReceipt> | null;
	encodeStartedAt: number | null;
}

/**
 * Whether this session has work in flight — a draining download, an upload being
 * written to the encoder, or an encode being flushed by `complete`.
 *
 * The idle clock exists to collect sessions nobody is working on, so it must not
 * measure the tail of an encode. `complete` touches the session once and then
 * waits for ffmpeg to drain every frame already buffered on its stdin, with no
 * further request arriving to touch it; a long lossless 4K flush outlives the
 * idle window, and the sweep that fires then SIGKILLs the encoder mid-write. A
 * signalled child reports no exit code, so the kill reaches `complete` as exit
 * code 1 and the caller is told its encoder failed rather than that its session
 * expired — the bare 500 of GFX-COMPUTER-1D, which loses the finished frames.
 *
 * The hard lifetime still applies, and remains the only clock that can end work
 * that never finishes.
 */
function isExportSessionActive(session: ExportSession): boolean {
	return session.status === 'downloading' || session.isBusy;
}

interface ExportSessionStoreOptions {
	temporaryDirectory?: string;
	ffmpegPath?: string;
	ttlMs?: number;
	maxLifetimeMs?: number;
	maxConcurrentSessions?: number;
	/**
	 * Envelope to admit against. Absent, it is the one the host's runtime profile
	 * serves. Shrink it to exercise a bound in a fixture.
	 */
	limits?: PublicExportRuntimeLimits;
	now?: () => number;
	spawnEncoder?: typeof spawn;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/**
 * The prefix this build's private export work directories are created under.
 * The sweep below matches every prefix in `SWEPT_EXPORT_DIRECTORY_PREFIXES`,
 * not just this one, so a deploy or rollback across the ADR-0053 namespace
 * rename cannot orphan the previous release's directories.
 */
const EXPORT_DIRECTORY_PREFIX = 'gfx-export-' satisfies SweptExportDirectoryPrefix;

/**
 * How long a disposal waits for a killed encoder to be reaped. `SIGKILL` cannot
 * be caught, so a child still running after this is a host-level problem the
 * cleanup receipt has to name rather than a wait worth extending.
 */
const ENCODER_TERMINATION_GRACE_MS = 2_000;

export class ExportSessionError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ExportSessionError';
	}
}

/** Carry a refused public bound out over the export transport unchanged. */
function limitError(rejection: PublicExportLimitRejection): ExportSessionError {
	return new ExportSessionError(rejection.status, rejection.message);
}

/** Carry a refused request out over the same transport, with the same redaction. */
function securityError(refusal: PublicExportSecurityRefusal): ExportSessionError {
	return new ExportSessionError(refusal.status, refusal.message);
}

/**
 * What a caller is told when the session it was uploading to ended underneath
 * it — the same answer `#get` gives a caller naming a session that is already
 * gone, because by the time this is thrown the session is being disposed.
 */
const EXPORT_SESSION_CANCELLED_MESSAGE = 'Export session was cancelled.';

/**
 * Decide what an interrupted upload or encode owes its caller, read *before* the
 * session is disposed.
 *
 * A session cancelled mid-upload — by its owner, by a clock, by shutdown — and a
 * caller that hung up both surface as whichever error the aborted stream
 * happened to reject with: the `AbortError` this store's own controller carries,
 * or Node's bare `aborted` when the socket died mid-body. Neither is a fault of
 * this origin, so both answer 410 rather than escaping the route as an
 * unhandled 500 the way they did through SUPERS-28 and SUPERS-27, and the three
 * 500s those two produced (SUPERS-26, SUPERS-29, SUPERS-2A).
 *
 * Order is the whole point of reading the signals here: disposal aborts the
 * session's own controller, so classifying after it would relabel every
 * deliberate refusal a cancellation. An `ExportSessionError` is already a
 * considered answer and is kept exactly as it is, and anything else that is not
 * an abort stays raw — a genuine server fault still has to be reported as one.
 */
function classifyExportSessionFailure(
	session: ExportSession,
	request: Request,
	cause: unknown
): unknown {
	if (cause instanceof ExportSessionError) return cause;
	if (session.abortController.signal.aborted || request.signal.aborted) {
		return new ExportSessionError(410, EXPORT_SESSION_CANCELLED_MESSAGE);
	}
	return cause;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new ExportSessionError(400, `Expected ${key} to be a finite number.`);
	}
	return value;
}

/** Parse the small JSON control document before allocating a session. */
export function parseExportSessionRequest(value: unknown): ExportSessionRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ExportSessionError(400, 'Expected an export session object.');
	}
	const record = value as Record<string, unknown>;
	const format = record.format;
	if (format !== 'webm' && format !== 'prores') {
		throw new ExportSessionError(400, 'Expected format to be webm or prores.');
	}
	const fps = readFiniteNumber(record, 'fps');
	try {
		resolveFrameRate(fps);
	} catch (cause) {
		throw new ExportSessionError(400, cause instanceof Error ? cause.message : 'Unsupported fps.');
	}
	// Shape only — every ceiling belongs to the public envelope, which
	// `ExportSessionStore.create` applies to the parsed request.
	const frameCount = readFiniteNumber(record, 'frameCount');
	if (!Number.isInteger(frameCount) || frameCount < 1) {
		throw new ExportSessionError(400, 'Expected frameCount to be a positive integer.');
	}
	const audioBytes = readFiniteNumber(record, 'audioBytes');
	if (!Number.isSafeInteger(audioBytes) || audioBytes < 0) {
		throw new ExportSessionError(400, 'Expected audioBytes to be a non-negative safe integer.');
	}
	if (typeof record.opaque !== 'boolean') {
		throw new ExportSessionError(400, 'Expected opaque to be a boolean.');
	}
	const startTimecode = record.startTimecode;
	if (startTimecode !== undefined) {
		if (format !== 'prores') {
			throw new ExportSessionError(400, 'A start timecode requires the ProRes format.');
		}
		if (typeof startTimecode !== 'string') {
			throw new ExportSessionError(400, 'Expected an HH:MM:SS:FF or HH:MM:SS;FF start timecode.');
		}
		if (isDropTimecode(startTimecode)) {
			// DF is only defined at 29.97/59.94 and its first minute labels don't
			// all exist — the conversion validates both before ffmpeg sees the TC.
			try {
				dropTimecodeToFrames(startTimecode, resolveFrameRate(fps));
			} catch (cause) {
				throw new ExportSessionError(
					400,
					cause instanceof Error ? cause.message : 'Invalid drop-frame start timecode.'
				);
			}
		} else if (!isNonDropTimecode(startTimecode)) {
			throw new ExportSessionError(400, 'Expected an HH:MM:SS:FF or HH:MM:SS;FF start timecode.');
		}
	}
	return { format, fps, frameCount, opaque: record.opaque, audioBytes, startTimecode };
}

export function parseExportFrameIndex(value: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ExportSessionError(400, `Invalid export frame index "${value}".`);
	}
	const frame = Number(value);
	if (!Number.isSafeInteger(frame)) {
		throw new ExportSessionError(400, `Invalid export frame index "${value}".`);
	}
	return frame;
}

/**
 * The byte an audio part says it starts on: the `offset` query parameter of the
 * session's audio URL. A request that names none starts at byte 0, so a bed
 * that fits one request is uploaded with one plain `PUT`.
 */
export function parseExportAudioOffset(value: string | null): number {
	if (value === null) return 0;
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ExportSessionError(400, `Invalid export audio offset "${value}".`);
	}
	const offset = Number(value);
	if (!Number.isSafeInteger(offset)) {
		throw new ExportSessionError(400, `Invalid export audio offset "${value}".`);
	}
	return offset;
}

export function hasPngSignature(bytes: Uint8Array): boolean {
	return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * What the origin check reads off one request. `request.url` is the URL the
 * SvelteKit Node adapter resolved from `ORIGIN`, so the expected origin comes
 * from the deployment's own configuration — never from a `Host` or
 * `X-Forwarded-*` header a caller or an intermediary can set.
 */
function exportRequestOrigins(request: Request): {
	method: string;
	origin: string | null;
	secFetchSite: string | null;
	expectedOrigin: string;
} {
	return {
		method: request.method,
		origin: request.headers.get('origin'),
		secFetchSite: request.headers.get('sec-fetch-site'),
		expectedOrigin: new URL(request.url).origin
	};
}

function contentLength(request: Request): number | null {
	const header = request.headers.get('content-length');
	if (header === null) return null;
	const value = Number(header);
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

async function writeWithBackpressure(
	writable: Writable,
	chunk: Uint8Array,
	signal: AbortSignal
): Promise<void> {
	signal.throwIfAborted();
	await new Promise<void>((resolve, reject) => {
		let isSettled = false;
		const settle = (error?: Error | null): void => {
			if (isSettled) return;
			isSettled = true;
			signal.removeEventListener('abort', handleAbort);
			if (error) reject(error);
			else resolve();
		};
		const handleAbort = (): void => settle(abortError(signal));
		signal.addEventListener('abort', handleAbort, { once: true });
		writable.write(chunk, (error) => settle(error));
	});
}

async function finishWritable(writable: Writable, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	await new Promise<void>((resolve, reject) => {
		let isSettled = false;
		const settle = (error?: Error): void => {
			if (isSettled) return;
			isSettled = true;
			writable.off('error', handleError);
			writable.off('finish', handleFinish);
			signal.removeEventListener('abort', handleAbort);
			if (error) reject(error);
			else resolve();
		};
		const handleError = (error: Error): void => settle(error);
		const handleFinish = (): void => settle();
		const handleAbort = (): void => settle(abortError(signal));
		writable.once('error', handleError);
		writable.once('finish', handleFinish);
		signal.addEventListener('abort', handleAbort, { once: true });
		writable.end();
	});
}

async function streamRequestBody(options: {
	body: ReadableStream<Uint8Array>;
	writable: Writable;
	signal: AbortSignal;
	expectedBytes?: number;
	/** Applied to the running byte count, so a lying Content-Length is cut off here. */
	findOverflow?: (receivedBytes: number) => PublicExportLimitRejection | null;
	requirePngSignature?: boolean;
}): Promise<number> {
	const { body, writable, signal, expectedBytes, findOverflow, requirePngSignature } = options;
	const reader = body.getReader();
	let received = 0;
	let signature = new Uint8Array(0);
	let didFinish = false;
	const handleAbort = (): void => {
		void reader.cancel(signal.reason).catch(() => undefined);
	};
	signal.addEventListener('abort', handleAbort, { once: true });
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (expectedBytes !== undefined && received > expectedBytes) {
				throw new ExportSessionError(413, 'Export upload exceeded its declared byte length.');
			}
			const overflow = findOverflow?.(received);
			if (overflow) throw limitError(overflow);
			if (requirePngSignature && signature.byteLength < PNG_SIGNATURE.byteLength) {
				const required = PNG_SIGNATURE.byteLength - signature.byteLength;
				const consumed = Math.min(required, value.byteLength);
				const next = new Uint8Array(signature.byteLength + consumed);
				next.set(signature);
				next.set(value.subarray(0, consumed), signature.byteLength);
				signature = next;
				if (signature.byteLength < PNG_SIGNATURE.byteLength) continue;
				if (!hasPngSignature(signature)) {
					throw new ExportSessionError(415, 'Export frame body is not a PNG image.');
				}
				await writeWithBackpressure(writable, signature, signal);
				if (consumed < value.byteLength) {
					await writeWithBackpressure(writable, value.subarray(consumed), signal);
				}
				continue;
			}
			await writeWithBackpressure(writable, value, signal);
		}
		signal.throwIfAborted();
		if (requirePngSignature && signature.byteLength < PNG_SIGNATURE.byteLength) {
			throw new ExportSessionError(415, 'Export frame body is not a PNG image.');
		}
		if (expectedBytes !== undefined && received !== expectedBytes) {
			throw new ExportSessionError(
				400,
				`Export upload ended at ${received} bytes; expected ${expectedBytes}.`
			);
		}
		didFinish = true;
		return received;
	} finally {
		signal.removeEventListener('abort', handleAbort);
		if (!didFinish) await reader.cancel(signal.reason).catch(() => undefined);
		reader.releaseLock();
	}
}

function outputDetails(format: ExportSessionFormat): {
	filename: string;
	contentType: string;
} {
	return format === 'webm'
		? { filename: 'output.webm', contentType: 'video/webm' }
		: { filename: 'output.mov', contentType: 'video/quicktime' };
}

/**
 * Shape and cost of a requested export — never content, filenames, paths, or
 * session identities. Every key must stay inside
 * `PUBLIC_EXPORT_TELEMETRY_ATTRIBUTE_KEYS` (ADR-0052).
 */
export function exportSessionRequestTelemetry(
	request: ExportSessionRequest
): Record<string, string | number | boolean> {
	return {
		'export.format': request.format,
		'export.fps': formatFrameRateRational(resolveFrameRate(request.fps)),
		'export.frames': request.frameCount,
		'export.audio_bytes': request.audioBytes,
		'export.opaque': request.opaque,
		'export.has_timecode': request.startTimecode !== undefined
	};
}

/** Encode cost of a finished export, under the same redaction rule. */
export function exportSessionEncodeTelemetry(
	encodeMs: number,
	outputBytes: number
): Record<string, number> {
	return { 'export.ffmpeg_ms': encodeMs, 'export.output_bytes': outputBytes };
}

export class ExportSessionStore {
	readonly #sessions = new Map<string, ExportSession>();
	readonly #cleanupReceipts: ExportCleanupReceipt[] = [];
	readonly #temporaryDirectory: string;
	readonly #ffmpegPath: string;
	readonly #ttlMs: number;
	readonly #maxLifetimeMs: number;
	readonly #maxConcurrentSessions: number;
	readonly #limits: PublicExportRuntimeLimits;
	readonly #now: () => number;
	readonly #spawnEncoder: typeof spawn;

	constructor(options: ExportSessionStoreOptions = {}) {
		const runtime = parsePublicRuntimeConfig(process.env);
		this.#temporaryDirectory =
			options.temporaryDirectory ?? runtime.exportTemporaryDirectory ?? tmpdir();
		this.#ffmpegPath = options.ffmpegPath ?? runtime.ffmpegPath;
		// The envelope follows the profile, read from the same environment the
		// `init` hook validated: a development host admits a Film-length export,
		// and a public host keeps the ratified fifteen seconds (ADR-0068 §9).
		this.#limits =
			options.limits ?? exportRuntimeLimitsForProfile(parsePublicRuntimeProfile(process.env));
		this.#ttlMs = options.ttlMs ?? runtime.exportSessionIdleTimeoutMs;
		this.#maxLifetimeMs = options.maxLifetimeMs ?? this.#limits.sessionMaxLifetimeMs;
		this.#maxConcurrentSessions =
			options.maxConcurrentSessions ?? runtime.maxConcurrentExportSessions;
		this.#now = options.now ?? Date.now;
		this.#spawnEncoder = options.spawnEncoder ?? spawn;
	}

	/**
	 * Sessions this process is holding open. In-process only: the export
	 * collection endpoint accepts `POST` and nothing else, so open sessions stay
	 * unlistable over the transport (ADR-0052).
	 */
	get openSessionCount(): number {
		return this.#sessions.size;
	}

	/**
	 * The limits this store really enforces: its envelope, with the concurrency,
	 * idle timeout, and lifetime the host configured in place of the defaults.
	 * `/api/export/limits` serves this, so what a page or an agent is told is what
	 * a session is held to.
	 */
	get servedLimits(): PublicExportRuntimeLimits {
		return {
			...this.#limits,
			maxConcurrentSessions: this.#maxConcurrentSessions,
			sessionIdleTimeoutMs: this.#ttlMs,
			sessionMaxLifetimeMs: this.#maxLifetimeMs
		};
	}

	/** The most recent disposals and what each one released. */
	get cleanupReceipts(): readonly ExportCleanupReceipt[] {
		return [...this.#cleanupReceipts];
	}

	/**
	 * Admit one export session, or refuse it. Every bound is decided here — the
	 * caller's origin, transport shape, the served envelope, then a free
	 * concurrency slot — so nothing that will be refused ever reaches ffmpeg or
	 * the filesystem. The slot is claimed in the same tick it is checked, so two
	 * callers racing for the last one cannot both win it.
	 */
	async create(request: Request): Promise<OpenedExportSession> {
		const refusal = findExportRequestOriginRefusal(exportRequestOrigins(request));
		if (refusal) throw securityError(refusal);
		if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
			throw new ExportSessionError(415, 'Expected application/json export session metadata.');
		}
		const declaredLength = contentLength(request);
		const oversizedDocument = findExportControlDocumentRejection(declaredLength);
		if (oversizedDocument) throw limitError(oversizedDocument);

		let document: unknown;
		try {
			document = await request.json();
		} catch {
			throw new ExportSessionError(400, 'Export session metadata is not valid JSON.');
		}
		const parsed = parseExportSessionRequest(document);
		const overEnvelope = findExportEnvelopeRejection(parsed, this.#limits);
		if (overEnvelope) throw limitError(overEnvelope);

		await this.cleanupStale();
		const saturated = findExportConcurrencyRejection(
			this.#sessions.size,
			this.#maxConcurrentSessions
		);
		if (saturated) throw limitError(saturated);

		Sentry.getActiveSpan()?.setAttributes(exportSessionRequestTelemetry(parsed));
		// Both identities are unpredictable, and only this one is ever spoken
		// aloud: it names the session in URLs and therefore in logs, while the
		// credential stays in the cookie that authorizes every later request.
		const id = createExportSessionIdentity();
		const workDir = join(this.#temporaryDirectory, `${EXPORT_DIRECTORY_PREFIX}${id}`);
		const details = outputDetails(parsed.format);
		const now = this.#now();
		const session: ExportSession = {
			id,
			credential: createExportSessionIdentity(),
			request: parsed,
			rate: resolveFrameRate(parsed.fps),
			workDir,
			audioPath: join(workDir, 'mix.wav'),
			outputPath: join(workDir, details.filename),
			nextFrame: 0,
			audioBytesReceived: 0,
			hasAudio: false,
			isBusy: false,
			status: 'created',
			encoder: null,
			abortController: new AbortController(),
			createdAt: now,
			lastActiveAt: now,
			uploadedBytes: 0,
			uploadCeilingBytes: exportSessionUploadCeilingBytes(parsed, this.#limits),
			idleTimer: null,
			lifetimeTimer: null,
			closeDownload: null,
			cleanupPromise: null,
			encodeStartedAt: null
		};
		this.#sessions.set(id, session);
		try {
			await mkdir(workDir, { recursive: false });
		} catch (cause) {
			// A half-created session is a terminal path like any other, so it is
			// disposed rather than merely forgotten. The failure names the private
			// work directory, so the caller is told only that the session could not
			// be opened.
			await this.#dispose(session, 'failed');
			console.error('Export work directory could not be created.', this.#redact(session, cause));
			throw new ExportSessionError(500, 'Export session could not be opened.');
		}
		this.#touch(session);
		session.lifetimeTimer = this.#scheduleSweep(this.#maxLifetimeMs);
		const root = `/api/export/sessions/${id}`;
		return {
			document: {
				sessionId: id,
				audioUrl: `${root}/audio`,
				frameUrlTemplate: `${root}/frames/{frame}`,
				completeUrl: `${root}/complete`,
				cancelUrl: root
			},
			credentialCookie: formatExportSessionCredentialCookie({
				sessionId: id,
				credential: session.credential,
				maxAgeMs: this.#maxLifetimeMs,
				isSecureOrigin: new URL(request.url).protocol === 'https:'
			})
		};
	}

	/**
	 * Take one part of the session's audio bed and append it to the bed on disk.
	 *
	 * The bed arrives in ordered parts, each its own request under the adapter's
	 * body ceiling, because a Film-length bed is larger than one request may be.
	 * `offset` is the byte the part starts on and must be the byte the session
	 * has reached: a part that skips ahead or repeats is refused and changes
	 * nothing, as an out-of-order frame is. The bed is complete when the bytes
	 * the session declared have arrived, and only then are frames accepted. A bed
	 * that fits one request is one part from byte 0.
	 *
	 * A part that would carry the bed past its declared total, or that is larger
	 * than one request may be, ends the session with the limit it missed.
	 */
	async uploadAudio(id: string, offset: number, request: Request): Promise<void> {
		const session = await this.#authorize(id, request);
		if (session.request.audioBytes === 0) {
			throw new ExportSessionError(409, 'This export session has no audio upload.');
		}
		if (session.hasAudio || session.encoder || session.isBusy) {
			throw new ExportSessionError(409, 'Export audio was already uploaded or encoding started.');
		}
		if (offset !== session.audioBytesReceived) {
			throw new ExportSessionError(
				409,
				`Expected export audio from byte ${session.audioBytesReceived}, received byte ${offset}.`
			);
		}
		if (request.headers.get('content-type')?.split(';', 1)[0] !== 'audio/wav') {
			await this.#dispose(session, 'failed');
			throw new ExportSessionError(415, 'Expected audio/wav export audio.');
		}
		if (!request.body) {
			await this.#dispose(session, 'failed');
			throw new ExportSessionError(400, 'Missing export audio body.');
		}
		const declaredLength = contentLength(request);
		// Refuse an over-limit part from its declared length, before a byte of the
		// body is read or written.
		const declaredOverflow =
			declaredLength === null
				? null
				: findExportAudioPartRejection(declaredLength, session, this.#limits);
		if (declaredOverflow) {
			await this.#dispose(session, 'failed');
			throw limitError(declaredOverflow);
		}

		session.isBusy = true;
		this.#touch(session);
		// The first part creates the bed and must find no file; every later part
		// appends to the one the first made.
		const file = createWriteStream(session.audioPath, {
			flags: session.audioBytesReceived === 0 ? 'wx' : 'a'
		});
		const signal = AbortSignal.any([session.abortController.signal, request.signal]);
		try {
			const partBytes = await streamRequestBody({
				body: request.body,
				writable: file,
				signal,
				expectedBytes: declaredLength ?? undefined,
				findOverflow: (receivedBytes) =>
					findExportAudioPartRejection(receivedBytes, session, this.#limits)
			});
			await finishWritable(file, signal);
			if (partBytes === 0) {
				throw new ExportSessionError(400, 'Export audio part is empty.');
			}
			session.audioBytesReceived += partBytes;
			session.uploadedBytes += partBytes;
			session.hasAudio = session.audioBytesReceived === session.request.audioBytes;
		} catch (cause) {
			const failure = classifyExportSessionFailure(session, request, cause);
			file.destroy();
			await this.#dispose(session, 'failed');
			throw failure;
		} finally {
			session.isBusy = false;
		}
	}

	async uploadFrame(id: string, frame: number, request: Request): Promise<void> {
		const session = await this.#authorize(id, request);
		if (session.status === 'ready' || session.status === 'downloading') {
			throw new ExportSessionError(409, 'Export encoding is already complete.');
		}
		if (session.isBusy) {
			throw new ExportSessionError(409, 'Another export upload is still being encoded.');
		}
		if (frame !== session.nextFrame) {
			throw new ExportSessionError(
				409,
				`Expected export frame ${session.nextFrame}, received ${frame}.`
			);
		}
		if (frame >= session.request.frameCount) {
			throw new ExportSessionError(409, `Export expects ${session.request.frameCount} frames.`);
		}
		if (session.request.audioBytes > 0 && !session.hasAudio) {
			throw new ExportSessionError(409, 'Upload export audio before the first frame.');
		}
		if (request.headers.get('content-type')?.split(';', 1)[0] !== 'image/png') {
			await this.#dispose(session, 'failed');
			throw new ExportSessionError(415, 'Expected an image/png export frame.');
		}
		if (!request.body) {
			await this.#dispose(session, 'failed');
			throw new ExportSessionError(400, 'Missing export frame body.');
		}
		const declaredLength = contentLength(request);
		if (declaredLength !== null && declaredLength < PNG_SIGNATURE.byteLength) {
			await this.#dispose(session, 'failed');
			throw new ExportSessionError(
				400,
				'Export frame Content-Length is shorter than a PNG header.'
			);
		}
		// Refuse an over-limit frame from its declared length, before the encoder
		// is spawned and before a byte of the body is read.
		const declaredOverflow =
			declaredLength === null
				? null
				: findExportFrameBytesRejection(declaredLength, session, this.#limits);
		if (declaredOverflow) {
			await this.#dispose(session, 'failed');
			throw limitError(declaredOverflow);
		}

		session.isBusy = true;
		this.#touch(session);
		try {
			const encoder = session.encoder ?? this.#startEncoder(session);
			const signal = AbortSignal.any([session.abortController.signal, request.signal]);
			session.uploadedBytes += await streamRequestBody({
				body: request.body,
				writable: encoder.child.stdin,
				signal,
				// A declared length is held to exactly, so a body that stops short of
				// what it promised is refused instead of encoded as a torn frame.
				expectedBytes: declaredLength ?? undefined,
				findOverflow: (receivedBytes) =>
					findExportFrameBytesRejection(receivedBytes, session, this.#limits),
				requirePngSignature: true
			});
			session.nextFrame += 1;
			session.status = 'encoding';
		} catch (cause) {
			const failure = classifyExportSessionFailure(session, request, cause);
			await this.#dispose(session, 'failed');
			throw failure;
		} finally {
			session.isBusy = false;
		}
	}

	async complete(id: string, request: Request): Promise<CompletedExportSession> {
		const session = await this.#authorize(id, request);
		if (session.isBusy) {
			throw new ExportSessionError(409, 'An export upload is still being encoded.');
		}
		if (session.nextFrame !== session.request.frameCount) {
			throw new ExportSessionError(
				409,
				`Export is missing frames: received ${session.nextFrame} of ${session.request.frameCount}.`
			);
		}
		if (!session.encoder) {
			throw new ExportSessionError(409, 'Export encoder did not start.');
		}
		session.isBusy = true;
		this.#touch(session);
		try {
			const encoder = session.encoder;
			await finishWritable(encoder.child.stdin, session.abortController.signal);
			const code = await encoder.exit;
			if (code !== 0) {
				// ffmpeg names the file it was writing, so its output is logged
				// redacted at the origin and never forwarded to the caller.
				console.error(
					`Export encoder exited with code ${code}.`,
					this.#redact(session, encoder.stderrTail.trim())
				);
				throw new ExportSessionError(500, EXPORT_ENCODER_FAILURE_MESSAGE);
			}
			const output = await stat(session.outputPath);
			if (!output.isFile() || output.size === 0) {
				throw new ExportSessionError(500, 'ffmpeg did not produce an export output.');
			}
			const oversizedOutput = findExportOutputRejection(output.size, this.#limits);
			if (oversizedOutput) throw limitError(oversizedOutput);
			Sentry.getActiveSpan()?.setAttributes(
				exportSessionEncodeTelemetry(
					session.encodeStartedAt ? Date.now() - session.encodeStartedAt : 0,
					output.size
				)
			);
			session.status = 'ready';
			return { downloadUrl: `/api/export/sessions/${id}/output` };
		} catch (cause) {
			const failure = classifyExportSessionFailure(session, request, cause);
			await this.#dispose(session, 'failed');
			throw failure;
		} finally {
			session.isBusy = false;
		}
	}

	/**
	 * Stream one session's output exactly once to the browser that owns it. The
	 * session is disposed as the body finishes, so a replayed download — the same
	 * URL and the same credential a second time — finds nothing to read.
	 */
	async outputResponse(id: string, request: Request): Promise<Response> {
		const session = await this.#authorize(id, request);
		const requestSignal = request.signal;
		if (session.status !== 'ready') {
			throw new ExportSessionError(409, 'Export output is not ready.');
		}
		session.status = 'downloading';
		if (session.idleTimer) clearTimeout(session.idleTimer);
		session.idleTimer = null;
		const output = await stat(session.outputPath);
		const source = createReadableStream(session.outputPath);
		const reader = source.getReader();
		let isCleaned = false;
		const cleanup = async (reason: ExportCleanupReason): Promise<void> => {
			if (isCleaned) return;
			isCleaned = true;
			requestSignal.removeEventListener('abort', handleAbort);
			// The response is already ending along its own path — drained, cancelled
			// by its consumer, or aborted with the request — so the disposal has no
			// download left to close.
			session.closeDownload = null;
			await this.#dispose(session, reason);
		};
		const handleAbort = (): void => {
			void Promise.all([
				reader.cancel(requestSignal.reason).catch(() => undefined),
				cleanup('cancelled')
			]);
		};
		requestSignal.addEventListener('abort', handleAbort, { once: true });
		let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
		const body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				bodyController = controller;
			},
			pull: async (controller) => {
				try {
					const chunk = await reader.read();
					if (chunk.done) {
						await cleanup('downloaded');
						controller.close();
					} else {
						controller.enqueue(chunk.value);
					}
				} catch (cause) {
					controller.error(cause);
					await cleanup('failed');
				}
			},
			cancel: async (reason) => {
				await Promise.all([reader.cancel(reason).catch(() => undefined), cleanup('cancelled')]);
			}
		});
		// A transfer that never drains is ended by the hard lifetime rather than
		// waiting on a consumer that stopped pulling. Releasing the descriptor is
		// what makes the removal below a removal: on POSIX an unlinked file that is
		// still open keeps its blocks, so an output nobody closed would outlive the
		// session that owned it.
		session.closeDownload = async (): Promise<void> => {
			await reader.cancel(new DOMException('Export session ended.', 'AbortError'));
			bodyController?.error(new DOMException('Export session ended.', 'AbortError'));
		};
		return new Response(body, {
			headers: {
				...PUBLIC_EXPORT_DOWNLOAD_HEADERS,
				'Content-Length': String(output.size),
				'Content-Type': outputDetails(session.request.format).contentType
			}
		});
	}

	/**
	 * Give up one session on its owner's word. A session that is already gone is
	 * the outcome the caller asked for, so it is not an error — but a caller who
	 * cannot prove the session is theirs is still refused.
	 */
	async cancel(id: string, request: Request): Promise<void> {
		let session: ExportSession;
		try {
			session = await this.#authorize(id, request);
		} catch (cause) {
			if (cause instanceof ExportSessionError && (cause.status === 404 || cause.status === 410)) {
				return;
			}
			throw cause;
		}
		await this.#dispose(session, 'cancelled');
	}

	/**
	 * Remove every session that outlived a clock. A session with work in flight is
	 * exempt from the idle timeout — it is active by definition — but not from the
	 * hard lifetime, which exists precisely to end work that never finishes.
	 */
	async cleanupStale(now = this.#now()): Promise<number> {
		const stale: { session: ExportSession; reason: ExportCleanupReason }[] = [];
		for (const session of this.#sessions.values()) {
			const expiry = this.#findExpiry(session, now);
			if (expiry) stale.push({ session, reason: exportCleanupReasonForExpiry(expiry.limit) });
		}
		await Promise.all(stale.map(({ session, reason }) => this.#dispose(session, reason)));
		return stale.length;
	}

	/**
	 * Release every open session because the host is going away. An encode in
	 * flight when a container is signalled has no visitor left to hand output to,
	 * and its ffmpeg child would otherwise keep the process alive past the
	 * orchestrator's grace period and turn a graceful stop into a kill.
	 *
	 * The orphan sweep remains the guarantee, not this: a host that is killed
	 * outright never runs it, and its directories are collected by whichever
	 * process comes next.
	 */
	async disposeOpenSessions(): Promise<readonly ExportCleanupReceipt[]> {
		return Promise.all(
			[...this.#sessions.values()].map((session) => this.#dispose(session, 'shutdown'))
		);
	}

	/**
	 * Remove work directories no live session owns. A session that is still
	 * draining a download has not written to its directory since the encode
	 * finished, so age alone would collect it out from under the transfer; the
	 * live set is what keeps the sweep to genuinely abandoned directories.
	 */
	async sweepOrphanedDirectories(now = Date.now()): Promise<number> {
		return cleanupOrphanedExportDirectories(
			this.#temporaryDirectory,
			this.#ttlMs,
			now,
			new Set([...this.#sessions.values()].map((session) => basename(session.workDir)))
		);
	}

	#startEncoder(session: ExportSession): ExportEncoder {
		const args = this.#ffmpegArguments(session);
		const child = this.#spawnEncoder(this.#ffmpegPath, args);
		session.encodeStartedAt = Date.now();
		const encoder: ExportEncoder = {
			child,
			exit: Promise.resolve(0),
			hasExited: false,
			stderrTail: ''
		};
		child.stderr.on('data', (chunk: Buffer | string) => {
			encoder.stderrTail = `${encoder.stderrTail}${chunk.toString()}`.slice(-2000);
		});
		// An encoder that died answers the next write with EPIPE on its stdin
		// socket, as both a write-callback error and an `error` event. The callback
		// already carries the failure into the upload that caused it and ends the
		// session; this listener is what keeps the same error from reaching the
		// process unhandled and taking the whole host down with one crashed encode.
		child.stdin.on('error', (error: Error) => {
			encoder.stderrTail = `${encoder.stderrTail}${error.message}`.slice(-2000);
		});
		encoder.exit = new Promise<number>((resolve) => {
			let isSettled = false;
			const settle = (code: number): void => {
				if (isSettled) return;
				isSettled = true;
				resolve(code);
			};
			child.once('error', (error) => {
				encoder.stderrTail = `${encoder.stderrTail}${error.message}`.slice(-2000);
				settle(1);
			});
			child.once('close', (code) => settle(code ?? 1));
		}).finally(() => {
			encoder.hasExited = true;
		});
		session.encoder = encoder;
		return encoder;
	}

	#ffmpegArguments(session: ExportSession): string[] {
		const { format, opaque, startTimecode, audioBytes } = session.request;
		const audioArguments =
			audioBytes > 0
				? format === 'webm'
					? ['-i', session.audioPath, '-map', '0:v', '-map', '1:a', '-c:a', 'libopus']
					: ['-i', session.audioPath, '-map', '0:v', '-map', '1:a', '-c:a', 'pcm_s16le']
				: [];
		const codecArguments =
			format === 'webm'
				? [
						'-c:v',
						'libvpx-vp9',
						'-lossless',
						'1',
						'-pix_fmt',
						opaque ? 'yuv444p' : 'yuva420p',
						'-auto-alt-ref',
						'0'
					]
				: [
						'-c:v',
						'prores_ks',
						'-profile:v',
						'4444',
						'-pix_fmt',
						'yuva444p10le',
						'-vendor',
						'apl0',
						...(startTimecode ? ['-timecode', startTimecode] : [])
					];
		return [
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'image2pipe',
			'-framerate',
			formatFrameRateRational(session.rate),
			'-c:v',
			'png',
			'-i',
			'pipe:0',
			...audioArguments,
			...codecArguments,
			session.outputPath
		];
	}

	/**
	 * Resolve the session this request is allowed to act on.
	 *
	 * The order is what keeps the transport from answering questions it was not
	 * asked: a cross-origin caller is refused before anything is looked up, a
	 * malformed identity is refused before it can name a file, and a caller with
	 * no credential never learns whether the session exists. Only a caller
	 * holding a credential reaches the session itself, where a credential
	 * belonging to a different session is refused rather than honoured.
	 */
	async #authorize(id: string, request: Request): Promise<ExportSession> {
		const refusal = findExportRequestOriginRefusal(exportRequestOrigins(request));
		if (refusal) throw securityError(refusal);
		if (!isExportSessionIdentity(id)) {
			throw new ExportSessionError(404, 'Export session not found.');
		}
		const presented = readExportSessionCredentialCookie(request.headers.get('cookie'), id);
		if (presented === null) throw securityError(MISSING_EXPORT_SESSION_CREDENTIAL_REFUSAL);
		const session = await this.#get(id);
		if (!isMatchingExportCredential(presented, session.credential)) {
			throw securityError(FOREIGN_EXPORT_SESSION_CREDENTIAL_REFUSAL);
		}
		return session;
	}

	/** Everything private this session owns, removed from a diagnostic before it is logged. */
	#redact(session: ExportSession, diagnostic: unknown): string {
		const text = diagnostic instanceof Error ? diagnostic.message : String(diagnostic);
		return redactExportDiagnostic(text, [session.workDir, session.id, session.credential]);
	}

	/**
	 * Resolve a live session, removing it first if either clock has run out — so
	 * an expired session answers 410 with its reason rather than a bare 404 from
	 * a sweep that has not fired yet.
	 */
	async #get(id: string): Promise<ExportSession> {
		const session = this.#sessions.get(id);
		if (!session) throw new ExportSessionError(404, 'Export session not found.');
		const expired = this.#findExpiry(session, this.#now());
		if (expired) {
			await this.#dispose(session, exportCleanupReasonForExpiry(expired.limit));
			throw limitError(expired);
		}
		return session;
	}

	#findExpiry(session: ExportSession, now: number): PublicExportLimitRejection | null {
		return findExportSessionExpiryRejection({
			idleMs: isExportSessionActive(session) ? 0 : now - session.lastActiveAt,
			ageMs: now - session.createdAt,
			idleTimeoutMs: this.#ttlMs,
			maxLifetimeMs: this.#maxLifetimeMs
		});
	}

	#scheduleSweep(delayMs: number): ReturnType<typeof setTimeout> {
		const timer = setTimeout(() => {
			void this.cleanupStale().catch((error) =>
				console.error('Export session cleanup failed.', error)
			);
		}, delayMs);
		timer.unref();
		return timer;
	}

	#touch(session: ExportSession): void {
		session.lastActiveAt = this.#now();
		if (session.idleTimer) clearTimeout(session.idleTimer);
		session.idleTimer = this.#scheduleSweep(this.#ttlMs);
	}

	/**
	 * Release everything one session holds, and record what was actually
	 * released. Deliberately never throws: a disposal is triggered by whichever
	 * request happened to end the session, and a cleanup failure is a retention
	 * leak the origin has to see rather than a different error for that caller to
	 * receive. Each failure is logged redacted and named in the receipt.
	 *
	 * The order is what makes the removal a removal: the download descriptor
	 * first, then the encoder that is still writing, then the directory.
	 */
	async #dispose(
		session: ExportSession,
		reason: ExportCleanupReason
	): Promise<ExportCleanupReceipt> {
		if (session.cleanupPromise) return session.cleanupPromise;
		const startedAt = Date.now();
		session.cleanupPromise = (async () => {
			this.#sessions.delete(session.id);
			if (session.idleTimer) clearTimeout(session.idleTimer);
			if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);
			session.abortController.abort(new DOMException('Export session cancelled.', 'AbortError'));
			const receipt: ExportCleanupReceipt = {
				sessionId: session.id,
				reason,
				downloadClosed: await this.#closeDownload(session),
				encoderTerminated: await this.#terminateEncoder(session),
				workDirectoryRemoved: await this.#removeWorkDirectory(session),
				elapsedMs: Date.now() - startedAt
			};
			this.#cleanupReceipts.push(receipt);
			if (this.#cleanupReceipts.length > EXPORT_CLEANUP_RECEIPT_HISTORY) {
				this.#cleanupReceipts.shift();
			}
			const leak = findExportCleanupLeak(receipt);
			if (leak) console.error(leak);
			return receipt;
		})();
		return session.cleanupPromise;
	}

	async #closeDownload(session: ExportSession): Promise<boolean> {
		const close = session.closeDownload;
		if (!close) return true;
		session.closeDownload = null;
		try {
			await close();
			return true;
		} catch (cause) {
			console.error('Export download could not be closed.', this.#redact(session, cause));
			return false;
		}
	}

	async #terminateEncoder(session: ExportSession): Promise<boolean> {
		const encoder = session.encoder;
		if (!encoder || encoder.hasExited) return true;
		encoder.child.stdin.destroy();
		encoder.child.kill('SIGKILL');
		const graceExpired = new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ENCODER_TERMINATION_GRACE_MS);
			timer.unref();
		});
		await Promise.race([
			encoder.exit.then(
				() => undefined,
				() => undefined
			),
			graceExpired
		]);
		return encoder.hasExited;
	}

	async #removeWorkDirectory(session: ExportSession): Promise<boolean> {
		try {
			await rm(session.workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
			return true;
		} catch (cause) {
			// The directory keeps this build's export prefix, so `sweepOrphanedDirectories`
			// collects it once it ages past the idle timeout and no live session owns it.
			console.error('Export work directory could not be removed.', this.#redact(session, cause));
			return false;
		}
	}
}

/**
 * Remove abandoned directories left by a terminated server process — under
 * every namespace's export prefix, so the release being replaced leaves nothing
 * behind whichever spelling it wrote (ADR-0052 retention, ADR-0053 matrix).
 *
 * `retainedDirectoryNames` are directories a live session still owns; the sweep
 * decides on age alone, and a session draining a long download has not written
 * to its directory since the encode finished.
 *
 * The default age is the idle timeout, which every runtime profile shares.
 */
export async function cleanupOrphanedExportDirectories(
	temporaryDirectory = tmpdir(),
	olderThanMs = PUBLIC_EXPORT_RUNTIME_LIMITS.sessionIdleTimeoutMs,
	now = Date.now(),
	retainedDirectoryNames: ReadonlySet<string> = new Set()
): Promise<number> {
	let entries;
	try {
		entries = await readdir(temporaryDirectory, { withFileTypes: true });
	} catch {
		return 0;
	}
	const stalePaths: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !isSweptExportDirectoryName(entry.name)) continue;
		if (retainedDirectoryNames.has(entry.name)) continue;
		const path = join(temporaryDirectory, basename(entry.name));
		try {
			if (now - (await stat(path)).mtimeMs >= olderThanMs) stalePaths.push(path);
		} catch {
			// Another cleanup may have won the race.
		}
	}
	await Promise.all(stalePaths.map((path) => rm(path, { recursive: true, force: true })));
	return stalePaths.length;
}

export const exportSessionStore = new ExportSessionStore();

let exportDirectoryMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sweep abandoned export directories now, then on the idle-timeout cadence
 * (ADR-0052).
 *
 * The server `init` hook calls this, not module scope: SvelteKit imports a route
 * module the first time a request matches it, so a side effect here would run at
 * the first export request rather than at startup — and a host that never gets
 * one would inherit the previous process's directories forever. Idempotent, so
 * an `init` that runs more than once leaves one timer.
 *
 * The startup pass is why the cadence exists too: a directory the replaced
 * process left seconds before the restart is too young for the startup sweep,
 * and nothing else would ever come back for it.
 */
export function startExportDirectoryMaintenance(): void {
	if (exportDirectoryMaintenanceTimer) return;
	const sweep = (): void => {
		void exportSessionStore
			.sweepOrphanedDirectories()
			.then((removed) => {
				if (removed > 0) {
					console.warn(`Removed ${removed} orphaned export work directories.`);
				}
			})
			.catch((error) => console.error('Orphaned export directory cleanup failed.', error));
	};
	sweep();
	exportDirectoryMaintenanceTimer = setInterval(
		sweep,
		parsePublicRuntimeConfig(process.env).exportSessionIdleTimeoutMs
	);
	exportDirectoryMaintenanceTimer.unref();
}

/** Stop the sweep cadence so a signalled host has nothing left holding it open. */
export function stopExportDirectoryMaintenance(): void {
	if (!exportDirectoryMaintenanceTimer) return;
	clearInterval(exportDirectoryMaintenanceTimer);
	exportDirectoryMaintenanceTimer = null;
}
