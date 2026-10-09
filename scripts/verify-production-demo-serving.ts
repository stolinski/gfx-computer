// Prove the production artifact serves the whole no-account demo, locally
// (ADR-0052, ADR-0053).
//
// `pnpm verify:production-image` measures the image as a *host*: it builds
// reproducibly, refuses a bad deployment input, exports through the HTTP session
// API from Node, and stops cleanly. Nothing there is a visitor. This gate asks
// the other question — does a browser pointed at that artifact get the demo? —
// and answers it against a real Chrome on the sanctioned CDP harness:
//
//   pnpm verify:production-demo
//
// It builds the image at this commit, serves it with the ratified deployment
// inputs on a loopback origin, and then drives that origin the way the demo is
// used: the GFX identity the app shell carries, a Starter opened out of the
// library and rendering real ink at a seeked frame, the WebMCP surface an
// attached agent discovers (delegated to `pnpm eval:webmcp`, pointed here), both
// export lanes completed by the page itself, the work directories gone
// afterwards, the layout at a narrow viewport, the failure states a visitor can
// reach, and every development-only surface absent. Finally it proves rollback
// the way ADR-0052 defines it: build the previous commit, serve it on the same
// origin, and read that older release identity back out of `/api/health`.
//
// Writes docs/runtime-probes/production-demo-serving.json and fails, naming the
// check, when the artifact this repository builds today cannot serve the demo.
//
// Needs a container runtime, a local Chrome, and enough disk for two images, so
// it is a command a person runs rather than part of `pnpm check`.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { format, resolveConfig } from 'prettier';

import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
registerGfxRuntimeModuleHooks(repoRoot);

const { PUBLIC_EXPORT_RUNTIME_LIMITS } =
	await import('../src/lib/platform/public-runtime-contract.ts');
const { PUBLIC_SURFACE_INVENTORY } =
	await import('../src/lib/platform/public-surface-inventory.ts');
const { GFX_PRODUCT_NAME, GFX_SOCIAL_CARD_PATH } = await import('../src/lib/identity/gfx-brand.ts');

const execFileAsync = promisify(execFile);

const IMAGE_REPOSITORY = 'gfx-production-demo';
const CONTAINER_NAME = 'gfx-production-demo-serving';
const EXPORT_VOLUME_NAME = 'gfx-production-demo-serving-export';
const CONTAINER_EXPORT_DIRECTORY = '/var/lib/gfx/export';
const EVIDENCE_PATH = resolve(
	process.env.GFX_PROBE_EVIDENCE ??
		join(repoRoot, 'docs/runtime-probes/production-demo-serving.json')
);

/** The flagged Chrome the canonical render lane needs (scripts/launch-cdp-chrome.sh). */
const CANVAS_CDP_PORT = 9223;

/**
 * The Starter a visitor opens first here. Any listed Preset would do — this one
 * is chosen because it is the smallest composition that still drives the full
 * path (Surface, Block, Annotation, motion), and the sweep separately asserts
 * the served library actually links it, so a rename fails loudly rather than
 * silently measuring a different piece.
 */
const STARTER_SLUG = 'lower-third';

/** Where in the Starter's timeline the render is measured: past every entrance. */
const STARTER_RENDER_PROGRESS = 0.45;

/** Native targets (ADR-0052). The composition canvas must back one of them. */
const NATIVE_BACKING_SIZES: readonly (readonly [number, number])[] = [
	[3840, 2160],
	[2160, 3840]
];

/** A phone-width viewport — under the 52rem breakpoint the home deck reflows at. */
const NARROW_VIEWPORT = { width: 414, height: 896 } as const;
const WIDE_VIEWPORT = { width: 1440, height: 900 } as const;

/** Reduced-size export frames: this measures the demo path, not the encoder. */
const EXPORT_WIDTH = 640;
const EXPORT_HEIGHT = 360;
const EXPORT_FRAME_COUNT = 4;
const EXPORT_FPS = 30;

const HEALTH_TIMEOUT_MS = 90_000;
const PAGE_READY_TIMEOUT_MS = 60_000;
const STOP_GRACE_SECONDS = 30;

/**
 * A path that really exists behind each development-only prefix naming a
 * subtree, so a 404 means "excluded" rather than "no such route". Kept in step
 * with the same list in `verify-production-image.ts`: both gates probe the
 * inventory, and a new subtree has to name a real route in each.
 */
const DEVELOPMENT_ONLY_SURFACE_PROBES: Readonly<Record<string, string>> = {
	'/poc/': '/poc/dof3d',
	'/api/posters/': '/api/posters/abcdef01',
	'/api/verification/': '/api/verification/source-identity'
};

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
	return new Promise((settle, fail) => {
		const child = spawn(command, [...args], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		child.on('error', fail);
		child.on('close', (code) => settle({ code: code ?? 1, stdout, stderr }));
	});
}

async function docker(...args: string[]): Promise<CommandResult> {
	return runCommand('docker', args);
}

