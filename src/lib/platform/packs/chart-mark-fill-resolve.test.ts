import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { PACK_REGISTRY } from './registry.ts';
import {
	isColorValue,
	resolveChartChromeColors,
	resolveChartMarkFillTreatment
} from './resolve.ts';
import type { PackManifest } from './types.ts';
import { validatePackManifest } from './validation.ts';

const chartRoles = ['default', 'series', 'emphasis'] as const;

function cloneManifest(manifest: PackManifest): PackManifest {
	return structuredClone(manifest);
}

function resolvedFillAverageLuma(
	treatment: ReturnType<typeof resolveChartMarkFillTreatment>
): number {
	const mix = treatment.mode === 'solid' ? 0 : 0.5;
	const rgb = treatment.colorA
		.slice(0, 3)
		.map((channel, index) => channel * (1 - mix) + (treatment.colorB[index] ?? channel) * mix);
	return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
}

describe('resolveChartMarkFillTreatment', () => {
	it('resolves every semantic role for every registered Pack', () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			for (const role of chartRoles) {
				const treatment = resolveChartMarkFillTreatment(manifest, role);
				assert.ok(
					['solid', 'gradient', 'ordered-dither'].includes(treatment.mode),
					`${slug}.${role}`
				);
				assert.equal(treatment.colorA.length, 4, `${slug}.${role}.colorA`);
				assert.equal(treatment.colorB.length, 4, `${slug}.${role}.colorB`);
				assert.ok(Number.isInteger(treatment.cellPx));
				assert.ok(treatment.cellPx >= 2 && treatment.cellPx <= 32);
			}
		}
	});

	it('resolves four distinct Pack-owned series voices with legend-safe declaration ordering', () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			const colors = [0, 1, 2, 3].map(
				(seriesIndex) => resolveChartMarkFillTreatment(manifest, 'series', seriesIndex).colorA
			);
			assert.equal(new Set(colors.map((color) => color.join(','))).size, 4, slug);
		}
		assert.throws(
			() => resolveChartMarkFillTreatment(PACK_REGISTRY.syntax, 'series', -1),
			/seriesIndex/
		);
	});

	it('keeps CRT semantic series voices separated after their rendered fill recipe', () => {
		const lumas = [0, 1, 2, 3].map((seriesIndex) =>
			resolvedFillAverageLuma(
				resolveChartMarkFillTreatment(PACK_REGISTRY['crt-terminal'], 'series', seriesIndex)
			)
		);
		for (let index = 1; index < lumas.length; index += 1) {
			assert.ok(
				Math.abs((lumas[index - 1] ?? 0) - (lumas[index] ?? 0)) >= 0.1,
				`crt-terminal series voices ${index - 1}/${index}: ${lumas.join(', ')}`
			);
		}
	});

	it('keeps every highlight-capable base role distinct from emphasis in every Pack', () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			for (const baseRole of ['default', 'series'] as const) {
				for (let seriesIndex = 0; seriesIndex < 4; seriesIndex += 1) {
					assert.notDeepEqual(
						resolveChartMarkFillTreatment(manifest, baseRole, seriesIndex),
						resolveChartMarkFillTreatment(manifest, 'emphasis', seriesIndex),
						`${slug}:${baseRole}:${seriesIndex}`
					);
				}
			}
		}
	});

	it('calibrates every non-solid recipe to a visibly distinct semantic endpoint', () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			for (const role of chartRoles) {
				const treatment = resolveChartMarkFillTreatment(manifest, role);
				if (treatment.mode !== 'solid') {
					assert.notDeepEqual(treatment.colorA, treatment.colorB, `${slug}.${role}`);
				}
			}
		}
	});

	it('uses chart.mark as the required color floor and falls back to accent-treatment', () => {
		const manifest = cloneManifest(PACK_REGISTRY.syntax);
		delete manifest.roles['chart.mark-fill'];
		assert.deepEqual(resolveChartMarkFillTreatment(manifest, 'default'), {
			mode: 'solid',
			colorA: [1, 213 / 255, 74 / 255, 1],
			colorB: [1, 213 / 255, 74 / 255, 1],
			gradientAxis: 'inline',
			matrix: '4x4',
			cellPx: 8
		});
		delete manifest.roles['chart.mark'];
		assert.deepEqual(resolveChartMarkFillTreatment(manifest, 'series').colorA, [
			1,
			213 / 255,
			74 / 255,
			1
		]);
	});

	it('uses one GPU-color contract for supported rgba and unsupported CSS forms', () => {
		const rgba = cloneManifest(PACK_REGISTRY.syntax);
		rgba.roles['chart.mark'] = { kind: 'style', value: 'rgba(255, 0, 128, 0.5)' };
		assert.deepEqual(resolveChartMarkFillTreatment(rgba, 'default').colorA, [1, 0, 128 / 255, 0.5]);
		assert.deepEqual(
			validatePackManifest('syntax', rgba).filter(
				(issue) => issue.kind === 'invalid-chart-mark-fill'
			),
			[]
		);

		const unsupported = cloneManifest(PACK_REGISTRY.syntax);
		assert.equal(isColorValue('oklch(70% 0.2 40)'), false);
		unsupported.roles['chart.mark'] = { kind: 'style', value: 'oklch(70% 0.2 40)' };
		assert.ok(
			validatePackManifest('syntax', unsupported).some(
				(issue) =>
					issue.kind === 'invalid-chart-mark-fill' && issue.path.join('.') === 'roles.chart.mark'
			)
		);
		assert.deepEqual(
			resolveChartMarkFillTreatment(unsupported, 'default').colorA,
			resolveChartMarkFillTreatment(PACK_REGISTRY.syntax, 'default').colorA
		);
	});

	it('rejects malformed comma-form colors before they can produce non-finite uniforms', () => {
		for (const malformed of ['rgba(., 0, 0, 1)', 'rgb(1..2, 0, 0)']) {
			const manifest = cloneManifest(PACK_REGISTRY.syntax);
			manifest.roles['chart.mark'] = { kind: 'style', value: malformed };
			assert.ok(
				validatePackManifest('syntax', manifest).some(
					(issue) =>
						issue.kind === 'invalid-chart-mark-fill' && issue.path.join('.') === 'roles.chart.mark'
				)
			);
			assert.ok(resolveChartMarkFillTreatment(manifest, 'default').colorA.every(Number.isFinite));
		}
	});

	it('fails validation before sampling when both GPU color floors are unusable', () => {
		const manifest = cloneManifest(PACK_REGISTRY.syntax);
		manifest.roles['chart.mark'] = { kind: 'style', value: { color: '#fff' } };
		manifest.roles['accent-treatment'] = { kind: 'style', value: 'hsl(0 0% 50%)' };
		const issues = validatePackManifest('syntax', manifest).filter(
			(issue) => issue.kind === 'invalid-chart-mark-fill'
		);
		assert.ok(issues.some((issue) => issue.path.join('.') === 'roles.chart.mark'));
		assert.ok(issues.some((issue) => issue.path.join('.') === 'roles.accent-treatment'));
		assert.throws(
			() => resolveChartMarkFillTreatment(manifest, 'default'),
			/resolveChartMarkFillTreatment/
		);
	});

	it('rejects a present but GPU-unparseable destination role', () => {
		const manifest = cloneManifest(PACK_REGISTRY.syntax);
		manifest.roles['chart.axis'] = { kind: 'style', value: 'color(display-p3 1 0 0)' };
		assert.ok(
			validatePackManifest('syntax', manifest).some(
				(issue) => issue.kind === 'invalid-chart-mark-fill' && issue.path.at(-1) === 'toRole'
			)
		);
		assert.equal(resolveChartMarkFillTreatment(manifest, 'series').mode, 'solid');
	});

	it('collapses a missing destination color to a solid instead of inventing one', () => {
		const manifest = cloneManifest(PACK_REGISTRY.syntax);
		manifest.roles['chart.mark-fill'] = {
			kind: 'style',
			value: { emphasis: { mode: 'gradient', toRole: 'field-ink-treatment', axis: 'block' } }
		};
		delete manifest.roles['field-ink-treatment'];
		assert.equal(resolveChartMarkFillTreatment(manifest, 'emphasis').mode, 'solid');
	});

	it('defensively returns the solid fallback for malformed or out-of-range recipes', () => {
		for (const value of [
			{ default: { mode: 'noise' } },
			{ default: { mode: 'solid', surprise: true } },
			{ default: { mode: 'gradient', toRole: 'chart.axis', surprise: true } },
			{ default: { mode: 'ordered-dither', cellPx: Number.NaN } },
			{ default: { mode: 'ordered-dither', cellPx: 1 } },
			{ default: { mode: 'ordered-dither', cellPx: 33 } },
			{ default: { mode: 'ordered-dither', cellPx: 3.5 } }
		]) {
			const manifest = cloneManifest(PACK_REGISTRY.syntax);
			manifest.roles['chart.mark-fill'] = { kind: 'style', value };
			assert.equal(resolveChartMarkFillTreatment(manifest, 'default').mode, 'solid');
		}
	});
});

