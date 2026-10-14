/**
 * The throwaway world a verification run is allowed to touch.
 *
 * A probe used to spawn its server with no explicit `cwd`, inherit the primary
 * checkout, and be handed the author's real composition store — which is how the
 * browser-session-integrity probe deleted about thirty compositions on
 * 2026-08-29. Every harness that starts a GFX server now creates a jail first and
 * spawns with `{ cwd, env: { ...process.env, ...jail.environment } }`, so the
 * server's store, export scratch space, and browser profile are all directories
 * this run made and this run removes.
 *
 * `scripts/check-verification-spawn-hygiene.mjs` fails the build when a harness
 * spawn skips any of that.
 */
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The dev server in `vite.config.ts`. A harness run must never address it. */
export const DEVELOPMENT_SERVER_PORT = 7263;

export interface VerificationServerJail {
	root: string;
	compositionStoreDirectory: string;
	exportTemporaryDirectory: string;
	/** A fresh Chrome profile, so no harness run inherits another run's tabs, storage, or cookies. */
	chromeProfileDirectory: string;
	/** Spread over `process.env` when spawning the server under measurement. */
	environment: Record<string, string>;
	dispose(): Promise<void>;
}

/**
 * Refuse any address that is not a throwaway loopback origin. The dev server
 * holds the real store, so a harness that points at it is the incident again —
 * this time as a write rather than a delete (`untitled / Signal to noise`).
 */
export function assertVerificationOriginAllowed(origin: string): void {
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		throw new Error(`A verification run needs an absolute origin; received "${origin}".`);
	}
	if (
		parsed.hostname !== 'localhost' &&
		parsed.hostname !== '127.0.0.1' &&
		parsed.hostname !== '::1'
	) {
		throw new Error(
			`A verification run may only address loopback; received "${origin}". Point it at a server this run started.`
		);
	}
	if (Number(parsed.port) === DEVELOPMENT_SERVER_PORT) {
		throw new Error(
			`A verification run may not address the dev server on port ${DEVELOPMENT_SERVER_PORT}: it serves the author's real composition store. Start a server of your own with createVerificationServerJail().`
		);
	}
}

/** Create the jail. `label` only makes the temp directory recognisable while a run is live. */
export async function createVerificationServerJail(label: string): Promise<VerificationServerJail> {
	const root = await mkdtemp(join(tmpdir(), `gfx-verification-${label}-`));
	const compositionStoreDirectory = join(root, 'compositions');
	const exportTemporaryDirectory = join(root, 'export');
	const chromeProfileDirectory = join(root, 'chrome-profile');
	return {
		root,
		compositionStoreDirectory,
		exportTemporaryDirectory,
		chromeProfileDirectory,
		environment: {
			GFX_VERIFICATION_RUN: '1',
			GFX_USER_COMPOSITION_STORE_DIRECTORY: compositionStoreDirectory,
			GFX_EXPORT_TEMPORARY_DIRECTORY: exportTemporaryDirectory
		},
		dispose: async (): Promise<void> => {
			// Chrome keeps flushing its profile for a moment after it stops answering
			// on the debug port, so a jail holding a browser profile can still be
			// refilled while it is being removed. Retry rather than fail a run whose
			// work is already written.
			await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	};
}

/**
 * Stop a jailed dev server and everything under it. The server runs as
 * `pnpm exec vp dev`; a signal to the pnpm wrapper alone leaves the server
 * listening and its pipes open, so the harness never exits. Spawn the server
 * with `detached: true` (its own process group) and stop it with this.
 */
export function signalServerProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.exitCode !== null || child.pid === undefined) return;
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		// The group already exited between the check and the signal.
		if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
	}
}
