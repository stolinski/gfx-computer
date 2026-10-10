// The proof of a magic move (ADR-0068 §5): a Scene boundary that carries one
// Overlay from where it sits in the outgoing Scene to where it sits in the
// incoming Scene.
//
// For the two-Scene magic-move fixture, in both orientations and under two
// Packs (the fixture's own and `clean-light`), it holds five things.
//
//   1. The ends. The paused Film frame at window progress 0 is the outgoing
//      Scene's own frame, and at progress 1 the incoming Scene's own frame.
//      Exact: on those two frames the Overlay stays in its Scene and no quad is
//      drawn.
//   2. Outside. The Film frame just before the window and the one just after it
//      are their Scenes' own frames. Exact.
//   3. Repeatable. One mid-window Film frame captured twice, with seeks away
//      between, is the same pixels. Exact.
//   4. The quad's place, at window progress 0.2, 0.5, and 0.8.
//      How the quad is measured: the Workspace's Film-time seam
//      (`window.__settleGfxFilmFrame`, the hook every boundary script already
//      lands frames through) reports, for the frame it holds on the canvas,
//      each pair's quad exactly as the compositor drew it: the box in the
//      outgoing Scene, the box in the incoming Scene, the box of the quad, and
//      the cross-fade mix. This script does not trust the two boxes: it opens
//      each Scene alone, lands it on the same Scene frame, and measures the
//      Overlay's element in the page itself (`getBoundingClientRect` against
//      its composition root, in canvas pixels). It then
//        a. holds each reported box to that measurement, within 1 px on every
//           edge. The reported box was measured with the Overlay mounted alone
//           and the script's with the Overlay in its Scene, so this is also the
//           proof that capturing the Overlay alone does not move or resize it;
//        b. works the quad out for itself from its own two measurements, with
//           its own statement of the ease (`smooth`, 1 − (1 − p)³, on the
//           progress the engine reports) and a straight line between the boxes,
//           and holds the reported quad to that within 1 px on every edge, and
//           the reported mix to the eased progress.
//   5. The quad is on the canvas where it is reported. The same Film with the
//      pair taken off (a plain fade) is captured at the same three frames. The
//      two differ, and every pixel that differs by more than
//      `PLAIN_FADE_TOLERANCE_LEVELS` lies inside one of three boxes: the
//      Overlay's place in the outgoing Scene, its place in the incoming Scene
//      (where the plain fade shows it and the magic move does not), and the
//      reported quad, each grown by `PAINT_MARGIN_PX` for what an Overlay
//      paints outside its box (a shadow). At least one such pixel lies inside
//      the quad's own box.
//      This is containment, not an outline: the frame is not searched for the
//      quad's edges, because a quad is a cross-fade of two pictures over a
//      cross-fade of two more and has no edge a script can find without
//      restating the shader.
//
// The control. Checks 1 and 2 are run a second time on the same Film without
// its magic move (`plain-fade-control`). A frame that fails there as well
// differs because of the boundary, the Scene, or the capture, not the magic
// move; a frame that fails only in checks 1 and 2 differs because of the magic
// move. Every exact comparison reports how many pixels differ, by how much, and
// the box around them, and with frames saved it writes a picture of where.
//
// The summary. Every Pack and orientation is named at the end as PASSED,
// FAILED, or DID-NOT-FINISH, in the report (`summary`) and on the console, so a
// run that stopped early cannot read as one that passed.
//
// Open finding, 2026-10-10: checks 1 to 3 and the control fail now and then,
// in any Pack and orientation, by exactly one level on 1 to 18 pixels of the
// frame. Every such pixel is on the anti-aliased edge of the lower third's
// title in the incoming Scene, where the Overlay is drawn at scale 1.3 or 1.1.
// The control fails the same way, the Overlay's DOM is identical after the
// window and in the Scene alone, and three captures of one unchanging picture
// disagree with each other in different pixels, so it is not the magic move.
// The checks are not loosened for it: a failure here is still a failure, and
// what to do about it is the owner's decision
// (`docs/engine-architecture.md`, Magic move, "Look and proof").
//
// What it does not hold: how the move looks. That is for a person
// (`cdp-capture-film-magic-move-frames.mjs`).
//
//   node --experimental-strip-types scripts/cdp-film-magic-move-tracer.mjs
//
// One invocation, no interactive tooling: its own jailed dev server, the
// fixture and each of its Scenes stored in the jail as Films, and the
// sanctioned CanvasDrawElement Chrome (canvas mode). Prints a JSON report,
// writes it to <out>/report.json, and exits 1 on any mismatch. Environment:
// GFX_FILM_MAGIC_MOVE_PORT (server, default 7301), CDP_PORT (default 9223),
// GFX_FILM_MAGIC_MOVE_TRACER_OUTDIR (default
// .tmp-baselines/film-magic-move-tracer), GFX_FILM_MAGIC_MOVE_SAVE_FRAMES=1 to
// also write every captured frame as a PNG. Node 22+ (built-in
// fetch/WebSocket); needs pnpm and Chrome.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PNG } from 'pngjs';

