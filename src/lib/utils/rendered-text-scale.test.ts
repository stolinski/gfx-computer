import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { calculateEffectiveCapHeight, parseRenderedTextScaleY } from './rendered-text-scale.ts';

describe('rendered text scale', () => {
	it('parses computed individual CSS scale defensively', () => {
		assert.equal(parseRenderedTextScaleY('none'), 1);
		assert.equal(parseRenderedTextScaleY(''), 1);
		assert.equal(parseRenderedTextScaleY('1.6'), 1.6);
		assert.equal(parseRenderedTextScaleY('1.2 0.75'), 0.75);
		assert.equal(parseRenderedTextScaleY('-1.25'), 1.25);
		assert.equal(parseRenderedTextScaleY('150%'), 1.5);
		assert.equal(parseRenderedTextScaleY('not-a-scale'), 1);
	});

	it('applies only the live item scale to native computed font size', () => {
		assert.equal(calculateEffectiveCapHeight(50, 0.72, '1.5'), 54);
		assert.equal(calculateEffectiveCapHeight(50, 0.72, 'none'), 36);
	});

	it('keeps the headline role default-safe and canonical scales inside their G4 bands', () => {
		const nativeCqmin = 21.6;
		const conservativeCapHeightRatio = 0.7;
		const headlineCapHeight = (scale: number): number =>
			calculateEffectiveCapHeight(
				5.1 * nativeCqmin,
				conservativeCapHeightRatio,
				String(scale)
			);
		const defaultHeadline = headlineCapHeight(1);
		const supportingCaption = calculateEffectiveCapHeight(
			2.6 * nativeCqmin,
			conservativeCapHeightRatio,
			'0.85'
		);
		const horizontalSectionHeadline = headlineCapHeight(0.8);
		const verticalSectionHeadline = headlineCapHeight(1);
		const canonicalTopHeadlines = {
			flowchart: { horizontal: headlineCapHeight(0.95), vertical: headlineCapHeight(1.15) },
			mapJourney: { horizontal: headlineCapHeight(1.05), vertical: headlineCapHeight(1.25) },
			statBuild: { horizontal: headlineCapHeight(1.15), vertical: headlineCapHeight(1.08) },
			timelineBuild: { horizontal: headlineCapHeight(1.4), vertical: headlineCapHeight(1.15) }
		};

		assert.equal(Number(defaultHeadline.toFixed(2)), 77.11);
		assert.ok(defaultHeadline >= 76, 'scale 1 headline clears the stricter vertical floor');
		assert.ok(defaultHeadline <= 110, 'scale 1 headline remains inside the horizontal band');
		assert.equal(Number(supportingCaption.toFixed(2)), 33.42);
		assert.ok(supportingCaption >= 32, 'scale 0.85 caption clears the vertical floor');
		assert.equal(Number(horizontalSectionHeadline.toFixed(2)), 61.69);
		assert.ok(horizontalSectionHeadline >= 60, 'section headline clears the horizontal floor');
		assert.equal(Number(verticalSectionHeadline.toFixed(2)), 77.11);
		assert.ok(verticalSectionHeadline >= 76, 'section headline clears the vertical floor');
		assert.deepEqual(
			Object.fromEntries(
				Object.entries(canonicalTopHeadlines).map(([name, caps]) => [
					name,
					{
						horizontal: Number(caps.horizontal.toFixed(2)),
						vertical: Number(caps.vertical.toFixed(2))
					}
				])
			),
			{
				flowchart: { horizontal: 73.26, vertical: 88.68 },
				mapJourney: { horizontal: 80.97, vertical: 96.39 },
				statBuild: { horizontal: 88.68, vertical: 83.28 },
				timelineBuild: { horizontal: 107.96, vertical: 88.68 }
			}
		);
		for (const caps of Object.values(canonicalTopHeadlines)) {
			assert.ok(caps.horizontal >= 60 && caps.horizontal <= 110);
			assert.ok(caps.vertical >= 76 && caps.vertical <= 138);
		}
	});
});
