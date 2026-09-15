#!/usr/bin/env -S node --experimental-strip-types
/**
 * Runtime proof for the static Type Field substrate.
 *
 * Requires a jailed app server and the sanctioned CanvasDrawElement Chrome:
 *   GFX_PROBE_BASE_URL=http://127.0.0.1:5173 \
 *   CDP_URL=http://127.0.0.1:9229 \
 *   pnpm probe:kinetic-type-field
 */
import assert from 'node:assert/strict';

import { getLayoutSafeArea } from '../src/lib/utils/safe-area.ts';
import { connectCdpRenderBrowser } from './cdp-render-page.ts';

const baseUrl = process.env.GFX_PROBE_BASE_URL ?? 'http://127.0.0.1:5173';
const cdpUrl = process.env.CDP_URL ?? 'http://127.0.0.1:9229';
const presetUrl = `${baseUrl}/p/kinetic-type-field-static-fixture?source=builtin`;
const orientations = ['horizontal', 'vertical'] as const;
const EXPECTED_WORDS = [
	{
		id: 'type',
		text: 'TYPE',
		hierarchy: 'display',
		horizontal: [0.16, 0.2],
		vertical: [0.5, 0.14]
	},
	{
		id: 'can',
		text: 'CAN',
		hierarchy: 'support',
		horizontal: [0.38, 0.35],
		vertical: [0.25, 0.29]
	},
	{
		id: 'move',
		text: 'MOVE',
		hierarchy: 'display',
		horizontal: [0.63, 0.28],
		vertical: [0.55, 0.35]
	},
	{
		id: 'become',
		text: 'BECOME',
		hierarchy: 'display',
		horizontal: [0.68, 0.58],
		vertical: [0.5, 0.52]
	},
	{ id: 'is', text: 'IS', hierarchy: 'support', horizontal: [0.34, 0.62], vertical: [0.28, 0.66] },
	{
		id: 'the',
		text: 'THE',
		hierarchy: 'support',
		horizontal: [0.43, 0.77],
		vertical: [0.48, 0.73]
	},
	{
		id: 'composition',
		text: 'COMPOSITION',
		hierarchy: 'display',
		horizontal: [0.7, 0.8],
		vertical: [0.5, 0.79]
	}
] as const;

interface KineticWordRuntimeSnapshot {
	id: string;
	text: string;
	readableId: string;
	textRole: string;
	fontFamily: string;
	fontWeight: number;
	fontVariationSettings: string;
	fontSynthesis: string;
	center: { x: number; y: number };
	bounds: { left: number; top: number; right: number; bottom: number };
}

interface KineticTypeFieldRuntimeSnapshot {
	canvas: { width: number; height: number };
	fieldBounds: { left: number; top: number; width: number; height: number };
	fontFamily: string;
	minimumWeight: number;
	restWeight: number;
	maximumWeight: number;
	fontReady: boolean;
	words: KineticWordRuntimeSnapshot[];
	pixelDigest: string;
}

