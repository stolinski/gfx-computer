#!/usr/bin/env -S node --experimental-strip-types
/**
 * Native Pack × orientation proof for independent Kinetic Word channels.
 *
 * Requires a jailed app server and sanctioned CanvasDrawElement Chrome:
 *   GFX_PROBE_BASE_URL=http://127.0.0.1:5173 \
 *   CDP_URL=http://127.0.0.1:9229 \
 *   pnpm probe:kinetic-type-field-motion
 */
import assert from 'node:assert/strict';

import { getLayoutSafeArea } from '../src/lib/utils/safe-area.ts';
import { connectCdpRenderBrowser } from './cdp-render-page.ts';

const baseUrl = process.env.GFX_PROBE_BASE_URL ?? 'http://127.0.0.1:5173';
const cdpUrl = process.env.CDP_URL ?? 'http://127.0.0.1:9229';
const presetUrl = `${baseUrl}/p/kinetic-type-field-motion-fixture?source=builtin`;
const orientations = ['horizontal', 'vertical'] as const;
const PHRASE_SAMPLES = [
	{ progress: 0.15, visible: ['type', 'can', 'move'] },
	{ progress: 0.42, visible: ['type', 'can', 'become'] },
	{ progress: 0.8, visible: ['type', 'is', 'the', 'composition'] }
] as const;
const TYPE_STRIKE_PROGRESS = 0.08;
const CANONICAL_RASTER_BLOCK_SIZE = 32;
const CANONICAL_RASTER_QUANTIZATION_STEP = 32;

interface MotionWordSnapshot {
	id: string;
	opacity: number;
	fontFamily: string;
	color: string;
	fontWeight: number;
	fontVariationSettings: string;
	fontSynthesis: string;
	center: { x: number; y: number };
	bounds: { left: number; top: number; right: number; bottom: number };
}

interface MotionFrameSnapshot {
	canvas: { width: number; height: number };
	fieldBounds: { left: number; top: number; width: number; height: number };
	fontFamily: string;
	minimumWeight: number;
	maximumWeight: number;
	words: MotionWordSnapshot[];
	pixelDigest: string;
}

function assertNear(actual: number, expected: number, tolerance: number, message: string): void {
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		`${message}: expected ${expected} ± ${tolerance}, received ${actual}`
	);
}

