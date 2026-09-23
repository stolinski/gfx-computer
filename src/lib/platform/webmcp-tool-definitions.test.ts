import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The origin's User Pack store, empty: pack tools stay absent until a pack exists.
vi.mock('./user-pack-store', async (importOriginal) => ({
	...(await importOriginal<typeof import('./user-pack-store')>()),
	userPackStore: {
		listUserPacks: vi.fn(async () => []),
		loadUserPack: vi.fn(async () => null),
		forkUserPack: vi.fn(async () => {
			throw new Error('not under test');
		}),
		saveUserPack: vi.fn(async () => {
			throw new Error('not under test');
		}),
		deleteUserPack: vi.fn(async () => {
			throw new Error('not under test');
		})
	}
}));

import blankPresetJson from '$lib/presets/blank.json';

import { applyPreset } from './preset';
import { buildCompositionExportPlan } from './composition-export-controller';
import { COMPOSITION_ORIENTATIONS } from './composition-transport-operations';
import { compositionEditHistory } from './composition-edit-history';
import { compositionExportHandle } from './composition-export-handle.svelte';
import { compositionMediaGrants } from './composition-media-grants.svelte';
import { compositionMeta } from './composition-meta.svelte';
import { engineState, transitionState } from './engine-state.svelte';
import { listWebmcpToolDefinitions } from './webmcp-tool-definitions';
import { parsePresetIngress } from './preset-ingress';
import { readWebmcpCompositionPreconditions } from './webmcp-tool-preconditions';
import { Timeline } from './timeline.svelte';
import { timelineHandle } from './timeline-handle.svelte';
import { userCompositionStore } from './user-composition-store';
import {
	WEBMCP_ALWAYS_REGISTERED_CEILING,
	WEBMCP_OPERATION_INVENTORY
} from './webmcp-operation-inventory';
import { WebmcpToolController } from './webmcp-tool-controller';

import type { UserCompositionMeta } from './user-composition-store';
import type { UserVideoAssetDescriptor } from './user-video-asset';
import type {
	WebmcpModelContextHost,
	WebmcpToolCallResult,
	WebmcpToolDescriptor,
	WebmcpToolRegistrationOptions
} from './webmcp-tool-controller';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

vi.mock('./user-composition-store', () => ({
	userCompositionStore: {
		listUserCompositions: vi.fn(),
		loadUserComposition: vi.fn(),
		forkUserComposition: vi.fn(),
		saveUserComposition: vi.fn(),
		deleteUserComposition: vi.fn()
	}
}));

const sessionStore = vi.mocked(userCompositionStore);

/**
 * Every module that turns an agent's call into an operation call. None of them
 * may reach past the operation layer into engine state.
 */
const WEBMCP_FAMILY_TOOL_MODULES = [
	'src/lib/platform/webmcp-appearance-tools.ts',
	'src/lib/platform/webmcp-capability-tools.ts',
	'src/lib/platform/webmcp-composition-tools.ts',
	'src/lib/platform/webmcp-content-tools.ts',
	'src/lib/platform/webmcp-delivery-tools.ts',
	'src/lib/platform/webmcp-layer-tools.ts',
	'src/lib/platform/webmcp-media-tools.ts',
	'src/lib/platform/webmcp-motion-tools.ts',
	'src/lib/platform/webmcp-placement-tools.ts',
	'src/lib/platform/webmcp-playhead-tools.ts',
	'src/lib/platform/webmcp-session-tools.ts',
	'src/lib/platform/webmcp-sound-tools.ts',
	'src/lib/platform/webmcp-transport-tools.ts',
	'src/lib/platform/webmcp-validation-tools.ts'
];