function assertNear(actual: number, expected: number, message: string): void {
	assert.ok(
		Math.abs(actual - expected) <= 1,
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
				document.body.textContent?.includes('Kinetic Type Field Static Fixture') &&
				document.querySelectorAll('[data-kinetic-word]').length === 7
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
		return [...packSelect.options].map((option) => option.value).filter(Boolean);
	});
	assert.ok(packSlugs.length > 0, 'the live Pack registry exposed no choices');

	const reports: Array<{
		pack: string;
		orientation: (typeof orientations)[number];
		canvas: { width: number; height: number };
		fontFamily: string;
		restWeight: number;
		pixelDigest: string;
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
					const firstWord = document.querySelector<HTMLElement>('[data-kinetic-word]');
					const variableFamily = firstWord
						? getComputedStyle(firstWord).getPropertyValue('--variableWeightFont').trim()
						: '';
					const primaryFamily = variableFamily
						.split(',')[0]!
						.trim()
						.replace(/^(?:"|')(.*)(?:"|')$/, '$1');
					const renderedFamily = firstWord?.querySelector<HTMLElement>('.kinetic-word')
						? getComputedStyle(firstWord.querySelector<HTMLElement>('.kinetic-word')!).fontFamily
						: '';
					return (
						canvas?.width === expectedWidth &&
						canvas.height === expectedHeight &&
						document.fonts.status === 'loaded' &&
						document.querySelectorAll('[data-kinetic-word]').length === 7 &&
						primaryFamily.length > 0 &&
						renderedFamily.includes(primaryFamily)
					);
				},
				{ expectedWidth: expectedCanvas.width, expectedHeight: expectedCanvas.height },
				{ timeout: 30_000 }
			);

			const captureSnapshot = async (progress: number): Promise<KineticTypeFieldRuntimeSnapshot> =>
				browser.page.evaluate<KineticTypeFieldRuntimeSnapshot, number>(async (targetProgress) => {
					const canvas = [...document.querySelectorAll('canvas')].sort(
						(a, b) => b.width * b.height - a.width * a.height
					)[0];
					const field = document.querySelector<HTMLElement>('.kinetic-type-field');
					const firstWord = document.querySelector<HTMLElement>('[data-kinetic-word]');
					if (!canvas || !field || !firstWord || !window.__gfxTimeline) {
						throw new Error('Static Type Field probe target is unavailable');
					}

					const appearance = getComputedStyle(firstWord);
					const normalizedFamily = appearance
						.getPropertyValue('--variableWeightFont')
						.split(',')[0]!
						.trim()
						.replace(/^(?:"|')(.*)(?:"|')$/, '$1');
					const minimumWeight = Number(appearance.getPropertyValue('--variableWeightMin'));
					const restWeight = Number(appearance.getPropertyValue('--variableWeightRest'));
					const maximumWeight = Number(appearance.getPropertyValue('--variableWeightMax'));
					await document.fonts.load(
						`normal ${restWeight} 64px "${normalizedFamily}"`,
						'TYPE CAN MOVE BECOME IS THE COMPOSITION'
					);
					await document.fonts.ready;
					window.__gfxTimeline.pause();
					window.__gfxTimeline.seekProgress(targetProgress);
					await new Promise<void>((resolvePromise) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()))
					);
					const fieldRect = field.getBoundingClientRect();
					const words = [...document.querySelectorAll<HTMLElement>('[data-kinetic-word]')].map(
						(wrapper) => {
							const text = wrapper.querySelector<HTMLElement>('.kinetic-word');
							if (!text)
								throw new Error(`Kinetic Word ${wrapper.dataset.kineticWord} has no text source`);
							const rect = wrapper.getBoundingClientRect();
							const style = getComputedStyle(text);
							return {
								id: wrapper.dataset.kineticWord ?? '',
								text: text.textContent ?? '',
								readableId: text.dataset.gfxReadableId ?? '',
								textRole: text.dataset.gfxTextRole ?? '',
								fontFamily: style.fontFamily,
								fontWeight: Number(style.fontWeight),
								fontVariationSettings: style.fontVariationSettings,
								fontSynthesis: style.fontSynthesis,
								center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
								bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
							};
						}
					);
					const blob = await new Promise<Blob>((resolvePromise, reject) =>
						canvas.toBlob(
							(value) => (value ? resolvePromise(value) : reject(new Error('PNG unavailable'))),
							'image/png'
						)
					);
					const digestBytes = new Uint8Array(
						await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
					);
					return {
						canvas: { width: canvas.width, height: canvas.height },
						fieldBounds: {
							left: fieldRect.left,
							top: fieldRect.top,
							width: fieldRect.width,
							height: fieldRect.height
						},
						fontFamily: normalizedFamily,
						minimumWeight,
						restWeight,
						maximumWeight,
						fontReady: document.fonts.check(
							`normal ${restWeight} 64px "${normalizedFamily}"`,
							'TYPE'
						),
						words,
						pixelDigest: [...digestBytes]
							.map((value) => value.toString(16).padStart(2, '0'))
							.join('')
					};
				}, progress);

			const settled = await captureSnapshot(0.5);
			await captureSnapshot(0.1);
			const replay = await captureSnapshot(0.5);

			assert.deepEqual(
				settled.canvas,
				expectedCanvas,
				`${orientation} must render at native resolution`
			);
			assert.ok(settled.fontFamily.length > 0, `${packSlug} has no variable family`);
			assert.ok(
				Number.isFinite(settled.minimumWeight) &&
					settled.minimumWeight <= settled.restWeight &&
					settled.restWeight <= settled.maximumWeight,
				`${packSlug} exposed an invalid variable-weight range`
			);
			assert.equal(settled.fontReady, true, `${packSlug} did not load ${settled.fontFamily}`);
			assert.equal(
				settled.words.length,
				EXPECTED_WORDS.length,
				'the complete word pool must render once'
			);

			const safeArea = getLayoutSafeArea(orientation);
			for (const expected of EXPECTED_WORDS) {
				const word = settled.words.find((candidate) => candidate.id === expected.id);
				assert.ok(word, `missing Kinetic Word ${expected.id}`);
				assert.equal(word.text, expected.text, `${expected.id} text drifted`);
				assert.equal(
					word.readableId,
					`block:${expected.id}:text`,
					`${expected.id} readable identity drifted`
				);
				assert.equal(
					word.textRole,
					expected.hierarchy === 'display' ? 'surface-display' : 'surface-title',
					`${expected.id} readable role drifted`
				);
				assert.ok(
					word.fontFamily.includes(settled.fontFamily),
					`${expected.id} used ${word.fontFamily} instead of ${settled.fontFamily}`
				);
				assertNear(word.fontWeight, settled.restWeight, `${expected.id} rest weight`);
				assert.match(
					word.fontVariationSettings,
					new RegExp(`(?:"|')wght(?:"|')\\s+${settled.restWeight}(?:\\.0+)?`),
					`${expected.id} must apply the real wght axis`
				);
				assert.equal(word.fontSynthesis, 'none', `${expected.id} enabled font synthesis`);

				const [expectedX, expectedY] = expected[orientation];
				assertNear(
					word.center.x,
					settled.fieldBounds.left + expectedX * settled.fieldBounds.width,
					`${expected.id} ${orientation} x placement`
				);
				assertNear(
					word.center.y,
					settled.fieldBounds.top + expectedY * settled.fieldBounds.height,
					`${expected.id} ${orientation} y placement`
				);
				assert.ok(
					word.bounds.left >=
						settled.fieldBounds.left + safeArea.left * settled.fieldBounds.width - 1 &&
						word.bounds.right <=
							settled.fieldBounds.left + (1 - safeArea.right) * settled.fieldBounds.width + 1 &&
						word.bounds.top >=
							settled.fieldBounds.top + safeArea.top * settled.fieldBounds.height - 1 &&
						word.bounds.bottom <=
							settled.fieldBounds.top + (1 - safeArea.bottom) * settled.fieldBounds.height + 1,
					`${expected.id} extends beyond the ${orientation} safe area`
				);
			}

			assert.deepEqual(replay, settled, `${packSlug} ${orientation} replay drifted`);
			reports.push({
				pack: packSlug,
				orientation,
				canvas: settled.canvas,
				fontFamily: settled.fontFamily,
				restWeight: settled.restWeight,
				pixelDigest: settled.pixelDigest
			});
		}
	}

	console.log(JSON.stringify({ probe: 'kinetic-type-field-static', reports }, null, '\t'));
	console.log(`probe-kinetic-type-field-static: ${reports.length} Pack × orientation cases passed`);
} finally {
	await browser.disconnect();
}
