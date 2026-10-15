// Screenshots of the Scene strip, the Scene picker, and the Add to Film menu
// in the real Workspace (ADR-0068 §10), for a person to look at. This is not a
// check: it compares nothing and passes whenever it could take the pictures.
//
// One invocation, no interactive tooling. The run starts its own jailed dev
// server on a port of its own, writes two Films into the jail's composition
// store (a three-Scene Film and a one-Scene Film, both built from corpus
// Presets), confirms the sanctioned CanvasDrawElement Chrome through
// scripts/launch-cdp-chrome.sh (canvas mode, CDP 9223), and drives a fresh tab
// over CDP at 1600×1000.
//
//   node --experimental-strip-types scripts/cdp-capture-film-scene-strip.mjs
//
// It writes four full-page PNGs, all in the horizontal orientation:
//
//   01-workspace-scene-strip.png   the three-Scene Film, its second Scene open,
//                                  the playhead mid-Scene
//   02-scene-picker.png            the same, with the `+` Scene picker open
//   03-scene-picker-filtered.png   the picker with a search typed in
//   04-add-to-film-menu.png        a built-in Preset's page with the Add to Film
//                                  menu open, the store holding both Films
//
// Each Film is opened once before the pictures are taken, so the Workspace has
// the chance to capture its poster and the menu can show it. A poster that is
// not there in time is not an error: the row shows the Film's Surface default,
// as the home library does.
//
// Environment: GFX_SCENE_STRIP_PORT (server, default 7297), CDP_PORT (default
// 9223), GFX_SCENE_STRIP_OUTDIR (default .tmp-baselines/film-scene-strip),
// GFX_SCENE_STRIP_FILTER (the search typed for the third picture, default
// "chart"). Node 22+ (built-in fetch/WebSocket); needs pnpm and Chrome.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filmFrameCount, filmSceneFrameOffsets } from '../src/lib/platform/film-playhead.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	signalServerProcessGroup
} from './verification-server-jail.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presetDirectory = join(repositoryRoot, 'src/lib/presets');

const SERVER_PORT = Number(process.env.GFX_SCENE_STRIP_PORT ?? 7297);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_SCENE_STRIP_OUTDIR ?? '.tmp-baselines/film-scene-strip'
);
const PICKER_FILTER = process.env.GFX_SCENE_STRIP_FILTER ?? 'chart';
const origin = `http://localhost:${SERVER_PORT}`;

const VIEWPORT = { width: 1600, height: 1000, deviceScaleFactor: 1 };
const HORIZONTAL_CANVAS_WIDTH = 3840;

/** The Starters the three-Scene Film is cut from, in Scene order. */
const THREE_SCENE_STARTERS = ['lower-third', 'chapter-card-descent', 'counter-milestone'];
const THREE_SCENE_FILM = { slug: 'launch-film', name: 'Launch film' };
const ONE_SCENE_FILM = { slug: 'teaser', name: 'Teaser', starter: 'achievement-complete' };
/** The built-in Preset page the Add to Film menu is photographed on. */
const BUILT_IN_PRESET_SLUG = 'lower-third';

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
const FRAME_TIMEOUT_MS = 60_000;
/** How long a Film's poster may take to be captured before the run goes on without it. */
const POSTER_CAPTURE_TIMEOUT_MS = 30_000;
/** How long the pictures in an open popover may take to load. */
const POPOVER_IMAGES_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

// The COMPOSITION canvas is the largest-backing one. The editor chrome renders
// small canvases too (timeline sound-clip waveforms), so document order is not
// a stable way to find it.
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

const sleep = (milliseconds) => new Promise((settle) => setTimeout(settle, milliseconds));

// ---------------------------------------------------------------------------
// The two Films the jail's store holds.

async function readCorpusPreset(slug) {
	return JSON.parse(await readFile(join(presetDirectory, `${slug}.json`), 'utf8'));
}

/**
 * A `gfx-film@1` Film whose Scenes are owned copies of corpus Presets, each
 * named for its Preset. The Film takes its Pack and transport from the first.
 */
async function filmFromStarters(name, starterSlugs) {
	const presets = await Promise.all(starterSlugs.map(readCorpusPreset));
	const [first] = presets;
	return {
		schema: 'gfx-film@1',
		name,
		pack: first.pack,
		orientation: 'horizontal',
		fps: first.state.transport.fps,
		format: first.state.transport.format,
		scenes: presets.map((preset, sceneIndex) => ({
			id: `scene-${sceneIndex + 1}`,
			name: preset.name,
			origin: { slug: starterSlugs[sceneIndex], contentKey: null },
			state: preset.state
		})),
		boundaries: starterSlugs.slice(1).map(() => ({ kind: 'cut' }))
	};
}

