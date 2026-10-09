import assert from 'node:assert/strict';

import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';

import validPreset from '$lib/presets/blank.json';
import type { Preset } from '$lib/platform/engine-schema';
import {
	filmFromPreset,
	filmToWireFormat,
	parseFilm,
	parseFilmIngress
} from '$lib/platform/film-ingress';
import type { FilmSceneOrigin } from '$lib/platform/film-schema';
import { parsePresetIngress } from '$lib/platform/preset-ingress';
import {
	addUserCompositionFileToIndex,
	userCompositionFileExists
} from '$lib/platform/user-composition-file-index.server';
import { posterKeyForPreset } from '$lib/platform/posters';
import { presetToWireFormat } from '$lib/platform/preset-pure';
import transitionWipeDemoPreset from '$lib/presets/transition-wipe-demo.json';
import { filmDurationSeconds } from '$lib/platform/user-composition-record';
import { STORED_USER_COMPOSITION_RECORD_FIXTURES } from '$lib/platform/user-composition-record.fixture';

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

/** The Film wire document a Preset document is stored as (ADR-0068 §3). */
function filmWireOf(presetDocument: unknown, origin: FilmSceneOrigin | null = null): unknown {
	return JSON.parse(
		JSON.stringify(filmToWireFormat(filmFromPreset(parsePresetIngress(presetDocument), origin)))
	);
}

/** A stored Film has no `kind`, so its poster key is its Preset's as a deliverable. */
function storedPosterKeyOf(presetDocument: unknown): string {
	return posterKeyForPreset({ ...parsePresetIngress(presetDocument), kind: 'deliverable' });
}

