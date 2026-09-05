import assert from 'node:assert/strict';

import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';

import validPreset from '$lib/presets/blank.json';
import type { Preset } from '$lib/platform/engine-schema';
import { parsePresetIngress } from '$lib/platform/preset-ingress';
import {
	addUserCompositionFileToIndex,
	userCompositionFileExists
} from '$lib/platform/user-composition-file-index.server';
import { posterKeyForPreset } from '$lib/platform/posters';
import { presetToWireFormat } from '$lib/platform/preset-pure';

const fsMocks = vi.hoisted(() => ({
	mkdir: vi.fn<(path: string, options: { recursive: true }) => Promise<string | undefined>>(),
	readdir: vi.fn<(path: string) => Promise<string[]>>(),
	readFile: vi.fn<(path: string, encoding: 'utf-8') => Promise<string>>(),
	rename: vi.fn<(oldPath: string, newPath: string) => Promise<void>>(),
	writeFile: vi.fn<(path: string, data: string, encoding: 'utf-8') => Promise<void>>(),
	copyFile: vi.fn<(source: string, destination: string) => Promise<void>>(),
	rm: vi.fn<(path: string, options: { recursive: true; force: true }) => Promise<void>>(),
	unlink: vi.fn<(path: string) => Promise<void>>()
}));
const mediaMocks = vi.hoisted(() => ({
	inspectUserCompositionMedia: vi.fn(),
	assertUserCompositionMediaReady: vi.fn((inspection: unknown) => {
		if (
			typeof inspection === 'object' &&
			inspection !== null &&
			'status' in inspection &&
			inspection.status !== 'ready'
		) {
			const issues =
				'issues' in inspection && Array.isArray(inspection.issues) ? inspection.issues : [];
			const messages = issues.flatMap((issue) =>
				typeof issue === 'object' &&
				issue !== null &&
				'message' in issue &&
				typeof issue.message === 'string'
					? [issue.message]
					: []
			);
			throw new TypeError(messages.join('\n') || 'Referenced media asset is unavailable');
		}
	})
}));

vi.mock('node:fs/promises', () => fsMocks);
vi.mock('$lib/platform/user-composition-media.server', () => mediaMocks);

let collectionHandlers: typeof import('./+server.ts');
let slugHandlers: typeof import('./[slug]/+server.ts');

beforeAll(async () => {
	collectionHandlers = await import('./+server.ts');
	slugHandlers = await import('./[slug]/+server.ts');
}, 30_000);

beforeEach(() => {
	vi.clearAllMocks();
	fsMocks.mkdir.mockResolvedValue(undefined);
	fsMocks.readdir.mockResolvedValue([]);
	fsMocks.rename.mockResolvedValue(undefined);
	fsMocks.writeFile.mockResolvedValue(undefined);
	fsMocks.copyFile.mockResolvedValue(undefined);
	fsMocks.rm.mockResolvedValue(undefined);
	fsMocks.unlink.mockResolvedValue(undefined);
	mediaMocks.inspectUserCompositionMedia.mockResolvedValue({ status: 'ready', issues: [] });
});

function mediaPreset(): unknown {
	return {
		...validPreset,
		name: 'Media composition',
		state: {
			...validPreset.state,
			media: {
				assets: [
					{
						id: 'interview-asset',
						kind: 'video',
						name: 'Interview',
						assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
					},
					{
						id: 'library-only-asset',
						kind: 'video',
						name: 'Library only',
						assetUrl: `/api/user-assets/${'b'.repeat(64)}.mov`
					}
				],
				videoTrack: {
					clips: [
						{
							id: 'interview-clip',
							assetId: 'interview-asset',
							timelineStartFrame: 0,
							durationFrames: 90,
							sourceStartSeconds: 1.5,
							audio: { enabled: false, gain: 0.65 }
						}
					]
				}
			}
		}
	};
}