/** What a tool module reaching past the operation layer would have to name. */
const FORBIDDEN_TOOL_LAYER_REACHES = [
	'engine-state.svelte',
	'preset-base.svelte',
	'composition-workspace-focus',
	'runCompositionEditTransaction'
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

class FakeModelContext implements WebmcpModelContextHost {
	readonly #tools = new Map<string, WebmcpToolDescriptor>();

	registerTool(descriptor: WebmcpToolDescriptor, options: WebmcpToolRegistrationOptions): void {
		this.#tools.set(descriptor.name, descriptor);
		options.signal.addEventListener('abort', () => this.#tools.delete(descriptor.name), {
			once: true
		});
	}

	getTools(): Iterable<{ name: string }> {
		return [...this.#tools.values()].map((descriptor) => ({ name: descriptor.name }));
	}

	call(
		name: string,
		args: unknown,
		executionSignal: AbortSignal = new AbortController().signal
	): Promise<WebmcpToolCallResult> {
		const descriptor = this.#tools.get(name);
		if (!descriptor) throw new Error(`No registered tool named ${name}`);
		return descriptor.execute(args, { signal: executionSignal });
	}
}

function rowFor(operationId: string): WebmcpOperationRow {
	const row = WEBMCP_OPERATION_INVENTORY.find((entry) => entry.id === operationId);
	if (!row) throw new Error(`The inventory declares no ${operationId}`);
	return row;
}

function exposedRows(): readonly WebmcpOperationRow[] {
	return listWebmcpToolDefinitions().map((definition) => rowFor(definition.operationId));
}

function toolNamesRegisteredFor(precondition: WebmcpOperationRow['precondition']): string[] {
	return exposedRows()
		.filter((row) => row.precondition === precondition)
		.map((row) => row.toolName)
		.sort();
}

function startController(host: WebmcpModelContextHost): WebmcpToolController {
	return new WebmcpToolController({
		host,
		definitions: listWebmcpToolDefinitions(),
		lifetime: new AbortController().signal
	});
}

async function prepareAuthoringFamily(
	host: FakeModelContext,
	family: WebmcpOperationRow['family']
): Promise<void> {
	const result = await host.call(rowFor('capability.prepare-authoring-family').toolName, {
		family
	});
	expect(result.isError).toBe(false);
}

function readPayload(result: WebmcpToolCallResult): Record<string, unknown> {
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const sessionEntry: UserCompositionMeta = {
	slug: 'untitled',
	name: 'Untitled',
	forkedFrom: null,
	savedAt: '2026-08-29T12:00:00.000Z',
	posterKey: null,
	durationSeconds: 6,
	surfaceType: 'plain',
	media: { assets: [], videoTrack: { clips: [] } },
	mediaStatus: 'ready'
};

/** A video the visitor dropped on the Media rail themselves, stored by content address. */
const grantedVideo: UserVideoAssetDescriptor = {
	url: '/api/user-assets/0123456789abcdef.mp4',
	mime: 'video/mp4',
	sizeBytes: 4096,
	durationSeconds: 4,
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	averageFrameRate: 30,
	videoCodec: 'avc1',
	hasAudio: false
};

/** Opens a composition an agent may edit, the state most of these tools need. */
function openEditableComposition(): void {
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.isUserComposition = true;
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = false;
	compositionMeta.userCompositionSlug = null;
	compositionMeta.forkedFrom = null;
	compositionMediaGrants.clear();
});

afterEach(() => {
	timelineHandle.current?.dispose();
	timelineHandle.current = null;
	compositionExportHandle.current = null;
});

describe('WebMCP tool definitions', () => {
	// The parity gate includes shared authoring tools and the one transport-only
	// context tool. Only internal verification stays unregistered.
	it('exposes every agent-reachable row exactly once, and nothing else', () => {
		const exposedIds = listWebmcpToolDefinitions().map((definition) => definition.operationId);
		expect(new Set(exposedIds).size, 'a row is exposed twice').toBe(exposedIds.length);

		const declared = WEBMCP_OPERATION_INVENTORY.filter(
			(row) => row.exposure !== 'internal-only'
		).map((row) => row.id);
		expect(exposedIds.slice().sort()).toEqual(declared.slice().sort());
	});

	it('registers no operation the inventory keeps internal', () => {
		for (const row of exposedRows()) {
			expect(row.exposure, `${row.id} is registered but marked internal-only`).not.toBe(
				'internal-only'
			);
		}
	});

	it('gives every tool a closed schema whose required arguments it declares', () => {
		for (const definition of listWebmcpToolDefinitions()) {
			const schema = definition.inputSchema;
			expect(schema.additionalProperties, `${definition.operationId} accepts stray arguments`).toBe(
				false
			);
			for (const name of schema.required) {
				expect(
					Object.hasOwn(schema.properties, name),
					`${definition.operationId} requires an undeclared "${name}"`
				).toBe(true);
			}
		}
	});

	it('asks for the observed revision exactly when the row requires one', () => {
		for (const definition of listWebmcpToolDefinitions()) {
			const row = rowFor(definition.operationId);
			const asks = Object.hasOwn(definition.inputSchema.properties, 'expectedRevision');
			expect(asks, `${row.id} disagrees with its revision requirement`).toBe(
				row.requiresExpectedRevision
			);
			if (asks) {
				expect(definition.inputSchema.required).toContain('expectedRevision');
			}
		}
	});

	it('never reaches past the operation layer into engine state', () => {
		for (const modulePath of WEBMCP_FAMILY_TOOL_MODULES) {
			const source = readFileSync(resolve(repoRoot, modulePath), 'utf8');
			for (const reach of FORBIDDEN_TOOL_LAYER_REACHES) {
				expect(source.includes(reach), `${modulePath} reaches for ${reach}`).toBe(false);
			}
		}
	});
});

describe('WebMCP state-aware discovery', () => {
	it('offers a landing visitor discovery and the ways to start, and nothing else', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);

		const summary = await controller.synchronize(readWebmcpCompositionPreconditions(), '/');

		expect(summary.registered.slice().sort()).toEqual(toolNamesRegisteredFor('always'));
	});

	it('adds the session catalog once the session holds work, still inside the ceiling', async () => {
		sessionStore.listUserCompositions.mockResolvedValue([sessionEntry]);
		const host = new FakeModelContext();
		const controller = startController(host);

		const summary = await controller.synchronize(readWebmcpCompositionPreconditions(), '/');

		expect(summary.registered.slice().sort()).toEqual(
			[
				...toolNamesRegisteredFor('always'),
				...toolNamesRegisteredFor('session-composition-present')
			].sort()
		);
		expect(summary.registered.length).toBeLessThanOrEqual(WEBMCP_ALWAYS_REGISTERED_CEILING);
	});

	it('offers Kinetic Word creation only where the current Surface can accept it', async () => {
		openEditableComposition();
		expect(readWebmcpCompositionPreconditions()['kinetic-word-addable']).toBe(true);

		engineState.surface.type = 'paper';
		expect(readWebmcpCompositionPreconditions()['kinetic-word-addable']).toBe(false);
	});

	it('hides the shared history until there is an edit to replay', async () => {
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.isUserComposition = true;
		const host = new FakeModelContext();
		const controller = startController(host);
		const open = readWebmcpCompositionPreconditions();

		const withoutHistory = await controller.synchronize(open, '/p/untitled');
		expect(withoutHistory.registered).not.toContain(rowFor('composition.undo').toolName);

		const withHistory = await controller.synchronize(
			{ ...open, 'undo-available': true },
			'/p/untitled'
		);
		expect(withHistory.added).toEqual([rowFor('composition.undo').toolName]);
	});
});

