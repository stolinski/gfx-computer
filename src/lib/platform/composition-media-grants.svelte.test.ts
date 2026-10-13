import { beforeEach, describe, expect, it } from 'vite-plus/test';

import { compositionMediaGrants } from './composition-media-grants.svelte';

import type { UserVideoAssetDescriptor } from './user-video-asset';

function descriptorFor(digest: string): UserVideoAssetDescriptor {
	return {
		url: `/api/user-assets/${digest}.mp4`,
		mime: 'video/mp4',
		sizeBytes: 2048,
		durationSeconds: 12,
		displayWidth: 1920,
		displayHeight: 1080,
		rotation: 0,
		averageFrameRate: 30,
		videoCodec: 'avc1.640028',
		hasAudio: false
	};
}

const firstDigest = 'ab'.repeat(32);
const secondDigest = 'cd'.repeat(32);

beforeEach(() => {
	compositionMediaGrants.clear();
});

describe('composition media grants', () => {
	it('starts with nothing granted, so this page may not add media at all', () => {
		expect(compositionMediaGrants.hasGrant).toBe(false);
		expect(compositionMediaGrants.grants).toEqual([]);
		expect(compositionMediaGrants.find('grant-abababababab')).toBeNull();
	});

	it('names a grant after the bytes, so the same file grants once', () => {
		const first = compositionMediaGrants.record('clip.mp4', descriptorFor(firstDigest));
		const again = compositionMediaGrants.record('clip-renamed.mp4', descriptorFor(firstDigest));

		expect(first.grantId).toBe('grant-abababababab');
		expect(again.grantId).toBe(first.grantId);
		expect(compositionMediaGrants.grants).toHaveLength(1);
		expect(compositionMediaGrants.find(first.grantId)?.name).toBe('clip-renamed.mp4');
	});

	it('keeps every distinct file the visitor granted', () => {
		compositionMediaGrants.record('a.mp4', descriptorFor(firstDigest));
		compositionMediaGrants.record('b.mp4', descriptorFor(secondDigest));

		expect(compositionMediaGrants.grants.map((grant) => grant.grantId)).toEqual([
			'grant-abababababab',
			'grant-cdcdcdcdcdcd'
		]);
		expect(compositionMediaGrants.hasGrant).toBe(true);
	});

	it('falls back to a name rather than carrying a blank one', () => {
		expect(compositionMediaGrants.record('   ', descriptorFor(firstDigest)).name).toBe(
			'Untitled video'
		);
	});

	it('refuses a URL that is not content addressed', () => {
		expect(() =>
			compositionMediaGrants.record('clip.mp4', {
				...descriptorFor(firstDigest),
				url: '/api/user-assets/x.mp4'
			})
		).toThrow(/content-addressed asset URL/);
	});

	it('drops every grant when the session is emptied', () => {
		compositionMediaGrants.record('a.mp4', descriptorFor(firstDigest));
		compositionMediaGrants.clear();

		expect(compositionMediaGrants.hasGrant).toBe(false);
	});
});
