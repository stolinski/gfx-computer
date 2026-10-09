/**
 * Request-time security decisions for the public export transport (ADR-0052).
 *
 * `public-export-limits.ts` decides how much work a caller may ask for; this
 * module decides whether the caller is allowed to ask at all. Both are pure and
 * allocation-free so the export session store can refuse a request before it
 * touches ffmpeg, the filesystem, or another visitor's session.
 *
 * The public demo has no accounts, so an export session is bound to the browser
 * that opened it by a private credential the origin issues once and the browser
 * returns on every later request. The session identity travels in the URL and is
 * therefore visible to logs and to `Referer`; the credential travels only in a
 * `HttpOnly; SameSite=Strict` cookie, so a cross-site page can neither read it
 * nor make the browser send it. That pairing is what makes a download
 * authorization rather than a guessable public link.
 *
 * Deliberately free of Node imports: the same decisions are exercised by
 * fixtures, by the server transport, and by the public-runtime probe.
 */

/** The rule a refused export request broke. */
export type PublicExportRefusalReason =
	'crossOriginRequest' | 'crossSiteFetch' | 'missingSessionCredential' | 'foreignSessionCredential';

export interface PublicExportSecurityRefusal {
	reason: PublicExportRefusalReason;
	/** Status the export transport answers with. */
	status: number;
	/** Names the rule only — never an identity, credential, path, or content. */
	message: string;
}

/**
 * Characters of one export identity. 43 characters of 6 bits each is 258 bits
 * of entropy, so neither a session identity nor a credential is reachable by
 * guessing, and both stay inside the unreserved URL and cookie-token alphabet.
 */
export const EXPORT_SESSION_IDENTITY_LENGTH = 43;

const EXPORT_IDENTITY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const EXPORT_SESSION_IDENTITY_PATTERN = new RegExp(
	`^[A-Za-z0-9_-]{${EXPORT_SESSION_IDENTITY_LENGTH}}$`
);

/** Cookie name prefix; the session identity completes it so two concurrent exports never collide. */
const EXPORT_CREDENTIAL_COOKIE_PREFIX = 'gfx_export_';

/**
 * One unpredictable export identity — used both for the session identity that
 * appears in URLs and for the private credential that never does. Six bits are
 * taken from each random byte, so every character is uniform over the alphabet
 * with no modulo bias.
 */
export function createExportSessionIdentity(): string {
	const bytes = new Uint8Array(EXPORT_SESSION_IDENTITY_LENGTH);
	crypto.getRandomValues(bytes);
	let identity = '';
	for (const byte of bytes) identity += EXPORT_IDENTITY_ALPHABET[byte & 63];
	return identity;
}

/**
 * Whether a path parameter is shaped like an identity this origin issued.
 * Checked before the value is used to look a session up or to build a work
 * directory name, so `..`, an empty segment, a percent escape, or a separator
 * never reaches either.
 */
export function isExportSessionIdentity(value: string): boolean {
	return EXPORT_SESSION_IDENTITY_PATTERN.test(value);
}

export const MISSING_EXPORT_SESSION_CREDENTIAL_REFUSAL: PublicExportSecurityRefusal = {
	reason: 'missingSessionCredential',
	status: 403,
	message: 'This export session credential is missing. Start a new export.'
};

export const FOREIGN_EXPORT_SESSION_CREDENTIAL_REFUSAL: PublicExportSecurityRefusal = {
	reason: 'foreignSessionCredential',
	status: 403,
	message: 'This export session belongs to another browser session.'
};

/**
 * Whether the caller is allowed to address this origin's export transport.
 *
 * `expectedOrigin` must come from the request URL the SvelteKit Node adapter
 * resolved out of `ORIGIN` — never from `Host` or an `X-Forwarded-*` header, so
 * a client cannot talk the proxy into vouching for an origin of its choosing.
 *
 * A mutating request always carries `Origin`, so an exact match is required. A
 * download is a top-level navigation that carries none, so it is decided by
 * `Sec-Fetch-Site` instead: `same-origin` is the link click the app makes, and
 * `none` is a person opening the URL themselves. Anything else is a cross-site
 * page pulling on the transport.
 */
export function findExportRequestOriginRefusal(request: {
	method: string;
	origin: string | null;
	secFetchSite: string | null;
	expectedOrigin: string;
}): PublicExportSecurityRefusal | null {
	const { method, origin, secFetchSite, expectedOrigin } = request;
	const isNavigation = method === 'GET' || method === 'HEAD';
	if (secFetchSite !== null && secFetchSite !== 'same-origin') {
		if (!(isNavigation && secFetchSite === 'none')) {
			return {
				reason: 'crossSiteFetch',
				status: 403,
				message: 'Export requests must come from this origin.'
			};
		}
	}
	if (origin === null) {
		return isNavigation
			? null
			: {
					reason: 'crossOriginRequest',
					status: 403,
					message: 'Export requests must come from this origin.'
				};
	}
	return origin === expectedOrigin
		? null
		: {
				reason: 'crossOriginRequest',
				status: 403,
				message: 'Export requests must come from this origin.'
			};
}

