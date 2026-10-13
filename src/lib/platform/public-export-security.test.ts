import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	createExportSessionIdentity,
	EXPORT_SESSION_IDENTITY_LENGTH,
	exportSessionCredentialCookieName,
	findExportRequestOriginRefusal,
	formatExportSessionCredentialCookie,
	isExportSessionIdentity,
	isMatchingExportCredential,
	readExportSessionCredentialCookie,
	redactExportDiagnostic
} from '$lib/platform/public-export-security';

const ORIGIN = 'https://gfx.computer';

describe('public export identities', () => {
	it('mints unpredictable identities inside the URL and cookie-token alphabet', () => {
		const identities = new Set<string>();
		for (let attempt = 0; attempt < 500; attempt += 1) {
			const identity = createExportSessionIdentity();
			assert.equal(identity.length, EXPORT_SESSION_IDENTITY_LENGTH);
			assert.ok(isExportSessionIdentity(identity));
			identities.add(identity);
		}
		assert.equal(identities.size, 500);
	});

	it('rejects anything that is not an identity this origin issued', () => {
		for (const value of [
			'',
			'..',
			'../../etc/passwd',
			'gfx-export-1',
			'a'.repeat(EXPORT_SESSION_IDENTITY_LENGTH - 1),
			'a'.repeat(EXPORT_SESSION_IDENTITY_LENGTH + 1),
			`${'a'.repeat(EXPORT_SESSION_IDENTITY_LENGTH - 1)}/`,
			`${'a'.repeat(EXPORT_SESSION_IDENTITY_LENGTH - 1)}%`,
			// A v4 UUID is the previous shape, and it is not one of these.
			'f81d4fae-7dec-11d0-a765-00a0c91e6bf6'
		]) {
			assert.equal(isExportSessionIdentity(value), false, value);
		}
	});

	it('compares credentials without letting the length of a match show', () => {
		const credential = createExportSessionIdentity();
		assert.ok(isMatchingExportCredential(credential, credential));
		assert.equal(isMatchingExportCredential(credential, createExportSessionIdentity()), false);
		assert.equal(isMatchingExportCredential(credential.slice(0, -1), credential), false);
		assert.equal(isMatchingExportCredential(`${credential}x`, credential), false);
	});
});

describe('public export request origin refusal', () => {
	it('admits the app talking to its own origin', () => {
		assert.equal(
			findExportRequestOriginRefusal({
				method: 'POST',
				origin: ORIGIN,
				secFetchSite: 'same-origin',
				expectedOrigin: ORIGIN
			}),
			null
		);
	});

	it('refuses a mutating request from another origin or from none at all', () => {
		for (const origin of ['https://evil.example', 'http://gfx.computer', null]) {
			const refusal = findExportRequestOriginRefusal({
				method: 'PUT',
				origin,
				secFetchSite: null,
				expectedOrigin: ORIGIN
			});
			assert.equal(refusal?.reason, 'crossOriginRequest');
			assert.equal(refusal?.status, 403);
		}
	});

	it('admits a download navigation and refuses one a cross-site page started', () => {
		// A link click inside the app, and a person opening the URL themselves.
		for (const secFetchSite of ['same-origin', 'none', null]) {
			assert.equal(
				findExportRequestOriginRefusal({
					method: 'GET',
					origin: null,
					secFetchSite,
					expectedOrigin: ORIGIN
				}),
				null
			);
		}
		for (const secFetchSite of ['cross-site', 'same-site']) {
			assert.equal(
				findExportRequestOriginRefusal({
					method: 'GET',
					origin: null,
					secFetchSite,
					expectedOrigin: ORIGIN
				})?.reason,
				'crossSiteFetch'
			);
		}
		// `none` is a navigation only; a fetch can never legitimately claim it.
		assert.equal(
			findExportRequestOriginRefusal({
				method: 'POST',
				origin: ORIGIN,
				secFetchSite: 'none',
				expectedOrigin: ORIGIN
			})?.reason,
			'crossSiteFetch'
		);
	});
});

describe('public export session credential cookie', () => {
	const sessionId = createExportSessionIdentity();
	const credential = createExportSessionIdentity();

	it('scopes the credential to one session, one path, and the session lifetime', () => {
		const cookie = formatExportSessionCredentialCookie({
			sessionId,
			credential,
			maxAgeMs: 30 * 60 * 1000,
			isSecureOrigin: true
		});
		assert.equal(
			cookie,
			`${exportSessionCredentialCookieName(sessionId)}=${credential}; ` +
				`Path=/api/export/sessions/${sessionId}; Max-Age=1800; HttpOnly; SameSite=Strict; Secure`
		);
		assert.ok(
			!formatExportSessionCredentialCookie({
				sessionId,
				credential,
				maxAgeMs: 1_000,
				isSecureOrigin: false
			}).includes('Secure')
		);
	});

	it('reads back only the cookie belonging to the session being addressed', () => {
		const otherSession = createExportSessionIdentity();
		const header = [
			'unrelated=value',
			`${exportSessionCredentialCookieName(otherSession)}=${createExportSessionIdentity()}`,
			`${exportSessionCredentialCookieName(sessionId)}=${credential}`
		].join('; ');
		assert.equal(readExportSessionCredentialCookie(header, sessionId), credential);
		assert.equal(readExportSessionCredentialCookie(header, createExportSessionIdentity()), null);
		assert.equal(readExportSessionCredentialCookie(null, sessionId), null);
		assert.equal(
			readExportSessionCredentialCookie(
				`${exportSessionCredentialCookieName(sessionId)}=`,
				sessionId
			),
			null
		);
		// A cookie whose name merely contains the session's is not this session's.
		assert.equal(
			readExportSessionCredentialCookie(
				`x${exportSessionCredentialCookieName(sessionId)}=${credential}`,
				sessionId
			),
			null
		);
	});
});

describe('public export diagnostic redaction', () => {
	it('removes the session private values and any remaining absolute path', () => {
		const sessionId = createExportSessionIdentity();
		const credential = createExportSessionIdentity();
		const workDir = `/var/folders/t9/gfx-export-${sessionId}`;
		const redacted = redactExportDiagnostic(
			`Error opening ${workDir}/output.webm for session ${sessionId} (${credential}); ` +
				'/usr/local/opt/ffmpeg/bin/ffmpeg exited',
			[workDir, sessionId, credential]
		);
		assert.ok(!redacted.includes(sessionId));
		assert.ok(!redacted.includes(credential));
		assert.ok(!redacted.includes(workDir));
		assert.ok(!redacted.includes('/usr/local/opt/ffmpeg'));
		// The encoder's own complaint survives, which is the point of logging it.
		assert.match(redacted, /Error opening/);
		assert.match(redacted, /exited/);
	});
});
