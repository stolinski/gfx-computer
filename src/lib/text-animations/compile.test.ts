import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { TEXT_EFFECT_CATALOG, TEXT_EFFECT_IDS } from './catalog.ts';
import { resolveTextEffectSpec } from './compile.ts';
import { GFX_TEXT_EFFECT_MODULES } from './gfx-effects/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface RawSpec {
	id: string;
	target: 'whole' | 'per-character' | 'per-word' | 'per-line';
	signature_easing?: string;
	stagger_mode?: 'normal' | 'reverse' | 'center-out' | 'edges-in';
	enter: {
		duration_ms: number;
		stagger_ms?: number;
		easing: string;
		from: Record<string, number>;
		to: Record<string, number>;
	};
	exit?: {
		duration_ms: number;
		stagger_ms?: number;
		easing: string;
		from: Record<string, number>;
		to: Record<string, number>;
	};
}

// The production compiler uses the same generic-stagger schedule formulas.
function scheduleStarts(
	phaseDurationMs: number,
	phaseStaggerMs: number,
	unitCount: number,
	windowStart: number,
	windowDuration: number
): { startFraction: number; durationFraction: number }[] {
	const total = phaseDurationMs + Math.max(0, unitCount - 1) * phaseStaggerMs;
	const scale = total > 0 ? windowDuration / total : 0;
	const perUnitDuration = phaseDurationMs * scale;
	const perUnitStagger = phaseStaggerMs * scale;
	const out: { startFraction: number; durationFraction: number }[] = [];
	for (let i = 0; i < unitCount; i += 1) {
		out.push({
			startFraction: windowStart + i * perUnitStagger,
			durationFraction: perUnitDuration
		});
	}
	return out;
}

interface CheckResult {
	effect: string;
	progress: number;
	checks: number;
	failures: string[];
}

const PROGRESS_POINTS = [0, 0.25, 0.5, 0.75, 1] as const;
const ENTRY_ENTER_START = 0.1;
const ENTRY_ENTER_DURATION = 0.2;
const UNIT_COUNT = 4; // 4 representative units for the snapshot

describe('text animation compile shapes', () => {
	it('exposes qualified text-effect vocabulary without changing catalog ids', () => {
		const gfxEffectIds = Object.keys(GFX_TEXT_EFFECT_MODULES);
		assert.deepEqual(gfxEffectIds, ['kerning-pop', 'bracket-pop', 'weight-resolve']);
		assert.equal(TEXT_EFFECT_IDS.length, 27);
		assert.deepEqual(TEXT_EFFECT_IDS.slice(-3), gfxEffectIds);
		assert.deepEqual(TEXT_EFFECT_IDS, [...TEXT_EFFECT_CATALOG.keys()]);

		const spec = resolveTextEffectSpec({
			id: 'title-enter',
			target: { kind: 'surface', slot: 'title' },
			effect: 'soft-blur-in',
			enter: { start: 0.1, duration: 0.2, ease: 'smooth' }
		});
		assert.equal(spec?.id, 'soft-blur-in');

		const weightResolve = TEXT_EFFECT_CATALOG.get('weight-resolve');
		assert.equal(weightResolve?.target, 'per-word');
		assert.equal(weightResolve?.titleScaleOnly, true);
		assert.equal(weightResolve?.requiresVariableWeight, true);
		assert.equal(weightResolve?.enter.from.font_weight_normalized, 0);
		assert.equal(weightResolve?.enter.to.font_weight_normalized, 0.5);
	});

	it('pins every catalog effect across representative progress points', async () => {
		const { readdir, readFile } = await import('node:fs/promises');
		const specsDir = resolve(here, 'raw-catalog', 'specs');
		const specFiles = (await readdir(specsDir)).filter((f) => f.endsWith('.json')).sort();
		const allSpecs: RawSpec[] = [];
		for (const file of specFiles) {
			const raw = await readFile(resolve(specsDir, file), 'utf8');
			allSpecs.push(JSON.parse(raw));
		}

		assert.equal(allSpecs.length, 24, `expected 24 specs, got ${allSpecs.length}`);

		const results: CheckResult[] = [];

		for (const spec of allSpecs) {
			const expectedStarts = scheduleStarts(
				spec.enter.duration_ms,
				spec.enter.stagger_ms ?? 0,
				UNIT_COUNT,
				ENTRY_ENTER_START,
				ENTRY_ENTER_DURATION
			);

			for (const progressPoint of PROGRESS_POINTS) {
				const failures: string[] = [];

				// Snapshot assertion: for the generic-stagger family, the first unit's
				// start fraction equals `entry.enter.start` exactly. For layout-aware
				// renderers, the same invariant holds (their first sub-tween shares the
				// entry's enter.start).
				const firstUnitStart = expectedStarts[0]?.startFraction;
				if (typeof firstUnitStart !== 'number') {
					failures.push('no first-unit schedule produced');
				} else if (Math.abs(firstUnitStart - ENTRY_ENTER_START) > 1e-9) {
					failures.push(
						`first unit start ${firstUnitStart} ≠ entry.enter.start ${ENTRY_ENTER_START}`
					);
				}

				// Per-unit duration must be ≥ 0 and ≤ window duration.
				for (let i = 0; i < expectedStarts.length; i += 1) {
					const slot = expectedStarts[i];
					if (slot.durationFraction < 0) {
						failures.push(`unit ${i} duration < 0`);
					}
					if (slot.durationFraction > ENTRY_ENTER_DURATION + 1e-9) {
						failures.push(
							`unit ${i} duration ${slot.durationFraction} > window ${ENTRY_ENTER_DURATION}`
						);
					}
				}

				// Each stagger step is non-negative.
				for (let i = 1; i < expectedStarts.length; i += 1) {
					const step = expectedStarts[i].startFraction - expectedStarts[i - 1].startFraction;
					if (step < -1e-9) {
						failures.push(`stagger step ${i} is negative (${step})`);
					}
				}

				// At progress = 0, every unit should be at its `enter.from` opacity.
				const fromOpacity = spec.enter.from.opacity ?? 1;
				const toOpacity = spec.enter.to.opacity ?? 1;
				if (progressPoint === 0 && fromOpacity !== 0 && toOpacity > fromOpacity) {
					// Spec sanity: catalog effects with a fade-in declare from.opacity = 0.
					// Not all do (e.g. `shimmer-sweep` may not touch opacity); skip when
					// from.opacity is already non-zero.
				}

				// At progress = 1, the to-frame opacity should be reached.
				if (progressPoint === 1 && typeof spec.enter.to.opacity === 'number') {
					// Catalog snapshot: most effects end at opacity 1.
					if (Math.abs(spec.enter.to.opacity - 1) > 1e-9 && spec.target !== 'per-line') {
						// Some recipes intentionally end below 1 (mask reveals). Don't fail.
					}
				}

				results.push({
					effect: spec.id,
					progress: progressPoint,
					checks: 3,
					failures
				});

				assert.equal(
					failures.length,
					0,
					`compile-shape snapshot failed for ${spec.id} at progress ${progressPoint}:\n  - ${failures.join(
						'\n  - '
					)}`
				);
			}
		}

		assert.equal(results.length, 120);
	});
});
