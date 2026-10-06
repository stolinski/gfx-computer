import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

// The User Pack store an agent binds through: one stored pack, nothing else.
// Loaded lazily inside the factory so the registry it copies from is ready.
const storeMocks = vi.hoisted(() => ({
	async userPackDocument(slug: string) {
		const { PACK_REGISTRY } = await import('./packs/registry');
		return {
			manifest: { ...PACK_REGISTRY['clean-light'], slug, label: 'My brand' },
			forkedFrom: 'clean-light',
			savedAt: '2026-09-01T12:00:00.000Z',
			contentHash: 'a'.repeat(64),
			fontFaces: []
		};
	}
}));
vi.mock('./user-pack-store', () => ({
	userPackStore: {
		async listUserPacks() {
			return [
				{
					slug: 'my-brand',
					label: 'My brand',
					description: '',
					forkedFrom: 'clean-light',
					savedAt: '2026-09-01T12:00:00.000Z',
					contentHash: 'a'.repeat(64)
				}
			];
		},
		async loadUserPack(slug: string) {
			return slug === 'my-brand' ? storeMocks.userPackDocument(slug) : null;
		},
		async forkUserPack() {
			throw new Error('not under test');
		},
		async saveUserPack() {
			throw new Error('not under test');
		},
		async deleteUserPack() {
			throw new Error('not under test');
		}
	}
}));

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { engineState, packState, transitionState } from './engine-state.svelte';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
import {
	runAddCompositionEffectOperation,
	runSetCompositionSurfaceOperation
} from './composition-layer-operations';
import { runSetCompositionBackgroundOperation } from './composition-transport-operations';
import {
	runSetCompositionBackdropVisibilityOperation,
	runSetCompositionEffectParamsOperation,
	runSetCompositionMarkDefaultsOperation,
	runSetCompositionPackOperation,
	runSetCompositionStageCameraOperation,
	runSetCompositionStageFocusOperation,
	runSetCompositionStageOperation,
	runSetCompositionTypographyOperation
} from './composition-appearance-operations';
import { applyPreset } from './preset';
import { getPack } from './packs/registry';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';

/** The registered Pack whose chrome contributes Effects to a full-frame piece. */
const CHROME_PACK_SLUG = 'crt-terminal';

function expectApplied(outcome: CompositionOperationOutcome): readonly string[] {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome.changed.pointers;
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the Pack edit applied.');
	}
	return outcome;
}

function chromeEffectTypes(slug: string): string[] {
	const chrome = getPack(slug).roles.chrome;
	return chrome?.kind === 'chrome' ? chrome.effects.map((effect) => effect.type) : [];
}

