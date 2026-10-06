import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, it } from 'vitest';
import { vec4 } from 'wgpu-matrix';

import type { Overlay } from './engine-schema';
import { getPack } from './packs/registry';
import { createStageCameraRig } from './pipelines/depth-stage-camera';
import { pipelineRendererController } from './pipelines/runtime-loader';
import { resolveOverlayStageBodies } from './stage-body-overlays';
import { decodeStageTypeface, type StageTypefaceData } from './stage-glyph-format';
import { REFERENCE_STAGE_TYPEFACE_SLUG } from './stage-typefaces';

const ASPECT = 16 / 9;
const REST_CAMERA = { move: 'static', amount: 0.5, ease: 'smooth' } as never;

let typeface: StageTypefaceData;

function headline(extra: Record<string, unknown> = {}): Overlay {
	return {
		type: 'dimensional-type',
		id: 'headline',
		content: { text: 'HANDS ON', size: 0.12, depth: 0.35, bevel: 0.06, lift: 0.8, lean: 14 },
		position: { anchor: 'center' },
		...extra
	} as never;
}

function projectFramePoint(
	rig: ReturnType<typeof createStageCameraRig>,
	model: Float32Array,
	local: [number, number, number]
): { x: number; y: number } {
	const world = [
		model[0] * local[0] + model[4] * local[1] + model[8] * local[2] + model[12],
		model[1] * local[0] + model[5] * local[1] + model[9] * local[2] + model[13],
		model[2] * local[0] + model[6] * local[1] + model[10] * local[2] + model[14],
		1
	];
	const clip = vec4.transformMat4(world, rig.viewProjection);
	return { x: (clip[0] / clip[3] + 1) / 2, y: (1 - clip[1] / clip[3]) / 2 };
}

