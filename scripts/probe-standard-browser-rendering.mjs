// Probe Chrome's standard WebMCP runtime and the smallest native-resolution
// GFX fallback without letting the fallback use CanvasDrawElement.
//
// PUBLIC-DEMO-ONLY OPT-IN (Dex qju2qity): the DOM-rasterization fallback this
// probe measures is mothballed — the app hard-gates rendering on
// CanvasDrawElement, so a standard WebMCP browser only ever sees the
// capability-gate notice (its WebMCP tools still register behind it). The probe
// refuses to run unless GFX_PUBLIC_DEMO_LANE=1 is set, and is meaningful only
// against a future public-demo build that re-enables the lane. The recorded
// selection evidence lives in docs/standard-browser-rendering-probe.md.
//
// The dev server must already be running at http://localhost:7263. This script
// uses only the sanctioned CDP launch helper and writes exact JSON + PNG evidence.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { format, resolveConfig } from 'prettier';

if (process.env.GFX_PUBLIC_DEMO_LANE !== '1') {
	console.error(
		'probe-standard-browser-rendering.mjs is public-demo-only (qju2qity): the DOM-rasterization fallback is mothballed and the gated app never renders on the standard WebMCP browser. Set GFX_PUBLIC_DEMO_LANE=1 to run it against a demo build that re-enables the lane.'
	);
	process.exit(1);
}

const CANVAS_PORT = 9223;
const STANDARD_WEBMCP_PORT = 9225;
const PAGE_ORIGIN = 'http://localhost:7263';
const DEFAULT_OUTPUT = '.tmp-standard-browser-probe';
const CASES = [
	{ slug: 'lower-third', outputClass: 'transparent-overlay', opaque: false },
	{ slug: 'outro-watch-next', outputClass: 'full-frame', opaque: true }
];
const outputDirectory = resolve(process.env.STANDARD_BROWSER_PROBE_OUTDIR ?? DEFAULT_OUTPUT);
const evidencePath = resolve(
	process.env.STANDARD_BROWSER_PROBE_EVIDENCE ??
		`${outputDirectory}/standard-browser-rendering.json`
);

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: options.capture ? 'pipe' : 'inherit',
		env: { ...process.env, ...options.env }
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`
		);
	}
	return result.stdout ?? '';
}

function resolveHtml2CanvasBundle() {
	if (process.env.HTML2CANVAS_BUNDLE) return resolve(process.env.HTML2CANVAS_BUNDLE);
	const require = createRequire(import.meta.url);
	return require.resolve('html2canvas');
}

async function openCdpPage(port) {
	const targetResponse = await fetch(
		`http://localhost:${port}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!targetResponse.ok) throw new Error(`CDP ${port} target creation failed`);
	const target = await targetResponse.json();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolveSocket, rejectSocket) => {
		socket.onopen = resolveSocket;
		socket.onerror = rejectSocket;
	});
	let nextId = 1;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolveCommand, rejectCommand } = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) rejectCommand(new Error(message.error.message));
		else resolveCommand(message.result);
	};
	const send = (method, params = {}) =>
		new Promise((resolveCommand, rejectCommand) => {
			const id = nextId++;
			pending.set(id, { resolveCommand, rejectCommand });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		});
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
			);
		}
		return result.result.value;
	};
	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	return {
		send,
		evaluate,
		close: async () => {
			await send('Page.close');
			socket.close();
		}
	};
}

const sleep = (milliseconds) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function navigateToComposition(page, slug, { requireTimeline }) {
	await page.send('Page.navigate', { url: `${PAGE_ORIGIN}/p/${slug}` });
	for (let attempt = 0; attempt < 60; attempt++) {
		const ready = await page.evaluate(`(() => ({
			complete: document.readyState === 'complete',
			canvas: [...document.querySelectorAll('canvas')].some((canvas) => canvas.children.length > 0),
			timeline: Boolean(window.__gfxTimeline)
		}))()`);
		if (ready.complete && ready.canvas && (!requireTimeline || ready.timeline)) {
			let soughtProgress = null;
			if (ready.timeline) {
				await page.evaluate(`window.__gfxTimeline.seekProgress(0.5)`);
				soughtProgress = 0.5;
			}
			await sleep(500);
			return { timelineAvailable: ready.timeline, soughtProgress };
		}
		await sleep(500);
	}
	throw new Error(
		`Composition ${slug} did not expose its canvas${requireTimeline ? ' and timeline' : ''}`
	);
}

