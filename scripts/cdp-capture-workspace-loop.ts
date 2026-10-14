// Record the GFX Workspace the way gfx.computer's home page shows it: the real
// app playing a real composition, drawn by the real renderer, one frame at a
// time. The home page hero is that loop, so what a visitor sees first is the
// tool making a piece rather than a picture of a tool.
//
// One invocation, no interactive tooling. The run starts its own jailed dev
// server, confirms the sanctioned CanvasDrawElement Chrome through
// scripts/launch-cdp-chrome.sh, drives it over CDP, and encodes for the web
// with ffmpeg:
//
//   pnpm capture:workspace-loop [preset-slug]
//
// Writes docs-site/static/gfx-workspace.mp4 (the loop), gfx-workspace.webp (its
// poster frame) and docs-site/src/lib/workspace-loop.json (what the page states
// about them). Re-run it whenever the Workspace chrome changes, or the home page
// is showing a version of the app that no longer exists.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getVideoFrameSize, type VideoOrientation } from '../src/lib/utils/video-frame.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	type VerificationServerJail
} from './verification-server-jail.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The composition the home page opens. A deliverable, so it is Pack- and orientation-neutral. */
const WORKSPACE_LOOP_PRESET_SLUG = process.argv[2] ?? 'docu-timeline-build';

/**
 * Where the poster frame is taken from. Far enough in that every element has
 * built on, short of the outro — the poster is what a visitor sees before the
 * loop starts and instead of it when they asked for reduced motion, so a
 * half-drawn frame there reads as a broken app rather than a paused one.
 */
const WORKSPACE_LOOP_POSTER_PROGRESS = Number(process.env.GFX_WORKSPACE_LOOP_POSTER ?? 0.62);

/**
 * How long the finished piece holds before the loop restarts. Without it the
 * outro cuts straight back to an empty canvas and the hero reads as a glitch.
 */
const LOOP_TAIL_HOLD_SECONDS = 0.75;

/**
 * What each frame gets after its seek before the shutter opens. The app draws a
 * seeked frame within one animation frame; this is several times that, which
 * keeps a slow composite from landing in the next frame's capture.
 */
const FRAME_SETTLE_MS = 120;

/** Ports of this run's own, so the capture never addresses the dev server's real store. */
const WORKSPACE_LOOP_SERVER_PORT = Number(process.env.GFX_WORKSPACE_LOOP_PORT ?? 7291);
const WORKSPACE_LOOP_CDP_PORT = Number(process.env.GFX_WORKSPACE_LOOP_CDP_PORT ?? 9247);
const workspaceLoopOrigin = `http://localhost:${WORKSPACE_LOOP_SERVER_PORT}`;

/** A laptop-shaped viewport at 2× — the app's own layout, not a contrived one. */
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 } as const;

/** What the home page ships: wide enough for a 2× display, small enough to autoplay. */
const WEB_VIDEO_WIDTH = 1600;
const webVideoPath = resolve(repositoryRoot, 'docs-site/static/gfx-workspace.mp4');
const webPosterPath = resolve(repositoryRoot, 'docs-site/static/gfx-workspace.webp');
const loopManifestPath = resolve(repositoryRoot, 'docs-site/src/lib/workspace-loop.json');

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;

/**
 * The COMPOSITION canvas is the largest-backing one. The editor chrome renders
 * small canvases too (timeline sound-clip waveforms), so document order is not
 * a stable way to find it.
 */
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

interface WorkspaceDevServer {
	stop(): Promise<void>;
}

/**
 * The app under the camera. It runs from the jail's store and scratch
 * directories on a port of its own: a capture must never be able to reach the
 * author's real compositions, and `assertVerificationOriginAllowed` refuses the
 * dev server's port outright.
 */
