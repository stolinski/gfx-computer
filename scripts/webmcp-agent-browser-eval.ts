// Drive the real WebMCP transport in a real browser and prove an agent gets the
// surface ADR-0054 promises: a short cold-page menu of tools that all exist in
// the operation inventory, a vocabulary read that comes from the live registries,
// state-aware growth as a composition is created, Chrome 153 family disclosure
// with reversible registration, corrective stale-revision refusals, annotation
// hints plus untrusted result labeling, and no internal verification tool.
//
// This is a deterministic script on the sanctioned CDP harness — one invocation,
// no interactive tooling. It needs Chrome 153 or newer and a server already
// answering for this build, then starts (or reuses) two sanctioned browsers: the
// combined `agent` mode (CanvasDrawElement + WebMCP) for the authoring walk,
// because those operations render, and the `standard-webmcp` mode (WebMCP alone,
// CDP 9225) to prove the same tools register for a browser the CanvasDrawElement
// gate keeps out of the Workspace — the headless agent case:
//
//   pnpm eval:webmcp                                   # the dev server on :7263
//   GFX_EVAL_ORIGIN=http://localhost:7266 pnpm eval:webmcp   # any other build
//
// The origin matters: this eval asserts against the inventory in *this* working
// tree, so pointing it at a server running older code reports that difference as
// a failure, which is the intent.
//
// Writes docs/browser-probes/webmcp-agent-eval.json and exits non-zero on the
// first contract the live page misses.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { format, resolveConfig } from 'prettier';

import {
	readWebmcpOperationAnnotations,
	WEBMCP_ALWAYS_REGISTERED_CEILING,
	WEBMCP_CORE_REGISTERED_CEILING,
	WEBMCP_DISCLOSED_REGISTERED_CEILING,
	WEBMCP_FORBIDDEN_TOOL_NAME_FRAGMENTS,
	WEBMCP_MINIMUM_CHROME_MAJOR_VERSION,
	WEBMCP_ON_DEMAND_FAMILY_NAMES,
	WEBMCP_OPERATION_FAMILIES,
	WEBMCP_OPERATION_INVENTORY,
	WEBMCP_RESULT_CHARACTER_BUDGET,
	WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH,
	WEBMCP_TOOL_NAME_MAX_LENGTH
} from '../src/lib/platform/webmcp-operation-inventory.ts';

import type { WebmcpOperationRow } from '../src/lib/platform/webmcp-operation-inventory.ts';
import { hashWebmcpToolSchemaSurface } from '../src/lib/platform/webmcp-tool-schema-digest.ts';
import type { WebmcpRegisteredToolDescriptor } from '../src/lib/platform/webmcp-tool-schema-digest.ts';

const COMBINED_AGENT_PORT = Number(process.env.GFX_WEBMCP_CDP_PORT ?? 9229);
if (!Number.isSafeInteger(COMBINED_AGENT_PORT) || COMBINED_AGENT_PORT < 1) {
	throw new TypeError('GFX_WEBMCP_CDP_PORT must be a positive integer.');
}
const STANDARD_WEBMCP_PORT = Number(process.env.GFX_WEBMCP_STANDARD_CDP_PORT ?? 9225);
if (!Number.isSafeInteger(STANDARD_WEBMCP_PORT) || STANDARD_WEBMCP_PORT < 1) {
	throw new TypeError('GFX_WEBMCP_STANDARD_CDP_PORT must be a positive integer.');
}
const PAGE_ORIGIN = process.env.GFX_EVAL_ORIGIN ?? 'http://localhost:7263';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = resolve(
	process.env.WEBMCP_AGENT_EVAL_EVIDENCE ?? `${repoRoot}/docs/browser-probes/webmcp-agent-eval.json`
);

/** How long the page is given to mount and reconcile its first registration. */
const REGISTRATION_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

const AGENT_TOOL_ROWS = WEBMCP_OPERATION_INVENTORY.filter(
	(row) => row.exposure !== 'internal-only'
);
const INTERNAL_ONLY_ROWS = WEBMCP_OPERATION_INVENTORY.filter(
	(row) => row.exposure === 'internal-only'
);
const ROWS_BY_TOOL_NAME = new Map<string, WebmcpOperationRow>(
	WEBMCP_OPERATION_INVENTORY.map((row) => [row.toolName, row])
);