async function probeCapabilities(page, port) {
	const versionResponse = await fetch(`http://localhost:${port}/json/version`);
	const version = await versionResponse.json();
	const capabilities = await page.evaluate(`(async () => {
		await document.fonts.ready;
		const policy = document.permissionsPolicy ?? document.featurePolicy;
		const response = await fetch(location.href, { cache: 'no-store' });
		let adapter = null;
		try {
			adapter = await navigator.gpu?.requestAdapter();
		} catch {}
		let audio = { available: false };
		try {
			const context = new OfflineAudioContext(1, 128, 8_000);
			const source = context.createOscillator();
			source.connect(context.destination);
			source.start();
			const rendered = await context.startRendering();
			audio = { available: true, frames: rendered.length, sampleRate: rendered.sampleRate };
		} catch (error) {
			audio = { available: false, error: error.message };
		}
		let webmcp = { exposed: typeof document.modelContext === 'object', registered: false };
		if (webmcp.exposed) {
			try {
				const name = 'gfx_standard_browser_probe_' + Math.random().toString(16).slice(2);
				const registration = new AbortController();
				await document.modelContext.registerTool(
					{
						name,
						description: 'Returns a deterministic capability-probe token.',
						inputSchema: { type: 'object', additionalProperties: false },
						annotations: { readOnlyHint: true, untrustedContentHint: false },
						execute: async () => ({ content: [{ type: 'text', text: 'gfx-probe-ok' }] })
					},
					{ signal: registration.signal }
				);
				const tools = await document.modelContext.getTools();
				webmcp = {
					exposed: true,
					registered: Array.from(tools).some((tool) => tool.name === name),
					prototype: Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext))
				};
				registration.abort();
			} catch (error) {
				webmcp = { exposed: true, registered: false, error: error.message };
			}
		}
		return {
			userAgent: navigator.userAgent,
			userAgentData: navigator.userAgentData ? {
				brands: navigator.userAgentData.brands,
				platform: navigator.userAgentData.platform,
				mobile: navigator.userAgentData.mobile
			} : null,
			secureContext: isSecureContext,
			crossOriginIsolated,
			sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
			webmcp,
			webgpu: { exposed: Boolean(navigator.gpu), adapter: Boolean(adapter) },
			canvasDrawElement: {
				copyElementImageToTexture:
					typeof GPUQueue === 'function' && 'copyElementImageToTexture' in GPUQueue.prototype,
				requestPaint: typeof HTMLCanvasElement.prototype.requestPaint === 'function'
			},
			fonts: {
				status: document.fonts.status,
				inter: document.fonts.check('16px Inter'),
				spaceGrotesk: document.fonts.check('16px "Space Grotesk"')
			},
			audio,
			downloads: {
				anchorDownload: 'download' in HTMLAnchorElement.prototype,
				blobUrl: typeof URL.createObjectURL === 'function',
				fileSystemAccess: typeof showSaveFilePicker === 'function'
			},
			permissionsPolicy: policy ? {
				allowedFeatures: policy.allowedFeatures().sort(),
				webShare: policy.allowsFeature?.('web-share') ?? null,
				fullscreen: policy.allowsFeature?.('fullscreen') ?? null
			} : null,
			responseHeaders: {
				crossOriginOpenerPolicy: response.headers.get('cross-origin-opener-policy'),
				crossOriginEmbedderPolicy: response.headers.get('cross-origin-embedder-policy'),
				permissionsPolicy: response.headers.get('permissions-policy')
			}
		};
	})()`);
	return {
		browser: version.Browser,
		protocolVersion: version['Protocol-Version'],
		...capabilities
	};
}

