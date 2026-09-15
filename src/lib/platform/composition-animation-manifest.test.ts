import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { RenderAnimState } from './anim-state.svelte.ts';
import { buildCompositionAnimationManifest } from './composition-animation-manifest.ts';
import type { AnimationTweenSpec } from './animation-manager.ts';
import type { EngineState, TextAnimation } from './engine-schema.ts';

function makeRuntime(): RenderAnimState {
	return {
		bodyVisibility: 0,
		markProgresses: [],
		overlayProgresses: [],
		overlayChannels: [],
		blockProgresses: {},
		blockAlphas: {},
		blockChannels: {},
		kineticWordChannels: {},
		paperVisibility: 0,
		globalProgress: 0
	};
}

function makeManifestState(): EngineState {
	return {
		transport: { orientation: 'horizontal', durationSeconds: 10, fps: 30, format: 'webm' },
		typography: { fontFamily: 'serif' },
		marks: {
			defaults: { highlight: { color: '#ffee00', intensity: 0.6 } },
			timings: [
				{
					start: 0.8,
					duration: 0.1,
					ease: 'smooth',
					cascade: { anchor: { overlay: 'motion' }, event: 'end', offsetMs: 100 }
				}
			]
		},
		surface: {
			type: 'plain',
			content: {
				title: 'Manifest',
				body: [
					{
						type: 'paragraph',
						segments: [{ text: 'Marked', markStyles: ['highlight'] }]
					}
				]
			},
			animation: {
				channels: {
					opacity: [
						{ atMs: 0, value: 0 },
						{ atMs: 400, value: 1, ease: 'smooth' }
					]
				}
			},
			// Diagram primitive Block exercises the id-keyed animation records.
			diagram: [
				{
					type: 'node',
					id: 'node-a',
					position: { x: 0.5, y: 0.5 },
					form: 'box',
					enter: { start: 0.3, duration: 0.05, ease: 'settled' }
				}
			]
		},
		textAnimations: [
			{
				id: 'title',
				target: { kind: 'surface', slot: 'title' },
				effect: 'soft-blur-in',
				enter: { start: 0.9, duration: 0.05, ease: 'smooth' },
				cascade: { anchor: { mark: 0 }, event: 'end', offsetMs: 0 }
			}
		],
		overlays: [
			{
				id: 'motion',
				type: 'lower-third',
				content: {},
				position: { anchor: 'center', scale: 0.9 },
				enter: { start: 0.1, duration: 0.05, ease: 'smooth' },
				animation: {
					channels: {
						y: [
							{ atMs: 0, value: 0.1 },
							{ atMs: 500, value: 0, ease: 'settled' }
						]
					}
				}
			}
		],
		effects: [],
		audioCues: []
	} as unknown as EngineState;
}

