import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, describe, it, vi } from 'vitest';

import {
	cleanupOrphanedExportDirectories,
	type CreatedExportSession,
	ExportSessionError,
	ExportSessionStore,
	exportSessionStore,
	hasPngSignature,
	parseExportAudioOffset,
	parseExportFrameIndex,
	parseExportSessionRequest
} from '$lib/platform/export-session.server';
import { findExportCleanupLeaks } from '$lib/platform/public-export-cleanup';
import { EXPORT_CONTROL_DOCUMENT_MAX_BYTES } from '$lib/platform/public-export-limits';
import {
	EXPORT_SESSION_IDENTITY_LENGTH,
	isExportSessionIdentity
} from '$lib/platform/public-export-security';
import {
	DEVELOPMENT_EXPORT_RUNTIME_LIMITS,
	parseExportRuntimeLimits,
	PUBLIC_EXPORT_RUNTIME_LIMITS,
	RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME,
	type PublicExportRuntimeLimits
} from '$lib/platform/public-runtime-contract';

import * as exportLimitsRoute from './limits/+server';
import * as sessionsCollectionRoute from './sessions/+server';
import * as exportAudioRoute from './sessions/[sessionId]/audio/+server';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const TEST_ORIGIN = 'http://localhost';
const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

interface FakeEncoderOptions {
	exitCode?: number;
	stderr?: string;
	createInput?: () => Writable;
	/** Payload the fake encoder writes, so an output-ceiling fixture can oversize it. */
	outputContent?: string;
	/** Die unprompted after this many writes, the way a crashed ffmpeg would. */
	crashAfterWrites?: number;
}

interface FakeEncoderHarness {
	spawnEncoder: typeof nodeSpawn;
	spawnedArguments: string[][];
	children: FakeEncoderProcess[];
	/**
	 * The options every later spawn reads, so one store can run a success cycle
	 * and a failing-encoder cycle in turn the way one host does.
	 */
	behavior: FakeEncoderOptions;
}

class FakeEncoderProcess extends EventEmitter {
	readonly stdin: Writable;
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	killed = false;
	exited = false;

	constructor(outputPath: string, options: FakeEncoderOptions) {
		super();
		let writes = 0;
		this.stdin =
			options.createInput?.() ??
			new Writable({
				write: (_chunk, _encoding, done) => {
					writes += 1;
					done();
					if (options.crashAfterWrites !== undefined && writes >= options.crashAfterWrites) {
						// A real encoder that died leaves an EPIPE on its stdin socket, as
						// both an `error` event and the next write callback's error.
						this.stdin.destroy(new Error('EPIPE: broken pipe, write'));
						queueMicrotask(() => this.emit('close', 1, null));
					}
				}
			});
		this.once('close', () => {
			this.exited = true;
		});
		this.stdin.once('finish', () => {
			void (async () => {
				if ((options.exitCode ?? 0) === 0) {
					await writeFile(outputPath, options.outputContent ?? 'encoded-video');
				}
				if (options.stderr) this.stderr.write(options.stderr);
				this.stderr.end();
				this.emit('close', options.exitCode ?? 0, null);
			})();
		});
	}

	kill(signal?: NodeJS.Signals | number): boolean {
		if (this.killed) return false;
		this.killed = true;
		this.stdin.destroy();
		queueMicrotask(() => this.emit('close', null, signal ?? 'SIGTERM'));
		return true;
	}
}

function createFakeEncoder(options: FakeEncoderOptions = {}): FakeEncoderHarness {
	const spawnedArguments: string[][] = [];
	const children: FakeEncoderProcess[] = [];
	const behavior: FakeEncoderOptions = { ...options };
	const spawnEncoder = ((_command: string, args?: readonly string[]) => {
		const normalized = [...(args ?? [])];
		spawnedArguments.push(normalized);
		const outputPath = normalized.at(-1);
		assert.ok(outputPath);
		const child = new FakeEncoderProcess(outputPath, behavior);
		children.push(child);
		return child as unknown as ChildProcessWithoutNullStreams;
	}) as typeof nodeSpawn;
	return { spawnEncoder, spawnedArguments, children, behavior };
}

interface TestStoreOptions {
	ttlMs?: number;
	maxLifetimeMs?: number;
	maxConcurrentSessions?: number;
	/**
	 * Absent, the store takes the envelope of the profile it is running under,
	 * which under the test runner is `development`. A fixture that means the
	 * public envelope says so with `PUBLIC_ENVELOPE`.
	 */
	limits?: PublicExportRuntimeLimits;
	now?: () => number;
}

const PUBLIC_ENVELOPE: TestStoreOptions = { limits: PUBLIC_EXPORT_RUNTIME_LIMITS };

async function createStore(
	options: FakeEncoderOptions = {},
	storeOptions: TestStoreOptions = {}
): Promise<{ store: ExportSessionStore; directory: string; encoder: FakeEncoderHarness }> {
	const directory = await mkdtemp(join(tmpdir(), 'gfx-export-test-'));
	temporaryDirectories.push(directory);
	const encoder = createFakeEncoder(options);
	return {
		directory,
		encoder,
		store: new ExportSessionStore({
			temporaryDirectory: directory,
			spawnEncoder: encoder.spawnEncoder,
			...storeOptions
		})
	};
}

/** An admitted session plus the private credential its create response issued. */
interface OpenedTestSession extends CreatedExportSession {
	/** The `name=value` pair a browser would send back on every later request. */
	cookie: string;
}

