/**
 * Which server surfaces the public gfx.computer origin answers, and which ones
 * exist only for local development
 * ([ADR-0052](../../../docs/adr/0052-public-runtime-and-retention-architecture.md),
 * [ADR-0053](../../../docs/adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)).
 *
 * ADR-0053 draws the line: a route that reads or writes durable content on a
 * visitor's behalf, reads the repository, or answers a control-plane question is
 * development-only and is excluded from the public artifact; a route that serves
 * the app, or performs a bounded operation that destroys its own output, is
 * public. That decision was prose. This is the executable form of it — one row
 * per surface, matched by longest path prefix, so "is this reachable publicly?"
 * has exactly one answer and adding a route means adding its row.
 *
 * The exclusion is enforced in the server hook rather than at the route, because
 * a surface that should not exist publicly must not be reachable at all: it
 * answers 404 before its module reads a body, touches disk, or spawns anything.
 *
 * The hosted origin (ADR-0052 amendment) draws one more line inside the public
 * set: a surface that needs the Node process — ffmpeg, temp disk, a request body
 * of native frames — is `node-origin`, and a Worker answers 404 for it exactly
 * as it does for a development-only route, because on that host the browser
 * performs the export itself and the transport does not exist.
 *
 * Deliberately free of Node and `$env` imports, like its `public-runtime-contract`
 * peer, so the hook, the tests, and the production-image gate read one inventory.
 */

import type { PublicRuntimeProfile } from './public-runtime-deployment';

/**
 * Who serves a surface: every non-development host (`public`), only the
 * Node/ffmpeg origin (`node-origin`), or only a development host.
 */
export type PublicSurfaceExposure = 'public' | 'node-origin' | 'development-only';

export interface PublicSurfaceRow {
	/**
	 * Path prefix this row owns. A request is matched against every row and the
	 * longest matching prefix wins, so `/api/export/` is decided by its own row
	 * rather than by the `/` app-shell row.
	 */
	pathPrefix: string;
	exposure: PublicSurfaceExposure;
	/** Why this surface is or is not part of a no-account public demo. */
	reason: string;
}

/**
 * The row every request path falls back to, named separately because
 * `findPublicSurface` relies on it always matching: every path starts with `/`.
 */
const APP_SHELL_SURFACE: PublicSurfaceRow = {
	pathPrefix: '/',
	exposure: 'public',
	reason:
		'The app shell, the composition library, and every static asset the browser loads to render one. This row is the fallback, so an unclassified route is public by accident — which is what the inventory completeness test exists to prevent.'
};

/**
 * Every server surface this repository serves, classified. Ordered by path so a
 * reader finds a route where they expect it; matching does not depend on order.
 */