/** Store one Film as the `{ meta, film }` record the disk store reads. */
async function writeStoredFilm(storeDirectory, slug, film, savedAt) {
	await writeFile(
		join(storeDirectory, `${slug}.json`),
		JSON.stringify({ meta: { savedAt }, film })
	);
}

// ---------------------------------------------------------------------------
// The app and the browser.

/**
 * The app runs from the jail's store and scratch directories on a port of its
 * own: this run must never reach the author's real compositions, and
 * `assertVerificationOriginAllowed` refuses the dev server's port outright.
 */
async function startJailedDevServer(jail) {
	assertVerificationOriginAllowed(origin);
	const child = spawn(
		'pnpm',
		['exec', 'vp', 'dev', '--port', String(SERVER_PORT), '--strictPort'],
		{
			cwd: repositoryRoot,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...jail.environment }
		}
	);
	const stop = async () => {
		signalServerProcessGroup(child, 'SIGTERM');
		await sleep(250);
		signalServerProcessGroup(child, 'SIGKILL');
	};
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The jailed dev server exited with ${child.exitCode}.`);
		}
		try {
			const response = await fetch(origin);
			if (response.ok) return { stop };
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The jailed dev server never answered at ${origin}.`);
}

async function openCdpPage() {
	const response = await fetch(
		`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${CDP_PORT} would not open a target.`);
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
		send,
		evaluate,
		close: async () => {
			await send('Page.close').catch(() => undefined);
			socket.close();
		}
	};
}

/**
 * Open `/p/<slug>` and wait for the real thing: the composition canvas mounted
 * at the horizontal native size, the Film-time seam exposed, the route settled,
 * and the open document's own name on the page.
 */