function createSessionRequest(
	metadata: Record<string, unknown>,
	headers: Record<string, string> = {}
): Request {
	return new Request(`${TEST_ORIGIN}/api/export/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, ...headers },
		body: JSON.stringify(metadata)
	});
}

/** POST one session control document through the real admission path. */
async function openSession(
	store: ExportSessionStore,
	metadata: Record<string, unknown>,
	headers: Record<string, string> = {}
): Promise<OpenedTestSession> {
	const opened = await store.create(createSessionRequest(metadata, headers));
	return { ...opened.document, cookie: opened.credentialCookie.split(';', 1)[0] };
}

/** The control request a browser makes: same origin, carrying this session's credential. */
function controlRequest(
	session: Pick<OpenedTestSession, 'sessionId' | 'cookie'>,
	method: 'POST' | 'DELETE' = 'POST'
): Request {
	return new Request(`${TEST_ORIGIN}/api/export/sessions/${session.sessionId}`, {
		method,
		headers: { Origin: TEST_ORIGIN, Cookie: session.cookie }
	});
}

/** The download request a browser makes: a same-origin navigation, no Origin header. */
function downloadRequest(
	session: Pick<OpenedTestSession, 'sessionId' | 'cookie'>,
	headers: Record<string, string> = {}
): Request {
	return new Request(`${TEST_ORIGIN}/api/export/sessions/${session.sessionId}/output`, {
		headers: { Cookie: session.cookie, 'Sec-Fetch-Site': 'same-origin', ...headers }
	});
}

function frameRequest(
	session: Pick<OpenedTestSession, 'sessionId' | 'cookie'>,
	options: { signal?: AbortSignal; type?: string; headers?: Record<string, string> } = {}
): Request {
	const type = options.type ?? 'image/png';
	return new Request(`${TEST_ORIGIN}/api/export/sessions/${session.sessionId}/frames/0`, {
		method: 'PUT',
		headers: {
			'Content-Type': type,
			Origin: TEST_ORIGIN,
			Cookie: session.cookie,
			...options.headers
		},
		body: new Blob([PNG], { type }),
		signal: options.signal
	});
}

function audioRequest(
	session: Pick<OpenedTestSession, 'sessionId' | 'cookie'>,
	bytes: Uint8Array,
	options: { type?: string; headers?: Record<string, string> } = {}
): Request {
	const type = options.type ?? 'audio/wav';
	return new Request(`${TEST_ORIGIN}/api/export/sessions/${session.sessionId}/audio`, {
		method: 'PUT',
		headers: {
			'Content-Type': type,
			Origin: TEST_ORIGIN,
			Cookie: session.cookie,
			...options.headers
		},
		body: new Blob([bytes.slice().buffer], { type })
	});
}

function optionValue(args: string[], option: string): string | undefined {
	const index = args.indexOf(option);
	return index >= 0 ? args[index + 1] : undefined;
}

const WEBM_SINGLE_FRAME = {
	format: 'webm',
	fps: 30,
	frameCount: 1,
	opaque: false,
	audioBytes: 0
} as const;

function isLimitStatus(status: number, pattern: RegExp): (error: unknown) => boolean {
	return (error: unknown) =>
		error instanceof ExportSessionError && error.status === status && pattern.test(error.message);
}

describe('export session protocol parsing', () => {
	it('accepts exact rational transport metadata and PNG framing', () => {
		assert.deepEqual(
			parseExportSessionRequest({
				format: 'prores',
				fps: 29.97,
				frameCount: 300,
				opaque: true,
				audioBytes: 44,
				startTimecode: '01:00:08:00'
			}),
			{
				format: 'prores',
				fps: 29.97,
				frameCount: 300,
				opaque: true,
				audioBytes: 44,
				startTimecode: '01:00:08:00'
			}
		);
		assert.equal(parseExportFrameIndex('0'), 0);
		assert.equal(hasPngSignature(PNG), true);
	});

	it('accepts a drop-frame start timecode at 29.97', () => {
		const request = parseExportSessionRequest({
			format: 'prores',
			fps: 29.97,
			frameCount: 300,
			opaque: false,
			audioBytes: 0,
			startTimecode: '01:00:00;00'
		});
		assert.equal(request.startTimecode, '01:00:00;00');
	});

	it('rejects drop-frame timecode at non-drop rates and nonexistent DF labels', () => {
		const base = { format: 'prores', frameCount: 300, opaque: false, audioBytes: 0 };
		assert.throws(
			() => parseExportSessionRequest({ ...base, fps: 30, startTimecode: '01:00:00;00' }),
			/only defined for 29\.97/
		);
		// 00:01:00;00 is a dropped label — it does not exist at 29.97 DF.
		assert.throws(
			() => parseExportSessionRequest({ ...base, fps: 29.97, startTimecode: '00:01:00;00' }),
			/dropped label/
		);
		assert.throws(
			() => parseExportSessionRequest({ ...base, fps: 29.97, startTimecode: '01;00;00;00' }),
			/HH:MM:SS:FF or HH:MM:SS;FF/
		);
	});

	it('rejects malformed counts, indexes, rates, and WebM timecode', () => {
		assert.throws(
			() =>
				parseExportSessionRequest({
					format: 'webm',
					fps: 29.9,
					frameCount: 0,
					opaque: false,
					audioBytes: 0
				}),
			ExportSessionError
		);
		assert.throws(() => parseExportFrameIndex('01'), ExportSessionError);
		assert.throws(
			() =>
				parseExportSessionRequest({
					format: 'webm',
					fps: 30,
					frameCount: 1,
					opaque: false,
					audioBytes: 0,
					startTimecode: '01:00:00:00'
				}),
			/A start timecode requires/
		);
	});
});

describe('export session encoding', () => {
	it('enforces ordered frame acknowledgements and rejects completion with missing frames', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 2,
			opaque: false,
			audioBytes: 0
		});
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 1, frameRequest(session)),
			/Expected export frame 0/
		);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await assert.rejects(
			() => store.complete(session.sessionId, controlRequest(session)),
			/received 1 of 2/
		);
		await assert.rejects(
			() => store.outputResponse(session.sessionId, downloadRequest(session)),
			/not ready/
		);
		await store.uploadFrame(session.sessionId, 1, frameRequest(session));
		const completed = await store.complete(session.sessionId, controlRequest(session));
		assert.match(completed.downloadUrl, new RegExp(session.sessionId));
		const response = await store.outputResponse(session.sessionId, downloadRequest(session));
		assert.equal(response.headers.get('content-type'), 'video/webm');
		assert.equal(response.headers.get('content-length'), String('encoded-video'.length));
		assert.equal(await response.text(), 'encoded-video');
		assert.deepEqual(await readdir(directory), []);
	});

	it('rejects invalid frame content and removes the unusable session', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 0, frameRequest(session, { type: 'image/jpeg' })),
			/Expected an image\/png/
		);
		assert.deepEqual(await readdir(directory), []);

		const malformed = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		const malformedRequest = new Request(`${TEST_ORIGIN}/frame`, {
			method: 'PUT',
			headers: { 'Content-Type': 'image/png', Origin: TEST_ORIGIN, Cookie: malformed.cookie },
			body: new Blob(['not a png'], { type: 'image/png' })
		});
		await assert.rejects(
			() => store.uploadFrame(malformed.sessionId, 0, malformedRequest),
			/not a PNG image/
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('does not acknowledge a frame until the encoder write callback applies backpressure', async () => {
		let releaseWrite = (): void => undefined;
		let isReleased = false;
		let markWriteStarted = (): void => undefined;
		const writeStarted = new Promise<void>((resolve) => {
			markWriteStarted = resolve;
		});
		const { store } = await createStore({
			createInput: () =>
				new Writable({
					highWaterMark: 1,
					write: (_chunk, _encoding, done) => {
						markWriteStarted();
						if (isReleased) done();
						else {
							releaseWrite = () => {
								isReleased = true;
								done();
							};
						}
					}
				})
		});
		const session = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		let didResolve = false;
		const upload = store.uploadFrame(session.sessionId, 0, frameRequest(session)).then(() => {
			didResolve = true;
		});
		await writeStarted;
		assert.equal(didResolve, false);
		releaseWrite();
		await upload;
		assert.equal(didResolve, true);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('streams audio once before frames and maps it to the encoder', async () => {
		const { store, encoder } = await createStore();
		const wav = new Uint8Array([82, 73, 70, 70]);
		const session = await openSession(store, {
			format: 'prores',
			fps: 24,
			frameCount: 1,
			opaque: true,
			audioBytes: wav.byteLength
		});
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 0, frameRequest(session)),
			/Upload export audio/
		);
		await store.uploadAudio(session.sessionId, 0, audioRequest(session, wav));
		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 0, audioRequest(session, wav)),
			/already uploaded/
		);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		assert.ok(encoder.spawnedArguments[0].includes('pcm_s16le'));
		assert.ok(encoder.spawnedArguments[0].some((value) => value.endsWith('/mix.wav')));
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it.each([
		{ format: 'webm' as const, opaque: false, pixelFormat: 'yuva420p' },
		{ format: 'webm' as const, opaque: true, pixelFormat: 'yuv444p' },
		{ format: 'prores' as const, opaque: true, pixelFormat: 'yuva444p10le' }
	])(
		'preserves $format codec output with $pixelFormat',
		async ({ format, opaque, pixelFormat }) => {
			const { store, encoder } = await createStore();
			const session = await openSession(store, {
				format,
				fps: 29.97,
				frameCount: 1,
				opaque,
				audioBytes: 0,
				...(format === 'prores' ? { startTimecode: '01:00:08:00' } : {})
			});
			await store.uploadFrame(session.sessionId, 0, frameRequest(session));
			await store.complete(session.sessionId, controlRequest(session));
			const args = encoder.spawnedArguments[0];
			assert.equal(optionValue(args, '-framerate'), '30000/1001');
			assert.equal(optionValue(args, '-pix_fmt'), pixelFormat);
			if (format === 'prores') {
				assert.ok(args.includes('prores_ks'));
				assert.equal(optionValue(args, '-profile:v'), '4444');
				assert.equal(optionValue(args, '-timecode'), '01:00:08:00');
			} else {
				assert.ok(args.includes('libvpx-vp9'));
			}
			await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
		}
	);

	it('passes a drop-frame start timecode through to ffmpeg unchanged', async () => {
		const { store, encoder } = await createStore();
		const session = await openSession(store, {
			format: 'prores',
			fps: 29.97,
			frameCount: 1,
			opaque: false,
			audioBytes: 0,
			startTimecode: '01:00:08;00'
		});
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		assert.equal(optionValue(encoder.spawnedArguments[0], '-timecode'), '01:00:08;00');
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('removes the session and partial output on encoder failure', async () => {
		const { store, directory } = await createStore({ exitCode: 1, stderr: 'encoder exploded' });
		const session = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await assert.rejects(
			() => store.complete(session.sessionId, controlRequest(session)),
			isLimitStatus(500, /^Export encoding failed\.$/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('cancels output streaming and removes the finished session file', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		const response = await store.outputResponse(session.sessionId, downloadRequest(session));
		assert.ok(response.body);
		await response.body.cancel('download cancelled');
		assert.deepEqual(await readdir(directory), []);
	});

	it('kills the encoder and removes temp files when an active request aborts', async () => {
		let markWriteStarted = (): void => undefined;
		const writeStarted = new Promise<void>((resolve) => {
			markWriteStarted = resolve;
		});
		const { store, directory, encoder } = await createStore({
			createInput: () =>
				new Writable({
					write: () => markWriteStarted()
				})
		});
		const session = await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		const abortController = new AbortController();
		const upload = store.uploadFrame(
			session.sessionId,
			0,
			frameRequest(session, { signal: abortController.signal })
		);
		await writeStarted;
		abortController.abort();
		// A caller that hung up is answered 410, not reported as a server fault:
		// a raw abort escaping here reached SvelteKit as an unhandled 500
		// (SUPERS-26/27/2A).
		await assert.rejects(upload, isLimitStatus(410, /cancelled/));
		assert.equal(encoder.children[0].killed, true);
		assert.deepEqual(await readdir(directory), []);
		assert.equal(store.openSessionCount, 0);
		assert.equal(store.cleanupReceipts.at(-1)?.reason, 'failed');
		assert.deepEqual(findExportCleanupLeaks(store.cleanupReceipts), []);
	});

	// SUPERS-28: cancelling a session while a frame is still streaming aborted the
	// upload's signal with a bare `AbortError`, which both export routes rethrew
	// and SvelteKit reported as a 500 on an outcome the caller had just asked for.
	it('answers an upload interrupted by a concurrent cancel without a server fault', async () => {
		let markWriteStarted = (): void => undefined;
		const writeStarted = new Promise<void>((resolve) => {
			markWriteStarted = resolve;
		});
		const { store, directory } = await createStore({
			createInput: () =>
				new Writable({
					write: () => markWriteStarted()
				})
		});
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		const upload = store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await writeStarted;
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));

		await assert.rejects(upload, isLimitStatus(410, /cancelled/));
		assert.deepEqual(await readdir(directory), []);
		assert.equal(store.openSessionCount, 0);
		assert.deepEqual(findExportCleanupLeaks(store.cleanupReceipts), []);
	});

	it('expires abandoned sessions and cleans orphaned directories', async () => {
		let now = 1_000;
		const { store, directory } = await createStore({}, { ttlMs: 100, now: () => now });
		await openSession(store, {
			format: 'webm',
			fps: 30,
			frameCount: 1,
			opaque: false,
			audioBytes: 0
		});
		now = 1_101;
		assert.equal(await store.cleanupStale(), 1);
		assert.deepEqual(await readdir(directory), []);

		const orphan = join(directory, 'gfx-export-orphan');
		await import('node:fs/promises').then(({ mkdir }) => mkdir(orphan));
		assert.equal(await cleanupOrphanedExportDirectories(directory, 0, Date.now() + 1_000), 1);
		assert.deepEqual(await readdir(directory), []);
	});

	// ADR-0053: a deploy or rollback across the namespace rename must not orphan
	// the directories the release it replaced wrote under the other prefix.
	it('sweeps orphaned directories under either namespace and leaves neighbours alone', async () => {
		const { directory } = await createStore();
		const { mkdir } = await import('node:fs/promises');
		await mkdir(join(directory, 'supers-export-orphan'));
		await mkdir(join(directory, 'gfx-export-orphan'));
		await mkdir(join(directory, 'unrelated-tenant-cache'));

		assert.equal(await cleanupOrphanedExportDirectories(directory, 0, Date.now() + 1_000), 2);
		assert.deepEqual(await readdir(directory), ['unrelated-tenant-cache']);
	});
});

/** ADR-0052: the ratified envelope, refused before ffmpeg or a work directory. */
describe('bounded public export limit enforcement', () => {
	it('refuses an over-envelope session without spawning ffmpeg or allocating a directory', async () => {
		const { store, directory, encoder } = await createStore({}, PUBLIC_ENVELOPE);
		await assert.rejects(
			() =>
				openSession(store, {
					...WEBM_SINGLE_FRAME,
					fps: 60,
					frameCount: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount + 1
				}),
			isLimitStatus(400, new RegExp(`the limit is ${PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount}`))
		);
		await assert.rejects(
			() => openSession(store, { ...WEBM_SINGLE_FRAME, fps: 120 }),
			isLimitStatus(400, /the limit is 60 fps/)
		);
		await assert.rejects(
			() =>
				openSession(store, {
					...WEBM_SINGLE_FRAME,
					audioBytes: PUBLIC_EXPORT_RUNTIME_LIMITS.maxAudioBytes + 1
				}),
			isLimitStatus(413, /bytes of audio/)
		);
		assert.deepEqual(await readdir(directory), []);
		assert.deepEqual(encoder.spawnedArguments, []);
	});

	it('admits the longest export the envelope allows', async () => {
		const { store } = await createStore({}, PUBLIC_ENVELOPE);
		const session = await openSession(store, {
			...WEBM_SINGLE_FRAME,
			fps: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameRate,
			frameCount: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount
		});
		assert.ok(session.sessionId);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a control document, content type, or body it cannot admit', async () => {
		const { store, directory } = await createStore();
		await assert.rejects(
			() =>
				openSession(store, WEBM_SINGLE_FRAME, {
					'Content-Length': String(EXPORT_CONTROL_DOCUMENT_MAX_BYTES + 1)
				}),
			isLimitStatus(413, /session metadata declares/)
		);
		await assert.rejects(
			() =>
				store.create(
					new Request(`${TEST_ORIGIN}/api/export/sessions`, {
						method: 'POST',
						headers: { 'Content-Type': 'text/plain', Origin: TEST_ORIGIN },
						body: '{}'
					})
				),
			isLimitStatus(415, /application\/json/)
		);
		await assert.rejects(
			() =>
				store.create(
					new Request(`${TEST_ORIGIN}/api/export/sessions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
						body: 'not json'
					})
				),
			isLimitStatus(400, /not valid JSON/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('turns the next caller away at the concurrency ceiling and frees the slot on every exit', async () => {
		const { store, directory } = await createStore({}, { maxConcurrentSessions: 2 });
		const first = await openSession(store, WEBM_SINGLE_FRAME);
		const second = await openSession(store, WEBM_SINGLE_FRAME);
		await assert.rejects(
			() => openSession(store, WEBM_SINGLE_FRAME),
			isLimitStatus(429, /2 of 2 concurrent sessions/)
		);

		await store.cancel(first.sessionId, controlRequest(first, 'DELETE'));
		const third = await openSession(store, WEBM_SINGLE_FRAME);

		await store.uploadFrame(second.sessionId, 0, frameRequest(second));
		await store.complete(second.sessionId, controlRequest(second));
		await (await store.outputResponse(second.sessionId, downloadRequest(second))).text();
		const fourth = await openSession(store, WEBM_SINGLE_FRAME);
		await assert.rejects(
			() => openSession(store, WEBM_SINGLE_FRAME),
			isLimitStatus(429, /2 of 2 concurrent sessions/)
		);

		await Promise.all([
			store.cancel(third.sessionId, controlRequest(third, 'DELETE')),
			store.cancel(fourth.sessionId, controlRequest(fourth, 'DELETE'))
		]);
		assert.deepEqual(await readdir(directory), []);
	});

	it('gives the last concurrency slot to exactly one of two racing callers', async () => {
		const { store, directory } = await createStore({}, { maxConcurrentSessions: 1 });
		const outcomes = await Promise.allSettled([
			openSession(store, WEBM_SINGLE_FRAME),
			openSession(store, WEBM_SINGLE_FRAME)
		]);
		const admitted = outcomes.filter(
			(outcome): outcome is PromiseFulfilledResult<OpenedTestSession> =>
				outcome.status === 'fulfilled'
		);
		const refused = outcomes.filter(
			(outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
		);
		assert.equal(admitted.length, 1);
		assert.equal(refused.length, 1);
		assert.ok(isLimitStatus(429, /1 of 1 concurrent sessions/)(refused[0].reason));
		assert.deepEqual(await readdir(directory), [`gfx-export-${admitted[0].value.sessionId}`]);
		await store.cancel(admitted[0].value.sessionId, controlRequest(admitted[0].value, 'DELETE'));
	});

	it('removes a session that passed its hard lifetime while still being used', async () => {
		let now = 1_000;
		const { store, directory } = await createStore(
			{},
			{ ttlMs: 10_000, maxLifetimeMs: 500, now: () => now }
		);
		const session = await openSession(store, { ...WEBM_SINGLE_FRAME, frameCount: 2 });
		now = 1_400;
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		now = 1_500;
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 1, frameRequest(session)),
			isLimitStatus(410, /passed its 500 ms lifetime/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('answers an idle-expired session with its reason before the sweep reaches it', async () => {
		let now = 1_000;
		const { store, directory } = await createStore(
			{},
			{ ttlMs: 100, maxLifetimeMs: 10_000, now: () => now }
		);
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		now = 1_100;
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 0, frameRequest(session)),
			isLimitStatus(410, /idle longer than 100 ms/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	// GFX-COMPUTER-1D: `complete` touches the session once and then waits for the
	// encoder to drain every frame already buffered on its stdin. No further
	// request arrives to touch it, so a long flush outlived the idle window and
	// the sweep that fired SIGKILLed ffmpeg mid-write; a signalled child reports
	// no exit code, so the kill reached the caller as a bare encoder-failure 500
	// on the export it had just finished uploading.
	it('does not idle-expire a session while its encoder is still flushing', async () => {
		let now = 1_000;
		let markFlushStarted = (): void => undefined;
		const flushStarted = new Promise<void>((resolve) => {
			markFlushStarted = resolve;
		});
		let releaseFlush = (): void => undefined;
		const { store, encoder } = await createStore(
			{
				createInput: () =>
					new Writable({
						write: (_chunk, _encoding, done) => done(),
						final: (done) => {
							releaseFlush = () => done();
							markFlushStarted();
						}
					})
			},
			{ ttlMs: 100, maxLifetimeMs: 10_000, now: () => now }
		);
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));

		const completed = store.complete(session.sessionId, controlRequest(session));
		await flushStarted;
		now = 1_400;

		assert.equal(await store.cleanupStale(), 0);
		assert.equal(encoder.children[0].killed, false);
		releaseFlush();
		assert.deepEqual(await completed, {
			downloadUrl: `/api/export/sessions/${session.sessionId}/output`
		});
	});

	it('refuses an oversized frame from its declared length, before the encoder starts', async () => {
		const { store, directory, encoder } = await createStore(
			{},
			{ limits: { ...PUBLIC_EXPORT_RUNTIME_LIMITS, maxFrameBytes: PNG.byteLength - 1 } }
		);
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await assert.rejects(
			() =>
				store.uploadFrame(
					session.sessionId,
					0,
					frameRequest(session, { headers: { 'Content-Length': String(PNG.byteLength) } })
				),
			isLimitStatus(413, new RegExp(`limit is ${PNG.byteLength - 1} per frame`))
		);
		assert.deepEqual(encoder.spawnedArguments, []);
		assert.deepEqual(await readdir(directory), []);
	});

	// A declared length is now held to exactly in both directions, so a caller
	// cannot understate its frame to slip past the ceiling, and a body that stops
	// short of what it promised is refused rather than encoded as a torn frame.
	it('holds a frame body to the length it declared, in both directions', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, { ...WEBM_SINGLE_FRAME, frameCount: 2 });
		await assert.rejects(
			() =>
				store.uploadFrame(
					session.sessionId,
					0,
					frameRequest(session, { headers: { 'Content-Length': '8' } })
				),
			isLimitStatus(413, /exceeded its declared byte length/)
		);
		assert.deepEqual(await readdir(directory), []);

		const short = await openSession(store, WEBM_SINGLE_FRAME);
		await assert.rejects(
			() =>
				store.uploadFrame(
					short.sessionId,
					0,
					frameRequest(short, { headers: { 'Content-Length': String(PNG.byteLength + 4) } })
				),
			isLimitStatus(400, new RegExp(`expected ${PNG.byteLength + 4}`))
		);
		assert.deepEqual(await readdir(directory), []);
	});

	// Without a declared length there is nothing to check the body against up
	// front, so the ceiling has to bind on the bytes as they arrive.
	it('cuts off an undeclared frame body at the per-frame ceiling', async () => {
		const { store, directory } = await createStore(
			{},
			{ limits: { ...PUBLIC_EXPORT_RUNTIME_LIMITS, maxFrameBytes: PNG.byteLength - 1 } }
		);
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 0, frameRequest(session)),
			isLimitStatus(413, new RegExp(`limit is ${PNG.byteLength - 1} per frame`))
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses an encoded output above the output ceiling and keeps nothing', async () => {
		const maxOutputBytes = RATIFIED_NATIVE_OUTPUT_BYTES_PER_FRAME.webm;
		const { store, directory } = await createStore(
			{ outputContent: 'e'.repeat(maxOutputBytes + 1) },
			{ limits: { ...PUBLIC_EXPORT_RUNTIME_LIMITS, maxOutputBytes } }
		);
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await assert.rejects(
			() => store.complete(session.sessionId, controlRequest(session)),
			isLimitStatus(413, new RegExp(`Export output is ${maxOutputBytes + 1} bytes`))
		);
		assert.deepEqual(await readdir(directory), []);
	});
});

