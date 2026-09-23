/**
 * Can an attached agent find the right tool, and only the right tool?
 *
 * The contract tests beside this file prove each tool *works*. These evals prove
 * the tool surface is *choosable*: that the vocabulary a person uses to ask for
 * one authoring decision lands on exactly one tool, that the tool an agent needs
 * next appears in the state that makes it possible, that every inventory row an
 * agent may reach is actually reachable, and that the text an agent reads to
 * decide stays inside its budget
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md)
 * §2, §5, §6).
 *
 * The selection eval scores tool text, not a model. It reads a prompt in this
 * project's own domain language, scores every registered tool by how much of
 * that language its name and description carry, and requires the intended tool
 * to win outright. That is a measurement of whether the *text we wrote* is
 * discriminating — the failure it catches is a rename or a reworded description
 * that makes two tools equally plausible answers to one question, which is the
 * ambiguity a real agent resolves by guessing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The origin's User Pack store with one pack, so every pack tool has a state to be reached in.
vi.mock('./user-pack-store', async (importOriginal) => ({
	...(await importOriginal<typeof import('./user-pack-store')>()),
	userPackStore: {
		listUserPacks: vi.fn(async () => [
			{
				slug: 'my-brand',
				label: 'My brand',
				description: '',
				forkedFrom: 'clean-light',
				savedAt: '2026-09-01T12:00:00.000Z',
				contentHash: 'a'.repeat(64)
			}
		]),
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
	WEBMCP_FORBIDDEN_TOOL_NAME_FRAGMENTS,
	WEBMCP_OPERATION_FAMILIES,
	WEBMCP_OPERATION_INVENTORY,
	WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH,
	WEBMCP_TOOL_NAME_MAX_LENGTH
} from './webmcp-operation-inventory';
import { listWebmcpToolDefinitions } from './webmcp-tool-definitions';
import { userCompositionStore } from './user-composition-store';
import { WebmcpToolController } from './webmcp-tool-controller';

import type { UserCompositionMeta } from './user-composition-store';
import type {
	WebmcpModelContextHost,
	WebmcpToolCallResult,
	WebmcpToolDescriptor,
	WebmcpToolRegistrationOptions
} from './webmcp-tool-controller';
import type { WebmcpOperationFamilyName, WebmcpOperationRow } from './webmcp-operation-inventory';
import type { WebmcpCompositionPreconditions } from './webmcp-tool-preconditions';

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

	call(name: string, args: unknown): Promise<WebmcpToolCallResult> {
		const descriptor = this.#tools.get(name);
		if (!descriptor) throw new Error(`No registered tool named ${name}`);
		return descriptor.execute(args, { signal: new AbortController().signal });
	}

	describe(name: string): WebmcpToolDescriptor | undefined {
		return this.#tools.get(name);
	}
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

const AGENT_TOOL_ROWS = WEBMCP_OPERATION_INVENTORY.filter(
	(row) => row.exposure !== 'internal-only'
);
const INTERNAL_ONLY_ROWS = WEBMCP_OPERATION_INVENTORY.filter(
	(row) => row.exposure === 'internal-only'
);

/**
 * English function words that say nothing about which decision a prompt is
 * asking for. Everything else in a prompt is domain vocabulary and counts.
 */
const SELECTION_STOPWORDS = new Set([
	'a',
	'about',
	'after',
	'again',
	'all',
	'also',
	'am',
	'an',
	'and',
	'any',
	'are',
	'as',
	'at',
	'back',
	'be',
	'been',
	'before',
	'being',
	'but',
	'by',
	'can',
	'could',
	'did',
	'do',
	'does',
	'for',
	'from',
	'get',
	'go',
	'goes',
	'going',
	'got',
	'had',
	'has',
	'have',
	'he',
	'her',
	'here',
	'his',
	'how',
	'i',
	'if',
	'in',
	'into',
	'is',
	'it',
	'its',
	'just',
	'know',
	'let',
	'lets',
	'like',
	'made',
	'make',
	'may',
	'me',
	'might',
	'more',
	'must',
	'my',
	'need',
	'no',
	'not',
	'now',
	'of',
	'on',
	'only',
	'or',
	'out',
	'over',
	'please',
	'put',
	'shall',
	'she',
	'should',
	'so',
	'some',
	'still',
	'than',
	'that',
	'the',
	'their',
	'them',
	'then',
	'there',
	'these',
	'they',
	'this',
	'those',
	'to',
	'under',
	'up',
	'us',
	'use',
	'used',
	'very',
	'want',
	'was',
	'we',
	'were',
	'what',
	'when',
	'where',
	'which',
	'while',
	'who',
	'whom',
	'why',
	'will',
	'with',
	'without',
	'would',
	'yes',
	'you',
	'your'
]);