function chartPreset(): Preset {
	return parsePresetIngress({
		...validPreset,
		name: 'Agent chart',
		state: {
			...validPreset.state,
			surface: {
				...validPreset.state.surface,
				chart: {
					mode: 'single',
					items: [
						{
							id: 'agent-chart',
							type: 'column-chart',
							title: 'Agent count',
							data: {
								categories: [{ id: 'multiple', label: '2–5' }],
								series: [
									{
										id: 'responses',
										label: 'Responses',
										values: [{ categoryId: 'multiple', value: 744 }]
									}
								]
							},
							layout: { mode: 'single' },
							domain: { min: 0, max: 800 },
							labels: { values: true, legend: false },
							fill: { role: 'default' },
							motion: {
								entry: { start: 0, duration: 0.1 },
								reveal: { start: 0.1, duration: 0.2 },
								emphasis: { start: 0.3, duration: 0.1 },
								annotation: { start: 0.4, duration: 0.1 },
								exit: { start: 0.9, duration: 0.1 }
							}
						}
					]
				}
			}
		}
	});
}

function legacySourceVideoPreset(): unknown {
	return {
		...validPreset,
		name: 'Legacy Source composition',
		state: {
			...validPreset.state,
			sourceVideo: {
				assetUrl: `/api/user-assets/${'c'.repeat(64)}.webm`,
				sourceOffsetSeconds: 1.5,
				includeAudio: false,
				volume: 0.65
			}
		}
	};
}

