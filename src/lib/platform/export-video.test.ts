import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { downloadBlob, downloadVideoExport, exportTransparentWebM } from './export-video';

afterEach(() => {
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

describe('downloadVideoExport', () => {
	function stubDownloadLink(): { href: string; download: string; click: ReturnType<typeof vi.fn> } {
		const link = { href: '', download: '', click: vi.fn() };
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:delivered');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		vi.stubGlobal('document', { createElement: () => link });
		return link;
	}

	it('answers with the byte count only once the browser has the whole file', async () => {
		const link = stubDownloadLink();
		const requests: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
			return new Response(new Blob(['encoded-output']), {
				headers: { 'Content-Length': '14' }
			});
		});

		const byteLength = await downloadVideoExport(
			{
				transport: 'origin',
				downloadUrl: '/api/export/sessions/session-id/output',
				cancelUrl: '/session'
			},
			'gfx-bumper.mov'
		);

		assert.equal(byteLength, 14);
		assert.equal(link.href, 'blob:delivered');
		assert.equal(link.download, 'gfx-bumper.mov');
		assert.equal(link.click.mock.calls.length, 1);
		assert.deepEqual(requests, ['GET /api/export/sessions/session-id/output']);
	});

	it('carries a refused download out as its failure and releases the session', async () => {
		const link = stubDownloadLink();
		const requests: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
			if (init?.method === 'DELETE') return new Response(null, { status: 204 });
			return new Response('Export output is not ready.', { status: 409 });
		});

		await assert.rejects(
			downloadVideoExport(
				{
				transport: 'origin',
				downloadUrl: '/api/export/sessions/session-id/output',
				cancelUrl: '/session'
			},
				'gfx-bumper.mov'
			),
			/Export output is not ready/
		);
		assert.equal(link.click.mock.calls.length, 0);
		assert.ok(requests.includes('DELETE /session'));
	});

	it('refuses a transfer that ended short of the length the origin declared', async () => {
		const link = stubDownloadLink();
		vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'DELETE') return new Response(null, { status: 204 });
			return new Response(new Blob(['short']), { headers: { 'Content-Length': '4096' } });
		});

		await assert.rejects(
			downloadVideoExport(
				{
				transport: 'origin',
				downloadUrl: '/api/export/sessions/session-id/output',
				cancelUrl: '/session'
			},
				'gfx-overlay.webm'
			),
			/ended at 5 bytes; expected 4096/
		);
		assert.equal(link.click.mock.calls.length, 0);
	});

	it('stops the transfer and cancels the session when the caller aborts', async () => {
		const link = stubDownloadLink();
		const requests: string[] = [];
		let markDownloadStarted = (): void => undefined;
		const downloadStarted = new Promise<void>((resolve) => {
			markDownloadStarted = resolve;
		});
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
			if (init?.method === 'DELETE') return new Response(null, { status: 204 });
			markDownloadStarted();
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
			});
		});
		const abortController = new AbortController();

		const pending = downloadVideoExport(
			{
				transport: 'origin',
				downloadUrl: '/api/export/sessions/session-id/output',
				cancelUrl: '/session'
			},
			'gfx-overlay.webm',
			abortController.signal
		);
		await downloadStarted;
		abortController.abort();

		await assert.rejects(pending, /abort/i);
		assert.equal(link.click.mock.calls.length, 0);
		assert.ok(requests.includes('DELETE /session'));
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
				return Response.json({ downloadUrl: '/session/output' });
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
			cancelUrl: '/session'
		});
		assert.deepEqual(
			calls.map((call) => call.url),
			[
				'/api/export/sessions',
				'/session/frames/0',
				'/session/frames/1',
				'/session/complete'
			]
		);
		assert.ok(calls[1].init?.body instanceof Blob);
		assert.ok(calls[2].init?.body instanceof Blob);
		assert.notEqual(calls[1].init?.body, calls[2].init?.body);
		assert.equal(calls.some((call) => call.url === '/session/output'), false);
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
