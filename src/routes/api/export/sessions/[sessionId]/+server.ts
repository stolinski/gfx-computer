import { json, type RequestHandler } from '@sveltejs/kit';

import { exportSessionStore, ExportSessionError } from '$lib/platform/export-session.server';
import { PUBLIC_EXPORT_RESPONSE_HEADERS } from '$lib/platform/public-export-security';

// The session's owner asks how its one download went. The answer is a state
// (and a delivered file's size), read from what the origin already knows.
export const GET: RequestHandler = async ({ params, request }) => {
	try {
		return json(await exportSessionStore.deliveryStatus(params.sessionId ?? '', request), {
			headers: PUBLIC_EXPORT_RESPONSE_HEADERS
		});
	} catch (cause) {
		if (cause instanceof ExportSessionError) {
			return new Response(cause.message, {
				status: cause.status,
				headers: PUBLIC_EXPORT_RESPONSE_HEADERS
			});
		}
		throw cause;
	}
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	try {
		await exportSessionStore.cancel(params.sessionId ?? '', request);
		return new Response(null, { status: 204, headers: PUBLIC_EXPORT_RESPONSE_HEADERS });
	} catch (cause) {
		if (cause instanceof ExportSessionError) {
			return new Response(cause.message, {
				status: cause.status,
				headers: PUBLIC_EXPORT_RESPONSE_HEADERS
			});
		}
		throw cause;
	}
};
