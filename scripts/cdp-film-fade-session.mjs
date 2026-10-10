// The shared session of the Film boundary scripts (ADR-0068 §4):
// `cdp-capture-film-fade-frames.mjs` and
// `cdp-capture-film-boundary-effect-frames.mjs` (the look), and
// `cdp-film-fade-tracer.mjs` (the proof). Not a script to run on its own.
//
// It owns what both do the same way, following `cdp-film-cut-frames.mjs`: the
// fixture and the stored records made from it, a jailed dev server on a port of
// its own, the sanctioned CanvasDrawElement Chrome (canvas mode, CDP 9223), a
// fresh tab driven over CDP, and one frame landed through the Workspace's
// Film-time seam (`window.__settleGfxFilmFrame`) and read back as the canvas
// PNG. Inside a boundary window that seam renders both Scenes and holds their
// blend on the canvas, the way a paused playhead and an export do.
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	filmFrameCount,
	filmSceneBoundaryOverlaps,
	filmSceneFrameOffsets
} from '../src/lib/platform/film-playhead.ts';
import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';
import { assertVerificationOriginAllowed } from './verification-server-jail.ts';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FILM_FADE_FIXTURE_PATH = 'scripts/fixtures/film-fade/two-scene-fade.film.json';

export const ORIENTATIONS = ['horizontal', 'vertical'];
const CANVAS_WIDTH = { horizontal: 3840, vertical: 2160 };
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
/** How long one frame may take to swap Scenes, settle, blend, and read back. */
const FRAME_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;

// The COMPOSITION canvas is the largest-backing one. The editor chrome renders
// small canvases too (timeline sound-clip waveforms), so document order is not
// a stable way to find it.
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

const sleep = (milliseconds) => new Promise((settle) => setTimeout(settle, milliseconds));

// ---------------------------------------------------------------------------
// The fixture, and where its window is.

export const fixtureFilm = JSON.parse(
	await readFile(join(repositoryRoot, FILM_FADE_FIXTURE_PATH), 'utf8')
);
if (
	fixtureFilm.scenes.length !== 2 ||
	fixtureFilm.boundaries.length !== 1 ||
	fixtureFilm.boundaries[0].kind !== 'fade'
) {
	throw new Error(`${FILM_FADE_FIXTURE_PATH} must be a two-Scene Film with one fade.`);
}
if (fixtureFilm.scenes[0].state.surface.type === fixtureFilm.scenes[1].state.surface.type) {
	throw new Error(`${FILM_FADE_FIXTURE_PATH} must hold two Scenes with different Surface types.`);
}

/**
 * The one boundary window of a two-Scene Film, in Film frames and in each
 * Scene's own frames. Frame positions are worked out by the engine's own Film
 * playhead, so the scripts and the Workspace cannot disagree about where the
 * window is. The window depends on the boundary's `durationMs` alone, so it is
 * the same for a fade and for any transition effect of that length.
 */
export function boundaryWindowOfTwoSceneFilm(film) {
	const [, incomingSceneOffset] = filmSceneFrameOffsets(film);
	const [windowFrameCount] = filmSceneBoundaryOverlaps(film);
	const totalFrameCount = filmFrameCount(film);
	return {
		/** The first Film frame both Scenes are on. */
		startFilmFrame: incomingSceneOffset,
		frameCount: windowFrameCount,
		outgoingSceneFrameCount: incomingSceneOffset + windowFrameCount,
		incomingSceneFrameCount: totalFrameCount - incomingSceneOffset,
		filmFrameCount: totalFrameCount
	};
}

/**
 * The frame of `window` nearest a wanted progress, with the Film frame it is
 * and the frame of each Scene on it. Progress runs 0 on the window's first
 * frame to 1 on its last, so a wanted 0.25 lands on the nearest whole frame;
 * the progress the engine reports for that frame is what a capture is labelled
 * and blended with.
 */
export function boundaryWindowFrameNearProgress(window, wantedProgress) {
	const windowFrame = Math.round(wantedProgress * (window.frameCount - 1));
	return {
		wantedProgress,
		windowFrame,
		filmFrame: window.startFilmFrame + windowFrame,
		outgoingSceneFrame: window.outgoingSceneFrameCount - window.frameCount + windowFrame,
		incomingSceneFrame: windowFrame
	};
}

