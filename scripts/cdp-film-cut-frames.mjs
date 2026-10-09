// Hard-cut frame exactness for a Film of several Scenes (ADR-0068 §4).
//
// A hard cut swaps one engine state for another. This proves the swap leaves
// nothing behind: a frame reached by seeking Film time across the cut must be
// the same pixels as the same Scene frame with that Scene opened alone.
//
// One invocation, no interactive tooling. The run starts its own jailed dev
// server on a port of its own, writes the fixture Film and each of its Scenes as
// a one-Scene Film into the jail's composition store, confirms the sanctioned
// CanvasDrawElement Chrome through scripts/launch-cdp-chrome.sh (canvas mode,
// CDP 9223), and drives a fresh tab over CDP. Each frame is landed through the
// Workspace's Film-time seam (`window.__settleGfxFilmFrame`), which selects the
// Scene the frame is in and settles it the way every exact-frame reader does.
//
//   node --experimental-strip-types scripts/cdp-film-cut-frames.mjs
//
// For each orientation it captures, in the two-Scene Film: a mid frame and the
// last frame of Scene 1, the first frame and a mid frame of Scene 2, and the
// last frame of Scene 1 again after cutting back. It captures the same Scene
// frames with each Scene opened alone and compares SHA-256 hashes of the
// canvas PNG. The mid frames are there because a first or last frame is often
// empty, and two empty frames agree without proving anything.
//
// Prints a JSON report, writes it to <out>/report.json, and exits 1 when any
// pair differs. Environment: GFX_FILM_CUT_PORT (server, default 7296), CDP_PORT
// (default 9223), GFX_FILM_CUT_OUTDIR (default .tmp-baselines/film-cut-frames),
// GFX_FILM_CUT_SAVE_FRAMES=1 to also write every captured frame as a PNG.
// Node 22+ (built-in fetch/WebSocket); needs pnpm and Chrome.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filmFrameCount, filmSceneFrameOffsets } from '../src/lib/platform/film-playhead.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail
} from './verification-server-jail.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(
	repositoryRoot,
	'scripts/fixtures/film-cut-frames/two-scene-cut.film.json'
);

const SERVER_PORT = Number(process.env.GFX_FILM_CUT_PORT ?? 7296);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_CUT_OUTDIR ?? '.tmp-baselines/film-cut-frames'
);
const SAVE_FRAMES = process.env.GFX_FILM_CUT_SAVE_FRAMES === '1';
const origin = `http://localhost:${SERVER_PORT}`;

const ORIENTATIONS = ['horizontal', 'vertical'];
const CANVAS_WIDTH = { horizontal: 3840, vertical: 2160 };
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
/** How long one frame may take to cut, settle, and read back. */
const FRAME_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

// The COMPOSITION canvas is the largest-backing one. The editor chrome renders
// small canvases too (timeline sound-clip waveforms), so document order is not
// a stable way to find it.
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

const sleep = (milliseconds) => new Promise((settle) => setTimeout(settle, milliseconds));

// ---------------------------------------------------------------------------
// The fixture, and the stored records the run opens.

const fixtureFilm = JSON.parse(await readFile(fixturePath, 'utf8'));
if (fixtureFilm.scenes.length !== 2 || fixtureFilm.boundaries.length !== 1) {
	throw new Error(`${fixturePath} must be a two-Scene Film with one boundary.`);
}
if (fixtureFilm.scenes[0].state.surface.type === fixtureFilm.scenes[1].state.surface.type) {
	throw new Error(`${fixturePath} must hold two Scenes with different Surface types.`);
}

/** The fixture under one orientation, whole or cut down to one of its Scenes. */
function filmDocument(orientation, sceneIndex = null) {
	if (sceneIndex === null) {
		return { ...fixtureFilm, name: `Film cut ${orientation}`, orientation };
	}
	const scene = fixtureFilm.scenes[sceneIndex];
	return {
		...fixtureFilm,
		name: `Film cut ${orientation} ${scene.id} alone`,
		orientation,
		scenes: [scene],
		boundaries: []
	};
}

function filmSlug(orientation, sceneIndex = null) {
	return sceneIndex === null
		? `film-cut-${orientation}`
		: `film-cut-${orientation}-scene-${sceneIndex + 1}`;
}

/** Store one Film as the `{ meta, film }` record the disk store reads. */
async function writeStoredFilm(storeDirectory, slug, film) {
	await writeFile(
		join(storeDirectory, `${slug}.json`),
		JSON.stringify({ meta: { savedAt: new Date().toISOString() }, film })
	);
}

// Frame positions are worked out by the engine's own Film playhead, so the
// script and the Workspace cannot disagree about where the cut is.
const [, secondSceneOffset] = filmSceneFrameOffsets(fixtureFilm);
const firstSceneFrameCount = secondSceneOffset;
const secondSceneFrameCount = filmFrameCount(fixtureFilm) - secondSceneOffset;

