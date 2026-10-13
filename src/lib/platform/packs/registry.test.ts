import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vite-plus/test';

import {
	findPack,
	getPack,
	installRuntimePackSource,
	listRuntimeUserPacks,
	PACK_REGISTRY,
	packSourceOf,
	UnknownPackError
} from './registry.ts';
import type { PackManifest } from './types.ts';

function userPack(slug: string): PackManifest {
	return { ...PACK_REGISTRY['clean-light'], slug, label: `User ${slug}` };
}

afterEach(() => {
	installRuntimePackSource({ read: () => undefined, list: () => [] });
});

describe('source-aware pack resolution (ADR-0055)', () => {
	it('resolves built-ins with no runtime source installed', () => {
		assert.equal(getPack('syntax'), PACK_REGISTRY.syntax);
		assert.equal(packSourceOf('syntax'), 'builtin');
		assert.deepEqual(listRuntimeUserPacks(), []);
		assert.equal(findPack('my-brand'), null);
	});

	it('fails closed on an unknown slug with the recovery in the message', () => {
		assert.throws(
			() => getPack('my-brand'),
			(value: unknown) =>
				value instanceof UnknownPackError &&
				value.slug === 'my-brand' &&
				/Registered Packs: syntax/.test(value.message) &&
				/bind the composition to another Pack/.test(value.message)
		);
		assert.equal(packSourceOf('my-brand'), null);
	});

	it('resolves a User Pack through the installed runtime source, after built-ins', () => {
		const packs: Record<string, PackManifest> = {
			'my-brand': userPack('my-brand'),
			syntax: userPack('syntax')
		};
		installRuntimePackSource({ read: (slug) => packs[slug], list: () => Object.values(packs) });

		assert.equal(getPack('my-brand').label, 'User my-brand');
		assert.equal(packSourceOf('my-brand'), 'user');
		// Built-ins win even when a runtime source claims the same slug.
		assert.equal(getPack('syntax'), PACK_REGISTRY.syntax);
		assert.equal(packSourceOf('syntax'), 'builtin');
		assert.deepEqual(
			listRuntimeUserPacks().map((pack) => pack.slug),
			['my-brand', 'syntax']
		);
		assert.match(new UnknownPackError('other').message, /loaded User Packs: my-brand, syntax/);
	});
});