/**
 * How much more a term in the tool *name* counts than the same term buried in
 * the description. An agent reads a list of names and reaches for the
 * description to break a tie, so the name carries most of the signal.
 */
const SELECTION_NAME_TERM_WEIGHT = 3;

/** The domain words a prompt or a tool's own text is made of. */
function readSelectionTerms(text: string): ReadonlySet<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length > 1 && !SELECTION_STOPWORDS.has(word))
	);
}

/** How well one tool's own text answers a prompt. Each prompt term counts once. */
function scoreToolAgainstPrompt(row: WebmcpOperationRow, promptTerms: ReadonlySet<string>): number {
	const nameTerms = readSelectionTerms(row.toolName);
	const summaryTerms = readSelectionTerms(row.summary);
	let score = 0;
	for (const term of promptTerms) {
		if (nameTerms.has(term)) score += SELECTION_NAME_TERM_WEIGHT;
		else if (summaryTerms.has(term)) score += 1;
	}
	return score;
}

interface RankedTool {
	toolName: string;
	score: number;
}

/** Every agent-reachable tool, best answer first, ties broken by name for determinism. */
function rankToolsForPrompt(prompt: string): readonly RankedTool[] {
	const promptTerms = readSelectionTerms(prompt);
	return AGENT_TOOL_ROWS.map((row) => ({
		toolName: row.toolName,
		score: scoreToolAgainstPrompt(row, promptTerms)
	})).sort(
		(left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName)
	);
}

/**
 * One thing a person asks for, and the single tool that decides it. The prompts
 * are written in the project's own vocabulary — the language a person reading
 * the Workspace or an agent reading `gfx_capability_inspect_vocabulary` would
 * use — because that is the vocabulary the tool text has to be legible in.
 */
const AGENT_SELECTION_PROMPTS: readonly { prompt: string; toolName: string }[] = [
	{
		prompt: 'Inspect the User Pack store: which packs it holds and their contentHash revisions.',
		toolName: 'gfx_appearance_inspect_user_pack_store'
	},
	{
		prompt: 'Fork the clean-light built-in Pack into the store as a new editable User Pack.',
		toolName: 'gfx_appearance_fork_user_pack'
	},
	{
		prompt: 'Save these role and font changes to my User Pack against the contentHash I read.',
		toolName: 'gfx_appearance_save_user_pack'
	},
	{
		prompt: 'Delete the User Pack named sentry from the store; it can go to trash.',
		toolName: 'gfx_appearance_delete_user_pack'
	},
	{
		prompt:
			'Return the structural, Google Fonts, and catalog-shadowing issues this User Pack needs corrected.',
		toolName: 'gfx_appearance_validate_user_pack'
	},
	{
		prompt: 'Which Overlay types and Packs does this engine ship? List the registered vocabulary.',
		toolName: 'gfx_capability_inspect_vocabulary'
	},
	{
		prompt: 'Prepare the motion authoring family so its usable tools join the core menu.',
		toolName: 'gfx_capability_prepare_family'
	},
	{
		prompt: 'What are the public demo limits on duration and export size before work starts?',
		toolName: 'gfx_capability_inspect_limits'
	},
	{
		prompt: 'Create a new composition from the blank Preset so I can start from scratch.',
		toolName: 'gfx_composition_create_blank'
	},
	{
		prompt: 'Fork the lower-third Starter template into a new session composition.',
		toolName: 'gfx_composition_create_from_starter'
	},
	{
		prompt: 'List the compositions held in this browser session and how much quota is left.',
		toolName: 'gfx_session_inspect'
	},
	{
		prompt: 'Delete one composition from this browser session for good.',
		toolName: 'gfx_session_delete_composition'
	},
	{
		prompt: 'Set the delivery orientation to vertical so the piece reflows for TikTok.',
		toolName: 'gfx_transport_set_orientation'
	},
	{
		prompt: 'Declare a background fill so this becomes a full-frame segment.',
		toolName: 'gfx_transport_set_background'
	},
	{
		prompt: 'Replace the Surface with a different registered Surface type.',
		toolName: 'gfx_layer_set_surface'
	},
	{
		prompt: 'Add an Overlay of a registered Overlay type and give me its id.',
		toolName: 'gfx_layer_add_overlay'
	},
	{
		prompt: 'Add one first-class Kinetic Word Block to the plain Surface Type Field.',
		toolName: 'gfx_layer_add_kinetic_word'
	},
	{
		prompt: 'Remove this unreferenced Kinetic Word Block from the Type Field by id.',
		toolName: 'gfx_layer_remove_kinetic_word'
	},
	{
		prompt: 'Replace the single-token text carried by this Kinetic Word Block.',
		toolName: 'gfx_content_set_kinetic_word_text'
	},
	{
		prompt: 'Set the ordered semantic phrases, their word membership, and each focal word.',
		toolName: 'gfx_content_set_kinetic_phrases'
	},
	{
		prompt: 'Place this Kinetic Word at an exact centre, scale, and rotation for vertical.',
		toolName: 'gfx_placement_set_kinetic_word_placement'
	},
	{
		prompt: 'Dress this Kinetic Word as display hierarchy using the Pack accent ink role.',
		toolName: 'gfx_appearance_set_kinetic_word_appearance'
	},
	{
		prompt:
			'Make this Kinetic Word reveal letter by letter, 30 ms between glyphs, from the middle outward.',
		toolName: 'gfx_motion_set_kinetic_word_glyph_stagger'
	},
	{
		prompt: 'Write the words that appear inside that Overlay.',
		toolName: 'gfx_content_set_overlay_content'
	},
	{
		prompt: 'Set that Overlay anchor and offset so it sits in the bottom corner.',
		toolName: 'gfx_placement_set_overlay_placement'
	},
	{
		prompt: 'Bind this composition to a different registered Pack.',
		toolName: 'gfx_appearance_set_pack'
	},
	{
		prompt: 'Set that Overlay enter and exit windows so it arrives later.',
		toolName: 'gfx_motion_set_overlay_timing'
	},
	{
		prompt: 'Weld this entrance to another element entrance with a cascade offset.',
		toolName: 'gfx_motion_set_cascade_anchor'
	},
	{
		prompt: 'Add a sound cue naming a bundled audio asset and its window.',
		toolName: 'gfx_sound_set_cue'
	},
	{
		prompt: 'List the Media library entries and their durations.',
		toolName: 'gfx_media_inspect_library'
	},
	{
		prompt: 'Move the visible playhead to an exact frame so I can see it.',
		toolName: 'gfx_playhead_seek_frame'
	},
	{
		prompt: 'Return the validation findings so I know what to repair.',
		toolName: 'gfx_validation_inspect_findings'
	},
	{
		prompt: 'Export this composition as a video file the visitor downloads.',
		toolName: 'gfx_delivery_export_video'
	}
];