beforeEach(() => {
	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('composition Pack', () => {
	it('re-dresses the piece without touching composition content', async () => {
		const changed = expectApplied(
			await runSetCompositionPackOperation({ expectedRevision: 0, packSlug: 'clean-light' })
		);

		expect(changed).toEqual(['/pack']);
		expect(packState.slug).toBe('clean-light');
		expect(engineState.surface.type).toBe('plain');
		expect(engineState.surface.content).toEqual(
			parsePresetIngress(blankPresetJson).state.surface.content
		);
	});

	it('loads the Effect renderers a full-frame piece takes from the new Pack chrome', async () => {
		expect(chromeEffectTypes(CHROME_PACK_SLUG).length).toBeGreaterThan(0);
		expectApplied(
			await runSetCompositionBackgroundOperation({ expectedRevision: 0, fill: 'pack' })
		);

		expectApplied(
			await runSetCompositionPackOperation({ expectedRevision: 1, packSlug: CHROME_PACK_SLUG })
		);

		for (const type of chromeEffectTypes(CHROME_PACK_SLUG)) {
			expect(pipelineRendererRuntime.current().effects.has(type)).toBe(true);
		}
	});

	it('refuses a Pack neither the registry nor the store holds, naming both kinds of alternative', async () => {
		const failure = expectFailed(
			await runSetCompositionPackOperation({ expectedRevision: 0, packSlug: 'not-a-pack' })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.rejected).toBe('not-a-pack');
		expect(failure.message).toMatch(/User Pack store holds nothing/);
		expect(failure.alternatives).toContain('syntax');
		expect(failure.alternatives).toContain('my-brand');
		expect(packState.slug).toBe('syntax');
	});

	it('binds a User Pack the store holds, loading it into the runtime first (ADR-0055)', async () => {
		const changed = expectApplied(
			await runSetCompositionPackOperation({ expectedRevision: 0, packSlug: 'my-brand' })
		);

		expect(changed).toEqual(['/pack']);
		expect(packState.slug).toBe('my-brand');
		expect(getPack('my-brand').label).toBe('My brand');
	});

	it('refuses a stale revision and leaves the Pack bound where it was', async () => {
		expectApplied(
			await runSetCompositionPackOperation({ expectedRevision: 0, packSlug: 'clean-light' })
		);

		const failure = expectFailed(
			await runSetCompositionPackOperation({ expectedRevision: 0, packSlug: 'editorial-mono' })
		);

		expect(failure.code).toBe('stale_revision');
		expect(packState.slug).toBe('clean-light');
	});
});

describe('composition typography', () => {
	it('sets the type voice and hands a colour back to the Pack', async () => {
		const changed = expectApplied(
			await runSetCompositionTypographyOperation({
				expectedRevision: 0,
				fontFamily: 'serif',
				paperColor: null
			})
		);

		expect(changed).toContain('/state/typography/fontFamily');
		expect(engineState.typography.fontFamily).toBe('serif');
		expect(engineState.typography.paperColor).toBeUndefined();
		expect(engineState.typography.inkColor).toBe('#f5f5f5');
	});

	it('refuses a type voice the engine does not ship and names the ones it does', async () => {
		const failure = expectFailed(
			await runSetCompositionTypographyOperation({ expectedRevision: 0, fontFamily: 'comic' })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('serif');
		expect(engineState.typography.fontFamily).toBe('sans');
	});

	it('refuses a colour that is not a hex, leaving the composition alone', async () => {
		const failure = expectFailed(
			await runSetCompositionTypographyOperation({ expectedRevision: 0, inkColor: 'charcoal' })
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('charcoal');
		expect(engineState.typography.inkColor).toBe('#f5f5f5');
	});

	it('refuses an edit that names nothing to set', async () => {
		const failure = expectFailed(
			await runSetCompositionTypographyOperation({ expectedRevision: 0 })
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toContain('fontFamily');
	});
});

describe('composition mark defaults', () => {
	it('dresses one style and keeps the resolved colour when only the strength moves', async () => {
		expectApplied(
			await runSetCompositionMarkDefaultsOperation({
				expectedRevision: 0,
				defaults: { highlight: { color: '#ff0055', intensity: 0.4 } }
			})
		);
		expectApplied(
			await runSetCompositionMarkDefaultsOperation({
				expectedRevision: 1,
				defaults: { highlight: { intensity: 0.9 } }
			})
		);

		expect(engineState.marks.defaults.highlight).toEqual({ color: '#ff0055', intensity: 0.9 });
	});

	it('drops a style back to the Pack when it is cleared', async () => {
		expectApplied(
			await runSetCompositionMarkDefaultsOperation({
				expectedRevision: 0,
				defaults: { underline: { color: '#00ccaa', intensity: 0.5 } }
			})
		);

		expectApplied(
			await runSetCompositionMarkDefaultsOperation({
				expectedRevision: 1,
				defaults: { underline: null }
			})
		);

		expect(engineState.marks.defaults.underline).toBeUndefined();
	});

	it('refuses an intensity outside the engine scale', async () => {
		const failure = expectFailed(
			await runSetCompositionMarkDefaultsOperation({
				expectedRevision: 0,
				defaults: { circle: { intensity: 4 } }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('4');
		expect(engineState.marks.defaults.circle).toBeUndefined();
	});
});

describe('composition Effect parameters', () => {
	it('writes the parameters the Effect Pipeline accepts', async () => {
		expectApplied(
			await runAddCompositionEffectOperation({ expectedRevision: 0, effectType: 'paper-grain' })
		);

		const changed = expectApplied(
			await runSetCompositionEffectParamsOperation({
				expectedRevision: 1,
				effectId: 'paper-grain-1',
				params: { warmth: 0.2, density: 0.8, lift: 0.1 }
			})
		);

		expect(changed.some((pointer) => pointer.startsWith('/state/effects/0/params'))).toBe(true);
		expect(engineState.effects[0].params).toEqual({ warmth: 0.2, density: 0.8, lift: 0.1 });
	});

	it('answers parameters the Pipeline rejects with findings naming the field', async () => {
		expectApplied(
			await runAddCompositionEffectOperation({ expectedRevision: 0, effectType: 'paper-grain' })
		);

		const failure = expectFailed(
			await runSetCompositionEffectParamsOperation({
				expectedRevision: 1,
				effectId: 'paper-grain-1',
				params: { warmth: 9 }
			})
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.findings[0].path).toContain('warmth');
		expect(engineState.effects[0].params).toEqual({ warmth: 0.5, density: 0.3, lift: 0 });
	});

	it('names the Effects in the chain when the id is not one of them', async () => {
		expectApplied(
			await runAddCompositionEffectOperation({ expectedRevision: 0, effectType: 'paper-grain' })
		);

		const failure = expectFailed(
			await runSetCompositionEffectParamsOperation({
				expectedRevision: 1,
				effectId: 'halftone-1',
				params: {}
			})
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toEqual(['paper-grain-1']);
	});
});

describe('composition depth stage', () => {
	it('writes the stage whole, filling every field the caller left out', async () => {
		const changed = expectApplied(
			await runSetCompositionStageOperation({
				expectedRevision: 0,
				stage: {
					type: 'depth',
					camera: { move: 'push' },
					focus: {
						pull: {
							from: 0,
							to: 1,
							start: { seconds: 0.6 },
							duration: { frames: 18 }
						}
					}
				}
			})
		);

		expect(changed).toContain('/state/stage');
		expect(engineState.stage).toMatchObject({
			type: 'depth',
			camera: { move: 'push', amount: 0.5, ease: 'smooth' },
			focus: {
				focusZ: 0,
				aperture: 0.6,
				band: 0,
				pull: { from: 0, to: 1 }
			}
		});
		expect(engineState.stage?.focus.pull?.start).toBeCloseTo(0.1);
		expect(engineState.stage?.focus.pull?.duration).toBeCloseTo(0.1);
	});

	it('removes the stage when the caller sends none', async () => {
		expectApplied(
			await runSetCompositionStageOperation({ expectedRevision: 0, stage: { type: 'depth' } })
		);

		expectApplied(await runSetCompositionStageOperation({ expectedRevision: 1, stage: null }));

		expect(engineState.stage).toBeUndefined();
	});

	it('refuses a stage this engine does not register and names the ones it does', async () => {
		const failure = expectFailed(
			await runSetCompositionStageOperation({ expectedRevision: 0, stage: { type: 'holodeck' } })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toContain('depth');
		expect(engineState.stage).toBeUndefined();
	});

	it('refuses to remove a stage the composition does not carry', async () => {
		const failure = expectFailed(
			await runSetCompositionStageOperation({ expectedRevision: 0, stage: null })
		);

		expect(failure.code).toBe('precondition_unmet');
	});
});

describe('composition backdrop visibility', () => {
	it('shows the Surface backdrop through on a Surface that composites one', async () => {
		expectApplied(
			await runSetCompositionSurfaceOperation({ expectedRevision: 0, surfaceType: 'paper' })
		);

		const changed = expectApplied(
			await runSetCompositionBackdropVisibilityOperation({ expectedRevision: 1, visibility: 0.35 })
		);

		expect(changed).toContain('/state/surface/backgroundVisibility');
		expect(engineState.surface.backgroundVisibility).toBe(0.35);
	});

	it('refuses a Surface that composites no backdrop and names the ones that do', async () => {
		const failure = expectFailed(
			await runSetCompositionBackdropVisibilityOperation({ expectedRevision: 0, visibility: 0.5 })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.rejected).toBe('plain');
		expect(failure.alternatives).toContain('paper');
	});
});

describe('composition stage camera and focus (ADR-0060 §5)', () => {
	it('refuses to set a camera or a focus while the composition has no stage', async () => {
		const camera = expectFailed(
			await runSetCompositionStageCameraOperation({
				expectedRevision: 0,
				camera: { pose: { yaw: 12 } }
			})
		);
		expect(camera.code).toBe('precondition_unmet');
		const focus = expectFailed(
			await runSetCompositionStageFocusOperation({ expectedRevision: 0, focus: { aperture: 0.3 } })
		);
		expect(focus.code).toBe('precondition_unmet');
		expect(engineState.stage).toBeUndefined();
	});

	it('writes the camera whole and leaves the rest of the stage as it was', async () => {
		expectApplied(
			await runSetCompositionStageOperation({
				expectedRevision: 0,
				stage: { type: 'depth', focus: { aperture: 0.3 }, screen: { model: 'crt-fw900' } }
			})
		);
		const changed = expectApplied(
			await runSetCompositionStageCameraOperation({
				expectedRevision: 1,
				camera: {
					pose: { yaw: 14, distance: 1.9, aim: { x: 0.5, y: 0.64 } },
					travel: { to: { distance: 1.1 }, start: 0.1, duration: 0.6 },
					vertical: { pose: { yaw: 10, distance: 1.12 } }
				}
			})
		);
		expect(changed.some((pointer) => pointer.startsWith('/state/stage/camera'))).toBe(true);
		expect(engineState.stage?.camera).toMatchObject({
			move: 'static',
			pose: { yaw: 14, pitch: 0, roll: 0, distance: 1.9, aim: { x: 0.5, y: 0.64 } },
			travel: { to: { distance: 1.1 }, start: 0.1, duration: 0.6, ease: 'smooth' },
			vertical: { pose: { yaw: 10, distance: 1.12 } }
		});
		expect(engineState.stage?.focus.aperture).toBe(0.3);
		expect(engineState.stage?.screen).toEqual({ model: 'crt-fw900' });
		expect(compositionEditHistory.undoLabel).toBe('Set stage camera');
	});

	it('refuses a camera outside the pose limits and applies nothing', async () => {
		expectApplied(
			await runSetCompositionStageOperation({ expectedRevision: 0, stage: { type: 'depth' } })
		);
		const failure = expectFailed(
			await runSetCompositionStageCameraOperation({
				expectedRevision: 1,
				camera: { pose: { yaw: 90 } }
			})
		);
		expect(failure.code).toBe('schema_invalid');
		expect(engineState.stage?.camera.pose).toBeUndefined();
	});

	it('writes the focus whole, resolving a rack focus window given in time units', async () => {
		expectApplied(
			await runSetCompositionStageOperation({
				expectedRevision: 0,
				stage: { type: 'depth', camera: { pose: { yaw: 14 } } }
			})
		);
		const changed = expectApplied(
			await runSetCompositionStageFocusOperation({
				expectedRevision: 1,
				focus: { aperture: 0.35, band: 0.05, pull: { from: 0, to: 1, start: { seconds: 0.6 }, duration: { frames: 18 } } }
			})
		);
		expect(changed.some((pointer) => pointer.startsWith('/state/stage/focus'))).toBe(true);
		expect(engineState.stage?.focus).toMatchObject({ focusZ: 0, aperture: 0.35, band: 0.05 });
		expect(engineState.stage?.focus.pull?.start).toBeCloseTo(0.1);
		expect(engineState.stage?.focus.pull?.duration).toBeCloseTo(0.1);
		expect(engineState.stage?.camera.pose?.yaw).toBe(14);
		expect(compositionEditHistory.undoLabel).toBe('Set stage focus');
	});
});