describe('WebMCP tool calls', () => {
	it('answers a cold-page vocabulary call from the live registry', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/');

		const result = await host.call(rowFor('capability.inspect-vocabulary').toolName, {
			section: 'delivery-orientation'
		});

		expect(result.isError).toBe(false);
		expect(readPayload(result)).toMatchObject({
			status: 'inspected',
			section: 'delivery-orientation',
			members: COMPOSITION_ORIENTATIONS
		});
	});

	it('applies a real edit and returns the receipt the caller continues from', async () => {
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.isUserComposition = true;
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'transport');

		const result = await host.call(rowFor('transport.set-orientation').toolName, {
			expectedRevision: compositionEditHistory.revision,
			orientation: 'vertical'
		});

		expect(result.isError).toBe(false);
		expect(readPayload(result)).toMatchObject({
			status: 'applied',
			operationId: 'transport.set-orientation',
			revision: compositionEditHistory.revision,
			focus: { target: 'composition-root' }
		});
		expect(engineState.transport.orientation).toBe('vertical');
	});

	it('builds, writes, and places an Overlay without touching the interface', async () => {
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.isUserComposition = true;
		const host = new FakeModelContext();
		const controller = startController(host);
		const route = '/p/untitled';
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'layer');

		const added = readPayload(
			await host.call(rowFor('layer.add-overlay').toolName, {
				expectedRevision: compositionEditHistory.revision,
				overlayType: 'lower-third'
			})
		);
		expect(added).toMatchObject({ status: 'applied', focus: { target: 'overlay' } });

		// The family selector keeps unrelated Overlay tools out of context until the
		// agent asks for the decision family it needs next.
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'content');
		expect([...host.getTools()].map((tool) => tool.name)).toContain(
			rowFor('content.set-overlay-content').toolName
		);
		expect([...host.getTools()].map((tool) => tool.name)).not.toContain(
			rowFor('placement.set-overlay-placement').toolName
		);

		const overlayId = engineState.overlays[0].id;
		const written = readPayload(
			await host.call(rowFor('content.set-overlay-content').toolName, {
				expectedRevision: compositionEditHistory.revision,
				overlayId,
				content: { title: 'Syntax', subtitle: 'Web development podcast' }
			})
		);
		expect(written).toMatchObject({ status: 'applied' });

		await prepareAuthoringFamily(host, 'placement');
		const placed = readPayload(
			await host.call(rowFor('placement.set-overlay-placement').toolName, {
				expectedRevision: compositionEditHistory.revision,
				overlayId,
				target: 'vertical',
				placement: { anchor: 'bottom-center', offset: { x: 0.06, y: 0.12 }, scale: 1.2 }
			})
		);

		expect(placed).toMatchObject({ status: 'applied', focus: { target: 'overlay', overlayId } });
		expect(engineState.overlays[0].position.orientationOverrides?.vertical).toEqual({
			anchor: 'bottom-center',
			offset: { x: 0.06, y: 0.12 },
			scale: 1.2
		});
	});

	it('retimes an element and welds its entrance to another', async () => {
		openEditableComposition();
		const host = new FakeModelContext();
		const controller = startController(host);
		const route = '/p/untitled';
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'layer');

		await host.call(rowFor('layer.add-overlay').toolName, {
			expectedRevision: compositionEditHistory.revision,
			overlayType: 'lower-third'
		});
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'motion');
		const overlayId = engineState.overlays[0].id;

		const retimed = readPayload(
			await host.call(rowFor('motion.set-overlay-timing').toolName, {
				expectedRevision: compositionEditHistory.revision,
				overlayId,
				enter: { start: { seconds: 0.6 }, duration: { milliseconds: 1200 }, ease: 'settled' }
			})
		);
		expect(retimed).toMatchObject({ status: 'applied', focus: { target: 'overlay', overlayId } });
		expect(engineState.overlays[0].enter?.start).toBeCloseTo(0.1);
		expect(engineState.overlays[0].enter?.duration).toBeCloseTo(0.2);

		const welded = readPayload(
			await host.call(rowFor('motion.set-cascade-anchor').toolName, {
				expectedRevision: compositionEditHistory.revision,
				subject: { kind: 'overlay', overlayId },
				anchor: { kind: 'surface' },
				event: 'end',
				offsetMs: 120
			})
		);

		expect(welded).toMatchObject({ status: 'applied', focus: { target: 'overlay', overlayId } });
		expect(engineState.overlays[0].animation?.cascade).toEqual({
			anchor: 'surface',
			event: 'end',
			offsetMs: 120
		});
	});

	it('writes what a motion plays onto the motion itself', async () => {
		openEditableComposition();
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'motion');

		await host.call(rowFor('motion.set-surface-timing').toolName, {
			expectedRevision: compositionEditHistory.revision,
			enter: { start: 0, duration: 0.25, ease: 'smooth' }
		});

		await prepareAuthoringFamily(host, 'sound');
		const overridden = readPayload(
			await host.call(rowFor('sound.set-motion-override').toolName, {
				expectedRevision: compositionEditHistory.revision,
				motion: { kind: 'surface', phase: 'enter' },
				override: { event: 'impact' }
			})
		);

		expect(overridden).toMatchObject({ status: 'applied', focus: { target: 'sound-cue' } });
		// The override rides the window rather than a stored copy of its timing, so
		// the cue stays on this motion's frame through every later retime.
		expect(engineState.surface.enter?.sound).toMatchObject({ event: 'impact' });
	});

	it('parks the visible playhead on an exact frame without moving the composition', async () => {
		openEditableComposition();
		timelineHandle.current = new Timeline({ durationSeconds: 6, fps: 30, tick: () => {} });
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		const revision = compositionEditHistory.revision;

		const moved = readPayload(
			await host.call(rowFor('playhead.seek-frame').toolName, {
				frame: { timecode: '00:00:03:00' }
			})
		);

		expect(moved).toMatchObject({
			status: 'moved',
			frame: 90,
			timecode: '00:00:03:00',
			focus: 'timeline-playhead'
		});
		expect(compositionEditHistory.revision).toBe(revision);
	});

	it('art-directs the piece through the appearance family', async () => {
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.isUserComposition = true;
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'appearance');

		const result = await host.call(rowFor('appearance.set-typography').toolName, {
			expectedRevision: compositionEditHistory.revision,
			fontFamily: 'serif',
			paperColor: null
		});

		expect(readPayload(result)).toMatchObject({
			status: 'applied',
			operationId: 'appearance.set-typography',
			focus: { target: 'surface' }
		});
		expect(engineState.typography.fontFamily).toBe('serif');
		expect(engineState.typography.paperColor).toBeUndefined();
	});
});

