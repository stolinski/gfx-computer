import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
	readWebmcpToolExposure,
	startWebmcpToolController,
	WebmcpToolController
} from './webmcp-tool-controller.ts';
import { userCompositionStore } from './user-composition-store';
import {
	WEBMCP_ALWAYS_REGISTERED_CEILING,
	WEBMCP_OPERATION_INVENTORY,
	WEBMCP_RESULT_CHARACTER_BUDGET
} from './webmcp-operation-inventory.ts';

import type {
	WebmcpExposureView,
	WebmcpModelContextHost,
	WebmcpToolCallResult,
	WebmcpToolDefinition,
	WebmcpToolDescriptor,
	WebmcpToolRegistrationOptions
} from './webmcp-tool-controller.ts';
import type { UserCompositionMeta } from './user-composition-store';
import type { WebmcpCompositionPreconditions } from './webmcp-tool-preconditions.ts';

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
 * A `document.modelContext` that honours the registration signal the way the
 * measured surface does, so the lifecycle assertions read `getTools()` — the
 * ADR-0054 §5 authority — rather than the controller's own bookkeeping.
 */
class FakeModelContext implements WebmcpModelContextHost {
	readonly #tools = new Map<string, WebmcpToolDescriptor>();
	readonly #registrationSignals = new Map<string, AbortSignal>();

	registerTool(descriptor: WebmcpToolDescriptor, options: WebmcpToolRegistrationOptions): void {
		this.#tools.set(descriptor.name, descriptor);
		this.#registrationSignals.set(descriptor.name, options.signal);
		options.signal.addEventListener(
			'abort',
			() => {
				this.#tools.delete(descriptor.name);
				this.#registrationSignals.delete(descriptor.name);
			},
			{ once: true }
		);
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

	describe(name: string): WebmcpToolDescriptor | undefined {
		return this.#tools.get(name);
	}

	registrationSignal(name: string): AbortSignal | undefined {
		return this.#registrationSignals.get(name);
	}
}

/**
 * A `document.modelContext` that still holds names a previous controller has not
 * finished releasing. Re-registering one rejects with `InvalidStateError`, the
 * teardown race a layout re-mount must report and retry.
 */
class ContendedModelContext implements WebmcpModelContextHost {
	readonly #heldNames: Set<string>;
	readonly #accepted = new Map<string, WebmcpToolDescriptor>();

	constructor(heldNames: readonly string[]) {
		this.#heldNames = new Set(heldNames);
	}

	/** The controller that held those names finished tearing down. */
	releaseHeldNames(): void {
		this.#heldNames.clear();
	}

	async registerTool(
		descriptor: WebmcpToolDescriptor,
		options: WebmcpToolRegistrationOptions
	): Promise<void> {
		if (this.#heldNames.has(descriptor.name)) {
			throw new DOMException('Duplicate tool name', 'InvalidStateError');
		}
		this.#accepted.set(descriptor.name, descriptor);
		options.signal.addEventListener('abort', () => this.#accepted.delete(descriptor.name), {
			once: true
		});
	}

