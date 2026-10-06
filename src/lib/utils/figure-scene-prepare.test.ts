import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	FIGURE_KINDS,
	FigureSchema,
	type Figure,
	type FigureKind
} from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';
import type { FigureSceneItem } from './figure-scene';
import { prepareFigure } from './figure-scene-prepare';
import { wrapFigureText } from './figure-text';
import { bumpChartPath, fitTreemapLeafText, partialBumpSegment } from './figure-scene-data';
import { getVideoFrameSize, type VideoOrientation } from './video-frame';

const ORIENTATIONS: readonly VideoOrientation[] = ['horizontal', 'vertical'];
const SAMPLES = [0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.99];

function target(kind: FigureKind): Figure {
	return FigureSchema.parse(FIGURE_TARGET_DECLARATIONS[kind]);
}

function numericValues(item: FigureSceneItem): number[] {
	return Object.values(item).filter((value): value is number => typeof value === 'number');
}

function textExtent(item: Extract<FigureSceneItem, { shape: 'text' }>): [number, number] {
	if (item.anchor === 'start') return [item.x, item.x + item.width];
	if (item.anchor === 'end') return [item.x - item.width, item.x];
	return [item.x - item.width / 2, item.x + item.width / 2];
}

describe('prepareFigure over the nine targets', () => {
	for (const kind of FIGURE_KINDS) {
		for (const orientation of ORIENTATIONS) {
			it(`${kind} (${orientation}) builds finite, unique, deterministic scenes inside the frame`, () => {
				const figure = target(kind);
				const prepared = prepareFigure(figure, orientation);
				const again = prepareFigure(figure, orientation);
				const size = getVideoFrameSize(orientation);
				for (const progress of SAMPLES) {
					const scene = prepared.scene(progress, progress * 10_000);
					assert.deepEqual(scene, again.scene(progress, progress * 10_000));
					const keys = new Set<string>();
					for (const item of scene.items) {
						assert.ok(!keys.has(item.key), `duplicate key ${item.key} at ${progress}`);
						keys.add(item.key);
						for (const value of numericValues(item)) {
							assert.ok(
								Number.isFinite(value),
								`${item.key} has a non-finite number at ${progress}`
							);
						}
						if (item.shape === 'path') assert.ok(!item.d.includes('NaN'), `${item.key} path NaN`);
						if (item.shape === 'text' && item.opacity > 0.05) {
							const [left, right] = textExtent(item);
							assert.ok(
								left >= -2 && right <= size.width + 2,
								`${item.key} "${item.text}" leaves the frame (${Math.round(left)}–${Math.round(right)})`
							);
						}
					}
				}
			});
		}

		it(`${kind} is invisible before its reveal and visible after it`, () => {
			const figure = target(kind);
			const reveal = figure.moves.find((move) => move.move === 'reveal');
			assert.ok(reveal);
			const prepared = prepareFigure(figure, 'horizontal');
			if (reveal.start > 0) {
				const before = prepared.scene(reveal.start / 2, 0);
				assert.equal(before.alpha, 0);
				assert.equal(before.items.length, 0);
			}
			const after = prepared.scene(reveal.start + reveal.duration + 0.01, 0);
			assert.ok(after.alpha > 0);
			assert.ok(after.items.some((item) => item.opacity > 0.5));
		});
	}
});

describe('Figure Pins', () => {
	it('replace a label, hide a Mark, and move a node', () => {
		const base = target('tree');
		const figure: Figure = {
			...base,
			pins: [
				{ mark: 'node:english', label: 'English (you are here)' },
				{ mark: 'node:persian', hidden: true },
				{ mark: 'node:hindi', position: { x: 0.9, y: 0.9 }, orientation: 'horizontal' }
			]
		};
		const prepared = prepareFigure(figure, 'horizontal');
		const scene = prepared.scene(0.99, 9_900);
		const english = scene.items.find((item) => item.key === 'node:english#label');
		assert.ok(english && english.shape === 'text');
		assert.equal(english.text, 'English (you are here)');
		assert.ok(!scene.items.some((item) => item.key === 'node:persian'));
		const hindi = scene.items.find((item) => item.key === 'node:hindi');
		assert.ok(hindi && hindi.shape === 'circle');
		assert.ok(Math.abs(hindi.cx - (prepared.frame.x + prepared.frame.width * 0.9)) < 0.01);

		const vertical = prepareFigure(figure, 'vertical').scene(0.99, 9_900);
		const hindiVertical = vertical.items.find((item) => item.key === 'node:hindi');
		assert.ok(hindiVertical && hindiVertical.shape === 'circle');
		assert.notEqual(hindiVertical.cx, hindi.cx);
	});

	it('applies keyframed opacity and scale channels at composition time', () => {
		const base = target('cycle');
		const figure: Figure = {
			...base,
			pins: [
				{
					mark: 'node:evaporation',
					channels: {
						opacity: [
							{ atMs: 0, value: 1 },
							{ atMs: 5_000, value: 0.25 }
						],
						scale: [
							{ atMs: 0, value: 1 },
							{ atMs: 5_000, value: 2 }
						]
					}
				}
			]
		};
		const plain = prepareFigure(base, 'horizontal').scene(0.9, 9_000);
		const pinned = prepareFigure(figure, 'horizontal').scene(0.9, 9_000);
		const a = plain.items.find((item) => item.key === 'node:evaporation');
		const b = pinned.items.find((item) => item.key === 'node:evaporation');
		assert.ok(a && b && a.shape === 'circle' && b.shape === 'circle');
		assert.ok(Math.abs(b.r - a.r * 2) < 0.01);
		assert.ok(Math.abs(b.opacity - a.opacity * 0.25) < 0.01);
	});
});

