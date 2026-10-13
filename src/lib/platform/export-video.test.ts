import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vite-plus/test';

import {
	downloadBlob,
	downloadVideoExport,
	EXPORT_DELIVERY_STATUS_POLL_MS,
	exportTransparentWebM,
	fetchServedExportRuntimeLimits
} from './export-video';
import {
	DEVELOPMENT_EXPORT_RUNTIME_LIMITS,
	PUBLIC_EXPORT_RUNTIME_LIMITS
} from './public-runtime-contract';

// Sixteen bytes a part, so a bed of a few samples already needs several parts.
// The real part size is 32 MiB; `public-export-limits.test.ts` holds it under
// the per-request ceiling.
vi.mock('./public-export-limits', async (importOriginal) => ({
	...(await importOriginal<typeof import('./public-export-limits')>()),
	EXPORT_AUDIO_UPLOAD_PART_BYTES: 16
}));

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('downloadBlob', () => {
	it('applies the requested filename and revokes the object URL after clicking', () => {
		const link = { href: '', download: '', click: vi.fn() };
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		vi.stubGlobal('document', { createElement: () => link });

		downloadBlob(new Blob(['media']), 'gfx-overlay.webm');

		assert.equal(createObjectURL.mock.calls.length, 1);
		assert.equal(link.href, 'blob:export');
		assert.equal(link.download, 'gfx-overlay.webm');
		assert.equal(link.click.mock.calls.length, 1);
		assert.deepEqual(revokeObjectURL.mock.calls, [['blob:export']]);
	});

	it('still revokes the object URL when the browser download click fails', () => {
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-export');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		vi.stubGlobal('document', {
			createElement: () => ({
				href: '',
				download: '',
				click: () => {
					throw new Error('click failed');
				}
			})
		});

		assert.throws(() => downloadBlob(new Blob(), 'failed.webm'), /click failed/);
		assert.deepEqual(revokeObjectURL.mock.calls, [['blob:failed-export']]);
	});
});

