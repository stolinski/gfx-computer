// Pixel evidence for the optical-vignette Effect, measured on the GPU.
//
// The probe runs the Effect's real pass — `compileEffect` from the effect
// chain, the registered renderer's WGSL and uniform packing — on synthetic
// rgba16float frames at both native targets (3840×2160 and 2160×3840), reads
// every output texel back before the dithered 8-bit present, and asserts:
//
//   1. Identity    — zero exposure loss returns every RGBA texel bit for bit.
//   2. Alpha       — at nonzero loss every alpha bit is unchanged, transparent
//                    texels stay exactly zero, colour only ever darkens, every
//                    channel loses the same share of linear light (no colour
//                    shift), and each texel matches the CPU model.
//   3. Falloff     — on an opaque white frame the measured exposure matches the
//                    CPU model (`optical-vignette-falloff.ts`), keeps full
//                    exposure at the optical centre, reaches the authored stops
//                    at the farthest corner, and never brightens along any ray
//                    from the centre to a corner.
//   4. Lens shape  — the falloff is round in native pixels: equal along x and
//                    y at the same pixel radius, and equal between the two
//                    orientations.
//
// One deterministic script on the sanctioned CDP harness, in its own jail: a
// worktree-local Vite server on its own port serves the modules and a fresh
// CanvasDrawElement Chrome profile runs them. Never the MCP browser.
//
//   node --experimental-strip-types scripts/probe-optical-vignette-gpu.ts
//
// Writes docs/browser-probes/optical-vignette-gpu.json and exits non-zero on the
// first contract the GPU output misses.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	type VerificationServerJail
} from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_OPTICAL_VIGNETTE_PROBE_PORT ?? 7333);
const PROBE_CDP_PORT = Number(process.env.GFX_OPTICAL_VIGNETTE_PROBE_CDP_PORT ?? 9257);
const PROBE_ORIGIN = `http://localhost:${SERVER_PORT}`;
const SERVER_READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;
const EVALUATION_TIMEOUT_MS = 240_000;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = resolve(
	process.env.GFX_OPTICAL_VIGNETTE_PROBE_EVIDENCE ??
		`${repoRoot}/docs/browser-probes/optical-vignette-gpu.json`
);

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

/** One measured frame: a target size, the Effect params, and what the GPU produced. */
interface OpticalVignetteProbeCaseResult {
	name: string;
	width: number;
	height: number;
	params: Record<string, unknown>;
	failures: string[];
	measurements: Record<string, number>;
}

interface OpticalVignetteProbeCase {
	name: string;
	width: number;
	height: number;
	input: 'pattern' | 'white';
	params: Record<string, unknown>;
}

const TARGETS = [
	{ label: 'horizontal', width: 3840, height: 2160 },
	{ label: 'vertical', width: 2160, height: 3840 }
] as const;

const DEFAULT_PARAMS = {
	exposureLoss: 1,
	onset: 0.3,
	feather: 0.45,
	roundness: 1,
	center: { x: 0.5, y: 0.5 }
};

function buildProbeCases(): OpticalVignetteProbeCase[] {
	return TARGETS.flatMap(({ label, width, height }) => [
		{
			name: `${label}/identity`,
			width,
			height,
			input: 'pattern',
			params: { ...DEFAULT_PARAMS, exposureLoss: 0, onset: 0.6, feather: 0.1, roundness: 0.3 }
		},
		{
			name: `${label}/alpha-default`,
			width,
			height,
			input: 'pattern',
			params: DEFAULT_PARAMS
		},
		{
			name: `${label}/alpha-strong-off-centre`,
			width,
			height,
			input: 'pattern',
			params: { ...DEFAULT_PARAMS, exposureLoss: 3, center: { x: 0.3, y: 0.7 } }
		},
		{
			name: `${label}/falloff-default`,
			width,
			height,
			input: 'white',
			params: DEFAULT_PARAMS
		},
		{
			name: `${label}/falloff-strong`,
			width,
			height,
			input: 'white',
			params: { ...DEFAULT_PARAMS, exposureLoss: 2, onset: 0.6, feather: 0.15 }
		}
	]);
}

