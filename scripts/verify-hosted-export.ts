// Prove the hosted origin's export lane delivers: the browser encodes the piece
// itself, and what it produces decodes back to the composition it rendered
// (ADR-0052 amendment, `browser-webm-export.ts`).
//
// One invocation, no interactive tooling:
//
//   scripts/launch-cdp-chrome.sh      # not required; the run starts its own
//   pnpm verify:hosted-export
//
// The run starts its own jailed dev server in hosted mode on a port of its own,
// starts the sanctioned CanvasDrawElement Chrome on an isolated profile, opens
// one transparent and one full-frame deliverable, drives the real export seam
// (`window.__gfxExport`), and decodes the file the browser handed over with
// ffmpeg. What it holds the file to is the same decode contract the Node
// origin's lanes are measured against: VP9 at the native target size, the
// planned frame count and cadence, the declared output class read off decoded
// alpha with soft edges retained, and — because the hosted origin answers 404
// for the export transport — no request to it at all.
//
// Evidence lands in docs/runtime-probes/hosted-export.json. A fault fails the
// run, so a regression in the browser lane's alpha fails here rather than in a
// visitor's export.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PNG } from 'pngjs';
import type { Download } from 'playwright';
import { format as formatSource, resolveConfig } from 'prettier';

import { connectCdpRenderBrowser } from './cdp-render-page.ts';
import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	type VerificationServerJail
} from './verification-server-jail.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..');
registerGfxRuntimeModuleHooks(repositoryRoot);

const { BROWSER_EXPORT_DECODE_TOLERANCES, findBrowserExportDecodeFaults, findExportCadenceFaults } =
	await import('../src/lib/platform/public-export-decode-contract.ts');
const { measureRenderedFrameBorderAlpha, measureRenderedFrameDrift, measureRenderedFramePixels } =
	await import('../src/lib/utils/rendered-frame-pixels.ts');
const { getVideoFrameSize } = await import('../src/lib/utils/video-frame.ts');

type DecodeContract = typeof import('../src/lib/platform/public-export-decode-contract.ts');
type PublicExportOutputClass = Parameters<DecodeContract['findBrowserExportDecodeFaults']>[1];
type BrowserExportFrameComparison = Parameters<
	DecodeContract['findBrowserExportDecodeFaults']
>[0][number];
type RenderedFramePixels = Parameters<typeof measureRenderedFramePixels>[0];

const execFileAsync = promisify(execFile);

/** Ports of this run's own, so the gate never addresses the dev server's real store. */
const HOSTED_EXPORT_SERVER_PORT = Number(process.env.GFX_HOSTED_EXPORT_PORT ?? 7293);
const HOSTED_EXPORT_CDP_PORT = Number(process.env.GFX_HOSTED_EXPORT_CDP_PORT ?? 9249);
const hostedOrigin = `http://localhost:${HOSTED_EXPORT_SERVER_PORT}`;

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = FFMPEG.endsWith('ffmpeg')
	? `${FFMPEG.slice(0, -'ffmpeg'.length)}ffprobe`
	: (process.env.FFPROBE_PATH ?? 'ffprobe');

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
/**
 * A 4K deliverable renders and encodes in the browser at roughly fourteen
 * frames a second on an idle machine (a 7-second piece in about 15 seconds);
 * the ceiling leaves room for a machine that is also running the test suite
 * without letting a hung encode run all day.
 */
const EXPORT_TIMEOUT_MS = Number(process.env.GFX_HOSTED_EXPORT_TIMEOUT_MS ?? 30 * 60_000);
const POLL_INTERVAL_MS = 250;

/** How many decoded frames are measured per export; spread evenly across the piece. */
const SAMPLED_FRAME_COUNT = 5;

const evidencePath = resolve(repositoryRoot, 'docs/runtime-probes/hosted-export.json');

/**
 * One deliverable per output class, both declaring WebM. The transparent piece
 * is the overlay the demo opens with; the opaque one is a full-frame chapter
 * card. Both are Pack- and orientation-neutral deliverables, so neither is a
 * fixture the hosted origin refuses to list.
 */
interface HostedExportCase {
	slug: string;
	outputClass: PublicExportOutputClass;
	/** The Pack the Preset declares, so the reference frames are dressed as the export was. */
	packId: string;
}

const HOSTED_EXPORT_CASES: readonly HostedExportCase[] = [
	{ slug: 'lower-third', outputClass: 'transparent', packId: 'syntax' },
	{ slug: 'chapter-card-descent', outputClass: 'opaque', packId: 'syntax' }
];

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

