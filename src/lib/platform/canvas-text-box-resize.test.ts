import { describe, expect, it } from 'vite-plus/test';

import { CompositionEditHistory } from './composition-edit-history';
import {
	captureDiagramLabelTextBoxSnapshot,
	resolveDiagramLabelTextBoxResize,
	restoreDiagramLabelTextBoxSnapshot
} from './canvas-text-box-resize';
import {
	createDefaultEngineState,
	DIAGRAM_LABEL_TEXT_BOX_MAX_WIDTH,
	DIAGRAM_LABEL_TEXT_BOX_MIN_WIDTH,
	type DiagramLabel,
	type EngineState
} from './engine-schema';

function textBoxState(orientation: 'horizontal' | 'vertical' = 'horizontal'): EngineState {
	const state = createDefaultEngineState();
	state.transport.orientation = orientation;
	state.surface.diagram = [
		{
			type: 'label',
			id: 'headline',
			position: { x: 0.5, y: 0.3 },
			text: 'A label that reflows',
			role: 'headline',
			wrap: 'auto',
			scale: 1.5,
			maxWidth: 0.4,
			orientationOverrides: {
				vertical: {
					position: { x: 0.6, y: 0.2 },
					scale: 1.25,
					maxWidth: 0.7
				}
			}
		}
	];
	return state;
}

function diagramLabel(state: EngineState): DiagramLabel {
	const label = state.surface.diagram?.[0];
	if (label?.type !== 'label') throw new Error('Expected Diagram label fixture.');
	return label;
}

describe('diagram label text-box resizing', () => {
	it('keeps the west edge fixed when the east side changes width', () => {
		const state = textBoxState();
		const origin = captureDiagramLabelTextBoxSnapshot(state, 'headline');
		expect(origin).not.toBeNull();
		const resized = resolveDiagramLabelTextBoxResize(origin!, {
			side: 'east',
			deltaX: 0.2,
			intrinsicWidth: 0.4
		});

		expect(resized?.geometry).toEqual({
			position: { x: 0.6, y: 0.3 },
			scale: 1.5,
			maxWidth: 0.6
		});
		expect(resized!.geometry.position.x - resized!.geometry.maxWidth! / 2).toBeCloseTo(0.3);
	});

	it('keeps the east edge fixed when the west side changes width', () => {
		const state = textBoxState();
		const origin = captureDiagramLabelTextBoxSnapshot(state, 'headline')!;
		const resized = resolveDiagramLabelTextBoxResize(origin, {
			side: 'west',
			deltaX: 0.1,
			intrinsicWidth: 0.4
		})!;

		expect(resized.geometry.maxWidth).toBe(0.3);
		expect(resized.geometry.position.x).toBe(0.55);
		expect(resized.geometry.position.x + resized.geometry.maxWidth! / 2).toBeCloseTo(0.7);
	});

	it('clamps width to the shared schema bounds', () => {
		const state = textBoxState();
		const origin = captureDiagramLabelTextBoxSnapshot(state, 'headline')!;

		expect(
			resolveDiagramLabelTextBoxResize(origin, {
				side: 'east',
				deltaX: -10,
				intrinsicWidth: 0.4
			})?.geometry.maxWidth
		).toBe(DIAGRAM_LABEL_TEXT_BOX_MIN_WIDTH);
		expect(
			resolveDiagramLabelTextBoxResize(origin, {
				side: 'west',
				deltaX: -10,
				intrinsicWidth: 0.4
			})?.geometry.maxWidth
		).toBe(DIAGRAM_LABEL_TEXT_BOX_MAX_WIDTH);
	});

	it('materializes intrinsic width without mutating typographic scale or label content', () => {
		const state = textBoxState();
		const label = diagramLabel(state);
		label.maxWidth = undefined;
		const before = { text: label.text, role: label.role, wrap: label.wrap, scale: label.scale };
		const origin = captureDiagramLabelTextBoxSnapshot(state, label.id)!;
		const resized = resolveDiagramLabelTextBoxResize(origin, {
			side: 'east',
			deltaX: 0.1,
			intrinsicWidth: 0.25
		})!;

		expect(resized.geometry.maxWidth).toBe(0.35);
		expect(restoreDiagramLabelTextBoxSnapshot(state, resized)).toBe(true);
		expect({ text: label.text, role: label.role, wrap: label.wrap, scale: label.scale }).toEqual(
			before
		);
	});

	it('writes only the active orientation geometry', () => {
		const state = textBoxState('vertical');
		const label = diagramLabel(state);
		const origin = captureDiagramLabelTextBoxSnapshot(state, label.id)!;
		const resized = resolveDiagramLabelTextBoxResize(origin, {
			side: 'east',
			deltaX: 0.1,
			intrinsicWidth: 0.7
		})!;

		expect(origin.source).toBe('orientation-override');
		expect(restoreDiagramLabelTextBoxSnapshot(state, resized)).toBe(true);
		expect(label.maxWidth).toBe(0.4);
		expect(label.position.x).toBe(0.5);
		expect(label.orientationOverrides?.vertical).toEqual({
			position: { x: 0.65, y: 0.2 },
			scale: 1.25,
			maxWidth: 0.8
		});
	});

	it('restores the exact width and anchor through undo and redo', () => {
		const state = textBoxState();
		const history = new CompositionEditHistory();
		const before = captureDiagramLabelTextBoxSnapshot(state, 'headline')!;
		const after = resolveDiagramLabelTextBoxResize(before, {
			side: 'east',
			deltaX: 0.2,
			intrinsicWidth: 0.4
		})!;
		restoreDiagramLabelTextBoxSnapshot(state, after);
		history.recordApplied({
			label: 'Resize diagram label text box',
			undo: () => {
				restoreDiagramLabelTextBoxSnapshot(state, before);
			},
			redo: () => {
				restoreDiagramLabelTextBoxSnapshot(state, after);
			}
		});

		expect(diagramLabel(state)).toMatchObject({ position: { x: 0.6, y: 0.3 }, maxWidth: 0.6 });
		expect(history.undo()).toBe(true);
		expect(diagramLabel(state)).toMatchObject({ position: { x: 0.5, y: 0.3 }, maxWidth: 0.4 });
		expect(history.redo()).toBe(true);
		expect(diagramLabel(state)).toMatchObject({ position: { x: 0.6, y: 0.3 }, maxWidth: 0.6 });
	});
});