describe('downloadVideoExport for an origin-encoded file', () => {
	const ORIGIN_EXPORT = {
		transport: 'origin',
		downloadUrl: '/api/export/sessions/session-id/output',
		deliveryStatusUrl: '/api/export/sessions/session-id',
		cancelUrl: '/api/export/sessions/session-id'
	} as const;

	function stubDownloadLink(): { href: string; download: string; click: ReturnType<typeof vi.fn> } {
		const link = { href: '', download: '', click: vi.fn() };
		vi.stubGlobal('document', { createElement: () => link });
		return link;
	}

	/** Answer each status read with the next document, and record every request. */
	function stubOriginStatus(statuses: readonly (Response | Record<string, unknown>)[]): string[] {
		const requests: string[] = [];
		let read = 0;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
			if (init?.method === 'DELETE') return new Response(null, { status: 204 });
			const status = statuses[Math.min(read, statuses.length - 1)];
			read += 1;
			return status instanceof Response ? status : Response.json(status);
		});
		return requests;
	}

	it('hands the output URL to the browser and never reads the file into the page', async () => {
		vi.useFakeTimers();
		const link = stubDownloadLink();
		const createObjectURL = vi.spyOn(URL, 'createObjectURL');
		const requests = stubOriginStatus([{ state: 'delivered', outputBytes: 1_500_000_000 }]);

		const pending = downloadVideoExport(ORIGIN_EXPORT, 'gfx-bumper.mov');
		await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS);

		assert.equal(await pending, 1_500_000_000);
		// The browser is given the session URL itself, under the export's name.
		assert.equal(link.href, '/api/export/sessions/session-id/output');
		assert.equal(link.download, 'gfx-bumper.mov');
		assert.equal(link.click.mock.calls.length, 1);
		// The page asked how the download went; it never fetched the output.
		assert.deepEqual(requests, ['GET /api/export/sessions/session-id']);
		assert.equal(createObjectURL.mock.calls.length, 0);
	});

	it('does not answer until the origin says the download was delivered', async () => {
		vi.useFakeTimers();
		stubDownloadLink();
		const requests = stubOriginStatus([
			{ state: 'pending' },
			{ state: 'downloading' },
			{ state: 'downloading' },
			{ state: 'delivered', outputBytes: 14 }
		]);
		let deliveredBytes: number | null = null;
		const pending = downloadVideoExport(ORIGIN_EXPORT, 'gfx-bumper.mov').then((bytes) => {
			deliveredBytes = bytes;
		});

		await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS * 3);
		assert.equal(requests.length, 3);
		assert.equal(deliveredBytes, null);

		await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS);
		await pending;
		assert.equal(deliveredBytes, 14);
		// A delivered session is already gone, so there is nothing to cancel.
		assert.ok(!requests.some((request) => request.startsWith('DELETE')));
	});

	for (const [state, message] of [
		['cancelled', /stopped before the whole file was saved/],
		['failed', /failed before the whole file was sent/],
		['expired', /expired before the file was downloaded/]
	] as const) {
		it(`carries a download the origin reports ${state} out as the export's failure`, async () => {
			vi.useFakeTimers();
			stubDownloadLink();
			const requests = stubOriginStatus([{ state: 'downloading' }, { state }]);

			const pending = downloadVideoExport(ORIGIN_EXPORT, 'gfx-bumper.mov');
			const failure = assert.rejects(pending, message);
			await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS * 2);

			await failure;
			assert.ok(requests.includes('DELETE /api/export/sessions/session-id'));
		});
	}

	it('carries a refused status read out as its failure and releases the session', async () => {
		vi.useFakeTimers();
		stubDownloadLink();
		const requests = stubOriginStatus([
			new Response('This export session credential is missing. Start a new export.', {
				status: 403
			})
		]);

		const pending = downloadVideoExport(ORIGIN_EXPORT, 'gfx-bumper.mov');
		const failure = assert.rejects(pending, /credential is missing/);
		await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS);

		await failure;
		assert.ok(requests.includes('DELETE /api/export/sessions/session-id'));
	});

	it('refuses a status document it does not recognise rather than reading it as delivered', async () => {
		vi.useFakeTimers();
		stubDownloadLink();
		stubOriginStatus([{ state: 'delivered' }]);

		const pending = downloadVideoExport(ORIGIN_EXPORT, 'gfx-bumper.mov');
		const failure = assert.rejects(pending, /invalid document/);
		await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS);

		await failure;
	});

	it('stops waiting and cancels the session when the caller aborts', async () => {
		vi.useFakeTimers();
		const link = stubDownloadLink();
		const requests = stubOriginStatus([{ state: 'downloading' }]);
		const abortController = new AbortController();

		const pending = downloadVideoExport(ORIGIN_EXPORT, 'gfx-overlay.webm', abortController.signal);
		const failure = assert.rejects(pending, /abort/i);
		await vi.advanceTimersByTimeAsync(EXPORT_DELIVERY_STATUS_POLL_MS);
		abortController.abort();

		await failure;
		// The download had started; cancelling the session is what ends it.
		assert.equal(link.click.mock.calls.length, 1);
		assert.equal(requests.at(-1), 'DELETE /api/export/sessions/session-id');
		assert.equal(vi.getTimerCount(), 0);
	});

	it('starts no download once the export was already cancelled', async () => {
		const link = stubDownloadLink();
		const requests = stubOriginStatus([{ state: 'pending' }]);
		const abortController = new AbortController();
		abortController.abort();

		await assert.rejects(
			downloadVideoExport(ORIGIN_EXPORT, 'gfx-overlay.webm', abortController.signal),
			/abort/i
		);
		assert.equal(link.click.mock.calls.length, 0);
		assert.deepEqual(requests, ['DELETE /api/export/sessions/session-id']);
	});
});

describe('downloadVideoExport for a browser-encoded file', () => {
	it('hands the file over directly and answers with its size, touching no session', async () => {
		const link = { href: '', download: '', click: vi.fn() };
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:browser-encoded');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		vi.stubGlobal('document', { createElement: () => link });
		const fetchCalls: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
			fetchCalls.push(String(input));
			return new Response(null, { status: 204 });
		});

		const byteLength = await downloadVideoExport(
			{ transport: 'browser', file: new Blob(['webm-bytes'], { type: 'video/webm' }) },
			'gfx-overlay.webm'
		);

		assert.equal(byteLength, 10);
		// The file is one this page already holds, so it is saved from its Blob.
		assert.equal(link.href, 'blob:browser-encoded');
		assert.equal(link.download, 'gfx-overlay.webm');
		assert.equal(link.click.mock.calls.length, 1);
		assert.deepEqual(fetchCalls, []);
	});

	it('does not hand over a file once the export was cancelled', async () => {
		const link = { href: '', download: '', click: vi.fn() };
		vi.stubGlobal('document', { createElement: () => link });
		const abortController = new AbortController();
		abortController.abort();

		await assert.rejects(
			downloadVideoExport(
				{ transport: 'browser', file: new Blob(['webm-bytes']) },
				'gfx-overlay.webm',
				abortController.signal
			),
			/abort/i
		);
		assert.equal(link.click.mock.calls.length, 0);
	});
});