/**
 * Runs in the page. Imports the app's own modules from the jailed Vite server,
 * renders each case through the Effect's real pass, and returns failures plus
 * summary measurements — never the frames themselves.
 */
async function measureOpticalVignetteInPage(
	cases: OpticalVignetteProbeCase[]
): Promise<OpticalVignetteProbeCaseResult[]> {
	type Falloff = {
		centerPx: { x: number; y: number };
	};
	const gpuHostModule = (await import('/src/lib/platform/gpu-host.ts' as string)) as {
		createGpuHost(canvas: HTMLCanvasElement): Promise<{
			device: GPUDevice;
			dispose(): void;
		}>;
	};
	const effectChainModule = (await import(
		'/src/lib/platform/pipelines/effect-chain.ts' as string
	)) as {
		compileEffect(
			host: unknown,
			renderer: unknown
		): {
			apply(options: Record<string, unknown>): void;
		};
	};
	const rendererModule = (await import(
		'/src/lib/pipelines/effects/optical-vignette/index.ts' as string
	)) as { opticalVignetteEffectRenderer: unknown };
	const falloffModule = (await import(
		'/src/lib/pipelines/effects/optical-vignette/optical-vignette-falloff.ts' as string
	)) as {
		resolveOpticalVignetteFalloff(
			shape: unknown,
			frame: { width: number; height: number }
		): Falloff;
		sampleOpticalVignetteExposure(falloff: Falloff, x: number, y: number): number;
		applyOpticalVignetteExposure(
			texel: readonly [number, number, number, number],
			exposure: number
		): readonly [number, number, number, number];
	};
	const colorModule = (await import('/src/lib/utils/color.ts' as string)) as {
		srgbChannelToLinear(value: number): number;
		linearChannelToSrgb(value: number): number;
	};

	const halfBuffer = new Float32Array(1);
	const halfBits = new Uint32Array(halfBuffer.buffer);
	function encodeHalf(value: number): number {
		halfBuffer[0] = value;
		const bits = halfBits[0];
		const sign = (bits >>> 16) & 0x8000;
		const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
		const mantissa = bits & 0x7fffff;
		if (exponent <= 0) {
			if (exponent < -10) return sign;
			const shifted = (mantissa | 0x800000) >> (1 - exponent);
			return sign | ((shifted + 0x1000) >> 13);
		}
		if (exponent >= 31) return sign | 0x7c00;
		return sign | (exponent << 10) | ((mantissa + 0x1000) >> 13);
	}
	function decodeHalf(bits: number): number {
		const exponent = (bits >> 10) & 0x1f;
		const mantissa = bits & 0x3ff;
		const sign = bits & 0x8000 ? -1 : 1;
		if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
		if (exponent === 31) return mantissa ? Number.NaN : sign * Infinity;
		return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
	}

	// A deterministic premultiplied pattern: transparent, partial, and opaque
	// tiles carrying three independent colour ramps.
	function writePatternTexel(target: Uint16Array, offset: number, x: number, y: number): void {
		const alpha = [0, 0.25, 0.6, 1][((x >> 5) + (y >> 5)) % 4];
		target[offset] = encodeHalf(alpha * ((x % 97) / 96));
		target[offset + 1] = encodeHalf(alpha * ((y % 89) / 88));
		target[offset + 2] = encodeHalf(alpha * (((x + y) % 83) / 82));
		target[offset + 3] = encodeHalf(alpha);
	}

	const canvas = document.createElement('canvas');
	canvas.width = 4;
	canvas.height = 4;
	const host = await gpuHostModule.createGpuHost(canvas);
	const { device } = host;
	const compiled = effectChainModule.compileEffect(
		host,
		rendererModule.opticalVignetteEffectRenderer
	);
	const results: OpticalVignetteProbeCaseResult[] = [];
	// 1 half-float ULP just below 1.0, the coarsest step an exposure can land on.
	const HALF_STEP_BELOW_ONE = 2 ** -11;

	for (const probeCase of cases) {
		const { width, height } = probeCase;
		const failures: string[] = [];
		const measurements: Record<string, number> = {};

		const input = new Uint16Array(width * height * 4);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const offset = (y * width + x) * 4;
				if (probeCase.input === 'pattern') writePatternTexel(input, offset, x, y);
				else input.fill(0x3c00, offset, offset + 4);
			}
		}

		const inputTexture = device.createTexture({
			size: [width, height, 1],
			format: 'rgba16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});
		device.queue.writeTexture(
			{ texture: inputTexture },
			input,
			{ bytesPerRow: width * 8, rowsPerImage: height },
			[width, height, 1]
		);
		const outputTexture = device.createTexture({
			size: [width, height, 1],
			format: 'rgba16float',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
		});
		const commandEncoder = device.createCommandEncoder();
		compiled.apply({
			commandEncoder,
			inputView: inputTexture.createView(),
			outputView: outputTexture.createView(),
			params: probeCase.params,
			progress: 0.5,
			timestamp: 2,
			canvasWidth: width,
			canvasHeight: height
		});
		device.queue.submit([commandEncoder.finish()]);

		const paddedBytesPerRow = Math.ceil((width * 8) / 256) * 256;
		const readback = device.createBuffer({
			size: paddedBytesPerRow * height,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
		});
		const copyEncoder = device.createCommandEncoder();
		copyEncoder.copyTextureToBuffer(
			{ texture: outputTexture },
			{ buffer: readback, bytesPerRow: paddedBytesPerRow, rowsPerImage: height },
			[width, height, 1]
		);
		device.queue.submit([copyEncoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const padded = new Uint16Array(readback.getMappedRange().slice(0));
		readback.unmap();
		readback.destroy();
		inputTexture.destroy();
		outputTexture.destroy();

		const rowStride = paddedBytesPerRow / 2;
		const texel = (x: number, y: number, channel: number): number =>
			padded[y * rowStride + x * 4 + channel];

		const falloff = falloffModule.resolveOpticalVignetteFalloff(probeCase.params, {
			width,
			height
		});
		const referenceExposureAt = (x: number, y: number): number =>
			falloffModule.sampleOpticalVignetteExposure(falloff, x + 0.5, y + 0.5);

		if (probeCase.input === 'pattern') {
			let maximumReferenceError = 0;
			let differingTexels = 0;
			let alphaChanges = 0;
			let transparentLeaks = 0;
			let brightened = 0;
			let maximumChannelRatioSpread = 0;
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					const offset = (y * width + x) * 4;
					let differs = false;
					for (let channel = 0; channel < 4; channel += 1) {
						if (texel(x, y, channel) !== input[offset + channel]) differs = true;
					}
					if (differs) differingTexels += 1;
					if (texel(x, y, 3) !== input[offset + 3]) alphaChanges += 1;
					if (
						input[offset + 3] === 0 &&
						[0, 1, 2, 3].some((channel) => texel(x, y, channel) !== 0)
					) {
						transparentLeaks += 1;
					}
					const alpha = decodeHalf(input[offset + 3]);
					const before = [0, 1, 2, 3].map((channel) => decodeHalf(input[offset + channel]));
					const expected = falloffModule.applyOpticalVignetteExposure(
						[before[0], before[1], before[2], before[3]],
						referenceExposureAt(x, y)
					);
					const ratios: number[] = [];
					for (let channel = 0; channel < 3; channel += 1) {
						const after = decodeHalf(texel(x, y, channel));
						if (after > before[channel]) brightened += 1;
						maximumReferenceError = Math.max(
							maximumReferenceError,
							Math.abs(after - expected[channel])
						);
						// Exposure is linear light, so colour is preserved when every
						// channel's linear value scales by one factor. Only
						// well-resolved channels can show a shift above half-float
						// rounding.
						const straightBefore = alpha > 0 ? before[channel] / alpha : 0;
						if (straightBefore >= 0.25) {
							ratios.push(
								colorModule.srgbChannelToLinear(after / alpha) /
									colorModule.srgbChannelToLinear(straightBefore)
							);
						}
					}
					if (ratios.length > 1) {
						maximumChannelRatioSpread = Math.max(
							maximumChannelRatioSpread,
							Math.max(...ratios) - Math.min(...ratios)
						);
					}
				}
			}
			measurements.differingTexels = differingTexels;
			measurements.alphaChanges = alphaChanges;
			measurements.transparentLeaks = transparentLeaks;
			measurements.brightenedChannels = brightened;
			measurements.maximumChannelRatioSpread = maximumChannelRatioSpread;
			measurements.maximumReferenceError = maximumReferenceError;
			const exposureLoss = (probeCase.params as { exposureLoss: number }).exposureLoss;
			if (exposureLoss === 0 && differingTexels > 0) {
				failures.push(`${differingTexels} texels changed at zero exposure loss.`);
			}
			if (exposureLoss > 0 && differingTexels === 0) {
				failures.push('No texel changed at nonzero exposure loss.');
			}
			if (alphaChanges > 0) failures.push(`${alphaChanges} alpha values changed.`);
			if (transparentLeaks > 0)
				failures.push(`${transparentLeaks} transparent texels gained colour.`);
			if (brightened > 0) failures.push(`${brightened} colour channels brightened.`);
			// Half-float rounding of a channel ≥ 0.25 moves its linear value by at
			// most ~2⁻⁸ relative, so a larger spread is a real colour shift.
			if (maximumChannelRatioSpread > 2 ** -7) {
				failures.push(
					`RGB channels lost different amounts of linear light (spread ${maximumChannelRatioSpread}).`
				);
			}
			// One half-float step on either side of the comparison.
			if (maximumReferenceError > 2 ** -10) {
				failures.push(`GPU colour departs from the CPU model by ${maximumReferenceError}.`);
			}
		} else {
			// On opaque white the output is the sRGB-encoded exposure itself.
			const encodedAt = (x: number, y: number): number => decodeHalf(texel(x, y, 0));
			const exposureAt = (x: number, y: number): number =>
				colorModule.srgbChannelToLinear(encodedAt(x, y));
			const referenceAt = referenceExposureAt;
			const encodedReferenceAt = (x: number, y: number): number =>
				colorModule.linearChannelToSrgb(referenceAt(x, y));

			let maximumReferenceError = 0;
			let channelMismatches = 0;
			for (let y = 0; y < height; y += 3) {
				for (let x = 0; x < width; x += 3) {
					maximumReferenceError = Math.max(
						maximumReferenceError,
						Math.abs(encodedAt(x, y) - encodedReferenceAt(x, y))
					);
					if (texel(x, y, 1) !== texel(x, y, 0) || texel(x, y, 2) !== texel(x, y, 0)) {
						channelMismatches += 1;
					}
					if (texel(x, y, 3) !== 0x3c00) channelMismatches += 1;
				}
			}
			measurements.maximumReferenceError = maximumReferenceError;
			measurements.channelMismatches = channelMismatches;
			// WebGPU may round or truncate into half floats, so one full step is the
			// write's own error; anything past it is a model mismatch.
			if (maximumReferenceError > HALF_STEP_BELOW_ONE * 1.01) {
				failures.push(`GPU exposure departs from the CPU model by ${maximumReferenceError}.`);
			}
			if (channelMismatches > 0) {
				failures.push(`${channelMismatches} texels lost neutral colour or full alpha.`);
			}

			const centerX = Math.min(width - 1, Math.floor(falloff.centerPx.x));
			const centerY = Math.min(height - 1, Math.floor(falloff.centerPx.y));
			measurements.centerExposure = exposureAt(centerX, centerY);
			if (measurements.centerExposure !== 1) {
				failures.push(`The optical centre lost exposure (${measurements.centerExposure}).`);
			}

			const cornerPixels = [
				[0, 0],
				[width - 1, 0],
				[0, height - 1],
				[width - 1, height - 1]
			];
			const darkestCorner = Math.min(...cornerPixels.map(([x, y]) => exposureAt(x, y)));
			measurements.farthestCornerStops = -Math.log2(darkestCorner);
			const exposureLoss = (probeCase.params as { exposureLoss: number }).exposureLoss;
			if (Math.abs(measurements.farthestCornerStops - exposureLoss) > 0.01) {
				failures.push(
					`The farthest corner lost ${measurements.farthestCornerStops} stops, not ${exposureLoss}.`
				);
			}

			// Every pixel on the line from the centre to each corner, ordered by its
			// own radius, must never brighten by more than half-float rounding.
			let monotonicViolations = 0;
			for (const [cornerX, cornerY] of cornerPixels) {
				const steps = Math.max(Math.abs(cornerX - centerX), Math.abs(cornerY - centerY));
				const samples: { radius: number; exposure: number }[] = [];
				for (let step = 0; step <= steps; step += 1) {
					const x = Math.round(centerX + ((cornerX - centerX) * step) / steps);
					const y = Math.round(centerY + ((cornerY - centerY) * step) / steps);
					samples.push({ radius: 1 - referenceAt(x, y), exposure: encodedAt(x, y) });
				}
				samples.sort((left, right) => left.radius - right.radius);
				for (let index = 1; index < samples.length; index += 1) {
					if (samples[index].exposure > samples[index - 1].exposure + HALF_STEP_BELOW_ONE / 2) {
						monotonicViolations += 1;
					}
				}
			}
			measurements.monotonicViolations = monotonicViolations;
			if (monotonicViolations > 0) {
				failures.push(`${monotonicViolations} ray samples brightened away from the centre.`);
			}

			// A round lens: the same pixel radius along x and along y.
			let maximumAxisDifference = 0;
			const reach = Math.min(centerX, centerY, width - 1 - centerX, height - 1 - centerY);
			for (let radius = 16; radius <= reach; radius += 16) {
				maximumAxisDifference = Math.max(
					maximumAxisDifference,
					Math.abs(encodedAt(centerX + radius, centerY) - encodedAt(centerX, centerY + radius))
				);
			}
			measurements.maximumAxisDifference = maximumAxisDifference;
			if (maximumAxisDifference > HALF_STEP_BELOW_ONE) {
				failures.push(`The lens image is stretched (axis difference ${maximumAxisDifference}).`);
			}
			measurements.exposureAtRadius540 = exposureAt(centerX + 540, centerY);
			measurements.exposureAtRadius1000 = exposureAt(centerX, centerY + 1000);
		}

		results.push({
			name: probeCase.name,
			width,
			height,
			params: probeCase.params,
			failures,
			measurements
		});
	}
	host.dispose();
	return results;
}

