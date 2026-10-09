// The look of a Film fade, for a person to judge (ADR-0068 §4).
//
// Opens the two-Scene fade fixture in the real Workspace, pauses the Film
// playhead at window progress 0, 0.25, 0.5, 0.75, and 1, in both orientations,
// and writes each canvas as a PNG. A paused playhead inside a boundary window
// shows the exact frame: both Scenes live at their own frames, cross-faded on
// the GPU, the same path export takes.
//
// It checks nothing. It fails only when a frame could not be captured. The
// proof that the blend is right is `cdp-film-fade-tracer.mjs`.
//
//   node --experimental-strip-types scripts/cdp-capture-film-fade-frames.mjs
//
// One invocation, no interactive tooling: its own jailed dev server on a port
// of its own, the fixture stored in the jail, and the sanctioned
// CanvasDrawElement Chrome through scripts/launch-cdp-chrome.sh (canvas mode).
// Environment: GFX_FILM_FADE_PORT (server, default 7297), CDP_PORT (default
// 9223), GFX_FILM_FADE_FRAMES_OUTDIR (default .tmp-baselines/film-fade-frames).
// Node 22+ (built-in fetch/WebSocket); needs pnpm and Chrome.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
	FILM_FADE_FIXTURE_PATH,
	ORIENTATIONS,
	captureFilmFramePng,
	confirmCanvasChrome,
	filmDocument,
	filmSlug,
	fixtureWindow,
	openCdpPage,
	openStoredFilm,
	repositoryRoot,
	startJailedDevServer,
	windowFrameNearProgress,
	writeStoredFilm
} from './cdp-film-fade-session.mjs';
import { createVerificationServerJail } from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_FILM_FADE_PORT ?? 7297);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_FADE_FRAMES_OUTDIR ?? '.tmp-baselines/film-fade-frames'
);

const WANTED_PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const frames = WANTED_PROGRESS.map(windowFrameNearProgress);

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-fade-frames');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
for (const orientation of ORIENTATIONS) {
	await writeStoredFilm(
		jail.compositionStoreDirectory,
		filmSlug(orientation),
		filmDocument(orientation)
	);
}

const captured = [];
let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail, SERVER_PORT);
	confirmCanvasChrome(CDP_PORT);
	page = await openCdpPage(CDP_PORT);

	for (const orientation of ORIENTATIONS) {
		console.log(`${orientation}:`);
		await openStoredFilm(page, server.origin, filmSlug(orientation), filmDocument(orientation));
		for (const frame of frames) {
			const capture = await captureFilmFramePng(page, frame.filmFrame);
			if (capture.boundaryWindow === null) {
				throw new Error(
					`Film frame ${frame.filmFrame} did not land inside the fade window (${fixtureWindow.frameCount} frames from Film frame ${fixtureWindow.startFilmFrame}).`
				);
			}
			const file = `${orientation}-progress-${String(Math.round(frame.wantedProgress * 100)).padStart(3, '0')}.png`;
			await writeFile(join(OUTDIR, file), capture.png);
			captured.push({
				orientation,
				file,
				filmFrame: frame.filmFrame,
				wantedProgress: frame.wantedProgress,
				...capture.boundaryWindow
			});
			console.log(
				`  ${file}  film frame ${frame.filmFrame}, window frame ${capture.boundaryWindow.windowFrame} of ${capture.boundaryWindow.windowFrameCount}, ` +
					`progress ${capture.boundaryWindow.progress.toFixed(3)}  ` +
					`(${capture.boundaryWindow.outgoingSceneId} frame ${capture.boundaryWindow.outgoingSceneFrame} + ` +
					`${capture.boundaryWindow.incomingSceneId} frame ${capture.boundaryWindow.incomingSceneFrame})`
			);
		}
	}
} finally {
	await page?.close().catch(() => undefined);
	await server?.stop();
	await jail.dispose();
}

await writeFile(
	join(OUTDIR, 'frames.json'),
	`${JSON.stringify({ fixture: FILM_FADE_FIXTURE_PATH, frames: captured }, null, '\t')}\n`
);
console.log(`Film fade frames: ${captured.length} PNGs in ${OUTDIR}.`);
process.exit(0);
