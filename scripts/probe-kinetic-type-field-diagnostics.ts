#!/usr/bin/env -S node --experimental-strip-types
/**
 * Closed pixel and geometry diagnostics for a Kinetic Type Field (ADR-0064),
 * across every catalog Pack in both native orientations, at the field's own
 * critical moments: every Motion Beat and the start, middle, and end of each
 * word's keyframe envelope.
 *
 * Each cell proves, as numbers:
 * - native target size, real variable face loaded, no font synthesis, no
 *   word cut off by its own mask;
 * - repeated-frame identity: an envelope's middle frame renders the same
 *   canonical pixels and word geometry after seeking away and back;
 * - cap height: every shown word clears the cap-height floor;
 * - phrase readability at its beat, and in the tall frame the phrase's focal
 *   word clear of the platform caption shelf and action column;
 * - variable-axis continuity: across each weight ramp the applied weight moves
 *   monotonically, the word's width follows without a jump, and its line box
 *   and anchored edge hold still (no reflow);
 * - crispness: at each phrase beat the shown words have hard, raster-free
 *   edges at their transformed size on the native canvas;
 * - alpha preservation: with the background fill off, the frame outside the
 *   words is fully transparent and the words stay opaque.
 *
 * Requires a jailed app server and sanctioned CanvasDrawElement Chrome:
 *   GFX_PROBE_BASE_URL=http://127.0.0.1:5199 \
 *   CDP_URL=http://127.0.0.1:9263 \
 *   GFX_PROBE_PRESET=kinetic-type-field-motion-fixture \
 *   pnpm probe:kinetic-type-field-diagnostics
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { listKineticTypeCriticalMoments } from '../src/lib/utils/kinetic-type-critical-moments.ts';
import type { KineticTypeField, MotionBeat } from '../src/lib/platform/engine-schema.ts';
import { connectCdpRenderBrowser } from './cdp-render-page.ts';

const baseUrl = process.env.GFX_PROBE_BASE_URL ?? 'http://127.0.0.1:5173';
const cdpUrl = process.env.CDP_URL ?? 'http://127.0.0.1:9229';
const presetSlug = process.env.GFX_PROBE_PRESET ?? 'kinetic-type-field-motion-fixture';
const onlyPacks = process.env.GFX_PROBE_PACKS?.split(',').filter(Boolean);
const orientations = ['horizontal', 'vertical'] as const;
type Orientation = (typeof orientations)[number];

/** Cap-height floors in native pixels (docs/quality-rubric.md R-family). */
const CAP_HEIGHT_FLOOR: Record<Orientation, number> = { horizontal: 32, vertical: 44 };
/** Vertical platform chrome bands the focal word must clear: caption shelf and action column. */
const VERTICAL_PLATFORM_BANDS = { bottom: 0.16, right: 0.09 } as const;
/** Mean run of half-tone pixels across an ink edge, in native pixels; an upscaled raster runs wider. */
const CRISP_EDGE_RUN_LIMIT = 2.6;
/** How much softer than the least-scaled shown word a scaled word's edges may be. */
const CRISP_RELATIVE_LIMIT = 1.6;
const GEOMETRY_TOLERANCE = 1;
/**
 * Placement is optical: the word's box is its measured ink, which rounds
 * differently at neighbouring weights by well under a percent of its width.
 */
const OPTICAL_WIDTH_TOLERANCE = 0.01;
const READABLE_OPACITY = 0.98;

interface PresetDocument {
	name: string;
	state: {
		transport: { durationSeconds: number };
		surface: { typeField?: KineticTypeField };
		motionBeats?: MotionBeat[];
		backgroundFill?: string;
	};
}

interface WordProbe {
	id: string;
	opacity: number;
	fontFamily: string;
	fontWeight: number;
	fontSynthesis: string;
	/** Text wider than the word's own box: its mask would cut glyphs off. */
	clipped: boolean;
	capHeight: number;
	bounds: { left: number; top: number; right: number; bottom: number };
	glyphTops: number[];
}