const browser = await connectCdpRenderBrowser(cdpUrl);
try {
	await browser.page.goto(presetUrl, { waitUntil: 'load', timeout: 30_000 });
	await browser.page.waitForFunction(
		() =>
			document.readyState === 'complete' &&
			Boolean(window.__gfxTimeline) &&
			document.body.textContent?.includes('Kinetic Type Field Motion Fixture') &&
			document.querySelectorAll('[data-kinetic-word]').length === 7,
		undefined,
		{ timeout: 30_000 }
	);

	const packSlugs = await browser.page.evaluate<string[]>(() => {
		const packSelect = [...document.querySelectorAll('select')].find((candidate) =>
			[...candidate.options].some((option) => option.value === 'syntax')
		);
		if (!packSelect) throw new Error('Pack control is unavailable');
		return [...packSelect.options].map((option) => option.value).filter(Boolean);
	});
	assert.ok(packSlugs.length > 0, 'the live Pack registry exposed no choices');

	const reports: Array<{
		pack: string;
		orientation: (typeof orientations)[number];
		phraseDigests: string[];
		typeCenters: Array<{ x: number; y: number }>;
		strikeWeight: number;
	}> = [];

	for (const orientation of orientations) {
		for (const packSlug of packSlugs) {
			const expectedCanvas =
				orientation === 'horizontal'
					? { width: 3840, height: 2160 }
					: { width: 2160, height: 3840 };
			await browser.page.evaluate(
				({ targetOrientation, targetPack }) => {
					const canvas = [...document.querySelectorAll('canvas')].sort(
						(a, b) => b.width * b.height - a.width * a.height
					)[0];
					const expectedWidth = targetOrientation === 'vertical' ? 2160 : 3840;
					if (canvas?.width !== expectedWidth) {
						const label =
							targetOrientation === 'vertical' ? 'Switch to vertical' : 'Switch to horizontal';
						const orientationButton = document.querySelector<HTMLButtonElement>(
							`button[aria-label="${label}"]`
						);
						if (!orientationButton) throw new Error(`Missing ${label} control`);
						orientationButton.click();
					}
					const packSelect = [...document.querySelectorAll('select')].find((candidate) =>
						[...candidate.options].some((option) => option.value === targetPack)
					);
					if (!packSelect) throw new Error(`Missing Pack control for ${targetPack}`);
					if (packSelect.value !== targetPack) {
						packSelect.value = targetPack;
						packSelect.dispatchEvent(new Event('change', { bubbles: true }));
					}
				},
				{ targetOrientation: orientation, targetPack: packSlug }
			);
			await browser.page.evaluate(async () => {
				await new Promise<void>((resolvePromise) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()))
				);
			});
			await browser.page.waitForFunction(
				({ expectedWidth, expectedHeight }) => {
					const canvas = [...document.querySelectorAll('canvas')].sort(
						(a, b) => b.width * b.height - a.width * a.height
					)[0];
					const word = document.querySelector<HTMLElement>('[data-kinetic-word]');
					const source = word?.querySelector<HTMLElement>('.kinetic-word');
					const variableFamily = word
						? getComputedStyle(word).getPropertyValue('--variableWeightFont').trim()
						: '';
					const primaryFamily = variableFamily
						.split(',')[0]!
						.trim()
						.replace(/^(?:"|')(.*)(?:"|')$/, '$1');
					return (
						canvas?.width === expectedWidth &&
						canvas.height === expectedHeight &&
						document.fonts.status === 'loaded' &&
						primaryFamily.length > 0 &&
						Boolean(source && getComputedStyle(source).fontFamily.includes(primaryFamily))
					);
				},
				{ expectedWidth: expectedCanvas.width, expectedHeight: expectedCanvas.height },
				{ timeout: 30_000 }
			);

			const captureFrame = async (progress: number): Promise<MotionFrameSnapshot> =>
				browser.page.evaluate<
					MotionFrameSnapshot,
					{ progress: number; blockSize: number; quantizationStep: number }
				>(
					async ({ progress: targetProgress, blockSize, quantizationStep }) => {
						const canvas = [...document.querySelectorAll('canvas')].sort(
							(a, b) => b.width * b.height - a.width * a.height
						)[0];
						const field = document.querySelector<HTMLElement>('.kinetic-type-field');
						const firstWord = document.querySelector<HTMLElement>('[data-kinetic-word]');
						if (
							!canvas ||
							!field ||
							!firstWord ||
							!window.__gfxTimeline ||
							!window.__gfxCapturePosterFrameAt
						) {
							throw new Error('Kinetic Type motion probe target is unavailable');
						}
						const appearance = getComputedStyle(firstWord);
						const fontFamily = appearance
							.getPropertyValue('--variableWeightFont')
							.split(',')[0]!
							.trim()
							.replace(/^(?:"|')(.*)(?:"|')$/, '$1');
						const minimumWeight = Number(appearance.getPropertyValue('--variableWeightMin'));
						const maximumWeight = Number(appearance.getPropertyValue('--variableWeightMax'));
						await document.fonts.load(
							`normal ${maximumWeight} 64px "${fontFamily}"`,
							'TYPE CAN MOVE BECOME IS THE COMPOSITION'
						);
						await document.fonts.ready;
						const captured = await window.__gfxCapturePosterFrameAt(
							targetProgress * window.__gfxTimeline.durationSeconds
						);
						if (!captured) throw new Error('Deterministic frame capture returned no image.');
						const fieldRect = field.getBoundingClientRect();
						const words = [...document.querySelectorAll<HTMLElement>('[data-kinetic-word]')].map(
							(wrapper) => {
								const text = wrapper.querySelector<HTMLElement>('.kinetic-word');
								if (!text) throw new Error('Kinetic Word text source is unavailable');
								const rect = wrapper.getBoundingClientRect();
								const textStyle = getComputedStyle(text);
								return {
									id: wrapper.dataset.kineticWord ?? '',
									opacity: Number(getComputedStyle(wrapper).opacity),
									fontFamily: textStyle.fontFamily,
									color: textStyle.color,
									fontWeight: Number(textStyle.fontWeight),
									fontVariationSettings: textStyle.fontVariationSettings,
									fontSynthesis: textStyle.fontSynthesis,
									center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
									bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
								};
							}
						);
						const capturedBytes = Uint8Array.from(atob(captured.webpBase64), (character) =>
							character.charCodeAt(0)
						);
						const bitmap = await createImageBitmap(
							new Blob([capturedBytes], { type: 'image/webp' })
						);
						let digest: Uint8Array;
						try {
							const analysisCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
							const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
							if (!context) throw new Error('Poster digest context is unavailable.');
							context.drawImage(bitmap, 0, 0);
							const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
							const canonicalChannels: number[] = [];
							for (let top = 0; top < image.height; top += blockSize) {
								for (let left = 0; left < image.width; left += blockSize) {
									const sums = [0, 0, 0, 0];
									let pixelCount = 0;
									for (let y = top; y < Math.min(top + blockSize, image.height); y += 1) {
										for (let x = left; x < Math.min(left + blockSize, image.width); x += 1) {
											const offset = (y * image.width + x) * 4;
											for (let channel = 0; channel < 4; channel += 1) {
												sums[channel] += image.data[offset + channel] ?? 0;
											}
											pixelCount += 1;
										}
									}
									for (const sum of sums) {
										canonicalChannels.push(Math.round(sum / pixelCount / quantizationStep));
									}
								}
							}
							digest = new Uint8Array(
								await crypto.subtle.digest('SHA-256', Uint8Array.from(canonicalChannels))
							);
						} finally {
							bitmap.close();
						}
						return {
							canvas: { width: canvas.width, height: canvas.height },
							fieldBounds: {
								left: fieldRect.left,
								top: fieldRect.top,
								width: fieldRect.width,
								height: fieldRect.height
							},
							fontFamily,
							minimumWeight,
							maximumWeight,
							words,
							pixelDigest: [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
						};
					},
					{
						progress,
						blockSize: CANONICAL_RASTER_BLOCK_SIZE,
						quantizationStep: CANONICAL_RASTER_QUANTIZATION_STEP
					}
				);

			// CanvasDrawElement can publish one older variable-glyph raster while a
			// forced Surface copy catches up. Readiness means two exact canonical
			// poster-grid digests agree; no wall-clock animation advances between attempts.
			const captureStableFrame = async (progress: number): Promise<MotionFrameSnapshot> => {
				let previous = await captureFrame(progress);
				for (let attempt = 0; attempt < 5; attempt += 1) {
					const current = await captureFrame(progress);
					if (current.pixelDigest === previous.pixelDigest) return current;
					previous = current;
				}
				throw new Error(
					`${packSlug} ${orientation} never produced two identical captures at ${progress}`
				);
			};

			await captureStableFrame(0);
			// Prime every representative phrase raster after a Pack or orientation
			// switch. The measured pass below still leaves each target and demands
			// exact replay when it returns.
			for (const sample of PHRASE_SAMPLES) await captureStableFrame(sample.progress);
			await captureStableFrame(TYPE_STRIKE_PROGRESS);

			const phraseFrames: MotionFrameSnapshot[] = [];
			for (const sample of PHRASE_SAMPLES) {
				const first = await captureStableFrame(sample.progress);
				await captureFrame(sample.progress === 0.15 ? 0.8 : 0.15);
				const replay = await captureStableFrame(sample.progress);
				assert.deepEqual(
					replay,
					first,
					`${packSlug} ${orientation} replay drifted at ${sample.progress}`
				);
				assert.deepEqual(first.canvas, expectedCanvas, `${orientation} must render natively`);
				for (const word of first.words) {
					const shouldBeVisible = sample.visible.includes(
						word.id as (typeof sample.visible)[number]
					);
					assertNear(
						word.opacity,
						shouldBeVisible ? 1 : 0,
						0.02,
						`${word.id} opacity at phrase ${sample.progress}`
					);
					assert.ok(word.fontFamily.includes(first.fontFamily), `${word.id} variable face drifted`);
					assert.equal(word.fontSynthesis, 'none', `${word.id} enabled font synthesis`);
				}
				const safeArea = getLayoutSafeArea(orientation);
				for (const word of first.words.filter((candidate) => candidate.opacity > 0.98)) {
					assert.ok(
						word.bounds.left >=
							first.fieldBounds.left + safeArea.left * first.fieldBounds.width - 1 &&
							word.bounds.right <=
								first.fieldBounds.left + (1 - safeArea.right) * first.fieldBounds.width + 1 &&
							word.bounds.top >=
								first.fieldBounds.top + safeArea.top * first.fieldBounds.height - 1 &&
							word.bounds.bottom <=
								first.fieldBounds.top + (1 - safeArea.bottom) * first.fieldBounds.height + 1,
						`${word.id} leaves the ${orientation} safe area at ${sample.progress}`
					);
				}
				phraseFrames.push(first);
			}

			assert.equal(
				new Set(phraseFrames.map((frame) => frame.pixelDigest)).size,
				PHRASE_SAMPLES.length,
				`${packSlug} ${orientation} phrase frames must differ`
			);
			const typeCenters = phraseFrames.map((frame) => {
				const type = frame.words.find((word) => word.id === 'type');
				assert.ok(type, 'persistent TYPE word is missing');
				return type.center;
			});
			assert.ok(
				typeCenters.some(
					(center, index) =>
						index > 0 &&
						(Math.abs(center.x - typeCenters[0].x) > 1 || Math.abs(center.y - typeCenters[0].y) > 1)
				),
				`${packSlug} ${orientation} persistent TYPE geometry never moved`
			);

			const strike = await captureFrame(TYPE_STRIKE_PROGRESS);
			const strikeType = strike.words.find((word) => word.id === 'type');
			assert.ok(strikeType, 'TYPE strike is missing');
			assertNear(
				strikeType.fontWeight,
				strike.maximumWeight,
				2,
				`${packSlug} ${orientation} TYPE did not strike the Pack maximum weight`
			);
			assert.match(strikeType.fontVariationSettings, /(?:"|')wght(?:"|')\s+[0-9.]+/u);

			reports.push({
				pack: packSlug,
				orientation,
				phraseDigests: phraseFrames.map((frame) => frame.pixelDigest),
				typeCenters,
				strikeWeight: strikeType.fontWeight
			});
		}
	}

	console.log(JSON.stringify({ probe: 'kinetic-type-field-motion', reports }, null, '\t'));
	console.log(`probe-kinetic-type-field-motion: ${reports.length} Pack × orientation cases passed`);
} finally {
	await browser.disconnect();
}