async function dockerOrThrow(...args: string[]): Promise<string> {
	const result = await docker(...args);
	if (result.code !== 0) {
		throw new Error(`docker ${args.join(' ')} failed (${result.code}):\n${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

const failures: string[] = [];

function expect(check: string, condition: boolean, detail: string): boolean {
	if (condition) {
		console.log(`ok   ${check}`);
		return true;
	}
	failures.push(`${check}: ${detail}`);
	console.error(`FAIL ${check}: ${detail}`);
	return false;
}

const sleep = (milliseconds: number) =>
	new Promise<void>((settle) => setTimeout(settle, milliseconds));

// --- the served container ---------------------------------------------------

/** A free loopback port, released before the container claims it. */
async function reserveHostPort(): Promise<number> {
	const server = createServer();
	try {
		await new Promise<void>((listening, failed) => {
			server.once('error', failed);
			server.listen(0, '127.0.0.1', listening);
		});
		const address = server.address();
		if (address === null || typeof address === 'string') {
			throw new Error('Could not reserve a loopback port for the container.');
		}
		return address.port;
	} finally {
		await new Promise<void>((closed) => server.close(() => closed()));
	}
}

async function buildProductionImage(
	tag: string,
	release: string,
	context: string
): Promise<number> {
	const startedAt = Date.now();
	const result = await docker(
		'build',
		'--build-arg',
		`GFX_RELEASE=${release}`,
		'--tag',
		tag,
		context
	);
	if (result.code !== 0) {
		throw new Error(`Production image build failed for ${release}:\n${result.stderr.slice(-4000)}`);
	}
	return Date.now() - startedAt;
}

/**
 * Serve one image on the reserved origin. `ORIGIN` is handed in rather than
 * baked, because a public host resolves its own origin from it alone and refuses
 * a request whose URL disagrees.
 */
async function serveProductionImage(tag: string, origin: string, port: number): Promise<void> {
	await dockerOrThrow(
		'run',
		'--detach',
		'--name',
		CONTAINER_NAME,
		'--publish',
		`127.0.0.1:${port}:3000`,
		'--volume',
		`${EXPORT_VOLUME_NAME}:${CONTAINER_EXPORT_DIRECTORY}`,
		'--env',
		`ORIGIN=${origin}`,
		tag
	);
	await waitForHealthyOrigin(origin);
}

async function stopServedImage(): Promise<void> {
	await docker('stop', '--time', String(STOP_GRACE_SECONDS), CONTAINER_NAME);
	await docker('rm', '--force', CONTAINER_NAME);
}

async function waitForHealthyOrigin(origin: string): Promise<number> {
	const startedAt = Date.now();
	for (;;) {
		try {
			const response = await fetch(`${origin}/api/health`);
			if (response.status === 200) return Date.now() - startedAt;
		} catch {
			// The port is mapped before the process listens.
		}
		if (Date.now() - startedAt > HEALTH_TIMEOUT_MS) {
			throw new Error(
				`The container never reported ready within ${HEALTH_TIMEOUT_MS} ms:\n${await dockerOrThrow('logs', CONTAINER_NAME)}`
			);
		}
		await sleep(500);
	}
}

interface PublicHealthBody {
	status: string;
	release: string | null;
	checks: Record<string, string>;
}

async function readServedRelease(origin: string): Promise<PublicHealthBody> {
	const response = await fetch(`${origin}/api/health`);
	return (await response.json()) as PublicHealthBody;
}

/** The release the app shell itself declares, which is what a browser reads. */
function readAppShellRelease(html: string): string | null {
	return /<meta\s+name="gfx-release"\s+content="([^"]*)"/.exec(html)?.[1] ?? null;
}

async function countContainerWorkDirectories(): Promise<number> {
	const stdout = await dockerOrThrow(
		'exec',
		CONTAINER_NAME,
		'sh',
		'-c',
		`ls -A ${CONTAINER_EXPORT_DIRECTORY} | wc -l`
	);
	return Number(stdout.trim());
}

// --- the browser ------------------------------------------------------------

interface CdpPage {
	send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
	evaluate<T>(expression: string): Promise<T>;
	navigate(url: string): Promise<void>;
	setViewport(size: { width: number; height: number }): Promise<void>;
	/** Console errors and uncaught exceptions seen since the page opened. */
	readonly runtimeFaults: string[];
	close(): Promise<void>;
}

async function openCdpPage(port: number): Promise<CdpPage> {
	const response = await fetch(
		`http://localhost:${port}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${port} would not open a target`);
	const target = (await response.json()) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error(`CDP ${port} socket refused the connection`));
	});

	let nextId = 1;
	const pending = new Map<
		number,
		{ settle: (value: Record<string, unknown>) => void; fail: (error: Error) => void }
	>();
	const runtimeFaults: string[] = [];
	socket.onmessage = (event: MessageEvent) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			method?: string;
			params?: Record<string, unknown>;
			error?: { message: string };
			result?: Record<string, unknown>;
		};
		if (message.id === undefined) {
			collectRuntimeFault(runtimeFaults, message.method, message.params);
			return;
		}
		const waiting = pending.get(message.id);
		if (!waiting) return;
		pending.delete(message.id);
		if (message.error) waiting.fail(new Error(message.error.message));
		else waiting.settle(message.result ?? {});
	};

	const send = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<Record<string, unknown>>((settle, fail) => {
			const id = nextId++;
			pending.set(id, { settle, fail });
			socket.send(JSON.stringify({ id, method, params }));
		});

	async function evaluate<T>(expression: string): Promise<T> {
		const result = (await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		})) as {
			exceptionDetails?: { text: string; exception?: { description?: string } };
			result: { value: T };
		};
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
			);
		}
		return result.result.value;
	}

	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	return {
		send,
		evaluate,
		runtimeFaults,
		navigate: async (url: string) => {
			await send('Page.navigate', { url });
		},
		setViewport: async (size: { width: number; height: number }) => {
			await send('Emulation.setDeviceMetricsOverride', {
				width: size.width,
				height: size.height,
				deviceScaleFactor: 1,
				mobile: false
			});
		},
		close: async () => {
			await send('Page.close');
			socket.close();
		}
	};
}

