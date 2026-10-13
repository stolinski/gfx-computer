import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it } from 'vite-plus/test';

import { migrateLegacyRepositoryCompositions } from './user-composition-store-boot.server';

let root: string;
let legacyDirectory: string;
let storeDirectory: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'gfx-boot-'));
	legacyDirectory = join(root, 'checkout', 'user-compositions');
	storeDirectory = join(root, 'app-data', 'compositions');
	await mkdir(legacyDirectory, { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('legacy in-repo composition migration', () => {
	it('moves compositions out of the checkout into app data', async () => {
		await writeFile(join(legacyDirectory, 'chapter-card.json'), 'kept', 'utf-8');
		await writeFile(join(legacyDirectory, 'notes.txt'), 'ignored', 'utf-8');

		assert.equal(await migrateLegacyRepositoryCompositions(legacyDirectory, storeDirectory), 1);

		assert.deepEqual(await readdir(storeDirectory), ['chapter-card.json']);
		assert.equal(await readFile(join(storeDirectory, 'chapter-card.json'), 'utf-8'), 'kept');
		// Only the JSON moved; nothing else in the folder is the store's business.
		assert.deepEqual(await readdir(legacyDirectory), ['notes.txt']);
	});

	// The app-data copy is the live one. A stale checkout file must never win.
	it('never overwrites a composition that already exists in app data', async () => {
		await mkdir(storeDirectory, { recursive: true });
		await writeFile(join(storeDirectory, 'blank.json'), 'live', 'utf-8');
		await writeFile(join(legacyDirectory, 'blank.json'), 'stale', 'utf-8');

		assert.equal(await migrateLegacyRepositoryCompositions(legacyDirectory, storeDirectory), 0);

		assert.equal(await readFile(join(storeDirectory, 'blank.json'), 'utf-8'), 'live');
		assert.deepEqual(await readdir(legacyDirectory), ['blank.json']);
	});

	it('does nothing when the checkout has no legacy folder', async () => {
		assert.equal(
			await migrateLegacyRepositoryCompositions(join(root, 'absent'), storeDirectory),
			0
		);
	});
});
