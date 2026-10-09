import { copyFile, mkdir, mkdtemp, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { readGfxEnvironmentValue } from '../src/lib/utils/legacy-supers-compatibility.ts';

import type { Download, Page } from 'playwright';

interface CdpTarget {
	id: string;
	type: string;
	webSocketDebuggerUrl?: string;
}

interface CdpMessage {
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string };
}

interface CdpPendingCommand {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

type CdpEventListener = (params: unknown) => void;

class CdpSession {
	readonly #socket: WebSocket;
	readonly #pending = new Map<number, CdpPendingCommand>();
	readonly #listeners = new Map<string, Set<CdpEventListener>>();
	#nextId = 1;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data)) as CdpMessage;
			if (message.id !== undefined) {
				const pending = this.#pending.get(message.id);
				if (!pending) return;
				this.#pending.delete(message.id);
				if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed.'));
				else pending.resolve(message.result);
				return;
			}
			if (!message.method) return;
			for (const listener of this.#listeners.get(message.method) ?? []) {
				listener(message.params);
			}
		});
		socket.addEventListener('close', () => {
			for (const pending of this.#pending.values()) {
				pending.reject(new Error('CDP connection closed.'));
			}
			this.#pending.clear();
		});
	}

	static async connect(url: string): Promise<CdpSession> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolvePromise, reject) => {
			socket.addEventListener('open', () => resolvePromise(), { once: true });
			socket.addEventListener('error', () => reject(new Error(`Unable to connect to ${url}.`)), {
				once: true
			});
		});
		return new CdpSession(socket);
	}

	send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.#nextId++;
		return new Promise<T>((resolvePromise, reject) => {
			this.#pending.set(id, {
				resolve: (value) => resolvePromise(value as T),
				reject
			});
			this.#socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(method: string, listener: CdpEventListener): () => void {
		const listeners = this.#listeners.get(method) ?? new Set<CdpEventListener>();
		listeners.add(listener);
		this.#listeners.set(method, listeners);
		return () => listeners.delete(listener);
	}

	close(): void {
		this.#socket.close();
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
	if (timeoutMs === 0) return promise;
	return new Promise<T>((resolvePromise, reject) => {
		const timer = setTimeout(() => reject(new Error(`${description} timed out after ${timeoutMs}ms.`)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolvePromise(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

async function moveFile(source: string, destination: string): Promise<void> {
	await mkdir(dirname(destination), { recursive: true });
	try {
		await rename(source, destination);
	} catch (error) {
		if (
			typeof error !== 'object' ||
			error === null ||
			!('code' in error) ||
			error.code !== 'EXDEV'
		) {
			throw error;
		}
		await copyFile(source, destination);
		await unlink(source);
	}
}

interface CdpDownloadProgress {
	guid?: string;
	state?: 'inProgress' | 'completed' | 'canceled';
}

interface CdpDownloadWillBegin {
	guid?: string;
	/** The name the browser would save the file under, were it not named by guid. */
	suggestedFilename?: string;
}

class CdpRenderPage {
	readonly #browserSession: CdpSession;
	readonly #pageSession: CdpSession;
	readonly #targetId: string;
	readonly #browserContextId: string;
	readonly #downloadDirectory: string;

	constructor(options: {
		browserSession: CdpSession;
		pageSession: CdpSession;
		targetId: string;
		browserContextId: string;
		downloadDirectory: string;
	}) {
		this.#browserSession = options.browserSession;
		this.#pageSession = options.pageSession;
		this.#targetId = options.targetId;
		this.#browserContextId = options.browserContextId;
		this.#downloadDirectory = options.downloadDirectory;
	}

	async initialize(): Promise<void> {
		await Promise.all([
			this.#pageSession.send('Page.enable'),
			this.#pageSession.send('Runtime.enable'),
			this.#browserSession.send('Browser.setDownloadBehavior', {
				behavior: 'allowAndName',
				downloadPath: this.#downloadDirectory,
				eventsEnabled: true,
				browserContextId: this.#browserContextId
			})
		]);
	}

	async goto(url: string, options: { timeout?: number } = {}): Promise<null> {
		const loaded = new Promise<void>((resolvePromise) => {
			const off = this.#pageSession.on('Page.loadEventFired', () => {
				off();
				resolvePromise();
			});
		});
		await this.#pageSession.send('Page.navigate', { url });
		await withTimeout(loaded, options.timeout ?? 30_000, `Navigation to ${url}`);
		return null;
	}

	async evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> {
		const expression = `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
		const response = await this.#pageSession.send<{
			result?: { value?: T; description?: string };
			exceptionDetails?: { text?: string; exception?: { description?: string } };
		}>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (response.exceptionDetails) {
			throw new Error(
				response.exceptionDetails.exception?.description ??
					response.exceptionDetails.text ??
					'CDP evaluation failed.'
			);
		}
		return response.result?.value as T;
	}

	async waitForFunction<A>(
		fn: (arg: A) => unknown,
		arg: A,
		options: { timeout?: number } = {}
	): Promise<null> {
		const timeoutMs = options.timeout ?? 30_000;
		const startedAt = Date.now();
		while (true) {
			if (await this.evaluate(fn, arg)) return null;
			if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
				throw new Error(`Page condition timed out after ${timeoutMs}ms.`);
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
		}
	}

	waitForEvent(event: 'download', options: { timeout?: number } = {}): Promise<Download> {
		if (event !== 'download') throw new TypeError(`Unsupported CDP page event: ${event}.`);
		const timeoutMs = options.timeout ?? 30_000;
		const pending = new Promise<Download>((resolvePromise, reject) => {
			let guid = '';
			let suggestedFilename = '';
			const offBegin = this.#browserSession.on('Browser.downloadWillBegin', (params) => {
				const eventValue = params as CdpDownloadWillBegin;
				if (!eventValue.guid) return;
				guid = eventValue.guid;
				suggestedFilename = eventValue.suggestedFilename ?? '';
			});
			const offProgress = this.#browserSession.on('Browser.downloadProgress', (params) => {
				const eventValue = params as CdpDownloadProgress;
				if (!guid || eventValue.guid !== guid || eventValue.state === 'inProgress') return;
				offBegin();
				offProgress();
				if (eventValue.state === 'canceled') {
					reject(new Error('Browser download was canceled.'));
					return;
				}
				const downloadedPath = join(this.#downloadDirectory, guid);
				resolvePromise({
					suggestedFilename: () => suggestedFilename,
					saveAs: (destination: string) => moveFile(downloadedPath, destination)
				} as Download);
			});
		});
		return withTimeout(pending, timeoutMs, 'Browser download');
	}

	async close(): Promise<void> {
		await this.#browserSession.send('Target.closeTarget', { targetId: this.#targetId });
		this.#pageSession.close();
	}
}

export interface CdpRenderBrowser {
	page: Page;
	disconnect(): Promise<void>;
}

async function pageTarget(cdpHttpUrl: string, targetId: string): Promise<CdpTarget> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const response = await fetch(`${cdpHttpUrl}/json/list`);
		if (!response.ok) throw new Error(`CDP target list failed with status ${response.status}.`);
		const targets = (await response.json()) as CdpTarget[];
		const target = targets.find((entry) => entry.id === targetId && entry.webSocketDebuggerUrl);
		if (target) return target;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`CDP page target ${targetId} did not become available.`);
}

/** Attach through the sanctioned CDP endpoint without Playwright's browser-context
 * bootstrap, which is incompatible with some newer system-Chrome builds. */
export async function connectCdpRenderBrowser(cdpUrl: string): Promise<CdpRenderBrowser> {
	const cdpHttpUrl = cdpUrl.replace(/\/$/, '');
	const versionResponse = await fetch(`${cdpHttpUrl}/json/version`);
	if (!versionResponse.ok) {
		throw new Error(`CanvasDrawElement browser is unavailable at ${cdpHttpUrl}.`);
	}
	const version = (await versionResponse.json()) as { webSocketDebuggerUrl?: string };
	if (!version.webSocketDebuggerUrl) throw new Error('CDP browser endpoint omitted its WebSocket URL.');

	const browserSession = await CdpSession.connect(version.webSocketDebuggerUrl);
	const { browserContextId } = await browserSession.send<{ browserContextId: string }>(
		'Target.createBrowserContext'
	);
	const created = await browserSession.send<{ targetId: string }>('Target.createTarget', {
		url: 'about:blank',
		browserContextId
	});
	const target = await pageTarget(cdpHttpUrl, created.targetId);
	const pageSession = await CdpSession.connect(target.webSocketDebuggerUrl!);
	const temporaryRoot = readGfxEnvironmentValue(process.env, 'GFX_CLI_TEMP_DIR') ?? tmpdir();
	await mkdir(temporaryRoot, { recursive: true });
	const downloadDirectory = await mkdtemp(join(temporaryRoot, 'gfx-cli-download-'));
	const page = new CdpRenderPage({
		browserSession,
		pageSession,
		targetId: created.targetId,
		browserContextId,
		downloadDirectory
	});
	await page.initialize();

	return {
		page: page as unknown as Page,
		disconnect: async () => {
			await browserSession
				.send('Target.disposeBrowserContext', { browserContextId })
				.catch(() => undefined);
			browserSession.close();
			await rm(downloadDirectory, { recursive: true, force: true });
		}
	};
}