/** The fixture's one boundary window. */
export const fixtureWindow = boundaryWindowOfTwoSceneFilm(fixtureFilm);
if (fixtureWindow.frameCount < 2) {
	throw new Error(`${FILM_FADE_FIXTURE_PATH} needs a fade of at least two frames.`);
}

/** `boundaryWindowFrameNearProgress` on the fixture's window. */
export function windowFrameNearProgress(wantedProgress) {
	return boundaryWindowFrameNearProgress(fixtureWindow, wantedProgress);
}

/**
 * The fixture's fade, as the boundary a script may put another kind in place
 * of. Every kind is given the fade's own `durationMs`, so the window does not
 * move.
 */
export const fixtureFadeBoundary = fixtureFilm.boundaries[0];

/**
 * The fixture under one orientation: whole, cut down to one of its Scenes, or
 * whole with `boundary` in place of its fade.
 */
export function filmDocument(orientation, sceneIndex = null, boundary = fixtureFadeBoundary) {
	if (sceneIndex === null) {
		return {
			...fixtureFilm,
			name: `Film ${boundary.kind} ${orientation}`,
			orientation,
			boundaries: [boundary]
		};
	}
	const scene = fixtureFilm.scenes[sceneIndex];
	return {
		...fixtureFilm,
		name: `Film fade ${orientation} ${scene.id} alone`,
		orientation,
		scenes: [scene],
		boundaries: []
	};
}

export function filmSlug(orientation, sceneIndex = null, boundary = fixtureFadeBoundary) {
	return sceneIndex === null
		? `film-${boundary.kind}-${orientation}`
		: `film-fade-${orientation}-scene-${sceneIndex + 1}`;
}

/**
 * One boundary per registered transition effect, at that effect's own default
 * params, lasting `durationMs`. Read from the live registry, so a newly
 * registered effect is captured and traced without a change here.
 */
export async function transitionEffectBoundaries(durationMs) {
	registerGfxRuntimeModuleHooks(repositoryRoot);
	const { transitionEffectDefinitions } =
		await import('../src/lib/platform/pipelines/transition-definition-registry.ts');
	return transitionEffectDefinitions().map((definition) => ({
		kind: definition.type,
		durationMs,
		params: definition.defaults().params
	}));
}

/** Store one Film as the `{ meta, film }` record the disk store reads. */
export async function writeStoredFilm(storeDirectory, slug, film) {
	await writeFile(
		join(storeDirectory, `${slug}.json`),
		JSON.stringify({ meta: { savedAt: new Date().toISOString() }, film })
	);
}

// ---------------------------------------------------------------------------
// The app under measurement and the browser that reads it.

/**
 * The app runs from the jail's store and scratch directories on a port of its
 * own: a run must never reach the author's real compositions, and
 * `assertVerificationOriginAllowed` refuses the dev server's port outright.
 */
export async function startJailedDevServer(jail, serverPort) {
	const origin = `http://localhost:${serverPort}`;
	assertVerificationOriginAllowed(origin);
	const child = spawn(
		'pnpm',
		['exec', 'vite', 'dev', '--port', String(serverPort), '--strictPort'],
		{
			cwd: repositoryRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...jail.environment }
		}
	);
	const stop = async () => {
		if (child.exitCode === null) child.kill('SIGTERM');
		await sleep(250);
		if (child.exitCode === null) child.kill('SIGKILL');
	};
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The jailed dev server exited with ${child.exitCode}.`);
		}
		try {
			const response = await fetch(origin);
			if (response.ok) return { origin, stop };
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The jailed dev server never answered at ${origin}.`);
}

/** Start or confirm the sanctioned canvas-mode Chrome on `cdpPort`. */
export function confirmCanvasChrome(cdpPort) {
	const harness = spawnSync('scripts/launch-cdp-chrome.sh', [], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		env: { ...process.env, CDP_PORT: String(cdpPort), CDP_BROWSER_MODE: 'canvas' }
	});
	if (harness.status !== 0) {
		throw new Error(`The sanctioned CDP harness would not start (status ${harness.status}).`);
	}
}