describe('WebMCP validation and delivery', () => {
	beforeEach(openEditableComposition);

	it('reports what to repair, and says the messages are the visitor’s own words', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'validation');

		const result = await host.call(rowFor('validation.inspect-findings').toolName, {});

		expect(result.isError).toBe(false);
		expect(readPayload(result)).toMatchObject({
			status: 'inspected',
			schema: { findings: [], total: 0, truncated: false },
			semantic: { findings: [], total: 0, truncated: false },
			loadable: true,
			contentTrust: 'untrusted'
		});
	});

	it('hands back the delivered file without any interface action', async () => {
		compositionExportHandle.current = () =>
			Promise.resolve({
				status: 'delivered',
				plan: buildCompositionExportPlan({ state: engineState, transition: null }),
				videoByteLength: 4096,
				wavFilename: null
			});
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'delivery');

		const result = await host.call(rowFor('delivery.export-video').toolName, {
			expectedRevision: compositionEditHistory.revision
		});

		expect(result.isError).toBe(false);
		expect(readPayload(result)).toMatchObject({
			status: 'delivered',
			output: 'transparent',
			videoFilename: 'gfx-overlay.webm',
			width: 3840,
			height: 2160
		});
	});

	it('passes the caller’s cancellation to the export and reports no file', async () => {
		let exportSignal: AbortSignal | undefined;
		compositionExportHandle.current = ({ signal }) => {
			exportSignal = signal;
			return Promise.resolve({ status: 'cancelled' });
		};
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'delivery');

		const result = await host.call(rowFor('delivery.export-video').toolName, {
			expectedRevision: compositionEditHistory.revision
		});

		expect(exportSignal).toBeInstanceOf(AbortSignal);
		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			status: 'failed',
			code: 'cancelled',
			operationId: 'delivery.export-video'
		});
	});
});

