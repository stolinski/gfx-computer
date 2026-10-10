// The proof of a Film boundary with a window (ADR-0068 §4). For the fade: a
// paused Film frame inside the window is the cross-fade of its two Scenes, each
// live at its own frame. For the fade and every registered transition effect:
// the window's first frame is the outgoing Scene, its last is the incoming
// Scene, the frames just outside it are untouched, and one Film frame captured
// twice, with a seek away between, is the same pixels.
//
// A transition effect's frames strictly inside its window are NOT compared
// with an offline reference: there is none. Its shader is the only statement
// of what a mid-window frame is, so re-deriving it here would prove this
// script against itself. What is held for an effect is what can be held
// honestly: its two ends, its outside, and that it is repeatable. How an
// effect looks mid-window is for a person
// (`cdp-capture-film-boundary-effect-frames.mjs`).
//
// For the two-Scene fade fixture, in both orientations, it captures:
//
//   - in the Film, the paused frame at window progress 0, 0.25, 0.5, 0.75, 1,
//     and the frame just before the window and the frame just after it;
//   - each Scene opened alone, at the Scene frame each of those Film frames
//     puts it on;
//   - in the same Film with each registered transition effect in place of the
//     fade, at that effect's default params and the fade's own duration: the
//     paused frame at window progress 0 and 1, the frames just before and just
//     after the window, and the frame at progress 0.5 twice.
//
// It then blends the two Scenes-alone captures offline, `out × (1 − p) + in × p`
// on premultiplied 8-bit values (`src/lib/utils/premultiplied-cross-fade.ts`,
// the reference the GPU blend is written from), and compares the result with
// the Film frame, channel by channel. The canvas PNG is straight-alpha; it is
// premultiplied again first, which recovers the canvas's 8-bit premultiplied
// values exactly.
//
// Tolerance. The Scene targets and the canvas are 8 bits a channel.
//   - Progress 0 and 1, and the frames just outside the window: exact. The
//     blend pass returns the outgoing or the incoming texel untouched there,
//     and outside the window nothing is blended at all.
//   - Progress strictly between 0 and 1: at most 1 level of 255 on any channel.
//     The GPU blends in 32-bit float and rounds to 8 bits by its own rule; this
//     script blends in 64-bit float and rounds half up. A blend that lands
//     within float error of a half level can round either way, and by no more
//     than one level. Exact equality is the goal, and the report states how
//     many channel values differed at all (`differingChannels`) so a real
//     defect cannot hide inside the tolerance.
//   - Every transition effect at progress 0 and 1, and its frames outside the
//     window: exact, for the same reason (the shared compiler returns the
//     from-texel at progress 0 and the to-texel at progress 1 before any
//     effect's own code runs).
//   - One Film frame captured twice: exact, for the fade and every effect.
//
//   node --experimental-strip-types scripts/cdp-film-fade-tracer.mjs
//
// One invocation, no interactive tooling: its own jailed dev server, the
// fixture and each of its Scenes stored in the jail as Films, and the
// sanctioned CanvasDrawElement Chrome (canvas mode). Prints a JSON report,
// writes it to <out>/report.json, and exits 1 on any mismatch. Environment:
// GFX_FILM_FADE_PORT (server, default 7297), CDP_PORT (default 9223),
// GFX_FILM_FADE_TRACER_OUTDIR (default .tmp-baselines/film-fade-tracer),
// GFX_FILM_FADE_SAVE_FRAMES=1 to also write every captured frame as a PNG.
// Node 22+ (built-in fetch/WebSocket); needs pnpm and Chrome.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PNG } from 'pngjs';