function assertCapabilityMatrix(canvasCapabilities, standardCapabilities) {
	const failures = [];
	if (
		!canvasCapabilities.canvasDrawElement.copyElementImageToTexture ||
		!canvasCapabilities.canvasDrawElement.requestPaint
	) {
		failures.push('port 9223 is not a CanvasDrawElement-capable session');
	}
	if (
		standardCapabilities.canvasDrawElement.copyElementImageToTexture ||
		standardCapabilities.canvasDrawElement.requestPaint
	) {
		failures.push('port 9225 unexpectedly exposes CanvasDrawElement');
	}
	if (!standardCapabilities.webmcp.exposed || !standardCapabilities.webmcp.registered) {
		failures.push('port 9225 did not expose and register a WebMCP tool');
	}
	if (!standardCapabilities.webgpu.exposed || !standardCapabilities.webgpu.adapter) {
		failures.push('port 9225 did not provide the required WebGPU adapter');
	}
	if (
		standardCapabilities.fonts.status !== 'loaded' ||
		!standardCapabilities.fonts.inter ||
		!standardCapabilities.fonts.spaceGrotesk
	) {
		failures.push('port 9225 did not load the required bundled fonts');
	}
	if (!standardCapabilities.audio.available) {
		failures.push('port 9225 did not complete the offline audio probe');
	}
	if (!standardCapabilities.downloads.anchorDownload || !standardCapabilities.downloads.blobUrl) {
		failures.push('port 9225 did not expose the required download primitives');
	}
	if (failures.length > 0) {
		throw new Error(`Browser capability matrix mismatch:\n- ${failures.join('\n- ')}`);
	}
}

function writeScreenshot(path, screenshot) {
	writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
}

function readPngMetrics(path) {
	const bytes = readFileSync(path);
	const png = PNG.sync.read(bytes);
	const firstColor = [png.data[0], png.data[1], png.data[2]];
	let nonUniformPixels = 0;
	let minLuma = 255;
	let maxLuma = 0;
	const colors = new Set();
	for (let index = 0; index < png.data.length; index += 4) {
		const red = png.data[index];
		const green = png.data[index + 1];
		const blue = png.data[index + 2];
		if (red !== firstColor[0] || green !== firstColor[1] || blue !== firstColor[2]) {
			nonUniformPixels++;
		}
		if (colors.size <= 10_000) colors.add((red << 16) | (green << 8) | blue);
		const luma = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
		minLuma = Math.min(minLuma, luma);
		maxLuma = Math.max(maxLuma, luma);
	}
	return {
		sha256: createHash('sha256').update(bytes).digest('hex'),
		width: png.width,
		height: png.height,
		blankUniformFrame: nonUniformPixels === 0,
		nonUniformPixels,
		nonUniformPixelRatio: nonUniformPixels / (png.width * png.height),
		uniqueRgbColors: colors.size > 10_000 ? 'more-than-10000' : colors.size,
		lumaRange: { min: minLuma, max: maxLuma }
	};
}

function comparePngs(referencePath, candidatePath) {
	const reference = PNG.sync.read(readFileSync(referencePath));
	const candidate = PNG.sync.read(readFileSync(candidatePath));
	if (reference.width !== candidate.width || reference.height !== candidate.height) {
		throw new Error('Fidelity inputs have different dimensions');
	}
	let absoluteError = 0;
	let squaredError = 0;
	let exactPixels = 0;
	let withinEightPixels = 0;
	let overTwentyFourPixels = 0;
	const pixelCount = reference.width * reference.height;
	for (let index = 0; index < reference.data.length; index += 4) {
		let exact = true;
		let withinEight = true;
		let overTwentyFour = false;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(reference.data[index + channel] - candidate.data[index + channel]);
			absoluteError += delta;
			squaredError += delta * delta;
			if (delta !== 0) exact = false;
			if (delta > 8) withinEight = false;
			if (delta > 24) overTwentyFour = true;
		}
		if (exact) exactPixels++;
		if (withinEight) withinEightPixels++;
		if (overTwentyFour) overTwentyFourPixels++;
	}
	return {
		meanAbsoluteChannelError: absoluteError / (pixelCount * 3),
		rootMeanSquareChannelError: Math.sqrt(squaredError / (pixelCount * 3)),
		exactPixelRatio: exactPixels / pixelCount,
		withinEightPixelRatio: withinEightPixels / pixelCount,
		overTwentyFourPixelRatio: overTwentyFourPixels / pixelCount
	};
}