describe('composition animation manifest', () => {
	it('derives ordered surface, mark, text, overlay, and Block tweens with Cascade starts', () => {
		const state = makeManifestState();
		const runtime = makeRuntime();
		let compiledEntries: readonly TextAnimation[] = [];
		const textTween: AnimationTweenSpec = {
			key: 'text-probe',
			start: 0,
			duration: 0.1,
			ease: 'none',
			onUpdate: () => undefined
		};
		const manifest = buildCompositionAnimationManifest({
			state,
			runtime,
			textAnimationRoot: null,
			textAnimationCompiler: {
				rebuild: (_root, entries) => {
					compiledEntries = entries;
					return [textTween];
				}
			},
			resolveMarkColor: () => '#ffee00'
		});

		assert.deepEqual(
			manifest.tweens.map((tween) => tween.key),
			['paper-opacity-1', 'mark-0', 'text-probe', 'overlay-motion-y-1', 'block-node-a-enter']
		);
		assert.ok(
			Math.abs((manifest.tweens.find((tween) => tween.key === 'mark-0')?.start ?? 0) - 0.16) < 1e-9
		);
		assert.equal(compiledEntries[0].enter.start, 0.26);
		assert.equal(
			state.textAnimations[0].enter.start,
			0.9,
			'Cascade resolution does not mutate authored text timing'
		);
	});

	it('compiles orientation-resolved Kinetic Word channels into id-keyed runtime slots', () => {
		const runtime = makeRuntime();
		const state = makeManifestState();
		state.transport.orientation = 'vertical';
		state.surface.typeField = {
			words: [
				{
					type: 'kinetic-word',
					id: 'type',
					text: 'TYPE',
					hierarchy: 'display',
					ink: 'accent',
					position: { x: 0.5, y: 0.5 },
					scale: 1,
					rotation: 0,
					animation: {
						channels: {
							opacity: [{ atMs: 0, value: 0.25 }],
							weight: [
								{ atMs: 0, value: 0.5 },
								{ atMs: 200, value: 1, ease: 'sharp' }
							]
						},
						orientationOverrides: {
							vertical: {
								x: [{ atMs: 0, value: 0.08 }],
								y: [{ atMs: 0, value: -0.04 }],
								scale: [{ atMs: 0, value: 1.3 }],
								rotation: [{ atMs: 0, value: 6 }]
							}
						}
					}
				}
			],
			phrases: [{ id: 'opening', wordIds: ['type'], focalWordId: 'type' }]
		};
		const manifest = buildCompositionAnimationManifest({
			state,
			runtime,
			textAnimationRoot: null,
			textAnimationCompiler: { rebuild: () => [] },
			resolveMarkColor: () => '#ffee00'
		});

		assert.deepEqual(runtime.kineticWordChannels.type, {
			opacity: 0.25,
			x: 0.08,
			y: -0.04,
			scale: 1.3,
			rotation: 6,
			weight: 0.5
		});
		assert.ok(manifest.tweens.some((tween) => tween.key === 'kinetic-word-type-weight-1'));
		manifest.tweens.find((tween) => tween.key === 'kinetic-word-type-weight-1')?.onUpdate(0.82);
		assert.equal(runtime.kineticWordChannels.type?.weight, 0.82);
	});

	it('seeds and writes composition-owned runtime channels deterministically', () => {
		const runtime = makeRuntime();
		const state = makeManifestState();
		state.transport.orientation = 'vertical';
		state.overlays[0].position.orientationOverrides = {
			vertical: { anchor: 'bottom-center', offset: { x: 0, y: 0.2 }, scale: 1.4, rotation: 5 }
		};
		const node = state.surface.diagram?.[0];
		if (node?.type === 'node') {
			node.orientationOverrides = {
				vertical: { position: { x: 0.5, y: 0.6 }, scale: 1.6 }
			};
			node.animation = { channels: { opacity: [{ atMs: 0, value: 0.4 }] } };
		}
		const manifest = buildCompositionAnimationManifest({
			state,
			runtime,
			textAnimationRoot: null,
			textAnimationCompiler: { rebuild: () => [] },
			resolveMarkColor: () => '#ffee00'
		});

		assert.equal(runtime.overlayChannels[0]?.scale, 1.4);
		assert.equal(runtime.overlayChannels[0]?.rotation, 5);
		assert.equal(runtime.overlayChannels[0]?.y, 0.1);
		assert.equal(runtime.overlayProgresses[0], 1);
		assert.equal(runtime.blockChannels['node-a']?.scale, 1.6);
		assert.equal(runtime.blockChannels['node-a']?.opacity, 0.4);

		manifest.tweens.find((tween) => tween.key === 'paper-opacity-1')?.onUpdate(0.75);
		manifest.tweens.find((tween) => tween.key === 'overlay-motion-y-1')?.onUpdate(0.025);
		assert.equal(runtime.paperVisibility, 0.75);
		assert.equal(runtime.overlayChannels[0]?.y, 0.025);
		assert.equal(runtime.blockProgresses['node-a'], 1);
	});
});
