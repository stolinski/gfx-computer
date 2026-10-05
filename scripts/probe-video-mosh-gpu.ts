// Pixel evidence for the Mosh window GPU processor (ADR-0065), measured on the GPU.
//
// The probe runs `VideoMoshProcessor` — the real WGSL passes — in the
// sanctioned CanvasDrawElement Chrome and checks it against the CPU
// specification in `video-mosh-reference.ts`:
//
//   1. Parity       — at a small target size, every step of several windows
//                     (follow, repeat, bleed, seeded corruption, heal) matches
//                     the CPU reference within half-float rounding.
//   2. Determinism  — at native 3840×2160 and 2160×3840 the same window run
//                     twice produces identical bytes every step; per-step GPU
//                     time is recorded.
//   3. Resolve      — a target-sized footage frame with no rotation resolves
//                     into target space unchanged, through the same cover and
//                     rotation statements the final present uses.
//
// One deterministic script on the CDP harness, in its own jail: a
// worktree-local Vite server serves the modules and a fresh Chrome profile
// runs them. Never the MCP browser.
//
//   pnpm probe:video-mosh
//
// Writes docs/browser-probes/video-mosh-gpu.json and exits non-zero on the
// first contract the GPU misses.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	type VerificationServerJail
} from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_VIDEO_MOSH_PROBE_PORT ?? 7341);
const PROBE_CDP_PORT = Number(process.env.GFX_VIDEO_MOSH_PROBE_CDP_PORT ?? 9261);
const PROBE_ORIGIN = `http://localhost:${SERVER_PORT}`;
const SERVER_READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;
const EVALUATION_TIMEOUT_MS = 600_000;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = resolve(
	process.env.GFX_VIDEO_MOSH_PROBE_EVIDENCE ?? `${repoRoot}/docs/browser-probes/video-mosh-gpu.json`
);

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

interface VideoMoshProbeWindow {
	name: string;
	motion: 'follow' | 'repeat';
	blockSize: 8 | 16 | 32;
	bleed: number;
	corruption: number;
	seed: number;
	durationFrames: number;
	healFrames: number;
}

interface VideoMoshProbeResult {
	name: string;
	failures: string[];
	measurements: Record<string, number>;
}

const PARITY_WINDOWS: VideoMoshProbeWindow[] = [
	{
		name: 'follow',
		motion: 'follow',
		blockSize: 16,
		bleed: 0,
		corruption: 0,
		seed: 0,
		durationFrames: 8,
		healFrames: 1
	},
	{
		name: 'follow-bleed-corrupt',
		motion: 'follow',
		blockSize: 8,
		bleed: 0.3,
		corruption: 0.4,
		seed: 9,
		durationFrames: 8,
		healFrames: 3
	},
	{
		name: 'repeat',
		motion: 'repeat',
		blockSize: 32,
		bleed: 0.1,
		corruption: 0.2,
		seed: 41,
		durationFrames: 8,
		healFrames: 2
	}
];

/**
 * Runs in the page. Imports the app's own modules from the jailed Vite server
 * and returns failures plus summary measurements — never the frames.
 */