async function captureStandardCanvas(page, outputPath) {
	const rect = await page.evaluate(`(() => {
		const canvas = [...document.querySelectorAll('canvas')]
			.sort((left, right) => right.width * right.height - left.width * left.height)[0];
		if (!canvas) throw new Error('composition canvas missing');
		document.documentElement.style.background = '#7f7f7f';
		document.body.style.background = '#7f7f7f';
		document.body.appendChild(canvas);
		for (const child of document.body.children) {
			if (child !== canvas) child.style.visibility = 'hidden';
		}
		canvas.style.position = 'fixed';
		canvas.style.inset = '0 auto auto 0';
		canvas.style.inlineSize = (canvas.width / 4) + 'px';
		canvas.style.blockSize = (canvas.height / 4) + 'px';
		return { width: canvas.width, height: canvas.height };
	})()`);
	const screenshot = await page.send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		clip: { x: 0, y: 0, width: rect.width / 4, height: rect.height / 4, scale: 4 }
	});
	writeScreenshot(outputPath, screenshot);
	return readPngMetrics(outputPath);
}

async function captureDomReference(page, testCase, outputPath) {
	const dimensions = await page.evaluate(`(() => {
		const host = [...document.querySelectorAll('canvas')]
			.sort((left, right) => right.width * right.height - left.width * left.height)[0];
		const source = host?.children[0];
		if (!host || !source) throw new Error('layoutsubtree source missing');
		const clone = source.cloneNode(true);
		const sourceStyle = getComputedStyle(source);
		for (const property of sourceStyle) {
			if (property.startsWith('--')) {
				clone.style.setProperty(property, sourceStyle.getPropertyValue(property));
			}
		}
		clone.style.cssText += ';position:fixed;left:0;top:0;width:' + host.width +
			'px;height:' + host.height +
			'px;transform:scale(0.25);transform-origin:top left;z-index:1';
		const field = sourceStyle.getPropertyValue('--field').trim() || '#111111';
		const background = ${testCase.opaque} ? field : '#7f7f7f';
		document.documentElement.style.background = background;
		document.body.style.margin = '0';
		document.body.style.background = background;
		document.body.replaceChildren(clone);
		return { width: host.width, height: host.height, opaque: ${testCase.opaque} };
	})()`);
	const screenshot = await page.send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		clip: { x: 0, y: 0, width: dimensions.width / 4, height: dimensions.height / 4, scale: 4 }
	});
	writeScreenshot(outputPath, screenshot);
	return readPngMetrics(outputPath);
}

async function captureFallback(page, html2CanvasSource, testCase, outputPath) {
	await page.evaluate(html2CanvasSource);
	const metrics = await page.evaluate(`(async () => {
		await document.fonts.ready;
		const host = [...document.querySelectorAll('canvas')]
			.sort((left, right) => right.width * right.height - left.width * left.height)[0];
		const source = host?.children[0];
		if (!host || !source) throw new Error('layoutsubtree source missing');
		const clone = source.cloneNode(true);
		const sourceStyle = getComputedStyle(source);
		for (const property of sourceStyle) {
			if (property.startsWith('--')) {
				clone.style.setProperty(property, sourceStyle.getPropertyValue(property));
			}
		}
		clone.style.cssText += ';position:fixed;left:0;top:0;width:' + host.width +
			'px;height:' + host.height + 'px;transform:none;z-index:-1';
		document.body.appendChild(clone);
		const startedAt = performance.now();
		const output = await html2canvas(clone, {
			backgroundColor: ${testCase.opaque} ?
				(getComputedStyle(clone).getPropertyValue('--field').trim() || '#111111') : null,
			logging: false,
			scale: 1,
			width: host.width,
			height: host.height,
			windowWidth: host.width,
			windowHeight: host.height,
			useCORS: true
		});
		const rasterMs = performance.now() - startedAt;
		clone.remove();
		const sample = document.createElement('canvas');
		sample.width = 480;
		sample.height = 270;
		const sampleContext = sample.getContext('2d', { alpha: true });
		sampleContext.drawImage(output, 0, 0, sample.width, sample.height);
		const samplePixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
		let alphaPixels = 0;
		let partialAlphaPixels = 0;
		for (let index = 3; index < samplePixels.length; index += 4) {
			if (samplePixels[index] > 0) alphaPixels++;
			if (samplePixels[index] > 0 && samplePixels[index] < 255) partialAlphaPixels++;
		}
		document.documentElement.style.background = '#7f7f7f';
		document.body.replaceChildren(output);
		document.body.style.margin = '0';
		document.body.style.background = '#7f7f7f';
		output.style.inlineSize = (output.width / 4) + 'px';
		output.style.blockSize = (output.height / 4) + 'px';
		return {
			width: output.width,
			height: output.height,
			rasterMs,
			alphaSample: {
				width: sample.width,
				height: sample.height,
				alphaPixels,
				partialAlphaPixels
			}
		};
	})()`);
	const screenshot = await page.send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		clip: { x: 0, y: 0, width: metrics.width / 4, height: metrics.height / 4, scale: 4 }
	});
	writeScreenshot(outputPath, screenshot);
	return { ...metrics, ...readPngMetrics(outputPath) };
}