/** Every tool a page with nothing open may legitimately offer. */
const COLD_PAGE_TOOL_NAMES = new Set(
	AGENT_TOOL_ROWS.filter(
		(row) => row.precondition === 'always' || row.precondition === 'session-composition-present'
	).map((row) => row.toolName)
);

/** The tools a cold page must end up offering, whatever its session holds. */
const ALWAYS_REGISTERED_TOOL_NAMES = new Set(
	AGENT_TOOL_ROWS.filter((row) => row.precondition === 'always').map((row) => row.toolName)
);

/**
 * Core operations this eval looks for before an authoring family is prepared:
 * every agent row of a core family that an open composition makes usable, read
 * from the inventory so a family moving between core and on-demand cannot
 * leave this list asserting tools the page no longer offers by design.
 */
const CORE_FAMILY_NAMES = new Set(
	WEBMCP_OPERATION_FAMILIES.filter((family) => family.disclosure === 'core').map(
		(family) => family.name
	)
);
const OPEN_COMPOSITION_OPERATION_IDS: readonly string[] = AGENT_TOOL_ROWS.filter(
	(row) => CORE_FAMILY_NAMES.has(row.family) && row.precondition === 'composition-open'
).map((row) => row.id);

const failures: string[] = [];

function check(condition: boolean, failure: string): void {
	if (!condition) failures.push(failure);
}

function toolNameFor(operationId: string): string {
	const row = WEBMCP_OPERATION_INVENTORY.find((entry) => entry.id === operationId);
	if (!row) throw new Error(`The inventory declares no ${operationId}`);
	return row.toolName;
}

/** What one `executeTool` call returned, already unwrapped to the operation payload. */
interface ToolCallOutcome {
	isError: boolean;
	characterCount: number;
	payload: Record<string, unknown>;
}

interface CdpPage {
	send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
	evaluate<T>(expression: string): Promise<T>;
	close(): Promise<void>;
}

function runCommand(command: string, args: readonly string[], env: Record<string, string>): void {
	const result = spawnSync(command, [...args], {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: 'inherit',
		env: { ...process.env, ...env }
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
	}
}

async function openCdpPage(port: number): Promise<CdpPage> {
	const response = await fetch(
		`http://localhost:${port}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${port} would not open a target`);
	const target = (await response.json()) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error(`CDP ${port} socket refused the connection`));
	});

	let nextId = 1;
	const pending = new Map<
		number,
		{ settle: (value: Record<string, unknown>) => void; fail: (error: Error) => void }
	>();
	socket.onmessage = (event: MessageEvent) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			error?: { message: string };
			result?: Record<string, unknown>;
		};
		if (message.id === undefined) return;
		const waiting = pending.get(message.id);
		if (!waiting) return;
		pending.delete(message.id);
		if (message.error) waiting.fail(new Error(message.error.message));
		else waiting.settle(message.result ?? {});
	};

	const send = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<Record<string, unknown>>((settle, fail) => {
			const id = nextId++;
			pending.set(id, { settle, fail });
			socket.send(JSON.stringify({ id, method, params }));
		});

	async function evaluate<T>(expression: string): Promise<T> {
		const result = (await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		})) as {
			exceptionDetails?: { text: string; exception?: { description?: string } };
			result: { value: T };
		};
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
			);
		}
		return result.result.value;
	}

	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	return {
		send,
		evaluate,
		close: async () => {
			await send('Page.close');
			socket.close();
		}
	};
}

const sleep = (milliseconds: number) =>
	new Promise<void>((settle) => setTimeout(settle, milliseconds));

/**
 * Which build answered. The release seal binds every acceptance claim to one
 * commit, so evidence that cannot say which build it measured is evidence the
 * seal has to reject — recording it here is what keeps this eval bindable.
 */
async function readServedRelease(): Promise<string | null> {
	const response = await fetch(`${PAGE_ORIGIN}/api/health`).catch(() => null);
	if (!response || response.status !== 200) return null;
	const body = (await response.json()) as { release?: unknown };
	return typeof body.release === 'string' ? body.release : null;
}