describe('export session client', () => {
	it('renders and uploads one frame at a time before naming the disk download', async () => {
		const calls: { url: string; init: RequestInit | undefined }[] = [];
		class FakeOffscreenCanvas {
			width = 3840;
			height = 2160;
			async convertToBlob(): Promise<Blob> {
				return new Blob(['png-frame'], { type: 'image/png' });
			}
		}
		vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init });
			if (url === '/api/export/sessions') {
				return Response.json(
					{
						sessionId: 'session-id',
						audioUrl: '/session/audio',
						frameUrlTemplate: '/session/frames/{frame}',
						completeUrl: '/session/complete',
						cancelUrl: '/session'
					},
					{ status: 201 }
				);
			}
			if (url === '/session/complete') {
				return Response.json({ downloadUrl: '/session/output', deliveryStatusUrl: '/session' });
			}
			return new Response(null, { status: 204 });
		});
		const rendered: number[] = [];
		const video = await exportTransparentWebM({
			canvas: new FakeOffscreenCanvas() as OffscreenCanvas,
			durationSeconds: 2,
			fps: 1,
			frameCount: 2,
			renderFrame: (frame) => {
				rendered.push(frame);
			}
		});

		assert.deepEqual(rendered, [0, 1]);
		assert.deepEqual(video, {
			transport: 'origin',
			downloadUrl: '/session/output',
			deliveryStatusUrl: '/session',
			cancelUrl: '/session'
		});
		assert.deepEqual(
			calls.map((call) => call.url),
			['/api/export/sessions', '/session/frames/0', '/session/frames/1', '/session/complete']
		);
		assert.ok(calls[1].init?.body instanceof Blob);
		assert.ok(calls[2].init?.body instanceof Blob);
		assert.notEqual(calls[1].init?.body, calls[2].init?.body);
		assert.equal(
			calls.some((call) => call.url === '/session/output'),
			false
		);
	});

	/** Three mono samples: a 44-byte WAV header and 6 bytes of data, 50 in all. */
	function threeSampleAudio(): AudioBuffer {
		const samples = new Float32Array([0.25, -0.5, 1]);
		return {
			length: samples.length,
			numberOfChannels: 1,
			sampleRate: 48_000,
			getChannelData: () => samples
		} as unknown as AudioBuffer;
	}

	function stubExportSessionFetch(
		respond: (url: string, init: RequestInit | undefined) => Response | undefined
	): { url: string; init: RequestInit | undefined }[] {
		const calls: { url: string; init: RequestInit | undefined }[] = [];
		class FakeOffscreenCanvas {
			async convertToBlob(): Promise<Blob> {
				return new Blob(['png-frame'], { type: 'image/png' });
			}
		}
		vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init });
			const response = respond(url, init);
			if (response) return response;
			if (url === '/api/export/sessions') {
				return Response.json(
					{
						sessionId: 'session-id',
						audioUrl: '/session/audio',
						frameUrlTemplate: '/session/frames/{frame}',
						completeUrl: '/session/complete',
						cancelUrl: '/session'
					},
					{ status: 201 }
				);
			}
			if (url === '/session/complete') {
				return Response.json({ downloadUrl: '/session/output', deliveryStatusUrl: '/session' });
			}
			return new Response(null, { status: 204 });
		});
		return calls;
	}

	it('uploads the audio bed in ordered parts before the first frame', async () => {
		const calls = stubExportSessionFetch(() => undefined);

		await exportTransparentWebM({
			canvas: new OffscreenCanvas(1, 1),
			durationSeconds: 1,
			fps: 1,
			frameCount: 1,
			renderFrame: () => undefined,
			audio: threeSampleAudio()
		});

		assert.deepEqual(
			calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`),
			[
				'POST /api/export/sessions',
				'PUT /session/audio?offset=0',
				'PUT /session/audio?offset=16',
				'PUT /session/audio?offset=32',
				'PUT /session/audio?offset=48',
				'PUT /session/frames/0',
				'POST /session/complete'
			]
		);
		// The session is told the whole bed, and the parts are that bed in order.
		assert.equal(JSON.parse(String(calls[0].init?.body)).audioBytes, 50);
		const parts = calls.slice(1, 5).map((call) => call.init?.body);
		assert.ok(parts.every((part) => part instanceof Blob && part.type === 'audio/wav'));
		const sizes = parts.map((part) => (part instanceof Blob ? part.size : -1));
		assert.deepEqual(sizes, [16, 16, 16, 2]);
		const bed = new Uint8Array(
			await new Blob(parts.filter((part) => part instanceof Blob)).arrayBuffer()
		);
		assert.equal(new TextDecoder().decode(bed.subarray(0, 4)), 'RIFF');
		assert.equal(new DataView(bed.buffer).getUint32(40, true), 6);
		assert.equal(new DataView(bed.buffer).getInt16(48, true), 32767);
	});

	it('uploads no audio for a soundless export', async () => {
		const calls = stubExportSessionFetch(() => undefined);

		await exportTransparentWebM({
			canvas: new OffscreenCanvas(1, 1),
			durationSeconds: 1,
			fps: 1,
			frameCount: 1,
			renderFrame: () => undefined,
			audio: null
		});

		assert.equal(JSON.parse(String(calls[0].init?.body)).audioBytes, 0);
		assert.equal(
			calls.some((call) => call.url.startsWith('/session/audio')),
			false
		);
	});

	it('stops at the part the origin refuses and cancels the session', async () => {
		const calls = stubExportSessionFetch((url) =>
			url === '/session/audio?offset=16'
				? new Response('Expected export audio from byte 0, received byte 16.', { status: 409 })
				: undefined
		);

		await assert.rejects(
			exportTransparentWebM({
				canvas: new OffscreenCanvas(1, 1),
				durationSeconds: 1,
				fps: 1,
				frameCount: 1,
				renderFrame: () => undefined,
				audio: threeSampleAudio()
			}),
			/^Error: Expected export audio from byte 0, received byte 16\.$/
		);

		assert.deepEqual(
			calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`),
			[
				'POST /api/export/sessions',
				'PUT /session/audio?offset=0',
				'PUT /session/audio?offset=16',
				'DELETE /session'
			]
		);
	});

	it('cancels the server session when the shared AbortSignal stops a frame upload', async () => {
		class FakeOffscreenCanvas {
			async convertToBlob(): Promise<Blob> {
				return new Blob(['png-frame'], { type: 'image/png' });
			}
		}
		vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
		let markFrameStarted = (): void => undefined;
		const frameStarted = new Promise<void>((resolve) => {
			markFrameStarted = resolve;
		});
		const calls: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push(`${init?.method ?? 'GET'} ${url}`);
			if (url === '/api/export/sessions') {
				return Response.json({
					sessionId: 'session-id',
					audioUrl: '/session/audio',
					frameUrlTemplate: '/session/frames/{frame}',
					completeUrl: '/session/complete',
					cancelUrl: '/session'
				});
			}
			if (url === '/session/frames/0') {
				markFrameStarted();
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true
					});
				});
			}
			return new Response(null, { status: 204 });
		});
		const abortController = new AbortController();
		const pending = exportTransparentWebM({
			canvas: new FakeOffscreenCanvas() as OffscreenCanvas,
			durationSeconds: 1,
			fps: 1,
			frameCount: 1,
			renderFrame: () => undefined,
			signal: abortController.signal
		});
		await frameStarted;
		abortController.abort();
		await assert.rejects(pending, /abort/i);
		assert.ok(calls.includes('DELETE /session'));
		assert.equal(calls.includes('POST /session/complete'), false);
	});
});