/**
 * One console error or uncaught exception, flattened to a line. "No unexplained
 * runtime failure" is the demo's acceptance bar, so this collects the two
 * channels a visitor's browser would report it on.
 */
function collectRuntimeFault(
	sink: string[],
	method: string | undefined,
	params: Record<string, unknown> | undefined
): void {
	if (method === 'Runtime.exceptionThrown') {
		const details = (
			params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
		)?.exceptionDetails;
		sink.push(`exception: ${details?.exception?.description ?? details?.text ?? 'unknown'}`);
		return;
	}
	if (method !== 'Runtime.consoleAPICalled') return;
	const call = params as { type?: string; args?: { value?: unknown; description?: string }[] };
	if (call?.type !== 'error') return;
	const text = (call.args ?? [])
		.map((argument) => String(argument.value ?? argument.description ?? ''))
		.join(' ')
		.trim();
	sink.push(`console.error: ${text}`);
}

/** Poll an in-page predicate until it holds, or give up and say what it last saw. */
async function waitInPage<T>(
	page: CdpPage,
	expression: string,
	isSettled: (value: T) => boolean,
	what: string
): Promise<T> {
	const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
	let last: T | undefined;
	while (Date.now() < deadline) {
		try {
			last = await page.evaluate<T>(expression);
			if (isSettled(last)) return last;
		} catch {
			// A navigation can tear the execution context down mid-poll.
		}
		await sleep(250);
	}
	throw new Error(
		`${what} never settled within ${PAGE_READY_TIMEOUT_MS} ms; last saw ${JSON.stringify(last)}`
	);
}

// --- in-page measurements ---------------------------------------------------

/**
 * The composition canvas is the largest-backing one: the editor chrome draws
 * small canvases too (sound-clip waveforms), so first-in-document-order is not
 * it.
 */
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

interface StarterRenderReading {
	backingWidth: number;
	backingHeight: number;
	landedTime: number;
	durationSeconds: number;
	/** Fraction of sampled pixels carrying any alpha at all. */
	inkCoverage: number;
	distinctColors: number;
	/** A cheap content hash, so the same seek can be shown to land the same pixels. */
	signature: string;
}

/**
 * Read the composition canvas back through a small 2D scratch canvas. A WebGPU
 * canvas cannot be read directly, but it can be drawn from — which is enough to
 * answer the only question here: did this seek put real, varied ink on the
 * surface, or is the demo serving a blank rectangle?
 */
function readStarterRenderExpression(progress: number): string {
	return `(async () => {
		const canvas = ${COMPOSITION_CANVAS};
		await window.__gfxTimeline.seekProgress(${progress});
		await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
		const sampleWidth = 96;
		const sampleHeight = Math.max(1, Math.round(sampleWidth * canvas.height / canvas.width));
		const scratch = document.createElement('canvas');
		scratch.width = sampleWidth;
		scratch.height = sampleHeight;
		const context = scratch.getContext('2d', { willReadFrequently: true });
		context.clearRect(0, 0, sampleWidth, sampleHeight);
		context.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
		const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
		const colors = new Set();
		let inked = 0;
		let hash = 2166136261;
		for (let offset = 0; offset < pixels.length; offset += 4) {
			if (pixels[offset + 3] > 0) inked += 1;
			colors.add((pixels[offset] << 24) ^ (pixels[offset + 1] << 16) ^ (pixels[offset + 2] << 8) ^ pixels[offset + 3]);
			for (let channel = 0; channel < 4; channel += 1) {
				hash = Math.imul(hash ^ pixels[offset + channel], 16777619) >>> 0;
			}
		}
		return {
			backingWidth: canvas.width,
			backingHeight: canvas.height,
			landedTime: window.__gfxTimeline.time,
			durationSeconds: window.__gfxTimeline.durationSeconds,
			inkCoverage: inked / (sampleWidth * sampleHeight),
			distinctColors: colors.size,
			signature: hash.toString(16)
		};
	})()`;
}

interface NarrowLayoutReading {
	innerWidth: number;
	documentScrollWidth: number;
	/** Whether the home deck's rail has collapsed out of its two-column split. */
	railIsStacked: boolean | null;
}

const NARROW_LAYOUT_EXPRESSION = `(() => {
	const split = document.querySelector('.home__split');
	return {
		innerWidth: window.innerWidth,
		documentScrollWidth: document.documentElement.scrollWidth,
		railIsStacked: split
			? getComputedStyle(split).gridTemplateColumns.trim().split(/\\s+/).length === 1
			: null
	};
})()`;

interface BrowserExportLaneReading {
	lane: string;
	createStatus: number;
	completeStatus: number;
	downloadStatus: number;
	downloadBytes: number;
	declaredLength: number | null;
	cacheControl: string | null;
	contentType: string | null;
	/** First bytes of the file, so the container is identified rather than assumed. */
	containerSignature: string;
	secondDownloadStatus: number;
}

/**
 * Complete one export lane from inside the page, over the same transport the
 * Workspace uses: the browser's own same-origin fetch, its own session cookie,
 * and the origin's Content Security Policy in force. The bytes stay in the
 * browser — decode fidelity is `pnpm verify:export-decode:public-matrix`'s job —
 * so only the container signature and the download's shape come back.
 */