// ---- The jailed server and the sanctioned browser -----------------------------

async function startProbeDevServer(jail: VerificationServerJail): Promise<() => Promise<void>> {
	assertVerificationOriginAllowed(PROBE_ORIGIN);
	const child = spawn(
		'pnpm',
		['exec', 'vp', 'dev', '--port', String(SERVER_PORT), '--strictPort'],
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
	const jail = await createVerificationServerJail('optical-vignette-gpu');
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

		const cases = buildProbeCases();
		const expression = `(${measureOpticalVignetteInPage.toString()})(${JSON.stringify(cases)})`;
		let results: OpticalVignetteProbeCaseResult[] | null = null;
		let lastError: unknown = null;
		// One retry from a fresh tab: the dev server's dependency optimiser can
		// reload the page the first time these modules load.
		for (let attempt = 0; attempt < 2 && results === null; attempt += 1) {
			try {
				await page?.close();
				page = await openProbeCdpPage();
				await page.navigate(`${PROBE_ORIGIN}/`);
				results = await page.evaluate<OpticalVignetteProbeCaseResult[]>(expression);
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
					probe: 'optical-vignette-gpu',
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
			throw new Error(`Optical vignette GPU probe failed:\n${failures.join('\n')}`);
		}
		console.log(`Optical vignette GPU probe passed ${results.length} cases → ${evidencePath}`);
	} finally {
		await page?.close().catch(() => undefined);
		if (browserStarted) await closeProbeBrowser().catch(() => undefined);
		await stopServer?.();
		await jail.dispose();
	}
}

await main();