export const PUBLIC_SURFACE_INVENTORY: readonly PublicSurfaceRow[] = [
	APP_SHELL_SURFACE,
	{
		pathPrefix: '/p/',
		exposure: 'public',
		reason:
			'The Workspace. A public visitor opens it directly; the composition it edits lives in their browser, never on the origin.'
	},
	{
		pathPrefix: '/poc/',
		exposure: 'development-only',
		reason:
			'Proof-of-concept fixture routes that exercise a renderer in isolation. They are engine scratch space, not a demo surface.'
	},
	{
		pathPrefix: '/api/backdrops',
		exposure: 'development-only',
		reason:
			'Lists the static/backdrops directory of the checkout it is running from. There is no checkout inside the production image, so it could only ever answer with an empty list — and a repository read is not a public surface either way.'
	},
	{
		pathPrefix: '/api/export/',
		exposure: 'node-origin',
		reason:
			'The bounded export transport. It performs one operation and destroys its own output: frames stream into ffmpeg, the encoded file is downloadable exactly once, and every terminal path removes the session (ADR-0052). Only the Node origin has the encoder and the disk; the hosted origin encodes in the browser and does not serve it.'
	},
	{
		pathPrefix: '/api/health',
		exposure: 'public',
		reason:
			'Liveness and release identity, redacted to those two facts. A deploy or rollback is verified by reading it back from the public origin, so it has to answer there.'
	},
	{
		pathPrefix: '/api/posters/',
		exposure: 'development-only',
		reason:
			'Reads and writes poster images on origin disk. ADR-0053 names the poster surface development-only: the public runtime keeps no durable visitor content.'
	},
	{
		pathPrefix: '/api/sentry-canary',
		exposure: 'development-only',
		reason:
			'A control-plane probe for the Sentry development flow. It reports on our own observability wiring, which is not something a visitor asks about.'
	},
	{
		pathPrefix: '/api/user-assets',
		exposure: 'development-only',
		reason:
			'Stores uploaded visitor media on origin disk. ADR-0053 names the asset surface development-only; publicly, media comes from a bundled demo asset or a handle the visitor granted this page (ADR-0054 §7).'
	},
	{
		pathPrefix: '/api/user-compositions',
		exposure: 'development-only',
		reason:
			'The disk-backed User composition store. Excluded here by deployment profile; `assertOriginCompositionStoreServed` separately refuses it whenever this build serves the browser-scoped session store, which a development host can also be configured for.'
	},
	{
		pathPrefix: '/api/user-packs',
		exposure: 'development-only',
		reason:
			'The disk-backed User Pack store (ADR-0055): list, fork, save, and delete pack documents in origin app data. Same boundary as the composition store; `assertOriginUserPackStoreServed` refuses it under a browser-scoped session.'
	},
	{
		pathPrefix: '/api/user-pack-fonts/',
		exposure: 'development-only',
		reason:
			'Serves the hash-pinned woff2 bytes a User Pack materialized into origin app data (ADR-0055). It sits behind the same boundary as the composition store: `assertOriginUserPackStoreServed` refuses it whenever this build serves the browser-scoped session.'
	},
	{
		pathPrefix: '/api/verification/',
		exposure: 'development-only',
		reason:
			'Fingerprints the repository working tree so a render sweep can prove which checkout it measured. It is a repository surface, and it exists for our gates.'
	},
	{
		pathPrefix: '/api/website-capture',
		exposure: 'development-only',
		reason:
			'Drives a headless browser against a caller-supplied URL. ADR-0054 §7 keeps the site-capture surface development-only: the public origin makes no outbound request an untrusted caller chose.'
	},
	{
		pathPrefix: '/api/x-post',
		exposure: 'development-only',
		reason:
			'Fetches a caller-supplied X status through the origin. Same rule as site capture — an authoring import that turns the public origin into a request forwarder.'
	}
];

/**
 * The row that owns a request path: the longest declared prefix it starts with.
 * Every path resolves, because the `/` row is a prefix of all of them.
 */
export function findPublicSurface(pathname: string): PublicSurfaceRow {
	let owner = APP_SHELL_SURFACE;
	for (const row of PUBLIC_SURFACE_INVENTORY) {
		if (!pathname.startsWith(row.pathPrefix)) continue;
		if (row.pathPrefix.length > owner.pathPrefix.length) owner = row;
	}
	return owner;
}

/** Whether a public origin must refuse this path outright. */
export function isDevelopmentOnlySurfacePath(pathname: string): boolean {
	return findPublicSurface(pathname).exposure === 'development-only';
}

/**
 * Whether a host serving `profile` must refuse this path before its route
 * module runs. A development host refuses nothing; the Node origin refuses the
 * development-only surfaces; the hosted origin refuses those and the Node-only
 * export transport it has no encoder for.
 */
export function isSurfaceRefusedByProfile(pathname: string, profile: PublicRuntimeProfile): boolean {
	if (profile === 'development') return false;
	const exposure = findPublicSurface(pathname).exposure;
	if (exposure === 'development-only') return true;
	return profile === 'hosted' && exposure === 'node-origin';
}

/**
 * What a public origin answers for a surface it does not serve. A 404 and not a
 * 403: publicly, the surface does not exist, and saying "forbidden" would
 * confirm that this deployment has one.
 */
export const DEVELOPMENT_ONLY_SURFACE_STATUS = 404;

export const DEVELOPMENT_ONLY_SURFACE_MESSAGE = 'Not Found';
