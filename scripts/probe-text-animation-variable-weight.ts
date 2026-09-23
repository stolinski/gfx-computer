#!/usr/bin/env -S node --experimental-strip-types
/**
 * Runtime proof for the Pack-mapped TextAnimation variable-weight substrate.
 *
 * Requires a jailed app server and the sanctioned CanvasDrawElement Chrome:
 *   GFX_PROBE_BASE_URL=http://127.0.0.1:5173 \
 *   CDP_URL=http://127.0.0.1:9223 \
 *   pnpm probe:text-animation-weight
 */
import assert from 'node:assert/strict';

import { connectCdpRenderBrowser } from './cdp-render-page.ts';

const baseUrl = process.env.GFX_PROBE_BASE_URL ?? 'http://127.0.0.1:5173';
const cdpUrl = process.env.CDP_URL ?? 'http://127.0.0.1:9223';
const presetUrl = `${baseUrl}/p/text-anim-variable-weight?source=builtin`;
const orientations = ['horizontal', 'vertical'] as const;
const ENTER_PROGRESS_SAMPLES = [
	0.08, 0.0875, 0.095, 0.1025, 0.11, 0.1175, 0.125, 0.1325, 0.14, 0.1475, 0.155, 0.1625, 0.17
];

interface UnitSnapshot {
	fontFamily: string;
	fontWeight: number;
	fontVariationSettings: string;
	fontSynthesis: string;
	opacity: number;
	rect: { x: number; y: number; width: number; height: number };
}

interface FrameSnapshot {
	progress: number;
	rootRect: { x: number; y: number; width: number; height: number };
	units: UnitSnapshot[];
}

interface BrowserProbeResult {
	canvas: { width: number; height: number };
	fontFaces: Array<{ family: string; weight: string; status: string }>;
	fontChecks: { minimum: boolean; rest: boolean; maximum: boolean };
	frames: FrameSnapshot[];
	settled: FrameSnapshot;
	replay: FrameSnapshot;
}

function maximumAdjacentDelta(
	frames: readonly FrameSnapshot[],
	read: (snapshot: FrameSnapshot, unitIndex: number) => number
): number {
	let maximum = 0;
	for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
		for (let unitIndex = 0; unitIndex < frames[frameIndex]!.units.length; unitIndex += 1) {
			maximum = Math.max(
				maximum,
				Math.abs(read(frames[frameIndex]!, unitIndex) - read(frames[frameIndex - 1]!, unitIndex))
			);
		}
	}
	return maximum;
}

function assertNear(actual: number, expected: number, message: string): void {
	assert.ok(
		Math.abs(actual - expected) <= 0.1,
		`${message}: expected ${expected}, received ${actual}`
	);
}