async function measureVideoMoshInPage(
	windows: VideoMoshProbeWindow[]
): Promise<VideoMoshProbeResult[]> {
	type Image = { width: number; height: number; data: Float32Array };
	type Window = VideoMoshProbeWindow & { id: string; startFrame: number };
	const gpuHostModule = (await import('/src/lib/platform/gpu-host.ts' as string)) as {
		createGpuHost(canvas: HTMLCanvasElement): Promise<{ device: GPUDevice; dispose(): void }>;
	};
	const processorModule = (await import('/src/lib/platform/video-mosh-processor.ts' as string)) as {
		VideoMoshProcessor: new (
			device: GPUDevice,
			width: number,
			height: number
		) => {
			beginFromTarget(window: Window, frame: GPUTexture): void;
			stepFromTarget(frame: GPUTexture): GPUTexture;
			beginFromSource(
				window: Window,
				source: { texture: GPUTexture; displayWidth: number; displayHeight: number; rotation: 0 }
			): void;
			stepFromSource(source: {
				texture: GPUTexture;
				displayWidth: number;
				displayHeight: number;
				rotation: 0;
			}): GPUTexture;
			dispose(): void;
		};
	};
	const referenceModule = (await import('/src/lib/platform/video-mosh-reference.ts' as string)) as {
		beginVideoMoshReference(held: Image): unknown;
		stepVideoMoshReference(
			state: unknown,
			live: Image,
			params: Window
		): { output: Image; state: unknown };
	};

	const canvas = document.createElement('canvas');
	canvas.width = 4;
	canvas.height = 4;
	const host = await gpuHostModule.createGpuHost(canvas);
	const { device } = host;
	const results: VideoMoshProbeResult[] = [];

	/** A textured pattern translated by (shiftX, shiftY), half-float exact. */
	function frame(
		width: number,
		height: number,
		shiftX: number,
		shiftY: number,
		variant: number
	): Image {
		const data = new Float32Array(width * height * 4);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const u = x - shiftX;
				const v = y - shiftY;
				const value =
					((((Math.floor(u / 5) * 37 + Math.floor(v / 7) * 11 + variant * 53) % 97) + 97) % 97) /
					96;
				const offset = (y * width + x) * 4;
				data[offset] = Math.f16round(value);
				data[offset + 1] = Math.f16round((((value * 0.6 + 0.2) % 1) + 1) % 1);
				data[offset + 2] = Math.f16round(1 - value);
				data[offset + 3] = 1;
			}
		}
		return { width, height, data };
	}

	function upload(image: Image): GPUTexture {
		const texture = device.createTexture({
			size: [image.width, image.height, 1],
			format: 'rgba16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
		});
		device.queue.writeTexture(
			{ texture },
			new Float16Array(image.data),
			{ bytesPerRow: image.width * 8, rowsPerImage: image.height },
			[image.width, image.height, 1]
		);
		return texture;
	}

	async function readBack(texture: GPUTexture): Promise<Float32Array> {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
		const buffer = device.createBuffer({
			size: bytesPerRow * height,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
		});
		const encoder = device.createCommandEncoder();
		encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height, 1]);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		const padded = new Float16Array(buffer.getMappedRange().slice(0));
		buffer.unmap();
		buffer.destroy();
		const out = new Float32Array(width * height * 4);
		const rowStride = bytesPerRow / 2;
		for (let y = 0; y < height; y += 1) {
			for (let i = 0; i < width * 4; i += 1) out[y * width * 4 + i] = padded[y * rowStride + i];
		}
		return out;
	}

	// The live footage: one region slides right, another slides down, so
	// blocks see different motion; the held frame is unrelated content.
	function liveSequence(width: number, height: number, count: number): Image[] {
		return Array.from({ length: count + 1 }, (_, index) =>
			frame(width, height, index * 4, index * (index % 2 === 0 ? 4 : 0), 0)
		);
	}

	// 1. Parity at a small target, both orientations.
	for (const [width, height] of [
		[320, 180],
		[180, 320]
	]) {
		for (const probeWindow of windows) {
			const window: Window = { ...probeWindow, id: probeWindow.name, startFrame: 1 };
			const failures: string[] = [];
			const live = liveSequence(width, height, window.durationFrames);
			const held = frame(width, height, 0, 0, 1);
			const processor = new processorModule.VideoMoshProcessor(device, width, height);
			// The held frame is unrelated content, as at a cut; both sides hold it.
			const heldTexture = upload(held);
			processor.beginFromTarget(window, heldTexture);
			let reference = referenceModule.beginVideoMoshReference(held) as Record<string, unknown>;
			let maximumError = 0;
			let worstStep = -1;
			for (let step = 0; step < window.durationFrames; step += 1) {
				const liveTexture = upload(live[step + 1]);
				const gpu = await readBack(processor.stepFromTarget(liveTexture));
				const cpu = referenceModule.stepVideoMoshReference(reference, live[step + 1], window);
				reference = cpu.state as Record<string, unknown>;
				let stepError = 0;
				for (let index = 0; index < gpu.length; index += 1) {
					stepError = Math.max(stepError, Math.abs(gpu[index] - cpu.output.data[index]));
				}
				if (stepError > maximumError) {
					maximumError = stepError;
					worstStep = step;
				}
				liveTexture.destroy();
			}
			heldTexture.destroy();
			processor.dispose();
			// Two half-float roundings a step, compounded over the window.
			if (maximumError > 2 ** -7) {
				failures.push(
					`GPU departs from the CPU reference by ${maximumError} at step ${worstStep}.`
				);
			}
			results.push({
				name: `parity/${width}x${height}/${window.name}`,
				failures,
				measurements: { maximumError, worstStep }
			});
		}
	}

	// 2. Native determinism and cost.
	for (const [label, width, height] of [
		['horizontal', 3840, 2160],
		['vertical', 2160, 3840]
	] as const) {
		const window: Window = {
			...windows[1],
			id: 'native',
			startFrame: 1,
			durationFrames: 6,
			healFrames: 2
		};
		const live = liveSequence(width, height, window.durationFrames).map(upload);
		const held = upload(frame(width, height, 0, 0, 1));
		const runs: Float32Array[][] = [];
		let stepMilliseconds = 0;
		const stepTimes: number[] = [];
		for (let run = 0; run < 2; run += 1) {
			const processor = new processorModule.VideoMoshProcessor(device, width, height);
			processor.beginFromTarget(window, held);
			const outputs: Float32Array[] = [];
			for (let step = 0; step < window.durationFrames; step += 1) {
				const started = performance.now();
				const output = processor.stepFromTarget(live[step + 1]);
				await device.queue.onSubmittedWorkDone();
				stepMilliseconds = Math.max(stepMilliseconds, performance.now() - started);
				stepTimes.push(performance.now() - started);
				outputs.push(await readBack(output));
			}
			processor.dispose();
			runs.push(outputs);
		}
		let differingSteps = 0;
		for (let step = 0; step < runs[0].length; step += 1) {
			const a = new Uint32Array(runs[0][step].buffer);
			const b = new Uint32Array(runs[1][step].buffer);
			if (a.some((value, index) => value !== b[index])) differingSteps += 1;
		}
		for (const texture of [...live, held]) texture.destroy();
		results.push({
			name: `determinism/${label}`,
			failures:
				differingSteps > 0 ? [`${differingSteps} steps differ between identical runs.`] : [],
			measurements: {
				steps: window.durationFrames,
				differingSteps,
				worstStepMilliseconds: stepMilliseconds,
				medianStepMilliseconds: stepTimes.toSorted((a, b) => a - b)[
					Math.floor(stepTimes.length / 2)
				]
			}
		});
	}

	// 3. Resolve: a target-sized 8-bit source with no rotation is unchanged.
	for (const [label, width, height] of [
		['horizontal', 3840, 2160],
		['vertical', 2160, 3840]
	] as const) {
		const bytes = new Uint8Array(width * height * 4);
		for (let index = 0; index < bytes.length; index += 4) {
			const pixel = index / 4;
			bytes[index] = (pixel * 7) % 256;
			bytes[index + 1] = (pixel * 13 + 40) % 256;
			bytes[index + 2] = (pixel * 3 + 90) % 256;
			bytes[index + 3] = 255;
		}
		const source = device.createTexture({
			size: [width, height, 1],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});
		device.queue.writeTexture({ texture: source }, bytes, { bytesPerRow: width * 4 }, [
			width,
			height,
			1
		]);
		const window: Window = {
			...windows[0],
			id: 'resolve',
			startFrame: 1,
			durationFrames: 2,
			healFrames: 1
		};
		const processor = new processorModule.VideoMoshProcessor(device, width, height);
		const frameSource = {
			texture: source,
			displayWidth: width,
			displayHeight: height,
			rotation: 0 as const
		};
		processor.beginFromSource(window, frameSource);
		processor.stepFromSource(frameSource);
		// The last frame of a window heals fully to the live frame: the resolved source.
		const resolved = await readBack(processor.stepFromSource(frameSource));
		let maximumError = 0;
		for (let index = 0; index < resolved.length; index += 1) {
			maximumError = Math.max(maximumError, Math.abs(resolved[index] - bytes[index] / 255));
		}
		processor.dispose();
		source.destroy();
		results.push({
			name: `resolve/${label}`,
			failures:
				maximumError > 2 ** -9
					? [`Resolved footage departs from the source by ${maximumError}.`]
					: [],
			measurements: { maximumError }
		});
	}

	host.dispose();
	return results;
}