describe('WebMCP media consent', () => {
	it('offers no way to add media until the visitor has granted some', async () => {
		openEditableComposition();
		const host = new FakeModelContext();
		const controller = startController(host);
		const route = '/p/untitled';

		const withoutGrant = await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'media');
		expect(withoutGrant.registered).not.toContain(rowFor('media.add-library-entry').toolName);

		// The gesture only a person can make: a file dropped on the Media rail.
		compositionMediaGrants.record('drop.mp4', grantedVideo);

		const withGrant = await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		expect(withGrant.added).toContain(rowFor('media.add-library-entry').toolName);
	});

	it('refuses a grant this page was never given, naming the ones it holds', async () => {
		openEditableComposition();
		compositionMediaGrants.record('drop.mp4', grantedVideo);
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'media');

		const result = await host.call(rowFor('media.add-library-entry').toolName, {
			expectedRevision: compositionEditHistory.revision,
			grantId: 'grant-somebody-elses'
		});

		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			code: 'unknown_target',
			rejected: 'grant-somebody-elses',
			alternatives: [compositionMediaGrants.grants[0].grantId]
		});
		expect(engineState.media.assets).toEqual([]);
	});
});

describe('WebMCP tool arguments', () => {
	beforeEach(() => {
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.isUserComposition = true;
	});

	it('applies nothing when an edit is written against a revision that has moved', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'motion');
		const observed = compositionEditHistory.revision;

		await host.call(rowFor('motion.set-surface-timing').toolName, {
			expectedRevision: observed,
			enter: { start: 0, duration: 0.2, ease: 'smooth' }
		});
		const result = await host.call(rowFor('motion.set-surface-timing').toolName, {
			expectedRevision: observed,
			enter: { start: 0.5, duration: 0.2, ease: 'smooth' }
		});

		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({ code: 'stale_revision' });
		expect(engineState.surface.enter).toMatchObject({ start: 0 });
	});

	it('names the variants an unsupported one should have been', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'transport');

		const result = await host.call(rowFor('transport.set-orientation').toolName, {
			expectedRevision: 0,
			orientation: 'diagonal'
		});

		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			code: 'unsupported_variant',
			rejected: 'diagonal',
			alternatives: COMPOSITION_ORIENTATIONS
		});
	});

	it('answers a call that sent no argument object at all', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'transport');

		const result = await host.call(rowFor('transport.set-orientation').toolName, 'horizontal');

		expect(result.isError).toBe(true);
		expect(readPayload(result).code).toBe('invalid_argument');
	});

	it('names the ids the composition holds when a target is not one of them', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		const route = '/p/untitled';
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'layer');
		await host.call(rowFor('layer.add-overlay').toolName, {
			expectedRevision: compositionEditHistory.revision,
			overlayType: 'lower-third'
		});
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);

		const result = await host.call(rowFor('layer.remove-overlay').toolName, {
			expectedRevision: compositionEditHistory.revision,
			overlayId: 'lower-third-9'
		});

		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			code: 'unknown_target',
			rejected: 'lower-third-9',
			alternatives: [engineState.overlays[0].id]
		});
	});

	it('sends a caller writing geometry as content to the tool that owns it', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		const route = '/p/untitled';
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'layer');
		await host.call(rowFor('layer.add-diagram-primitive').toolName, {
			expectedRevision: compositionEditHistory.revision,
			primitiveType: 'node'
		});
		await controller.synchronize(readWebmcpCompositionPreconditions(), route);
		await prepareAuthoringFamily(host, 'content');

		const result = await host.call(rowFor('content.set-diagram-primitive').toolName, {
			expectedRevision: compositionEditHistory.revision,
			blockId: engineState.surface.diagram?.[0].id,
			content: { position: { x: 0.2, y: 0.2 } }
		});

		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			code: 'invalid_argument',
			rejected: 'position',
			message: expect.stringContaining(rowFor('placement.set-diagram-geometry').toolName)
		});
	});

	it('names the Surface content slots when an undeclared one is written', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');
		await prepareAuthoringFamily(host, 'content');

		const result = await host.call(rowFor('content.set-surface-content').toolName, {
			expectedRevision: compositionEditHistory.revision,
			slots: { headline: 'Not a slot' }
		});

		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			code: 'invalid_argument',
			rejected: 'headline'
		});
	});

	it('refuses a JSON import body that is not JSON, without importing anything', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		await controller.synchronize(readWebmcpCompositionPreconditions(), '/p/untitled');

		const result = await host.call(rowFor('composition.import-json').toolName, {
			document: 'not a composition'
		});

		expect(readPayload(result)).toMatchObject({ code: 'invalid_argument' });
		expect(sessionStore.forkUserComposition).not.toHaveBeenCalled();
	});
});
