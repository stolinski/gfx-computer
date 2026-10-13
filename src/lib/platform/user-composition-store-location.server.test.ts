import assert from 'node:assert/strict';
import { join } from 'node:path';

import { isHttpError } from '@sveltejs/kit';
import { describe, it } from 'vite-plus/test';

import {
	assertUserCompositionDeleteAuthorized,
	primaryUserCompositionStoreDirectory,
	requireUserCompositionStoreLocation,
	resolveUserCompositionStoreLocation,
	USER_COMPOSITION_STORE_DIRECTORY_VARIABLE,
	VERIFICATION_RUN_VARIABLE
} from './user-composition-store-location.server';

const HOME = '/Users/example';
const PRIMARY = primaryUserCompositionStoreDirectory(HOME);

function served(env: Record<string, string | undefined>) {
	const resolution = resolveUserCompositionStoreLocation(env, HOME);
	assert.equal(
		resolution.kind,
		'served',
		`expected a served store, got: ${JSON.stringify(resolution)}`
	);
	return resolution.kind === 'served' ? resolution.location : null;
}

function refusalReason(env: Record<string, string | undefined>): string {
	const resolution = resolveUserCompositionStoreLocation(env, HOME);
	assert.equal(resolution.kind, 'refused', 'expected the store to refuse this environment');
	return resolution.kind === 'refused' ? resolution.reason : '';
}

describe('user composition store location', () => {
	it('keeps the store in app data, never under the working directory', () => {
		const location = served({});
		assert.equal(location?.storeDirectory, PRIMARY);
		assert.ok(
			!PRIMARY.includes('user-compositions'),
			'the app-data store must not reuse the repo folder name'
		);
		assert.equal(location?.trashDirectory, join(PRIMARY, '..', 'trash'));
		assert.equal(location?.backupsDirectory, join(PRIMARY, '..', 'backups'));
		assert.equal(location?.isVerificationRun, false);
	});

	// The 2026-08-29 loss in one assertion: a probe server that names no store of
	// its own must not be handed the author's.
	it('refuses to serve a verification run that names no jail', () => {
		const reason = refusalReason({ [VERIFICATION_RUN_VARIABLE]: '1' });
		assert.match(reason, /GFX_USER_COMPOSITION_STORE_DIRECTORY/);
		assert.ok(reason.includes(PRIMARY), 'the refusal must name the store it is protecting');
	});

	it('refuses a jail that overlaps the real store in either direction', () => {
		assert.match(
			refusalReason({
				[VERIFICATION_RUN_VARIABLE]: '1',
				[USER_COMPOSITION_STORE_DIRECTORY_VARIABLE]: join(PRIMARY, 'nested')
			}),
			/overlaps the real composition store/
		);
		assert.match(
			refusalReason({
				[VERIFICATION_RUN_VARIABLE]: '1',
				[USER_COMPOSITION_STORE_DIRECTORY_VARIABLE]: join(
					HOME,
					'Library',
					'Application Support',
					'GFX'
				)
			}),
			/overlaps the real composition store/
		);
	});

	it('refuses a relative store directory', () => {
		assert.match(
			refusalReason({ [USER_COMPOSITION_STORE_DIRECTORY_VARIABLE]: 'user-compositions' }),
			/must be an absolute path/
		);
	});

	it('serves a verification run its own jail', () => {
		const location = served({
			[VERIFICATION_RUN_VARIABLE]: '1',
			[USER_COMPOSITION_STORE_DIRECTORY_VARIABLE]: '/tmp/gfx-jail-7311/compositions'
		});
		assert.equal(location?.storeDirectory, '/tmp/gfx-jail-7311/compositions');
		assert.equal(location?.isVerificationRun, true);
	});

	it('answers 403 rather than falling back to the real store', () => {
		assert.throws(
			() => requireUserCompositionStoreLocation({ [VERIFICATION_RUN_VARIABLE]: '1' }),
			(thrown: unknown) => isHttpError(thrown) && thrown.status === 403
		);
	});

	it('gives a verification run no delete authority, even inside its own jail', () => {
		const jailed = served({
			[VERIFICATION_RUN_VARIABLE]: '1',
			[USER_COMPOSITION_STORE_DIRECTORY_VARIABLE]: '/tmp/gfx-jail-7311/compositions'
		});
		assert.ok(jailed);
		assert.throws(
			() => assertUserCompositionDeleteAuthorized(jailed),
			(thrown: unknown) => isHttpError(thrown) && thrown.status === 403
		);
		// A human-driven dev server still deletes.
		assert.doesNotThrow(() => assertUserCompositionDeleteAuthorized(served({})!));
	});
});