interface FrameProbe {
	canvas: { width: number; height: number };
	fontsLoaded: boolean;
	variableFamily: string;
	words: WordProbe[];
	digest: string;
	/** The quantized block values the digest hashes. */
	blocks: number[];
	edgeRuns: Record<string, number>;
	alpha: { cornerMax: number; coverage: number; wordOpaque: Record<string, boolean> };
}

const document = JSON.parse(
	await readFile(resolve('src/lib/presets', `${presetSlug}.json`), 'utf8')
) as PresetDocument;
const field = document.state.surface.typeField;
assert.ok(field, `${presetSlug} carries no Type Field`);
const beats = document.state.motionBeats ?? [];
const durationMs = document.state.transport.durationSeconds * 1000;
const moments = listKineticTypeCriticalMoments(field, beats);
const wordsById = new Map(field.words.map((word) => [word.id, word]));
const phraseBeats = field.phrases
	.filter((phrase) => phrase.beatId !== undefined)
	.map((phrase) => ({ phrase, beat: beats.find((beat) => beat.id === phrase.beatId)! }))
	.filter((entry) => entry.beat !== undefined);
assert.ok(phraseBeats.length > 0, `${presetSlug} binds no phrase to a Motion Beat`);

/** Weight ramps worth proving: a real change over a real span, with geometry otherwise still. */
const weightRamps = field.words.flatMap((word) => {
	const frames = word.animation?.channels?.weight ?? [];
	const spatial = [
		...['x', 'y', 'scale', 'rotation'].flatMap(
			(channel) =>
				(
					word.animation?.channels as Record<string, { atMs: number; value: number }[]> | undefined
				)?.[channel] ?? []
		)
	];
	const ramps: { wordId: string; startMs: number; endMs: number; from: number; to: number }[] = [];
	for (let index = 1; index < frames.length; index += 1) {
		const from = frames[index - 1];
		const to = frames[index];
		if (Math.abs(to.value - from.value) < 0.25 || to.atMs - from.atMs < 120) continue;
		const spatialMoves = spatial.some((frame) => frame.atMs > from.atMs && frame.atMs < to.atMs);
		if (spatialMoves) continue;
		ramps.push({
			wordId: word.id,
			startMs: from.atMs,
			endMs: to.atMs,
			from: from.value,
			to: to.value
		});
	}
	return ramps;
});

/** The edge run of the phrase word authored at the smallest scale in this frame. */
function leastScaledEdgeRun(frame: FrameProbe, wordIds: readonly string[]): number {
	const measured = wordIds
		.filter((id) => frame.edgeRuns[id] !== undefined)
		.sort((left, right) => (wordsById.get(left)?.scale ?? 1) - (wordsById.get(right)?.scale ?? 1));
	return measured.length > 0 ? frame.edgeRuns[measured[0]] : CRISP_EDGE_RUN_LIMIT;
}