export async function openCdpPage(cdpPort) {
	const response = await fetch(
		`http://localhost:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${cdpPort} would not open a target.`);
	const target = await response.json();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP socket refused the connection.'));
	});

	let nextId = 1;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(String(event.data));
		if (message.id === undefined) return;
		const waiting = pending.get(message.id);
		if (!waiting) return;
		pending.delete(message.id);
		if (message.error) waiting.fail(new Error(message.error.message));
		else waiting.settle(message.result ?? {});
	};
	const send = (method, params = {}) =>
		new Promise((settle, fail) => {
			const id = nextId++;
			pending.set(id, { settle, fail });
			socket.send(JSON.stringify({ id, method, params }));
		});
	async function evaluate(expression) {
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
	}

	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });
	return {
		cdpPort,
		send,
		evaluate,
		close: async () => {
			await send('Page.close').catch(() => undefined);
			socket.close();
		}
	};
}

/**
 * Wait for the real thing: the composition canvas mounted at this
 * orientation's native size, the Film-time seam exposed, the route settled, and
 * the open Film's own name on the page. Reading a page that has not applied its
 * Film yet captures whatever the tab was showing before.
 */
export async function openStoredFilm(page, origin, slug, film) {
	const pageUrl = `${origin}/p/${slug}`;
	const expectedPathname = new URL(pageUrl).pathname;
	const expectedCanvasWidth = CANVAS_WIDTH[film.orientation];
	await page.send('Page.navigate', { url: pageUrl });

	const deadline = Date.now() + WORKSPACE_READY_TIMEOUT_MS;
	let latest = null;
	while (Date.now() < deadline) {
		try {
			latest = await page.evaluate(`(() => ({
				canvasWidth: (${COMPOSITION_CANVAS})?.width ?? null,
				filmSeam: typeof window.__settleGfxFilmFrame === 'function',
				complete: document.readyState === 'complete',
				pathname: location.pathname,
				named: document.body?.textContent?.includes(${JSON.stringify(film.name)}) === true,
				canvasDrawElement: typeof GPUQueue !== 'undefined' && 'copyElementImageToTexture' in GPUQueue.prototype
			}))()`);
			if (!latest.canvasDrawElement) {
				throw new Error(
					`CanvasDrawElement is unavailable on CDP port ${page.cdpPort}; the app hard-gates without it.`
				);
			}
			if (
				latest.canvasWidth === expectedCanvasWidth &&
				latest.filmSeam &&
				latest.complete &&
				latest.named &&
				latest.pathname === expectedPathname
			) {
				return;
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('CanvasDrawElement')) throw error;
			// The page is still navigating; Runtime.evaluate has no context to run in.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`The Workspace never opened ${pageUrl}; last saw ${JSON.stringify(latest)}.`);
}

/**
 * Land Film time on one frame, paused, and read the canvas back as a PNG: where
 * the frame landed, the boundary window it is in (both Scenes' frames and the
 * progress, or `null` outside a window), and the PNG's bytes.
 */
export async function captureFilmFramePng(page, filmFrame) {
	const capture = await page.evaluate(`(() => {
		const capture = (async () => {
			const position = await window.__settleGfxFilmFrame(${filmFrame});
			const canvas = ${COMPOSITION_CANVAS};
			const blob = await new Promise((settle) => canvas.toBlob(settle, 'image/png'));
			if (!blob) throw new Error('The composition canvas presented nothing to read.');
			const view = new Uint8Array(await blob.arrayBuffer());
			let binary = '';
			for (let offset = 0; offset < view.length; offset += 0x8000) {
				binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
			}
			const window_ = position.boundaryWindow;
			return {
				sceneId: position.sceneId,
				sceneFrame: position.localFrame,
				boundaryWindow: window_ === null ? null : {
					outgoingSceneId: window_.outgoing.sceneId,
					outgoingSceneFrame: window_.outgoing.localFrame,
					incomingSceneId: window_.incoming.sceneId,
					incomingSceneFrame: window_.incoming.localFrame,
					windowFrame: window_.windowFrame,
					windowFrameCount: window_.windowFrameCount,
					progress: window_.progress
				},
				width: canvas.width,
				height: canvas.height,
				pngBase64: btoa(binary)
			};
		})();
		const timeout = new Promise((_, fail) =>
			setTimeout(
				() => fail(new Error('Film frame ${filmFrame} never settled within ${FRAME_TIMEOUT_MS}ms.')),
				${FRAME_TIMEOUT_MS}
			)
		);
		return Promise.race([capture, timeout]);
	})()`);
	const { pngBase64, ...landed } = capture;
	return { filmFrame, ...landed, png: Buffer.from(pngBase64, 'base64') };
}