function rowFor(toolName: string): WebmcpOperationRow {
	const row = WEBMCP_OPERATION_INVENTORY.find((entry) => entry.toolName === toolName);
	if (!row) throw new Error(`The inventory declares no tool named ${toolName}`);
	return row;
}

/**
 * The registration state in which one row's tool can succeed. Every precondition
 * except `always` and the two session ones implies an open composition, which is
 * also what keeps this off the cold-page ceiling.
 */
function stateThatEnables(row: WebmcpOperationRow): WebmcpCompositionPreconditions {
	if (row.precondition === 'always' || row.precondition === 'session-composition-present') {
		return CLOSED_PAGE;
	}
	return { ...CLOSED_PAGE, 'composition-open': true, [row.precondition]: true };
}

function startController(host: WebmcpModelContextHost): WebmcpToolController {
	return new WebmcpToolController({
		host,
		definitions: listWebmcpToolDefinitions(),
		lifetime: new AbortController().signal
	});
}

async function prepareFamily(
	host: FakeModelContext,
	family: WebmcpOperationFamilyName
): Promise<void> {
	const result = await host.call('gfx_capability_prepare_family', { family });
	expect(result.isError).toBe(false);
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
});

describe('WebMCP agent tool selection', () => {
	it.each(AGENT_SELECTION_PROMPTS)(
		'sends "$prompt" to $toolName and nowhere else',
		({ prompt, toolName }) => {
			const [best, runnerUp] = rankToolsForPrompt(prompt);

			expect(best.toolName, `the runner-up was ${runnerUp.toolName} at ${runnerUp.score}`).toBe(
				toolName
			);
			expect(
				best.score,
				`${toolName} ties ${runnerUp.toolName} at ${best.score}; one of the two descriptions has to say what only it decides`
			).toBeGreaterThan(runnerUp.score);
		}
	);

	it('reaches every family an agent can reach, and asks for no internal one', () => {
		const asked = new Set<WebmcpOperationFamilyName>(
			AGENT_SELECTION_PROMPTS.map(({ toolName }) => rowFor(toolName).family)
		);
		const reachable = new Set(AGENT_TOOL_ROWS.map((row) => row.family));

		expect([...asked].sort()).toEqual([...reachable].sort());
		// `verification` is the one family a prompt must never resolve to: an agent
		// repairs from validation and looks through the playhead instead.
		expect(asked.has('verification')).toBe(false);
	});

	it('never ships two tools an agent would read as the same offer', () => {
		const summaries = new Map<string, string>();
		for (const row of AGENT_TOOL_ROWS) {
			const existing = summaries.get(row.summary);
			expect(existing, `${row.toolName} and ${existing} describe themselves identically`).toBe(
				undefined
			);
			summaries.set(row.summary, row.toolName);
		}
	});
});