import { premultiplyStraightRgba8 } from '../src/lib/utils/premultiplied-cross-fade.ts';
import {
	COMPOSITION_CANVAS,
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
	fixtureFilm,
	fixturePair,
	fixtureWindow,
	windowFrameNearProgress
} from './cdp-film-magic-move-session.mjs';
import { createVerificationServerJail } from './verification-server-jail.ts';

const SERVER_PORT = Number(process.env.GFX_FILM_MAGIC_MOVE_PORT ?? 7301);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const OUTDIR = resolve(
	repositoryRoot,
	process.env.GFX_FILM_MAGIC_MOVE_TRACER_OUTDIR ?? '.tmp-baselines/film-magic-move-tracer'
);
const SAVE_FRAMES = process.env.GFX_FILM_MAGIC_MOVE_SAVE_FRAMES === '1';

/** The fixture's own Pack, and a second one with a light field. */
const PACKS = [fixtureFilm.pack, 'clean-light'];
if (new Set(PACKS).size !== PACKS.length) {
	throw new Error(`${FILM_MAGIC_MOVE_FIXTURE_PATH} already uses the second Pack of this run.`);
}

/** How far a box edge may be from where it is expected, in canvas pixels. */
const GEOMETRY_TOLERANCE_PX = 1;
/** How far the reported cross-fade mix may be from the eased progress. */
const MIX_TOLERANCE = 1e-6;
/**
 * Levels of 255 a channel may differ by between the magic-move frame and the
 * plain-fade frame before the pixel counts as changed. Away from the Overlay
 * the two frames are the same fade of the same two Scenes; each Scene is
 * dithered when it is rendered, so equal pictures can land a level apart.
 */
const PLAIN_FADE_TOLERANCE_LEVELS = 2;
/** What an Overlay may paint outside its own box, in canvas pixels. */
const PAINT_MARGIN_PX = 96;

const OUTGOING = 0;
const INCOMING = 1;
const SCENE_FORMS = ['scene-1', 'scene-2'];

const ENDPOINT_FRAMES = [
	{ ...windowFrameNearProgress(0), sceneIndex: OUTGOING, expectedProgress: 0 },
	{ ...windowFrameNearProgress(1), sceneIndex: INCOMING, expectedProgress: 1 }
];
const MID_FRAMES = [0.2, 0.5, 0.8].map(windowFrameNearProgress);
const REPEATED_FRAME = MID_FRAMES[1];
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
		throw new Error(`${FILM_MAGIC_MOVE_FIXTURE_PATH} leaves no frame ${frame.label}.`);
	}
}

/** The Scene frame a compared Film frame puts one Scene on. */
function sceneFrameOf(frame, sceneIndex) {
	if (frame.sceneFrame !== undefined) return frame.sceneFrame;
	return sceneIndex === OUTGOING ? frame.outgoingSceneFrame : frame.incomingSceneFrame;
}

