/**
 * The `capability` family: what this engine can express, and the limits the
 * serving origin enforces
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Vocabulary and limits answer before anything exists, which makes them the
 * cold page's opening move. Preparing an authoring family appears only after a
 * composition opens and changes agent context alone. None writes the document.
 *
 * Neither restates anything either. The vocabulary is the live registry read in
 * `webmcp-derived-tool-schemas`, and the limits are the export envelope the
 * origin serves for its runtime profile (`public-runtime-contract`) plus the
 * result budgets the operation contract declares. A member offered here is a member an operation accepts,
 * because there is only one list.
 */
import {
	PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS,
	type PublicExportRuntimeLimits
} from './public-runtime-contract';
import { readWebmcpDerivedEnums } from './webmcp-derived-tool-schemas';
import {
	listEffectKeyframeChannels,
	type EffectKeyframeChannel
} from './effect-keyframe-channels';
import { getEffectDefinition } from './pipelines/definition-registry';
import { requireCompositionOperationRow } from './composition-operation-preflight';
import { STANDARD_TRANSPORT_RATES } from '../utils/composition-timing';
import {
	WEBMCP_ALWAYS_REGISTERED_CEILING,
	WEBMCP_CORE_REGISTERED_CEILING,
	WEBMCP_DISCLOSED_REGISTERED_CEILING,
	WEBMCP_RESULT_CHARACTER_BUDGET,
	WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET
} from './webmcp-operation-inventory';

import type { WebmcpDerivedEnumName } from './webmcp-derived-tool-schemas';
import type { WebmcpOperationFamilyName } from './webmcp-operation-inventory';

/** How many members one vocabulary section names before it reports only the total. */
export const CAPABILITY_VOCABULARY_MEMBER_LIMIT = 64;

export interface InspectCapabilityVocabularyRequest {
	section: WebmcpDerivedEnumName;
	/**
	 * With the `effect-type` section, the one Effect whose keyframe channels to
	 * list with their bounds (ADR-0063). One Effect per call keeps the receipt
	 * inside the result budget.
	 */
	effectType?: string;
}

export interface PrepareCapabilityAuthoringFamilyRequest {
	family: WebmcpOperationFamilyName;
}

/** A transport-only context change; the composition and Workspace stay untouched. */
export interface CapabilityAuthoringFamilyReceipt {
	status: 'prepared';
	operationId: string;
	family: WebmcpOperationFamilyName;
}

/** One vocabulary, as the caller asked for it: one section per call. */
export interface CapabilityVocabularyReceipt {
	status: 'inspected';
	operationId: string;
	section: WebmcpDerivedEnumName;
	members: readonly string[];
	total: number;
	truncated: boolean;
	/** The named Effect's keyframe channels, derived from its params schema. */
	effectChannels?: {
		effectType: string;
		channels: readonly EffectKeyframeChannel[];
	};
}

/** Every bound that rejects work before it starts, in one read. */
export interface CapabilityLimitsReceipt {
	status: 'inspected';
	operationId: string;
	/** What a composition may declare before this origin's export lane refuses it. */
	transport: {
		maxDurationSeconds: number;
		maxFrameRate: number;
		maxFrameCount: number;
		/** The delivery rates every frame computation has an exact rational for. */
		rates: readonly number[];
	};
	/** What one export may produce and hold in flight. */
	output: {
		maxOutputBytes: number;
		maxFrameBytes: number;
		maxAudioBytes: number;
	};
	/** How many export sessions may run at once, and how long each one lives. */
	exportSession: {
		maxConcurrent: number;
		idleTimeoutMs: number;
		maxLifetimeMs: number;
	};
	/** What the browser-scoped session may hold before a save is refused. */
	sessionStorage: {
		maxStorageBytes: number;
		maxCompositionBytes: number;
	};
	/** How many tool descriptors an agent reads in each disclosure state. */
	toolContext: {
		coldPageCeiling: number;
		coreOpenCeiling: number;
		disclosedOpenCeiling: number;
	};
	/** What a tool result may return before it fails rather than truncating. */
	result: {
		characterBudget: number;
		wholeDocumentCharacterBudget: number;
	};
}