const browser = await connectCdpRenderBrowser(cdpUrl);
try {
	await browser.page.goto(presetUrl, { waitUntil: 'load', timeout: 30_000 });
	await browser.page.waitForFunction(
		() => {
			const canvas = [...document.querySelectorAll('canvas')].sort(
				(a, b) => b.width * b.height - a.width * a.height
			)[0];
			return (
				document.readyState === 'complete' &&
				Boolean(window.__gfxTimeline) &&
				Boolean(canvas) &&
				document.body.textContent?.includes('Text animation — variable weight')
			);
		},
		undefined,
		{ timeout: 30_000 }
	);

	const packSlugs = await browser.page.evaluate<string[]>(() => {
		const packSelect = [...document.querySelectorAll('select')].find((candidate) =>
			[...candidate.options].some((option) => option.value === 'syntax')
		);
		if (!packSelect) throw new Error('Pack control is unavailable');
		return [...packSelect.children]
			.filter((child): child is HTMLOptionElement => child instanceof HTMLOptionElement)
			.map((option) => option.value)
			.filter(Boolean);
	});
	assert.ok(packSlugs.length > 0, 'the live Pack registry exposed no choices');

	const reports: Array<{
		pack: string;
		orientation: (typeof orientations)[number];
		intermediateWeights: number[];
		maxUnitXStep: number;
		maxUnitYStep: number;
		maxUnitWidthStep: number;
	}> = [];

	for (const orientation of orientations) {
		for (const packSlug of packSlugs) {
			const expectedCanvas =
				orientation === 'horizontal'
					? { width: 3840, height: 2160 }
					: { width: 2160, height: 3840 };

			await browser.page.evaluate(
				({ targetOrientation, targetPack }) => {
					const orientationLabel =
						targetOrientation === 'vertical' ? 'Switch to vertical' : 'Switch to horizontal';
					const canvas = [...document.querySelectorAll('canvas')].sort(
						(a, b) => b.width * b.height - a.width * a.height
					)[0];
					const expectedWidth = targetOrientation === 'vertical' ? 2160 : 3840;
					if (canvas?.width !== expectedWidth) {
						const orientationButton = document.querySelector<HTMLButtonElement>(
							`button[aria-label="${orientationLabel}"]`
						);
						if (!orientationButton) throw new Error(`Missing ${orientationLabel} control`);
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
					const title = document.querySelector<HTMLElement>('[data-text-anim-slot="title"]');
					const family = title
						? getComputedStyle(title).getPropertyValue('--variableWeightFont')
						: '';
					return (
						canvas?.width === expectedWidth &&
						canvas.height === expectedHeight &&
						document.fonts.status === 'loaded' &&
						document.querySelectorAll('[data-text-anim-slot="title"] .text-anim-word').length ===
							3 &&
						family.trim().length > 0
					);
				},
				{
					expectedWidth: expectedCanvas.width,
					expectedHeight: expectedCanvas.height
				},
				{ timeout: 30_000 }
			);

			const treatment = await browser.page.evaluate<{
				fontFamily: string;
				minimum: number;
				rest: number;
				maximum: number;
			}>(() => {
				const title = document.querySelector<HTMLElement>('[data-text-anim-slot="title"]');
				if (!title) throw new Error('Variable-weight title is unavailable');
				const style = getComputedStyle(title);
				return {
					fontFamily: style
						.getPropertyValue('--variableWeightFont')
						.split(',')[0]!
						.trim()
						.replace(/^(?:"|')(.*)(?:"|')$/, '$1'),
					minimum: Number(style.getPropertyValue('--variableWeightMin')),
					rest: Number(style.getPropertyValue('--variableWeightRest')),
					maximum: Number(style.getPropertyValue('--variableWeightMax'))
				};
			});
			assert.ok(treatment.fontFamily.length > 0, `${packSlug} has no variable family`);
			assert.ok(
				Number.isFinite(treatment.minimum) &&
					treatment.minimum <= treatment.rest &&
					treatment.rest <= treatment.maximum,
				`${packSlug} exposed an invalid variable-weight range`
			);
			const primaryFamily = treatment.fontFamily;

			const result = await browser.page.evaluate<
				BrowserProbeResult,
				{
					family: string;
					minimum: number;
					rest: number;
					maximum: number;
					progressSamples: number[];
				}
			>(
				async ({ family, minimum, rest, maximum, progressSamples }) => {
					await document.fonts.ready;
					const canvas = [...document.querySelectorAll('canvas')].sort(
						(a, b) => b.width * b.height - a.width * a.height
					)[0];
					const title = document.querySelector<HTMLElement>('[data-text-anim-slot="title"]');
					if (!canvas || !title || !window.__gfxTimeline)
						throw new Error('Probe target is unavailable');

					const snapshot = async (progress: number): Promise<FrameSnapshot> => {
						window.__gfxTimeline.pause();
						window.__gfxTimeline.seekProgress(progress);
						await new Promise<void>((resolvePromise) =>
							requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()))
						);
						const rootRect = title.getBoundingClientRect();
						const units = [...title.querySelectorAll<HTMLElement>('.text-anim-word')].map(
							(unit) => {
								const style = getComputedStyle(unit);
								const rect = unit.getBoundingClientRect();
								return {
									fontFamily: style.fontFamily,
									fontWeight: Number(style.fontWeight),
									fontVariationSettings: style.fontVariationSettings,
									fontSynthesis: style.fontSynthesis,
									opacity: Number(style.opacity),
									rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
								};
							}
						);
						return {
							progress,
							rootRect: {
								x: rootRect.x,
								y: rootRect.y,
								width: rootRect.width,
								height: rootRect.height
							},
							units
						};
					};

					const frames: FrameSnapshot[] = [];
					for (const progress of progressSamples) frames.push(await snapshot(progress));
					const settled = await snapshot(0.5);
					await snapshot(0.25);
					const replay = await snapshot(0.5);
					const normalizedFamily = family.replaceAll('"', '');
					return {
						canvas: { width: canvas.width, height: canvas.height },
						fontFaces: [...document.fonts]
							.filter((face) => face.family.replaceAll('"', '') === normalizedFamily)
							.map((face) => ({ family: face.family, weight: face.weight, status: face.status })),
						fontChecks: {
							minimum: document.fonts.check(`normal ${minimum} 64px "${normalizedFamily}"`, 'TYPE'),
							rest: document.fonts.check(`normal ${rest} 64px "${normalizedFamily}"`, 'TYPE'),
							maximum: document.fonts.check(`normal ${maximum} 64px "${normalizedFamily}"`, 'TYPE')
						},
						frames,
						settled,
						replay
					};
				},
				{
					family: primaryFamily,
					minimum: treatment.minimum,
					rest: treatment.rest,
					maximum: treatment.maximum,
					progressSamples: ENTER_PROGRESS_SAMPLES
				}
			);

			assert.deepEqual(
				result.canvas,
				expectedCanvas,
				`${orientation} must render at native resolution`
			);
			assert.ok(result.fontFaces.length > 0, `${packSlug} did not register ${primaryFamily}`);
			assert.ok(
				result.fontFaces.some((face) => face.status === 'loaded'),
				`${packSlug} did not load ${primaryFamily}`
			);
			assert.deepEqual(
				result.fontChecks,
				{ minimum: true, rest: true, maximum: true },
				`${packSlug} did not resolve its complete wght range`
			);
			assert.equal(
				result.settled.units.length,
				3,
				'the proof title must remain split into three words'
			);
			for (const [unitIndex, unit] of result.settled.units.entries()) {
				assert.ok(
					unit.fontFamily.includes(primaryFamily),
					`${packSlug} unit ${unitIndex} used ${unit.fontFamily} instead of ${primaryFamily}`
				);
				assertNear(unit.fontWeight, treatment.rest, `${packSlug} unit ${unitIndex} rest weight`);
				assert.match(
					unit.fontVariationSettings,
					new RegExp(`(?:"|')wght(?:"|')\\s+${treatment.rest}(?:\\.0+)?`),
					`${packSlug} unit ${unitIndex} must apply the real wght axis`
				);
				assert.equal(unit.fontSynthesis, 'none', `${packSlug} unit ${unitIndex} enabled synthesis`);
				assert.equal(unit.opacity, 1, `${packSlug} unit ${unitIndex} did not settle visibly`);
			}
			assert.deepEqual(result.replay, result.settled, `${packSlug} ${orientation} replay drifted`);

			const intermediateWeights = result.frames
				.flatMap((frame) => frame.units.map((unit) => unit.fontWeight))
				.filter((weight) => weight > treatment.minimum + 0.1 && weight < treatment.rest - 0.1);
			assert.ok(intermediateWeights.length > 0, `${packSlug} produced no interpolated wght value`);

			const maxUnitXStep = maximumAdjacentDelta(
				result.frames,
				(frame, index) => frame.units[index]!.rect.x
			);
			const maxUnitYStep = maximumAdjacentDelta(
				result.frames,
				(frame, index) => frame.units[index]!.rect.y
			);
			const maxUnitWidthStep = maximumAdjacentDelta(
				result.frames,
				(frame, index) => frame.units[index]!.rect.width
			);
			assert.ok(
				maxUnitXStep < expectedCanvas.width * 0.01,
				`${packSlug} has a horizontal layout jump (${maxUnitXStep}px)`
			);
			assert.ok(
				maxUnitYStep < expectedCanvas.height * 0.01,
				`${packSlug} has a vertical layout jump (${maxUnitYStep}px)`
			);
			assert.ok(
				maxUnitWidthStep < expectedCanvas.width * 0.01,
				`${packSlug} has a width jump (${maxUnitWidthStep}px)`
			);

			reports.push({
				pack: packSlug,
				orientation,
				intermediateWeights: [
					...new Set(intermediateWeights.map((weight) => Math.round(weight * 100) / 100))
				].slice(0, 6),
				maxUnitXStep: Math.round(maxUnitXStep * 100) / 100,
				maxUnitYStep: Math.round(maxUnitYStep * 100) / 100,
				maxUnitWidthStep: Math.round(maxUnitWidthStep * 100) / 100
			});
		}
	}

	console.log(JSON.stringify({ probe: 'text-animation-variable-weight', reports }, null, '\t'));
	console.log(
		`probe-text-animation-variable-weight: ${reports.length} Pack × orientation cases passed`
	);
} finally {
	await browser.disconnect();
}