/** A canvas PNG as premultiplied 8-bit RGBA, the values the canvas held. */
function premultipliedPixels(capture) {
	const decoded = PNG.sync.read(capture.png);
	return {
		width: decoded.width,
		height: decoded.height,
		pixels: premultiplyStraightRgba8(decoded.data)
	};
}

/**
 * How two premultiplied pictures differ: the largest channel difference, how
 * many channel values and pixels differ, and the upright box around every pixel
 * that does, so a mismatch says where it is.
 */
function comparePixels(actual, expected) {
	if (actual.width !== expected.width || actual.height !== expected.height) {
		return {
			sameSize: false,
			maxChannelDifference: null,
			differingChannels: null,
			differingPixels: null,
			differingBox: null
		};
	}
	let maxChannelDifference = 0;
	let differingChannels = 0;
	let differingPixels = 0;
	let left = actual.width;
	let top = actual.height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < actual.height; y += 1) {
		for (let x = 0; x < actual.width; x += 1) {
			const offset = (y * actual.width + x) * 4;
			let pixelDiffers = false;
			for (let channel = 0; channel < 4; channel += 1) {
				const difference = Math.abs(
					actual.pixels[offset + channel] - expected.pixels[offset + channel]
				);
				if (difference === 0) continue;
				pixelDiffers = true;
				differingChannels += 1;
				if (difference > maxChannelDifference) maxChannelDifference = difference;
			}
			if (!pixelDiffers) continue;
			differingPixels += 1;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < top) top = y;
			if (y > bottom) bottom = y;
		}
	}
	return {
		sameSize: true,
		maxChannelDifference,
		differingChannels,
		differingPixels,
		differingBox:
			differingPixels === 0
				? null
				: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
	};
}

/** With frames saved: a picture of where two frames differ, white on black. */
async function saveDifference(run, label, actual, expected) {
	if (!SAVE_FRAMES || actual.width !== expected.width || actual.height !== expected.height) return;
	const picture = new PNG({ width: actual.width, height: actual.height });
	for (let offset = 0; offset < actual.pixels.length; offset += 4) {
		let differs = false;
		for (let channel = 0; channel < 4; channel += 1) {
			if (actual.pixels[offset + channel] !== expected.pixels[offset + channel]) differs = true;
		}
		const level = differs ? 255 : 0;
		picture.data[offset] = level;
		picture.data[offset + 1] = level;
		picture.data[offset + 2] = level;
		picture.data[offset + 3] = 255;
	}
	await writeFile(
		join(OUTDIR, `${run.pack}-${run.orientation}-difference-${label}.png`),
		PNG.sync.write(picture)
	);
}

// ---------------------------------------------------------------------------
// Boxes. An upright box is { x, y, width, height } in canvas pixels.

/** The script's own statement of the fixture's ease: `smooth`, the default. */
function easeSmooth(progress) {
	return 1 - (1 - progress) ** 3;
}

function interpolateBox(from, to, amount) {
	const lerp = (start, end) => start + (end - start) * amount;
	return {
		x: lerp(from.x, to.x),
		y: lerp(from.y, to.y),
		width: lerp(from.width, to.width),
		height: lerp(from.height, to.height)
	};
}

/**
 * The upright box around a box the engine reports as a centre, a size, and a
 * rotation. Stated here on its own, so the comparison does not read the
 * engine's own conversion.
 */