import {
	crossFadePremultipliedRgba8,
	premultiplyStraightRgba8
} from '../src/lib/utils/premultiplied-cross-fade.ts';
import {
	FILM_FADE_FIXTURE_PATH,
	ORIENTATIONS,
	captureFilmFramePng,
	confirmCanvasChrome,
	filmDocument,
	filmSlug,
	fixtureFadeBoundary,
	fixtureFilm,
	fixtureWindow,
	openCdpPage,
	openStoredFilm,
	repositoryRoot,
	startJailedDevServer,
	transitionEffectBoundaries,
	windowFrameNearProgress,
	writeStoredFilm
} from './cdp-film-fade-session.mjs';
import { createVerificationServerJail } from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_FILM_FADE_PORT ?? 7297);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_FADE_TRACER_OUTDIR ?? '.tmp-baselines/film-fade-tracer'
);
const SAVE_FRAMES = process.env.GFX_FILM_FADE_SAVE_FRAMES === '1';

/** Levels of 255 a blended channel may differ by, strictly inside the window. */
const BLEND_TOLERANCE_LEVELS = 1;

const OUTGOING = 0;
const INCOMING = 1;

/** The Film frames inside the window that are compared with an offline blend. */
const WINDOW_FRAMES = [0, 0.25, 0.5, 0.75, 1].map((wantedProgress) => ({
	label: `progress-${String(Math.round(wantedProgress * 100)).padStart(3, '0')}`,
	...windowFrameNearProgress(wantedProgress)
}));

/** The Film frames just outside the window: one Scene alone, untouched. */
const OUTSIDE_FRAMES = [
	{
		label: 'before-window',
		filmFrame: fixtureWindow.startFilmFrame - 1,
		sceneIndex: OUTGOING,
		sceneFrame: fixtureWindow.outgoingSceneFrameCount - fixtureWindow.frameCount - 1
	},
	{
		label: 'after-window',
		filmFrame: fixtureWindow.startFilmFrame + fixtureWindow.frameCount,
		sceneIndex: INCOMING,
		sceneFrame: fixtureWindow.frameCount
	}
];
for (const frame of OUTSIDE_FRAMES) {
	if (frame.filmFrame < 0 || frame.filmFrame >= fixtureWindow.filmFrameCount) {
		throw new Error(`${FILM_FADE_FIXTURE_PATH} leaves no frame ${frame.label}.`);
	}
}

/** Every registered transition effect as the fixture's boundary, with the fade's own duration. */
const EFFECT_BOUNDARIES = await transitionEffectBoundaries(fixtureFadeBoundary.durationMs);

/** The window's two ends: the outgoing Scene alone and the incoming Scene alone. */
const ENDPOINT_FRAMES = [
	{ ...WINDOW_FRAMES[0], sceneIndex: OUTGOING, expectedProgress: 0 },
	{ ...WINDOW_FRAMES[WINDOW_FRAMES.length - 1], sceneIndex: INCOMING, expectedProgress: 1 }
];
/** The mid-window frame that is captured twice. */
const REPEATED_FRAME = WINDOW_FRAMES.find((frame) => frame.wantedProgress === 0.5);

/** A canvas PNG as premultiplied 8-bit RGBA, the values the canvas held. */
function premultipliedPixels(capture) {
	const decoded = PNG.sync.read(capture.png);
	return {
		width: decoded.width,
		height: decoded.height,
		pixels: premultiplyStraightRgba8(decoded.data)
	};
}

/** How two premultiplied pictures differ: the largest channel difference and how many differ. */
function comparePixels(actual, expected) {
	if (actual.width !== expected.width || actual.height !== expected.height) {
		return {
			sameSize: false,
			maxChannelDifference: null,
			differingChannels: null,
			channelCount: actual.pixels.length
		};
	}
	let maxChannelDifference = 0;
	let differingChannels = 0;
	for (let offset = 0; offset < actual.pixels.length; offset += 1) {
		const difference = Math.abs(actual.pixels[offset] - expected.pixels[offset]);
		if (difference === 0) continue;
		differingChannels += 1;
		if (difference > maxChannelDifference) maxChannelDifference = difference;
	}
	return {
		sameSize: true,
		maxChannelDifference,
		differingChannels,
		channelCount: actual.pixels.length
	};
}

