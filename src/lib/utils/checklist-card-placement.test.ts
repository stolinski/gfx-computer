import { describe, expect, it } from 'vitest';

import {
	checklistCardPlacementFromLayout,
	resolveChecklistCardLayout,
	resolveChecklistCardPlacement
} from './checklist-card-placement';

describe('checklist card placement', () => {
	it('keeps the pipeline layout when nothing is authored', () => {
		expect(resolveChecklistCardPlacement({}, 'horizontal')).toBeNull();
		expect(resolveChecklistCardLayout({}, 'horizontal')).toEqual({
			x: 0.56,
			y: 0.5,
			width: 0.38,
			anchor: 'center',
			enterFrom: 'right',
			authored: false
		});
		const tall = resolveChecklistCardLayout({}, 'vertical');
		expect(tall).toMatchObject({ y: 0.52, width: 0.86, anchor: 'top', enterFrom: 'right' });
		expect(Math.round(2160 * tall.x)).toBe(Math.round((2160 - 2160 * 0.86) / 2));
	});

	it('resolves an orientation placement over the shared one and enters from its side', () => {
		const surface = {
			checklistCard: { x: 0.06, y: 0.5, width: 0.38 },
			checklistCardOrientationOverrides: { vertical: { x: 0.07, y: 0.32, width: 0.86 } }
		};
		expect(resolveChecklistCardLayout(surface, 'horizontal')).toMatchObject({
			x: 0.06,
			anchor: 'center',
			enterFrom: 'left',
			authored: true
		});
		expect(resolveChecklistCardLayout(surface, 'vertical')).toMatchObject({
			x: 0.07,
			y: 0.32,
			enterFrom: 'right',
			authored: true
		});
	});

	it('converts the top-pinned tall default to a centre placement', () => {
		const tall = resolveChecklistCardLayout({}, 'vertical');
		expect(checklistCardPlacementFromLayout(tall, 0.2)).toEqual({ x: 0.07, y: 0.62, width: 0.86 });
		const wide = resolveChecklistCardLayout({}, 'horizontal');
		expect(checklistCardPlacementFromLayout(wide, 0.4)).toEqual({ x: 0.56, y: 0.5, width: 0.38 });
	});
});