	getTools(): Iterable<{ name: string }> {
		return [...this.#accepted.keys()].map((name) => ({ name }));
	}
}

/** Every `name` down an error's `cause` chain, nearest cause last. */
function causeChainNames(error: unknown): string[] {
	const names: string[] = [];
	for (let current: unknown = error; current instanceof Error; current = current.cause) {
		names.push(current.name);
	}
	return names;
}

const CLOSED_PAGE: WebmcpCompositionPreconditions = {
	always: true,
	'composition-open': false,
	'composition-editable': false,
	'forked-from-starter': false,
	'undo-available': false,
	'redo-available': false,
	'overlay-present': false,
	'effect-present': false,
	'mark-present': false,
	'text-animation-present': false,
	'diagram-present': false,
	'kinetic-word-addable': false,
	'kinetic-word-present': false,
	'chart-present': false,
	'captions-present': false,
	'chat-surface-active': false,
	'checklist-surface-active': false,
	'orientation-override-present': false,
	'keyframe-channel-present': false,
	'cascade-anchor-present': false,
	'transition-present': false,
	'audio-cue-present': false,
	'media-permitted': false,
	'media-entry-present': false,
	'video-clip-present': false
};

const OPEN_COMPOSITION: WebmcpCompositionPreconditions = {
	...CLOSED_PAGE,
	'composition-open': true,
	'composition-editable': true
};

const SESSION_ENTRY: UserCompositionMeta = {
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

function readPayload(result: WebmcpToolCallResult): Record<string, unknown> {
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function definition(
	operationId: string,
	run: WebmcpToolDefinition['run'] = async () => ({ status: 'applied', operationId })
): WebmcpToolDefinition {
	return {
		operationId,
		inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
		run
	};
}

function familyDefinition(): WebmcpToolDefinition {
	return definition('capability.prepare-authoring-family', async (args) => ({
		status: 'prepared',
		operationId: 'capability.prepare-authoring-family',
		family: Reflect.get(args as object, 'family')
	}));
}

function toolNameFor(operationId: string): string {
	const row = WEBMCP_OPERATION_INVENTORY.find((entry) => entry.id === operationId);
	if (!row) throw new Error(`The inventory declares no ${operationId}`);
	return row.toolName;
}

function exposedView(host: WebmcpModelContextHost): WebmcpExposureView {
	const view = {
		document: { modelContext: host },
		navigator: { userAgent: 'Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36' },
		isSecureContext: true,
		origin: 'https://gfx.computer',
		top: null as unknown,
		self: null as unknown
	};
	view.top = view;
	view.self = view;
	return view;
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
});

describe('WebMCP exposure', () => {
	it('stays inert with no modelContext, and says so without noise', () => {
		const view = exposedView(new FakeModelContext());
		view.document = {};
		expect(readWebmcpToolExposure(view)).toEqual({
			host: null,
			refusal: 'model-context-absent'
		});
	});

	it('refuses Chrome 152, an insecure context, a frame, and an opaque origin', () => {
		const host = new FakeModelContext();

		expect(
			readWebmcpToolExposure({
				...exposedView(host),
				navigator: { userAgent: 'Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36' }
			}).refusal
		).toBe('unsupported-browser-version');
		expect(readWebmcpToolExposure({ ...exposedView(host), isSecureContext: false }).refusal).toBe(
			'insecure-context'
		);
		expect(readWebmcpToolExposure({ ...exposedView(host), top: {} }).refusal).toBe(
			'framed-document'
		);
		expect(readWebmcpToolExposure({ ...exposedView(host), origin: 'null' }).refusal).toBe(
			'opaque-origin'
		);
	});

	it('starts no controller where it may not expose tools, and names the refusal instead', () => {
		const view = exposedView(new FakeModelContext());
		view.document = {};
		const start = startWebmcpToolController({
			view,
			definitions: [definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});
		expect(start).toEqual({ controller: null, refusal: 'model-context-absent' });
	});

	it('starts a controller with no refusal wherever the document exposes tools', () => {
		const start = startWebmcpToolController({
			view: exposedView(new FakeModelContext()),
			definitions: [definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});
		expect(start.controller).toBeInstanceOf(WebmcpToolController);
		expect(start.refusal).toBeNull();
	});
});

describe('WebMCP tool registration', () => {
	it('registers only the tools that can succeed on a cold page', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [
				definition('composition.create-blank'),
				definition('composition.inspect'),
				definition('layer.remove-overlay')
			],
			lifetime: new AbortController().signal
		});

		const summary = await controller.synchronize(CLOSED_PAGE, '/');
		expect(summary.registered).toEqual([toolNameFor('composition.create-blank')]);
		expect(summary.added).toEqual([toolNameFor('composition.create-blank')]);
	});

	it('adds and drops tools as the composition gains and loses an Overlay', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [
				definition('composition.inspect'),
				familyDefinition(),
				definition('layer.remove-overlay')
			],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(OPEN_COMPOSITION, '/p/lower-third');
		await host.call(toolNameFor('capability.prepare-authoring-family'), { family: 'layer' });
		expect([...host.getTools()].map((tool) => tool.name)).toEqual([
			toolNameFor('composition.inspect'),
			toolNameFor('capability.prepare-authoring-family')
		]);

		const withOverlay = await controller.synchronize(
			{ ...OPEN_COMPOSITION, 'overlay-present': true },
			'/p/lower-third'
		);
		expect(withOverlay.registered).toContain(toolNameFor('layer.remove-overlay'));

		const withoutOverlay = await controller.synchronize(OPEN_COMPOSITION, '/p/lower-third');
		expect(withoutOverlay.removed).toEqual([toolNameFor('layer.remove-overlay')]);
		expect(withoutOverlay.registered).not.toContain(toolNameFor('layer.remove-overlay'));

		const restored = await controller.synchronize(
			{ ...OPEN_COMPOSITION, 'overlay-present': true },
			'/p/lower-third'
		);
		expect(restored.added).toEqual([toolNameFor('layer.remove-overlay')]);
		expect(restored.registered).toContain(toolNameFor('layer.remove-overlay'));
	});

	it('registers a session tool only once the browser session holds a composition', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('session.delete-composition')],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(CLOSED_PAGE, '/');
		expect([...host.getTools()]).toEqual([]);

		sessionStore.listUserCompositions.mockResolvedValue([SESSION_ENTRY]);
		const summary = await controller.synchronize(CLOSED_PAGE, '/');
		expect(summary.registered).toEqual([toolNameFor('session.delete-composition')]);
	});

	it('keeps a registration the new route would ask for again across a route change', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(CLOSED_PAGE, '/');
		const descriptor = host.describe(toolNameFor('composition.create-blank'));
		const moved = await controller.synchronize(CLOSED_PAGE, '/p/lower-third');

		expect(moved.removed).toEqual([]);
		expect(moved.added).toEqual([]);
		expect(moved.registered).toEqual([toolNameFor('composition.create-blank')]);
		expect(moved.routeId).toBe('/p/lower-third');
		// The same registration remains active because its eligibility did not change.
		expect(descriptor).toBe(host.describe(toolNameFor('composition.create-blank')));
		expect(host.registrationSignal(toolNameFor('composition.create-blank'))?.aborted).toBe(false);
	});

	it('ends only the registrations the new route makes ineligible', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('composition.inspect'), definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(OPEN_COMPOSITION, '/p/lower-third');
		expect([...host.getTools()].map((tool) => tool.name)).toContain(
			toolNameFor('composition.inspect')
		);

		const closed = await controller.synchronize(CLOSED_PAGE, '/');

		expect(closed.removed).toEqual([toolNameFor('composition.inspect')]);
		expect(closed.registered).toEqual([toolNameFor('composition.create-blank')]);
	});

	it('unregisters everything when the page tears down', async () => {
		const host = new FakeModelContext();
		const lifetime = new AbortController();
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('composition.create-blank')],
			lifetime: lifetime.signal
		});

		await controller.synchronize(CLOSED_PAGE, '/');
		lifetime.abort();

		expect([...host.getTools()]).toEqual([]);
		expect(controller.registeredToolNames).toEqual([]);
	});

	it('reports a refused registration through synchronize rather than dropping the promise', async () => {
		const createBlank = toolNameFor('composition.create-blank');
		const host = new ContendedModelContext([createBlank]);
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});

		const refusal = await controller.synchronize(CLOSED_PAGE, '/').catch((error: unknown) => error);

		expect(refusal).toBeInstanceOf(Error);
		expect((refusal as Error).message).toContain(createBlank);
		expect(causeChainNames(refusal)).toContain('InvalidStateError');
		expect([...host.getTools()]).toEqual([]);
	});

	it('retries a refused registration once the contended name is released', async () => {
		const createBlank = toolNameFor('composition.create-blank');
		const host = new ContendedModelContext([createBlank]);
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(CLOSED_PAGE, '/').catch(() => undefined);
		expect(controller.registeredToolNames).toEqual([]);

		host.releaseHeldNames();
		const summary = await controller.synchronize(CLOSED_PAGE, '/');

		expect(summary.added).toEqual([createBlank]);
		expect(summary.registered).toEqual([createBlank]);
	});

	it('refuses a definition for an internal-only row outright', () => {
		const internalRows = WEBMCP_OPERATION_INVENTORY.filter(
			(row) => row.exposure === 'internal-only'
		);
		expect(internalRows.length).toBeGreaterThan(0);

		for (const row of internalRows) {
			expect(
				() =>
					new WebmcpToolController({
						host: new FakeModelContext(),
						definitions: [definition(row.id)],
						lifetime: new AbortController().signal
					}),
				`${row.id} must have no WebMCP tool`
			).toThrow(/internal-only/);
		}
	});

	it('rejects a definition that names no inventory row', () => {
		expect(
			() =>
				new WebmcpToolController({
					host: new FakeModelContext(),
					definitions: [definition('composition.set-everything')],
					lifetime: new AbortController().signal
				})
		).toThrow(/composition.set-everything/);
	});

	it('keeps a cold page inside the ceiling with every exposable row defined', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: WEBMCP_OPERATION_INVENTORY.filter((row) => row.exposure !== 'internal-only').map(
				(row) => definition(row.id)
			),
			lifetime: new AbortController().signal
		});

		const summary = await controller.synchronize(CLOSED_PAGE, '/');
		expect(summary.registered.length).toBeLessThanOrEqual(WEBMCP_ALWAYS_REGISTERED_CEILING);
		expect(summary.registered).toContain(toolNameFor('composition.create-blank'));
	});

	it('names the tool and its description from the inventory row, never the definition', async () => {
		const host = new FakeModelContext();
		const row = WEBMCP_OPERATION_INVENTORY.find((entry) => entry.id === 'composition.create-blank');
		const controller = new WebmcpToolController({
			host,
			definitions: [definition('composition.create-blank')],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(CLOSED_PAGE, '/');
		const descriptor = host.describe(row?.toolName ?? '');
		expect(descriptor?.description).toBe(row?.summary);
		expect(descriptor?.annotations).toEqual({
			readOnlyHint: false,
			untrustedContentHint: true
		});
	});
});

