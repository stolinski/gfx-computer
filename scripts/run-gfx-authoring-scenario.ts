// Run the exact live create-to-export authoring scenario, and its negatives,
// through WebMCP alone (ADR-0054, ADR-0052).
//
// `pnpm eval:webmcp` asks what an attached agent *discovers*: the cold-page menu,
// the registration ceiling, one stale write, one annotation. This asks the other
// question — can an agent that only has WebMCP actually make a piece and receive
// the file? — and answers it by authoring one composition end to end against a
// served origin:
//
//   pnpm verify:authoring-scenario                                 # the dev server on :7263
//   GFX_SCENARIO_ORIGIN=http://127.0.0.1:8080 pnpm verify:authoring-scenario
//
// Every authoring act here is a WebMCP tool call. The harness only does what a
// visitor does — open a page, look at it, walk away, take the file the browser
// downloaded — so nothing can pass by reaching around the transport into engine
// state.
//
// The scenario runs on the combined `agent` harness (port 9229) — WebMCP AND
// CanvasDrawElement together, the default local agent mode since qju2qity: the
// tools drive the REAL renderer, and a browser without the canvas flag is
// hard-gated by the app rather than served an approximation. "Did this render"
// is answered by a screenshot of the visible canvas, never by reading the
// canvas back, so the same capture works wherever the composition paints.
//
// Writes docs/browser-probes/gfx-authoring-scenario.json — every receipt, every
// refusal, and every pixel and decode measurement the run took — and fails,
// naming the check, when the origin cannot carry the scenario.
//
// Needs a local Chrome, ffmpeg/ffprobe, and a server already answering for this
// build, so it is a command a person runs rather than part of `pnpm check`.
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PNG } from 'pngjs';
import { format, resolveConfig } from 'prettier';

import {
	DEVELOPMENT_EXPORT_RUNTIME_LIMITS,
	PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS,
	PUBLIC_EXPORT_RUNTIME_LIMITS
} from '../src/lib/platform/public-runtime-contract.ts';
import {
	WEBMCP_OPERATION_INVENTORY,
	WEBMCP_RESULT_CHARACTER_BUDGET
} from '../src/lib/platform/webmcp-operation-inventory.ts';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.GFX_SCENARIO_ORIGIN ?? 'http://localhost:7263';
const EVIDENCE_PATH = resolve(
	process.env.GFX_SCENARIO_EVIDENCE ??
		join(repoRoot, 'docs/browser-probes/gfx-authoring-scenario.json')
);

/** WebMCP with CanvasDrawElement: the combined-flag default local agent mode. */
const COMBINED_AGENT_PORT = 9229;
/** Neither experimental feature: the browser that proves the capability gate. */
const STANDARD_PORT = 9227;

const WIDE_VIEWPORT = { width: 1440, height: 900 } as const;

const REGISTRATION_TIMEOUT_MS = 30_000;
const PAGE_READY_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
/** How long the harness waits before deciding a lane produced no file at all. */
const NO_DOWNLOAD_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;

/**
 * The piece the scenario authors. Two seconds at thirty is long enough to hold a
 * real entrance, an exit, and a cue, and short enough that both native-target
 * export lanes finish inside one run.
 */
const SCENARIO_DURATION_SECONDS = 2;
const SCENARIO_FPS = 30;
const SCENARIO_FRAME_COUNT = SCENARIO_DURATION_SECONDS * SCENARIO_FPS;

/**
 * The longest duration `transport.set-timing` accepts — the composition
 * schema's ceiling (`engine-schema.ts`), which a development host's export
 * envelope reaches.
 */
const TRANSPORT_SCHEMA_MAX_DURATION_SECONDS = DEVELOPMENT_EXPORT_RUNTIME_LIMITS.maxDurationSeconds;

/** Two frames far enough apart to be in visibly different motion states. */
const COMPARED_FRAME = 45;
const OTHER_FRAME = 12;

/** Native targets (ADR-0052): the composition canvas must back one of them. */
const NATIVE_BACKING_SIZES = {
	horizontal: [3840, 2160],
	vertical: [2160, 3840]
} as const satisfies Record<'horizontal' | 'vertical', readonly [number, number]>;

/**
 * What counts as a rendered frame rather than an empty one. A settled Workspace
 * frame is a photograph of a whole composition, so the bar is deliberately
 * blunt: most of the frame differs from its own first pixel, in more than a
 * handful of colours.
 */
const MINIMUM_NON_UNIFORM_RATIO = 0.2;
const MINIMUM_DISTINCT_COLOURS = 24;

/** How many frames the delivered file is decoded at to prove it carries a picture. */
const DECODED_FRAME_SAMPLE = 4;

interface ScenarioFailure {
	check: string;
	detail: string;
}

const failures: ScenarioFailure[] = [];

function expect(check: string, condition: boolean, detail: string): boolean {
	if (condition) {
		console.log(`ok   ${check}`);
		return true;
	}
	failures.push({ check, detail });
	console.error(`FAIL ${check}: ${detail}`);
	return false;
}

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

// --- the inventory this scenario is written against -------------------------

const ROWS_BY_OPERATION_ID = new Map(WEBMCP_OPERATION_INVENTORY.map((row) => [row.id, row]));

/** The tool name the inventory gives an operation. Never spelled out by hand. */
function toolNameFor(operationId: string): string {
	const row = ROWS_BY_OPERATION_ID.get(operationId);
	if (!row) throw new Error(`The inventory declares no operation named ${operationId}`);
	if (row.exposure !== 'agent-tool') {
		throw new Error(`${operationId} is ${row.exposure}, so no agent may call it`);
	}
	return row.toolName;
}

/** Everything a page offers before anything is open, which is where the run starts. */
const ALWAYS_REGISTERED_OPERATION_IDS = WEBMCP_OPERATION_INVENTORY.filter(
	(row) => row.exposure === 'agent-tool' && row.precondition === 'always'
).map((row) => row.id);

// --- the browser ------------------------------------------------------------

/** One console error or uncaught exception, and the phase that provoked it. */
interface RuntimeFault {
	phase: string;
	detail: string;
}

/** The path a fault happened on, or an empty string when the URL is unusable. */
function readFaultPathname(fault: NetworkFault): string {
	return URL.canParse(fault.url) ? new URL(fault.url).pathname : '';
}

/** One request the origin refused, or one the browser did not finish. */
interface NetworkFault {
	phase: string;
	url: string;
	detail: string;
	/**
	 * Whether the page cancelled this request itself. The Workspace supersedes its
	 * own autosaves and poster reads as an author keeps typing, so an abort is the
	 * app's decision rather than a fault; it is recorded and not counted.
	 */
	isAborted: boolean;
}

/** The visible composition canvas, and where the Inspector says the focus is. */
interface CompositionCanvasBox {
	x: number;
	y: number;
	width: number;
	height: number;
	backingWidth: number;
	backingHeight: number;
	focusLabel: string | null;
}

interface ScenarioPage {
	send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
	evaluate<T>(expression: string): Promise<T>;
	navigate(url: string): Promise<void>;
	captureScreenshotPng(clip: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): Promise<Buffer>;
	readonly runtimeFaults: RuntimeFault[];
	readonly networkFaults: NetworkFault[];
	close(): Promise<void>;
}

/**
 * Whether this console error is the registration race ADR-0054 §5 describes and
 * the controller recovers from: leaving a route ends every registration, and the
 * next route's set is refused for the names the document has not finished
 * releasing. The controller says so and the next reconcile retries them, which
 * this run proves separately by calling those tools again afterwards — so it is
 * recorded and named rather than counted as an unexplained failure.
 */
function isWebmcpRegistrationRace(fault: RuntimeFault): boolean {
	return (
		fault.detail.includes('document.modelContext refused') &&
		fault.detail.includes('The next synchronize retries them')
	);
}

/**
 * The console errors this run causes on purpose. An export the scenario asks the
 * origin to refuse is reported to the page the same way any failed export is,
 * which is the app telling its visitor what happened rather than a fault.
 */
function isExpectedRuntimeFault(fault: RuntimeFault): boolean {
	return (
		isWebmcpRegistrationRace(fault) ||
		(fault.phase === 'negative-export-envelope' && fault.detail.includes('Unable to export'))
	);
}

/** Which part of the scenario is running, so a fault is attributable to it. */
let currentPhase = 'harness';

function startPhase(phase: string): void {
	currentPhase = phase;
	console.log(`\n— ${phase} —`);
}