/**
 * Select the one on-demand family whose currently usable tools join the core
 * menu. The controller applies the selection before returning this receipt.
 */
export function runPrepareCapabilityAuthoringFamilyOperation(
	request: PrepareCapabilityAuthoringFamilyRequest
): CapabilityAuthoringFamilyReceipt {
	const row = requireCompositionOperationRow('capability.prepare-authoring-family');
	return { status: 'prepared', operationId: row.id, family: request.family };
}

/**
 * List one section of the registered vocabulary. One section per call keeps the
 * whole engine's expressive range readable inside a result budget, and keeps an
 * agent from paying for the Effect registry when it wanted the Starter list.
 */
export function runInspectCapabilityVocabularyOperation(
	request: InspectCapabilityVocabularyRequest
): CapabilityVocabularyReceipt {
	const row = requireCompositionOperationRow('capability.inspect-vocabulary');
	const members = readWebmcpDerivedEnums()[request.section];
	const receipt: CapabilityVocabularyReceipt = {
		status: 'inspected',
		operationId: row.id,
		section: request.section,
		members: members.slice(0, CAPABILITY_VOCABULARY_MEMBER_LIMIT),
		total: members.length,
		truncated: members.length > CAPABILITY_VOCABULARY_MEMBER_LIMIT
	};
	const definition =
		request.section === 'effect-type' && request.effectType
			? getEffectDefinition(request.effectType)
			: null;
	if (definition) {
		receipt.effectChannels = {
			effectType: definition.type,
			channels: listEffectKeyframeChannels(definition)
		};
	}
	return receipt;
}

/**
 * Report the limits that reject work before it starts. An agent that reads this
 * first authors a piece the export lane will actually take, rather than
 * discovering a 40-second duration at the end of a render.
 *
 * The export limits are passed in because they belong to the origin serving the
 * page, not to this module: a development host admits a Film-length export and
 * a public or hosted one the ratified fifteen seconds. The WebMCP tool reads
 * them with `fetchServedExportRuntimeLimits`.
 */
export function runInspectCapabilityLimitsOperation(
	exportLimits: PublicExportRuntimeLimits
): CapabilityLimitsReceipt {
	const row = requireCompositionOperationRow('capability.inspect-limits');

	return {
		status: 'inspected',
		operationId: row.id,
		transport: {
			maxDurationSeconds: exportLimits.maxDurationSeconds,
			maxFrameRate: exportLimits.maxFrameRate,
			maxFrameCount: exportLimits.maxFrameCount,
			rates: STANDARD_TRANSPORT_RATES
		},
		output: {
			maxOutputBytes: exportLimits.maxOutputBytes,
			maxFrameBytes: exportLimits.maxFrameBytes,
			maxAudioBytes: exportLimits.maxAudioBytes
		},
		exportSession: {
			maxConcurrent: exportLimits.maxConcurrentSessions,
			idleTimeoutMs: exportLimits.sessionIdleTimeoutMs,
			maxLifetimeMs: exportLimits.sessionMaxLifetimeMs
		},
		sessionStorage: {
			maxStorageBytes: PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxStorageBytes,
			maxCompositionBytes: PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS.maxCompositionBytes
		},
		toolContext: {
			coldPageCeiling: WEBMCP_ALWAYS_REGISTERED_CEILING,
			coreOpenCeiling: WEBMCP_CORE_REGISTERED_CEILING,
			disclosedOpenCeiling: WEBMCP_DISCLOSED_REGISTERED_CEILING
		},
		result: {
			characterBudget: WEBMCP_RESULT_CHARACTER_BUDGET,
			wholeDocumentCharacterBudget: WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET
		}
	};
}