interface HostedDevServer {
	stop(): Promise<void>;
}

/**
 * The app under measurement, in hosted mode: PUBLIC_GFX_HOSTED makes it the
 * hosted profile, the browser-scoped store is what that profile requires, and
 * the release is named because the profile refuses to serve without one. It
 * runs from the jail's directories on a port of its own.
 */
async function startHostedDevServer(jail: VerificationServerJail): Promise<HostedDevServer> {
	assertVerificationOriginAllowed(hostedOrigin);
	const child = spawn(
		'pnpm',
		['exec', 'vite', 'dev', '--port', String(HOSTED_EXPORT_SERVER_PORT), '--strictPort'],
		{
			cwd: repositoryRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				...jail.environment,
				PUBLIC_GFX_HOSTED: '1',
				PUBLIC_GFX_COMPOSITION_STORE: 'browser',
				GFX_RELEASE: 'gfx@verify-hosted-export',
				GFX_RUNTIME_PROFILE: ''
			}
		}
	);
	const stop = async (): Promise<void> => {
		if (child.exitCode === null) child.kill('SIGTERM');
		await sleep(250);
		if (child.exitCode === null) child.kill('SIGKILL');
	};

	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The hosted dev server exited with ${child.exitCode}.`);
		}
		try {
			const response = await fetch(`${hostedOrigin}/api/health`);
			if (response.ok) return { stop };
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The hosted dev server never answered at ${hostedOrigin}.`);
}

/** The sanctioned CanvasDrawElement Chrome, on this run's port and profile. */
function launchHarnessBrowser(jail: VerificationServerJail): void {
	const launch = spawnSync('bash', ['scripts/launch-cdp-chrome.sh'], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			CDP_BROWSER_MODE: 'canvas',
			CDP_PORT: String(HOSTED_EXPORT_CDP_PORT),
			CDP_PROFILE_DIR: jail.chromeProfileDirectory
		}
	});
	if (launch.status !== 0) {
		throw new Error(`scripts/launch-cdp-chrome.sh exited with ${launch.status}.`);
	}
}

/**
 * Shut the run's browser down before the jail is removed: its profile lives in
 * the jail, and Chrome keeps writing there until it has exited.
 */
async function closeHarnessBrowser(): Promise<void> {
	let version: { webSocketDebuggerUrl?: string };
	try {
		version = (await fetch(`http://localhost:${HOSTED_EXPORT_CDP_PORT}/json/version`).then(
			(response) => response.json()
		)) as { webSocketDebuggerUrl?: string };
	} catch {
		return;
	}
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
			await fetch(`http://localhost:${HOSTED_EXPORT_CDP_PORT}/json/version`);
		} catch {
			socket.close();
			return;
		}
	}
	socket.close();
}

/**
 * What the hosted profile must refuse and report, checked from outside the
 * browser: the export transport and a development-only store answer 404, and
 * health says the encoder and the disk are not served rather than missing.
 */
interface HostedRefusalObservation {
	exportSessionsStatus: number;
	userCompositionsStatus: number;
	health: { status: number; body: unknown };
	faults: string[];
}

