import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import type {
	DiagramEdgeArrow,
	DiagramLabel,
	DiagramTimelineSegment
} from '$lib/platform/engine-schema';

import {
	cloneDiagramPrimitiveGeometry,
	resolveDiagramPrimitiveForRender,
	resolveDiagramPrimitiveGeometry
} from './diagram-geometry';

describe('Diagram orientation geometry', () => {
	it('resolves a complete positioned primitive snapshot', () => {
		const label: DiagramLabel = {
			type: 'label',
			id: 'title',
			position: { x: 0.2, y: 0.2 },
			text: 'Title',
			wrap: 'explicit',
			scale: 1,
			maxWidth: 0.8,
			orientationOverrides: {
				vertical: { position: { x: 0.5, y: 0.12 }, scale: 1.8, maxWidth: 0.7 }
			}
		};

		assert.equal(resolveDiagramPrimitiveGeometry(label, 'horizontal'), label);
		assert.deepEqual(resolveDiagramPrimitiveGeometry(label, 'vertical'), {
			position: { x: 0.5, y: 0.12 },
			scale: 1.8,
			maxWidth: 0.7
		});
		assert.deepEqual(resolveDiagramPrimitiveForRender(label, 'vertical'), {
			...label,
			position: { x: 0.5, y: 0.12 },
			scale: 1.8,
			maxWidth: 0.7
		});
	});

	it('deep-clones edge endpoints and control without carrying overrides', () => {
		const edge: DiagramEdgeArrow = {
			type: 'edge-arrow',
			id: 'edge',
			from: { node: 'a' },
			to: { node: 'b' },
			route: 'straight',
			orientationOverrides: {
				vertical: {
					from: { node: 'a' },
					to: { x: 0.6, y: 0.7 },
					route: 'arc',
					control: { x: 0.4, y: 0.5 }
				}
			}
		};
		const geometry = resolveDiagramPrimitiveGeometry(edge, 'vertical');
		const clone = cloneDiagramPrimitiveGeometry(geometry);

		assert.deepEqual(clone, geometry);
		assert.notEqual(clone.from, geometry.from);
		assert.notEqual(clone.to, geometry.to);
		assert.notEqual(clone.control, geometry.control);
		assert.equal('orientationOverrides' in clone, false);
	});

	it('replaces timeline endpoints as one snapshot', () => {
		const segment: DiagramTimelineSegment = {
			type: 'timeline-segment',
			id: 'era',
			from: { x: 0.1, y: 0.5 },
			to: { x: 0.9, y: 0.5 },
			orientationOverrides: {
				vertical: {
					from: { x: 0.5, y: 0.2 },
					to: { x: 0.5, y: 0.8 }
				}
			}
		};

		assert.deepEqual(resolveDiagramPrimitiveGeometry(segment, 'vertical'), {
			from: { x: 0.5, y: 0.2 },
			to: { x: 0.5, y: 0.8 }
		});
	});
});