async function startWorkspaceDevServer(jail: VerificationServerJail): Promise<WorkspaceDevServer> {
	assertVerificationOriginAllowed(workspaceLoopOrigin);
	const child = spawn(
		'pnpm',
		['exec', 'vp', 'dev', '--port', String(WORKSPACE_LOOP_SERVER_PORT), '--strictPort'],
		{
			cwd: repositoryRoot,
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
		if (child.exitCode !== null) {
			throw new Error(`The Workspace dev server exited with ${child.exitCode}.`);
		}
		try {
			const response = await fetch(workspaceLoopOrigin);
			if (response.ok) return { stop };
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The Workspace dev server never answered at ${workspaceLoopOrigin}.`);
}

interface CdpPage {
	send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
	evaluate<T>(expression: string): Promise<T>;
	close(): Promise<void>;
}

async function openCdpPage(): Promise<CdpPage> {
	const response = await fetch(
		`http://localhost:${WORKSPACE_LOOP_CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${WORKSPACE_LOOP_CDP_PORT} would not open a target.`);
	const target = (await response.json()) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP socket refused the connection.'));
	});

	let nextId = 1;
	const pending = new Map<
		number,
		{ settle: (value: unknown) => void; fail: (error: Error) => void }
	>();
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
		const result = await send<{
			exceptionDetails?: { text: string; exception?: { description?: string } };
			result: { value: T };
		}>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
			);
		}
		return result.result.value;
	}

	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });

	return {
		send,
		evaluate,
		close: async () => {
			await send('Page.close').catch(() => undefined);
			socket.close();
		}
	};
}

/**
 * Shut the run's browser down before the jail is removed. Chrome keeps writing
 * to its profile directory, and this profile lives inside the jail — a dispose
 * that races a live browser fails on a directory Chrome just refilled.
 */
async function closeHarnessBrowser(): Promise<void> {
	const version = (await fetch(`http://localhost:${WORKSPACE_LOOP_CDP_PORT}/json/version`).then(
		(response) => response.json()
	)) as { webSocketDebuggerUrl?: string };
	if (!version.webSocketDebuggerUrl) return;
	const socket = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP browser endpoint refused the connection.'));
	});
	socket.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
	// Chrome answers by exiting, so wait for the port to stop answering instead.
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await sleep(POLL_INTERVAL_MS);
		try {
			await fetch(`http://localhost:${WORKSPACE_LOOP_CDP_PORT}/json/version`);
		} catch {
			socket.close();
			return;
		}
	}
	socket.close();
}

/** What the page must be showing before the shutter opens. */
interface WorkspaceReadiness {
	canvas: boolean;
	timeline: boolean;
	complete: boolean;
	pathname: string;
	canvasDrawElement: boolean;
}

/**
 * Wait for the real thing: the composition canvas mounted, the timeline exposed,
 * the route settled, and the open Preset's own name on the page. Photographing a
 * page that has not applied its Preset yet produces a picture of whatever the tab
 * was showing before, which reads as evidence.
 */