describe('resolveChartChromeColors', () => {
	it('resolves crisp axis, grid, label, and annotation colors for every Pack', () => {
		for (const manifest of Object.values(PACK_REGISTRY)) {
			const chrome = resolveChartChromeColors(manifest);
			assert.equal(
				Object.values(chrome).every((color) => typeof color === 'string'),
				true
			);
		}
	});

	it('falls back to core ink and accent colors without inventing Preset literals', () => {
		const manifest = cloneManifest(PACK_REGISTRY.syntax);
		delete manifest.roles['chart.axis'];
		delete manifest.roles['chart.grid'];
		delete manifest.roles['chart.label'];
		delete manifest.roles['chart.annotation'];
		assert.deepEqual(resolveChartChromeColors(manifest), {
			axis: '#1a1612',
			grid: '#1a1612',
			label: '#1a1612',
			annotation: '#ffd54a',
			labelPlate: '#0e0e0d'
		});
	});
});

describe('chart.mark-fill manifest validation', () => {
	it('accepts every calibrated Pack recipe', () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			assert.deepEqual(
				validatePackManifest(slug, manifest).filter(
					(issue) => issue.kind === 'invalid-chart-mark-fill'
				),
				[]
			);
		}
	});

	it('rejects non-solid recipes without a destination color role', () => {
		for (const mode of ['gradient', 'ordered-dither'] as const) {
			const manifest = cloneManifest(PACK_REGISTRY.syntax);
			const role = manifest.roles['chart.mark-fill'];
			if (!role || role.kind !== 'style') assert.fail('syntax chart.mark-fill must be a style role');
			const value = structuredClone(role.value) as Record<string, unknown>;
			value.default = { mode };
			manifest.roles['chart.mark-fill'] = { kind: 'style', value };
			assert.ok(
				validatePackManifest('syntax', manifest).some(
					(issue) => issue.kind === 'invalid-chart-mark-fill'
				),
				mode
			);
		}
	});

	it('rejects unknown keys, modes, color roles, axes, matrices, and invalid cell sizes', () => {
		const invalidValues: readonly unknown[] = [
			{ extra: { mode: 'solid' } },
			{ default: { mode: 'solid', extra: true } },
			{ default: { mode: 'noise' } },
			{ default: { mode: 'solid', surprise: true } },
			{ default: { mode: 'gradient', toRole: 'chart.secret' } },
			{ default: { mode: 'gradient', axis: 'diagonal' } },
			{ default: { mode: 'ordered-dither', matrix: '3x3' } },
			{ default: { mode: 'ordered-dither', cellPx: Number.POSITIVE_INFINITY } },
			{ default: { mode: 'ordered-dither', cellPx: 1 } },
			{ default: { mode: 'ordered-dither', cellPx: 33 } },
			{ default: { mode: 'ordered-dither', cellPx: 2.5 } }
		];
		for (const value of invalidValues) {
			const manifest = cloneManifest(PACK_REGISTRY.syntax);
			manifest.roles['chart.mark-fill'] = { kind: 'style', value };
			assert.ok(
				validatePackManifest('syntax', manifest).some(
					(issue) => issue.kind === 'invalid-chart-mark-fill'
				),
				JSON.stringify(value)
			);
		}
	});
});