async function startProbeDevServer(jail: VerificationServerJail): Promise<() => Promise<void>> {
	assertVerificationOriginAllowed(PROBE_ORIGIN);
	const child = spawn(
		'pnpm',
		['exec', 'vite', 'dev', '--port', String(SERVER_PORT), '--strictPort'],
		{
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...jail.environment }
		}
	);
	const stop = async (): Promise<void> => {
		if (child.exitCode === null) child.kill('SIGTERM');
		await sleep(250);
		if (child.exitCode === null) child.kill('SIGKILL');
	};
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`The probe dev server exited with ${child.exitCode}.`);
		try {
			if ((await fetch(PROBE_ORIGIN)).ok) return stop;
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The probe dev server never answered at ${PROBE_ORIGIN}.`);
}

interface ProbeCdpPage {
	evaluate<T>(expression: string): Promise<T>;
	navigate(url: string): Promise<void>;
	close(): Promise<void>;
}

async function openProbeCdpPage(): Promise<ProbeCdpPage> {
	const response = await fetch(
		`http://localhost:${PROBE_CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${PROBE_CDP_PORT} would not open a target.`);
	const target = (await response.json()) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP socket refused the connection.'));
	});
	let nextId = 1;
	const pending = new Map<number, { settle(value: unknown): void; fail(error: Error): void }>();
	socket.onmessage = (event: MessageEvent) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			error?: { message: string };
			result?: unknown;
		};
		if (message.id === undefined) return;
		const waiting = pending.get(message.id);
		if (!waiting) return;
		pending.delete(message.id);
		if (message.error) waiting.fail(new Error(message.error.message));
		else waiting.settle(message.result ?? {});
	};
	const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
		new Promise<T>((settle, fail) => {
			const id = nextId++;
			pending.set(id, { settle: (value) => settle(value as T), fail });
			socket.send(JSON.stringify({ id, method, params }));
		});
	async function evaluate<T>(expression: string): Promise<T> {
		// A page reload mid-evaluation never settles the promise, so a stalled
		// evaluation fails instead of hanging the run.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const result = await Promise.race([
			send<{
				exceptionDetails?: { text: string; exception?: { description?: string } };
				result: { value: T };
			}>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
			new Promise<never>((_settle, fail) => {
				timer = setTimeout(
					() => fail(new Error(`Evaluation exceeded ${EVALUATION_TIMEOUT_MS}ms.`)),
					EVALUATION_TIMEOUT_MS
				);
			})
		]).finally(() => clearTimeout(timer));
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
			);
		}
		return result.result.value;
	}
	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	return {
		evaluate,
		navigate: async (url: string) => {
			await send('Page.navigate', { url });
			const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
			while (Date.now() < deadline) {
				const state = await evaluate<string>('document.readyState').catch(() => 'loading');
				const href = await evaluate<string>('location.href').catch(() => '');
				if (state === 'complete' && href.startsWith(PROBE_ORIGIN)) return;
				await sleep(POLL_INTERVAL_MS);
			}
			throw new Error(`${url} never finished loading.`);
		},
		close: async () => {
			await send('Page.close').catch(() => undefined);
			socket.close();
		}
	};
}