function putEvent(slug: string, body: unknown): Parameters<(typeof slugHandlers)['PUT']>[0] {
	return {
		params: { slug },
		request: new Request(`http://localhost/api/user-compositions/${slug}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<(typeof slugHandlers)['PUT']>[0];
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
	it('rejects invalid slugs and invalid compositions', async () => {
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: '../escape', film: filmWireOf(validPreset) })),
			expectHttpError(400, 'slug must be lowercase')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'valid-slug', preset: { name: 'Incomplete' } })),
			expectHttpError(400, 'Invalid composition')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(
					postEvent({ slug: 'valid-slug', film: { schema: 'gfx-film@1', name: 'No Scenes' } })
				),
			expectHttpError(400, 'Invalid GFX film')
		);
		await assert.rejects(
			async () => collectionHandlers.POST(postEvent({ slug: 'valid-slug' })),
			expectHttpError(400, 'exactly one of `preset` and `film`')
		);
		assert.equal(fsMocks.writeFile.mock.calls.length, 0);
	});

	it('refuses to create or save a record under a corpus Preset slug', async () => {
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'blank', film: filmWireOf(validPreset) })),
			expectHttpError(409, '"blank" is the slug of a Starter')
		);
		await assert.rejects(
			async () => slugHandlers.PUT(putEvent('blank', filmWireOf(validPreset))),
			expectHttpError(409, '"blank" is the slug of a Starter')
		);
		assert.equal(fsMocks.writeFile.mock.calls.length, 0);
		assert.equal(fsMocks.rename.mock.calls.length, 0);
	});

	it('writes a Film record in wire format, with the Scene origin it was given', async () => {
		const origin = { slug: 'blank', contentKey: storedPosterKeyOf(validPreset) };
		const response = await collectionHandlers.POST(
			postEvent({ slug: 'blank-copy', film: filmWireOf(validPreset, origin) })
		);

		assert.equal(response.status, 201);
		assert.deepEqual(await response.json(), { slug: 'blank-copy' });
		assert.equal(fsMocks.writeFile.mock.calls.length, 1);

		const [path, data, encoding] = fsMocks.writeFile.mock.calls[0];
		const stored = JSON.parse(data) as {
			meta: { savedAt: string };
			film: {
				scenes: { origin: unknown; state: { surface: { content: { body: unknown } } } }[];
			};
		};
		assert.match(path, /GFX\/compositions\/\.[a-f0-9-]+\.tmp$/);
		assert.equal(fsMocks.rename.mock.calls[0]?.[0], path);
		assert.match(fsMocks.rename.mock.calls[0]?.[1] ?? '', /GFX\/compositions\/blank-copy\.json$/);
		assert.equal(encoding, 'utf-8');
		assert.deepEqual(Object.keys(stored), ['meta', 'film']);
		// A Film states its Scene's origin itself, so the record keeps no `forkedFrom`.
		assert.deepEqual(Object.keys(stored.meta), ['savedAt']);
		assert.equal(Number.isNaN(Date.parse(stored.meta.savedAt)), false);
		assert.deepEqual(stored.film.scenes[0].origin, origin);
		assert.equal(stored.film.scenes[0].state.surface.content.body, '');
	});

	it('lifts a legacy Preset body to a Film record on the way in', async () => {
		await collectionHandlers.POST(postEvent({ slug: 'from-preset', preset: validPreset }));

		const stored = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			film: unknown;
		};
		assert.deepEqual(Object.keys(stored), ['meta', 'film']);
		assert.deepEqual(stored.film, filmWireOf(validPreset));
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
				posterKey: storedPosterKeyOf(validPreset),
				durationSeconds: parsePresetIngress(validPreset).state.transport.durationSeconds,
				sceneCount: 1,
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
		// The legacy record's `forkedFrom` is the lifted Scene's origin.
		const expected = filmWireOf(validPreset, { slug: 'blank', contentKey: null });
		assert.deepEqual(await first.json(), expected);
		assert.deepEqual(await second.json(), expected);
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

	it('returns the standalone Film document accepted by PUT', async () => {
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: 'blank', savedAt: '2026-07-14T12:00:00.000Z' },
				preset: validPreset
			})
		);

		const getResponse = await slugHandlers.GET({
			params: { slug: 'round-trip' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		const standaloneFilm: unknown = await getResponse.json();

		assert.deepEqual(standaloneFilm, filmWireOf(validPreset, { slug: 'blank', contentKey: null }));
		assert.deepEqual(
			standaloneFilm,
			JSON.parse(JSON.stringify(filmToWireFormat(parseFilmIngress(standaloneFilm))))
		);
		const putResponse = await slugHandlers.PUT(putEvent('round-trip', standaloneFilm));

		assert.equal(putResponse.status, 204);
		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			meta: { forkedFrom: string | null };
			film: unknown;
		};
		assert.deepEqual(Object.keys(written), ['meta', 'film']);
		assert.equal(written.meta.forkedFrom, 'blank');
		assert.deepEqual(written.film, standaloneFilm);
	});

	it('still accepts a standalone Preset in PUT and stores it as a Film', async () => {
		fsMocks.readFile.mockRejectedValue(
			Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
		);

		const putResponse = await slugHandlers.PUT(putEvent('from-preset', validPreset));

		assert.equal(putResponse.status, 204);
		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			meta: object;
			film: unknown;
		};
		assert.deepEqual(Object.keys(written), ['meta', 'film']);
		assert.deepEqual(Object.keys(written.meta), ['savedAt']);
		assert.deepEqual(written.film, filmWireOf(validPreset));
	});

	it('preserves valid charts and rejects semantic chart errors at POST, GET, and PUT boundaries', async () => {
		const preset = chartPreset();
		const wire = presetToWireFormat(preset);
		const filmWire = filmWireOf(wire);
		const postResponse = await collectionHandlers.POST(
			postEvent({ slug: 'agent-chart', film: filmWire })
		);
		assert.equal(postResponse.status, 201);
		const stored = fsMocks.writeFile.mock.calls[0]?.[1];
		assert.ok(stored);
		fsMocks.readFile.mockResolvedValue(stored);

		const getResponse = await slugHandlers.GET({
			params: { slug: 'agent-chart' }
		} as Parameters<(typeof slugHandlers)['GET']>[0]);
		assert.deepEqual(await getResponse.json(), filmWire);
		const putResponse = await slugHandlers.PUT(putEvent('agent-chart', filmWire));
		assert.equal(putResponse.status, 204);

		const invalidWire = structuredClone(wire) as Preset;
		invalidWire.state.surface.chart!.items[0].domain = { min: 500, max: 800 };
		const invalidFilmWire = structuredClone(filmWire) as { scenes: { state: unknown }[] };
		invalidFilmWire.scenes[0].state = invalidWire.state;
		const unknownKeyWire = structuredClone(wire) as unknown as {
			state: { surface: { chart: { items: Array<Record<string, unknown>> } } };
		};
		unknownKeyWire.state.surface.chart.items[0]['literalColor'] = '#ff0000';
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'unknown-chart-key', preset: unknownKeyWire })),
			expectHttpError(400, 'Invalid composition')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'invalid-chart', film: invalidFilmWire })),
			expectHttpError(400, 'domains must include zero')
		);
		await assert.rejects(
			async () => slugHandlers.PUT(putEvent('agent-chart', invalidFilmWire)),
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
		const parsed = parseFilmIngress(await getResponse.json());
		parsed.name = 'Edited in GUI';

		await slugHandlers.PUT(putEvent('agent-composition', filmToWireFormat(parsed)));

		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			film: unknown;
		};
		const agentReloadedFilm = parseFilmIngress(written.film);
		assert.equal(agentReloadedFilm.name, 'Edited in GUI');
		assert.equal(agentReloadedFilm.scenes[0].state.transport.durationSeconds, 7.5);
		assert.deepEqual(agentReloadedFilm.scenes[0].state.stage, agentPreset.state.stage);
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
		const standaloneFilm = (await getResponse.json()) as { name: string };
		standaloneFilm.name = 'Edited by agent';
		await slugHandlers.PUT(putEvent('media-composition', standaloneFilm));
		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			film: { scenes: { state: Record<string, unknown> }[] };
		};
		assert.deepEqual(written.film.scenes[0].state.media, media);
		assert.equal(Object.hasOwn(written.film.scenes[0].state, 'sourceVideo'), false);

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
				posterKey: storedPosterKeyOf(preset),
				durationSeconds: parsePresetIngress(preset).state.transport.durationSeconds,
				sceneCount: 1,
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
		const canonical = (await loaded.json()) as { scenes: { state: Record<string, unknown> }[] };
		assert.equal(Object.hasOwn(canonical.scenes[0].state, 'sourceVideo'), false);
		assert.ok(canonical.scenes[0].state.media);

		await slugHandlers.PUT(putEvent('legacy-source', canonical));
		await collectionHandlers.POST(postEvent({ slug: 'legacy-copy', preset }));

		assert.equal(fsMocks.writeFile.mock.calls.length, 2);
		for (const call of fsMocks.writeFile.mock.calls) {
			const stored = JSON.parse(call[1]) as {
				film: { scenes: { state: Record<string, unknown> }[] };
			};
			const [scene] = stored.film.scenes;
			assert.equal(Object.hasOwn(scene.state, 'sourceVideo'), false);
			assert.equal(Object.hasOwn(scene.state, 'mediaStatus'), false);
			assert.equal(Object.hasOwn(scene.state, 'mediaIssues'), false);
			assert.ok(scene.state.media);
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
		assert.deepEqual(await loaded.json(), filmWireOf(preset));

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
			async () => slugHandlers.PUT(putEvent('missing-media', filmWireOf(preset))),
			expectHttpError(422, 'Referenced media asset')
		);
		await assert.rejects(
			async () =>
				collectionHandlers.POST(postEvent({ slug: 'missing-media', film: filmWireOf(preset) })),
			expectHttpError(422, 'Referenced media asset')
		);
	});
});

// ADR-0068 §3: the disk store reads the legacy `{ meta, preset }` record and the
// `{ meta, film }` record, hands every caller a Film, and writes Films.
describe('user composition handlers reading both stored record shapes', () => {
	function slugEvent(slug: string): Parameters<(typeof slugHandlers)['GET']>[0] {
		return { params: { slug } } as Parameters<(typeof slugHandlers)['GET']>[0];
	}

	afterEach(() => {
		vi.useRealTimers();
	});

	for (const fixture of STORED_USER_COMPOSITION_RECORD_FIXTURES) {
		const storedFile = JSON.stringify({ meta: fixture.meta, ...fixture.document });

		if (fixture.outcome === 'opens') {
			it(`opens and lists the ${fixture.slug} record as its Film`, async () => {
				const preset = parsePresetIngress(fixture.presetDocument);
				fsMocks.readFile.mockResolvedValue(storedFile);
				fsMocks.readdir.mockResolvedValue([`${fixture.slug}.json`]);

				const loaded = await slugHandlers.GET(slugEvent(fixture.slug));
				const listed = await collectionHandlers.GET(
					{} as Parameters<(typeof collectionHandlers)['GET']>[0]
				);

				assert.deepEqual(
					await loaded.json(),
					filmWireOf(fixture.presetDocument, fixture.firstSceneOrigin)
				);
				assert.deepEqual(await listed.json(), [
					{
						slug: fixture.slug,
						name: preset.name,
						// The first Scene's origin slug, which a legacy record states as `forkedFrom`.
						forkedFrom: fixture.firstSceneOrigin?.slug ?? null,
						savedAt: fixture.meta.savedAt,
						posterKey: posterKeyForPreset(preset),
						durationSeconds: filmDurationSeconds(filmFromPreset(preset, null)),
						sceneCount: 1,
						surfaceType: preset.state.surface.type,
						media: preset.state.media,
						mediaStatus: 'ready'
					}
				]);
			});
			continue;
		}

		if (fixture.outcome === 'opens-several-scenes') {
			it(`opens, lists, and saves the ${fixture.slug} record with every Scene`, async () => {
				const film = parseFilm((fixture.document as { film: unknown }).film);
				const filmWire = JSON.parse(JSON.stringify(filmToWireFormat(film))) as {
					scenes: unknown[];
				};
				const firstScenePreset = {
					...parsePresetIngress(fixture.presetDocument),
					kind: 'deliverable' as const
				};
				fsMocks.readFile.mockResolvedValue(storedFile);
				fsMocks.readdir.mockResolvedValue([`${fixture.slug}.json`]);

				const loaded = await slugHandlers.GET(slugEvent(fixture.slug));
				const listed = await collectionHandlers.GET(
					{} as Parameters<(typeof collectionHandlers)['GET']>[0]
				);

				assert.ok(filmWire.scenes.length > 1);
				assert.deepEqual(await loaded.json(), filmWire);
				assert.deepEqual(await listed.json(), [
					{
						slug: fixture.slug,
						name: film.name,
						forkedFrom: fixture.firstSceneOrigin?.slug ?? null,
						savedAt: fixture.meta.savedAt,
						// The card stands for the Scene the Film opens on.
						posterKey: posterKeyForPreset(firstScenePreset),
						durationSeconds: filmDurationSeconds(film),
						sceneCount: film.scenes.length,
						surfaceType: firstScenePreset.state.surface.type,
						media: firstScenePreset.state.media,
						mediaStatus: 'ready'
					}
				]);

				await slugHandlers.PUT(putEvent(fixture.slug, filmWire));

				const written = JSON.parse(fsMocks.writeFile.mock.calls.at(-1)?.[1] ?? 'null') as {
					film: unknown;
				};
				assert.deepEqual(written.film, filmWire);
			});
			continue;
		}

		it(`refuses the ${fixture.slug} record as a stored composition, not a server fault`, async () => {
			fsMocks.readFile.mockResolvedValue(storedFile);
			fsMocks.readdir.mockResolvedValue([`${fixture.slug}.json`]);

			await assert.rejects(
				async () => slugHandlers.GET(slugEvent(fixture.slug)),
				expectHttpError(409, `Stored composition "${fixture.slug}" is not one this engine accepts`)
			);
			const listed = await collectionHandlers.GET(
				{} as Parameters<(typeof collectionHandlers)['GET']>[0]
			);
			assert.deepEqual(await listed.json(), []);
		});
	}

	it('writes nothing when a legacy file is read, and a Film record the first time it is saved', async () => {
		const legacyFile = JSON.stringify({
			meta: { forkedFrom: 'lower-third', savedAt: '2026-10-01T12:00:00.000Z' },
			preset: mediaPreset()
		});
		fsMocks.readFile.mockResolvedValue(legacyFile);
		fsMocks.readdir.mockResolvedValue(['legacy.json']);

		const loaded = await slugHandlers.GET(slugEvent('legacy'));
		await collectionHandlers.GET({} as Parameters<(typeof collectionHandlers)['GET']>[0]);
		assert.equal(fsMocks.writeFile.mock.calls.length, 0);
		assert.equal(fsMocks.rename.mock.calls.length, 0);

		await slugHandlers.PUT(putEvent('legacy', await loaded.json()));

		assert.equal(fsMocks.writeFile.mock.calls.length, 1);
		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			meta: { forkedFrom: string | null; savedAt: string };
			film: { scenes: { origin: unknown }[] };
		};
		assert.deepEqual(Object.keys(written), ['meta', 'film']);
		assert.equal(written.meta.forkedFrom, 'lower-third');
		assert.notEqual(written.meta.savedAt, '2026-10-01T12:00:00.000Z');
		assert.deepEqual(
			written.film,
			filmWireOf(mediaPreset(), { slug: 'lower-third', contentKey: null })
		);
	});

	it('keeps a legacy transition record in the Preset shape when it is saved (ADR-0068 §3)', async () => {
		fsMocks.readFile.mockResolvedValue(
			JSON.stringify({
				meta: { forkedFrom: null, savedAt: '2026-10-01T12:00:00.000Z' },
				preset: transitionWipeDemoPreset
			})
		);

		const loaded = await slugHandlers.GET(slugEvent('my-transition'));
		const standalonePreset: unknown = await loaded.json();
		assert.deepEqual(
			parsePresetIngress(standalonePreset),
			parsePresetIngress(transitionWipeDemoPreset)
		);
		await slugHandlers.PUT(putEvent('my-transition', standalonePreset));

		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			preset: unknown;
		};
		assert.deepEqual(Object.keys(written), ['meta', 'preset']);
		assert.deepEqual(
			parsePresetIngress(written.preset),
			parsePresetIngress(transitionWipeDemoPreset)
		);
	});

	it('saves over a stored Film as a Film record, keeping its metadata and its Scene origin', async () => {
		const fixture = STORED_USER_COMPOSITION_RECORD_FIXTURES.find(
			(candidate) => candidate.slug === 'film-one-scene'
		);
		assert.ok(fixture);
		fsMocks.readFile.mockResolvedValue(JSON.stringify({ meta: fixture.meta, ...fixture.document }));

		const loaded = await slugHandlers.GET(slugEvent(fixture.slug));
		const standaloneFilm: unknown = await loaded.json();
		await slugHandlers.PUT(putEvent(fixture.slug, standaloneFilm));

		const written = JSON.parse(fsMocks.writeFile.mock.calls[0]?.[1] ?? 'null') as {
			meta: { forkedFrom: string | null };
			film: { scenes: { origin: unknown }[] };
		};
		assert.deepEqual(Object.keys(written), ['meta', 'film']);
		assert.equal(written.meta.forkedFrom, fixture.meta.forkedFrom);
		assert.deepEqual(written.film, standaloneFilm);
		assert.deepEqual(written.film.scenes[0].origin, fixture.firstSceneOrigin);
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