describe('WebMCP discovery across a multi-step plan', () => {
	/**
	 * The order a plan actually runs in: each step names the tool it calls and the
	 * precondition the previous step established. An agent that reads `getTools()`
	 * between steps must find each verb exactly when it becomes possible — never
	 * before, because a tool it can see is a tool it will plan around.
	 */
	const PLAN: readonly {
		step: string;
		toolName: string;
		enabledBy: WebmcpCompositionPreconditions;
	}[] = [
		{
			step: 'start from a blank composition',
			toolName: 'gfx_composition_create_blank',
			enabledBy: CLOSED_PAGE
		},
		{
			step: 'frame it vertically',
			toolName: 'gfx_transport_set_orientation',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true, 'composition-editable': true }
		},
		{
			step: 'add the lower third',
			toolName: 'gfx_layer_add_overlay',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true, 'composition-editable': true }
		},
		{
			step: 'write its words',
			toolName: 'gfx_content_set_overlay_content',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true, 'overlay-present': true }
		},
		{
			step: 'place it for this orientation',
			toolName: 'gfx_placement_set_overlay_placement',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true, 'overlay-present': true }
		},
		{
			step: 'retime its entrance',
			toolName: 'gfx_motion_set_overlay_timing',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true, 'overlay-present': true }
		},
		{
			step: 'read what is still wrong',
			toolName: 'gfx_validation_inspect_findings',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true }
		},
		{
			step: 'deliver the file',
			toolName: 'gfx_delivery_export_video',
			enabledBy: { ...CLOSED_PAGE, 'composition-open': true }
		}
	];

	it('offers each step of a create-to-export plan exactly when it becomes possible', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);

		for (const { step, toolName, enabledBy } of PLAN) {
			await controller.synchronize(enabledBy, '/p/untitled');
			const row = rowFor(toolName);
			if (
				WEBMCP_OPERATION_FAMILIES.find((family) => family.name === row.family)?.disclosure ===
				'on-demand'
			) {
				await prepareFamily(host, row.family);
			}
			expect(
				[...host.getTools()].map((tool) => tool.name),
				`${step} needs ${toolName}`
			).toContain(toolName);
		}
	});

	it('hides the Layer Overlay verbs until the plan has actually added one', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);
		const overlayTools = AGENT_TOOL_ROWS.filter(
			(row) => row.family === 'layer' && row.precondition === 'overlay-present'
		).map((row) => row.toolName);

		await controller.synchronize(
			{ ...CLOSED_PAGE, 'composition-open': true, 'composition-editable': true },
			'/p/untitled'
		);
		await prepareFamily(host, 'layer');
		for (const toolName of overlayTools) {
			expect(
				[...host.getTools()].map((tool) => tool.name),
				`${toolName} exists with no Overlay`
			).not.toContain(toolName);
		}

		const afterAdd = await controller.synchronize(
			{ ...CLOSED_PAGE, 'composition-open': true, 'overlay-present': true },
			'/p/untitled'
		);
		expect(afterAdd.added.slice().sort()).toEqual(overlayTools.slice().sort());
	});

	it('leaves a landing visitor a plan that fits on a cold page', async () => {
		const host = new FakeModelContext();
		const controller = startController(host);

		const summary = await controller.synchronize(CLOSED_PAGE, '/');

		// A cold page is discovery plus the ways to begin. Everything that edits a
		// composition is behind having one.
		expect(summary.registered).toContain('gfx_capability_inspect_vocabulary');
		expect(summary.registered).toContain('gfx_composition_create_blank');
		expect(summary.registered).not.toContain('gfx_transport_set_orientation');
		expect(summary.registered).not.toContain('gfx_delivery_export_video');
	});
});