/** ADR-0068 §9: the page asks its origin which export envelope it enforces. */
describe('fetchServedExportRuntimeLimits', () => {
	it('reads the limits the origin serves', async () => {
		const requests: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return Response.json(DEVELOPMENT_EXPORT_RUNTIME_LIMITS);
		});

		assert.deepEqual(await fetchServedExportRuntimeLimits(), DEVELOPMENT_EXPORT_RUNTIME_LIMITS);
		assert.deepEqual(requests, ['/api/export/limits']);
	});

	it('resolves to the public envelope on the hosted origin, which serves no export route', async () => {
		vi.stubGlobal('fetch', async () => new Response('Not found', { status: 404 }));

		assert.equal(await fetchServedExportRuntimeLimits(), PUBLIC_EXPORT_RUNTIME_LIMITS);
	});

	it('fails rather than guessing when the origin answers with something else', async () => {
		vi.stubGlobal('fetch', async () => new Response('Export host is restarting.', { status: 503 }));
		await assert.rejects(() => fetchServedExportRuntimeLimits(), /Export host is restarting\./);

		vi.stubGlobal('fetch', async () => Response.json({ maxDurationSeconds: 600 }));
		await assert.rejects(
			() => fetchServedExportRuntimeLimits(),
			/Export limits returned an invalid document\./
		);
	});
});