/**
 * The audio bed goes up in ordered parts, because a Film-length bed is larger
 * than one request body (ADR-0052, 2026-10-09 amendment). The session appends
 * each part to one file and holds the running total to what it declared.
 */
describe('export audio uploaded in parts', () => {
	// Twelve bytes of bed, sent four at a time.
	const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);
	const PARTS = [WAV.subarray(0, 4), WAV.subarray(4, 8), WAV.subarray(8, 12)];

	async function openAudioSession(
		store: ExportSessionStore,
		audioBytes = WAV.byteLength
	): Promise<OpenedTestSession> {
		return openSession(store, {
			format: 'prores',
			fps: 24,
			frameCount: 1,
			opaque: true,
			audioBytes
		});
	}

	async function readBed(directory: string, session: OpenedTestSession): Promise<Uint8Array> {
		return new Uint8Array(
			await readFile(join(directory, `gfx-export-${session.sessionId}`, 'mix.wav'))
		);
	}

	it('assembles ordered parts into one bed before the encoder starts', async () => {
		const { store, directory, encoder } = await createStore();
		const session = await openAudioSession(store);

		await store.uploadAudio(session.sessionId, 0, audioRequest(session, PARTS[0]));
		await store.uploadAudio(session.sessionId, 4, audioRequest(session, PARTS[1]));
		// The bed is not whole yet, so no frame is accepted and no encoder runs.
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 0, frameRequest(session)),
			isLimitStatus(409, /^Upload export audio before the first frame\.$/)
		);
		assert.deepEqual(encoder.spawnedArguments, []);
		await store.uploadAudio(session.sessionId, 8, audioRequest(session, PARTS[2]));

		assert.deepEqual(await readBed(directory, session), WAV);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		assert.ok(encoder.spawnedArguments[0].some((value) => value.endsWith('/mix.wav')));
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('takes a bed that fits one request as one part from byte 0', async () => {
		const { store, directory } = await createStore();
		const session = await openAudioSession(store);

		await store.uploadAudio(
			session.sessionId,
			parseExportAudioOffset(null),
			audioRequest(session, WAV)
		);

		assert.deepEqual(await readBed(directory, session), WAV);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a part that arrives out of order and keeps what it has', async () => {
		const { store, directory } = await createStore();
		const session = await openAudioSession(store);
		await store.uploadAudio(session.sessionId, 0, audioRequest(session, PARTS[0]));

		// Skipping ahead, repeating, and starting inside a part are all refused.
		for (const offset of [8, 0, 2]) {
			await assert.rejects(
				() => store.uploadAudio(session.sessionId, offset, audioRequest(session, PARTS[1])),
				isLimitStatus(
					409,
					new RegExp(`^Expected export audio from byte 4, received byte ${offset}\\.$`)
				)
			);
		}

		// The session is still open and takes the right part next.
		assert.deepEqual(await readBed(directory, session), PARTS[0]);
		await store.uploadAudio(session.sessionId, 4, audioRequest(session, PARTS[1]));
		await store.uploadAudio(session.sessionId, 8, audioRequest(session, PARTS[2]));
		assert.deepEqual(await readBed(directory, session), WAV);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a first part that does not start at byte 0', async () => {
		const { store } = await createStore();
		const session = await openAudioSession(store);

		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 4, audioRequest(session, PARTS[1])),
			isLimitStatus(409, /^Expected export audio from byte 0, received byte 4\.$/)
		);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a part after the bed is complete', async () => {
		const { store, directory } = await createStore();
		const session = await openAudioSession(store);
		for (const [index, part] of PARTS.entries()) {
			await store.uploadAudio(session.sessionId, index * 4, audioRequest(session, part));
		}

		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 12, audioRequest(session, PARTS[0])),
			isLimitStatus(409, /already uploaded/)
		);
		assert.deepEqual(await readBed(directory, session), WAV);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a part after encoding started', async () => {
		const { store } = await createStore();
		const session = await openAudioSession(store);
		await store.uploadAudio(session.sessionId, 0, audioRequest(session, WAV));
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));

		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 12, audioRequest(session, PARTS[0])),
			isLimitStatus(409, /already uploaded or encoding started/)
		);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a part that would carry the bed past its declared total, from its declared length', async () => {
		const { store, directory } = await createStore();
		const session = await openAudioSession(store, 10);
		await store.uploadAudio(session.sessionId, 0, audioRequest(session, PARTS[0]));
		await store.uploadAudio(session.sessionId, 4, audioRequest(session, PARTS[1]));

		const overTotal = audioRequest(session, PARTS[2], { headers: { 'Content-Length': '4' } });
		assert.equal(overTotal.headers.get('content-length'), '4');
		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 8, overTotal),
			isLimitStatus(413, /^Export session has uploaded 12 bytes of audio; it declared 10\.$/)
		);
		// Refused before a byte was read: the body is still unread.
		assert.equal(overTotal.bodyUsed, false);
		// Over the total ends the session: nothing of it is left behind.
		assert.deepEqual(await readdir(directory), []);
		assert.equal(store.openSessionCount, 0);
	});

	it('cuts off a part that runs past the total when it declares no length', async () => {
		const { store, directory } = await createStore();
		const session = await openAudioSession(store, 10);
		await store.uploadAudio(session.sessionId, 0, audioRequest(session, PARTS[0]));
		await store.uploadAudio(session.sessionId, 4, audioRequest(session, PARTS[1]));
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(PARTS[2].slice());
				controller.close();
			}
		});
		const request = new Request(
			`${TEST_ORIGIN}/api/export/sessions/${session.sessionId}/audio?offset=8`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'audio/wav', Origin: TEST_ORIGIN, Cookie: session.cookie },
				body: stream,
				duplex: 'half'
			} as RequestInit
		);
		assert.equal(request.headers.get('content-length'), null);

		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 8, request),
			isLimitStatus(413, /^Export session has uploaded 12 bytes of audio; it declared 10\.$/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses a part larger than one request may be', async () => {
		const { store, directory } = await createStore(
			{},
			{ limits: { ...DEVELOPMENT_EXPORT_RUNTIME_LIMITS, maxFrameBytes: 6 } }
		);
		const session = await openAudioSession(store);

		await assert.rejects(
			() => store.uploadAudio(session.sessionId, 0, audioRequest(session, WAV.subarray(0, 8))),
			isLimitStatus(413, /^Export audio part is 8 bytes; the limit is 6 per request\.$/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses a total past the profile bound when the session opens', async () => {
		const { store, directory } = await createStore();
		await assert.rejects(
			() => openAudioSession(store, DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxAudioBytes + 1),
			isLimitStatus(
				413,
				new RegExp(
					`bytes of audio; the limit is ${DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxAudioBytes}`
				)
			)
		);
		// The bed of the longest export is admitted, though it is past one request.
		const session = await openAudioSession(store, 115_200_044);
		assert.ok(115_200_044 > DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameBytes);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses an empty part and a part that is not WAV', async () => {
		const { store } = await createStore();
		const empty = await openAudioSession(store);
		await assert.rejects(
			() => store.uploadAudio(empty.sessionId, 0, audioRequest(empty, new Uint8Array(0))),
			isLimitStatus(400, /^Export audio part is empty\.$/)
		);
		const mistyped = await openAudioSession(store);
		await assert.rejects(
			() =>
				store.uploadAudio(
					mistyped.sessionId,
					0,
					audioRequest(mistyped, PARTS[0], { type: 'application/octet-stream' })
				),
			isLimitStatus(415, /^Expected audio\/wav export audio\.$/)
		);
		assert.equal(store.openSessionCount, 0);
	});

	it('counts every part against the session upload ceiling', async () => {
		const { store } = await createStore(
			{},
			{ limits: { ...DEVELOPMENT_EXPORT_RUNTIME_LIMITS, maxFrameBytes: PNG.byteLength } }
		);
		const session = await openAudioSession(store);
		for (const [index, part] of PARTS.entries()) {
			await store.uploadAudio(session.sessionId, index * 4, audioRequest(session, part));
		}

		// Twelve bytes of bed plus one frame at the per-frame ceiling is exactly
		// the session's total, so the frame still fits.
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('reads the part offset from the audio URL, and no offset as byte 0', () => {
		assert.equal(parseExportAudioOffset(null), 0);
		assert.equal(parseExportAudioOffset('0'), 0);
		assert.equal(parseExportAudioOffset('67108864'), 67_108_864);
		for (const value of ['', '-1', '1.5', '01', 'four', '9007199254740993']) {
			assert.throws(
				() => parseExportAudioOffset(value),
				isLimitStatus(400, /^Invalid export audio offset/)
			);
		}
	});

	it('answers each part through the audio route, in order', async () => {
		assert.deepEqual(Object.keys(exportAudioRoute), ['PUT']);
		const opened = await exportSessionStore.create(
			createSessionRequest({
				format: 'prores',
				fps: 24,
				frameCount: 1,
				opaque: true,
				audioBytes: WAV.byteLength
			})
		);
		const session: OpenedTestSession = {
			...opened.document,
			cookie: opened.credentialCookie.split(';', 1)[0]
		};
		const put = (offset: string | null, part: Uint8Array): Promise<Response> => {
			const url = new URL(`${TEST_ORIGIN}${session.audioUrl}`);
			if (offset !== null) url.searchParams.set('offset', offset);
			return Promise.resolve(
				exportAudioRoute.PUT({
					params: { sessionId: session.sessionId },
					request: audioRequest(session, part),
					url
				} as unknown as Parameters<typeof exportAudioRoute.PUT>[0])
			);
		};
		try {
			assert.equal((await put(null, PARTS[0])).status, 204);
			const outOfOrder = await put('8', PARTS[2]);
			assert.equal(outOfOrder.status, 409);
			assert.equal(await outOfOrder.text(), 'Expected export audio from byte 4, received byte 8.');
			assert.equal((await put('four', PARTS[1])).status, 400);
			assert.equal((await put('4', PARTS[1])).status, 204);
			assert.equal((await put('8', PARTS[2])).status, 204);
			assert.equal((await put('12', PARTS[0])).status, 409);
		} finally {
			await exportSessionStore.cancel(session.sessionId, controlRequest(session, 'DELETE'));
		}
	});
});

/**
 * ADR-0068 §9: a development host admits a Film-length export; a public host
 * keeps the ratified envelope. The store reads which one it is from the
 * environment it starts in, and `/api/export/limits` reports what it enforces.
 */
describe('export limits by runtime profile', () => {
	const FILM_LENGTH_REQUEST = {
		...WEBM_SINGLE_FRAME,
		fps: 30,
		frameCount: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount + 1
	} as const;

	it('admits an export past the public envelope on a development host', async () => {
		const { store } = await createStore();
		assert.deepEqual(store.servedLimits, DEVELOPMENT_EXPORT_RUNTIME_LIMITS);

		const session = await openSession(store, FILM_LENGTH_REQUEST);
		assert.ok(session.sessionId);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('admits the longest composition the transport schema allows, and nothing longer', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, {
			...WEBM_SINGLE_FRAME,
			fps: 120,
			frameCount: DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxFrameCount
		});
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));

		await assert.rejects(
			() =>
				openSession(store, {
					...WEBM_SINGLE_FRAME,
					fps: 30,
					frameCount: DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxDurationSeconds * 30 + 1
				}),
			isLimitStatus(400, /^Export spans 600\.033 seconds; the limit is 600 seconds/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('holds a public host to the ratified envelope', async () => {
		vi.stubEnv('GFX_RUNTIME_PROFILE', 'public');
		const { store, directory, encoder } = await createStore();
		assert.deepEqual(store.servedLimits, PUBLIC_EXPORT_RUNTIME_LIMITS);

		await assert.rejects(
			() => openSession(store, FILM_LENGTH_REQUEST),
			isLimitStatus(400, /^Export asks for 901 frames; the limit is 900\.$/)
		);
		assert.deepEqual(await readdir(directory), []);
		assert.deepEqual(encoder.spawnedArguments, []);
	});

	it('reports the session bounds a host configured rather than the defaults', async () => {
		const { store } = await createStore(
			{},
			{ ttlMs: 60_000, maxLifetimeMs: 120_000, maxConcurrentSessions: 1 }
		);
		assert.deepEqual(store.servedLimits, {
			...DEVELOPMENT_EXPORT_RUNTIME_LIMITS,
			maxConcurrentSessions: 1,
			sessionIdleTimeoutMs: 60_000,
			sessionMaxLifetimeMs: 120_000
		});
	});

	it('serves the limits the host enforces, uncached, and only to a read', async () => {
		assert.deepEqual(Object.keys(exportLimitsRoute), ['GET']);
		// The handler reads nothing from the request, so it is called with none.
		const response = await exportLimitsRoute.GET({} as Parameters<typeof exportLimitsRoute.GET>[0]);

		assert.equal(response.status, 200);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
		assert.deepEqual(
			parseExportRuntimeLimits(await response.json()),
			DEVELOPMENT_EXPORT_RUNTIME_LIMITS
		);
	});
});

/**
 * ADR-0052: the public export transport belongs to the browser that opened each
 * session. These fixtures come at it the way an attacker would — from another
 * origin, with another session's credential, with a crafted identity, twice, and
 * after it is over — and check that each attempt is refused without giving up
 * content, a private path, or an encoder's own words.
 */
describe('public export request security', () => {
	async function completedSession(store: ExportSessionStore): Promise<OpenedTestSession> {
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		return session;
	}

	it('issues unpredictable identities and keeps the credential out of the response body', async () => {
		const { store } = await createStore();
		const first = await openSession(store, WEBM_SINGLE_FRAME);
		const second = await openSession(store, WEBM_SINGLE_FRAME);

		for (const session of [first, second]) {
			assert.ok(isExportSessionIdentity(session.sessionId));
			assert.equal(session.sessionId.length, EXPORT_SESSION_IDENTITY_LENGTH);
			const credential = session.cookie.split('=')[1];
			assert.ok(isExportSessionIdentity(credential));
			assert.notEqual(credential, session.sessionId);
			// The identity is what URLs — and therefore logs — carry. The
			// credential appears in none of them.
			for (const url of [
				session.audioUrl,
				session.frameUrlTemplate,
				session.completeUrl,
				session.cancelUrl
			]) {
				assert.ok(!url.includes(credential));
			}
		}
		assert.notEqual(first.sessionId, second.sessionId);

		await Promise.all([
			store.cancel(first.sessionId, controlRequest(first, 'DELETE')),
			store.cancel(second.sessionId, controlRequest(second, 'DELETE'))
		]);
	});

	it('scopes the credential cookie to its own session and to this origin', async () => {
		const { store } = await createStore({}, { maxLifetimeMs: 90_000 });
		const opened = await store.create(createSessionRequest(WEBM_SINGLE_FRAME));
		const cookie = opened.credentialCookie;
		assert.ok(cookie.startsWith(`gfx_export_${opened.document.sessionId}=`));
		assert.ok(cookie.includes(`Path=/api/export/sessions/${opened.document.sessionId}`));
		assert.ok(cookie.includes('HttpOnly'));
		assert.ok(cookie.includes('SameSite=Strict'));
		// The credential expires with the session's hard lifetime, never after it.
		assert.ok(cookie.includes('Max-Age=90'));
		// A plain http development origin would refuse to store a Secure cookie.
		assert.ok(!cookie.includes('Secure'));

		const secure = await store.create(
			new Request('https://gfx.computer/api/export/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Origin: 'https://gfx.computer' },
				body: JSON.stringify(WEBM_SINGLE_FRAME)
			})
		);
		assert.ok(secure.credentialCookie.includes('Secure'));
	});

	it('refuses a session opened or driven from another origin', async () => {
		const { store, directory, encoder } = await createStore();
		await assert.rejects(
			() =>
				store.create(
					new Request(`${TEST_ORIGIN}/api/export/sessions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
						body: JSON.stringify(WEBM_SINGLE_FRAME)
					})
				),
			isLimitStatus(403, /must come from this origin/)
		);
		// A mutating request with no Origin at all is not from a browser we serve.
		await assert.rejects(
			() =>
				store.create(
					new Request(`${TEST_ORIGIN}/api/export/sessions`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(WEBM_SINGLE_FRAME)
					})
				),
			isLimitStatus(403, /must come from this origin/)
		);
		assert.deepEqual(await readdir(directory), []);
		assert.deepEqual(encoder.spawnedArguments, []);

		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await assert.rejects(
			() =>
				store.uploadFrame(
					session.sessionId,
					0,
					frameRequest(session, { headers: { Origin: 'https://evil.example' } })
				),
			isLimitStatus(403, /must come from this origin/)
		);
		// The refusal belongs to the caller, not to the session it was aimed at.
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	it('refuses a download a cross-site page navigated to', async () => {
		const { store, directory } = await createStore();
		const session = await completedSession(store);
		await assert.rejects(
			() =>
				store.outputResponse(
					session.sessionId,
					downloadRequest(session, { 'Sec-Fetch-Site': 'cross-site' })
				),
			isLimitStatus(403, /must come from this origin/)
		);
		// The output is still there for its owner, who then drains it.
		const response = await store.outputResponse(session.sessionId, downloadRequest(session));
		assert.equal(await response.text(), 'encoded-video');
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses a request carrying no credential or another session credential', async () => {
		const { store, directory } = await createStore();
		const mine = await completedSession(store);
		const theirs = await openSession(store, WEBM_SINGLE_FRAME);

		const anonymous = new Request(`${TEST_ORIGIN}/api/export/sessions/${mine.sessionId}/output`, {
			headers: { 'Sec-Fetch-Site': 'same-origin' }
		});
		await assert.rejects(
			() => store.outputResponse(mine.sessionId, anonymous),
			isLimitStatus(403, /credential is missing/)
		);
		// The other browser's own cookie is named for its own session, so it is
		// not even presented here.
		await assert.rejects(
			() =>
				store.outputResponse(
					mine.sessionId,
					downloadRequest({ sessionId: mine.sessionId, cookie: theirs.cookie })
				),
			isLimitStatus(403, /credential is missing/)
		);
		// Renaming that cookie to this session does not make its value fit.
		const forged = `gfx_export_${mine.sessionId}=${theirs.cookie.split('=')[1]}`;
		await assert.rejects(
			() =>
				store.outputResponse(
					mine.sessionId,
					downloadRequest({ sessionId: mine.sessionId, cookie: forged })
				),
			isLimitStatus(403, /another browser session/)
		);

		// None of it disturbed the session, which its owner then drains.
		const response = await store.outputResponse(mine.sessionId, downloadRequest(mine));
		assert.equal(await response.text(), 'encoded-video');
		await store.cancel(theirs.sessionId, controlRequest(theirs, 'DELETE'));
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses a replayed download once the first one drained', async () => {
		const { store, directory } = await createStore();
		const session = await completedSession(store);
		assert.equal(
			await (await store.outputResponse(session.sessionId, downloadRequest(session))).text(),
			'encoded-video'
		);
		await assert.rejects(
			() => store.outputResponse(session.sessionId, downloadRequest(session)),
			isLimitStatus(404, /not found/)
		);
		// Replaying the completion does not resurrect the output either.
		await assert.rejects(
			() => store.complete(session.sessionId, controlRequest(session)),
			isLimitStatus(404, /not found/)
		);
		assert.deepEqual(await readdir(directory), []);
	});

	it('refuses an identity this origin never issued, without touching the filesystem', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		const crafted = ['../../etc/passwd', '..', '', `${session.sessionId}/../..`, 'gfx-export-1'];
		for (const identity of crafted) {
			await assert.rejects(
				() =>
					store.uploadFrame(
						identity,
						0,
						frameRequest({ sessionId: identity, cookie: session.cookie })
					),
				isLimitStatus(404, /not found/)
			);
		}
		assert.throws(() => parseExportFrameIndex('../0'), ExportSessionError);
		assert.throws(() => parseExportFrameIndex('-1'), ExportSessionError);
		// Only the one real session's directory exists; nothing was created or read.
		assert.deepEqual(await readdir(directory), [`gfx-export-${session.sessionId}`]);
		await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
	});

	// Open sessions are private to the browsers holding them, so the collection
	// answers to nothing that would enumerate them.
	it('exposes no way to list open sessions', () => {
		assert.deepEqual(Object.keys(sessionsCollectionRoute), ['POST']);
	});

	it('answers a download with no-store, nosniff, and no resumable range', async () => {
		const { store } = await createStore();
		const session = await completedSession(store);
		const response = await store.outputResponse(session.sessionId, downloadRequest(session));
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(response.headers.get('accept-ranges'), 'none');
		assert.equal(response.headers.get('vary'), 'Cookie');
		await response.text();
	});

	it('tells a caller an encode failed without repeating the encoder or its paths', async () => {
		const { store, directory } = await createStore({
			exitCode: 1,
			stderr: '/private/var/gfx-export-abc/output.webm: encoder exploded'
		});
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		const failure = await store
			.complete(session.sessionId, controlRequest(session))
			.then(() => null)
			.catch((cause: unknown) => cause);
		assert.ok(failure instanceof ExportSessionError);
		assert.equal(failure.status, 500);
		assert.equal(failure.message, 'Export encoding failed.');
		assert.ok(!failure.message.includes('encoder exploded'));
		assert.ok(!failure.message.includes(directory));
		assert.ok(!failure.message.includes(session.sessionId));
		assert.deepEqual(await readdir(directory), []);
	});
});

/**
 * ADR-0052: a public export session ends by leaving nothing behind. Every
 * terminal path is driven repeatedly against one store, the way one host runs
 * them, and each disposal has to account for what it released.
 */
describe('public export cleanup and zero retention', () => {
	/**
	 * A clock reading past the idle timeout for every directory that exists now.
	 * `mtimeMs` carries sub-millisecond precision, so a directory created in this
	 * millisecond is fractionally younger than the integer `Date.now()` it is
	 * compared against.
	 */
	function afterIdleTimeout(): number {
		return Date.now() + PUBLIC_EXPORT_RUNTIME_LIMITS.sessionIdleTimeoutMs + 1_000;
	}

	/** Drive one session all the way to a drained download. */
	async function runDownloadedExport(store: ExportSessionStore): Promise<void> {
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		const response = await store.outputResponse(session.sessionId, downloadRequest(session));
		assert.ok(response.body);
		await new Response(response.body).arrayBuffer();
	}

	it('leaves no session, encoder, or file behind across repeated terminal paths', async () => {
		const cycles = 3;
		const { store, directory, encoder } = await createStore();
		for (let cycle = 0; cycle < cycles; cycle += 1) {
			await runDownloadedExport(store);

			const cancelled = await openSession(store, WEBM_SINGLE_FRAME);
			await store.uploadFrame(cancelled.sessionId, 0, frameRequest(cancelled));
			await store.cancel(cancelled.sessionId, controlRequest(cancelled, 'DELETE'));

			const refused = await openSession(store, WEBM_SINGLE_FRAME);
			await assert.rejects(
				() =>
					store.uploadFrame(refused.sessionId, 0, frameRequest(refused, { type: 'image/jpeg' })),
				/Expected an image\/png/
			);

			encoder.behavior.exitCode = 1;
			const failed = await openSession(store, WEBM_SINGLE_FRAME);
			await store.uploadFrame(failed.sessionId, 0, frameRequest(failed));
			await assert.rejects(
				() => store.complete(failed.sessionId, controlRequest(failed)),
				isLimitStatus(500, /^Export encoding failed\.$/)
			);
			encoder.behavior.exitCode = 0;

			assert.equal(store.openSessionCount, 0);
			assert.deepEqual(await readdir(directory), []);
		}

		assert.deepEqual(findExportCleanupLeaks(store.cleanupReceipts), []);
		assert.deepEqual(
			store.cleanupReceipts.map((receipt) => receipt.reason),
			Array.from({ length: cycles }, () => ['downloaded', 'cancelled', 'failed', 'failed']).flat()
		);
		assert.equal(
			new Set(store.cleanupReceipts.map((receipt) => receipt.sessionId)).size,
			cycles * 4
		);
		assert.ok(encoder.children.every((child) => child.exited));
	});

	it('ends a session whose encoder dies mid-export instead of carrying the crash further', async () => {
		const { store, directory, encoder } = await createStore({ crashAfterWrites: 2 });
		const session = await openSession(store, { ...WEBM_SINGLE_FRAME, frameCount: 2 });
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		// A crashed encoder is this origin's own fault, so it must keep reaching the
		// route raw — classifying cancellations must not relabel it a 410.
		await assert.rejects(
			() => store.uploadFrame(session.sessionId, 1, frameRequest(session)),
			(error: unknown) => !(error instanceof ExportSessionError && error.status === 410)
		);

		assert.equal(store.openSessionCount, 0);
		assert.deepEqual(await readdir(directory), []);
		assert.equal(store.cleanupReceipts.at(-1)?.reason, 'failed');
		assert.deepEqual(findExportCleanupLeaks(store.cleanupReceipts), []);
		assert.ok(encoder.children[0].exited);
	});

	it('ends a download that never drains at the hard lifetime and releases its output', async () => {
		let now = 1_000;
		const { store, directory } = await createStore(
			{},
			{ ttlMs: 10_000, maxLifetimeMs: 500, now: () => now }
		);
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(session.sessionId, 0, frameRequest(session));
		await store.complete(session.sessionId, controlRequest(session));
		const response = await store.outputResponse(session.sessionId, downloadRequest(session));
		const body = response.body;
		assert.ok(body);

		now = 1_600;
		assert.equal(await store.cleanupStale(), 1);
		assert.equal(store.openSessionCount, 0);
		assert.deepEqual(await readdir(directory), []);
		const receipt = store.cleanupReceipts.at(-1);
		assert.equal(receipt?.reason, 'lifetime-expired');
		assert.equal(receipt?.downloadClosed, true);
		// The transfer is over, not merely unlinked: an output still readable
		// through an open descriptor would outlive the session that owned it.
		await assert.rejects(() => body.getReader().read());
	});

	// Root would bypass the directory permission this fixture removes the entry through.
	it.skipIf(process.getuid?.() === 0)(
		'records a work directory it could not remove without failing the request that ended the session',
		async () => {
			const { store, directory } = await createStore();
			const session = await openSession(store, WEBM_SINGLE_FRAME);
			await store.uploadFrame(session.sessionId, 0, frameRequest(session));
			await store.complete(session.sessionId, controlRequest(session));

			await chmod(directory, 0o500);
			try {
				await store.cancel(session.sessionId, controlRequest(session, 'DELETE'));
			} finally {
				await chmod(directory, 0o700);
			}
			assert.equal(store.openSessionCount, 0);
			assert.deepEqual(findExportCleanupLeaks(store.cleanupReceipts), [
				`Export session ${session.sessionId} (cancelled) left its work directory on disk.`
			]);

			// The directory keeps this build's export prefix, so the orphan sweep is
			// what finally collects it — no live session owns it any more.
			assert.equal(await store.sweepOrphanedDirectories(afterIdleTimeout()), 1);
			assert.deepEqual(await readdir(directory), []);
		}
	);

	it('keeps a live session out of the orphan sweep', async () => {
		const { store, directory } = await createStore();
		const session = await openSession(store, WEBM_SINGLE_FRAME);
		await mkdir(join(directory, 'gfx-export-abandoned'));

		assert.equal(await store.sweepOrphanedDirectories(afterIdleTimeout()), 1);
		assert.deepEqual(await readdir(directory), [`gfx-export-${session.sessionId}`]);
		assert.equal(store.openSessionCount, 1);
	});

	// A signalled host has to exit inside its orchestrator's grace period, and an
	// encoder still writing would hold the process open past it (ADR-0052).
	it('releases every open session when the host is signalled', async () => {
		const { store, directory } = await createStore();
		const encoding = await openSession(store, WEBM_SINGLE_FRAME);
		await store.uploadFrame(encoding.sessionId, 0, frameRequest(encoding));
		const opened = await openSession(store, WEBM_SINGLE_FRAME);
		assert.equal(store.openSessionCount, 2);

		const receipts = await store.disposeOpenSessions();

		assert.deepEqual(
			receipts.map((receipt) => receipt.reason),
			['shutdown', 'shutdown']
		);
		assert.deepEqual(
			[...receipts.map((receipt) => receipt.sessionId)].sort(),
			[encoding.sessionId, opened.sessionId].sort()
		);
		assert.deepEqual(findExportCleanupLeaks(receipts), []);
		assert.equal(store.openSessionCount, 0);
		assert.deepEqual(await readdir(directory), []);
	});

	it('has nothing to release on a host that was signalled while idle', async () => {
		const { store } = await createStore();
		assert.deepEqual(await store.disposeOpenSessions(), []);
	});
});
