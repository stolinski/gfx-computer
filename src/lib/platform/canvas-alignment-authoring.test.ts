import { describe, expect, it } from 'vitest';

import {
	applyCanvasAlignmentTranslations,
	restoreCanvasAlignmentGeometry
} from './canvas-alignment-authoring';
import type { CanvasAlignableElement, CanvasElementTranslation } from './canvas-alignment';
import { createDefaultEngineState } from './engine-schema';

function element(
	selectionKey: CanvasAlignableElement['selectionKey'],
	left: number,
	top: number,
	width = 0.1,
	height = 0.1
): CanvasAlignableElement {
	return { selectionKey, bounds: { left, top, width, height } };
}

function translation(
	selectionKey: CanvasElementTranslation['selectionKey'],
	x: number,
	y: number
): CanvasElementTranslation {
	return { selectionKey, delta: { x, y } };
}

describe('canvas alignment authoring', () => {
	it('moves mixed overlay and diagram Block geometry as one atomic command', () => {
		const state = createDefaultEngineState();
		state.transport.orientation = 'horizontal';
		state.overlays = [
			{
				type: 'watermark',
				id: 'brand',
				content: {},
				position: { anchor: 'top-right', offset: { x: 0.1, y: 0.2 } }
			}
		];
		state.surface.diagram = [
			{ id: 'node', type: 'node', form: 'dot', position: { x: 0.25, y: 0.3 } }
		];
		const elements = [element('overlay:brand', 0.7, 0.2), element('block:node', 0.2, 0.25)];

		const change = applyCanvasAlignmentTranslations(state, elements, [
			translation('overlay:brand', -0.2, 0.1),
			translation('block:node', 0.15, -0.05)
		]);

		expect(change).not.toBeNull();
		expect(state.overlays[0].position.offset).toEqual({ x: 0.3, y: 0.3 });
		expect(state.surface.diagram[0]).toMatchObject({ position: { x: 0.4, y: 0.25 } });
		expect(restoreCanvasAlignmentGeometry(state, change!.before)).toBe(true);
		expect(state.overlays[0].position.offset).toEqual({ x: 0.1, y: 0.2 });
		expect(state.surface.diagram[0]).toMatchObject({ position: { x: 0.25, y: 0.3 } });
		expect(restoreCanvasAlignmentGeometry(state, change!.after)).toBe(true);
		expect(state.overlays[0].position.offset).toEqual({ x: 0.3, y: 0.3 });
		expect(state.surface.diagram[0]).toMatchObject({ position: { x: 0.4, y: 0.25 } });
	});

	it('aligns Kinetic Words in the active orientation and restores them exactly', () => {
		const state = createDefaultEngineState();
		state.transport.orientation = 'vertical';
		state.surface.type = 'plain';
		const word = (
			id: string,
			x: number
		): NonNullable<typeof state.surface.typeField>['words'][number] => ({
			type: 'kinetic-word',
			id,
			text: id.toUpperCase(),
			hierarchy: 'display',
			ink: 'ink',
			position: { x, y: 0.5 },
			horizontalAnchor: 'start',
			scale: 1,
			rotation: 0
		});
		state.surface.typeField = {
			words: [
				word('type', 0.1),
				{
					...word('can', 0.3),
					orientationOverrides: {
						vertical: {
							position: { x: 0.2, y: 0.6 },
							horizontalAnchor: 'start',
							scale: 1.4,
							rotation: 0
						}
					}
				}
			],
			phrases: [{ id: 'one', wordIds: ['type', 'can'], focalWordId: 'type' }]
		};
		const change = applyCanvasAlignmentTranslations(
			state,
			[element('block:type', 0.1, 0.45), element('block:can', 0.2, 0.55)],
			[translation('block:type', 0.05, 0), translation('block:can', -0.1, 0)]
		);
		expect(change).not.toBeNull();
		expect(state.surface.typeField.words[0].position).toEqual({ x: 0.15, y: 0.5 });
		expect(state.surface.typeField.words[1].position).toEqual({ x: 0.3, y: 0.5 });
		expect(state.surface.typeField.words[1].orientationOverrides?.vertical?.position).toEqual({
			x: 0.1,
			y: 0.6
		});
		expect(restoreCanvasAlignmentGeometry(state, change!.before)).toBe(true);
		expect(state.surface.typeField.words[0].position).toEqual({ x: 0.1, y: 0.5 });
		expect(state.surface.typeField.words[1].orientationOverrides?.vertical?.position).toEqual({
			x: 0.2,
			y: 0.6
		});
	});

	it('writes only the active vertical orientation override', () => {
		const state = createDefaultEngineState();
		state.transport.orientation = 'vertical';
		state.overlays = [
			{
				type: 'watermark',
				id: 'brand',
				content: {},
				position: {
					anchor: 'top-left',
					offset: { x: 0.1, y: 0.1 },
					orientationOverrides: {
						vertical: { anchor: 'bottom-left', offset: { x: 0.2, y: 0.25 } }
					}
				}
			}
		];
		state.surface.diagram = [
			{
				id: 'node',
				type: 'node',
				form: 'box',
				position: { x: 0.2, y: 0.2 },
				orientationOverrides: {
					vertical: { position: { x: 0.6, y: 0.7 }, scale: 1.2 }
				}
			}
		];

		const change = applyCanvasAlignmentTranslations(
			state,
			[element('overlay:brand', 0.2, 0.65), element('block:node', 0.55, 0.65)],
			[translation('overlay:brand', 0.1, -0.1), translation('block:node', -0.2, -0.1)]
		);

		expect(change).not.toBeNull();
		expect(state.overlays[0].position.offset).toEqual({ x: 0.1, y: 0.1 });
		expect(state.overlays[0].position.orientationOverrides?.vertical?.offset).toEqual({
			x: 0.3,
			y: 0.35
		});
		expect(state.surface.diagram[0]).toMatchObject({ position: { x: 0.2, y: 0.2 } });
		expect(state.surface.diagram[0].orientationOverrides?.vertical).toMatchObject({
			position: { x: 0.4, y: 0.6 },
			scale: 1.2
		});
	});

	it('converts centered anchors to measured free placement only when an aligned axis moves', () => {
		const state = createDefaultEngineState();
		state.overlays = [
			{
				type: 'watermark',
				id: 'centered',
				content: {},
				position: { anchor: 'top-center', offset: { x: 0, y: 0.2 }, scale: 1.5 }
			}
		];
		const elements = [element('overlay:centered', 0.4, 0.2, 0.2, 0.1)];

		applyCanvasAlignmentTranslations(state, elements, [translation('overlay:centered', 0, 0.1)]);
		expect(state.overlays[0].position).toMatchObject({
			anchor: 'top-center',
			offset: { x: 0, y: 0.3 },
			scale: 1.5
		});

		applyCanvasAlignmentTranslations(state, elements, [translation('overlay:centered', -0.15, 0)]);
		expect(state.overlays[0].position).toMatchObject({
			anchor: 'top-left',
			offset: { x: 0.25, y: 0.2 },
			scale: 1.5
		});
	});

	it('translates both endpoints of a timeline segment without changing its span', () => {
		const state = createDefaultEngineState();
		state.surface.diagram = [
			{
				id: 'window',
				type: 'timeline-segment',
				from: { x: 0.1, y: 0.2 },
				to: { x: 0.4, y: 0.2 },
				label: 'Window'
			}
		];

		const change = applyCanvasAlignmentTranslations(
			state,
			[element('block:window', 0.1, 0.18, 0.3, 0.04)],
			[translation('block:window', 0.2, 0.3)]
		);

		expect(change).not.toBeNull();
		expect(state.surface.diagram[0]).toMatchObject({
			from: { x: 0.3, y: 0.5 },
			to: { x: 0.6, y: 0.5 },
			label: 'Window'
		});
	});
});
