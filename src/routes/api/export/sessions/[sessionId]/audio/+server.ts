import type { RequestHandler } from '@sveltejs/kit';

import {
	exportSessionStore,
	ExportSessionError,
	parseExportAudioOffset
} from '$lib/platform/export-session.server';
import { PUBLIC_EXPORT_RESPONSE_HEADERS } from '$lib/platform/public-export-security';

// One part of the audio bed per request, appended at `?offset=<byte>`. A
// request with no `offset` starts at byte 0.
export const PUT: RequestHandler = async ({ params, request, url }) => {
	try {
		await exportSessionStore.uploadAudio(
			params.sessionId ?? '',
			parseExportAudioOffset(url.searchParams.get('offset')),
			request
		);
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
