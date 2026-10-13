import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it } from 'vite-plus/test';

import {
	PUBLIC_SURFACE_INVENTORY,
	findPublicSurface,
	isDevelopmentOnlySurfacePath,
	isSurfaceRefusedByProfile
} from './public-surface-inventory';

const ROUTES_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../routes');
const ROUTE_ENTRY_FILES = new Set(['+server.ts', '+page.svelte', '+page.server.ts']);

/** Every route path this repository serves, with params filled in by a sample. */
function listRoutePaths(directory: string = ROUTES_DIRECTORY): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			paths.push(...listRoutePaths(entryPath));
			continue;
		}
		if (!ROUTE_ENTRY_FILES.has(entry.name)) continue;
		const segments = relative(ROUTES_DIRECTORY, directory)
			.split(/[/\\]/)
			.filter((segment) => segment !== '' && !segment.startsWith('('))
			.map((segment) => (segment.startsWith('[') ? 'sample' : segment));
		paths.push(`/${segments.join('/')}`);
	}
	return [...new Set(paths)];
}

describe('public surface inventory', () => {
	it('resolves a path against the longest declared prefix', () => {
		assert.equal(findPublicSurface('/api/export/sessions').pathPrefix, '/api/export/');
		assert.equal(findPublicSurface('/p/lower-third').pathPrefix, '/p/');
		assert.equal(findPublicSurface('/').pathPrefix, '/');
	});

	it('serves the app shell, the Workspace, health, and the export transport', () => {
		for (const pathname of [
			'/',
			'/_app/immutable/entry/app.js',
			'/fonts/inter.woff2',
			'/p/lower-third',
			'/api/health',
			'/api/export/sessions',
			'/api/export/sessions/abc/frames/0'
		]) {
			assert.equal(isDevelopmentOnlySurfacePath(pathname), false, pathname);
		}
	});

	it('excludes every local composition, fixture, developer, repository, and control-plane surface', () => {
		for (const pathname of [
			'/api/user-compositions',
			'/api/user-compositions/untitled-1',
			'/api/user-assets',
			'/api/user-assets/abc.mp4',
			'/api/posters/abcdef01',
			'/api/backdrops',
			'/api/website-capture',
			'/api/x-post',
			'/api/verification/source-identity',
			'/api/sentry-canary',
			'/poc/dof3d'
		]) {
			assert.equal(isDevelopmentOnlySurfacePath(pathname), true, pathname);
		}
	});

	it('refuses nothing on a development host and the development-only rows on every other', () => {
		assert.equal(isSurfaceRefusedByProfile('/api/user-compositions', 'development'), false);
		assert.equal(isSurfaceRefusedByProfile('/api/export/sessions', 'development'), false);
		assert.equal(isSurfaceRefusedByProfile('/api/user-compositions', 'public'), true);
		assert.equal(isSurfaceRefusedByProfile('/api/user-compositions', 'hosted'), true);
		for (const pathname of ['/', '/p/lower-third', '/api/health']) {
			assert.equal(isSurfaceRefusedByProfile(pathname, 'public'), false, pathname);
			assert.equal(isSurfaceRefusedByProfile(pathname, 'hosted'), false, pathname);
		}
	});

	it('serves the export transport from the Node origin alone, because only it has the encoder', () => {
		assert.equal(findPublicSurface('/api/export/sessions').exposure, 'node-origin');
		assert.equal(isSurfaceRefusedByProfile('/api/export/sessions', 'public'), false);
		assert.equal(isSurfaceRefusedByProfile('/api/export/sessions', 'hosted'), true);
		assert.equal(isSurfaceRefusedByProfile('/api/export/sessions/abc/frames/0', 'hosted'), true);
	});

	it('classifies every route this repository serves', () => {
		const unclassified = listRoutePaths().filter(
			(pathname) => pathname !== '/' && findPublicSurface(pathname).pathPrefix === '/'
		);

		assert.deepEqual(
			unclassified,
			[],
			`Add a PUBLIC_SURFACE_INVENTORY row for ${unclassified.join(', ')}: a route with no row is public by accident.`
		);
	});

	it('gives every row a reason, because the exclusion is a decision and not a list', () => {
		for (const row of PUBLIC_SURFACE_INVENTORY) {
			assert.ok(row.pathPrefix.startsWith('/'), row.pathPrefix);
			assert.ok(row.reason.length > 40, `${row.pathPrefix} needs a real reason`);
		}
		assert.equal(
			new Set(PUBLIC_SURFACE_INVENTORY.map((row) => row.pathPrefix)).size,
			PUBLIC_SURFACE_INVENTORY.length
		);
	});
});
