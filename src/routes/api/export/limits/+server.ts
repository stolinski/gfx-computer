import { json, type RequestHandler } from '@sveltejs/kit';

import { exportSessionStore } from '$lib/platform/export-session.server';

/**
 * The export limits this origin enforces, for the page that is about to export
 * and the agent that asks what will fit (ADR-0068 §9). The runtime profile is a
 * private input, so the page cannot work the envelope out for itself: a
 * development host answers with the Film-length one and a public host with the
 * ratified fifteen seconds. The hosted origin serves no `/api/export/` route, so
 * its 404 is the answer "the public envelope" (`fetchServedExportRuntimeLimits`).
 *
 * These are the ratified numbers and the host's configured session bounds —
 * never live capacity, which `/api/health` also keeps to itself.
 */
export const GET: RequestHandler = () =>
	json(exportSessionStore.servedLimits, { headers: { 'Cache-Control': 'no-store' } });