function uprightBoxOf(oriented) {
	const radians = (oriented.rotationDegrees * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	const width = oriented.width * cos + oriented.height * sin;
	const height = oriented.width * sin + oriented.height * cos;
	return { x: oriented.centerX - width / 2, y: oriented.centerY - height / 2, width, height };
}

/** The furthest any edge of one box is from the same edge of another. */
function largestEdgeDifference(actual, expected) {
	return Math.max(
		Math.abs(actual.x - expected.x),
		Math.abs(actual.y - expected.y),
		Math.abs(actual.x + actual.width - (expected.x + expected.width)),
		Math.abs(actual.y + actual.height - (expected.y + expected.height))
	);
}

function growBox(box, margin) {
	return {
		x: box.x - margin,
		y: box.y - margin,
		width: box.width + margin * 2,
		height: box.height + margin * 2
	};
}

function boxHolds(box, x, y) {
	return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

/**
 * Measure one Overlay in the page as it stands: its element's client rect
 * against its composition root, in canvas pixels. The script's own reading of
 * where the Overlay is, taken with the Overlay in its Scene.
 */
async function measureOverlayInPage(page, overlayId) {
	return page.evaluate(`(() => {
		const element = document.querySelector('.composition [data-overlay-id="' + CSS.escape(${JSON.stringify(overlayId)}) + '"]');
		if (!element) throw new Error('The page holds no Overlay ${overlayId}.');
		const root = element.closest('.composition');
		if (!root) throw new Error('Overlay ${overlayId} is in no composition root.');
		const canvas = ${COMPOSITION_CANVAS};
		const elementRect = element.getBoundingClientRect();
		const rootRect = root.getBoundingClientRect();
		const scaleX = canvas.width / rootRect.width;
		const scaleY = canvas.height / rootRect.height;
		return {
			x: (elementRect.left - rootRect.left) * scaleX,
			y: (elementRect.top - rootRect.top) * scaleY,
			width: elementRect.width * scaleX,
			height: elementRect.height * scaleY
		};
	})()`);
}

async function saveFrame(run, source, label, capture) {
	if (!SAVE_FRAMES) return;
	await writeFile(
		join(OUTDIR, `${run.pack}-${run.orientation}-${source}-${label}.png`),
		capture.png
	);
}

/** One Pack and orientation: the Film, each Scene alone, the plain fade, then the comparisons. */
async function traceRun(page, origin, run) {
	console.log(`${run.pack} ${run.orientation}:`);
	const open = (form) =>
		openStoredFilm(page, origin, filmSlug({ ...run, form }), filmDocument({ ...run, form }));

	// The Film with its magic move.
	await open('magic-move');
	const inFilm = new Map();
	for (const frame of [...ENDPOINT_FRAMES, ...MID_FRAMES, ...OUTSIDE_FRAMES]) {
		const capture = await captureFilmFramePng(page, frame.filmFrame);
		await saveFrame(run, 'magic-move', frame.label, capture);
		inFilm.set(frame.label, capture);
		console.log(`  magic-move   ${frame.label.padEnd(14)} film frame ${frame.filmFrame}`);
	}
	// Every seek above lies between the first capture of this frame and this one.
	const repeated = await captureFilmFramePng(page, REPEATED_FRAME.filmFrame);

	// Each Scene alone: its own frame where a whole frame is compared, and the
	// Overlay measured in the page at every mid-window Scene frame.
	const alonePixels = [new Map(), new Map()];
	const aloneBoxes = [new Map(), new Map()];
	for (const sceneIndex of [OUTGOING, INCOMING]) {
		await open(SCENE_FORMS[sceneIndex]);
		const overlayId = sceneIndex === OUTGOING ? fixturePair.from.id : fixturePair.to.id;
		const wholeFrames = [...ENDPOINT_FRAMES, ...OUTSIDE_FRAMES].filter(
			(frame) => frame.sceneIndex === sceneIndex
		);
		for (const frame of wholeFrames) {
			const sceneFrame = sceneFrameOf(frame, sceneIndex);
			// A one-Scene Film's Film frame is its Scene frame.
			const capture = await captureFilmFramePng(page, sceneFrame);
			await saveFrame(run, `${SCENE_FORMS[sceneIndex]}-alone`, `frame-${sceneFrame}`, capture);
			alonePixels[sceneIndex].set(sceneFrame, premultipliedPixels(capture));
		}
		for (const frame of MID_FRAMES) {
			const sceneFrame = sceneFrameOf(frame, sceneIndex);
			await captureFilmFramePng(page, sceneFrame);
			aloneBoxes[sceneIndex].set(sceneFrame, await measureOverlayInPage(page, overlayId));
		}
		console.log(`  scene-alone  ${fixtureFilm.scenes[sceneIndex].id}`);
	}

	// The same Film with the pair taken off: mid-window for check 5, and its
	// ends and outside as the control for checks 1 and 2.
	await open('plain-fade');
	const plainFade = new Map();
	for (const frame of [...ENDPOINT_FRAMES, ...MID_FRAMES, ...OUTSIDE_FRAMES]) {
		const capture = await captureFilmFramePng(page, frame.filmFrame);
		await saveFrame(run, 'plain-fade', frame.label, capture);
		plainFade.set(frame.label, premultipliedPixels(capture));
		console.log(`  plain-fade   ${frame.label.padEnd(14)} film frame ${frame.filmFrame}`);
	}

	const comparisons = [];

	for (const frame of ENDPOINT_FRAMES) {
		const capture = inFilm.get(frame.label);
		const sceneFrame = sceneFrameOf(frame, frame.sceneIndex);
		const landedOnRequestedFrame =
			capture.boundaryWindow !== null &&
			capture.boundaryWindow.windowFrame === frame.windowFrame &&
			capture.boundaryWindow.progress === frame.expectedProgress;
		const pixels = comparePixels(
			premultipliedPixels(capture),
			alonePixels[frame.sceneIndex].get(sceneFrame)
		);
		comparisons.push({
			label: frame.label,
			kind: 'endpoint',
			filmFrame: frame.filmFrame,
			sceneId: fixtureFilm.scenes[frame.sceneIndex].id,
			sceneFrame,
			progress: capture.boundaryWindow?.progress ?? null,
			quadCount: capture.magicMoveQuads.length,
			pixels,
			matches:
				landedOnRequestedFrame &&
				capture.magicMoveQuads.length === 0 &&
				pixels.sameSize &&
				pixels.maxChannelDifference === 0,
			landed: {
				sceneId: capture.sceneId,
				sceneFrame: capture.sceneFrame,
				window: capture.boundaryWindow
			},
			reason: `The Film frame at window progress ${frame.expectedProgress} is not Scene "${fixtureFilm.scenes[frame.sceneIndex].id}" frame ${sceneFrame} alone: ${pixels.differingPixels} pixels differ, by up to ${pixels.maxChannelDifference} levels, inside ${JSON.stringify(pixels.differingBox)}.`
		});
	}

	for (const frame of OUTSIDE_FRAMES) {
		const capture = inFilm.get(frame.label);
		const landedOnRequestedFrame =
			capture.boundaryWindow === null &&
			capture.sceneId === fixtureFilm.scenes[frame.sceneIndex].id &&
			capture.sceneFrame === frame.sceneFrame;
		const pixels = comparePixels(
			premultipliedPixels(capture),
			alonePixels[frame.sceneIndex].get(frame.sceneFrame)
		);
		comparisons.push({
			label: frame.label,
			kind: 'untouched',
			filmFrame: frame.filmFrame,
			sceneId: fixtureFilm.scenes[frame.sceneIndex].id,
			sceneFrame: frame.sceneFrame,
			quadCount: capture.magicMoveQuads.length,
			pixels,
			matches:
				landedOnRequestedFrame &&
				capture.magicMoveQuads.length === 0 &&
				pixels.sameSize &&
				pixels.maxChannelDifference === 0,
			landed: {
				sceneId: capture.sceneId,
				sceneFrame: capture.sceneFrame,
				window: capture.boundaryWindow
			},
			reason: `The Film frame ${frame.label.replace('-', ' the ')} is not Scene "${fixtureFilm.scenes[frame.sceneIndex].id}" frame ${frame.sceneFrame} alone: ${pixels.differingPixels} pixels differ, by up to ${pixels.maxChannelDifference} levels, inside ${JSON.stringify(pixels.differingBox)}.`
		});
	}

	// The control for checks 1 and 2: the same four frames of the same Film
	// without its magic move, against the same Scenes alone. A frame that fails
	// here as well differs because of the boundary or the Scene, not the magic
	// move; one that fails only above differs because of the magic move.
	for (const frame of [...ENDPOINT_FRAMES, ...OUTSIDE_FRAMES]) {
		const sceneFrame = sceneFrameOf(frame, frame.sceneIndex);
		const alone = alonePixels[frame.sceneIndex].get(sceneFrame);
		const pixels = comparePixels(plainFade.get(frame.label), alone);
		comparisons.push({
			label: frame.label,
			kind: 'plain-fade-control',
			filmFrame: frame.filmFrame,
			sceneId: fixtureFilm.scenes[frame.sceneIndex].id,
			sceneFrame,
			pixels,
			matches: pixels.sameSize && pixels.maxChannelDifference === 0,
			reason: `Without the magic move, the Film frame ${frame.label} is not Scene "${fixtureFilm.scenes[frame.sceneIndex].id}" frame ${sceneFrame} alone either: ${pixels.differingPixels} pixels differ, by up to ${pixels.maxChannelDifference} levels, inside ${JSON.stringify(pixels.differingBox)}.`
		});
		const magicMovePixels = premultipliedPixels(inFilm.get(frame.label));
		if (comparePixels(magicMovePixels, alone).maxChannelDifference !== 0) {
			await saveDifference(run, `magic-move-${frame.label}`, magicMovePixels, alone);
		}
		if (pixels.maxChannelDifference !== 0) {
			await saveDifference(run, `plain-fade-${frame.label}`, plainFade.get(frame.label), alone);
		}
	}

	{
		const pixels = comparePixels(
			premultipliedPixels(repeated),
			premultipliedPixels(inFilm.get(REPEATED_FRAME.label))
		);
		comparisons.push({
			label: `${REPEATED_FRAME.label}-again`,
			kind: 'repeat',
			filmFrame: REPEATED_FRAME.filmFrame,
			pixels,
			matches: pixels.sameSize && pixels.maxChannelDifference === 0,
			reason: `Film frame ${REPEATED_FRAME.filmFrame} is not the same pixels the second time it is captured.`
		});
	}

	for (const frame of MID_FRAMES) {
		const capture = inFilm.get(frame.label);
		const progress = capture.boundaryWindow?.progress ?? null;
		const landedOnRequestedFrame =
			capture.boundaryWindow !== null &&
			capture.boundaryWindow.windowFrame === frame.windowFrame &&
			capture.boundaryWindow.outgoingSceneFrame === frame.outgoingSceneFrame &&
			capture.boundaryWindow.incomingSceneFrame === frame.incomingSceneFrame;
		const [quad] = capture.magicMoveQuads;
		const measuredFrom = aloneBoxes[OUTGOING].get(frame.outgoingSceneFrame);
		const measuredTo = aloneBoxes[INCOMING].get(frame.incomingSceneFrame);

		if (!landedOnRequestedFrame || progress === null || capture.magicMoveQuads.length !== 1) {
			comparisons.push({
				label: frame.label,
				kind: 'quad-geometry',
				filmFrame: frame.filmFrame,
				quadCount: capture.magicMoveQuads.length,
				matches: false,
				reason: `Film frame ${frame.filmFrame} did not land mid-window with one quad: ${JSON.stringify(capture.boundaryWindow)}, ${capture.magicMoveQuads.length} quad(s).`
			});
			continue;
		}

		// 4a and 4b: the boxes, against this script's own measurements and maths.
		const eased = easeSmooth(progress);
		const expectedQuadBox = interpolateBox(measuredFrom, measuredTo, eased);
		const reported = {
			from: uprightBoxOf(quad.from),
			to: uprightBoxOf(quad.to),
			quad: uprightBoxOf(quad.rect)
		};
		const edgeDifferencePx = {
			from: largestEdgeDifference(reported.from, measuredFrom),
			to: largestEdgeDifference(reported.to, measuredTo),
			quad: largestEdgeDifference(reported.quad, expectedQuadBox)
		};
		const mixDifference = Math.abs(quad.mix - eased);
		const geometryMatches =
			edgeDifferencePx.from <= GEOMETRY_TOLERANCE_PX &&
			edgeDifferencePx.to <= GEOMETRY_TOLERANCE_PX &&
			edgeDifferencePx.quad <= GEOMETRY_TOLERANCE_PX &&
			mixDifference <= MIX_TOLERANCE;
		comparisons.push({
			label: frame.label,
			kind: 'quad-geometry',
			filmFrame: frame.filmFrame,
			progress,
			easedProgress: eased,
			measuredInPage: { from: measuredFrom, to: measuredTo },
			expectedQuadBox,
			reported,
			reportedMix: quad.mix,
			edgeDifferencePx,
			mixDifference,
			tolerancePx: GEOMETRY_TOLERANCE_PX,
			// Two boxes in one place would agree with any interpolation.
			restsApartPx: largestEdgeDifference(measuredFrom, measuredTo),
			matches: geometryMatches && largestEdgeDifference(measuredFrom, measuredTo) > 8,
			reason: `The quad at window progress ${progress.toFixed(3)} is off by up to ${Math.max(edgeDifferencePx.from, edgeDifferencePx.to, edgeDifferencePx.quad).toFixed(2)} px (outgoing box ${edgeDifferencePx.from.toFixed(2)}, incoming box ${edgeDifferencePx.to.toFixed(2)}, quad ${edgeDifferencePx.quad.toFixed(2)}), mix off by ${mixDifference.toExponential(2)}; ${GEOMETRY_TOLERANCE_PX} px allowed, and the two boxes must be apart.`
		});

		// 5: where the frame differs from the plain fade.
		const magicPixels = premultipliedPixels(capture);
		const plainPixels = plainFade.get(frame.label);
		const allowed = [measuredFrom, measuredTo, reported.quad].map((box) =>
			growBox(box, PAINT_MARGIN_PX)
		);
		let changedPixelCount = 0;
		let changedOutsideCount = 0;
		let changedInsideQuadCount = 0;
		const sameSize =
			magicPixels.width === plainPixels.width && magicPixels.height === plainPixels.height;
		if (sameSize) {
			for (let y = 0; y < magicPixels.height; y += 1) {
				for (let x = 0; x < magicPixels.width; x += 1) {
					const offset = (y * magicPixels.width + x) * 4;
					let isChanged = false;
					for (let channel = 0; channel < 4; channel += 1) {
						if (
							Math.abs(
								magicPixels.pixels[offset + channel] - plainPixels.pixels[offset + channel]
							) > PLAIN_FADE_TOLERANCE_LEVELS
						) {
							isChanged = true;
							break;
						}
					}
					if (!isChanged) continue;
					changedPixelCount += 1;
					if (boxHolds(reported.quad, x + 0.5, y + 0.5)) changedInsideQuadCount += 1;
					if (!allowed.some((box) => boxHolds(box, x + 0.5, y + 0.5))) changedOutsideCount += 1;
				}
			}
		}
		comparisons.push({
			label: frame.label,
			kind: 'quad-on-canvas',
			filmFrame: frame.filmFrame,
			progress,
			toleranceLevels: PLAIN_FADE_TOLERANCE_LEVELS,
			paintMarginPx: PAINT_MARGIN_PX,
			changedPixelCount,
			changedInsideQuadCount,
			changedOutsideCount,
			matches: sameSize && changedInsideQuadCount > 0 && changedOutsideCount === 0,
			reason: `Against the plain fade, ${changedPixelCount} pixels changed: ${changedInsideQuadCount} inside the reported quad and ${changedOutsideCount} outside every box the Overlay can be in.`
		});
	}

	return { ...run, comparisons };
}

// ---------------------------------------------------------------------------

const RUNS = PACKS.flatMap((pack) => ORIENTATIONS.map((orientation) => ({ pack, orientation })));
const FORMS = ['magic-move', 'plain-fade', ...SCENE_FORMS];

await mkdir(OUTDIR, { recursive: true });
const jail = await createVerificationServerJail('film-magic-move-tracer');
await mkdir(jail.compositionStoreDirectory, { recursive: true });
for (const run of RUNS) {
	for (const form of FORMS) {
		await writeStoredFilm(
			jail.compositionStoreDirectory,
			filmSlug({ ...run, form }),
			filmDocument({ ...run, form })
		);
	}
}

const report = {
	fixture: FILM_MAGIC_MOVE_FIXTURE_PATH,
	pair: fixturePair,
	window: fixtureWindow,
	packs: PACKS,
	orientations: ORIENTATIONS,
	runs: [],
	summary: [],
	failures: [],
	passed: false
};

let server = null;
let page = null;
try {
	server = await startJailedDevServer(jail, SERVER_PORT);
	confirmCanvasChrome(CDP_PORT);
	page = await openCdpPage(CDP_PORT);
	for (const run of RUNS) {
		try {
			report.runs.push(await traceRun(page, server.origin, run));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			report.failures.push({ ...run, label: null, reason: message });
			console.log(`  FAIL ${run.pack} ${run.orientation}: ${message}`);
		}
	}
} finally {
	await page?.close().catch(() => undefined);
	await server?.stop();
	await jail.dispose();
}

for (const { pack, orientation, comparisons } of report.runs) {
	for (const comparison of comparisons) {
		if (comparison.matches) continue;
		report.failures.push({
			pack,
			orientation,
			label: comparison.label,
			kind: comparison.kind,
			reason: comparison.reason
		});
	}
}
// Every Pack and orientation is named, passed or failed, so a run that never
// finished cannot read as one that passed.
report.summary = RUNS.map((run) => {
	const traced = report.runs.find(
		(candidate) => candidate.pack === run.pack && candidate.orientation === run.orientation
	);
	const failures = report.failures.filter(
		(failure) => failure.pack === run.pack && failure.orientation === run.orientation
	);
	return {
		...run,
		status: traced === undefined ? 'did-not-finish' : failures.length === 0 ? 'passed' : 'failed',
		comparisons: traced?.comparisons.length ?? 0,
		failures: failures.length
	};
});
report.passed =
	report.failures.length === 0 && report.summary.every((entry) => entry.status === 'passed');

const reportJson = `${JSON.stringify(report, null, '\t')}\n`;
await writeFile(join(OUTDIR, 'report.json'), reportJson);
console.log(reportJson);
for (const entry of report.summary) {
	console.log(
		`${entry.status.toUpperCase().padEnd(14)} ${entry.pack} ${entry.orientation}: ${entry.comparisons} comparisons, ${entry.failures} failure(s)`
	);
}
for (const failure of report.failures) {
	console.log(
		`  ${failure.pack} ${failure.orientation} ${failure.label} (${failure.kind}): ${failure.reason}`
	);
}
if (!report.passed) {
	console.error(
		`Film magic-move tracer: ${report.failures.length} failure(s). See ${join(OUTDIR, 'report.json')}.`
	);
	process.exit(1);
}
console.log(
	'Film magic-move tracer: the window starts on the outgoing Scene and ends on the incoming one; the frames outside it are untouched; a frame captured twice is the same pixels; and the quad is where the two measured boxes and the ease put it, under both Packs and in both orientations.'
);
process.exit(0);