mkdirSync(outputDirectory, { recursive: true });
run('scripts/launch-cdp-chrome.sh', [], {
	env: { CDP_PORT: String(CANVAS_PORT), CDP_BROWSER_MODE: 'canvas' }
});
run('scripts/launch-cdp-chrome.sh', [], {
	env: { CDP_PORT: String(STANDARD_WEBMCP_PORT), CDP_BROWSER_MODE: 'standard-webmcp' }
});
const html2CanvasSource = readFileSync(resolveHtml2CanvasBundle(), 'utf8');
const capabilityPage = await openCdpPage(STANDARD_WEBMCP_PORT);
await navigateToComposition(capabilityPage, CASES[0].slug, { requireTimeline: false });
const standardCapabilities = await probeCapabilities(capabilityPage, STANDARD_WEBMCP_PORT);
await capabilityPage.close();
const canvasCapabilityPage = await openCdpPage(CANVAS_PORT);
await navigateToComposition(canvasCapabilityPage, CASES[0].slug, { requireTimeline: true });
const canvasCapabilities = await probeCapabilities(canvasCapabilityPage, CANVAS_PORT);
await canvasCapabilityPage.close();
assertCapabilityMatrix(canvasCapabilities, standardCapabilities);

const caseEvidence = [];
for (const testCase of CASES) {
	const canonicalDirectory = resolve(outputDirectory, 'canonical', testCase.slug);
	mkdirSync(canonicalDirectory, { recursive: true });
	const canonicalStartedAt = performance.now();
	run('node', ['scripts/cdp-capture.mjs', testCase.slug], {
		env: {
			CDP_PORT: String(CANVAS_PORT),
			CDP_SAMPLES: '0.5',
			CDP_OUTDIR: canonicalDirectory
		}
	});
	const canonicalWallMs = performance.now() - canonicalStartedAt;
	const canonicalPath = resolve(canonicalDirectory, 'p0.50.png');
	const standardCanvasPath = resolve(outputDirectory, `${testCase.slug}-standard-canvas.png`);
	const standardPage = await openCdpPage(STANDARD_WEBMCP_PORT);
	const standardNavigation = await navigateToComposition(standardPage, testCase.slug, {
		requireTimeline: false
	});
	const standardCanvas = await captureStandardCanvas(standardPage, standardCanvasPath);
	await standardPage.close();
	const domReferencePath = resolve(outputDirectory, `${testCase.slug}-dom-reference.png`);
	const referencePage = await openCdpPage(STANDARD_WEBMCP_PORT);
	const referenceNavigation = await navigateToComposition(referencePage, testCase.slug, {
		requireTimeline: false
	});
	const domReference = await captureDomReference(referencePage, testCase, domReferencePath);
	await referencePage.close();
	const fallbackPath = resolve(outputDirectory, `${testCase.slug}-fallback.png`);
	const fallbackPage = await openCdpPage(STANDARD_WEBMCP_PORT);
	const fallbackNavigation = await navigateToComposition(fallbackPage, testCase.slug, {
		requireTimeline: false
	});
	const fallback = await captureFallback(fallbackPage, html2CanvasSource, testCase, fallbackPath);
	await fallbackPage.close();
	caseEvidence.push({
		slug: testCase.slug,
		outputClass: testCase.outputClass,
		canonical: {
			path: `canonical/${testCase.slug}/p0.50.png`,
			progress: 0.5,
			wallMs: canonicalWallMs,
			...readPngMetrics(canonicalPath)
		},
		standardCanvas: {
			path: `${testCase.slug}-standard-canvas.png`,
			navigation: standardNavigation,
			...standardCanvas
		},
		domReference: {
			path: `${testCase.slug}-dom-reference.png`,
			navigation: referenceNavigation,
			...domReference
		},
		fallback: {
			path: `${testCase.slug}-fallback.png`,
			navigation: fallbackNavigation,
			...fallback
		},
		fidelity: {
			reference: 'native browser rendering of the same unsynchronized DOM clone',
			...comparePngs(domReferencePath, fallbackPath)
		}
	});
}