async function openWorkspace(page, slug, name) {
	const pageUrl = `${origin}/p/${slug}`;
	const expectedPathname = new URL(pageUrl).pathname;
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
				named: document.body?.textContent?.includes(${JSON.stringify(name)}) === true,
				canvasDrawElement: typeof GPUQueue !== 'undefined' && 'copyElementImageToTexture' in GPUQueue.prototype
			}))()`);
			if (!latest.canvasDrawElement) {
				throw new Error(
					`CanvasDrawElement is unavailable on CDP port ${CDP_PORT}; the app hard-gates without it.`
				);
			}
			if (
				latest.canvasWidth === HORIZONTAL_CANVAS_WIDTH &&
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

/** Land Film time on one frame, which selects the Scene the frame is in. */
async function settleFilmFrame(page, filmFrame) {
	return page.evaluate(`Promise.race([
		window.__settleGfxFilmFrame(${filmFrame}),
		new Promise((_, fail) =>
			setTimeout(
				() => fail(new Error('Film frame ${filmFrame} never settled within ${FRAME_TIMEOUT_MS}ms.')),
				${FRAME_TIMEOUT_MS}
			)
		)
	])`);
}

/**
 * Wait, without failing, for the poster the Workspace captures of the Film it
 * has open. The store's listing names the poster key; the poster route answers
 * once the capture has been stored.
 */
async function waitForStoredPoster(slug) {
	const listing = await fetch(`${origin}/api/user-compositions?view=cards`);
	if (!listing.ok) return false;
	const entry = (await listing.json()).find((candidate) => candidate.slug === slug);
	if (!entry?.posterKey) return false;
	const deadline = Date.now() + POSTER_CAPTURE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const poster = await fetch(`${origin}/api/posters/${entry.posterKey}`, { method: 'HEAD' });
		if (poster.ok) return true;
		await sleep(POLL_INTERVAL_MS);
	}
	return false;
}

/**
 * Open a popover by id, as its trigger does (an open one is left open), and wait
 * for the pictures in view to finish loading so the screenshot is not a wall of skeletons. A picture
 * that never loads does not fail the run.
 */
async function openPopover(page, popoverId, expectedEntrySelector) {
	await page.evaluate(`(() => {
		const popover = document.getElementById(${JSON.stringify(popoverId)});
		if (!popover.matches(':popover-open')) popover.showPopover();
	})()`);
	const deadline = Date.now() + POPOVER_IMAGES_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const settled = await page.evaluate(`(() => {
			const popover = document.getElementById(${JSON.stringify(popoverId)});
			if (popover.querySelector(${JSON.stringify(expectedEntrySelector)}) === null) return false;
			const bounds = popover.getBoundingClientRect();
			const inView = [...popover.querySelectorAll('.poster-thumb')].filter((thumb) => {
				const rect = thumb.getBoundingClientRect();
				return rect.bottom > bounds.top && rect.top < bounds.bottom;
			});
			return inView.every((thumb) => {
				const image = thumb.querySelector('img');
				return image !== null && image.complete && image.naturalWidth > 0;
			});
		})()`);
		if (settled) break;
		await sleep(POLL_INTERVAL_MS);
	}
	// The pictures fade in over 300ms and the popover over 160ms.
	await sleep(600);
}

async function writeScreenshot(page, filename) {
	const { data } = await page.send('Page.captureScreenshot', {
		format: 'png',
		captureBeyondViewport: true
	});
	const path = join(OUTDIR, filename);
	await writeFile(path, Buffer.from(data, 'base64'));
	console.log(`  wrote ${path}`);
}

// ---------------------------------------------------------------------------

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-scene-strip');
await mkdir(jail.compositionStoreDirectory, { recursive: true });

const threeSceneFilm = await filmFromStarters(THREE_SCENE_FILM.name, THREE_SCENE_STARTERS);
const oneSceneFilm = await filmFromStarters(ONE_SCENE_FILM.name, [ONE_SCENE_FILM.starter]);
await writeStoredFilm(
	jail.compositionStoreDirectory,
	THREE_SCENE_FILM.slug,
	threeSceneFilm,
	'2026-10-09T10:00:00.000Z'
);
await writeStoredFilm(
	jail.compositionStoreDirectory,
	ONE_SCENE_FILM.slug,
	oneSceneFilm,
	'2026-10-08T10:00:00.000Z'
);

// The middle of the second Scene, worked out by the engine's own Film playhead.
const sceneOffsets = filmSceneFrameOffsets(threeSceneFilm);
const secondSceneFrameCount = sceneOffsets[2] - sceneOffsets[1];
const midSecondSceneFilmFrame = sceneOffsets[1] + Math.floor(secondSceneFrameCount / 2);
if (midSecondSceneFilmFrame >= filmFrameCount(threeSceneFilm)) {
	throw new Error('The second Scene of the fixture Film has no middle frame.');
}

const builtInPreset = await readCorpusPreset(BUILT_IN_PRESET_SLUG);

let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail);
	const harness = spawnSync('scripts/launch-cdp-chrome.sh', [], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		env: { ...process.env, CDP_PORT: String(CDP_PORT), CDP_BROWSER_MODE: 'canvas' }
	});
	if (harness.status !== 0) {
		throw new Error(`The sanctioned CDP harness would not start (status ${harness.status}).`);
	}
	page = await openCdpPage();

	// Each Film is opened once so the Workspace can capture its poster.
	console.log(`${ONE_SCENE_FILM.name}:`);
	await openWorkspace(page, ONE_SCENE_FILM.slug, ONE_SCENE_FILM.name);
	console.log(
		`  poster ${(await waitForStoredPoster(ONE_SCENE_FILM.slug)) ? 'captured' : 'not captured in time'}`
	);

	console.log(`${THREE_SCENE_FILM.name}:`);
	await openWorkspace(page, THREE_SCENE_FILM.slug, THREE_SCENE_FILM.name);
	console.log(
		`  poster ${(await waitForStoredPoster(THREE_SCENE_FILM.slug)) ? 'captured' : 'not captured in time'}`
	);
	const position = await settleFilmFrame(page, midSecondSceneFilmFrame);
	if (position.sceneId !== threeSceneFilm.scenes[1].id) {
		throw new Error(
			`Film frame ${midSecondSceneFilmFrame} landed in ${position.sceneId}, not the second Scene.`
		);
	}
	console.log(
		`  second Scene open at Scene frame ${position.localFrame} of ${position.sceneFrameCount}`
	);
	await sleep(500);
	await writeScreenshot(page, '01-workspace-scene-strip.png');

	await openPopover(page, 'film-scene-starter-picker', '.poster-card');
	await writeScreenshot(page, '02-scene-picker.png');

	await page.evaluate(
		`document.querySelector('#film-scene-starter-picker input[type="search"]').focus()`
	);
	await page.send('Input.insertText', { text: PICKER_FILTER });
	// The grid re-lays out and the newly shown pictures load.
	await openPopover(page, 'film-scene-starter-picker', 'input[type="search"]');
	await writeScreenshot(page, '03-scene-picker-filtered.png');

	console.log(`${builtInPreset.name} (built-in Preset):`);
	await openWorkspace(page, BUILT_IN_PRESET_SLUG, builtInPreset.name);
	await openPopover(page, 'add-to-film-menu', '.add-to-film__item--film');
	await writeScreenshot(page, '04-add-to-film-menu.png');
} finally {
	await page?.close().catch(() => undefined);
	await server?.stop();
	await jail.dispose();
}

console.log(`Film Scene strip: four screenshots in ${OUTDIR}.`);
process.exit(0);
