import assert from 'node:assert/strict';
import { join } from 'node:path';

import { isHttpError } from '@sveltejs/kit';
import { describe, it } from 'vite-plus/test';

import {
	primaryUserCompositionStoreDirectory,
	USER_COMPOSITION_STORE_DIRECTORY_VARIABLE,
	VERIFICATION_RUN_VARIABLE
} from './user-composition-store-location.server';
import {
	assertUserPackDeleteAuthorized,
	requireUserPackStoreLocation,
	resolveUserPackStoreLocation
} from './user-pack-store-location.server';

const HOME = '/Users/example';
const COMPOSITIONS = primaryUserCompositionStoreDirectory(HOME);

describe('user pack store location', () => {
	it('sits beside the composition store in app data', () => {
		const resolution = resolveUserPackStoreLocation({}, HOME);
		assert.equal(resolution.kind, 'served');
		if (resolution.kind !== 'served') return;
		assert.equal(resolution.location.packStoreDirectory, join(COMPOSITIONS, '..', 'packs'));
		assert.equal(resolution.location.fontCacheDirectory, join(COMPOSITIONS, '..', 'fonts'));
		assert.equal(resolution.location.trashDirectory, join(COMPOSITIONS, '..', 'trash', 'packs'));
		assert.ok(!resolution.location.packStoreDirectory.includes('compositions'));
		assert.equal(resolution.location.isVerificationRun, false);
	});

	it('inherits the composition jail, so a verification run never reaches the real packs or fonts', () => {
		const jailed = resolveUserPackStoreLocation(
			{
				[VERIFICATION_RUN_VARIABLE]: '1',
				[USER_COMPOSITION_STORE_DIRECTORY_VARIABLE]: '/tmp/gfx-verification-x/compositions'
			},
			HOME
		);
		assert.equal(jailed.kind, 'served');
		if (jailed.kind !== 'served') return;
		assert.equal(jailed.location.packStoreDirectory, '/tmp/gfx-verification-x/packs');
		assert.equal(jailed.location.fontCacheDirectory, '/tmp/gfx-verification-x/fonts');
		assert.equal(jailed.location.isVerificationRun, true);
	});

	it('refuses a verification run that names no jail, exactly as the composition store does', () => {
		const resolution = resolveUserPackStoreLocation({ [VERIFICATION_RUN_VARIABLE]: '1' }, HOME);
		assert.equal(resolution.kind, 'refused');
		assert.throws(
			() => requireUserPackStoreLocation({ [VERIFICATION_RUN_VARIABLE]: '1' }),
			(value: unknown) => isHttpError(value, 403)
		);
	});

	it('gives a verification run no delete authority', () => {
		assert.doesNotThrow(() =>
			assertUserPackDeleteAuthorized({
				packStoreDirectory: '/x/packs',
				fontCacheDirectory: '/x/fonts',
				trashDirectory: '/x/trash/packs',
				isVerificationRun: false
			})
		);
		assert.throws(
			() =>
				assertUserPackDeleteAuthorized({
					packStoreDirectory: '/x/packs',
					fontCacheDirectory: '/x/fonts',
					trashDirectory: '/x/trash/packs',
					isVerificationRun: true
				}),
			(value: unknown) => isHttpError(value, 403)
		);
	});
});