describe('WebMCP tool calls', () => {
	it('returns the operation receipt as the tool result', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [
				definition('composition.create-blank', async () => ({
					status: 'applied',
					slug: 'untitled',
					revision: 0
				}))
			],
			lifetime: new AbortController().signal
		});
		await controller.synchronize(CLOSED_PAGE, '/');

		const result = await host.call(toolNameFor('composition.create-blank'), {});
		expect(result.isError).toBe(false);
		expect(readPayload(result)).toMatchObject({ status: 'applied', slug: 'untitled' });
	});

	it('marks a refusal as an error without rewriting it', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [
				definition('composition.create-blank', async () => ({
					status: 'failed',
					code: 'storage_unavailable',
					message: 'This browser session could not reach its composition store.'
				}))
			],
			lifetime: new AbortController().signal
		});
		await controller.synchronize(CLOSED_PAGE, '/');

		const result = await host.call(toolNameFor('composition.create-blank'), {});
		expect(result.isError).toBe(true);
		expect(readPayload(result).code).toBe('storage_unavailable');
	});

	it('passes Chrome execution cancellation into long-running work', async () => {
		const host = new FakeModelContext();
		const operationSignals: AbortSignal[] = [];
		const controller = new WebmcpToolController({
			host,
			definitions: [
				familyDefinition(),
				definition('media.add-library-entry', (_args, signal) => {
					operationSignals.push(signal);
					return new Promise<unknown>(() => {});
				})
			],
			lifetime: new AbortController().signal
		});

		await controller.synchronize(
			{ ...OPEN_COMPOSITION, 'media-permitted': true },
			'/p/lower-third'
		);
		await host.call(toolNameFor('capability.prepare-authoring-family'), { family: 'media' });
		const execution = new AbortController();
		const call = host.call(toolNameFor('media.add-library-entry'), {}, execution.signal);
		execution.abort();

		expect(readPayload(await call)).toMatchObject({ status: 'cancelled', code: 'cancelled' });
		expect(operationSignals[0]?.aborted).toBe(true);
	});

	it('fails a result that overruns its budget rather than truncating it', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [
				definition('composition.inspect', async () => ({
					status: 'applied',
					overlays: 'x'.repeat(WEBMCP_RESULT_CHARACTER_BUDGET)
				}))
			],
			lifetime: new AbortController().signal
		});
		await controller.synchronize(OPEN_COMPOSITION, '/p/lower-third');

		const result = await host.call(toolNameFor('composition.inspect'), {});
		expect(result.isError).toBe(true);
		expect(readPayload(result)).toMatchObject({
			code: 'limit_exceeded',
			alternatives: [String(WEBMCP_RESULT_CHARACTER_BUDGET)]
		});
	});

	it('lets the whole-document read past the default budget', async () => {
		const host = new FakeModelContext();
		const controller = new WebmcpToolController({
			host,
			definitions: [
				definition('composition.export-json', async () => ({
					status: 'applied',
					document: 'x'.repeat(WEBMCP_RESULT_CHARACTER_BUDGET)
				}))
			],
			lifetime: new AbortController().signal
		});
		await controller.synchronize(OPEN_COMPOSITION, '/p/lower-third');

		const result = await host.call(toolNameFor('composition.export-json'), {});
		expect(result.isError).toBe(false);
	});
});