beforeAll(async () => {
	const bytes = await readFile(
		fileURLToPath(
			new URL(`../assets/typefaces/${REFERENCE_STAGE_TYPEFACE_SLUG}.stageglyphs`, import.meta.url)
		)
	);
	typeface = decodeStageTypeface(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
	await pipelineRendererController.ensureOverlay('dimensional-type');
});

describe('resolveOverlayStageBodies (ADR-0062)', () => {
	const pack = getPack('syntax');
	const rig = createStageCameraRig({ aspect: ASPECT, camera: REST_CAMERA, time: 0 });
	const lookup = (slug: string) => (slug === REFERENCE_STAGE_TYPEFACE_SLUG ? typeface : null);

	it('resolves a body only for body Overlays, in Layer order with their index', () => {
		const resolved = resolveOverlayStageBodies({
			overlays: [
				{ type: 'lower-third', id: 'plain', content: {}, position: { anchor: 'bottom-left' } } as never,
				headline()
			],
			pack,
			typeface: lookup,
			rig,
			aspect: ASPECT,
			orientation: 'horizontal'
		});
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].overlay.id, 'headline');
		assert.equal(resolved[0].index, 1);
		assert.equal(resolved[0].body.model.length, 16);
		assert.equal(resolved[0].body.materials.length, 4);
		assert.equal(resolved[0].body.presence, 1);
		assert.equal(resolved[0].body.pullsFocus, true);
	});

	it('resolves nothing until the typeface has landed', () => {
		assert.deepEqual(
			resolveOverlayStageBodies({
				overlays: [headline()],
				pack,
				typeface: () => null,
				rig,
				aspect: ASPECT,
				orientation: 'horizontal'
			}),
			[]
		);
	});

	it('lands a centred headline at the frame centre, one cap height tall at its size', () => {
		const [{ body }] = resolveOverlayStageBodies({
			overlays: [headline()],
			pack,
			typeface: lookup,
			rig,
			aspect: ASPECT,
			orientation: 'horizontal'
		});
		// The pivot is the cap's middle: half a unit above the baseline origin.
		const pivot = projectFramePoint(rig, body.model, [0, 0.5, 0]);
		assert.ok(Math.abs(pivot.x - 0.5) < 1e-6, `pivot x ${pivot.x}`);
		assert.ok(Math.abs(pivot.y - 0.5) < 1e-6, `pivot y ${pivot.y}`);
		const baseline = projectFramePoint(rig, body.model, [0, 0, 0]);
		const capTop = projectFramePoint(rig, body.model, [0, 1, 0]);
		assert.ok(Math.abs(baseline.y - capTop.y - 0.12) < 1e-6, 'one cap height is the authored size');
	});

	it('sizes by the short side, so the same headline reflows into the tall frame', () => {
		const tallAspect = 9 / 16;
		const tallRig = createStageCameraRig({ aspect: tallAspect, camera: REST_CAMERA, time: 0 });
		const [{ body }] = resolveOverlayStageBodies({
			overlays: [headline()],
			pack,
			typeface: lookup,
			rig: tallRig,
			aspect: tallAspect,
			orientation: 'vertical'
		});
		const baseline = projectFramePoint(tallRig, body.model, [0, 0, 0]);
		const capTop = projectFramePoint(tallRig, body.model, [0, 1, 0]);
		assert.ok(Math.abs(baseline.y - capTop.y - 0.12 * tallAspect) < 1e-6, 'a cap is the size of the frame width');
		const left = projectFramePoint(tallRig, body.model, [body.mesh.min[0], 0.5, 0]);
		const right = projectFramePoint(tallRig, body.model, [body.mesh.max[0], 0.5, 0]);
		assert.ok(left.x > 0.05 && right.x < 0.95, 'the line stays inside the tall frame');
	});

	it('shrinks a line that would run past the safe width, so a long headline never leaves the picture', () => {
		const tallAspect = 9 / 16;
		const tallRig = createStageCameraRig({ aspect: tallAspect, camera: REST_CAMERA, time: 0 });
		const [{ body }] = resolveOverlayStageBodies({
			overlays: [headline({ content: { text: 'HANDS ON EVERYTHING', size: 0.2, depth: 0.35, bevel: 0.06, lift: 0, lean: 0 } })],
			pack,
			typeface: lookup,
			rig: tallRig,
			aspect: tallAspect,
			orientation: 'vertical'
		});
		const left = projectFramePoint(tallRig, body.model, [body.mesh.min[0], 0.5, 0]);
		const right = projectFramePoint(tallRig, body.model, [body.mesh.max[0], 0.5, 0]);
		// Centred in the frame, the line spans exactly the safe width (the tall
		// frame keeps 5% clear on the left and 9% on the right).
		assert.ok(Math.abs(right.x - left.x - 0.86) < 1e-6, `spans the safe width: ${left.x} .. ${right.x}`);
		assert.ok(left.x > 0.05 && right.x < 0.95, 'stays inside the picture');
		const baseline = projectFramePoint(tallRig, body.model, [0, 0, 0]);
		const capTop = projectFramePoint(tallRig, body.model, [0, 1, 0]);
		assert.ok(baseline.y - capTop.y < 0.2 * tallAspect, 'smaller than asked, to fit');
	});

	it('insets an edge-anchored headline by its offset and its own footprint', () => {
		const [{ body }] = resolveOverlayStageBodies({
			overlays: [headline({ position: { anchor: 'bottom-left', offset: { x: 0.05, y: 0.1 } } })],
			pack,
			typeface: lookup,
			rig,
			aspect: ASPECT,
			orientation: 'horizontal'
		});
		const left = projectFramePoint(rig, body.model, [body.mesh.min[0], 0.5, 0]);
		const bottom = projectFramePoint(rig, body.model, [0, 0, 0]);
		assert.ok(Math.abs(left.x - 0.05) < 1e-6, `left edge ${left.x}`);
		assert.ok(Math.abs(bottom.y - 0.9) < 1e-6, `baseline ${bottom.y}`);
	});

	it('reads its presence and place from the composition-owned channel when one drives the Overlay', () => {
		const [{ body }] = resolveOverlayStageBodies({
			overlays: [headline()],
			pack,
			typeface: lookup,
			overlayChannels: [{ x: 0.1, y: -0.2, opacity: 1 }],
			overlayProgresses: [0],
			rig,
			aspect: ASPECT,
			orientation: 'horizontal'
		});
		const pivot = projectFramePoint(rig, body.model, [0, 0.5, 0]);
		assert.ok(Math.abs(pivot.x - 0.6) < 1e-6 && Math.abs(pivot.y - 0.3) < 1e-6);
		assert.equal(body.presence, 1);
	});

	it('lifts and leans the body off its plane while its entrance is under way', () => {
		const settled = resolveOverlayStageBodies({
			overlays: [headline()],
			pack,
			typeface: lookup,
			overlayProgresses: [1],
			rig,
			aspect: ASPECT,
			orientation: 'horizontal'
		})[0].body;
		const arriving = resolveOverlayStageBodies({
			overlays: [headline()],
			pack,
			typeface: lookup,
			overlayProgresses: [0.2],
			rig,
			aspect: ASPECT,
			orientation: 'horizontal'
		})[0].body;
		assert.ok(arriving.model[14] > settled.model[14], 'the arriving body stands nearer the eye');
		assert.ok(Math.abs(arriving.model[6]) > Math.abs(settled.model[6]), 'the arriving body leans');
		assert.ok(arriving.presence < 1 && arriving.presence > 0);
		assert.equal(settled.key, arriving.key, 'the mesh is the same body');
	});
});