async function observeHostedRefusals(): Promise<HostedRefusalObservation> {
	const [exportSessions, userCompositions, health] = await Promise.all([
		fetch(`${hostedOrigin}/api/export/sessions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ format: 'webm', fps: 30, frameCount: 1, opaque: false, audioBytes: 0 })
		}),
		fetch(`${hostedOrigin}/api/user-compositions`),
		fetch(`${hostedOrigin}/api/health`)
	]);
	const healthBody: unknown = await health.json();
	const faults: string[] = [];
	if (exportSessions.status !== 404) {
		faults.push(`the export transport answered ${exportSessions.status}; the hosted origin has no encoder and must answer 404`);
	}
	if (userCompositions.status !== 404) {
		faults.push(`the composition store answered ${userCompositions.status}; a development-only surface must answer 404`);
	}
	const checks =
		typeof healthBody === 'object' && healthBody !== null && 'checks' in healthBody
			? (healthBody as { checks?: { ffmpeg?: unknown; temporaryDisk?: unknown } }).checks
			: undefined;
	if (
		health.status !== 200 ||
		checks?.ffmpeg !== 'not-served' ||
		checks?.temporaryDisk !== 'not-served'
	) {
		faults.push(`health answered ${health.status} ${JSON.stringify(healthBody)}; a hosted origin is ready with both checks not-served`);
	}
	return {
		exportSessionsStatus: exportSessions.status,
		userCompositionsStatus: userCompositions.status,
		health: { status: health.status, body: healthBody },
		faults
	};
}

/** What the Workspace's export seam resolved with, as far as this gate reads it. */
interface DeliveredExportOutcome {
	status: string;
	message?: string;
	videoByteLength?: number;
	plan?: {
		format: string;
		codec: string;
		output: string;
		fps: number;
		frameCount: number;
		size: { width: number; height: number };
	};
	/** Requests the page made to the origin's export transport: must be none. */
	exportTransportRequests: number;
}

interface ProbedStreams {
	videoCodec: string | null;
	pixelFormat: string | null;
	audioCodec: string | null;
	width: number | null;
	height: number | null;
	containerDurationSeconds: number | null;
}

async function probeStreams(path: string): Promise<ProbedStreams> {
	const { stdout } = await execFileAsync(FFPROBE, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-show_streams',
		'-show_format',
		'-of',
		'json',
		path
	]);
	const parsed: unknown = JSON.parse(stdout);
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error(`ffprobe produced no stream document for ${path}.`);
	}
	const document = parsed as {
		streams?: {
			codec_type?: string;
			codec_name?: string;
			pix_fmt?: string;
			width?: number;
			height?: number;
		}[];
		format?: { duration?: string };
	};
	const video = document.streams?.find((stream) => stream.codec_type === 'video');
	const audio = document.streams?.find((stream) => stream.codec_type === 'audio');
	return {
		videoCodec: video?.codec_name ?? null,
		pixelFormat: video?.pix_fmt ?? null,
		audioCodec: audio?.codec_name ?? null,
		width: video?.width ?? null,
		height: video?.height ?? null,
		containerDurationSeconds: document.format?.duration ? Number(document.format.duration) : null
	};
}

async function probePresentationSeconds(path: string): Promise<number[]> {
	const { stdout } = await execFileAsync(FFPROBE, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-select_streams',
		'v:0',
		'-show_entries',
		'frame=pts_time,best_effort_timestamp_time',
		'-of',
		'csv=p=0',
		path
	]);
	return stdout
		.trim()
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => {
			const value = line
				.split(',')
				.map((field) => Number(field))
				.find((field) => Number.isFinite(field));
			if (value === undefined) throw new Error(`ffprobe reported no timestamp in "${line}".`);
			return value;
		});
}

function pngToFramePixels(bytes: Buffer): RenderedFramePixels {
	const png = PNG.sync.read(bytes);
	return {
		width: png.width,
		height: png.height,
		data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength)
	};
}

/** Which frames of a plan are measured: evenly spaced, the first one included. */
function sampledFrameIndices(frameCount: number): number[] {
	const step = Math.max(1, Math.floor(frameCount / SAMPLED_FRAME_COUNT));
	return Array.from({ length: Math.min(SAMPLED_FRAME_COUNT, frameCount) }, (_, sample) =>
		Math.min(frameCount - 1, sample * step)
	);
}

/**
 * Decode the sampled frames to straight RGBA through libvpx, the one decoder
 * that reads VP9's alpha side data; the native decoder would report every
 * transparent export as fully opaque and this gate would prove nothing.
 */
async function decodeSampledFrames(
	path: string,
	frameIndices: readonly number[],
	directory: string
): Promise<RenderedFramePixels[]> {
	await mkdir(directory, { recursive: true });
	await execFileAsync(FFMPEG, [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-c:v',
		'libvpx-vp9',
		'-i',
		path,
		'-vf',
		`select='${frameIndices.map((index) => `eq(n\\,${index})`).join('+')}'`,
		'-fps_mode',
		'passthrough',
		'-pix_fmt',
		'rgba',
		join(directory, 'decoded_%04d.png')
	]);
	const names = (await readdir(directory)).filter((name) => name.endsWith('.png')).sort();
	if (names.length !== frameIndices.length) {
		throw new Error(`ffmpeg decoded ${names.length} sampled frames; ${frameIndices.length} were selected.`);
	}
	return Promise.all(names.map(async (name) => pngToFramePixels(await readFile(join(directory, name)))));
}

/**
 * The frame the browser presents at one address, rendered through the same
 * deterministic seams the render matrix verifies deliverables with, then read
 * off the composition canvas. This is the reference every decoded frame is
 * held to: not a clear border assumed, but the border the piece actually has.
 */
async function captureSourceFrame(
	page: Awaited<ReturnType<typeof connectCdpRenderBrowser>>['page'],
	frameIndex: number,
	frameRate: { num: number; den: number }
): Promise<RenderedFramePixels> {
	const request = {
		address: {
			frameIndex,
			timestampMicroseconds: Math.round((frameIndex * frameRate.den * 1_000_000) / frameRate.num)
		},
		frameRate
	};
	const dataUrl = await page.evaluate(async (renderRequest) => {
		const seams = window as Window & {
			__captureGfxDeterministicRenderRegionManifest?: (value: unknown) => Promise<unknown>;
		};
		if (!seams.__captureGfxDeterministicRenderRegionManifest) {
			throw new Error('Deterministic render seams are unavailable.');
		}
		await seams.__captureGfxDeterministicRenderRegionManifest(renderRequest);
		// The composition canvas is the largest-backing one; the editor renders
		// small canvases too (timeline waveforms).
		const canvas = [...document.querySelectorAll('canvas')].sort(
			(a, b) => b.width * b.height - a.width * a.height
		)[0];
		if (!canvas) throw new Error('Composition canvas is unavailable.');
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('Composition canvas produced no PNG.');
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(reader.error);
			reader.onload = () => resolve(String(reader.result));
			reader.readAsDataURL(blob);
		});
	}, request);
	const prefix = 'data:image/png;base64,';
	if (!dataUrl.startsWith(prefix)) throw new Error('Composition canvas returned no PNG data URL.');
	return pngToFramePixels(Buffer.from(dataUrl.slice(prefix.length), 'base64'));
}

interface SampledFrameEvidence {
	index: number;
	source: { alphaCoverage: number; opaqueCoverage: number; edgeClass: string; borderAlphaMax: number };
	decoded: { alphaCoverage: number; opaqueCoverage: number; edgeClass: string; borderAlphaMax: number };
	drift: { rgbMeanAbsoluteError: number; alphaMeanAbsoluteError: number };
}

interface HostedExportCaseEvidence {
	slug: string;
	outputClass: PublicExportOutputClass;
	outcome: DeliveredExportOutcome;
	/** Wall clock from the export seam being called to its receipt resolving: render and encode together. */
	exportMillis: number;
	fileBytes: number;
	streams: ProbedStreams;
	decodedFrameCount: number;
	sampledFrames: SampledFrameEvidence[];
	faults: string[];
}

async function verifyHostedExportCase(
	page: Awaited<ReturnType<typeof connectCdpRenderBrowser>>['page'],
	exportCase: HostedExportCase,
	scratchDirectory: string
): Promise<HostedExportCaseEvidence> {
	const pageUrl = `${hostedOrigin}/p/${encodeURIComponent(exportCase.slug)}`;
	await page.goto(pageUrl, { timeout: WORKSPACE_READY_TIMEOUT_MS });
	await page.waitForFunction(
		(slug) =>
			typeof (window as Window & { __gfxExport?: unknown }).__gfxExport === 'function' &&
			document.querySelector('.topbar__name')?.getAttribute('data-composition-slug') === slug,
		exportCase.slug,
		{ timeout: WORKSPACE_READY_TIMEOUT_MS }
	);

	const filename = `${exportCase.slug}.webm`;
	const outputPath = join(scratchDirectory, filename);
	// The download listener settles into a value either way the moment it is
	// armed: its timeout can fire while the export receipt is still pending, and
	// a rejection nobody has yet handled would end the process instead of the
	// case.
	const downloadSettled: Promise<{ download: Download } | { error: Error }> = page
		.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS })
		.then(
			(download) => ({ download }),
			(error: unknown) => ({ error: error instanceof Error ? error : new Error(String(error)) })
		);
	const exportStartedAt = Date.now();
	const outcomePromise = page.evaluate(async (exportFilename) => {
		const exportComposition = (
			window as Window & {
				__gfxExport?: (request: { filename: string }) => Promise<unknown>;
			}
		).__gfxExport;
		if (!exportComposition) throw new Error('Workspace export seam is unavailable.');
		const outcome = (await exportComposition({ filename: exportFilename })) as Record<
			string,
			unknown
		>;
		const exportTransportRequests = performance
			.getEntriesByType('resource')
			.filter((entry) => new URL(entry.name).pathname.startsWith('/api/export/')).length;
		return { ...outcome, exportTransportRequests } as DeliveredExportOutcome;
	}, filename);
	// The outcome settles first: a failed export hands nothing over, so waiting
	// on the download afterwards would only run out its timeout. The download
	// listener is already armed, so a file that landed before the receipt
	// resolved is not missed.
	const outcome = await outcomePromise;
	const exportMillis = Date.now() - exportStartedAt;
	const download =
		outcome.status === 'delivered'
			? await downloadSettled
			: { error: new Error(`no file is handed over by an export that ended ${outcome.status}`) };

	const faults: string[] = [];
	if (outcome.status !== 'delivered') {
		faults.push(`export ended ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`);
	}
	if (outcome.exportTransportRequests > 0) {
		faults.push(`the page made ${outcome.exportTransportRequests} request(s) to the origin's export transport; the hosted origin's lane is the browser`);
	}
	if ('error' in download) {
		faults.push(`the browser never handed the file over: ${download.error.message}`);
		return {
			slug: exportCase.slug,
			outputClass: exportCase.outputClass,
			outcome,
			exportMillis,
			fileBytes: 0,
			streams: { videoCodec: null, pixelFormat: null, audioCodec: null, width: null, height: null, containerDurationSeconds: null },
			decodedFrameCount: 0,
			sampledFrames: [],
			faults
		};
	}
	await download.download.saveAs(outputPath);
	const fileBytes = (await stat(outputPath)).size;
	if (outcome.videoByteLength !== fileBytes) {
		faults.push(`the receipt says ${outcome.videoByteLength} bytes; the browser handed over ${fileBytes}`);
	}

	const plan = outcome.plan;
	if (!plan) {
		faults.push('the export outcome carried no plan');
		return {
			slug: exportCase.slug,
			outputClass: exportCase.outputClass,
			outcome,
			exportMillis,
			fileBytes,
			streams: await probeStreams(outputPath),
			decodedFrameCount: 0,
			sampledFrames: [],
			faults
		};
	}
	const expectedCodec = exportCase.outputClass === 'opaque' ? 'vp9-opaque' : 'vp9-alpha';
	if (plan.codec !== expectedCodec || plan.output !== exportCase.outputClass) {
		faults.push(`the plan encodes ${plan.codec} as ${plan.output}; this case is ${expectedCodec} ${exportCase.outputClass}`);
	}

	const streams = await probeStreams(outputPath);
	if (streams.videoCodec !== 'vp9') {
		faults.push(`decoded video codec is ${streams.videoCodec}; the browser lane encodes vp9`);
	}
	const expectedPixelFormats = exportCase.outputClass === 'opaque' ? ['yuv420p', 'yuv444p'] : ['yuv420p', 'yuva420p'];
	if (streams.pixelFormat === null || !expectedPixelFormats.includes(streams.pixelFormat)) {
		faults.push(`decoded chroma layout is ${streams.pixelFormat}; expected ${expectedPixelFormats.join(' or ')}`);
	}
	if (streams.audioCodec !== null && streams.audioCodec !== 'opus') {
		faults.push(`decoded audio codec is ${streams.audioCodec}; the browser lane encodes opus`);
	}
	const size = getVideoFrameSize('horizontal');
	if (streams.width !== plan.size.width || streams.height !== plan.size.height) {
		faults.push(`decoded at ${streams.width}x${streams.height}; the plan is ${plan.size.width}x${plan.size.height}`);
	}
	if (plan.size.width !== size.width || plan.size.height !== size.height) {
		faults.push(`the plan is ${plan.size.width}x${plan.size.height}; the native horizontal target is ${size.width}x${size.height}`);
	}

	const presentationSeconds = await probePresentationSeconds(outputPath);
	faults.push(
		...findExportCadenceFaults(presentationSeconds, {
			frameCount: plan.frameCount,
			fps: plan.fps,
			format: 'webm'
		})
	);

	const frameIndices = sampledFrameIndices(plan.frameCount);
	const decodedFrames = await decodeSampledFrames(
		outputPath,
		frameIndices,
		join(scratchDirectory, `${exportCase.slug}-frames`)
	);

	// The same page renders the reference frames after the export, through the
	// deterministic cell the render matrix uses: the piece it just exported, in
	// its own Pack and orientation.
	await page.evaluate(async (cell) => {
		const seams = window as Window & {
			__configureGfxDeterministicRenderCell?: (value: unknown) => Promise<unknown>;
		};
		if (!seams.__configureGfxDeterministicRenderCell) {
			throw new Error('Deterministic render seams are unavailable.');
		}
		await seams.__configureGfxDeterministicRenderCell(cell);
	}, { presetSlug: exportCase.slug, packId: exportCase.packId, orientation: 'horizontal' });
	const comparisons: BrowserExportFrameComparison[] = [];
	for (const [sample, frameIndex] of frameIndices.entries()) {
		const decoded = decodedFrames[sample];
		const source = await captureSourceFrame(page, frameIndex, plan.frameRate);
		comparisons.push({
			frameIndex,
			source: {
				measurement: measureRenderedFramePixels(source),
				borderAlpha: measureRenderedFrameBorderAlpha(source)
			},
			decoded: {
				measurement: measureRenderedFramePixels(decoded),
				borderAlpha: measureRenderedFrameBorderAlpha(decoded)
			},
			drift: measureRenderedFrameDrift(decoded, source)
		});
	}
	faults.push(...findBrowserExportDecodeFaults(comparisons, exportCase.outputClass));

	return {
		slug: exportCase.slug,
		outputClass: exportCase.outputClass,
		outcome,
		exportMillis,
		fileBytes,
		streams,
		decodedFrameCount: presentationSeconds.length,
		sampledFrames: comparisons.map((comparison) => ({
			index: comparison.frameIndex,
			source: {
				alphaCoverage: comparison.source.measurement.alphaCoverage,
				opaqueCoverage: comparison.source.measurement.opaqueCoverage,
				edgeClass: comparison.source.measurement.edgeClass,
				borderAlphaMax: comparison.source.borderAlpha.maxAlpha
			},
			decoded: {
				alphaCoverage: comparison.decoded.measurement.alphaCoverage,
				opaqueCoverage: comparison.decoded.measurement.opaqueCoverage,
				edgeClass: comparison.decoded.measurement.edgeClass,
				borderAlphaMax: comparison.decoded.borderAlpha.maxAlpha
			},
			drift: comparison.drift
		})),
		faults
	};
}

async function writeEvidence(evidence: unknown): Promise<void> {
	await mkdir(dirname(evidencePath), { recursive: true });
	const prettierOptions = await resolveConfig(evidencePath);
	const source = await formatSource(JSON.stringify(evidence), {
		...prettierOptions,
		filepath: evidencePath
	});
	await writeFile(evidencePath, source);
}

async function main(): Promise<void> {
	const jail = await createVerificationServerJail('hosted-export');
	const scratchDirectory = join(jail.root, 'exports');
	await mkdir(scratchDirectory, { recursive: true });
	let server: HostedDevServer | null = null;
	let browser: Awaited<ReturnType<typeof connectCdpRenderBrowser>> | null = null;
	const startedAt = new Date().toISOString();
	try {
		server = await startHostedDevServer(jail);
		const refusals = await observeHostedRefusals();
		launchHarnessBrowser(jail);
		browser = await connectCdpRenderBrowser(`http://localhost:${HOSTED_EXPORT_CDP_PORT}`);

		const cases: HostedExportCaseEvidence[] = [];
		for (const exportCase of HOSTED_EXPORT_CASES) {
			cases.push(await verifyHostedExportCase(browser.page, exportCase, scratchDirectory));
		}

		const faults = [
			...refusals.faults,
			...cases.flatMap((entry) => entry.faults.map((fault) => `${entry.slug}: ${fault}`))
		];
		await writeEvidence({
			recordedAt: startedAt,
			profile: 'hosted',
			lane: 'browser-webm',
			origin: hostedOrigin,
			tolerances: BROWSER_EXPORT_DECODE_TOLERANCES,
			refusals: {
				exportSessionsStatus: refusals.exportSessionsStatus,
				userCompositionsStatus: refusals.userCompositionsStatus,
				health: refusals.health
			},
			cases,
			faults,
			ok: faults.length === 0
		});

		for (const entry of cases) {
			console.log(
				`${entry.slug} (${entry.outputClass}): ${entry.outcome.status} in ${(entry.exportMillis / 1000).toFixed(1)}s, ${entry.fileBytes} bytes, ${entry.decodedFrameCount} frames, ${entry.faults.length === 0 ? 'ok' : `${entry.faults.length} fault(s)`}`
			);
		}
		if (faults.length > 0) {
			for (const fault of faults) console.error(`  ${fault}`);
			throw new Error(`The hosted export lane failed ${faults.length} check(s); see ${evidencePath}.`);
		}
		console.log(`Hosted export lane verified; evidence in ${evidencePath}.`);
	} finally {
		if (browser) await browser.disconnect().catch(() => undefined);
		await closeHarnessBrowser();
		if (server) await server.stop();
		await rm(scratchDirectory, { recursive: true, force: true });
		await jail.dispose();
	}
}

await main();