async function closeProbeBrowser(): Promise<void> {
	const version = (await fetch(`http://localhost:${PROBE_CDP_PORT}/json/version`).then((response) =>
		response.json()
	)) as { webSocketDebuggerUrl?: string };
	if (!version.webSocketDebuggerUrl) return;
	const socket = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP browser endpoint refused the connection.'));
	});
	socket.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await sleep(POLL_INTERVAL_MS);
		try {
			await fetch(`http://localhost:${PROBE_CDP_PORT}/json/version`);
		} catch {
			socket.close();
			return;
		}
	}
	socket.close();
}

async function main(): Promise<void> {
	const jail = await createVerificationServerJail('video-mosh-gpu');
	let stopServer: (() => Promise<void>) | null = null;
	let page: ProbeCdpPage | null = null;
	let browserStarted = false;
	try {
		stopServer = await startProbeDevServer(jail);
		const harness = spawnSync('scripts/launch-cdp-chrome.sh', [], {
			cwd: repoRoot,
			stdio: 'inherit',
			env: {
				...process.env,
				CDP_PORT: String(PROBE_CDP_PORT),
				CDP_BROWSER_MODE: 'canvas',
				CDP_PROFILE_DIR: jail.chromeProfileDirectory
			}
		});
		if (harness.status !== 0) {
			throw new Error(`The sanctioned CDP harness would not start (status ${harness.status}).`);
		}
		browserStarted = true;
		for (let attempt = 0; attempt < 40; attempt += 1) {
			try {
				await fetch(`http://localhost:${PROBE_CDP_PORT}/json/version`);
				break;
			} catch {
				await sleep(POLL_INTERVAL_MS);
			}
		}

		const expression = `(${measureVideoMoshInPage.toString()})(${JSON.stringify(PARITY_WINDOWS)})`;
		let results: VideoMoshProbeResult[] | null = null;
		let lastError: unknown = null;
		// One retry from a fresh tab: the dev server's dependency optimiser can
		// reload the page the first time these modules load.
		for (let attempt = 0; attempt < 2 && results === null; attempt += 1) {
			try {
				await page?.close();
				page = await openProbeCdpPage();
				await page.navigate(`${PROBE_ORIGIN}/`);
				results = await page.evaluate<VideoMoshProbeResult[]>(expression);
			} catch (error) {
				lastError = error;
				console.log(
					`attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
		if (results === null) throw lastError;

		const failures = results.flatMap((result) =>
			result.failures.map((failure) => `${result.name}: ${failure}`)
		);
		mkdirSync(dirname(evidencePath), { recursive: true });
		writeFileSync(
			evidencePath,
			`${JSON.stringify(
				{
					probe: 'video-mosh-gpu',
					status: failures.length === 0 ? 'passed' : 'failed',
					cases: results
				},
				null,
				'\t'
			)}\n`
		);
		for (const result of results) {
			console.log(
				`${result.failures.length === 0 ? 'ok  ' : 'FAIL'} ${result.name}  ${JSON.stringify(result.measurements)}`
			);
		}
		if (failures.length > 0) {
			throw new Error(`Video mosh GPU probe failed:\n${failures.join('\n')}`);
		}
		console.log(`Video mosh GPU probe passed ${results.length} cases → ${evidencePath}`);
	} finally {
		await page?.close().catch(() => undefined);
		if (browserStarted) await closeProbeBrowser().catch(() => undefined);
		await stopServer?.();
		await jail.dispose();
	}
}

await main();
