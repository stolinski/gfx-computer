// The look of the four transition effects and the fade as Film boundaries, on
// two live Scenes, for a person to judge (ADR-0068 §4).
//
// Builds a two-Scene Film of two full-frame, opaque corpus Presets that both
// move through the boundary window, once per boundary kind, opens each in the
// real Workspace, pauses the Film playhead at window progress 0.15, 0.35, 0.5,
// 0.65, and 0.85, horizontal, and writes each canvas as
// `<effect>-<progress>.png`. A paused playhead inside a boundary window shows
// the exact frame: both Scenes live at their own frames, composited by the
// boundary's effect on the GPU, the same path export takes.
//
// The two Scenes:
//   - outgoing: `headline-hands-on`. Its Stage camera travels for the whole
//     Scene, and its dimensional type exits at 0.88–0.98 of the Scene, inside
//     the last second, which is the window.
//   - incoming: `title-sequence-signal`. Its Surface enters at 0–0.05 and its
//     kicker and title animate from 0.06, inside the first second.
//
// The boundary kinds are `fade` and every effect in the live transition
// registry, each at its own default params.
//
// It checks nothing. It fails only when a frame could not be captured. The
// proof is `cdp-film-fade-tracer.mjs`.
//
//   node --experimental-strip-types scripts/cdp-capture-film-boundary-effect-frames.mjs
//
// One invocation, no interactive tooling: its own jailed dev server on a port
// of its own, the Films stored in the jail, and the sanctioned
// CanvasDrawElement Chrome through scripts/launch-cdp-chrome.sh (canvas mode).
// Environment: GFX_FILM_BOUNDARY_EFFECTS_PORT (server, default 7298), CDP_PORT
// (default 9223), GFX_FILM_BOUNDARY_EFFECTS_OUTDIR (default
// .tmp-baselines/film-boundary-effects). Node 22+ (built-in fetch/WebSocket);
// needs pnpm and Chrome.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
	boundaryWindowFrameNearProgress,
	boundaryWindowOfTwoSceneFilm,
	captureFilmFramePng,
	confirmCanvasChrome,
	openCdpPage,
	openStoredFilm,
	repositoryRoot,
	startJailedDevServer,
	transitionEffectBoundaries,
	writeStoredFilm
} from './cdp-film-fade-session.mjs';
import { createVerificationServerJail } from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_FILM_BOUNDARY_EFFECTS_PORT ?? 7298);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_BOUNDARY_EFFECTS_OUTDIR ?? '.tmp-baselines/film-boundary-effects'
);

const OUTGOING_PRESET_SLUG = 'headline-hands-on';
const INCOMING_PRESET_SLUG = 'title-sequence-signal';
const ORIENTATION = 'horizontal';
const WINDOW_DURATION_MS = 1000;
const WANTED_PROGRESS = [0.15, 0.35, 0.5, 0.65, 0.85];

async function readCorpusPreset(slug) {
	return JSON.parse(
		await readFile(join(repositoryRoot, 'src/lib/presets', `${slug}.json`), 'utf8')
	);
}

const outgoingPreset = await readCorpusPreset(OUTGOING_PRESET_SLUG);
const incomingPreset = await readCorpusPreset(INCOMING_PRESET_SLUG);
for (const [slug, preset] of [
	[OUTGOING_PRESET_SLUG, outgoingPreset],
	[INCOMING_PRESET_SLUG, incomingPreset]
]) {
	if (preset.kind !== undefined && preset.kind !== 'deliverable') {
		throw new Error(`${slug} is not a deliverable Preset.`);
	}
	if (preset.state.backgroundFill === undefined) {
		throw new Error(`${slug} declares no backgroundFill, so it is not a full-frame Scene.`);
	}
}

/** The two Scenes under one boundary; the Film takes the outgoing Preset's Pack and rate. */
function filmWithBoundary(boundary) {
	return {
		schema: 'gfx-film@1',
		name: `Film boundary ${boundary.kind}`,
		pack: outgoingPreset.pack,
		orientation: ORIENTATION,
		fps: outgoingPreset.state.transport.fps,
		format: outgoingPreset.state.transport.format,
		scenes: [
			{
				id: 'outgoing',
				name: outgoingPreset.name,
				origin: { slug: OUTGOING_PRESET_SLUG, contentKey: null },
				state: outgoingPreset.state
			},
			{
				id: 'incoming',
				name: incomingPreset.name,
				origin: { slug: INCOMING_PRESET_SLUG, contentKey: null },
				state: incomingPreset.state
			}
		],
		boundaries: [boundary]
	};
}

const boundaries = [
	...(await transitionEffectBoundaries(WINDOW_DURATION_MS)),
	{ kind: 'fade', durationMs: WINDOW_DURATION_MS }
];
const films = boundaries.map((boundary) => ({
	boundary,
	slug: `film-boundary-${boundary.kind}`,
	film: filmWithBoundary(boundary)
}));

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-boundary-effects');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
for (const { slug, film } of films) {
	await writeStoredFilm(jail.compositionStoreDirectory, slug, film);
}

const captured = [];
let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail, SERVER_PORT);
	confirmCanvasChrome(CDP_PORT);
	page = await openCdpPage(CDP_PORT);

	for (const { boundary, slug, film } of films) {
		console.log(`${boundary.kind}:`);
		const window = boundaryWindowOfTwoSceneFilm(film);
		await openStoredFilm(page, server.origin, slug, film);
		for (const wantedProgress of WANTED_PROGRESS) {
			const frame = boundaryWindowFrameNearProgress(window, wantedProgress);
			const capture = await captureFilmFramePng(page, frame.filmFrame);
			if (capture.boundaryWindow === null) {
				throw new Error(
					`Film frame ${frame.filmFrame} did not land inside the ${boundary.kind} window (${window.frameCount} frames from Film frame ${window.startFilmFrame}).`
				);
			}
			const file = `${boundary.kind}-${wantedProgress.toFixed(2)}.png`;
			await writeFile(join(OUTDIR, file), capture.png);
			captured.push({
				kind: boundary.kind,
				file,
				filmFrame: frame.filmFrame,
				wantedProgress,
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
	`${JSON.stringify(
		{
			outgoing: OUTGOING_PRESET_SLUG,
			incoming: INCOMING_PRESET_SLUG,
			orientation: ORIENTATION,
			windowDurationMs: WINDOW_DURATION_MS,
			boundaries,
			frames: captured
		},
		null,
		'\t'
	)}\n`
);
console.log(`Film boundary effect frames: ${captured.length} PNGs in ${OUTDIR}.`);
process.exit(0);
