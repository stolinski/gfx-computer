import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it } from 'vite-plus/test';

import type { UserCompositionStoreLocation } from './user-composition-store-location.server';
import { moveUserCompositionToTrash } from './user-composition-trash.server';

let root: string;
let location: UserCompositionStoreLocation;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'gfx-trash-'));
	location = {
		storeDirectory: join(root, 'compositions'),
		trashDirectory: join(root, 'trash'),
		backupsDirectory: join(root, 'backups'),
		isVerificationRun: false
	};
	await mkdir(location.storeDirectory, { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('user composition trash', () => {
	it('moves the composition out of the store with its content intact', async () => {
		await writeFile(join(location.storeDirectory, 'chapter-card.json'), '{"kept":true}', 'utf-8');

		assert.equal(await moveUserCompositionToTrash(location, 'chapter-card'), true);

		assert.deepEqual(await readdir(location.storeDirectory), []);
		const trashed = await readdir(location.trashDirectory);
		assert.equal(trashed.length, 1);
		assert.match(trashed[0] ?? '', /-chapter-card\.json$/);
		assert.equal(
			await readFile(join(location.trashDirectory, trashed[0] ?? ''), 'utf-8'),
			'{"kept":true}'
		);
	});

	it('keeps every deleted revision of one slug rather than overwriting', async () => {
		await writeFile(join(location.storeDirectory, 'blank.json'), 'first', 'utf-8');
		await moveUserCompositionToTrash(location, 'blank', new Date('2026-08-31T10:00:00Z'));
		await writeFile(join(location.storeDirectory, 'blank.json'), 'second', 'utf-8');
		await moveUserCompositionToTrash(location, 'blank', new Date('2026-08-31T11:00:00Z'));

		assert.equal((await readdir(location.trashDirectory)).length, 2);
	});

	it('reports absence instead of failing', async () => {
		assert.equal(await moveUserCompositionToTrash(location, 'never-existed'), false);
	});
});