for (const entry of caseEvidence) {
	const pixelCount = entry.fallback.alphaSample.width * entry.fallback.alphaSample.height;
	if (entry.canonical.blankUniformFrame) {
		throw new Error(`${entry.slug} canonical control is unexpectedly blank`);
	}
	if (!entry.standardCanvas.blankUniformFrame) {
		throw new Error(`${entry.slug} standard canvas did not reproduce the blank frame`);
	}
	if (entry.domReference.blankUniformFrame || entry.fallback.blankUniformFrame) {
		throw new Error(`${entry.slug} DOM reference or fallback is unexpectedly blank`);
	}
	if (
		entry.fallback.width !== 3840 ||
		entry.fallback.height !== 2160 ||
		entry.domReference.width !== 3840 ||
		entry.domReference.height !== 2160
	) {
		throw new Error(`${entry.slug} did not produce native 3840x2160 evidence`);
	}
	if (
		entry.standardCanvas.navigation.timelineAvailable ||
		entry.domReference.navigation.timelineAvailable ||
		entry.fallback.navigation.timelineAvailable
	) {
		throw new Error(`${entry.slug} standard lane unexpectedly initialized the canonical timeline`);
	}
	if (entry.outputClass === 'transparent-overlay') {
		if (
			entry.fallback.alphaSample.alphaPixels <= 0 ||
			entry.fallback.alphaSample.alphaPixels >= pixelCount
		) {
			throw new Error(`${entry.slug} did not preserve transparent-overlay alpha`);
		}
	} else if (entry.fallback.alphaSample.alphaPixels !== pixelCount) {
		throw new Error(`${entry.slug} did not produce an opaque full-frame fallback`);
	}
	if (entry.fidelity.withinEightPixelRatio < 0.9) {
		throw new Error(`${entry.slug} fallback missed the measured DOM fidelity floor`);
	}
}

const evidence = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	probe: 'standard-browser-rendering-and-webmcp',
	fallbackRenderer: { name: 'html2canvas', version: '1.4.1' },
	capabilityMatrixValidated: true,
	capabilities: {
		canvasDrawElementMode: canvasCapabilities,
		standardWebmcpMode: standardCapabilities
	},
	cases: caseEvidence,
	decision: {
		selectedFallback: 'native-resolution DOM clone rasterization with html2canvas',
		previewImplication:
			'use the DOM-rendered clone for the supported flat composition vocabulary when CanvasDrawElement is absent',
		exportImplication:
			'production must initialize and seek an independent deterministic timeline before rasterizing each native frame',
		unsupported:
			'this probe does not initialize the standard-lane timeline; WebGPU effects, depth planes, video underlays, and exact canonical parity remain outside the smallest fallback',
		performanceBasis: 'fallback.rasterMs is measured in-browser for one native frame'
	}
};
mkdirSync(dirname(evidencePath), { recursive: true });
const prettierConfig = (await resolveConfig(evidencePath)) ?? {};
writeFileSync(
	evidencePath,
	await format(JSON.stringify(evidence), { ...prettierConfig, parser: 'json' })
);
console.log(`Wrote ${evidencePath}`);