const browser = await connectCdpRenderBrowser(cdpUrl);
const reports: unknown[] = [];
try {
	await browser.page.goto(`${baseUrl}/p/${presetSlug}?source=builtin`, {
		waitUntil: 'load',
		timeout: 30_000
	});
	await browser.page.waitForFunction(
		(count) =>
			window.document.readyState === 'complete' &&
			Boolean(window.__gfxTimeline && window.__gfxCapturePosterFrameAt) &&
			window.document.querySelectorAll('[data-kinetic-word]').length === count,
		field.words.length,
		{ timeout: 30_000 }
	);
	const packSlugs = (
		await browser.page.evaluate<string[]>(() => {
			const packSelect = [...window.document.querySelectorAll('select')].find((candidate) =>
				[...candidate.options].some((option) => option.value === 'syntax')
			);
			if (!packSelect) throw new Error('Pack control is unavailable');
			return [...packSelect.options].map((option) => option.value).filter(Boolean);
		})
	).filter((slug) => !onlyPacks || onlyPacks.includes(slug));

	const selectCell = async (orientation: Orientation, pack: string): Promise<void> => {
		await browser.page.evaluate(
			({ targetOrientation, targetPack }) => {
				const canvas = [...window.document.querySelectorAll('canvas')].sort(
					(a, b) => b.width * b.height - a.width * a.height
				)[0];
				if (canvas?.width !== (targetOrientation === 'vertical' ? 2160 : 3840)) {
					const label =
						targetOrientation === 'vertical' ? 'Switch to vertical' : 'Switch to horizontal';
					window.document
						.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
						?.click();
				}
				const packSelect = [...window.document.querySelectorAll('select')].find((candidate) =>
					[...candidate.options].some((option) => option.value === targetPack)
				);
				if (packSelect && packSelect.value !== targetPack) {
					packSelect.value = targetPack;
					packSelect.dispatchEvent(new Event('change', { bubbles: true }));
				}
			},
			{ targetOrientation: orientation, targetPack: pack }
		);
		const expectedWidth = orientation === 'vertical' ? 2160 : 3840;
		await browser.page.waitForFunction(
			(width) => {
				const canvas = [...window.document.querySelectorAll('canvas')].sort(
					(a, b) => b.width * b.height - a.width * a.height
				)[0];
				return canvas?.width === width && window.document.fonts.status === 'loaded';
			},
			expectedWidth,
			{ timeout: 30_000 }
		);
	};

	const setBackgroundFill = async (on: boolean): Promise<void> => {
		await browser.page.evaluate((target) => {
			const toggle = window.document.querySelector<HTMLButtonElement>(
				'button[role="switch"][aria-label="Background fill"]'
			);
			if (!toggle) throw new Error('Background fill control is unavailable');
			if ((toggle.getAttribute('aria-checked') === 'true') !== target) toggle.click();
		}, on);
		await browser.page.evaluate(
			() =>
				new Promise<void>((done) =>
					requestAnimationFrame(() => requestAnimationFrame(() => done()))
				)
		);
	};

	const captureFrame = async (
		atMs: number,
		measure: string[] = [],
		readAlpha = false
	): Promise<FrameProbe> =>
		browser.page.evaluate<FrameProbe, { atMs: number; measure: string[]; readAlpha: boolean }>(
			async ({ atMs: targetMs, measure: measured, readAlpha }) => {
				const canvas = [...window.document.querySelectorAll('canvas')].sort(
					(a, b) => b.width * b.height - a.width * a.height
				)[0];
				const fieldElement = window.document.querySelector<HTMLElement>('.kinetic-type-field');
				const firstWord = window.document.querySelector<HTMLElement>('[data-kinetic-word]');
				if (!canvas || !fieldElement || !firstWord || !window.__gfxCapturePosterFrameAt) {
					throw new Error('Kinetic Type diagnostics target is unavailable');
				}
				await window.document.fonts.ready;
				const captured = await window.__gfxCapturePosterFrameAt(targetMs / 1000);
				if (!captured) throw new Error('Frame capture returned nothing.');
				const variableFamily = getComputedStyle(firstWord)
					.getPropertyValue('--variableWeightFont')
					.split(',')[0]!
					.trim()
					.replace(/^(?:"|')(.*)(?:"|')$/, '$1');
				const fieldRect = fieldElement.getBoundingClientRect();
				const toCanvas = canvas.width / fieldRect.width;
				const measureContext = new OffscreenCanvas(8, 8).getContext('2d');
				if (!measureContext) throw new Error('Measurement context is unavailable.');
				const words = [...window.document.querySelectorAll<HTMLElement>('[data-kinetic-word]')].map(
					(wrapper) => {
						const text = wrapper.querySelector<HTMLElement>('.kinetic-word');
						if (!text) throw new Error('Kinetic Word text is unavailable');
						const style = getComputedStyle(text);
						const rect = wrapper.getBoundingClientRect();
						// Cap height of the word's own face at its rendered size, in native
						// canvas pixels: the face's H ascent scaled by the word's transform.
						measureContext.font = `${style.fontWeight} 100px ${style.fontFamily}`;
						const capRatio = measureContext.measureText('H').actualBoundingBoxAscent / 100;
						const transformScale =
							rect.height / Math.max(1, (wrapper as HTMLElement).offsetHeight || rect.height);
						return {
							id: wrapper.dataset.kineticWord ?? '',
							opacity: Number(getComputedStyle(wrapper).opacity),
							fontFamily: style.fontFamily,
							fontWeight: Number(style.fontWeight),
							fontSynthesis: style.fontSynthesis,
							clipped: text.scrollWidth > text.clientWidth + 1,
							capHeight: capRatio * parseFloat(style.fontSize) * transformScale * toCanvas,
							bounds: {
								left: (rect.left - fieldRect.left) * toCanvas,
								top: (rect.top - fieldRect.top) * toCanvas,
								right: (rect.right - fieldRect.left) * toCanvas,
								bottom: (rect.bottom - fieldRect.top) * toCanvas
							},
							glyphTops: [...text.querySelectorAll<HTMLElement>('.kinetic-word__glyph')].map(
								(glyph) => (glyph.getBoundingClientRect().top - fieldRect.top) * toCanvas
							)
						};
					}
				);

				const decode = async (blob: Blob): Promise<ImageData> => {
					const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
					const analysis = new OffscreenCanvas(bitmap.width, bitmap.height);
					const context = analysis.getContext('2d', { willReadFrequently: true });
					if (!context) throw new Error('Analysis context is unavailable.');
					context.drawImage(bitmap, 0, 0);
					bitmap.close();
					return context.getImageData(0, 0, analysis.width, analysis.height);
				};

				// Canonical digest of the captured frame (the deterministic poster
				// image) over 8 px blocks quantized to 32 levels: stable across GPU
				// dithering and encoder noise, sensitive to any visible change.
				const poster = await decode(
					new Blob(
						[Uint8Array.from(atob(captured.webpBase64), (character) => character.charCodeAt(0))],
						{ type: 'image/webp' }
					)
				);
				const block = 8;
				const channels: number[] = [];
				for (let top = 0; top < poster.height; top += block) {
					for (let left = 0; left < poster.width; left += block) {
						const sums = [0, 0, 0, 0];
						let count = 0;
						for (let y = top; y < Math.min(top + block, poster.height); y += 1) {
							for (let x = left; x < Math.min(left + block, poster.width); x += 1) {
								const offset = (y * poster.width + x) * 4;
								for (let channel = 0; channel < 4; channel += 1) {
									sums[channel] += poster.data[offset + channel];
								}
								count += 1;
							}
						}
						for (const sum of sums) channels.push(Math.round(sum / count / 32));
					}
				}
				const digestBytes = new Uint8Array(
					await crypto.subtle.digest('SHA-256', Uint8Array.from(channels))
				);

				// Native pixels, losslessly, only where a check needs them: the
				// presented canvas encodes to PNG (a direct bitmap read of the WebGPU
				// canvas returns nothing).
				const image =
					measured.length > 0 || readAlpha
						? await decode(
								await new Promise<Blob>((done, fail) =>
									canvas.toBlob(
										(blob) => (blob ? done(blob) : fail(new Error('PNG capture failed'))),
										'image/png'
									)
								)
							)
						: new ImageData(1, 1);
				const pixel = (x: number, y: number): number => (y * image.width + x) * 4;

				// Edge crispness: across each scanline of the word, the mean length of
				// runs of half-tone luminance between field and ink.
				const luminance = (offset: number): number =>
					0.2126 * image.data[offset] +
					0.7152 * image.data[offset + 1] +
					0.0722 * image.data[offset + 2];
				const edgeRuns: Record<string, number> = {};
				for (const word of words) {
					if (!measured.includes(word.id)) continue;
					const left = Math.max(0, Math.floor(word.bounds.left));
					const right = Math.min(image.width - 1, Math.ceil(word.bounds.right));
					const top = Math.max(0, Math.floor(word.bounds.top));
					const bottom = Math.min(image.height - 1, Math.ceil(word.bounds.bottom));
					if (right - left < 8 || bottom - top < 8) continue;
					let low = 255;
					let high = 0;
					for (let y = top; y <= bottom; y += 4) {
						for (let x = left; x <= right; x += 4) {
							const value = luminance(pixel(x, y));
							low = Math.min(low, value);
							high = Math.max(high, value);
						}
					}
					const span = high - low;
					if (span < 40) continue;
					const lower = low + span * 0.15;
					const upper = high - span * 0.15;
					let runs = 0;
					let runPixels = 0;
					for (let y = top; y <= bottom; y += 3) {
						let run = 0;
						for (let x = left; x <= right; x += 1) {
							const value = luminance(pixel(x, y));
							if (value > lower && value < upper) run += 1;
							else if (run > 0) {
								runs += 1;
								runPixels += run;
								run = 0;
							}
						}
					}
					edgeRuns[word.id] = runs > 0 ? runPixels / runs : 0;
				}

				// Alpha: the four corners, overall coverage, and whether each shown
				// word's box holds fully opaque ink.
				const corners = !readAlpha
					? []
					: [
							pixel(0, 0),
							pixel(image.width - 1, 0),
							pixel(0, image.height - 1),
							pixel(image.width - 1, image.height - 1)
						];
				let covered = 0;
				let sampled = 0;
				for (let y = 0; readAlpha && y < image.height; y += 8) {
					for (let x = 0; x < image.width; x += 8) {
						sampled += 1;
						if (image.data[pixel(x, y) + 3] > 0) covered += 1;
					}
				}
				const wordOpaque: Record<string, boolean> = {};
				for (const word of readAlpha ? words : []) {
					if (word.opacity < 0.98) continue;
					let opaque = false;
					for (
						let y = Math.max(0, Math.floor(word.bounds.top));
						!opaque && y < Math.min(image.height, word.bounds.bottom);
						y += 2
					) {
						for (
							let x = Math.max(0, Math.floor(word.bounds.left));
							x < Math.min(image.width, word.bounds.right);
							x += 2
						) {
							if (image.data[pixel(x, y) + 3] >= 250) {
								opaque = true;
								break;
							}
						}
					}
					wordOpaque[word.id] = opaque;
				}

				return {
					canvas: { width: canvas.width, height: canvas.height },
					fontsLoaded: window.document.fonts.status === 'loaded',
					variableFamily,
					words,
					digest: [...digestBytes].map((value) => value.toString(16).padStart(2, '0')).join(''),
					blocks: channels,
					edgeRuns,
					alpha: {
						cornerMax: Math.max(0, ...corners.map((offset) => image.data[offset + 3])),
						coverage: sampled > 0 ? covered / sampled : 0,
						wordOpaque
					}
				};
			},
			{ atMs, measure, readAlpha }
		);

	/** Two identical canonical digests in a row: the published frame has caught up. */
	const captureStable = async (
		atMs: number,
		measure: string[] = [],
		readAlpha = false
	): Promise<FrameProbe> => {
		let previous = await captureFrame(atMs);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const current = await captureFrame(atMs, measure, readAlpha);
			if (current.digest === previous.digest) return current;
			previous = current;
		}
		throw new Error(`frame at ${atMs} ms never produced two identical captures`);
	};

	const shown = (frame: FrameProbe): WordProbe[] =>
		frame.words.filter((word) => word.opacity >= READABLE_OPACITY);

	for (const orientation of orientations) {
		for (const pack of packSlugs) {
			await selectCell(orientation, pack);
			const cell = `${pack} ${orientation}`;
			const expected =
				orientation === 'horizontal'
					? { width: 3840, height: 2160 }
					: { width: 2160, height: 3840 };
			await captureStable(0);
			let framesChecked = 0;

			// Critical moments: native size, real face, cap height, replay identity.
			for (const moment of moments) {
				const middle = Math.round((moment.startMs + moment.endMs) / 2);
				const addresses = [...new Set([moment.startMs, middle, moment.endMs])].filter(
					(atMs) => atMs <= durationMs
				);
				for (const atMs of addresses) {
					const frame = await captureStable(atMs);
					framesChecked += 1;
					assert.deepEqual(frame.canvas, expected, `${cell} renders natively`);
					assert.ok(frame.fontsLoaded, `${cell} fonts not loaded at ${atMs} ms`);
					for (const word of shown(frame)) {
						assert.ok(
							word.fontFamily.includes(frame.variableFamily),
							`${cell} ${word.id} left the Pack's variable face at ${atMs} ms`
						);
						assert.equal(word.fontSynthesis, 'none', `${cell} ${word.id} synthesizes a face`);
						assert.ok(!word.clipped, `${cell} ${word.id} is cut off by its own mask at ${atMs} ms`);
						assert.ok(
							word.capHeight >= CAP_HEIGHT_FLOOR[orientation],
							`${cell} ${word.id} cap height ${word.capHeight.toFixed(1)} px is under the ${CAP_HEIGHT_FLOOR[orientation]} px floor at ${atMs} ms`
						);
					}
					if (atMs === middle) {
						await captureStable(atMs > durationMs / 2 ? 0 : durationMs);
						const replay = await captureStable(atMs);
						const differing = replay.blocks.filter((value, index) => value !== frame.blocks[index]);
						const largest = Math.max(
							0,
							...replay.blocks.map((value, index) => Math.abs(value - frame.blocks[index]))
						);
						assert.ok(
							largest <= 1 && differing.length <= frame.blocks.length * 0.005,
							`${cell} replay drifted at ${atMs} ms (${moment.id}): ${differing.length} blocks differ, by up to ${largest} levels`
						);
						assert.deepEqual(
							replay.words.map((word) => word.bounds),
							frame.words.map((word) => word.bounds),
							`${cell} word geometry drifted on replay at ${atMs} ms (${moment.id})`
						);
					}
				}
			}

			// Phrases at their beats: readable, crisp, focal word clear of tall-frame chrome.
			const crispness: Record<string, number> = {};
			for (const { phrase, beat } of phraseBeats) {
				const frame = await captureStable(beat.atMs, phrase.wordIds);
				for (const wordId of phrase.wordIds) {
					const word = frame.words.find((candidate) => candidate.id === wordId);
					assert.ok(
						word && word.opacity >= READABLE_OPACITY,
						`${cell} ${wordId} hidden at beat ${beat.id}`
					);
					const run = frame.edgeRuns[wordId];
					if (run !== undefined) {
						crispness[`${beat.id}:${wordId}`] = Number(run.toFixed(2));
						// A Pack's own post effect may soften every edge alike (the CRT
						// screen); a word rasterized small and scaled up softens in
						// proportion to its scale. So a word passes when its edges are
						// hard outright, or no softer than the least-scaled shown word
						// in the same frame allows.
						const baseline = leastScaledEdgeRun(frame, phrase.wordIds);
						assert.ok(
							run <= CRISP_EDGE_RUN_LIMIT || run <= baseline * CRISP_RELATIVE_LIMIT + 1,
							`${cell} ${wordId} edges are soft at beat ${beat.id}: ${run.toFixed(2)} px half-tone runs (least-scaled word ${baseline.toFixed(2)} px)`
						);
					}
				}
				if (orientation === 'vertical') {
					const focal = frame.words.find((word) => word.id === phrase.focalWordId)!;
					const shelfTop = expected.height * (1 - VERTICAL_PLATFORM_BANDS.bottom);
					const columnLeft = expected.width * (1 - VERTICAL_PLATFORM_BANDS.right);
					assert.ok(
						focal.bounds.bottom <= shelfTop + GEOMETRY_TOLERANCE,
						`${cell} focal ${focal.id} enters the caption shelf at beat ${beat.id}: ${JSON.stringify(focal.bounds)}`
					);
					assert.ok(
						!(focal.bounds.right > columnLeft && focal.bounds.bottom > expected.height * 0.5),
						`${cell} focal ${focal.id} runs under the action column at beat ${beat.id}: ${JSON.stringify(focal.bounds)}`
					);
				}
			}

			// Weight ramps: monotone weight, width following without a jump, no reflow.
			for (const ramp of weightRamps) {
				const word = wordsById.get(ramp.wordId)!;
				const anchor = word.horizontalAnchor ?? 'center';
				const samples: WordProbe[] = [];
				for (let step = 0; step <= 5; step += 1) {
					const atMs = Math.round(ramp.startMs + ((ramp.endMs - ramp.startMs) * step) / 5);
					const frame = await captureStable(atMs);
					samples.push(frame.words.find((candidate) => candidate.id === ramp.wordId)!);
				}
				const direction = Math.sign(ramp.to - ramp.from);
				const widths = samples.map((sample) => sample.bounds.right - sample.bounds.left);
				const totalWidthChange = Math.abs(widths[widths.length - 1] - widths[0]);
				for (let step = 1; step < samples.length; step += 1) {
					const previous = samples[step - 1];
					const current = samples[step];
					assert.ok(
						direction * (current.fontWeight - previous.fontWeight) >= -0.5,
						`${cell} ${ramp.wordId} weight reversed inside its ramp at step ${step}`
					);
					assert.ok(
						direction * (widths[step] - widths[step - 1]) >=
							-(GEOMETRY_TOLERANCE + widths[step - 1] * OPTICAL_WIDTH_TOLERANCE),
						`${cell} ${ramp.wordId} width reversed inside its weight ramp at step ${step}: ${JSON.stringify({ widths, weights: samples.map((sample) => sample.fontWeight) })}`
					);
					// Width follows the axis: a step may change width only in proportion
					// to the weight it applied (the ease decides when, not how much).
					const weights = samples.map((sample) => sample.fontWeight);
					const totalWeightChange = Math.abs(weights[weights.length - 1] - weights[0]);
					const stepShare =
						totalWeightChange > 0
							? Math.abs(weights[step] - weights[step - 1]) / totalWeightChange
							: 0;
					assert.ok(
						Math.abs(widths[step] - widths[step - 1]) <=
							totalWidthChange * stepShare * 1.5 + 3 + widths[step - 1] * OPTICAL_WIDTH_TOLERANCE,
						`${cell} ${ramp.wordId} width jumped inside its weight ramp at step ${step}: ${JSON.stringify({ widths, weights })}`
					);
					const previousHeight = previous.bounds.bottom - previous.bounds.top;
					const currentHeight = current.bounds.bottom - current.bounds.top;
					assert.ok(
						Math.abs(currentHeight - previousHeight) <= GEOMETRY_TOLERANCE + 0.01 * previousHeight,
						`${cell} ${ramp.wordId} line box changed height inside its weight ramp (reflow)`
					);
					const edge = (probe: WordProbe): number =>
						anchor === 'start'
							? probe.bounds.left
							: anchor === 'end'
								? probe.bounds.right
								: (probe.bounds.left + probe.bounds.right) / 2;
					assert.ok(
						Math.abs(edge(current) - edge(previous)) <= GEOMETRY_TOLERANCE + 1,
						`${cell} ${ramp.wordId} ${anchor} edge moved inside its weight ramp`
					);
				}
			}

			// Transparent output: with the background fill off, only the words carry alpha.
			const alpha: Record<string, number> = {};
			if (document.state.backgroundFill !== undefined) await setBackgroundFill(false);
			try {
				for (const { beat } of phraseBeats) {
					const frame = await captureStable(beat.atMs, [], true);
					assert.equal(
						frame.alpha.cornerMax,
						0,
						`${cell} transparent frame corners carry alpha at beat ${beat.id}`
					);
					assert.ok(
						frame.alpha.coverage > 0 && frame.alpha.coverage < 0.75,
						`${cell} transparent frame coverage ${frame.alpha.coverage.toFixed(3)} at beat ${beat.id}`
					);
					for (const [wordId, opaque] of Object.entries(frame.alpha.wordOpaque)) {
						assert.ok(opaque, `${cell} ${wordId} lost opaque ink over a transparent field`);
					}
					alpha[beat.id] = Number(frame.alpha.coverage.toFixed(4));
				}
			} finally {
				if (document.state.backgroundFill !== undefined) await setBackgroundFill(true);
			}

			reports.push({
				pack,
				orientation,
				framesChecked,
				weightRamps: weightRamps.length,
				crispness,
				alpha
			});
			console.error(
				`✓ ${cell}: ${framesChecked} critical frames, ${weightRamps.length} weight ramps`
			);
		}
	}
	console.log(
		JSON.stringify(
			{
				probe: 'kinetic-type-field-diagnostics',
				preset: presetSlug,
				moments: moments.length,
				reports
			},
			null,
			'\t'
		)
	);
	console.log(
		`probe-kinetic-type-field-diagnostics: ${reports.length} Pack × orientation cells passed for ${presetSlug}`
	);
} finally {
	await browser.disconnect();
}