describe('WebMCP operation parity across every row', () => {
	it.each(AGENT_TOOL_ROWS.map((row) => ({ id: row.id, toolName: row.toolName })))(
		'registers $toolName in the state $id declares',
		async ({ toolName }) => {
			const row = rowFor(toolName);
			sessionStore.listUserCompositions.mockResolvedValue(
				row.precondition === 'session-composition-present' ? [SESSION_ENTRY] : []
			);
			const host = new FakeModelContext();
			const controller = startController(host);

			await controller.synchronize(stateThatEnables(row), '/p/untitled');
			if (
				WEBMCP_OPERATION_FAMILIES.find((family) => family.name === row.family)?.disclosure ===
				'on-demand'
			) {
				await prepareFamily(host, row.family);
			}

			expect([...host.getTools()].map((tool) => tool.name)).toContain(toolName);
		}
	);

	it('registers no internal-only operation across every disclosed family', async () => {
		expect(INTERNAL_ONLY_ROWS.length).toBeGreaterThan(0);
		sessionStore.listUserCompositions.mockResolvedValue([SESSION_ENTRY]);
		const everyPreconditionTrue = Object.fromEntries(
			Object.keys(CLOSED_PAGE).map((name) => [name, true])
		) as WebmcpCompositionPreconditions;
		const host = new FakeModelContext();
		const controller = startController(host);
		const reached = new Set<string>();

		await controller.synchronize(everyPreconditionTrue, '/p/untitled');
		for (const tool of host.getTools()) reached.add(tool.name);
		for (const family of WEBMCP_OPERATION_FAMILIES.filter(
			(entry) => entry.disclosure === 'on-demand'
		)) {
			await prepareFamily(host, family.name);
			for (const tool of host.getTools()) reached.add(tool.name);
		}

		for (const row of INTERNAL_ONLY_ROWS) {
			expect(row.exposure).toBe('internal-only');
			expect(reached, `${row.id} reached an agent`).not.toContain(row.toolName);
		}
		expect([...reached].sort()).toEqual(AGENT_TOOL_ROWS.map((row) => row.toolName).sort());
	});

	it('leaves no declared family without a way in, except the internal one', () => {
		const reachable = new Set(AGENT_TOOL_ROWS.map((row) => row.family));
		const internal = new Set(INTERNAL_ONLY_ROWS.map((row) => row.family));

		for (const family of WEBMCP_OPERATION_FAMILIES) {
			const isReachable = reachable.has(family.name);
			expect(
				isReachable || internal.has(family.name),
				`${family.name} has no agent tool and no internal-only disposition`
			).toBe(true);
		}
		expect([...internal]).toEqual(['verification']);
	});
});

describe('WebMCP tool text budgets', () => {
	it('registers every tool inside the name and description budgets it is read under', async () => {
		sessionStore.listUserCompositions.mockResolvedValue([SESSION_ENTRY]);
		const everyPreconditionTrue = Object.fromEntries(
			Object.keys(CLOSED_PAGE).map((name) => [name, true])
		) as WebmcpCompositionPreconditions;
		const host = new FakeModelContext();
		const controller = startController(host);
		const descriptors = new Map<string, WebmcpToolDescriptor>();

		await controller.synchronize(everyPreconditionTrue, '/p/untitled');
		for (const tool of host.getTools()) {
			const descriptor = host.describe(tool.name);
			if (descriptor) descriptors.set(tool.name, descriptor);
		}
		for (const family of WEBMCP_OPERATION_FAMILIES.filter(
			(entry) => entry.disclosure === 'on-demand'
		)) {
			await prepareFamily(host, family.name);
			for (const tool of host.getTools()) {
				const descriptor = host.describe(tool.name);
				if (descriptor) descriptors.set(tool.name, descriptor);
			}
		}

		for (const [toolName, descriptor] of descriptors) {
			const row = rowFor(toolName);
			expect(descriptor.name.length).toBeLessThanOrEqual(WEBMCP_TOOL_NAME_MAX_LENGTH);
			expect(descriptor.description.length).toBeLessThanOrEqual(WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH);
			expect(descriptor.description).toBe(row.summary);
			for (const fragment of WEBMCP_FORBIDDEN_TOOL_NAME_FRAGMENTS) {
				expect(toolName.includes(fragment), `${toolName} actuates the interface`).toBe(false);
			}
		}
	});

	it('offers no argument that would send the page to an address the caller chose', () => {
		for (const definition of listWebmcpToolDefinitions()) {
			const argumentNames = Object.keys(definition.inputSchema.properties);
			for (const name of argumentNames) {
				expect(
					/^(url|uri|href|src|endpoint|origin|address)$/i.test(name),
					`${definition.operationId} takes a caller-supplied address in "${name}"`
				).toBe(false);
			}
		}
	});
});