export function exportSessionCredentialCookieName(sessionId: string): string {
	return `${EXPORT_CREDENTIAL_COOKIE_PREFIX}${sessionId}`;
}

/**
 * The `Set-Cookie` value binding one session to the browser that opened it.
 *
 * `Path` scopes the credential to this session's own endpoints, `HttpOnly`
 * keeps it out of script, `SameSite=Strict` keeps a cross-site page from making
 * the browser send it, and `Max-Age` matches the session's hard lifetime so the
 * browser stops presenting a credential the origin has already forgotten.
 * `Secure` follows the origin, because a local http development origin would
 * otherwise refuse to store it.
 */
export function formatExportSessionCredentialCookie(options: {
	sessionId: string;
	credential: string;
	maxAgeMs: number;
	isSecureOrigin: boolean;
}): string {
	const { sessionId, credential, maxAgeMs, isSecureOrigin } = options;
	const attributes = [
		`${exportSessionCredentialCookieName(sessionId)}=${credential}`,
		`Path=/api/export/sessions/${sessionId}`,
		`Max-Age=${Math.max(1, Math.ceil(maxAgeMs / 1000))}`,
		'HttpOnly',
		'SameSite=Strict'
	];
	if (isSecureOrigin) attributes.push('Secure');
	return attributes.join('; ');
}

/**
 * The credential this request presents for `sessionId`, or `null` when it
 * presents none. Only this session's cookie is read, so a browser holding two
 * concurrent exports cannot have one authorize the other.
 */
export function readExportSessionCredentialCookie(
	cookieHeader: string | null,
	sessionId: string
): string | null {
	if (cookieHeader === null) return null;
	const name = exportSessionCredentialCookieName(sessionId);
	for (const pair of cookieHeader.split(';')) {
		const separator = pair.indexOf('=');
		if (separator < 0) continue;
		if (pair.slice(0, separator).trim() !== name) continue;
		const value = pair.slice(separator + 1).trim();
		return value === '' ? null : value;
	}
	return null;
}

/** Compare two credentials without an early exit that would leak their prefix. */
export function isMatchingExportCredential(presented: string, expected: string): boolean {
	if (presented.length !== expected.length) return false;
	let difference = 0;
	for (let index = 0; index < presented.length; index += 1) {
		difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
	}
	return difference === 0;
}

/**
 * What a caller is told when an encode fails. The encoder's own output names
 * the private work directory it was writing to, so it is never forwarded; the
 * redacted tail is logged at the origin instead.
 */
export const EXPORT_ENCODER_FAILURE_MESSAGE = 'Export encoding failed.';

const ABSOLUTE_PATH_PATTERN = /(?:\/[\w.@-]+){2,}/g;

/**
 * Strip private values out of a diagnostic before it is logged. `secrets` are
 * the exact strings this session owns — its work directory, its identity, its
 * credential — and any remaining absolute path is removed too, so a message
 * from a tool that names a path we did not anticipate still cannot carry one
 * into the log or into Sentry (ADR-0052 redacted observability).
 */
export function redactExportDiagnostic(text: string, secrets: readonly string[]): string {
	let redacted = text;
	for (const secret of secrets) {
		if (secret === '') continue;
		redacted = redacted.split(secret).join('[redacted]');
	}
	return redacted.replace(ABSOLUTE_PATH_PATTERN, '[redacted path]');
}

/**
 * Headers every export response carries. The transport answers about a private,
 * single-shot resource, so nothing between the origin and the browser may keep
 * a copy or re-serve one, and a response whose authorization came from a cookie
 * is never shared across cookies.
 */
export const PUBLIC_EXPORT_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
	Vary: 'Cookie'
};

/**
 * Added to the download response. `Accept-Ranges: none` tells a client and any
 * intermediary that the single-shot body cannot be resumed or re-requested —
 * resuming would mean retaining rendered content, which the public runtime
 * never does.
 *
 * `Content-Disposition: attachment` makes the response a file to save however
 * the URL was reached, so the browser streams it to disk and never renders it.
 * It deliberately names no file: the browser takes the name from the `download`
 * attribute the app sets, which is where the ADR-0042 sync filename comes from.
 * A server-supplied name would silently override that one, and the origin would
 * have to be told the name in a URL that logs can see.
 */
export const PUBLIC_EXPORT_DOWNLOAD_HEADERS: Readonly<Record<string, string>> = {
	...PUBLIC_EXPORT_RESPONSE_HEADERS,
	'Accept-Ranges': 'none',
	'Content-Disposition': 'attachment'
};