/** How many distinct colours a picture holds, counted on a coarse grid; 1 is a flat frame. */
function sampleColorCount({ width, height, pixels }) {
	const colors = new Set();
	for (let row = 0; row < 96; row += 1) {
		for (let column = 0; column < 96; column += 1) {
			const x = Math.floor(((column + 0.5) * width) / 96);
			const y = Math.floor(((row + 0.5) * height) / 96);
			const offset = (y * width + x) * 4;
			colors.add(
				`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`
			);
		}
	}
	return colors.size;
}

async function saveFrame(orientation, source, label, capture) {
	if (!SAVE_FRAMES) return;
	await writeFile(join(OUTDIR, `${orientation}-${source}-${label}.png`), capture.png);
}

/** One orientation: the Film across its window, then each Scene alone, then the comparisons. */
async function traceOrientation(page, origin, orientation) {
	console.log(`${orientation}:`);
	await openStoredFilm(page, origin, filmSlug(orientation), filmDocument(orientation));
	const inFilm = new Map();
	for (const frame of [...WINDOW_FRAMES, ...OUTSIDE_FRAMES]) {
		const capture = await captureFilmFramePng(page, frame.filmFrame);
		await saveFrame(orientation, 'in-film', frame.label, capture);
		inFilm.set(frame.label, capture);
		console.log(`  in-film      ${frame.label.padEnd(14)} film frame ${frame.filmFrame}`);
	}

	// Each Scene alone, at every Scene frame a compared Film frame puts it on.
	const sceneFrames = [
		[
			...WINDOW_FRAMES.map((frame) => frame.outgoingSceneFrame),
			...OUTSIDE_FRAMES.filter((frame) => frame.sceneIndex === OUTGOING).map(
				(frame) => frame.sceneFrame
			)
		],
		[
			...WINDOW_FRAMES.map((frame) => frame.incomingSceneFrame),
			...OUTSIDE_FRAMES.filter((frame) => frame.sceneIndex === INCOMING).map(
				(frame) => frame.sceneFrame
			)
		]
	];
	const alone = [new Map(), new Map()];
	for (const sceneIndex of [OUTGOING, INCOMING]) {
		await openStoredFilm(
			page,
			origin,
			filmSlug(orientation, sceneIndex),
			filmDocument(orientation, sceneIndex)
		);
		for (const sceneFrame of [...new Set(sceneFrames[sceneIndex])]) {
			// A one-Scene Film's Film frame is its Scene frame.
			const capture = await captureFilmFramePng(page, sceneFrame);
			await saveFrame(orientation, `scene-${sceneIndex + 1}-alone`, `frame-${sceneFrame}`, capture);
			alone[sceneIndex].set(sceneFrame, premultipliedPixels(capture));
			console.log(`  scene-alone  ${fixtureFilm.scenes[sceneIndex].id} frame ${sceneFrame}`);
		}
	}

	const comparisons = [];
	for (const frame of WINDOW_FRAMES) {
		const capture = inFilm.get(frame.label);
		const landed = capture.boundaryWindow;
		const landedOnRequestedFrame =
			landed !== null &&
			landed.windowFrame === frame.windowFrame &&
			landed.windowFrameCount === fixtureWindow.frameCount &&
			landed.outgoingSceneId === fixtureFilm.scenes[OUTGOING].id &&
			landed.outgoingSceneFrame === frame.outgoingSceneFrame &&
			landed.incomingSceneId === fixtureFilm.scenes[INCOMING].id &&
			landed.incomingSceneFrame === frame.incomingSceneFrame;
		const progress = landed?.progress ?? null;
		const outgoing = alone[OUTGOING].get(frame.outgoingSceneFrame);
		const incoming = alone[INCOMING].get(frame.incomingSceneFrame);
		const filmPixels = premultipliedPixels(capture);
		const isEndpoint = progress === 0 || progress === 1;
		const toleranceLevels = isEndpoint ? 0 : BLEND_TOLERANCE_LEVELS;
		const blend =
			progress === null || outgoing.pixels.length !== incoming.pixels.length
				? null
				: comparePixels(filmPixels, {
						width: outgoing.width,
						height: outgoing.height,
						pixels: crossFadePremultipliedRgba8(outgoing.pixels, incoming.pixels, progress)
					});
		comparisons.push({
			label: frame.label,
			kind: 'blend',
			filmFrame: frame.filmFrame,
			wantedProgress: frame.wantedProgress,
			progress,
			landed,
			landedOnRequestedFrame,
			toleranceLevels,
			blend,
			// A fade between two flat frames agrees without proving anything.
			outgoingSampleColorCount: sampleColorCount(outgoing),
			incomingSampleColorCount: sampleColorCount(incoming),
			matches:
				landedOnRequestedFrame &&
				blend !== null &&
				blend.sameSize &&
				blend.maxChannelDifference <= toleranceLevels
		});
	}
	for (const frame of OUTSIDE_FRAMES) {
		const capture = inFilm.get(frame.label);
		const landedOnRequestedFrame =
			capture.boundaryWindow === null &&
			capture.sceneId === fixtureFilm.scenes[frame.sceneIndex].id &&
			capture.sceneFrame === frame.sceneFrame;
		const untouched = comparePixels(
			premultipliedPixels(capture),
			alone[frame.sceneIndex].get(frame.sceneFrame)
		);
		comparisons.push({
			label: frame.label,
			kind: 'untouched',
			filmFrame: frame.filmFrame,
			sceneId: fixtureFilm.scenes[frame.sceneIndex].id,
			sceneFrame: frame.sceneFrame,
			landed: { sceneId: capture.sceneId, sceneFrame: capture.sceneFrame },
			landedOnRequestedFrame,
			toleranceLevels: 0,
			blend: untouched,
			matches: landedOnRequestedFrame && untouched.sameSize && untouched.maxChannelDifference === 0
		});
	}
	// The fade, captured again after every other seek above: the same pixels.
	const fadeRepeat = await captureFilmFramePngAgain(page, origin, orientation, fixtureFadeBoundary);
	comparisons.push(
		repeatComparison(
			fixtureFadeBoundary,
			premultipliedPixels(inFilm.get(REPEATED_FRAME.label)),
			fadeRepeat
		)
	);

	for (const boundary of EFFECT_BOUNDARIES) {
		comparisons.push(...(await traceEffectBoundary(page, origin, orientation, boundary, alone)));
	}
	return { orientation, comparisons };
}

