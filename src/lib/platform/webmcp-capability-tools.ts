/**
 * The `capability` family's WebMCP tools: cold-page discovery plus bounded
 * authoring-family disclosure
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2, §5).
 *
 * Discovery has to come first, because authoring arguments come from registries.
 * Vocabulary and limits stay on the cold page. Once a composition opens, the
 * family selector adds one on-demand authoring family to the core menu.
 *
 * The section argument is the vocabulary record's own keys, so a registry this
 * engine gains is a section this tool offers on the next load without anyone
 * editing a list.
 */
import {
	readWebmcpVocabularySections,
	webmcpDerivedEnumProperty,
	WEBMCP_NO_ARGUMENTS_SCHEMA
} from './webmcp-derived-tool-schemas';
import {
	readWebmcpLiteralArgument,
	readWebmcpOptionalLiteralArgument,
	runWebmcpToolOperation
} from './webmcp-tool-arguments';
import { REGISTERED_EFFECT_TYPES } from './pipelines/definition-registry';
import {
	runInspectCapabilityLimitsOperation,
	runInspectCapabilityVocabularyOperation,
	runPrepareCapabilityAuthoringFamilyOperation
} from './composition-capability-operations';
import { WEBMCP_ON_DEMAND_FAMILY_NAMES } from './webmcp-operation-inventory';

import type { WebmcpToolDefinition } from './webmcp-tool-controller';

export function listWebmcpCapabilityToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'capability.inspect-vocabulary',
			inputSchema: {
				type: 'object',
				properties: {
					section: {
						type: 'string',
						description: 'Which registered vocabulary to list. One section per call.',
						enum: readWebmcpVocabularySections()
					},
					effectType: webmcpDerivedEnumProperty(
						'effect-type',
						"With the effect-type section, the Effect whose keyframe channels to list with their bounds."
					)
				},
				required: ['section'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('capability.inspect-vocabulary', () =>
					runInspectCapabilityVocabularyOperation({
						section: readWebmcpLiteralArgument(args, 'section', readWebmcpVocabularySections()),
						effectType: readWebmcpOptionalLiteralArgument(
							args,
							'effectType',
							REGISTERED_EFFECT_TYPES
						)
					})
				)
		},
		{
			operationId: 'capability.inspect-limits',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: async () => runInspectCapabilityLimitsOperation()
		},
		{
			operationId: 'capability.prepare-authoring-family',
			inputSchema: {
				type: 'object',
				properties: {
					family: {
						type: 'string',
						description:
							'The authoring family whose currently usable tools should join the core menu.',
						enum: WEBMCP_ON_DEMAND_FAMILY_NAMES
					}
				},
				required: ['family'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('capability.prepare-authoring-family', () =>
					runPrepareCapabilityAuthoringFamilyOperation({
						family: readWebmcpLiteralArgument(args, 'family', WEBMCP_ON_DEMAND_FAMILY_NAMES)
					})
				)
		}
	];
}