async function awaitWorkspace(page: CdpPage, presetName: string): Promise<void> {
	const pageUrl = `${workspaceLoopOrigin}/p/${WORKSPACE_LOOP_PRESET_SLUG}`;
	const expectedPathname = new URL(pageUrl).pathname;
	await page.send('Page.navigate', { url: pageUrl });

	const deadline = Date.now() + WORKSPACE_READY_TIMEOUT_MS;
	let latest: WorkspaceReadiness | null = null;
	while (Date.now() < deadline) {
		try {
			latest = await page.evaluate<WorkspaceReadiness>(`(() => ({
				canvas: !!(${COMPOSITION_CANVAS}),
				timeline: !!window.__gfxTimeline,
				complete: document.readyState === 'complete',
				pathname: location.pathname,
				canvasDrawElement: typeof GPUQueue !== 'undefined' && 'copyElementImageToTexture' in GPUQueue.prototype
			}))()`);
			if (!latest.canvasDrawElement) {
				throw new Error(
					`CanvasDrawElement is unavailable on CDP port ${WORKSPACE_LOOP_CDP_PORT}; the app hard-gates without it.`
				);
			}
			if (
				latest.canvas &&
				latest.timeline &&
				latest.complete &&
				latest.pathname === expectedPathname
			) {
				break;
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('CanvasDrawElement')) throw error;
			// The page is still navigating; Runtime.evaluate has no context to run in.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	if (!latest?.canvas || !latest.timeline) {
		throw new Error(
			`The Workspace never mounted at ${pageUrl}; last saw ${JSON.stringify(latest)}.`
		);
	}

	const appliedDeadline = Date.now() + 30_000;
	while (Date.now() < appliedDeadline) {
		const applied = await page.evaluate<boolean>(
			`document.body.textContent?.includes(${JSON.stringify(presetName)}) === true`
		);
		if (applied) return;
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(
		`The Workspace never applied "${presetName}"; it would have recorded another page.`
	);
}

/** What one recording of the open composition produced. */
interface WorkspaceLoopRecording {
	frameCount: number;
	fps: number;
	durationSeconds: number;
	posterFrame: number;
	distinctFrames: number;
}

/** Zero-padded so ffmpeg reads the sequence in capture order. */
const loopFrameFileName = (frame: number): string => `frame-${String(frame).padStart(4, '0')}.jpg`;

/**
 * Step the open composition frame by frame and photograph every one.
 *
 * Frame stepping is what makes the recording deterministic: it advances the same
 * timeline the play loop advances, on the exact frame grid instead of by wall
 * clock, so an unchanged app records the same frames twice. The transport is put
 * in its playing state to match — the hero shows the app playing, and it is
 * playing, one frame per shutter.
 */
async function recordLoopFrames(
	page: CdpPage,
	framesDirectory: string
): Promise<WorkspaceLoopRecording> {
	const transport = await page.evaluate<{ durationSeconds: number; fps: number }>(
		`(() => ({ durationSeconds: window.__gfxTimeline.durationSeconds, fps: window.__gfxTimeline.fps }))()`
	);
	const frameCount = Math.round(transport.durationSeconds * transport.fps);
	if (frameCount < 2) {
		throw new Error(
			`The open composition is ${transport.durationSeconds}s at ${transport.fps}fps, which is not a loop.`
		);
	}
	const posterFrame = Math.round(WORKSPACE_LOOP_POSTER_PROGRESS * (frameCount - 1));

	await page.evaluate<null>(
		`(window.__gfxTimeline.pause(), window.__gfxTimeline.seek(0), window.__gfxTimeline.isPlaying = true, null)`
	);
	// The first frame after a navigate is the one still settling, so give it the
	// long wait the seeked frames do not need.
	await sleep(1000);

	const frameDigests = new Set<string>();
	let previousTime = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		if (frame > 0) {
			const advancedTo = await page.evaluate<number>(
				`(window.__gfxTimeline.stepFrames(1), window.__gfxTimeline.time)`
			);
			if (advancedTo <= previousTime) {
				throw new Error(`The timeline stopped advancing at frame ${frame} (t=${advancedTo}s).`);
			}
			previousTime = advancedTo;
			await sleep(FRAME_SETTLE_MS);
		}
		// On-surface capture only: captureBeyondViewport re-rasters without the
		// accelerated WebGPU layer and yields a blank composition canvas.
		const shot = await page.send<{ data: string }>('Page.captureScreenshot', {
			format: 'jpeg',
			quality: 92,
			fromSurface: true
		});
		const frameBytes = Buffer.from(shot.data, 'base64');
		frameDigests.add(createHash('sha1').update(frameBytes).digest('hex'));
		await writeFile(join(framesDirectory, loopFrameFileName(frame)), frameBytes);
	}

	// A Workspace that stopped re-rendering photographs as one frame repeated,
	// which would ship as a still pretending to be a loop. Every frame of a real
	// recording moves at least the playhead.
	if (frameDigests.size * 3 < frameCount * 2) {
		throw new Error(
			`Only ${frameDigests.size} of ${frameCount} recorded frames differ; the Workspace was not animating.`
		);
	}

	return {
		frameCount,
		fps: transport.fps,
		durationSeconds: transport.durationSeconds,
		posterFrame,
		distinctFrames: frameDigests.size
	};
}

/**
 * The recorded frames into the one file the hero autoplays: scaled to the width
 * the page ships, holding the finished piece before the loop restarts so the
 * outro does not cut straight back to an empty canvas, and yuv420p + faststart
 * so it plays inline everywhere instead of downloading first.
 */
function encodeLoopVideo(framesDirectory: string, fps: number, destinationPath: string): void {
	const encoded = spawnSync(
		'ffmpeg',
		[
			'-y',
			'-loglevel',
			'error',
			'-framerate',
			String(fps),
			'-i',
			join(framesDirectory, 'frame-%04d.jpg'),
			'-vf',
			[
				// The frames arrive as full-range JPEG. Left alone, ffmpeg would keep
				// that range in the H.264 stream, where a player that ignores the flag
				// renders the app's dark chrome lighter than its own poster.
				`scale=${WEB_VIDEO_WIDTH}:-2:flags=lanczos:in_range=full:out_range=limited`,
				`tpad=stop_mode=clone:stop_duration=${LOOP_TAIL_HOLD_SECONDS}`,
				'format=yuv420p'
			].join(','),
			'-an',
			'-c:v',
			'libx264',
			'-preset',
			'slow',
			'-crf',
			'26',
			'-color_range',
			'tv',
			'-colorspace',
			'bt709',
			'-color_primaries',
			'bt709',
			'-color_trc',
			'bt709',
			'-movflags',
			'+faststart',
			destinationPath
		],
		{ cwd: repositoryRoot, stdio: 'inherit' }
	);
	if (encoded.status !== 0) {
		throw new Error(`ffmpeg could not encode ${destinationPath} (status ${encoded.status}).`);
	}
}

/**
 * One frame of the same recording as the poster: what the page shows before the
 * loop starts, and instead of the loop when the visitor asked for reduced
 * motion. WebP at the video's own width, so neither swaps in at a new size.
 */
function encodePosterFrame(sourcePath: string, destinationPath: string): void {
	const encoded = spawnSync(
		'ffmpeg',
		[
			'-y',
			'-loglevel',
			'error',
			'-i',
			sourcePath,
			'-vf',
			`scale=${WEB_VIDEO_WIDTH}:-2:flags=lanczos`,
			'-frames:v',
			'1',
			'-c:v',
			'libwebp',
			'-preset',
			'picture',
			'-compression_level',
			'6',
			'-quality',
			'82',
			destinationPath
		],
		{ cwd: repositoryRoot, stdio: 'inherit' }
	);
	if (encoded.status !== 0) {
		throw new Error(`ffmpeg could not encode ${destinationPath} (status ${encoded.status}).`);
	}
}

/** The Preset fields the home page states about the loop it is showing. */
interface WorkspaceLoopPreset {
	name: string;
	state: { transport: { orientation: VideoOrientation } };
}

const preset = JSON.parse(
	await readFile(
		resolve(repositoryRoot, `src/lib/presets/${WORKSPACE_LOOP_PRESET_SLUG}.json`),
		'utf8'
	)
) as WorkspaceLoopPreset;
const presetName = preset.name;
const compositionSize = getVideoFrameSize(preset.state.transport.orientation);

const jail = await createVerificationServerJail('workspace-loop');
const server = await startWorkspaceDevServer(jail);
const harness = spawnSync('scripts/launch-cdp-chrome.sh', [], {
	cwd: repositoryRoot,
	stdio: 'inherit',
	env: {
		...process.env,
		CDP_PORT: String(WORKSPACE_LOOP_CDP_PORT),
		CDP_BROWSER_MODE: 'canvas',
		CDP_PROFILE_DIR: jail.chromeProfileDirectory
	}
});
if (harness.status !== 0) {
	await server.stop();
	await jail.dispose();
	throw new Error(`The sanctioned CDP harness would not start (status ${harness.status}).`);
}

const framesDirectory = join(jail.root, 'workspace-loop-frames');
await mkdir(framesDirectory, { recursive: true });

let page: CdpPage | null = null;
try {
	page = await openCdpPage();
	await awaitWorkspace(page, presetName);
	const recording = await recordLoopFrames(page, framesDirectory);
	await mkdir(dirname(webVideoPath), { recursive: true });
	encodeLoopVideo(framesDirectory, recording.fps, webVideoPath);
	encodePosterFrame(join(framesDirectory, loopFrameFileName(recording.posterFrame)), webPosterPath);
	// `scale=WIDTH:-2` lands on this same even height; the viewport is the only
	// thing that decides the loop's shape.
	const webVideoHeight = Math.round((VIEWPORT.height / VIEWPORT.width) * WEB_VIDEO_WIDTH);
	await writeFile(
		loopManifestPath,
		`${JSON.stringify(
			{
				presetSlug: WORKSPACE_LOOP_PRESET_SLUG,
				presetName,
				durationSeconds: recording.durationSeconds,
				fps: recording.fps,
				compositionWidth: compositionSize.width,
				compositionHeight: compositionSize.height,
				videoWidth: WEB_VIDEO_WIDTH,
				videoHeight: webVideoHeight,
				video: '/gfx-workspace.mp4',
				poster: '/gfx-workspace.webp'
			},
			null,
			'\t'
		)}\n`
	);
	console.log(
		`Recorded ${presetName}: ${recording.frameCount} frames at ${recording.fps}fps ` +
			`(${recording.distinctFrames} distinct) → ${webVideoPath}, poster from frame ${recording.posterFrame}.`
	);
} finally {
	await page?.close().catch(() => undefined);
	await closeHarnessBrowser().catch(() => undefined);
	await server.stop();
	// The jail owns the browser profile and every recorded frame, so disposing it
	// is the whole cleanup.
	await jail.dispose();
}