/** Open the fixture under `boundary` afresh and capture the repeated mid-window frame. */
async function captureFilmFramePngAgain(page, origin, orientation, boundary) {
	await openStoredFilm(
		page,
		origin,
		filmSlug(orientation, null, boundary),
		filmDocument(orientation, null, boundary)
	);
	const capture = await captureFilmFramePng(page, REPEATED_FRAME.filmFrame);
	await saveFrame(
		orientation,
		`in-film-${boundary.kind}`,
		`${REPEATED_FRAME.label}-again`,
		capture
	);
	return premultipliedPixels(capture);
}

function repeatComparison(boundary, first, second) {
	const repeat = comparePixels(second, first);
	return {
		label: `${boundary.kind}-${REPEATED_FRAME.label}-twice`,
		kind: 'repeat',
		boundaryKind: boundary.kind,
		filmFrame: REPEATED_FRAME.filmFrame,
		landedOnRequestedFrame: true,
		toleranceLevels: 0,
		blend: repeat,
		matches: repeat.sameSize && repeat.maxChannelDifference === 0
	};
}

/**
 * One transition effect in place of the fade: its two ends against each Scene
 * alone, the frames outside its window against each Scene alone, and its
 * mid-window frame against itself after a seek away and back.
 */
async function traceEffectBoundary(page, origin, orientation, boundary, alone) {
	console.log(`  ${boundary.kind}:`);
	await openStoredFilm(
		page,
		origin,
		filmSlug(orientation, null, boundary),
		filmDocument(orientation, null, boundary)
	);
	const capture = async (label, filmFrame) => {
		const captured = await captureFilmFramePng(page, filmFrame);
		await saveFrame(orientation, `in-film-${boundary.kind}`, label, captured);
		console.log(`    in-film    ${label.padEnd(18)} film frame ${filmFrame}`);
		return captured;
	};

	const comparisons = [];
	// Mid-window first; every capture after it is a seek away.
	const firstMidWindow = premultipliedPixels(
		await capture(REPEATED_FRAME.label, REPEATED_FRAME.filmFrame)
	);
	for (const frame of ENDPOINT_FRAMES) {
		const captured = await capture(frame.label, frame.filmFrame);
		const landed = captured.boundaryWindow;
		const landedOnRequestedFrame =
			landed !== null &&
			landed.windowFrame === frame.windowFrame &&
			landed.progress === frame.expectedProgress &&
			landed.outgoingSceneFrame === frame.outgoingSceneFrame &&
			landed.incomingSceneFrame === frame.incomingSceneFrame;
		const sceneFrame =
			frame.sceneIndex === OUTGOING ? frame.outgoingSceneFrame : frame.incomingSceneFrame;
		const endpoint = comparePixels(
			premultipliedPixels(captured),
			alone[frame.sceneIndex].get(sceneFrame)
		);
		comparisons.push({
			label: `${boundary.kind}-${frame.label}`,
			kind: 'endpoint',
			boundaryKind: boundary.kind,
			filmFrame: frame.filmFrame,
			sceneId: fixtureFilm.scenes[frame.sceneIndex].id,
			sceneFrame,
			progress: landed?.progress ?? null,
			landed,
			landedOnRequestedFrame,
			toleranceLevels: 0,
			blend: endpoint,
			matches: landedOnRequestedFrame && endpoint.sameSize && endpoint.maxChannelDifference === 0
		});
	}
	for (const frame of OUTSIDE_FRAMES) {
		const captured = await capture(frame.label, frame.filmFrame);
		const landedOnRequestedFrame =
			captured.boundaryWindow === null &&
			captured.sceneId === fixtureFilm.scenes[frame.sceneIndex].id &&
			captured.sceneFrame === frame.sceneFrame;
		const untouched = comparePixels(
			premultipliedPixels(captured),
			alone[frame.sceneIndex].get(frame.sceneFrame)
		);
		comparisons.push({
			label: `${boundary.kind}-${frame.label}`,
			kind: 'untouched',
			boundaryKind: boundary.kind,
			filmFrame: frame.filmFrame,
			sceneId: fixtureFilm.scenes[frame.sceneIndex].id,
			sceneFrame: frame.sceneFrame,
			landed: { sceneId: captured.sceneId, sceneFrame: captured.sceneFrame },
			landedOnRequestedFrame,
			toleranceLevels: 0,
			blend: untouched,
			matches: landedOnRequestedFrame && untouched.sameSize && untouched.maxChannelDifference === 0
		});
	}
	const secondMidWindow = premultipliedPixels(
		await capture(`${REPEATED_FRAME.label}-again`, REPEATED_FRAME.filmFrame)
	);
	comparisons.push(repeatComparison(boundary, firstMidWindow, secondMidWindow));
	return comparisons;
}