describe('honest motion', () => {
	it('never grows a bar-race bar past its true value during the reveal', () => {
		const figure = target('bar-race');
		const prepared = prepareFigure(figure, 'horizontal');
		// The reveal ends at 0.14 and the advance starts at 0.16: 0.15 is the settled first frame.
		const settled = new Map(
			prepared
				.scene(0.15, 0)
				.items.flatMap((item) => (item.shape === 'rect' ? [[item.key, item.width] as const] : []))
		);
		for (let step = 0; step <= 40; step += 1) {
			for (const item of prepared.scene(0.02 + (0.12 * step) / 40, 0).items) {
				if (item.shape !== 'rect') continue;
				assert.ok(item.width <= (settled.get(item.key) ?? 0) + 1e-6, `${item.key} overshoots`);
			}
		}
	});

	it('advances a bar race through its frames and re-sorts', () => {
		const figure = target('bar-race');
		const prepared = prepareFigure(figure, 'horizontal');
		const label = (progress: number): string => {
			const item = prepared
				.scene(progress, 0)
				.items.find((candidate) => candidate.key === 'frame-label');
			return item && item.shape === 'text' ? item.text : '';
		};
		assert.equal(label(0.1), '1990');
		assert.equal(label(0.99), '2020');
		const rowY = (progress: number, key: string): number => {
			const item = prepared.scene(progress, 0).items.find((candidate) => candidate.key === key);
			return item && item.shape === 'rect' ? item.y : Number.NaN;
		};
		// China starts below the visible six and finishes above Japan.
		assert.ok(Number.isNaN(rowY(0.1, 'bar:cn')));
		assert.ok(rowY(0.1, 'bar:jp') < rowY(0.1, 'bar:de'));
		assert.ok(rowY(0.99, 'bar:cn') < rowY(0.99, 'bar:jp'));
	});
});

describe('wrapFigureText', () => {
	it('breaks a title into lines that fit the frame without splitting words', () => {
		const measure = (text: string) => ({ width: text.length * 10 });
		assert.deepEqual(wrapFigureText('The largest economies, 1990–2023', 160, 'title', measure), [
			'The largest',
			'economies,',
			'1990–2023'
		]);
		assert.deepEqual(wrapFigureText('Short', 160, 'title', measure), ['Short']);
		assert.deepEqual(wrapFigureText('Fumarase · FADH', 120, 'label', measure), [
			'Fumarase',
			'FADH'
		]);
		assert.deepEqual(wrapFigureText('α-Ketoglutarate', 60, 'label', measure), ['α-Ketoglutarate']);
		assert.deepEqual(wrapFigureText('Proto-Indo-European', 120, 'label', measure), [
			'Proto-Indo-',
			'European'
		]);
	});
});

describe('fitTreemapLeafText', () => {
	// 10 px per character; label and value lines 20 px, captions 12 px.
	const measure = (text: string, role: string): { width: number; height: number } => ({
		width: text.length * (role === 'caption' ? 6 : 10),
		height: role === 'caption' ? 12 : 20
	});

	it('wraps the label to the cell and puts the value beneath', () => {
		const lines = fitTreemapLeafText(
			'Bioenergy and other',
			'794',
			{ x: 0, y: 0, width: 140, height: 200 },
			8,
			measure
		);
		assert.deepEqual(
			lines.map((line) => [line.text, line.role, line.offset]),
			[
				['Bioenergy', 'label', 0],
				['and other', 'label', 20],
				['794', 'value', 40]
			]
		);
	});

	it('falls back to one caption line, then to nothing', () => {
		const wideShort = { x: 0, y: 0, width: 400, height: 30 };
		assert.deepEqual(
			fitTreemapLeafText('Other fossil', '818', wideShort, 8, measure).map((line) => line.text),
			['Other fossil · 818']
		);
		assert.deepEqual(
			fitTreemapLeafText('Other fossil', '818', { x: 0, y: 0, width: 20, height: 20 }, 8, measure),
			[]
		);
	});
});

describe('bump chart curves', () => {
	it('leaves and arrives level at each period', () => {
		assert.equal(
			bumpChartPath([
				{ x: 0, y: 0 },
				{ x: 100, y: 50 }
			]),
			'M0,0C50,0 50,50 100,50'
		);
	});

	it('cuts a step on the curve at the horizontal fraction', () => {
		const half = partialBumpSegment({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5);
		assert.ok(Math.abs(half.end.x - 50) < 0.01);
		assert.ok(Math.abs(half.end.y - 25) < 0.01);
		const whole = partialBumpSegment({ x: 0, y: 0 }, { x: 100, y: 50 }, 1);
		assert.ok(Math.abs(whole.end.x - 100) < 0.01 && Math.abs(whole.end.y - 50) < 0.01);
	});
});