function postEvent(body: unknown): Parameters<(typeof collectionHandlers)['POST']>[0] {
	return {
		request: new Request('http://localhost/api/user-compositions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<(typeof collectionHandlers)['POST']>[0];
}

function expectHttpError(status: number, message: string): (cause: unknown) => boolean {
	return (cause) => isHttpError(cause, status) && cause.body.message.includes(message);
}

describe('user composition handlers', () => {
	it('rejects invalid slugs and invalid presets', async () => {
		await assert.rejects(
			async () => collectionHandlers.POST(postEvent({ slug: '../escape', preset: validPreset })),
			expectHttpError(400, 'slug must be lowercase')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'valid-slug', preset: { name: 'Incomplete' } })),
			expectHttpError(400, 'Invalid preset')
		);
		assert.equal(fsMocks.writeFile.mock.calls.length, 0);
	});

	it('writes a valid preset in wire format', async () => {
		const response = await collectionHandlers.POST(
			postEvent({ slug: 'blank-copy', preset: validPreset, forkedFrom: 'blank' })
		);

		assert.equal(response.status, 201);
		assert.deepEqual(await response.json(), { slug: 'blank-copy' });
		assert.equal(fsMocks.writeFile.mock.calls.length, 1);

		const [path, data, encoding] = fsMocks.writeFile.mock.calls[0];
		const stored = JSON.parse(data) as {
			meta: { forkedFrom: string | null; savedAt: string };
			preset: { state: { surface: { content: { body: unknown } } } };
		};
		assert.match(path, /GFX\/compositions\/\.[a-f0-9-]+\.tmp$/);
		assert.equal(fsMocks.rename.mock.calls[0]?.[0], path);
		assert.match(fsMocks.rename.mock.calls[0]?.[1] ?? '', /GFX\/compositions\/blank-copy\.json$/);
		assert.equal(encoding, 'utf-8');
		assert.equal(stored.meta.forkedFrom, 'blank');
		assert.equal(Number.isNaN(Date.parse(stored.meta.savedAt)), false);
		assert.equal(stored.preset.state.surface.content.body, '');
	});

	it('skips corrupt files when listing compositions', async () => {
		fsMocks.readdir.mockResolvedValue([
			'valid.json',
			'invalid-meta.json',
			'invalid-preset.json',
			'bad-json.json',
			'notes.txt'
		]);
		fsMocks.readFile.mockImplementation(async (path) => {
			if (path.endsWith('valid.json')) {
				return JSON.stringify({
					meta: { forkedFrom: null, savedAt: '2026-07-14T12:00:00.000Z' },
					preset: validPreset
				});
			}
			if (path.endsWith('invalid-meta.json')) {
				return JSON.stringify({
					meta: { forkedFrom: null, savedAt: 42 },
					preset: validPreset
				});
			}
			if (path.endsWith('invalid-preset.json')) {
				return JSON.stringify({
					meta: { forkedFrom: null, savedAt: '2026-07-14T13:00:00.000Z' },
					preset: { name: 'Incomplete' }
				});
			}
			return '{not-json';
		});

		const response = await collectionHandlers.GET(
			{} as Parameters<(typeof collectionHandlers)['GET']>[0]
		);

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), [
			{
				slug: 'valid',
				name: 'Blank',
				forkedFrom: null,
				savedAt: '2026-07-14T12:00:00.000Z',
				posterKey: posterKeyForPreset(parsePresetIngress(validPreset)),
				durationSeconds: parsePresetIngress(validPreset).state.transport.durationSeconds,
				surfaceType: parsePresetIngress(validPreset).state.surface.type,
				media: { assets: [], videoTrack: { clips: [] } },
				mediaStatus: 'ready'
			}
		]);
	});

	it('skips store files whose stem is not an addressable slug', async () => {
		fsMocks.readdir.mockResolvedValue(['.json', 'Not A Slug.json', 'valid.json']);
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-08-29T12:00:00.000Z' },
				preset: validPreset
			})
		);

		const response = await collectionHandlers.GET(
			{} as Parameters<(typeof collectionHandlers)['GET']>[0]
		);

		const metadata = (await response.json()) as Array<Record<string, unknown>>;
		assert.deepEqual(
			metadata.map((entry) => entry.slug),
			['valid']
		);
	});

	it('returns null from a slug GET when no composition exists', async () => {
		fsMocks.readFile.mockRejectedValue(
			Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
		);

		const response = await slugHandlers.GET({
			params: { slug: 'absent' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);

		assert.equal(response.status, 200);
		assert.equal(await response.json(), null);
	});

	it('returns null and stops indexing a blank legacy file as a User composition', async () => {
		fsMocks.readFile.mockResolvedValue('\n \t');
		await addUserCompositionFileToIndex('empty-write');

		const response = await slugHandlers.GET({
			params: { slug: 'empty-write' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);

		assert.equal(response.status, 200);
		assert.equal(await response.json(), null);
		assert.equal(await userCompositionFileExists('empty-write'), false);
	});

	it('returns null and stops indexing a malformed legacy file as a User composition', async () => {
		fsMocks.readFile.mockResolvedValue('{not-json');
		await addUserCompositionFileToIndex('incomplete-write');

		const response = await slugHandlers.GET({
			params: { slug: 'incomplete-write' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);

		assert.equal(response.status, 200);
		assert.equal(await response.json(), null);
		assert.equal(await userCompositionFileExists('incomplete-write'), false);
	});

	it('coalesces concurrent reads of the same User composition', async () => {
		let resolveRead: ((value: string) => void) | undefined;
		fsMocks.readFile.mockImplementationOnce(
			() => new Promise<string>((resolve) => (resolveRead = resolve))
		);
		const event = {
			params: { slug: 'concurrent' }
		} as Parameters<(typeof slugHandlers)['GET']>[0];

		const firstResponse = slugHandlers.GET(event);
		const secondResponse = slugHandlers.GET(event);
		await vi.waitFor(() => assert.equal(fsMocks.readFile.mock.calls.length, 1));
		resolveRead?.(
			JSON.stringify({
				meta: { forkedFrom: 'blank', savedAt: '2026-07-14T12:00:00.000Z' },
				preset: validPreset
			})
		);

		const [first, second] = await Promise.all([firstResponse, secondResponse]);
		assert.deepEqual(await first.json(), presetToWireFormat(parsePresetIngress(validPreset)));
		assert.deepEqual(await second.json(), presetToWireFormat(parsePresetIngress(validPreset)));
		assert.equal(fsMocks.readFile.mock.calls.length, 1);
	});

	it('rejects a slug GET whose file read fails for a non-ENOENT reason', async () => {
		fsMocks.readFile.mockRejectedValue(
			Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
		);

		await assert.rejects(
			async () =>
				slugHandlers.GET({
					params: { slug: 'unreadable' }
				} as Parameters<(typeof slugHandlers)['GET']>[0]),
			expectHttpError(500, 'Failed to read user composition')
		);
	});

	it('refuses a schema-invalid stored composition from a slug GET without filing it as a server fault', async () => {
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-07-14T12:00:00.000Z' },
				preset: { name: 'Incomplete' }
			})
		);

		await assert.rejects(
			async () =>
				slugHandlers.GET({
					params: { slug: 'corrupt' }
				} as Parameters<(typeof slugHandlers)['GET']>[0]),
			expectHttpError(409, 'is not one this engine accepts')
		);
	});

	it('answers 500 only when the stored file is not a store document at all', async () => {
		fsMocks.readFile.mockResolvedValue(JSON.stringify({ preset: { name: 'No meta' } }));

		await assert.rejects(
			async () =>
				slugHandlers.GET({
					params: { slug: 'not-a-store-document' }
				} as Parameters<(typeof slugHandlers)['GET']>[0]),
			expectHttpError(500, 'Corrupt user composition file')
		);
	});

	it('returns the standalone wire format accepted by PUT', async () => {
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: 'blank', savedAt: '2026-07-14T12:00:00.000Z' },
				preset: validPreset
			})
		);

		const getResponse = await slugHandlers.GET({
			params: { slug: 'round-trip' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		const standalonePreset: unknown = await getResponse.json();
		const parsed = parsePresetIngress(standalonePreset);

		assert.deepEqual(standalonePreset, presetToWireFormat(parsed));
		const putResponse = await slugHandlers.PUT({
			params: { slug: 'round-trip' },
			request: new Request('http://localhost/api/user-compositions/round-trip', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(standalonePreset)
			})
		} as Parameters<(typeof slugHandlers)['PUT']>[0]);

		assert.equal(putResponse.status, 204);
		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			preset: unknown;
		};
		assert.deepEqual(written.preset, standalonePreset);
	});

	it('preserves valid charts and rejects semantic chart errors at POST, GET, and PUT boundaries', async () => {
		const preset = chartPreset();
		const wire = presetToWireFormat(preset);
		const postResponse = await collectionHandlers.POST(
			postEvent({ slug: 'agent-chart', preset: wire, forkedFrom: 'blank' })
		);
		assert.equal(postResponse.status, 201);
		const stored = fsMocks.writeFile.mock.calls[0]?.[1];
		assert.ok(stored);
		fsMocks.readFile.mockResolvedValue(stored);

		const getResponse = await slugHandlers.GET({
			params: { slug: 'agent-chart' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		assert.deepEqual(await getResponse.json(), wire);
		const putResponse = await slugHandlers.PUT({
			params: { slug: 'agent-chart' },
			request: new Request('http://localhost/api/user-compositions/agent-chart', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(wire)
			})
		} as Parameters<(typeof slugHandlers)['PUT']>[0]);
		assert.equal(putResponse.status, 204);

		const invalidWire = structuredClone(wire) as Preset;
		invalidWire.state.surface.chart!.items[0].domain = { min: 500, max: 800 };
		const unknownKeyWire = structuredClone(wire) as unknown as {
			state: { surface: { chart: { items: Array<Record<string, unknown>> } } };
		};
		unknownKeyWire.state.surface.chart.items[0]['literalColor'] = '#ff0000';
		await assert.rejects(
			async () =>
				collectionHandlers.POST(
					postEvent({ slug: 'unknown-chart-key', preset: unknownKeyWire, forkedFrom: 'blank' })
				),
			expectHttpError(400, 'Invalid preset')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(
					postEvent({ slug: 'invalid-chart', preset: invalidWire, forkedFrom: 'blank' })
				),
			expectHttpError(400, 'domains must include zero')
		);
		await assert.rejects(
			async () =>
				slugHandlers.PUT({
					params: { slug: 'agent-chart' },
					request: new Request('http://localhost/api/user-compositions/agent-chart', {
						method: 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(invalidWire)
					})
				} as Parameters<(typeof slugHandlers)['PUT']>[0]),
			expectHttpError(400, 'domains must include zero')
		);

		// GFX-COMPUTER-18 / -19: a stored chart whose domain stopped being allowed
		// after it was saved is the author's work going stale, not this origin
		// failing. A 5xx here filed one Sentry issue every time they opened it.
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-08-07T12:00:00.000Z' },
				preset: invalidWire
			})
		);
		await assert.rejects(
			async () =>
				slugHandlers.GET({
					params: { slug: 'invalid-chart' }
				} as Parameters<(typeof slugHandlers)['GET']>[0]),
			expectHttpError(409, 'domains must include zero')
		);
	});

	it('preserves agent-only fields through an agent to GUI to agent workflow', async () => {
		const agentPreset = parsePresetIngress(validPreset);
		agentPreset.name = 'Agent-authored composition';
		agentPreset.state.transport.durationSeconds = 7.5;
		agentPreset.state.stage = {
			type: 'depth',
			camera: { move: 'push', amount: 0.2, ease: 'smooth' },
			focus: { focusZ: 0.4, aperture: 0.3, band: 0.1 }
		};
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-07-14T12:00:00.000Z' },
				preset: presetToWireFormat(agentPreset)
			})
		);

		const getResponse = await slugHandlers.GET({
			params: { slug: 'agent-composition' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		const guiLoadedPreset: unknown = await getResponse.json();
		const parsed = parsePresetIngress(guiLoadedPreset);
		parsed.name = 'Edited in GUI';

		await slugHandlers.PUT({
			params: { slug: 'agent-composition' },
			request: new Request('http://localhost/api/user-compositions/agent-composition', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(presetToWireFormat(parsed))
			})
		} as Parameters<(typeof slugHandlers)['PUT']>[0]);

		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			preset: unknown;
		};
		const agentReloadedPreset = parsePresetIngress(written.preset);
		assert.equal(agentReloadedPreset.name, 'Edited in GUI');
		assert.equal(agentReloadedPreset.state.transport.durationSeconds, 7.5);
		assert.deepEqual(agentReloadedPreset.state.stage, agentPreset.state.stage);
	});

	it('preserves composition media through GUI-agent GET/PUT and list metadata round trips', async () => {
		const preset = mediaPreset();
		const media = parsePresetIngress(preset).state.media;
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-07-27T12:00:00.000Z' },
				preset
			})
		);

		const getResponse = await slugHandlers.GET({
			params: { slug: 'media-composition' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		const standalonePreset = (await getResponse.json()) as {
			name: string;
			state: Record<string, unknown>;
		};
		standalonePreset.name = 'Edited by agent';
		await slugHandlers.PUT({
			params: { slug: 'media-composition' },
			request: new Request('http://localhost/api/user-compositions/media-composition', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(standalonePreset)
			})
		} as Parameters<(typeof slugHandlers)['PUT']>[0]);
		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			preset: { state: Record<string, unknown> };
		};
		assert.deepEqual(written.preset.state.media, media);
		assert.equal(Object.hasOwn(written.preset.state, 'sourceVideo'), false);

		fsMocks.readdir.mockResolvedValue(['media-composition.json']);
		const listResponse = await collectionHandlers.GET(
			{} as Parameters<(typeof collectionHandlers)['GET']>[0]
		);
		assert.deepEqual(await listResponse.json(), [
			{
				slug: 'media-composition',
				name: 'Media composition',
				forkedFrom: null,
				savedAt: '2026-07-27T12:00:00.000Z',
				posterKey: posterKeyForPreset(parsePresetIngress(preset)),
				durationSeconds: parsePresetIngress(preset).state.transport.durationSeconds,
				surfaceType: parsePresetIngress(preset).state.surface.type,
				media,
				mediaStatus: 'ready'
			}
		]);
	});

	it('upgrades legacy Source video input to canonical media on POST and the first PUT autosave', async () => {
		const preset = legacySourceVideoPreset();
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-07-27T12:00:00.000Z' },
				preset
			})
		);

		const loaded = await slugHandlers.GET({
			params: { slug: 'legacy-source' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		const canonicalPreset = (await loaded.json()) as { state: Record<string, unknown> };
		assert.equal(Object.hasOwn(canonicalPreset.state, 'sourceVideo'), false);
		assert.ok(canonicalPreset.state.media);

		await slugHandlers.PUT({
			params: { slug: 'legacy-source' },
			request: new Request('http://localhost/api/user-compositions/legacy-source', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(canonicalPreset)
			})
		} as Parameters<(typeof slugHandlers)['PUT']>[0]);
		await collectionHandlers.POST(
			postEvent({ slug: 'legacy-fork', preset, forkedFrom: 'legacy-source' })
		);

		for (const call of fsMocks.writeFile.mock.calls) {
			const stored = JSON.parse(call[1]) as { preset: { state: Record<string, unknown> } };
			assert.equal(Object.hasOwn(stored.preset.state, 'sourceVideo'), false);
			assert.equal(Object.hasOwn(stored.preset.state, 'mediaStatus'), false);
			assert.equal(Object.hasOwn(stored.preset.state, 'mediaIssues'), false);
			assert.ok(stored.preset.state.media);
		}
	});

	it('keeps missing referenced media repairable and visible while rejecting new writes', async () => {
		const preset = mediaPreset();
		const media = parsePresetIngress(preset).state.media;
		const message = `Referenced media asset "interview-asset" at ${media.assets[0].assetUrl} is missing.`;
		mediaMocks.inspectUserCompositionMedia.mockResolvedValue({
			status: 'missing',
			issues: [
				{
					assetIds: ['interview-asset'],
					assetUrl: media.assets[0].assetUrl,
					status: 'missing',
					message
				}
			]
		});
		fsMocks.readdir.mockResolvedValue(['missing-media.json']);
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-07-27T12:00:00.000Z' },
				preset
			})
		);

		const loaded = await slugHandlers.GET({
			params: { slug: 'missing-media' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		assert.deepEqual(await loaded.json(), presetToWireFormat(parsePresetIngress(preset)));

		const response = await collectionHandlers.GET(
			{} as Parameters<(typeof collectionHandlers)['GET']>[0]
		);
		const metadata = (await response.json()) as Array<Record<string, unknown>>;
		assert.equal(metadata[0]?.mediaStatus, 'missing');
		assert.deepEqual(metadata[0]?.media, media);
		assert.deepEqual(metadata[0]?.mediaIssues, [
			{
				assetIds: ['interview-asset'],
				assetUrl: media.assets[0].assetUrl,
				status: 'missing',
				message
			}
		]);

		await assert.rejects(
			async () =>
				slugHandlers.PUT({
					params: { slug: 'missing-media' },
					request: new Request('http://localhost/api/user-compositions/missing-media', {
						method: 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(preset)
					})
				} as Parameters<(typeof slugHandlers)['PUT']>[0]),
			expectHttpError(422, 'Referenced media asset')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'missing-media', preset, forkedFrom: 'blank' })),
			expectHttpError(422, 'Referenced media asset')
		);
	});
});

