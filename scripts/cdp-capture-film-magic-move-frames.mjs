// The look of a magic move, for a person to judge (ADR-0068 §5).
//
// Opens the two-Scene magic-move fixture in the real Workspace: two full-frame
// Scenes (`outro-watch-next` and `title-card-brand-mark`) that share one
// lower-third Overlay, small at the bottom left of the first and larger at the
// top of the second, with a one-second fade that carries it. It pauses the Film
// playhead at window progress 0, 0.2, 0.4, 0.5, 0.6, 0.8, and 1, in both
// orientations, and writes each canvas as a PNG. It then does the same with the
// pair taken off the boundary, so the same seven frames of the plain fade sit
// beside them.
//
// It checks nothing. It fails only when a frame could not be captured. The
// proof is `cdp-film-magic-move-tracer.mjs`.
//
//   node --experimental-strip-types scripts/cdp-capture-film-magic-move-frames.mjs
//
// One invocation, no interactive tooling: its own jailed dev server on a port
// of its own, the fixture stored in the jail, and the sanctioned
// CanvasDrawElement Chrome through scripts/launch-cdp-chrome.sh (canvas mode).
// Environment: GFX_FILM_MAGIC_MOVE_PORT (server, default 7301), CDP_PORT
// (default 9223), GFX_FILM_MAGIC_MOVE_FRAMES_OUTDIR (default
// .tmp-baselines/film-magic-move). Node 22+ (built-in fetch/WebSocket); needs
// pnpm and Chrome.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
	ORIENTATIONS,
	captureFilmFramePng,
	confirmCanvasChrome,
	openCdpPage,
	openStoredFilm,
	repositoryRoot,
	startJailedDevServer,
	writeStoredFilm
} from './cdp-film-fade-session.mjs';
import {
	FILM_MAGIC_MOVE_FIXTURE_PATH,
	filmDocument,
	filmSlug,
	fixtureWindow,
	windowFrameNearProgress
} from './cdp-film-magic-move-session.mjs';
import { createVerificationServerJail } from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_FILM_MAGIC_MOVE_PORT ?? 7301);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_MAGIC_MOVE_FRAMES_OUTDIR ?? '.tmp-baselines/film-magic-move'
);

const FORMS = ['magic-move', 'plain-fade'];
const frames = [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1].map(windowFrameNearProgress);

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-magic-move-frames');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
for (const orientation of ORIENTATIONS) {
	for (const form of FORMS) {
		await writeStoredFilm(
			jail.compositionStoreDirectory,
			filmSlug({ orientation, form }),
			filmDocument({ orientation, form })
		);
	}
}

const captured = [];
let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail, SERVER_PORT);
	confirmCanvasChrome(CDP_PORT);
	page = await openCdpPage(CDP_PORT);

	for (const orientation of ORIENTATIONS) {
		for (const form of FORMS) {
			console.log(`${orientation} ${form}:`);
			await openStoredFilm(
				page,
				server.origin,
				filmSlug({ orientation, form }),
				filmDocument({ orientation, form })
			);
			for (const frame of frames) {
				const capture = await captureFilmFramePng(page, frame.filmFrame);
				if (capture.boundaryWindow === null) {
					throw new Error(
						`Film frame ${frame.filmFrame} did not land inside the window (${fixtureWindow.frameCount} frames from Film frame ${fixtureWindow.startFilmFrame}).`
					);
				}
				const file = `${orientation}-${form}-${frame.label}.png`;
				await writeFile(join(OUTDIR, file), capture.png);
				captured.push({
					orientation,
					form,
					file,
					filmFrame: frame.filmFrame,
					wantedProgress: frame.wantedProgress,
					...capture.boundaryWindow,
					magicMoveQuads: capture.magicMoveQuads
				});
				console.log(
					`  ${file}  film frame ${frame.filmFrame}, progress ${capture.boundaryWindow.progress.toFixed(3)}, ${capture.magicMoveQuads.length} quad(s)`
				);
			}
		}
	}
} finally {
	await page?.close().catch(() => undefined);
	await server?.stop();
	await jail.dispose();
}

await writeFile(
	join(OUTDIR, 'frames.json'),
	`${JSON.stringify({ fixture: FILM_MAGIC_MOVE_FIXTURE_PATH, frames: captured }, null, '\t')}\n`
);
console.log(`Film magic-move frames: ${captured.length} PNGs in ${OUTDIR}.`);
process.exit(0);