function browserExportLaneExpression(options: {
	format: 'webm' | 'prores';
	opaque: boolean;
	withAudio: boolean;
}): string {
	return `(async () => {
		const width = ${EXPORT_WIDTH};
		const height = ${EXPORT_HEIGHT};
		const frameCount = ${EXPORT_FRAME_COUNT};
		const fps = ${EXPORT_FPS};

		const paint = document.createElement('canvas');
		paint.width = width;
		paint.height = height;
		const brush = paint.getContext('2d');
		const framePngs = [];
		for (let frame = 0; frame < frameCount; frame += 1) {
			brush.clearRect(0, 0, width, height);
			const gradient = brush.createLinearGradient(0, 0, width, height);
			gradient.addColorStop(0, 'rgba(255, 214, 8, 1)');
			gradient.addColorStop(1, 'rgba(12, 12, 14, 1)');
			brush.fillStyle = gradient;
			brush.fillRect(0, 0, width, height);
			brush.fillStyle = '#e8e8ea';
			brush.fillRect(frame * 40, height / 3, width / 4, height / 3);
			framePngs.push(await new Promise((settle) => paint.toBlob(settle, 'image/png')));
		}

		let audio = null;
		if (${String(options.withAudio)}) {
			const sampleRate = 48000;
			const channels = 2;
			const samples = Math.round(sampleRate * frameCount / fps);
			const dataBytes = samples * channels * 2;
			const buffer = new ArrayBuffer(44 + dataBytes);
			const view = new DataView(buffer);
			const ascii = (offset, text) => {
				for (let index = 0; index < text.length; index += 1) {
					view.setUint8(offset + index, text.charCodeAt(index));
				}
			};
			ascii(0, 'RIFF');
			view.setUint32(4, 36 + dataBytes, true);
			ascii(8, 'WAVEfmt ');
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, channels, true);
			view.setUint32(24, sampleRate, true);
			view.setUint32(28, sampleRate * channels * 2, true);
			view.setUint16(32, channels * 2, true);
			view.setUint16(34, 16, true);
			ascii(36, 'data');
			view.setUint32(40, dataBytes, true);
			for (let sample = 0; sample < samples; sample += 1) {
				const value = Math.round(Math.sin((sample / sampleRate) * 440 * 2 * Math.PI) * 16000);
				view.setInt16(44 + sample * channels * 2, value, true);
				view.setInt16(44 + sample * channels * 2 + 2, value, true);
			}
			audio = new Blob([buffer], { type: 'audio/wav' });
		}

		const created = await fetch('/api/export/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				format: ${JSON.stringify(options.format)},
				fps,
				frameCount,
				opaque: ${String(options.opaque)},
				audioBytes: audio ? audio.size : 0
			})
		});
		if (created.status !== 201) {
			return { lane: 'create', createStatus: created.status, detail: await created.text() };
		}
		const session = await created.json();

		if (audio) {
			const uploaded = await fetch(session.audioUrl, {
				method: 'PUT',
				headers: { 'content-type': 'audio/wav' },
				body: audio
			});
			if (!uploaded.ok) throw new Error('Audio upload answered ' + uploaded.status);
		}
		for (let frame = 0; frame < frameCount; frame += 1) {
			const uploaded = await fetch(session.frameUrlTemplate.replace('{frame}', String(frame)), {
				method: 'PUT',
				headers: { 'content-type': 'image/png' },
				body: framePngs[frame]
			});
			if (!uploaded.ok) throw new Error('Frame ' + frame + ' upload answered ' + uploaded.status);
		}

		const completed = await fetch(session.completeUrl, { method: 'POST' });
		const completeStatus = completed.status;
		if (!completed.ok) {
			return { createStatus: created.status, completeStatus, detail: await completed.text() };
		}
		const { downloadUrl } = await completed.json();

		const download = await fetch(downloadUrl);
		const bytes = new Uint8Array(await download.arrayBuffer());
		const second = await fetch(downloadUrl);
		await second.arrayBuffer();

		return {
			createStatus: created.status,
			completeStatus,
			downloadStatus: download.status,
			downloadBytes: bytes.byteLength,
			declaredLength: download.headers.get('content-length')
				? Number(download.headers.get('content-length'))
				: null,
			cacheControl: download.headers.get('cache-control'),
			contentType: download.headers.get('content-type'),
			containerSignature: [...bytes.slice(0, 12)]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join(''),
			secondDownloadStatus: second.status
		};
	})()`;
}

/**
 * Whether these first bytes really are the container the lane claims: WebM opens
 * on the EBML magic, and a ProRes `.mov` carries `ftyp` at offset four.
 */
function isExpectedContainer(format: 'webm' | 'prores', signature: string): boolean {
	if (format === 'webm') return signature.startsWith('1a45dfa3');
	return signature.slice(8, 16) === '66747970';
}

// --- preconditions ----------------------------------------------------------

/**
 * Refuse to start rather than report a pass this machine could not have earned:
 * the container runtime builds and serves the artifact, and Chrome is the
 * visitor.
 */
async function assertVerificationToolsAvailable(): Promise<void> {
	const missing: string[] = [];
	const dockerVersion = await runCommand('docker', [
		'version',
		'--format',
		'{{.Server.Version}}'
	]).catch(() => ({ code: 1, stdout: '', stderr: '' }));
	if (dockerVersion.code !== 0) missing.push('docker');
	if (missing.length > 0) {
		throw new Error(
			`Verifying the served demo needs ${missing.join(' and ')} on this machine; it is unavailable.`
		);
	}
	const launched = spawnSync('scripts/launch-cdp-chrome.sh', [], {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: 'inherit',
		env: { ...process.env, CDP_PORT: String(CANVAS_CDP_PORT), CDP_BROWSER_MODE: 'canvas' }
	});
	if (launched.status !== 0) {
		throw new Error(`The sanctioned Chrome would not start on CDP port ${CANVAS_CDP_PORT}.`);
	}
}