// The 2026-08-29 incident, as route behavior: a probe server inherited the
// primary checkout's cwd and its storage tests cleared the author's real store.
// Deleting now moves files aside, and a verification run is refused outright.
describe('user composition store safety', () => {
	function deleteEvent(slug: string): Parameters<(typeof slugHandlers)['DELETE']>[0] {
		return { params: { slug } } as Parameters<(typeof slugHandlers)['DELETE']>[0];
	}

	it('moves a deleted composition to trash instead of unlinking it', async () => {
		fsMocks.readdir.mockResolvedValue(['chapter-card.json']);

		const response = await slugHandlers.DELETE(deleteEvent('chapter-card'));

		assert.equal(response.status, 204);
		assert.equal(
			fsMocks.unlink.mock.calls.length,
			0,
			'unlink must not be a code path over user artifacts'
		);
		const trashMove = fsMocks.rename.mock.calls.at(-1);
		assert.match(trashMove?.[0] ?? '', /GFX\/compositions\/chapter-card\.json$/);
		assert.match(trashMove?.[1] ?? '', /GFX\/trash\/.+-chapter-card\.json$/);
		// Everything else in the store was copied aside first.
		assert.match(
			fsMocks.copyFile.mock.calls[0]?.[1] ?? '',
			/GFX\/backups\/.+-before-delete\/chapter-card\.json$/
		);
	});

	it('answers 404 for an absent slug without leaving a trash entry', async () => {
		fsMocks.rename.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		await assert.rejects(
			async () => slugHandlers.DELETE(deleteEvent('never-existed')),
			expectHttpError(404, 'not found')
		);
	});

	describe('under a verification run with no jailed store', () => {
		beforeEach(() => {
			vi.stubEnv('GFX_VERIFICATION_RUN', '1');
			vi.stubEnv('GFX_USER_COMPOSITION_STORE_DIRECTORY', '');
		});
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('cannot list the real store', async () => {
			await assert.rejects(
				async () => collectionHandlers.GET({} as Parameters<(typeof collectionHandlers)['GET']>[0]),
				expectHttpError(403, 'GFX_USER_COMPOSITION_STORE_DIRECTORY')
			);
			assert.equal(fsMocks.readdir.mock.calls.length, 0);
		});

		it('cannot modify the real store', async () => {
			await assert.rejects(
				async () =>
					collectionHandlers.POST(postEvent({ slug: 'probe-write', preset: validPreset })),
				expectHttpError(403, 'may never be served the real composition store')
			);
			await assert.rejects(
				async () =>
					slugHandlers.PUT({
						params: { slug: 'probe-write' },
						request: new Request('http://localhost/api/user-compositions/probe-write', {
							method: 'PUT',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify(validPreset)
						})
					} as Parameters<(typeof slugHandlers)['PUT']>[0]),
				expectHttpError(403, 'may never be served the real composition store')
			);
			assert.equal(fsMocks.writeFile.mock.calls.length, 0);
			assert.equal(fsMocks.rename.mock.calls.length, 0);
		});

		it('cannot clear the real store', async () => {
			await assert.rejects(
				async () => slugHandlers.DELETE(deleteEvent('chapter-card')),
				expectHttpError(403, 'GFX_USER_COMPOSITION_STORE_DIRECTORY')
			);
			assert.equal(fsMocks.rename.mock.calls.length, 0);
			assert.equal(fsMocks.unlink.mock.calls.length, 0);
		});
	});

	it('refuses to delete even inside its own jail', async () => {
		vi.stubEnv('GFX_VERIFICATION_RUN', '1');
		vi.stubEnv('GFX_USER_COMPOSITION_STORE_DIRECTORY', '/tmp/gfx-jail-7311/compositions');
		try {
			await assert.rejects(
				async () => slugHandlers.DELETE(deleteEvent('probe-piece')),
				expectHttpError(403, 'no delete authority')
			);
			assert.equal(fsMocks.rename.mock.calls.length, 0);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
