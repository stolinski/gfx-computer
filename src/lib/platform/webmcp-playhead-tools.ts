/**
 * The `playhead` family's WebMCP tools: where the visible playhead sits, in
 * exact frames
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * These are the preview tools, and preview here means the transport rather than
 * the pixels. Seeking parks the Workspace on a frame so a person and an agent are
 * looking at the same picture; measuring what that picture actually contains is
 * the `verification` family, which stays internal-only.
 *
 * Both tools speak Film time: frames and seconds of the whole open Film, with
 * the Scene and the frame inside it named in every receipt.
 *
 * Neither tool takes an observed revision. A seek writes no composition pointer
 * and records no undo entry — which is exactly why `playhead` is its own family
 * rather than a corner of `transport`. A seek into another Scene opens that
 * Scene, and that advances the revision as any change of Scene does.
 */
import {
	runInspectCompositionPlayheadOperation,
	runSeekCompositionPlayheadOperation
} from './composition-playhead-operations';
import { readWebmcpTimePositionArgument, runWebmcpToolOperation } from './webmcp-tool-arguments';
import { webmcpFrameTimeProperty, WEBMCP_NO_ARGUMENTS_SCHEMA } from './webmcp-derived-tool-schemas';

import type { WebmcpToolDefinition } from './webmcp-tool-controller';

export function listWebmcpPlayheadToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'playhead.inspect',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: async () => runInspectCompositionPlayheadOperation()
		},
		{
			operationId: 'playhead.seek-frame',
			inputSchema: {
				type: 'object',
				properties: {
					frame: webmcpFrameTimeProperty(
						'The position in the whole Film to park on: exact Film frame, seconds, milliseconds, or editor timecode. A position in another Scene opens that Scene.'
					)
				},
				required: ['frame'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('playhead.seek-frame', () =>
					runSeekCompositionPlayheadOperation({
						frame: readWebmcpTimePositionArgument(args, 'frame')
					})
				)
		}
	];
}
