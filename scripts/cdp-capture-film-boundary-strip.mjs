// Screenshots of Scene boundaries on the Scene strip and in the inspector, in
// the real Workspace (ADR-0068 §4, §10), for a person to look at. This is not a
// check: it compares nothing and passes whenever it could take the pictures.
//
// One invocation, no interactive tooling. The run starts its own jailed dev
// server on a port of its own, writes one three-Scene Film into the jail's
// composition store (three corpus Presets, a fade after the first Scene and a
// seeded shatter after the second), confirms the sanctioned CanvasDrawElement
// Chrome through scripts/launch-cdp-chrome.sh (canvas mode, CDP 9223), and
// drives a fresh tab over CDP at 1600×1000.
//
//   node --experimental-strip-types scripts/cdp-capture-film-boundary-strip.mjs
//
// It writes four full-page PNGs, all in the horizontal orientation:
//
//   01-strip-fade-and-shatter.png  the Film with both boundaries on the strip,
//                                  nothing selected, the playhead mid first Scene
//   02-fade-junction-selected.png  the fade junction selected, its fields in the
//                                  inspector
//   03-shatter-junction-selected.png  the shatter junction selected, with the
//                                  effect's params
//   04-paused-mid-window.png       the playhead paused in the middle of the
//                                  fade's window: both Scenes composited on
//                                  the canvas
//
// A junction is selected the way its button is activated from the keyboard, so
// the playhead stays where it was.
//
// Environment: GFX_BOUNDARY_STRIP_PORT (server, default 7299), CDP_PORT
// (default 9223), GFX_BOUNDARY_STRIP_OUTDIR (default
// .tmp-baselines/film-boundary-strip). Node 22+ (built-in fetch/WebSocket);
// needs pnpm and Chrome.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
	filmSceneBoundaryOverlaps,
	filmSceneFrameOffsets
} from '../src/lib/platform/film-playhead.ts';
import {
	confirmCanvasChrome,
	openCdpPage,
	openStoredFilm,
	repositoryRoot,
	startJailedDevServer,
	transitionEffectBoundaries,
	writeStoredFilm
} from './cdp-film-fade-session.mjs';
import { createVerificationServerJail } from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_BOUNDARY_STRIP_PORT ?? 7299);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_BOUNDARY_STRIP_OUTDIR ?? '.tmp-baselines/film-boundary-strip'
);

const VIEWPORT = { width: 1600, height: 1000, deviceScaleFactor: 1 };
/** The Starters the Film is made of, in Scene order. */
const SCENE_STARTERS = ['lower-third', 'chapter-card-descent', 'counter-milestone'];
const FILM_SLUG = 'boundary-film';
const FADE_DURATION_MS = 1000;
const SHATTER_KIND = 'seeded-shatter';
const SHATTER_DURATION_MS = 1200;
const FRAME_TIMEOUT_MS = 120_000;

const sleep = (milliseconds) => new Promise((settle) => setTimeout(settle, milliseconds));

async function readCorpusPreset(slug) {
	return JSON.parse(
		await readFile(join(repositoryRoot, 'src/lib/presets', `${slug}.json`), 'utf8')
	);
}

const shatterBoundary = (await transitionEffectBoundaries(SHATTER_DURATION_MS)).find(
	(boundary) => boundary.kind === SHATTER_KIND
);
if (!shatterBoundary) {
	throw new Error(`The transition registry holds no "${SHATTER_KIND}" effect.`);
}

const presets = await Promise.all(SCENE_STARTERS.map(readCorpusPreset));
const film = {
	schema: 'gfx-film@1',
	name: 'Boundary film',
	pack: presets[0].pack,
	orientation: 'horizontal',
	fps: presets[0].state.transport.fps,
	format: presets[0].state.transport.format,
	scenes: presets.map((preset, sceneIndex) => ({
		id: `scene-${sceneIndex + 1}`,
		name: preset.name,
		origin: { slug: SCENE_STARTERS[sceneIndex], contentKey: null },
		state: preset.state
	})),
	boundaries: [{ kind: 'fade', durationMs: FADE_DURATION_MS }, shatterBoundary]
};

// Frame positions are worked out by the engine's own Film playhead.
const sceneOffsets = filmSceneFrameOffsets(film);
const [fadeWindowFrames] = filmSceneBoundaryOverlaps(film);
const midFirstSceneFilmFrame = Math.floor(sceneOffsets[1] / 2);
const midFadeWindowFilmFrame = sceneOffsets[1] + Math.floor(fadeWindowFrames / 2);

/** Land Film time on one frame, paused. Inside a window the canvas then holds both Scenes. */
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

/** Activate one junction of the strip as the keyboard does, and wait for its fields. */
async function selectJunction(page, boundaryIndex) {
	const selected = await page.evaluate(`(async () => {
		const junction = document.querySelector('[data-boundary-index="${boundaryIndex}"]');
		if (!(junction instanceof HTMLButtonElement)) return false;
		junction.click();
		await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
		return junction.getAttribute('aria-pressed') === 'true';
	})()`);
	if (!selected) {
		throw new Error(`The Scene strip has no junction ${boundaryIndex} to select.`);
	}
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

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-boundary-strip');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
await writeStoredFilm(jail.compositionStoreDirectory, FILM_SLUG, film);

let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail, SERVER_PORT);
	confirmCanvasChrome(CDP_PORT);
	page = await openCdpPage(CDP_PORT);
	await page.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });

	console.log(`${film.name}:`);
	await openStoredFilm(page, server.origin, FILM_SLUG, film);

	await settleFilmFrame(page, midFirstSceneFilmFrame);
	await sleep(500);
	await writeScreenshot(page, '01-strip-fade-and-shatter.png');

	await selectJunction(page, 0);
	await sleep(300);
	await writeScreenshot(page, '02-fade-junction-selected.png');

	await selectJunction(page, 1);
	await sleep(300);
	await writeScreenshot(page, '03-shatter-junction-selected.png');

	const position = await settleFilmFrame(page, midFadeWindowFilmFrame);
	if (position.boundaryWindow === null) {
		throw new Error(`Film frame ${midFadeWindowFilmFrame} did not land inside the fade's window.`);
	}
	console.log(
		`  paused at Film frame ${midFadeWindowFilmFrame}, window progress ${position.boundaryWindow.progress.toFixed(3)}`
	);
	await sleep(500);
	await writeScreenshot(page, '04-paused-mid-window.png');
} finally {
	await page?.close().catch(() => undefined);
	await server?.stop();
	await jail.dispose();
}

console.log(`Film boundary strip: four screenshots in ${OUTDIR}.`);
process.exit(0);