/**
 * The tools `getTools()` reports, once the page has registered at least one. The
 * measured API's authority on what is registered is `getTools()`, so this eval
 * never reads the controller's own bookkeeping.
 */
async function readRegisteredTools(page: CdpPage): Promise<WebmcpRegisteredToolDescriptor[]> {
	return page.evaluate<WebmcpRegisteredToolDescriptor[]>(`(async () => {
		const tools = Array.from(await document.modelContext.getTools());
		return tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			annotations: {
				readOnlyHint: tool.annotations?.readOnlyHint === true,
				untrustedContentHint: tool.annotations?.untrustedContentHint === true
			},
			inputSchema: typeof tool.inputSchema === 'string'
				? tool.inputSchema
				: JSON.stringify(tool.inputSchema)
		}));
	})()`);
}

/**
 * Wait until every named tool is registered, not until *some* tool is.
 *
 * The controller awaits `registerTool` one call at a time, so `getTools()` mid
 * reconcile returns a real but partial menu — and how far through that menu a
 * poll lands depends on how fast the page hydrates, which differs between the
 * dev server and a built artifact. Settling on a count would make this eval
 * report a slow page as a missing tool.
 */
async function awaitRegistration(
	page: CdpPage,
	required: ReadonlySet<string>
): Promise<WebmcpRegisteredToolDescriptor[]> {
	const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;
	let tools: WebmcpRegisteredToolDescriptor[] = [];
	let missing: string[] = [...required];
	while (Date.now() < deadline) {
		const ready = await page.evaluate<boolean>(
			`document.readyState === 'complete' && typeof document.modelContext === 'object'`
		);
		if (ready) {
			tools = await readRegisteredTools(page);
			const registered = new Set(tools.map((tool) => tool.name));
			missing = [...required].filter((name) => !registered.has(name));
			if (missing.length === 0) return tools;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(
		`The page registered ${tools.length} WebMCP tools within ${REGISTRATION_TIMEOUT_MS}ms but never offered ${missing.join(', ')}`
	);
}

/**
 * Call one registered tool the way an attached agent does: pick it out of
 * `getTools()` and hand `executeTool` the tool and its arguments as JSON text —
 * the Chrome 153 manual-execution shape.
 */
async function callTool(
	page: CdpPage,
	toolName: string,
	args: Record<string, unknown>
): Promise<ToolCallOutcome> {
	return page.evaluate<ToolCallOutcome>(`(async () => {
		const tools = Array.from(await document.modelContext.getTools());
		const tool = tools.find((entry) => entry.name === ${JSON.stringify(toolName)});
		if (!tool) throw new Error('No registered tool named ' + ${JSON.stringify(toolName)});
		const raw = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(args))});
		const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
		const text = result.content[0].text;
		return {
			isError: result.isError === true,
			characterCount: text.length,
			payload: JSON.parse(text)
		};
	})()`);
}

/**
 * What one CDP session can do, and what the page decided about it. The exposure
 * refusal is the layout's published verdict (`window.__gfxWebmcpExposureRefusal`):
 * `null` where tools may register, a reason where they may not, and
 * `'unpublished'` on a page whose layout never ran.
 */
async function readHarnessCapabilities(
	page: CdpPage,
	port: number
): Promise<Record<string, unknown>> {
	const version = (await (await fetch(`http://localhost:${port}/json/version`)).json()) as Record<
		string,
		string
	>;
	const capabilities = await page.evaluate<Record<string, unknown>>(`({
		modelContext: typeof document.modelContext === 'object',
		modelContextMembers: document.modelContext
			? Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext)).sort()
			: [],
		secureContext: isSecureContext,
		canvasDrawElement:
			typeof GPUQueue === 'function' && 'copyElementImageToTexture' in GPUQueue.prototype,
		exposureRefusal:
			'__gfxWebmcpExposureRefusal' in window ? window.__gfxWebmcpExposureRefusal : 'unpublished'
	})`);
	return {
		browser: version.Browser,
		protocolVersion: version['Protocol-Version'],
		...capabilities
	};
}

/**
 * Whether a same-origin frame of this page registers tools of its own. ADR-0054
 * §7 registers only in the top-level document; Chrome's `ModelContext` reports
 * every same-origin tool in the tab, so the question is ownership, not presence.
 *
 * A public origin answers this before the frame ever loads: its
 * `frame-ancestors 'none'` policy refuses the embed, and reaching into the
 * blocked frame throws a `SecurityError`. That is the same guarantee, reached
 * earlier, so it is recorded as `frameRefusedByPolicy` rather than treated as a
 * failure — the dev server, which is held to no CSP, still takes the branch
 * below and has its ownership measured.
 */
async function readFramedRegistration(page: CdpPage): Promise<Record<string, unknown>> {
	return page.evaluate<Record<string, unknown>>(`(async () => {
		const frame = document.createElement('iframe');
		frame.src = location.origin + '/';
		document.body.appendChild(frame);
		await new Promise((settle) => { frame.onload = settle; });
		await new Promise((settle) => setTimeout(settle, 5000));
		try {
			const framedContext = frame.contentWindow.document.modelContext;
			const tools = framedContext ? Array.from(await framedContext.getTools()) : [];
			const ownedByFrame = tools.filter((tool) => tool.window === frame.contentWindow);
			return {
				frameRefusedByPolicy: false,
				framedContextExposed: Boolean(framedContext),
				toolsOwnedByFrame: ownedByFrame.map((tool) => tool.name),
				toolsOwnedByTopDocument: tools.filter((tool) => tool.window === window).length
			};
		} catch (cause) {
			if (!(cause instanceof DOMException) || cause.name !== 'SecurityError') throw cause;
			return {
				frameRefusedByPolicy: true,
				framedContextExposed: false,
				toolsOwnedByFrame: [],
				toolsOwnedByTopDocument: null
			};
		} finally {
			frame.remove();
		}
	})()`);
}

runCommand('scripts/launch-cdp-chrome.sh', [], {
	CDP_PORT: String(COMBINED_AGENT_PORT),
	CDP_BROWSER_MODE: 'agent'
});

const page = await openCdpPage(COMBINED_AGENT_PORT);
const browserVersion = (await (
	await fetch(`http://localhost:${COMBINED_AGENT_PORT}/json/version`)
).json()) as { Browser?: unknown };
const chromeMajor = Number(/^Chrome\/(\d+)/.exec(String(browserVersion.Browser))?.[1]);
if (!Number.isSafeInteger(chromeMajor) || chromeMajor < WEBMCP_MINIMUM_CHROME_MAJOR_VERSION) {
	await page.close();
	throw new Error(
		`WebMCP evaluation requires Chrome ${WEBMCP_MINIMUM_CHROME_MAJOR_VERSION} or newer; the harness is ${String(browserVersion.Browser)}.`
	);
}
await page.send('Page.navigate', { url: `${PAGE_ORIGIN}/` });
const coldPageTools = await awaitRegistration(page, ALWAYS_REGISTERED_TOOL_NAMES);
const harness = await readHarnessCapabilities(page, COMBINED_AGENT_PORT);

check(harness.modelContext === true, 'the CDP session does not expose document.modelContext');
check(
	harness.canvasDrawElement === true,
	'the CDP session does not enable CanvasDrawElement, so it is not the combined agent harness'
);
check(
	harness.exposureRefusal === null,
	`the agent page published a WebMCP exposure refusal: ${String(harness.exposureRefusal)}`
);

// The cold page: a short menu of real rows, and nothing that needs a composition.
check(
	coldPageTools.length <= WEBMCP_ALWAYS_REGISTERED_CEILING,
	`a cold page registered ${coldPageTools.length} tools, past the ceiling of ${WEBMCP_ALWAYS_REGISTERED_CEILING}`
);
for (const tool of coldPageTools) {
	const row = ROWS_BY_TOOL_NAME.get(tool.name);
	check(row !== undefined, `${tool.name} is registered but is not an inventory row`);
	check(
		COLD_PAGE_TOOL_NAMES.has(tool.name),
		`${tool.name} is registered on a cold page but needs an open composition`
	);
	check(
		tool.description === row?.summary,
		`${tool.name} is described with text the inventory row does not carry`
	);
	check(
		row !== undefined &&
			JSON.stringify(tool.annotations) === JSON.stringify(readWebmcpOperationAnnotations(row)),
		`${tool.name} is missing its read-only or untrusted-content annotation`
	);
	check(
		tool.name.length <= WEBMCP_TOOL_NAME_MAX_LENGTH,
		`${tool.name} is longer than the ${WEBMCP_TOOL_NAME_MAX_LENGTH}-character name budget`
	);
	check(
		tool.description.length <= WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH,
		`${tool.name} is described past the ${WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH}-character budget`
	);
	for (const fragment of WEBMCP_FORBIDDEN_TOOL_NAME_FRAGMENTS) {
		check(!tool.name.includes(fragment), `${tool.name} names the interface verb "${fragment}"`);
	}
}
for (const row of AGENT_TOOL_ROWS.filter((entry) => entry.precondition === 'always')) {
	check(
		coldPageTools.some((tool) => tool.name === row.toolName),
		`${row.toolName} is an always-registered row the cold page did not offer`
	);
}

// Discovery reads the live registries rather than a list written into a tool.
const vocabulary = await callTool(page, toolNameFor('capability.inspect-vocabulary'), {
	section: 'overlay-type'
});
check(!vocabulary.isError, 'the vocabulary read refused on the live page');
check(
	Array.isArray(vocabulary.payload.members) && (vocabulary.payload.members as unknown[]).length > 0,
	'the vocabulary read returned no Overlay types'
);
check(
	vocabulary.characterCount <= WEBMCP_RESULT_CHARACTER_BUDGET,
	`the vocabulary read returned ${vocabulary.characterCount} characters, past its budget`
);

// Creating a composition is what makes the rest of the surface exist.
const created = await callTool(page, toolNameFor('composition.create-blank'), {});
check(!created.isError, `creating a blank composition refused: ${String(created.payload.message)}`);
const openSlug = String(created.payload.slug ?? '');
check(openSlug.length > 0, 'the create receipt named no session slug');

const openPageTools = await awaitRegistration(
	page,
	new Set(OPEN_COMPOSITION_OPERATION_IDS.map(toolNameFor))
);
const openPageToolNames = new Set(openPageTools.map((tool) => tool.name));
const observedTools = new Map(openPageTools.map((tool) => [tool.name, tool] as const));
for (const operationId of OPEN_COMPOSITION_OPERATION_IDS) {
	check(
		openPageToolNames.has(toolNameFor(operationId)),
		`${operationId} did not appear once a composition was open`
	);
}
check(
	openPageTools.length <= WEBMCP_CORE_REGISTERED_CEILING,
	`the open core registered ${openPageTools.length} tools, past its ${WEBMCP_CORE_REGISTERED_CEILING}-tool ceiling`
);
for (const family of WEBMCP_ON_DEMAND_FAMILY_NAMES) {
	for (const row of AGENT_TOOL_ROWS.filter((entry) => entry.family === family)) {
		check(
			!openPageToolNames.has(row.toolName),
			`${row.toolName} appeared before ${family} was prepared`
		);
	}
}
for (const row of INTERNAL_ONLY_ROWS) {
	check(
		!openPageToolNames.has(row.toolName),
		`${row.id} is marked internal-only but reached an attached agent as ${row.toolName}`
	);
}
for (const tool of openPageTools) {
	const row = ROWS_BY_TOOL_NAME.get(tool.name);
	check(
		row !== undefined && row.exposure !== 'internal-only',
		`${tool.name} is registered without an agent-reachable inventory row`
	);
	check(
		row !== undefined &&
			JSON.stringify(tool.annotations) === JSON.stringify(readWebmcpOperationAnnotations(row)),
		`${tool.name} is missing its read-only or untrusted-content annotation`
	);
}

const prepareTransport = await callTool(page, toolNameFor('capability.prepare-authoring-family'), {
	family: 'transport'
});
check(!prepareTransport.isError, 'preparing the transport family refused');
const transportTools = await awaitRegistration(
	page,
	new Set([toolNameFor('transport.set-orientation')])
);
for (const tool of transportTools) observedTools.set(tool.name, tool);
check(
	transportTools.length <= WEBMCP_DISCLOSED_REGISTERED_CEILING,
	`the transport family produced ${transportTools.length} active tools, past the ${WEBMCP_DISCLOSED_REGISTERED_CEILING}-tool ceiling`
);

// The revision contract, over the real transport.
const inspected = await callTool(page, toolNameFor('composition.inspect'), {});
check(!inspected.isError, 'inspecting the open composition refused');
check(
	inspected.payload.contentTrust === 'untrusted',
	'the inspection receipt does not annotate the visitor’s own text as untrusted'
);
const currentRevision = Number(inspected.payload.revision);

const stale = await callTool(page, toolNameFor('transport.set-orientation'), {
	expectedRevision: currentRevision + 1,
	orientation: 'vertical'
});
check(stale.isError, 'a write against a revision the composition never had was accepted');
check(
	stale.payload.code === 'stale_revision',
	`a stale write answered ${String(stale.payload.code)} instead of stale_revision`
);

const applied = await callTool(page, toolNameFor('transport.set-orientation'), {
	expectedRevision: currentRevision,
	orientation: 'vertical'
});
check(!applied.isError, `the current-revision write refused: ${String(applied.payload.message)}`);
check(
	applied.characterCount <= WEBMCP_RESULT_CHARACTER_BUDGET,
	`the edit receipt returned ${applied.characterCount} characters, past its budget`
);

const reinspected = await callTool(page, toolNameFor('composition.inspect'), {});
check(
	(reinspected.payload.transport as { orientation?: string } | undefined)?.orientation ===
		'vertical',
	'the applied edit is not visible in the next inspection'
);

const preparedLayer = await callTool(page, toolNameFor('capability.prepare-authoring-family'), {
	family: 'layer'
});
check(!preparedLayer.isError, 'preparing the layer family refused');
const layerTools = await awaitRegistration(page, new Set([toolNameFor('layer.add-overlay')]));
for (const tool of layerTools) observedTools.set(tool.name, tool);
check(
	!layerTools.some((tool) => tool.name === toolNameFor('transport.set-orientation')),
	'the transport family stayed in context after the layer family replaced it'
);
const addedOverlay = await callTool(page, toolNameFor('layer.add-overlay'), {
	expectedRevision: Number(applied.payload.revision),
	overlayType: 'lower-third'
});
check(!addedOverlay.isError, 'adding an Overlay through the prepared layer family refused');
const overlayIdValue = (addedOverlay.payload.focus as { overlayId?: unknown } | undefined)
	?.overlayId;
const overlayId = typeof overlayIdValue === 'string' ? overlayIdValue : '';
check(overlayId.length > 0, 'the Overlay receipt named no id');

const preparedContent = await callTool(page, toolNameFor('capability.prepare-authoring-family'), {
	family: 'content'
});
check(!preparedContent.isError, 'preparing the content family refused');
const contentTools = await awaitRegistration(
	page,
	new Set([toolNameFor('content.set-overlay-content')])
);
for (const tool of contentTools) observedTools.set(tool.name, tool);
const wroteContent = await callTool(page, toolNameFor('content.set-overlay-content'), {
	expectedRevision: Number(addedOverlay.payload.revision),
	overlayId,
	content: { title: 'Chrome 153', subtitle: 'WebMCP family disclosure' }
});
check(!wroteContent.isError, 'writing a nested Overlay content object refused');

const preparedTransportAgain = await callTool(
	page,
	toolNameFor('capability.prepare-authoring-family'),
	{ family: 'transport' }
);
check(!preparedTransportAgain.isError, 'preparing the transport family a second time refused');
const transportToolsAgain = await awaitRegistration(
	page,
	new Set([toolNameFor('transport.set-orientation')])
);
for (const tool of transportToolsAgain) observedTools.set(tool.name, tool);
check(
	transportToolsAgain.some((tool) => tool.name === toolNameFor('transport.set-orientation')),
	'a family tool did not re-register after another family replaced it'
);

const exported = await callTool(page, toolNameFor('composition.export-json'), {});
check(!exported.isError, 'exporting the composition JSON refused');
check(
	exported.payload.contentTrust === 'untrusted',
	'the whole-document read does not annotate the composition body as untrusted'
);
for (const tool of observedTools.values()) {
	const row = ROWS_BY_TOOL_NAME.get(tool.name);
	check(
		row !== undefined &&
			JSON.stringify(tool.annotations) === JSON.stringify(readWebmcpOperationAnnotations(row)),
		`${tool.name} is missing its Chrome annotation hints`
	);
}

const framed = await readFramedRegistration(page);
check(
	Array.isArray(framed.toolsOwnedByFrame) && (framed.toolsOwnedByFrame as unknown[]).length === 0,
	`a same-origin frame registered its own tools: ${JSON.stringify(framed.toolsOwnedByFrame)}`
);

// Leave the browser session as clean as this eval found it. A reload closes the
// composition — a session tool refuses to delete the one that is open, because
// it would autosave itself straight back — and returns the revision to zero.
await page.send('Page.navigate', { url: `${PAGE_ORIGIN}/` });
await awaitRegistration(
	page,
	new Set([...ALWAYS_REGISTERED_TOOL_NAMES, toolNameFor('session.delete-composition')])
);
const deleted = await callTool(page, toolNameFor('session.delete-composition'), {
	slug: openSlug,
	expectedRevision: 0
});
check(
	!deleted.isError,
	`deleting the eval composition refused: ${String(deleted.payload.message)}`
);

// The headless agent case. A WebMCP browser without CanvasDrawElement never
// mounts the Workspace — the capability gate replaces it with the notice — yet
// the root layout registers the same cold menu behind that notice, and an agent
// can create, read, and edit a composition through it. Only operations that
// render need the flagged browser, which is why the walk above ran there.
runCommand('scripts/launch-cdp-chrome.sh', [], {
	CDP_PORT: String(STANDARD_WEBMCP_PORT),
	CDP_BROWSER_MODE: 'standard-webmcp'
});
const renderlessPage = await openCdpPage(STANDARD_WEBMCP_PORT);
await renderlessPage.send('Page.navigate', { url: `${PAGE_ORIGIN}/` });
const renderlessColdTools = await awaitRegistration(renderlessPage, ALWAYS_REGISTERED_TOOL_NAMES);
const renderlessHarness = await readHarnessCapabilities(renderlessPage, STANDARD_WEBMCP_PORT);
const renderlessGateShown = await renderlessPage.evaluate<boolean>(
	`document.querySelector('.capability-gate') !== null && document.querySelector('canvas') === null`
);
check(
	renderlessHarness.canvasDrawElement === false,
	'the standard WebMCP session enables CanvasDrawElement, so it is not the renderless harness'
);
check(
	renderlessGateShown,
	'the renderless browser mounted the app instead of the capability-gate notice'
);
check(
	renderlessHarness.exposureRefusal === null,
	`the renderless page published a WebMCP exposure refusal: ${String(renderlessHarness.exposureRefusal)}`
);
check(
	renderlessColdTools.length <= WEBMCP_ALWAYS_REGISTERED_CEILING,
	`the renderless cold page registered ${renderlessColdTools.length} tools, past the ceiling of ${WEBMCP_ALWAYS_REGISTERED_CEILING}`
);
for (const tool of renderlessColdTools) {
	check(
		COLD_PAGE_TOOL_NAMES.has(tool.name),
		`${tool.name} is registered on the renderless cold page but needs an open composition`
	);
}

const renderlessCreated = await callTool(
	renderlessPage,
	toolNameFor('composition.create-blank'),
	{}
);
check(
	!renderlessCreated.isError,
	`creating a composition without the renderer refused: ${String(renderlessCreated.payload.message)}`
);
const renderlessSlug = String(renderlessCreated.payload.slug ?? '');
const renderlessOpenTools = await awaitRegistration(
	renderlessPage,
	new Set(OPEN_COMPOSITION_OPERATION_IDS.map(toolNameFor))
);
const renderlessInspected = await callTool(renderlessPage, toolNameFor('composition.inspect'), {});
check(
	!renderlessInspected.isError,
	`inspecting a composition without the renderer refused: ${String(renderlessInspected.payload.message)}`
);
for (const row of INTERNAL_ONLY_ROWS) {
	check(
		!renderlessOpenTools.some((tool) => tool.name === row.toolName),
		`${row.id} is marked internal-only but reached the renderless browser as ${row.toolName}`
	);
}

await renderlessPage.send('Page.navigate', { url: `${PAGE_ORIGIN}/` });
await awaitRegistration(
	renderlessPage,
	new Set([...ALWAYS_REGISTERED_TOOL_NAMES, toolNameFor('session.delete-composition')])
);
const renderlessDeleted = await callTool(
	renderlessPage,
	toolNameFor('session.delete-composition'),
	{
		slug: renderlessSlug,
		expectedRevision: 0
	}
);
check(
	!renderlessDeleted.isError,
	`deleting the renderless eval composition refused: ${String(renderlessDeleted.payload.message)}`
);
await renderlessPage.close();

const release = await readServedRelease();
check(release !== null, 'the measured origin did not report a release at /api/health');

const evidence = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	probe: 'webmcp-agent-eval',
	origin: PAGE_ORIGIN,
	release,
	harness,
	// The schemas an agent was actually offered, not the ones the inventory says
	// it should have been. A build that renamed one argument is a different
	// authoring surface, and receipts taken against the older one are stale.
	toolSchemaDigest: await hashWebmcpToolSchemaSurface([...observedTools.values()]),
	inventory: {
		rows: WEBMCP_OPERATION_INVENTORY.length,
		agentTools: AGENT_TOOL_ROWS.length,
		agentContext: WEBMCP_OPERATION_INVENTORY.filter((row) => row.exposure === 'agent-context').map(
			(row) => row.id
		),
		internalOnly: INTERNAL_ONLY_ROWS.map((row) => row.id)
	},
	coldPage: {
		registered: coldPageTools.map((tool) => tool.name).sort(),
		ceiling: WEBMCP_ALWAYS_REGISTERED_CEILING
	},
	openComposition: {
		slug: openSlug,
		coreRegistered: [...openPageToolNames].sort(),
		coreCeiling: WEBMCP_CORE_REGISTERED_CEILING,
		disclosedCeiling: WEBMCP_DISCLOSED_REGISTERED_CEILING,
		familyRegisteredCounts: {
			transport: transportTools.length,
			layer: layerTools.length,
			content: contentTools.length,
			transportAgain: transportToolsAgain.length
		},
		verificationToolsRegistered: INTERNAL_ONLY_ROWS.filter((row) =>
			observedTools.has(row.toolName)
		).map((row) => row.toolName)
	},
	calls: {
		vocabularyMembers: vocabulary.payload.members,
		staleWriteCode: stale.payload.code,
		appliedRevision: applied.payload.revision,
		nestedContentRevision: wroteContent.payload.revision,
		reversibleFamilyRegistration: transportToolsAgain.some(
			(tool) => tool.name === toolNameFor('transport.set-orientation')
		),
		exportedCharacterCount: exported.characterCount,
		contentTrust: {
			inspect: inspected.payload.contentTrust,
			exportJson: exported.payload.contentTrust
		}
	},
	framedDocument: framed,
	renderlessBrowser: {
		harness: renderlessHarness,
		capabilityGateShown: renderlessGateShown,
		coldPageRegistered: renderlessColdTools.map((tool) => tool.name).sort(),
		openCoreRegistered: renderlessOpenTools.map((tool) => tool.name).sort(),
		inspectRevision: renderlessInspected.payload.revision
	},
	failures
};

mkdirSync(dirname(evidencePath), { recursive: true });
const prettierConfig = (await resolveConfig(evidencePath)) ?? {};
writeFileSync(
	evidencePath,
	await format(JSON.stringify(evidence), { ...prettierConfig, parser: 'json' })
);
await page.close();

console.log(`Wrote ${evidencePath}`);
if (failures.length > 0) {
	console.error(`WebMCP agent eval failed:\n- ${failures.join('\n- ')}`);
	process.exitCode = 1;
} else {
	console.log(
		`WebMCP agent eval passed: ${coldPageTools.length} cold-page tools, ${openPageToolNames.size} in the open core, reversible family disclosure, ${INTERNAL_ONLY_ROWS.length} internal-only rows unexposed, ${renderlessColdTools.length} cold-page tools without CanvasDrawElement.`
	);
}