function collectRuntimeFault(
	sink: RuntimeFault[],
	method: string | undefined,
	params: Record<string, unknown> | undefined
): void {
	if (method === 'Runtime.exceptionThrown') {
		const details = (
			params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
		)?.exceptionDetails;
		sink.push({
			phase: currentPhase,
			detail: `exception: ${details?.exception?.description ?? details?.text ?? 'unknown'}`
		});
		return;
	}
	if (method !== 'Runtime.consoleAPICalled') return;
	const call = params as { type?: string; args?: { value?: unknown; description?: string }[] };
	if (call?.type !== 'error') return;
	sink.push({
		phase: currentPhase,
		detail: `console.error: ${(call.args ?? [])
			.map((argument) => String(argument.value ?? argument.description ?? ''))
			.join(' ')
			.trim()}`
	});
}

/**
 * A refused or unfinished request, recorded with the phase that issued it: a
 * scenario that cancels an export on purpose expects aborted export requests,
 * and expects them only there.
 */
function collectNetworkFault(
	sink: NetworkFault[],
	requestUrls: Map<string, string>,
	method: string | undefined,
	params: Record<string, unknown> | undefined
): void {
	if (method === 'Network.requestWillBeSent') {
		const sent = params as { requestId?: string; request?: { url?: string } };
		if (sent.requestId && sent.request?.url) requestUrls.set(sent.requestId, sent.request.url);
		return;
	}
	if (method === 'Network.responseReceived') {
		const received = params as { response?: { url?: string; status?: number } };
		const status = received.response?.status ?? 0;
		if (status < 400) return;
		sink.push({
			phase: currentPhase,
			url: received.response?.url ?? 'unknown',
			detail: `status ${status}`,
			isAborted: false
		});
		return;
	}
	if (method !== 'Network.loadingFailed') return;
	const failed = params as { requestId?: string; errorText?: string; canceled?: boolean };
	const detail = failed.errorText ?? 'loading failed';
	sink.push({
		phase: currentPhase,
		url: requestUrls.get(failed.requestId ?? '') ?? 'unknown',
		detail,
		isAborted: failed.canceled === true || detail.includes('ERR_ABORTED')
	});
}

async function openScenarioPage(port: number): Promise<ScenarioPage> {
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
	const runtimeFaults: RuntimeFault[] = [];
	const networkFaults: NetworkFault[] = [];
	const requestUrls = new Map<string, string>();

	socket.onmessage = (event: MessageEvent) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			method?: string;
			params?: Record<string, unknown>;
			error?: { message: string };
			result?: Record<string, unknown>;
		};
		if (message.id === undefined) {
			collectRuntimeFault(runtimeFaults, message.method, message.params);
			collectNetworkFault(networkFaults, requestUrls, message.method, message.params);
			return;
		}
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

	await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable')]);
	await send('Emulation.setDeviceMetricsOverride', {
		width: WIDE_VIEWPORT.width,
		height: WIDE_VIEWPORT.height,
		deviceScaleFactor: 1,
		mobile: false
	});

	return {
		send,
		evaluate,
		runtimeFaults,
		networkFaults,
		navigate: async (url: string) => {
			await send('Page.navigate', { url });
		},
		captureScreenshotPng: async (clip) => {
			const captured = (await send('Page.captureScreenshot', {
				format: 'png',
				fromSurface: true,
				captureBeyondViewport: false,
				clip: { ...clip, scale: 1 }
			})) as { data: string };
			return Buffer.from(captured.data, 'base64');
		},
		close: async () => {
			await send('Page.close');
			socket.close();
		}
	};
}

/** Poll an in-page predicate until it holds, or give up and say what it last saw. */
async function waitInPage<T>(
	page: ScenarioPage,
	expression: string,
	isSettled: (value: T) => boolean,
	what: string
): Promise<T> {
	const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
	let last: T | undefined;
	while (Date.now() < deadline) {
		try {
			last = await page.evaluate<T>(expression);
			if (isSettled(last)) return last;
		} catch {
			// A navigation can tear the execution context down mid-poll.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(
		`${what} never settled within ${PAGE_READY_TIMEOUT_MS} ms; last saw ${JSON.stringify(last)}`
	);
}

// --- the WebMCP transport ---------------------------------------------------

/** What one `executeTool` call returned, unwrapped to the operation's own payload. */
interface WebmcpCallOutcome {
	isError: boolean;
	characterCount: number;
	payload: Record<string, unknown>;
}

/** One call as the evidence keeps it: what was asked, and what came back. */
interface RecordedWebmcpCall {
	phase: string;
	operationId: string;
	toolName: string;
	isError: boolean;
	characterCount: number;
	receipt: Record<string, unknown>;
}

const recordedCalls: RecordedWebmcpCall[] = [];
const exercisedOperationIds = new Set<string>();

/**
 * The serialized document is the one receipt field that runs to a quarter of a
 * megabyte, and keeping it would bury the evidence under a second copy of the
 * composition. It is retained as its digest and its length.
 */
function condenseReceipt(payload: Record<string, unknown>): Record<string, unknown> {
	if (typeof payload.json !== 'string') return payload;
	const { json, ...rest } = payload;
	return {
		...rest,
		jsonSha256: createHash('sha256').update(json).digest('hex'),
		jsonCharacters: json.length
	};
}

function recordCall(operationId: string, outcome: WebmcpCallOutcome): void {
	exercisedOperationIds.add(operationId);
	recordedCalls.push({
		phase: currentPhase,
		operationId,
		toolName: toolNameFor(operationId),
		isError: outcome.isError,
		characterCount: outcome.characterCount,
		receipt: condenseReceipt(outcome.payload)
	});
}

/**
 * Wait until the page offers this tool.
 *
 * Registration reconciles after the state change that makes an operation
 * possible, so the very first Overlay edit is asked for while the page is still
 * registering the tools that Overlay just made eligible. An attached agent sees
 * the same thing and waits on `ontoolchange`; this waits on `getTools()`, which
 * is the same authority. A tool that never appears throws, because "the
 * operation was never offered" is a different answer from "it refused".
 */
async function awaitOfferedTool(page: ScenarioPage, toolName: string): Promise<void> {
	const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const isOffered = await page
			.evaluate<boolean>(
				`(async () => {
					if (typeof document.modelContext !== 'object') return false;
					const tools = Array.from(await document.modelContext.getTools());
					return tools.some((tool) => tool.name === ${JSON.stringify(toolName)});
				})()`
			)
			.catch(() => false);
		if (isOffered) return;
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`The page never offered ${toolName} within ${REGISTRATION_TIMEOUT_MS}ms.`);
}

/**
 * Call one tool the way an attached agent does: pick it out of `getTools()` and
 * hand `executeTool` the tool and its arguments as JSON text.
 */
async function callWebmcpOperation(
	page: ScenarioPage,
	operationId: string,
	args: Record<string, unknown> = {}
): Promise<WebmcpCallOutcome> {
	const toolName = toolNameFor(operationId);
	// A call can land on a registration that ends underneath it — leaving a route
	// does exactly that — and the refusal says so and tells the caller to try
	// again. Following that instruction is the agent behaviour the contract
	// describes, so the retry is here rather than at every call site.
	const maximumAttempts = 3;
	let outcome: WebmcpCallOutcome | null = null;
	for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
		await awaitOfferedTool(page, toolName);
		outcome = await page.evaluate<WebmcpCallOutcome>(`(async () => {
			const tools = Array.from(await document.modelContext.getTools());
			const tool = tools.find((entry) => entry.name === ${JSON.stringify(toolName)});
			if (!tool) throw new Error('No registered tool named ' + ${JSON.stringify(toolName)});
			const raw = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(args))});
			const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
			const text = result.content[0].text;
			return { isError: result.isError === true, characterCount: text.length, payload: JSON.parse(text) };
		})()`);
		if (outcome.payload.code !== 'cancelled' || attempt === maximumAttempts) break;
		await sleep(POLL_INTERVAL_MS * 4);
	}
	if (!outcome) throw new Error(`${toolName} was never called.`);
	recordCall(operationId, outcome);
	return outcome;
}

/** The Composition revision this run last observed, exactly as an agent tracks it. */
let observedRevision = 0;

function readReceiptRevision(outcome: WebmcpCallOutcome): number {
	const revision = outcome.payload.revision;
	return typeof revision === 'number' ? revision : observedRevision;
}

/**
 * Apply one edit at the revision this run last observed, and adopt whatever
 * revision the receipt reports — including the one a refusal names, which is how
 * an agent recovers. An edit the scenario expected to apply is a failed check
 * where it stands, so the run reports the operation that broke rather than the
 * consequence three calls later.
 */
async function applyWebmcpEdit(
	page: ScenarioPage,
	operationId: string,
	args: Record<string, unknown> = {}
): Promise<WebmcpCallOutcome> {
	const outcome = await callWebmcpOperation(page, operationId, {
		expectedRevision: observedRevision,
		...args
	});
	observedRevision = readReceiptRevision(outcome);
	if (outcome.isError) {
		expect(
			`the-${operationId}-edit-applies`,
			false,
			`${String(outcome.payload.code)}: ${String(outcome.payload.message)}`
		);
	}
	return outcome;
}

