import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createStarterFigure } from '$lib/platform/figure-starters';
import { parseFigureCsv, parseFigureDataImport, slugFigureDataId } from './figure-data-import';

describe('parseFigureCsv', () => {
	it('honours quoted cells, escaped quotes, and CRLF', () => {
		assert.deepEqual(parseFigureCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n'), [
			['a', 'b, c', 'say "hi"'],
			['1', '2', '3']
		]);
	});
});

describe('slugFigureDataId', () => {
	it('slugs names and keeps them unique', () => {
		const taken = new Set<string>();
		assert.equal(slugFigureDataId('Côte d’Ivoire', taken), 'cote-d-ivoire');
		assert.equal(slugFigureDataId('Cote d Ivoire', taken), 'cote-d-ivoire-2');
	});
});

describe('parseFigureDataImport', () => {
	it('reads x,series… into line series', () => {
		const result = parseFigureDataImport(
			createStarterFigure('line', 'trend'),
			'csv',
			'year,Coal,Solar\n2010,40,1\n2020,30,9\n'
		);
		assert.ok(result.ok && 'series' in result.data);
		assert.equal(result.data.series.length, 2);
	});

	it('reads entity,period… into a slope', () => {
		const result = parseFigureDataImport(
			createStarterFigure('slope', 'ranks'),
			'csv',
			'maker,2019,2023\nSamsung,296,227\nApple,191,235\n'
		);
		assert.ok(result.ok && 'periods' in result.data);
		assert.deepEqual(
			result.data.periods.map((period) => period.label),
			['2019', '2023']
		);
	});

	it('reads source,target,value into a Sankey and needs every value', () => {
		const ok = parseFigureDataImport(
			createStarterFigure('sankey', 'flow'),
			'csv',
			'from,to,amount\nGas,Grid,12\nGrid,Homes,5\n'
		);
		assert.ok(ok.ok && 'links' in ok.data && ok.data.links.length === 2);
		const missing = parseFigureDataImport(
			createStarterFigure('sankey', 'flow'),
			'csv',
			'from,to,amount\nGas,Grid,\n'
		);
		assert.equal(missing.ok, false);
	});

	it('reads step,detail rows into a cycle', () => {
		const result = parseFigureDataImport(
			createStarterFigure('cycle', 'loop'),
			'csv',
			'step,detail\nPlan,Decide\nDo,Act\nCheck,Measure\n'
		);
		assert.ok(result.ok && 'steps' in result.data && result.data.steps[0].detail === 'Decide');
	});

	it('refuses CSV for a neural network and JSON that does not fit the kind', () => {
		assert.equal(
			parseFigureDataImport(createStarterFigure('neural-network', 'net'), 'csv', 'a,b\n1,2\n').ok,
			false
		);
		const wrong = parseFigureDataImport(
			createStarterFigure('tree', 'tree'),
			'json',
			'{"layers":[]}'
		);
		assert.equal(wrong.ok, false);
	});
});