// ---------------------------------------------------------------------------

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-fade-tracer');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
for (const orientation of ORIENTATIONS) {
	await writeStoredFilm(
		jail.compositionStoreDirectory,
		filmSlug(orientation),
		filmDocument(orientation)
	);
	for (const sceneIndex of [OUTGOING, INCOMING]) {
		await writeStoredFilm(
			jail.compositionStoreDirectory,
			filmSlug(orientation, sceneIndex),
			filmDocument(orientation, sceneIndex)
		);
	}
	for (const boundary of EFFECT_BOUNDARIES) {
		await writeStoredFilm(
			jail.compositionStoreDirectory,
			filmSlug(orientation, null, boundary),
			filmDocument(orientation, null, boundary)
		);
	}
}

const report = {
	fixture: FILM_FADE_FIXTURE_PATH,
	fps: fixtureFilm.fps,
	window: fixtureWindow,
	blendToleranceLevels: BLEND_TOLERANCE_LEVELS,
	effectBoundaries: EFFECT_BOUNDARIES,
	orientations: [],
	failures: [],
	passed: false
};

let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail, SERVER_PORT);
	confirmCanvasChrome(CDP_PORT);
	page = await openCdpPage(CDP_PORT);

	for (const orientation of ORIENTATIONS) {
		// One retry from a fresh tab: the dev server's dependency optimiser can
		// reload a page mid-capture the first time a Scene's renderers load.
		let lastError = null;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				if (attempt > 0) {
					await page.close().catch(() => undefined);
					page = await openCdpPage(CDP_PORT);
				}
				report.orientations.push(await traceOrientation(page, server.origin, orientation));
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
		if (!comparison.matches) {
			let reason;
			if (!comparison.landedOnRequestedFrame) {
				reason = `The seek did not land where the Film maths puts Film frame ${comparison.filmFrame}: ${JSON.stringify(comparison.landed)}.`;
			} else if (comparison.blend === null || !comparison.blend.sameSize) {
				reason = 'The captures are not one size, so they cannot be compared.';
			} else if (comparison.kind === 'blend') {
				reason = `The Film frame differs from the blend of its two Scenes by up to ${comparison.blend.maxChannelDifference} levels on ${comparison.blend.differingChannels} of ${comparison.blend.channelCount} channel values; ${comparison.toleranceLevels} allowed.`;
			} else if (comparison.kind === 'repeat') {
				reason = `Film frame ${comparison.filmFrame} under the ${comparison.boundaryKind} boundary is not the same pixels the second time it is captured: up to ${comparison.blend.maxChannelDifference} levels on ${comparison.blend.differingChannels} channel values.`;
			} else {
				reason = `The Film frame differs from Scene "${comparison.sceneId}" frame ${comparison.sceneFrame} alone by up to ${comparison.blend.maxChannelDifference} levels on ${comparison.blend.differingChannels} channel values.`;
			}
			report.failures.push({ orientation, label: comparison.label, reason });
		}
		// Two flat frames blend to a flat frame whatever the maths is. One flat
		// Scene (a transparent Scene before its content enters) still scales every
		// pixel of the other; the report carries both counts.
		if (
			comparison.kind === 'blend' &&
			comparison.label === 'progress-050' &&
			comparison.outgoingSampleColorCount <= 1 &&
			comparison.incomingSampleColorCount <= 1
		) {
			report.failures.push({
				orientation,
				label: comparison.label,
				reason: 'Both Scenes are one flat colour at mid-window, so the blend there proves nothing.'
			});
		}
	}
}
report.passed = report.failures.length === 0 && report.orientations.length === ORIENTATIONS.length;

const reportJson = `${JSON.stringify(report, null, '\t')}\n`;
await writeFile(join(OUTDIR, 'report.json'), reportJson);
console.log(reportJson);
if (!report.passed) {
	console.error(
		`Film boundary tracer: ${report.failures.length} failure(s). See ${join(OUTDIR, 'report.json')}.`
	);
	process.exit(1);
}
console.log(
	'Film boundary tracer: every paused fade frame is the cross-fade of its two Scenes; every transition effect starts on the outgoing Scene and ends on the incoming one; the frames outside every window are untouched; and a frame captured twice is the same pixels.'
);
process.exit(0);