/** Wait until every named operation is offered, not until some tool is. */
async function awaitRegisteredOperations(
	page: ScenarioPage,
	operationIds: readonly string[]
): Promise<readonly string[]> {
	const required = new Set(operationIds.map(toolNameFor));
	const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;
	let registered: readonly string[] = [];
	let missing: string[] = [...required];
	while (Date.now() < deadline) {
		const ready = await page
			.evaluate<boolean>(
				`document.readyState === 'complete' && typeof document.modelContext === 'object'`
			)
			.catch(() => false);
		if (ready) {
			registered = await page.evaluate<string[]>(`(async () => {
				const tools = Array.from(await document.modelContext.getTools());
				return tools.map((tool) => tool.name);
			})()`);
			const offered = new Set(registered);
			missing = [...required].filter((name) => !offered.has(name));
			if (missing.length === 0) return registered;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(
		`The page offered ${registered.length} WebMCP tools within ${REGISTRATION_TIMEOUT_MS}ms but never ${missing.join(', ')}`
	);
}

// --- what the Workspace is showing ------------------------------------------

/** One settled photograph of the visible composition canvas. */
interface WorkspaceFrameReading {
	backingWidth: number;
	backingHeight: number;
	/** The whole-pixel screen rectangle this frame was photographed from. */
	clip: { x: number; y: number; width: number; height: number };
	/** Fraction of pixels that differ from the frame's own first pixel. */
	nonUniformRatio: number;
	distinctColours: number;
	sha256: string;
	/** How many captures it took before the frame stopped changing. */
	settledAfter: number;
	/** The Inspector's own readout of what the last operation focused. */
	focusLabel: string | null;
}

const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

const COMPOSITION_CANVAS_BOX = `(() => {
	const canvas = ${COMPOSITION_CANVAS};
	const box = canvas.getBoundingClientRect();
	return {
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
		backingWidth: canvas.width,
		backingHeight: canvas.height,
		focusLabel: document.querySelector('.inspector__crumb-current')?.textContent?.trim() ?? null
	};
})()`;

const WORKSPACE_READY = `(() => {
	const canvas = ${COMPOSITION_CANVAS};
	return document.readyState === 'complete' && !!canvas && canvas.width > 0 && !!window.__gfxTimeline;
})()`;

function measureFramePng(bytes: Buffer): {
	nonUniformRatio: number;
	distinctColours: number;
	sha256: string;
} {
	const png = PNG.sync.read(bytes);
	const first = [png.data[0], png.data[1], png.data[2]];
	let nonUniform = 0;
	const colours = new Set<number>();
	for (let offset = 0; offset < png.data.length; offset += 4) {
		const red = png.data[offset];
		const green = png.data[offset + 1];
		const blue = png.data[offset + 2];
		if (red !== first[0] || green !== first[1] || blue !== first[2]) nonUniform += 1;
		if (colours.size <= 8192) colours.add((red << 16) | (green << 8) | blue);
	}
	return {
		nonUniformRatio: nonUniform / (png.width * png.height),
		distinctColours: colours.size,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
}

/**
 * Photograph the visible composition canvas once it has stopped changing.
 *
 * A seek or an edit lands over several frames — fonts settle, a Pack's textures
 * decode — so a single capture taken the instant an operation returns is a
 * picture of a Workspace mid-move. Capturing until two consecutive frames agree
 * is what makes "the same frame looks the same" a statement about the
 * composition rather than about how fast this machine repaints.
 */
async function captureSettledWorkspaceFrame(page: ScenarioPage): Promise<WorkspaceFrameReading> {
	const maximumCaptures = 20;
	// Two frames in a row can agree while a Pack's fonts are still loading and
	// disagree again a moment later, so agreement has to hold three deep before a
	// frame is called settled.
	const requiredAgreements = 3;
	let previousSha: string | null = null;
	let agreements = 1;
	for (let capture = 1; capture <= maximumCaptures; capture += 1) {
		const box = await page.evaluate<CompositionCanvasBox>(COMPOSITION_CANVAS_BOX);
		// The clip is rounded to whole device pixels: a fractional origin resamples
		// the same picture differently from one capture to the next, which reads as
		// a changed frame when nothing changed.
		const clip = {
			x: Math.round(box.x),
			y: Math.round(box.y),
			width: Math.round(box.width),
			height: Math.round(box.height)
		};
		const measured = measureFramePng(await page.captureScreenshotPng(clip));
		agreements = previousSha === measured.sha256 ? agreements + 1 : 1;
		if (agreements >= requiredAgreements) {
			return {
				backingWidth: box.backingWidth,
				backingHeight: box.backingHeight,
				clip,
				nonUniformRatio: measured.nonUniformRatio,
				distinctColours: measured.distinctColours,
				sha256: measured.sha256,
				settledAfter: capture,
				focusLabel: box.focusLabel
			};
		}
		previousSha = measured.sha256;
		await sleep(400);
	}
	throw new Error(
		`The Workspace canvas never repeated a frame ${requiredAgreements} times within ${maximumCaptures} captures; it is still moving.`
	);
}

// --- the delivered file -----------------------------------------------------

function ffprobeBinary(): string {
	const ffmpeg = process.env.FFMPEG_PATH;
	if (ffmpeg && ffmpeg.endsWith('ffmpeg')) return `${ffmpeg.slice(0, -'ffmpeg'.length)}ffprobe`;
	return process.env.FFPROBE_PATH ?? 'ffprobe';
}

/** What the delivered container actually holds, read back off the file. */
interface DeliveredMediaStreams {
	videoCodec: string | null;
	pixelFormat: string | null;
	width: number | null;
	height: number | null;
	frameRate: string | null;
	decodedFrameCount: number | null;
	audioCodec: string | null;
	audioChannels: number | null;
	durationSeconds: number | null;
}

async function readDeliveredMediaStreams(path: string): Promise<DeliveredMediaStreams> {
	const { stdout: videoStdout } = await execFileAsync(ffprobeBinary(), [
		'-hide_banner',
		'-loglevel',
		'error',
		'-select_streams',
		'v:0',
		'-count_frames',
		'-show_streams',
		'-show_format',
		'-of',
		'json',
		path
	]);
	const videoDocument = JSON.parse(videoStdout) as {
		streams?: {
			codec_name?: string;
			pix_fmt?: string;
			width?: number;
			height?: number;
			avg_frame_rate?: string;
			nb_read_frames?: string;
		}[];
		format?: { duration?: string };
	};
	const video = videoDocument.streams?.[0];

	const { stdout: audioStdout } = await execFileAsync(ffprobeBinary(), [
		'-hide_banner',
		'-loglevel',
		'error',
		'-select_streams',
		'a:0',
		'-show_streams',
		'-of',
		'json',
		path
	]);
	const audio = (
		JSON.parse(audioStdout) as { streams?: { codec_name?: string; channels?: number }[] }
	).streams?.[0];

	const decodedFrames = Number.parseInt(video?.nb_read_frames ?? '', 10);
	return {
		videoCodec: video?.codec_name ?? null,
		pixelFormat: video?.pix_fmt ?? null,
		width: video?.width ?? null,
		height: video?.height ?? null,
		frameRate: video?.avg_frame_rate ?? null,
		decodedFrameCount: Number.isFinite(decodedFrames) ? decodedFrames : null,
		audioCodec: audio?.codec_name ?? null,
		audioChannels: audio?.channels ?? null,
		durationSeconds: videoDocument.format?.duration ? Number(videoDocument.format.duration) : null
	};
}

/** What the delivered file turned out to be once it was decoded back to frames. */
interface DecodedDelivery {
	exitStatus: number | null;
	/** At least one sampled pair of frames differs: the file is a moving picture. */
	animates: boolean;
	/** Frames carry real transparency, which is what the overlay lane is for. */
	carriesAlpha: boolean;
	report: unknown;
}

/**
 * Decode the delivered file back to RGBA frames with the existing decode probe.
 * Delegated rather than restated: `probe-export-decode.ts` already owns what a
 * real export looks like frame to frame, including the VP9 alpha decoder a
 * transparent WebM needs, and reading its measurements here is what makes this a
 * statement about the file the agent actually received.
 *
 * The scenario asks that probe for two things: does the file move, and is it in
 * the alpha state its own output class declares. It does not adopt the probe's
 * whole verdict for the WebM lane, because that verdict also judges the RGB left
 * under fully transparent pixels — a bounded VP9 chroma artifact that
 * `pnpm verify:export-decode:public-matrix` deliberately ignores, and that a
 * scenario about authoring is the wrong place to re-litigate. The measurement is
 * kept in the evidence either way.
 */
function decodeDeliveredFile(path: string, isOpaque: boolean): DecodedDelivery {
	const decoded = spawnSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--no-warnings',
			join(repoRoot, 'scripts/probe-export-decode.ts'),
			path,
			'--frames',
			String(DECODED_FRAME_SAMPLE),
			...(isOpaque ? ['--opaque'] : [])
		],
		{ cwd: repoRoot, encoding: 'utf8' }
	);
	let report: unknown = decoded.stdout?.trim() ?? '';
	try {
		report = JSON.parse(decoded.stdout ?? '');
	} catch {
		// The probe printed something that is not JSON; keep it verbatim.
	}
	if (decoded.status !== 0) console.error(decoded.stderr?.slice(-2000) ?? '');
	const measured = (typeof report === 'object' && report !== null ? report : {}) as {
		changed_pairs?: number;
		has_alpha?: boolean;
		is_opaque?: boolean;
	};
	return {
		exitStatus: decoded.status,
		animates: (measured.changed_pairs ?? 0) > 0,
		carriesAlpha: measured.has_alpha === true && measured.is_opaque === false,
		report
	};
}

/** Files the browser has finished writing into the download directory. */
async function listDownloads(directory: string): Promise<Map<string, number>> {
	const files = new Map<string, number>();
	for (const name of await readdir(directory)) {
		if (name.endsWith('.crdownload')) continue;
		files.set(name, (await stat(join(directory, name))).size);
	}
	return files;
}

/**
 * The file this lane added, once the browser finished writing it: no partial
 * file left, and a size that has stopped moving. A lane that produces none
 * answers null, which is the whole point of the refused and cancelled lanes.
 */
async function awaitNewDownload(
	directory: string,
	before: ReadonlySet<string>,
	timeoutMs: number
): Promise<{ name: string; bytes: number } | null> {
	const deadline = Date.now() + timeoutMs;
	let lastSeen: { name: string; bytes: number } | null = null;
	while (Date.now() < deadline) {
		const names = await readdir(directory);
		const isStillWriting = names.some((name) => name.endsWith('.crdownload'));
		const added = [...(await listDownloads(directory))].filter(([name]) => !before.has(name));
		if (!isStillWriting && added.length > 0) {
			const [name, bytes] = added[0];
			if (lastSeen !== null && lastSeen.name === name && lastSeen.bytes === bytes) {
				return lastSeen;
			}
			lastSeen = { name, bytes };
		}
		await sleep(500);
	}
	return lastSeen;
}

// --- preconditions ----------------------------------------------------------

function launchSanctionedChrome(port: number, mode: 'agent' | 'standard'): void {
	const launched = spawnSync('scripts/launch-cdp-chrome.sh', [], {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: 'inherit',
		env: { ...process.env, CDP_PORT: String(port), CDP_BROWSER_MODE: mode }
	});
	if (launched.status !== 0) {
		throw new Error(`The sanctioned Chrome would not start on CDP port ${port} in ${mode} mode.`);
	}
}

/**
 * Confirm a build is answering, and record which one. The release seal binds
 * every acceptance claim to one commit, so a scenario that cannot name the build
 * it authored against produces receipts, captures and exports the seal has to
 * reject rather than trust.
 */
async function readAnsweringOriginRelease(): Promise<string> {
	const response = await fetch(`${ORIGIN}/api/health`).catch(() => null);
	if (!response || response.status !== 200) {
		throw new Error(
			`No build is answering at ${ORIGIN}; serve one, or point GFX_SCENARIO_ORIGIN at the origin to measure.`
		);
	}
	const body = (await response.json()) as { release?: unknown };
	if (typeof body.release !== 'string') {
		throw new Error(`The build at ${ORIGIN} answers /api/health without naming its release.`);
	}
	return body.release;
}

// --- the run ----------------------------------------------------------------

const release = await readAnsweringOriginRelease();
launchSanctionedChrome(COMBINED_AGENT_PORT, 'agent');

const downloadDirectory = await mkdtemp(join(tmpdir(), 'gfx-authoring-scenario-'));
const evidence: Record<string, unknown> = {
	schemaVersion: 1,
	measuredAt: new Date().toISOString(),
	probe: 'gfx-authoring-scenario',
	origin: ORIGIN,
	release
};
const negatives: Record<string, unknown> = {};

const page = await openScenarioPage(COMBINED_AGENT_PORT);
await page.send('Browser.setDownloadBehavior', {
	behavior: 'allow',
	downloadPath: downloadDirectory,
	eventsEnabled: true
});

try {
	// --- the browser an agent attaches to -----------------------------------
	startPhase('harness');
	await page.navigate(`${ORIGIN}/`);
	await awaitRegisteredOperations(page, ALWAYS_REGISTERED_OPERATION_IDS);
	const capabilities = await page.evaluate<{
		modelContext: boolean;
		secureContext: boolean;
		canvasDrawElement: boolean;
	}>(`({
		modelContext: typeof document.modelContext === 'object',
		secureContext: isSecureContext,
		canvasDrawElement:
			typeof GPUQueue === 'function' && 'copyElementImageToTexture' in GPUQueue.prototype
	})`);
	// Which Chrome drew these pixels and encoded these files. The captures and
	// exports below are only comparable against a run on the same browser build.
	const version = (await (
		await fetch(`http://localhost:${COMBINED_AGENT_PORT}/json/version`)
	).json()) as Record<string, string>;
	const harness = { browser: version.Browser, ...capabilities };
	evidence.harness = harness;
	expect(
		'the-scenario-runs-in-the-combined-flag-agent-browser',
		harness.modelContext && harness.secureContext && harness.canvasDrawElement,
		JSON.stringify(harness)
	);

	// --- what the agent can find out before it decides anything -------------
	startPhase('capability-inspection');
	const vocabulary: Record<string, unknown> = {};
	for (const section of [
		'surface-type',
		'overlay-type',
		'pack-slug',
		'sound-asset',
		'operation-error-code'
	]) {
		const read = await callWebmcpOperation(page, 'capability.inspect-vocabulary', { section });
		vocabulary[section] = read.payload.members;
		expect(
			`the-${section}-vocabulary-comes-back-from-the-live-registry`,
			!read.isError &&
				Array.isArray(read.payload.members) &&
				(read.payload.members as unknown[]).length > 0 &&
				read.characterCount <= WEBMCP_RESULT_CHARACTER_BUDGET,
			JSON.stringify(read.payload).slice(0, 240)
		);
	}
	const limits = await callWebmcpOperation(page, 'capability.inspect-limits');
	evidence.capability = { vocabulary, limits: limits.payload };
	const advertisedTransport = limits.payload.transport as
		{ maxDurationSeconds?: number } | undefined;
	const advertisedStorage = limits.payload.sessionStorage as
		{ maxCompositionBytes?: number } | undefined;
	// The origin serves the envelope of its runtime profile (ADR-0068 §9): the
	// Film-length one on a development host, the public one otherwise. Either is
	// ratified; anything else is an envelope nobody declared.
	const advertisedEnvelope =
		[PUBLIC_EXPORT_RUNTIME_LIMITS, DEVELOPMENT_EXPORT_RUNTIME_LIMITS].find(
			(limits) => limits.maxDurationSeconds === advertisedTransport?.maxDurationSeconds
		) ?? null;
	expect(
		'the-limits-an-agent-is-told-about-are-the-ratified-ones',
		advertisedEnvelope !== null &&
			advertisedStorage?.maxCompositionBytes ===
				PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxCompositionBytes,
		JSON.stringify(limits.payload)
	);

	// --- creation ------------------------------------------------------------
	startPhase('creation');
	// `session.clear` is registered only while the session holds something, so a
	// browser that has never run this scenario offers no tool to clear with. The
	// run starts empty either way; asking first is what makes both starts equal.
	const openingSession = await callWebmcpOperation(page, 'session.inspect');
	if (openingSession.payload.total !== 0) {
		await callWebmcpOperation(page, 'session.clear', { confirmed: true });
	}
	const emptySession = await callWebmcpOperation(page, 'session.inspect');
	expect(
		'the-run-starts-from-an-empty-browser-session',
		!emptySession.isError && emptySession.payload.total === 0,
		JSON.stringify(emptySession.payload).slice(0, 240)
	);

	const created = await callWebmcpOperation(page, 'composition.create-blank');
	const slug = String(created.payload.slug ?? '');
	observedRevision = readReceiptRevision(created);
	expect(
		'a-blank-composition-is-created-and-named',
		!created.isError && slug.length > 0 && observedRevision === 0,
		JSON.stringify(created.payload).slice(0, 240)
	);

	// The visitor opens the Workspace; every act after this one is the agent's.
	await page.navigate(`${ORIGIN}/p/${slug}`);
	await waitInPage<boolean>(page, WORKSPACE_READY, (ready) => ready, 'the Workspace canvas');
	const workspaceTools = await awaitRegisteredOperations(page, [
		'composition.inspect',
		'layer.add-overlay',
		'playhead.seek-frame',
		'validation.inspect-findings',
		'delivery.export-video'
	]);
	evidence.workspaceRegistration = { slug, registered: [...workspaceTools].sort() };

	const opened = await callWebmcpOperation(page, 'composition.inspect');
	observedRevision = readReceiptRevision(opened);
	expect(
		'the-composition-the-agent-created-is-the-one-on-screen',
		!opened.isError && opened.payload.slug === slug,
		JSON.stringify(opened.payload).slice(0, 240)
	);
	await applyWebmcpEdit(page, 'composition.set-identity', {
		name: 'Signal to noise',
		description: 'The live create-to-export scenario piece.',
		kind: 'deliverable'
	});

	// --- structure, content, geometry ---------------------------------------
	startPhase('structure-and-content');
	const emptyFrame = await captureSettledWorkspaceFrame(page);
	// The piece stays on the plain Surface on purpose: a transparent overlay is
	// what the WebM lane is for, and a Surface that fills the frame would deliver
	// a file with no transparent pixel in it to verify.
	await applyWebmcpEdit(page, 'content.set-surface-content', {
		body: 'A [underline]measured[/underline] look at what the numbers actually say.'
	});
	const addedOverlay = await applyWebmcpEdit(page, 'layer.add-overlay', {
		overlayType: 'lower-third'
	});
	const overlayId = String(
		(addedOverlay.payload.focus as { overlayId?: string } | undefined)?.overlayId ?? ''
	);
	expect(
		'adding-an-overlay-returns-its-id-and-focuses-it',
		overlayId.length > 0,
		JSON.stringify(addedOverlay.payload).slice(0, 240)
	);
	await applyWebmcpEdit(page, 'content.set-overlay-content', {
		overlayId,
		content: JSON.stringify({ title: 'Dr. Ada Okafor', subtitle: 'Systems ecologist' })
	});
	await applyWebmcpEdit(page, 'placement.set-overlay-placement', {
		overlayId,
		target: 'shared',
		placement: { anchor: 'bottom-left', offset: { x: 0.08, y: 0.12 } }
	});

	// Structure comes off as easily as it goes on.
	const addedWatermark = await applyWebmcpEdit(page, 'layer.add-overlay', {
		overlayType: 'watermark'
	});
	const removed = await applyWebmcpEdit(page, 'layer.remove-overlay', {
		overlayId: String(
			(addedWatermark.payload.focus as { overlayId?: string } | undefined)?.overlayId ?? ''
		)
	});
	const authoredFrame = await captureSettledWorkspaceFrame(page);
	evidence.authoring = {
		overlayId,
		emptyFrame,
		authoredFrame,
		removedOverlay: removed.payload.changed
	};
	expect(
		'the-authored-composition-puts-real-ink-on-the-visible-canvas',
		authoredFrame.nonUniformRatio > MINIMUM_NON_UNIFORM_RATIO &&
			authoredFrame.distinctColours > MINIMUM_DISTINCT_COLOURS &&
			authoredFrame.sha256 !== emptyFrame.sha256,
		JSON.stringify(authoredFrame)
	);
	expect(
		'the-workspace-focus-follows-the-entity-the-agent-touched',
		authoredFrame.focusLabel !== null && authoredFrame.focusLabel.length > 0,
		`the Inspector reads ${JSON.stringify(authoredFrame.focusLabel)}`
	);

	// --- art direction -------------------------------------------------------
	startPhase('design');
	const beforePack = await captureSettledWorkspaceFrame(page);
	await applyWebmcpEdit(page, 'appearance.set-pack', { packSlug: 'editorial-mono' });
	const afterPack = await captureSettledWorkspaceFrame(page);
	expect(
		're-dressing-the-piece-in-another-pack-changes-what-is-on-screen',
		afterPack.sha256 !== beforePack.sha256 && afterPack.nonUniformRatio > MINIMUM_NON_UNIFORM_RATIO,
		`${beforePack.sha256.slice(0, 12)} then ${afterPack.sha256.slice(0, 12)}`
	);

	await applyWebmcpEdit(page, 'transport.set-orientation', { orientation: 'vertical' });
	const vertical = await captureSettledWorkspaceFrame(page);
	await applyWebmcpEdit(page, 'transport.set-orientation', { orientation: 'horizontal' });
	const horizontal = await captureSettledWorkspaceFrame(page);
	evidence.design = { beforePack, afterPack, vertical, horizontal };
	expect(
		'the-same-piece-reflows-between-both-native-targets',
		vertical.backingWidth === NATIVE_BACKING_SIZES.vertical[0] &&
			vertical.backingHeight === NATIVE_BACKING_SIZES.vertical[1] &&
			horizontal.backingWidth === NATIVE_BACKING_SIZES.horizontal[0] &&
			horizontal.backingHeight === NATIVE_BACKING_SIZES.horizontal[1],
		`${vertical.backingWidth}x${vertical.backingHeight} then ${horizontal.backingWidth}x${horizontal.backingHeight}`
	);
	expect(
		'the-vertical-cut-renders-rather-than-clamping-to-nothing',
		vertical.nonUniformRatio > MINIMUM_NON_UNIFORM_RATIO &&
			vertical.distinctColours > MINIMUM_DISTINCT_COLOURS,
		JSON.stringify(vertical)
	);

	// --- motion and sound ----------------------------------------------------
	startPhase('motion-and-sound');
	await applyWebmcpEdit(page, 'transport.set-timing', {
		durationSeconds: SCENARIO_DURATION_SECONDS,
		fps: SCENARIO_FPS
	});
	await applyWebmcpEdit(page, 'motion.set-surface-timing', {
		enter: { start: 0, duration: 0.18, ease: 'settled' }
	});
	await applyWebmcpEdit(page, 'motion.set-overlay-timing', {
		overlayId,
		enter: { start: 0.2, duration: 0.16, ease: 'smooth' },
		exit: { start: 0.86, duration: 0.14, ease: 'sharp' }
	});
	const cue = await applyWebmcpEdit(page, 'sound.set-cue', {
		assetSlug: 'foley-glide',
		start: 0.2,
		duration: 0.3,
		volume: 0.6
	});
	const motionOverride = await applyWebmcpEdit(page, 'sound.set-motion-override', {
		motion: { kind: 'overlay', phase: 'enter', overlayId },
		override: { event: 'whoosh-in' }
	});
	evidence.motionAndSound = { cue: cue.payload, motionOverride: motionOverride.payload };

	// --- seeking to exact frames --------------------------------------------
	startPhase('seek-and-compare');
	const playhead = await callWebmcpOperation(page, 'playhead.inspect');
	expect(
		'the-timeline-reports-the-frame-count-the-transport-was-set-to',
		playhead.payload.frameCount === SCENARIO_FRAME_COUNT && playhead.payload.fps === SCENARIO_FPS,
		JSON.stringify(playhead.payload)
	);

	await callWebmcpOperation(page, 'playhead.seek-frame', { frame: COMPARED_FRAME });
	const firstVisit = await captureSettledWorkspaceFrame(page);
	await callWebmcpOperation(page, 'playhead.seek-frame', { frame: OTHER_FRAME });
	const elsewhere = await captureSettledWorkspaceFrame(page);
	const returned = await callWebmcpOperation(page, 'playhead.seek-frame', {
		frame: COMPARED_FRAME
	});
	const secondVisit = await captureSettledWorkspaceFrame(page);
	evidence.seek = {
		comparedFrame: COMPARED_FRAME,
		otherFrame: OTHER_FRAME,
		firstVisit,
		elsewhere,
		secondVisit,
		receipt: returned.payload
	};
	expect(
		'two-different-frames-of-the-piece-look-different',
		firstVisit.sha256 !== elsewhere.sha256,
		`frames ${COMPARED_FRAME} and ${OTHER_FRAME} both render ${firstVisit.sha256.slice(0, 12)}`
	);
	expect(
		'seeking-back-to-a-frame-shows-that-frame-again',
		firstVisit.sha256 === secondVisit.sha256,
		`${firstVisit.sha256.slice(0, 12)} then ${secondVisit.sha256.slice(0, 12)}`
	);
	expect(
		'a-seek-moves-the-playhead-without-taking-a-revision',
		returned.payload.revision === observedRevision && returned.payload.frame === COMPARED_FRAME,
		JSON.stringify(returned.payload)
	);

	// --- validation and repair ----------------------------------------------
	startPhase('validation-repair');
	const broke = await applyWebmcpEdit(page, 'placement.set-overlay-placement', {
		overlayId,
		target: 'shared',
		placement: { anchor: 'normalized-rect', rect: { x: -0.4, y: -0.3, width: 0.5, height: 0.2 } }
	});
	const appeared = broke.payload.findingsAppeared as { total?: number } | undefined;
	const findings = await callWebmcpOperation(page, 'validation.inspect-findings');
	const lint = findings.payload.lint as
		| { findings?: { rule?: string | null; path?: string; message?: string }[]; total?: number }
		| undefined;
	expect(
		'a-placement-outside-the-safe-area-is-reported-against-the-field-that-holds-it',
		(appeared?.total ?? 0) > 0 &&
			(lint?.total ?? 0) > 0 &&
			(lint?.findings ?? []).some((finding) => finding.path?.includes('position')),
		JSON.stringify({ appeared, lint }).slice(0, 400)
	);

	const repaired = await applyWebmcpEdit(page, 'placement.set-overlay-placement', {
		overlayId,
		target: 'shared',
		placement: { anchor: 'bottom-left', offset: { x: 0.08, y: 0.12 } }
	});
	const cleared = repaired.payload.findingsCleared as
		{ findings?: { rule?: string | null; path?: string }[]; total?: number } | undefined;
	const afterRepair = await callWebmcpOperation(page, 'validation.inspect-findings');
	const remaining = afterRepair.payload.lint as
		| { findings?: { rule?: string | null; path?: string; message?: string }[]; total?: number }
		| undefined;
	evidence.validationRepair = { appeared, reported: lint, cleared, remaining };
	// The repaired finding has to be gone; the rest of the list is not this
	// check's business. Static-linter findings are advisory (ADR-0025), and a
	// two-second piece legitimately holds one — its Overlay is on screen for
	// less time than a reader needs — which is a taste call the scenario records
	// rather than a defect it repairs.
	expect(
		'the-repair-the-finding-named-clears-it',
		(cleared?.findings ?? []).some((finding) => finding.path?.includes('position')) &&
			!(remaining?.findings ?? []).some((finding) => finding.path?.includes('position')),
		JSON.stringify({ cleared, remaining })
	);

	// --- revisions, undo, redo ----------------------------------------------
	startPhase('undo-and-redo');
	await callWebmcpOperation(page, 'playhead.seek-frame', { frame: COMPARED_FRAME });
	const beforeEdit = await captureSettledWorkspaceFrame(page);
	const revisionBeforeEdit = observedRevision;
	await applyWebmcpEdit(page, 'appearance.set-pack', { packSlug: 'crt-terminal' });
	const afterEdit = await captureSettledWorkspaceFrame(page);
	const undone = await callWebmcpOperation(page, 'composition.undo', {
		expectedRevision: observedRevision
	});
	observedRevision = readReceiptRevision(undone);
	const afterUndo = await captureSettledWorkspaceFrame(page);
	const undonePack = (await callWebmcpOperation(page, 'composition.inspect')).payload.pack;
	const redone = await callWebmcpOperation(page, 'composition.redo', {
		expectedRevision: observedRevision
	});
	observedRevision = readReceiptRevision(redone);
	const afterRedo = await captureSettledWorkspaceFrame(page);
	const redonePack = (await callWebmcpOperation(page, 'composition.inspect')).payload.pack;
	evidence.history = {
		revisionBeforeEdit,
		revisionAfterRedo: observedRevision,
		beforeEdit,
		afterEdit,
		afterUndo,
		afterRedo,
		undonePack,
		redonePack
	};
	expect(
		'an-edit-and-its-undo-and-its-redo-each-take-the-revision-forward',
		!undone.isError &&
			!redone.isError &&
			observedRevision === revisionBeforeEdit + 3 &&
			undonePack === 'editorial-mono' &&
			redonePack === 'crt-terminal',
		JSON.stringify({ revisionBeforeEdit, observedRevision, undonePack, redonePack })
	);
	expect(
		'undo-and-redo-move-what-the-workspace-is-showing',
		afterEdit.sha256 !== beforeEdit.sha256 &&
			afterUndo.sha256 === beforeEdit.sha256 &&
			afterRedo.sha256 === afterEdit.sha256,
		JSON.stringify({
			beforeEdit: beforeEdit.sha256.slice(0, 12),
			afterEdit: afterEdit.sha256.slice(0, 12),
			afterUndo: afterUndo.sha256.slice(0, 12),
			afterRedo: afterRedo.sha256.slice(0, 12)
		})
	);
	// Leave the piece in the Pack it was art-directed into.
	await applyWebmcpEdit(page, 'appearance.set-pack', { packSlug: 'editorial-mono' });

	// --- the refusals a careless or unlucky agent meets while authoring ------
	// Taken here, with the Workspace quiet, so "nothing was applied" can be read
	// off the screen as well as off the receipt.
	startPhase('negative-invalid-argument');
	const badEnum = await callWebmcpOperation(page, 'transport.set-orientation', {
		expectedRevision: observedRevision,
		orientation: 'diagonal'
	});
	const missingArgument = await callWebmcpOperation(page, 'composition.undo');
	negatives.unsupportedVariant = badEnum.payload;
	negatives.missingArgument = missingArgument.payload;
	expect(
		'a-value-outside-the-registered-vocabulary-is-refused-with-the-values-that-work',
		badEnum.isError &&
			badEnum.payload.code === 'unsupported_variant' &&
			Array.isArray(badEnum.payload.alternatives) &&
			(badEnum.payload.alternatives as unknown[]).includes('vertical'),
		JSON.stringify(badEnum.payload).slice(0, 300)
	);
	expect(
		'an-edit-that-names-no-observed-revision-is-refused-and-says-what-to-supply',
		missingArgument.isError && missingArgument.payload.code === 'invalid_argument',
		JSON.stringify(missingArgument.payload).slice(0, 300)
	);

	startPhase('negative-stale-revision');
	const beforeStale = await captureSettledWorkspaceFrame(page);
	const stale = await callWebmcpOperation(page, 'appearance.set-pack', {
		expectedRevision: observedRevision + 7,
		packSlug: 'clean-light'
	});
	const afterStale = await captureSettledWorkspaceFrame(page);
	const packAfterStale = (await callWebmcpOperation(page, 'composition.inspect')).payload.pack;
	negatives.staleRevision = { receipt: stale.payload, packAfterStale, beforeStale, afterStale };
	expect(
		'a-write-against-a-revision-the-composition-never-had-applies-nothing',
		stale.isError &&
			stale.payload.code === 'stale_revision' &&
			stale.payload.revision === observedRevision &&
			packAfterStale === 'editorial-mono' &&
			afterStale.sha256 === beforeStale.sha256,
		JSON.stringify({ receipt: stale.payload, packAfterStale }).slice(0, 300)
	);

	// --- the Media library the piece may draw on -----------------------------
	startPhase('media');
	const library = await callWebmcpOperation(page, 'media.inspect-library');
	evidence.media = library.payload;
	expect(
		'the-media-library-answers-for-the-open-composition',
		!library.isError,
		JSON.stringify(library.payload).slice(0, 240)
	);

	// --- both delivery lanes -------------------------------------------------
	startPhase('export');
	const deliveries: Record<string, unknown>[] = [];
	for (const lane of [
		{ name: 'transparent-webm', format: 'webm', backgroundFill: null, isOpaque: false },
		{ name: 'full-frame-prores', format: 'prores', backgroundFill: '#0c0c0e', isOpaque: true }
	] as const) {
		await applyWebmcpEdit(page, 'transport.set-format', { format: lane.format });
		await applyWebmcpEdit(
			page,
			'transport.set-background',
			lane.backgroundFill === null ? {} : { fill: lane.backgroundFill }
		);
		const classified = await callWebmcpOperation(page, 'composition.inspect');
		expect(
			`the-${lane.name}-lane-classifies-its-own-output`,
			classified.payload.outputClass === (lane.isOpaque ? 'full-frame' : 'transparent-overlay'),
			`the composition reports ${String(classified.payload.outputClass)}`
		);

		const before = new Set((await listDownloads(downloadDirectory)).keys());
		const delivered = await callWebmcpOperation(page, 'delivery.export-video', {
			expectedRevision: observedRevision
		});
		const download = await awaitNewDownload(downloadDirectory, before, DOWNLOAD_TIMEOUT_MS);
		const receipt = delivered.payload;
		expect(
			`the-${lane.name}-lane-delivers-a-file-the-browser-received`,
			!delivered.isError &&
				receipt.status === 'delivered' &&
				download !== null &&
				download.name === receipt.videoFilename &&
				download.bytes === receipt.videoByteLength,
			JSON.stringify({ receipt, download }).slice(0, 400)
		);
		if (download === null) {
			deliveries.push({ lane: lane.name, receipt, download: null });
			continue;
		}

		const deliveredPath = join(downloadDirectory, download.name);
		const streams = await readDeliveredMediaStreams(deliveredPath);
		const decoded = decodeDeliveredFile(deliveredPath, lane.isOpaque);
		deliveries.push({ lane: lane.name, receipt, download, streams, decoded });
		expect(
			`the-${lane.name}-file-decodes-at-the-native-target-the-receipt-claims`,
			streams.width === receipt.width &&
				streams.height === receipt.height &&
				streams.width === NATIVE_BACKING_SIZES.horizontal[0] &&
				streams.height === NATIVE_BACKING_SIZES.horizontal[1] &&
				streams.decodedFrameCount === receipt.frameCount,
			JSON.stringify(streams)
		);
		expect(
			`the-${lane.name}-file-runs-at-the-cadence-the-receipt-claims`,
			streams.frameRate === `${SCENARIO_FPS}/1`,
			`the container reports ${String(streams.frameRate)}`
		);
		// A VP9 alpha lane declares `yuv420p` and carries its alpha as WebM side
		// data, so the pixel format is only a statement about the ProRes lane —
		// whether the WebM really carries alpha is a question for the decode below.
		expect(
			`the-${lane.name}-file-is-encoded-in-the-codec-its-receipt-names`,
			streams.videoCodec === (lane.isOpaque ? 'prores' : 'vp9') &&
				(!lane.isOpaque || streams.pixelFormat === 'yuva444p12le'),
			`${String(streams.videoCodec)} / ${String(streams.pixelFormat)} for ${String(receipt.codec)}`
		);
		expect(
			`the-${lane.name}-file-carries-the-sound-the-piece-was-given`,
			receipt.wavFilename === null && streams.audioCodec !== null,
			`wav sidecar ${String(receipt.wavFilename)}, audio stream ${String(streams.audioCodec)}`
		);
		expect(
			`the-${lane.name}-file-decodes-to-frames-that-animate-in-its-own-output-class`,
			decoded.animates && decoded.carriesAlpha === !lane.isOpaque,
			JSON.stringify(decoded.report).slice(0, 400)
		);
	}
	evidence.deliveries = deliveries;

	// The per-composition ceiling belongs to the browser-scoped session store the
	// public profile configures (ADR-0053). A development origin that keeps
	// compositions on its own disk has no such ceiling and reports no quota, so
	// this refusal is asked for only where it exists — and importing an oversize
	// document into a store that would accept it would replace the piece this run
	// is still working on.
	startPhase('negative-session-storage');
	const sessionStore = (await callWebmcpOperation(page, 'session.inspect')).payload.storage as
		{ quotaBytes?: number | null } | undefined;
	const isBrowserScopedStore = typeof sessionStore?.quotaBytes === 'number';
	if (isBrowserScopedStore) {
		const serialized = await callWebmcpOperation(page, 'composition.export-json');
		const oversize = JSON.stringify({
			...(JSON.parse(String(serialized.payload.json ?? '{}')) as Record<string, unknown>),
			slug: 'oversize-import',
			name: 'Oversize import',
			description: 'x'.repeat(PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxCompositionBytes + 4096)
		});
		const refusedImport = await callWebmcpOperation(page, 'composition.import-json', {
			document: oversize
		});
		negatives.sessionStorage = {
			store: sessionStore,
			requestedBytes: oversize.length,
			receipt: refusedImport.payload
		};
		expect(
			'a-composition-larger-than-one-session-record-is-refused-with-the-ceiling-it-missed',
			refusedImport.isError &&
				refusedImport.payload.code === 'limit_exceeded' &&
				String(refusedImport.payload.message).includes(
					String(PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxCompositionBytes)
				),
			JSON.stringify(refusedImport.payload).slice(0, 400)
		);
	} else {
		negatives.sessionStorage = {
			store: sessionStore,
			skipped:
				'This origin does not hold compositions in the browser, so it declares no per-composition ceiling to refuse against.'
		};
		console.log('skip a-composition-larger-than-one-session-record-is-refused: no browser store');
	}

	// The transport family will author a piece past the export envelope — the
	// envelope belongs to the operation that ships the file, and that is where
	// the corrective refusal has to arrive.
	startPhase('negative-export-envelope');
	// A development host's envelope reaches the transport schema's own ceilings,
	// so no composition the schema admits is past it and there is nothing to
	// refuse. The negative runs wherever the served envelope is the shorter one.
	const servedEnvelope = advertisedEnvelope ?? PUBLIC_EXPORT_RUNTIME_LIMITS;
	const overEnvelopeDurationSeconds = servedEnvelope.maxDurationSeconds + 5;
	if (overEnvelopeDurationSeconds <= TRANSPORT_SCHEMA_MAX_DURATION_SECONDS) {
		await applyWebmcpEdit(page, 'transport.set-timing', {
			durationSeconds: overEnvelopeDurationSeconds
		});
		const beforeRefusedExport = new Set((await listDownloads(downloadDirectory)).keys());
		const overEnvelope = await callWebmcpOperation(page, 'delivery.export-video', {
			expectedRevision: observedRevision
		});
		const refusedDownload = await awaitNewDownload(
			downloadDirectory,
			beforeRefusedExport,
			NO_DOWNLOAD_TIMEOUT_MS
		);
		negatives.exportEnvelope = overEnvelope.payload;
		expect(
			'an-export-past-the-served-envelope-is-refused-with-the-bound-it-missed',
			overEnvelope.isError &&
				overEnvelope.payload.code === 'export_failed' &&
				[String(servedEnvelope.maxFrameCount), String(servedEnvelope.maxDurationSeconds)].some(
					(bound) => String(overEnvelope.payload.message).includes(bound)
				),
			JSON.stringify(overEnvelope.payload).slice(0, 400)
		);
		expect(
			'a-refused-export-hands-the-browser-no-file',
			refusedDownload === null,
			`the browser received ${JSON.stringify(refusedDownload)}`
		);
		await applyWebmcpEdit(page, 'transport.set-timing', {
			durationSeconds: SCENARIO_DURATION_SECONDS
		});
	} else {
		negatives.exportEnvelope = {
			maxDurationSeconds: servedEnvelope.maxDurationSeconds,
			skipped:
				'This origin admits every duration the transport schema allows, so no authorable composition is past its export envelope.'
		};
		console.log('skip an-export-past-the-served-envelope-is-refused: envelope covers the schema');
	}

	// --- the visitor who walks away mid-export -------------------------------
	// A route change ends every registration, and a call still in flight on one
	// answers `cancelled` rather than delivering a file for a page that has moved
	// on. The promise is held on the page so it survives the client-side
	// navigation that cancels it.
	startPhase('negative-cancelled-export');
	const beforeCancelled = new Set((await listDownloads(downloadDirectory)).keys());
	await page.evaluate<boolean>(`(() => {
		window.__gfxScenarioCancelledExport = (async () => {
			const tools = Array.from(await document.modelContext.getTools());
			const tool = tools.find((entry) => entry.name === ${JSON.stringify(toolNameFor('delivery.export-video'))});
			const raw = await document.modelContext.executeTool(
				tool,
				JSON.stringify({ expectedRevision: ${observedRevision} })
			);
			const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
			return JSON.parse(result.content[0].text);
		})();
		return true;
	})()`);
	await sleep(4000);
	await page.evaluate<boolean>(`(() => {
		const link = document.createElement('a');
		link.href = '/';
		document.body.appendChild(link);
		link.click();
		link.remove();
		return true;
	})()`);
	const cancelled = await page.evaluate<Record<string, unknown>>(
		`window.__gfxScenarioCancelledExport`
	);
	recordCall('delivery.export-video', {
		isError: true,
		characterCount: JSON.stringify(cancelled).length,
		payload: cancelled
	});
	const cancelledDownload = await awaitNewDownload(
		downloadDirectory,
		beforeCancelled,
		NO_DOWNLOAD_TIMEOUT_MS
	);
	negatives.cancelledExport = { receipt: cancelled, download: cancelledDownload };
	expect(
		'an-export-the-visitor-walks-away-from-is-cancelled-rather-than-delivered',
		cancelled.code === 'cancelled' && cancelled.status !== 'delivered',
		JSON.stringify(cancelled).slice(0, 300)
	);
	expect(
		'a-cancelled-export-hands-the-browser-no-file',
		cancelledDownload === null,
		`the browser received ${JSON.stringify(cancelledDownload)}`
	);

	// --- the capability gate an unflagged browser meets ----------------------
	// Since qju2qity there is no degraded lane: a browser without
	// CanvasDrawElement gets a full-screen notice naming the flag and the exact
	// launch command — no canvas, no approximation, and nothing to author.
	startPhase('capability-gate');
	launchSanctionedChrome(STANDARD_PORT, 'standard');
	const plainPage = await openScenarioPage(STANDARD_PORT);
	try {
		await plainPage.navigate(`${ORIGIN}/p/lower-third?source=builtin`);
		interface CapabilityGateReading {
			ready: boolean;
			noticeText: string;
			canvasCount: number;
		}
		const gate = await waitInPage<CapabilityGateReading>(
			plainPage,
			`(() => {
				const notice = document.querySelector('.capability-gate');
				return {
					ready: document.readyState === 'complete' && notice !== null,
					noticeText: notice?.textContent ?? '',
					canvasCount: document.querySelectorAll('canvas').length
				};
			})()`,
			(reading) => reading.ready,
			'the capability-gate notice in an unflagged browser'
		);
		const plainCapabilities = await plainPage.evaluate<{
			modelContext: boolean;
			canvasDrawElement: boolean;
		}>(`({
			modelContext: typeof document.modelContext === 'object',
			canvasDrawElement:
				typeof GPUQueue === 'function' && 'copyElementImageToTexture' in GPUQueue.prototype
		})`);
		evidence.capabilityGate = {
			capabilities: plainCapabilities,
			gate,
			runtimeFaults: [...plainPage.runtimeFaults],
			networkFaults: [...plainPage.networkFaults]
		};
		expect(
			'an-unflagged-browser-is-gated-with-the-flag-and-launch-command-not-an-approximation',
			!plainCapabilities.canvasDrawElement &&
				gate.canvasCount === 0 &&
				gate.noticeText.includes('CanvasDrawElement') &&
				gate.noticeText.includes('CDP_BROWSER_MODE=agent scripts/launch-cdp-chrome.sh'),
			JSON.stringify({ plainCapabilities, gate })
		);
		expect(
			'the-capability-gate-shows-without-an-unexplained-runtime-failure',
			plainPage.runtimeFaults.length === 0,
			plainPage.runtimeFaults.map((fault) => fault.detail).join(' | ')
		);
	} finally {
		await plainPage.close().catch(() => undefined);
	}

	// --- what the session keeps, and what it lets go -------------------------
	startPhase('cleanup');
	// Calling these at all is the proof that the route change left the tools it
	// did not make ineligible alone. It has to: the document never gives a tool
	// name back, so a registration ended on the way out of a route is a tool an
	// agent goes on seeing and can no longer call.
	const heldOperations = await awaitRegisteredOperations(page, [
		'session.inspect',
		'session.clear'
	]);
	evidence.registrationAfterRouteChange = { registered: [...heldOperations].sort() };
	const heldSession = await callWebmcpOperation(page, 'session.inspect');
	const heldEntries = (heldSession.payload.entries ?? []) as { slug?: string }[];
	expect(
		'the-authored-composition-outlives-the-route-change-that-cancelled-the-export',
		!heldSession.isError && heldEntries.some((entry) => entry.slug === slug),
		JSON.stringify(heldSession.payload).slice(0, 300)
	);

	// Leaving the route did not close the piece, and an open composition would
	// autosave itself back into a store cleared underneath it. The origin says so
	// and refuses rather than losing the visitor's work to a race.
	const refusedWhileOpen = await callWebmcpOperation(page, 'session.clear', { confirmed: true });
	expect(
		'clearing-the-session-under-the-open-piece-is-refused-and-names-the-piece',
		refusedWhileOpen.isError &&
			refusedWhileOpen.payload.code === 'precondition_unmet' &&
			refusedWhileOpen.payload.rejected === slug,
		JSON.stringify(refusedWhileOpen.payload).slice(0, 300)
	);

	// So the visitor does what the refusal asks: leaves the piece — a fresh load
	// of the home page opens nothing — and then clears.
	await page.navigate(`${ORIGIN}/`);
	await awaitRegisteredOperations(page, ['session.inspect', 'session.clear']);
	await callWebmcpOperation(page, 'session.clear', { confirmed: true });
	const clearedSession = await callWebmcpOperation(page, 'session.inspect');
	evidence.session = {
		held: heldSession.payload,
		refusedWhileOpen: refusedWhileOpen.payload,
		cleared: clearedSession.payload
	};
	expect(
		'clearing-the-browser-session-leaves-nothing-behind',
		!clearedSession.isError && clearedSession.payload.total === 0,
		JSON.stringify(clearedSession.payload).slice(0, 300)
	);
} catch (error) {
	// A scenario that could not finish is a failed scenario, not a lost one: the
	// evidence still has to say how far it got and where it stopped.
	expect(
		'the-scenario-runs-to-the-end',
		false,
		`${currentPhase}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
	);
} finally {
	evidence.negatives = negatives;
	evidence.runtimeFaults = [...page.runtimeFaults];
	evidence.networkFaults = [...page.networkFaults];
	await page.close().catch(() => undefined);
	await rm(downloadDirectory, { recursive: true, force: true });
}

// --- what the whole run proves ----------------------------------------------

/**
 * Every family an agent can reach had to be part of this scenario. Deriving that
 * requirement from the inventory rather than restating it is what makes a new
 * family a failing scenario instead of an untested one.
 */
const agentFamilies = new Set(
	WEBMCP_OPERATION_INVENTORY.filter((row) => row.exposure === 'agent-tool').map((row) => row.family)
);
const exercisedFamilies = new Set(
	[...exercisedOperationIds].map((operationId) => {
		const row = ROWS_BY_OPERATION_ID.get(operationId);
		if (!row) throw new Error(`No inventory row owns ${operationId}`);
		return row.family;
	})
);
const untouchedFamilies = [...agentFamilies].filter((family) => !exercisedFamilies.has(family));
expect(
	'the-scenario-reaches-every-operation-family-an-agent-can-reach',
	untouchedFamilies.length === 0,
	`no call was made in ${untouchedFamilies.join(', ')}`
);

/**
 * The requests this run is allowed to have left unfinished are the ones it broke
 * itself: the export it cancelled, the export session it asked the origin to
 * refuse, and every request the page superseded on its own.
 *
 * Two answers of 404 are the origin working rather than failing. `/favicon.ico`
 * is the browser's own probe on a fresh tab, not a request the demo made — the
 * page declares its icon in a `<link>`. And a poster is a cache keyed by the
 * composition's content, generated the first time that content is viewed, so a
 * piece this run authored a moment ago has none yet.
 */
const runtimeFaults = evidence.runtimeFaults as RuntimeFault[];
const networkFaults = evidence.networkFaults as NetworkFault[];
const unexpectedNetworkFaults = networkFaults.filter(
	(fault) =>
		!fault.isAborted &&
		!(
			(fault.phase === 'negative-cancelled-export' || fault.phase === 'negative-export-envelope') &&
			fault.url.includes('/api/export/')
		) &&
		!(fault.detail === 'status 404' && readFaultPathname(fault) === '/favicon.ico') &&
		!(fault.detail === 'status 404' && readFaultPathname(fault).startsWith('/api/posters/'))
);
const expectedRuntimeFaults = runtimeFaults.filter(isExpectedRuntimeFault);
const unexplainedRuntimeFaults = runtimeFaults.filter((fault) => !isExpectedRuntimeFault(fault));
evidence.expectedRuntimeFaults = expectedRuntimeFaults;
expect(
	'the-scenario-runs-without-an-unexplained-runtime-failure',
	unexplainedRuntimeFaults.length === 0,
	unexplainedRuntimeFaults.map((fault) => `${fault.phase}: ${fault.detail}`).join(' | ')
);
expect(
	'the-scenario-leaves-no-request-broken-that-it-did-not-break-on-purpose',
	unexpectedNetworkFaults.length === 0,
	unexpectedNetworkFaults.map((fault) => `${fault.phase}: ${fault.url} ${fault.detail}`).join(' | ')
);

evidence.calls = recordedCalls;
evidence.coverage = {
	operations: [...exercisedOperationIds].sort(),
	families: [...exercisedFamilies].sort(),
	agentFamilies: [...agentFamilies].sort()
};
evidence.failures = failures;
evidence.verified = failures.length === 0;

await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
const prettierConfig = (await resolveConfig(EVIDENCE_PATH)) ?? {};
await writeFile(
	EVIDENCE_PATH,
	await format(JSON.stringify(evidence), { ...prettierConfig, parser: 'json' })
);
console.log(`\nEvidence written to ${EVIDENCE_PATH}`);

if (failures.length > 0) {
	console.error(`\n${failures.length} scenario check(s) failed:`);
	for (const failure of failures) console.error(`  ${failure.check}: ${failure.detail}`);
	process.exitCode = 1;
} else {
	console.log(
		`\nThe scenario authored, art-directed, verified, and delivered one composition through ${exercisedOperationIds.size} WebMCP operations, and met every refusal it went looking for.`
	);
}
