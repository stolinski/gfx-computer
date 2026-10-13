import { describe, expect, it } from 'vite-plus/test';

import {
	coversCompositionPointer,
	rejectUnauthorizedCompositionWrites,
	resolveCompositionPointerOwner
} from './composition-pointer-ownership';
import { WEBMCP_OPERATION_INVENTORY } from './webmcp-operation-inventory';

describe('composition pointer coverage', () => {
	it('covers everything beneath a declared pointer', () => {
		expect(coversCompositionPointer('/state/overlays', '/state/overlays')).toBe(true);
		expect(coversCompositionPointer('/state/overlays', '/state/overlays/1/type')).toBe(true);
		expect(coversCompositionPointer('/state/overlays/1/type', '/state/overlays')).toBe(false);
	});

	it('matches a wildcard against exactly one segment', () => {
		expect(coversCompositionPointer('/state/overlays/*/content', '/state/overlays/3/content')).toBe(
			true
		);
		expect(
			coversCompositionPointer('/state/overlays/*/content', '/state/overlays/3/content/title')
		).toBe(true);
		expect(
			coversCompositionPointer('/state/overlays/*/content', '/state/overlays/3/position')
		).toBe(false);
	});
});

describe('composition pointer ownership', () => {
	it('gives a nested pointer to the family that declares the longest match', () => {
		expect(resolveCompositionPointerOwner('/state/overlays')?.family).toBe('layer');
		expect(resolveCompositionPointerOwner('/state/overlays/0/type')?.family).toBe('layer');
		expect(resolveCompositionPointerOwner('/state/overlays/0/content/title')?.family).toBe(
			'content'
		);
		expect(resolveCompositionPointerOwner('/state/overlays/0/position/anchor')?.family).toBe(
			'placement'
		);
		expect(resolveCompositionPointerOwner('/state/overlays/0/enter/start')?.family).toBe('motion');
		expect(resolveCompositionPointerOwner('/state/overlays/0/enter/sound')?.family).toBe('sound');
	});

	it('separates mark membership from mark timing and mark appearance', () => {
		expect(resolveCompositionPointerOwner('/state/marks/timings')?.family).toBe('layer');
		expect(resolveCompositionPointerOwner('/state/marks/timings/2/start')?.family).toBe('motion');
		expect(resolveCompositionPointerOwner('/state/marks/timings/2/sound')?.family).toBe('sound');
		expect(resolveCompositionPointerOwner('/state/marks/defaults/highlight')?.family).toBe(
			'appearance'
		);
	});

	it('reports the declared ownership scope alongside the family', () => {
		expect(resolveCompositionPointerOwner('/state/overlays')?.ownedPath.scope).toBe('membership');
		expect(resolveCompositionPointerOwner('/state/overlays/0/z')?.ownedPath.scope).toBe('value');
	});

	it('leaves a pointer no family declares unowned', () => {
		expect(resolveCompositionPointerOwner('/schema')).toBeNull();
		expect(resolveCompositionPointerOwner('/state')).toBeNull();
	});
});

describe('unauthorized composition writes', () => {
	it('accepts a write inside the operation family and its declared pointers', () => {
		expect(
			rejectUnauthorizedCompositionWrites(['/state/overlays/0/content/title'], 'content', [
				'/state/overlays/*/content'
			])
		).toEqual([]);
	});

	it('refuses a pointer another family owns', () => {
		expect(
			rejectUnauthorizedCompositionWrites(['/state/overlays/0/position'], 'layer', [
				'/state/overlays'
			])
		).toEqual([
			{ pointer: '/state/overlays/0/position', reason: 'foreign-family', owner: 'placement' }
		]);
	});

	it('refuses a pointer the operation row does not declare', () => {
		expect(
			rejectUnauthorizedCompositionWrites(['/state/backgroundFill'], 'transport', [
				'/state/transport'
			])
		).toEqual([
			{ pointer: '/state/backgroundFill', reason: 'undeclared-pointer', owner: 'transport' }
		]);
	});

	it('refuses a pointer no family owns', () => {
		expect(rejectUnauthorizedCompositionWrites(['/schema'], 'composition', ['/name'])).toEqual([
			{ pointer: '/schema', reason: 'unowned-pointer', owner: null }
		]);
	});

	it('authorizes every pointer the inventory itself declares', () => {
		for (const row of WEBMCP_OPERATION_INVENTORY.filter((entry) => entry.effect === 'write')) {
			expect(
				rejectUnauthorizedCompositionWrites(row.writes, row.family, row.writes),
				`${row.id} declares a pointer its own family cannot write`
			).toEqual([]);
		}
	});
});