/** The frames compared, as Film frames in the whole Film and Scene frames alone. */
const COMPARED_FRAMES = [
	{
		label: 'scene-1-mid',
		sceneIndex: 0,
		sceneFrame: Math.floor(firstSceneFrameCount / 2)
	},
	{ label: 'scene-1-last', sceneIndex: 0, sceneFrame: firstSceneFrameCount - 1 },
	{ label: 'scene-2-first', sceneIndex: 1, sceneFrame: 0 },
	{
		label: 'scene-2-mid',
		sceneIndex: 1,
		sceneFrame: Math.floor(secondSceneFrameCount / 2)
	}
].map((frame) => ({
	...frame,
	filmFrame: (frame.sceneIndex === 0 ? 0 : secondSceneOffset) + frame.sceneFrame
}));

// ---------------------------------------------------------------------------
// The app under measurement and the browser that reads it.

/**
 * The app runs from the jail's store and scratch directories on a port of its
 * own: this run must never reach the author's real compositions, and
 * `assertVerificationOriginAllowed` refuses the dev server's port outright.
 */
async function startJailedDevServer(jail) {
	assertVerificationOriginAllowed(origin);
	const child = spawn(
		'pnpm',
		['exec', 'vite', 'dev', '--port', String(SERVER_PORT), '--strictPort'],
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
 * Wait for the real thing: the composition canvas mounted at this
 * orientation's native size, the Film-time seam exposed, the route settled, and
 * the open Film's own name on the page. Reading a page that has not applied its
 * Film yet hashes whatever the tab was showing before.
 */
async function openStoredFilm(page, slug, film) {
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
					`CanvasDrawElement is unavailable on CDP port ${CDP_PORT}; the app hard-gates without it.`
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
 * Land Film time on one frame and read the canvas back: where the frame
 * landed, the SHA-256 of the canvas PNG, and how many distinct colours a small
 * downscale of it holds (1 means an empty or flat frame).
 */
async function captureFilmFrame(page, filmFrame) {
	return page.evaluate(`(() => {
		const capture = (async () => {
			const position = await window.__settleGfxFilmFrame(${filmFrame});
			const canvas = ${COMPOSITION_CANVAS};
			const blob = await new Promise((settle) => canvas.toBlob(settle, 'image/png'));
			if (!blob) throw new Error('The composition canvas presented nothing to read.');
			const bytes = await blob.arrayBuffer();
			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const sha256 = [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
			const sample = new OffscreenCanvas(96, 96);
			const context = sample.getContext('2d', { willReadFrequently: true });
			context.drawImage(canvas, 0, 0, 96, 96);
			const pixels = new Uint32Array(context.getImageData(0, 0, 96, 96).data.buffer);
			let pngBase64 = null;
			if (${SAVE_FRAMES}) {
				let binary = '';
				const view = new Uint8Array(bytes);
				for (let offset = 0; offset < view.length; offset += 0x8000) {
					binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
				}
				pngBase64 = btoa(binary);
			}
			return {
				sceneId: position.sceneId,
				sceneFrame: position.localFrame,
				sceneFrameCount: position.sceneFrameCount,
				width: canvas.width,
				height: canvas.height,
				sha256,
				sampleColorCount: new Set(pixels).size,
				pngBase64
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
}

async function captureAndRecord(page, orientation, source, label, filmFrame) {
	const { pngBase64, ...capture } = await captureFilmFrame(page, filmFrame);
	if (pngBase64 !== null) {
		await writeFile(
			join(OUTDIR, `${orientation}-${source}-${label}.png`),
			Buffer.from(pngBase64, 'base64')
		);
	}
	console.log(
		`  ${source.padEnd(13)} ${label.padEnd(20)} film frame ${String(filmFrame).padStart(4)} → ` +
			`${capture.sceneId} frame ${capture.sceneFrame}  ${capture.sha256.slice(0, 16)}  ` +
			`(${capture.sampleColorCount} sample colours)`
	);
	return { filmFrame, ...capture };
}

/** One orientation: the whole Film across its cut, then each Scene alone. */
async function compareOrientation(page, orientation) {
	console.log(`${orientation}:`);
	const wholeFilm = filmDocument(orientation);
	await openStoredFilm(page, filmSlug(orientation), wholeFilm);

	const inFilm = {};
	for (const frame of COMPARED_FRAMES) {
		inFilm[frame.label] = await captureAndRecord(
			page,
			orientation,
			'in-film',
			frame.label,
			frame.filmFrame
		);
	}
	// Back across the cut: the outgoing Scene must come back exactly, too.
	const lastOfFirstScene = COMPARED_FRAMES[1];
	const cutBack = await captureAndRecord(
		page,
		orientation,
		'in-film',
		`${lastOfFirstScene.label}-again`,
		lastOfFirstScene.filmFrame
	);

	const alone = {};
	for (const sceneIndex of [0, 1]) {
		await openStoredFilm(
			page,
			filmSlug(orientation, sceneIndex),
			filmDocument(orientation, sceneIndex)
		);
		for (const frame of COMPARED_FRAMES.filter(
			(candidate) => candidate.sceneIndex === sceneIndex
		)) {
			// A one-Scene Film's Film frame is its Scene frame.
			alone[frame.label] = await captureAndRecord(
				page,
				orientation,
				'scene-alone',
				frame.label,
				frame.sceneFrame
			);
		}
	}

	const comparisons = COMPARED_FRAMES.map((frame) => {
		const expectedSceneId = fixtureFilm.scenes[frame.sceneIndex].id;
		const film = inFilm[frame.label];
		const scene = alone[frame.label];
		const landed =
			film.sceneId === expectedSceneId &&
			film.sceneFrame === frame.sceneFrame &&
			scene.sceneFrame === frame.sceneFrame;
		return {
			label: frame.label,
			sceneId: expectedSceneId,
			sceneFrame: frame.sceneFrame,
			filmFrame: frame.filmFrame,
			inFilm: film,
			sceneAlone: scene,
			landedOnRequestedFrame: landed,
			matches: landed && film.sha256 === scene.sha256
		};
	});
	comparisons.push({
		label: `${lastOfFirstScene.label}-again`,
		sceneId: fixtureFilm.scenes[0].id,
		sceneFrame: lastOfFirstScene.sceneFrame,
		filmFrame: lastOfFirstScene.filmFrame,
		inFilm: cutBack,
		sceneAlone: alone[lastOfFirstScene.label],
		landedOnRequestedFrame: cutBack.sceneFrame === lastOfFirstScene.sceneFrame,
		matches: cutBack.sha256 === alone[lastOfFirstScene.label].sha256
	});
	return { orientation, comparisons };
}

// ---------------------------------------------------------------------------

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-cut-frames');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
for (const orientation of ORIENTATIONS) {
	await writeStoredFilm(
		jail.compositionStoreDirectory,
		filmSlug(orientation),
		filmDocument(orientation)
	);
	for (const sceneIndex of [0, 1]) {
		await writeStoredFilm(
			jail.compositionStoreDirectory,
			filmSlug(orientation, sceneIndex),
			filmDocument(orientation, sceneIndex)
		);
	}
}

const report = {
	fixture: 'scripts/fixtures/film-cut-frames/two-scene-cut.film.json',
	fps: fixtureFilm.fps,
	scenes: fixtureFilm.scenes.map((scene, sceneIndex) => ({
		id: scene.id,
		surfaceType: scene.state.surface.type,
		frameCount: sceneIndex === 0 ? firstSceneFrameCount : secondSceneFrameCount,
		firstFilmFrame: sceneIndex === 0 ? 0 : secondSceneOffset
	})),
	orientations: [],
	failures: [],
	passed: false
};

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

	for (const orientation of ORIENTATIONS) {
		// One retry from a fresh tab: the dev server's dependency optimiser can
		// reload a page mid-capture the first time a Scene's renderers load.
		let lastError = null;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				if (attempt > 0) {
					await page.close().catch(() => undefined);
					page = await openCdpPage();
				}
				report.orientations.push(await compareOrientation(page, orientation));
				lastError = null;
				break;
			} catch (error) {
				lastError = error;
			}
		}
		if (lastError !== null) {
			const message = lastError instanceof Error ? lastError.message : String(lastError);
			report.failures.push({ orientation, label: null, reason: message });
			console.log(`  FAIL ${orientation}: ${message}`);
		}
	}
} finally {
	await page?.close().catch(() => undefined);
	await server?.stop();
	await jail.dispose();
}

for (const { orientation, comparisons } of report.orientations) {
	for (const comparison of comparisons) {
		if (comparison.matches) continue;
		report.failures.push({
			orientation,
			label: comparison.label,
			reason: comparison.landedOnRequestedFrame
				? `Pixels differ: in the Film ${comparison.inFilm.sha256}, alone ${comparison.sceneAlone.sha256}.`
				: `The seek landed on ${comparison.inFilm.sceneId} frame ${comparison.inFilm.sceneFrame}, not ${comparison.sceneId} frame ${comparison.sceneFrame}.`
		});
	}
}
report.passed = report.failures.length === 0 && report.orientations.length === ORIENTATIONS.length;

const reportJson = `${JSON.stringify(report, null, '\t')}\n`;
await writeFile(join(OUTDIR, 'report.json'), reportJson);
console.log(reportJson);
if (!report.passed) {
	console.error(
		`Film cut frames: ${report.failures.length} failure(s). See ${join(OUTDIR, 'report.json')}.`
	);
	process.exit(1);
}
console.log('Film cut frames: every frame across the cut matches its Scene opened alone.');
process.exit(0);