// --- the run ----------------------------------------------------------------

await assertVerificationToolsAvailable();

const currentCommit = (
	await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
).stdout.trim();
const priorCommit = (
	await execFileAsync('git', ['rev-parse', 'HEAD~1'], { cwd: repoRoot })
).stdout.trim();
const currentRelease = `gfx@${currentCommit}`;
const priorRelease = `gfx@${priorCommit}`;
const currentTag = `${IMAGE_REPOSITORY}:${currentCommit}`;
const priorTag = `${IMAGE_REPOSITORY}:${priorCommit}`;

const workingDirectory = await mkdtemp(join(tmpdir(), 'gfx-production-demo-serving-'));
const priorCheckout = join(workingDirectory, 'prior-release');

const evidence: Record<string, unknown> = {
	schemaVersion: 1,
	measuredAt: new Date().toISOString(),
	probe: 'production-demo-serving',
	currentRelease,
	priorRelease
};

await docker('rm', '--force', CONTAINER_NAME);
await docker('volume', 'rm', '--force', EXPORT_VOLUME_NAME);

let page: CdpPage | null = null;

try {
	console.log(`Building the production image at ${currentRelease}…`);
	const currentBuildMs = await buildProductionImage(currentTag, currentRelease, repoRoot);

	// The rollback candidate is the previous commit's own tree, not this one
	// relabelled: an image that carries today's build under yesterday's release
	// identity would prove nothing about serving yesterday's artifact.
	console.log(`Building the rollback candidate at ${priorRelease}…`);
	await execFileAsync('git', ['worktree', 'add', '--detach', priorCheckout, priorCommit], {
		cwd: repoRoot
	});
	const priorBuildMs = await buildProductionImage(priorTag, priorRelease, priorCheckout);
	evidence.builds = { currentBuildMs, priorBuildMs };

	await dockerOrThrow('volume', 'create', EXPORT_VOLUME_NAME);
	const publishedPort = await reserveHostPort();
	const origin = `http://127.0.0.1:${publishedPort}`;
	evidence.origin = origin;

	console.log(`Serving ${currentRelease} on ${origin}…`);
	await serveProductionImage(currentTag, origin, publishedPort);

	// --- what the origin says it is ----------------------------------------
	const health = await readServedRelease(origin);
	const appShellResponse = await fetch(`${origin}/`);
	const appShellHtml = await appShellResponse.text();
	const appShellRelease = readAppShellRelease(appShellHtml);
	evidence.servedIdentity = {
		health,
		appShellStatus: appShellResponse.status,
		appShellRelease,
		title: /<title>([^<]*)<\/title>/.exec(appShellHtml)?.[1] ?? null
	};
	expect(
		'health-reports-the-release-that-was-built',
		health.status === 'ready' &&
			health.release === currentRelease &&
			health.checks.ffmpeg === 'ok' &&
			health.checks.temporaryDisk === 'ok',
		JSON.stringify(health)
	);
	expect(
		'app-shell-declares-the-served-release',
		appShellResponse.status === 200 && appShellRelease === currentRelease,
		`app shell answered ${appShellResponse.status} declaring ${appShellRelease}`
	);

	// --- the GFX identity the artifact carries -----------------------------
	// The share card is the one identity asset that has to travel over the wire;
	// the mark and logotype are drawn geometry small enough for the bundler to
	// inline, so whether they arrived is a question for the rendered masthead
	// below rather than for a URL.
	const shareCard = await fetch(`${origin}${GFX_SOCIAL_CARD_PATH}`);
	const shareCardBytes = (await shareCard.arrayBuffer()).byteLength;
	const identityEvidence: Record<string, unknown> = {
		shareCard: { path: GFX_SOCIAL_CARD_PATH, status: shareCard.status, bytes: shareCardBytes }
	};
	evidence.identity = identityEvidence;
	expect(
		'app-shell-names-the-product-and-its-mark',
		appShellHtml.includes(`<title>${GFX_PRODUCT_NAME}</title>`) &&
			appShellHtml.includes('GFX%20mark') &&
			appShellHtml.includes(`content="${GFX_PRODUCT_NAME}"`),
		'the served app shell does not carry the GFX title, favicon mark, and share name'
	);
	expect(
		'the-share-card-is-served',
		shareCard.status === 200 && shareCardBytes > 0,
		`${GFX_SOCIAL_CARD_PATH} answered ${shareCard.status} with ${shareCardBytes} bytes`
	);

	// --- no private surface answers ----------------------------------------
	const developmentOnlyRows = PUBLIC_SURFACE_INVENTORY.filter(
		(row: { exposure: string }) => row.exposure === 'development-only'
	);
	const unprobedSubtrees = developmentOnlyRows
		.map((row: { pathPrefix: string }) => row.pathPrefix)
		.filter(
			(prefix: string) =>
				prefix.endsWith('/') && DEVELOPMENT_ONLY_SURFACE_PROBES[prefix] === undefined
		);
	const privateSurfaces = await Promise.all(
		developmentOnlyRows.map(async (row: { pathPrefix: string }) => {
			const path = DEVELOPMENT_ONLY_SURFACE_PROBES[row.pathPrefix] ?? row.pathPrefix;
			const response = await fetch(`${origin}${path}`);
			return { path, status: response.status };
		})
	);
	evidence.privateSurfaces = { probed: privateSurfaces, unprobedSubtrees };
	expect(
		'no-private-surface-answers-on-the-served-origin',
		unprobedSubtrees.length === 0 && privateSurfaces.every((surface) => surface.status === 404),
		unprobedSubtrees.length > 0
			? `no probe path declared for ${unprobedSubtrees.join(', ')}`
			: JSON.stringify(privateSurfaces)
	);

	// --- the browser opens the demo ----------------------------------------
	console.log('Opening the demo in the flagged Chrome…');
	page = await openCdpPage(CANVAS_CDP_PORT);
	await page.setViewport(WIDE_VIEWPORT);
	await page.navigate(`${origin}/`);

	const library = await waitInPage<{ ready: boolean; starterHref: string | null; cards: number }>(
		page,
		`(() => ({
			ready: document.readyState === 'complete' && !!document.querySelector('.home__grid'),
			starterHref: document.querySelector('a[href*="/p/${STARTER_SLUG}"]')?.getAttribute('href') ?? null,
			cards: document.querySelectorAll('.home__grid > li').length
		}))()`,
		(reading) => reading.ready,
		'the served library'
	);
	evidence.library = library;
	expect(
		'the-library-serves-starters-including-the-one-this-sweep-opens',
		library.cards > 0 && library.starterHref !== null,
		`${library.cards} cards served; ${STARTER_SLUG} link is ${library.starterHref}`
	);

	// The masthead lockup, as the browser actually resolved it. `naturalWidth`
	// is the whole test: an inlined data URI and a hashed file both decode to a
	// drawn size, and a missing one decodes to nothing.
	const masthead = await page.evaluate<{ images: number; drawn: number }>(`(async () => {
		const images = [...document.querySelectorAll('.topbar__brand img')];
		await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
		return {
			images: images.length,
			drawn: images.filter((image) => image.complete && image.naturalWidth > 0).length
		};
	})()`);
	identityEvidence.masthead = masthead;
	expect(
		'the-served-masthead-draws-the-mark-and-the-logotype',
		masthead.images === 2 && masthead.drawn === 2,
		`${masthead.drawn} of ${masthead.images} masthead images decoded`
	);

	console.log(`Opening the ${STARTER_SLUG} Starter…`);
	await page.navigate(`${origin}/p/${STARTER_SLUG}`);
	await waitInPage<boolean>(
		page,
		`(() => {
			const canvas = ${COMPOSITION_CANVAS};
			return document.readyState === 'complete' && !!canvas && canvas.width > 0 && !!window.__gfxTimeline;
		})()`,
		(ready) => ready,
		'the Workspace canvas and timeline'
	);
	const rendered = await page.evaluate<StarterRenderReading>(
		readStarterRenderExpression(STARTER_RENDER_PROGRESS)
	);
	const rerendered = await page.evaluate<StarterRenderReading>(
		readStarterRenderExpression(STARTER_RENDER_PROGRESS)
	);
	evidence.starterRender = { slug: STARTER_SLUG, first: rendered, second: rerendered };
	expect(
		'the-starter-renders-at-a-native-target',
		NATIVE_BACKING_SIZES.some(
			([width, height]) => rendered.backingWidth === width && rendered.backingHeight === height
		),
		`the composition canvas backs ${rendered.backingWidth}x${rendered.backingHeight}`
	);
	expect(
		'the-seeked-frame-carries-real-ink',
		rendered.inkCoverage > 0.01 && rendered.distinctColors > 4,
		`${(rendered.inkCoverage * 100).toFixed(2)}% covered in ${rendered.distinctColors} colours`
	);
	expect(
		'the-same-seek-renders-the-same-pixels',
		rendered.signature === rerendered.signature &&
			Math.abs(rendered.landedTime - rerendered.landedTime) < 1e-6,
		`${rendered.signature} then ${rerendered.signature}`
	);

	// --- the layout at a phone width ---------------------------------------
	await page.setViewport(NARROW_VIEWPORT);
	await sleep(500);
	const narrowWorkspace = await page.evaluate<NarrowLayoutReading>(NARROW_LAYOUT_EXPRESSION);
	await page.navigate(`${origin}/`);
	await waitInPage<boolean>(
		page,
		`document.readyState === 'complete' && !!document.querySelector('.home__split')`,
		(ready) => ready,
		'the library at a narrow viewport'
	);
	const narrowLibrary = await page.evaluate<NarrowLayoutReading>(NARROW_LAYOUT_EXPRESSION);
	evidence.narrowLayout = {
		viewport: NARROW_VIEWPORT,
		library: narrowLibrary,
		workspace: narrowWorkspace
	};
	expect(
		'the-narrow-library-reflows-instead-of-overflowing',
		narrowLibrary.railIsStacked === true &&
			narrowLibrary.documentScrollWidth <= narrowLibrary.innerWidth + 1,
		`rail stacked ${narrowLibrary.railIsStacked}; document is ${narrowLibrary.documentScrollWidth} wide in ${narrowLibrary.innerWidth}`
	);
	expect(
		'the-narrow-workspace-does-not-overflow',
		narrowWorkspace.documentScrollWidth <= narrowWorkspace.innerWidth + 1,
		`document is ${narrowWorkspace.documentScrollWidth} wide in ${narrowWorkspace.innerWidth}`
	);
	await page.setViewport(WIDE_VIEWPORT);

	// --- the failure states a visitor can reach ----------------------------
	await page.navigate(`${origin}/p/a-composition-that-was-never-published`);
	// Read the answer the visitor sees, not `document.body.textContent` — the app
	// shell's inline bootstrap script is text too, and it comes first.
	const missingComposition = await waitInPage<{
		heading: string | null;
		explanation: string | null;
		wayBack: string | null;
	}>(
		page,
		`(() => {
			const answer = document.querySelector('main.missing');
			return {
				heading: answer?.querySelector('h1')?.textContent?.trim() ?? null,
				explanation: answer?.querySelector('p')?.textContent?.trim() ?? null,
				wayBack: answer?.querySelector('a')?.getAttribute('href') ?? null
			};
		})()`,
		(reading) => reading.heading !== null,
		'the missing-composition answer'
	);
	const overEnvelope = await fetch(`${origin}/api/export/sessions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({
			format: 'webm',
			fps: EXPORT_FPS,
			frameCount: PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount + 1,
			opaque: false,
			audioBytes: 0
		})
	});
	const overEnvelopeBody = await overEnvelope.text();
	const workDirectoriesAfterRefusal = await countContainerWorkDirectories();
	evidence.failureStates = {
		missingComposition,
		overEnvelope: { status: overEnvelope.status, body: overEnvelopeBody.slice(0, 400) },
		workDirectoriesAfterRefusal
	};
	expect(
		'a-composition-that-does-not-exist-is-answered-not-blanked',
		missingComposition.heading === 'Preset not found' &&
			missingComposition.explanation?.includes('a-composition-that-was-never-published') === true &&
			missingComposition.wayBack !== null,
		JSON.stringify(missingComposition)
	);
	expect(
		'an-export-past-the-public-envelope-is-refused-with-the-bound-it-missed',
		overEnvelope.status >= 400 &&
			overEnvelope.status < 500 &&
			overEnvelopeBody.includes(String(PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount)),
		`answered ${overEnvelope.status}: ${overEnvelopeBody.slice(0, 200)}`
	);
	expect(
		'a-refused-export-allocates-nothing',
		workDirectoriesAfterRefusal === 0,
		`${workDirectoriesAfterRefusal} work directories exist after a refusal`
	);

	// --- both export lanes, completed by the browser -----------------------
	console.log('Exporting both lanes from the page…');
	await page.navigate(`${origin}/`);
	await waitInPage<boolean>(
		page,
		`document.readyState === 'complete' && !!document.querySelector('.home__grid')`,
		(ready) => ready,
		'the library before exporting'
	);
	const exportLanes: BrowserExportLaneReading[] = [];
	for (const lane of [
		{ format: 'webm', opaque: false, withAudio: false },
		{ format: 'prores', opaque: false, withAudio: true }
	] satisfies { format: 'webm' | 'prores'; opaque: boolean; withAudio: boolean }[]) {
		const laneName = `${lane.format}-${lane.opaque ? 'opaque' : 'transparent'}-${lane.withAudio ? 'audio' : 'silent'}`;
		const reading = await page.evaluate<Omit<BrowserExportLaneReading, 'lane'>>(
			browserExportLaneExpression(lane)
		);
		exportLanes.push({ lane: laneName, ...reading });
		expect(
			`the-browser-completes-the-${laneName}-lane`,
			reading.createStatus === 201 &&
				reading.completeStatus === 200 &&
				reading.downloadStatus === 200 &&
				reading.downloadBytes > 0 &&
				reading.downloadBytes === reading.declaredLength,
			JSON.stringify(reading)
		);
		expect(
			`the-${laneName}-download-is-the-container-it-claims`,
			isExpectedContainer(lane.format, reading.containerSignature),
			`first bytes were ${reading.containerSignature}`
		);
		expect(
			`the-${laneName}-download-happens-once-and-is-never-cached`,
			reading.cacheControl === 'no-store' && reading.secondDownloadStatus === 404,
			`Cache-Control ${reading.cacheControl}, second download ${reading.secondDownloadStatus}`
		);
	}
	const workDirectoriesAfterExports = await countContainerWorkDirectories();
	evidence.browserExports = { lanes: exportLanes, workDirectoriesAfterExports };
	expect(
		'the-served-origin-retains-nothing-after-both-exports',
		workDirectoriesAfterExports === 0,
		`${workDirectoriesAfterExports} work directories survived the downloads`
	);

	// --- the demo ran without unexplained failure --------------------------
	evidence.runtimeFaults = [...page.runtimeFaults];
	expect(
		'the-demo-runs-without-an-unexplained-runtime-failure',
		page.runtimeFaults.length === 0,
		page.runtimeFaults.join(' | ')
	);
	await page.close();
	page = null;

	// --- the WebMCP surface an attached agent discovers ---------------------
	// Delegated rather than restated: `pnpm eval:webmcp` already owns what a
	// cold page offers, what appears once a composition is open, the revision
	// refusals, and the untrusted-content annotation. Pointing it at this origin
	// is what makes it a statement about the production artifact.
	console.log('Discovering the WebMCP surface on the served origin…');
	const webmcpEvidencePath = join(workingDirectory, 'webmcp-agent-eval.json');
	const webmcpEval = spawnSync(
		'node',
		['--experimental-strip-types', 'scripts/webmcp-agent-browser-eval.ts'],
		{
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: 'inherit',
			env: {
				...process.env,
				GFX_EVAL_ORIGIN: origin,
				WEBMCP_AGENT_EVAL_EVIDENCE: webmcpEvidencePath
			}
		}
	);
	// The delegated evidence is written to a directory this run cleans up, so the
	// part that answers "what did the agent see on the production origin?" is
	// carried into this probe's own evidence rather than pointed at.
	const webmcpEvidence = JSON.parse(
		await readFile(webmcpEvidencePath, 'utf8').catch(() => '{}')
	) as {
		harness?: Record<string, unknown>;
		coldPage?: Record<string, unknown>;
		openComposition?: { registered?: string[] };
		failures?: string[];
	};
	evidence.webmcpAgentEval = {
		exitStatus: webmcpEval.status,
		harness: webmcpEvidence.harness ?? null,
		coldPage: webmcpEvidence.coldPage ?? null,
		registeredWithACompositionOpen: webmcpEvidence.openComposition?.registered?.length ?? null,
		failures: webmcpEvidence.failures ?? null
	};
	expect(
		'an-attached-agent-discovers-the-whole-webmcp-surface-here',
		webmcpEval.status === 0,
		`pnpm eval:webmcp against the served origin exited ${webmcpEval.status}: ${(webmcpEvidence.failures ?? []).join('; ')}`
	);

	// --- the whole authoring scenario, on the served origin -----------------
	// Delegated for the same reason: `pnpm verify:authoring-scenario` owns the
	// create-to-export arc and every refusal that goes with it. Discovery says an
	// agent can see the surface; this says an agent can use it here — and because
	// the scenario cancels one export and has another refused, the work-directory
	// count afterwards is a statement about the paths that produce no file.
	console.log('Running the live authoring scenario against the served origin…');
	const scenarioEvidencePath = join(workingDirectory, 'authoring-scenario.json');
	const scenarioRun = spawnSync(
		'node',
		['--experimental-strip-types', 'scripts/run-gfx-authoring-scenario.ts'],
		{
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: 'inherit',
			env: {
				...process.env,
				GFX_SCENARIO_ORIGIN: origin,
				GFX_SCENARIO_EVIDENCE: scenarioEvidencePath
			}
		}
	);
	const scenarioEvidence = JSON.parse(
		await readFile(scenarioEvidencePath, 'utf8').catch(() => '{}')
	) as {
		coverage?: { operations?: string[]; families?: string[] };
		deliveries?: { lane?: string; download?: { name?: string; bytes?: number } | null }[];
		failures?: { check: string }[];
	};
	const workDirectoriesAfterScenario = await countContainerWorkDirectories();
	evidence.authoringScenario = {
		exitStatus: scenarioRun.status,
		operations: scenarioEvidence.coverage?.operations ?? null,
		families: scenarioEvidence.coverage?.families ?? null,
		delivered: (scenarioEvidence.deliveries ?? []).map((delivery) => ({
			lane: delivery.lane ?? null,
			download: delivery.download ?? null
		})),
		failures: (scenarioEvidence.failures ?? []).map((failure) => failure.check),
		workDirectoriesAfterScenario
	};
	expect(
		'an-agent-authors-and-exports-a-whole-piece-here',
		scenarioRun.status === 0,
		`pnpm verify:authoring-scenario against the served origin exited ${scenarioRun.status}`
	);
	expect(
		'the-served-origin-retains-nothing-after-the-scenario-cancels-and-is-refused',
		workDirectoriesAfterScenario === 0,
		`${workDirectoriesAfterScenario} work directories survived the scenario`
	);

	// --- rollback -----------------------------------------------------------
	console.log(`Rolling back to ${priorRelease}…`);
	await stopServedImage();
	await serveProductionImage(priorTag, origin, publishedPort);
	const rolledBackHealth = await readServedRelease(origin);
	const rolledBackShell = await fetch(`${origin}/`);
	const rolledBackShellHtml = await rolledBackShell.text();

	console.log(`Rolling forward to ${currentRelease}…`);
	await stopServedImage();
	await serveProductionImage(currentTag, origin, publishedPort);
	const rolledForwardHealth = await readServedRelease(origin);

	evidence.rollback = {
		priorRelease,
		rolledBack: {
			health: rolledBackHealth,
			appShellStatus: rolledBackShell.status,
			appShellRelease: readAppShellRelease(rolledBackShellHtml)
		},
		rolledForward: { health: rolledForwardHealth }
	};
	// `/api/health` is what a rollback is confirmed against (ADR-0052), and it is
	// the only identity every release can answer with: the app-shell meta tag
	// reads the deployment input only from the release that taught it to, so an
	// older artifact declares nothing there. It is recorded, not asserted.
	expect(
		'a-rollback-serves-the-prior-release-and-says-so',
		rolledBackHealth.status === 'ready' &&
			rolledBackHealth.release === priorRelease &&
			rolledBackShell.status === 200,
		JSON.stringify({ health: rolledBackHealth, appShell: rolledBackShell.status })
	);
	expect(
		'rolling-forward-again-restores-the-current-release',
		rolledForwardHealth.status === 'ready' && rolledForwardHealth.release === currentRelease,
		JSON.stringify(rolledForwardHealth)
	);
} finally {
	await page?.close().catch(() => undefined);
	await docker('rm', '--force', CONTAINER_NAME);
	await docker('volume', 'rm', '--force', EXPORT_VOLUME_NAME);
	await execFileAsync('git', ['worktree', 'remove', '--force', priorCheckout], {
		cwd: repoRoot
	}).catch(() => undefined);
	await rm(workingDirectory, { recursive: true, force: true });
}

evidence.failures = failures;
evidence.verified = failures.length === 0;

await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
const prettierConfig = await resolveConfig(EVIDENCE_PATH);
await writeFile(
	EVIDENCE_PATH,
	await format(JSON.stringify(evidence), { ...prettierConfig, filepath: EVIDENCE_PATH })
);
console.log(`\nEvidence written to ${EVIDENCE_PATH}`);

if (failures.length > 0) {
	console.error(`\n${failures.length} served-demo check(s) failed:`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exitCode = 1;
} else {
	console.log(
		'\nThe production artifact serves the whole demo, and rolls back to the release before it.'
	);
}
