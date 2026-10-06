/**
 * The WebMCP tools this build ships, in one list the controller registers from
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §1).
 *
 * A definition names an inventory row and supplies the two things the row does
 * not: the derived argument schema, and the handler that runs the operation.
 * Everything else about the tool — its name, its description, when it is
 * registered, what it may write — is the row's, so this list can never disagree
 * with the contract.
 *
 * The list is built on call rather than at import. Every argument enum is read
 * from a live registry, and reading those while the module graph is still
 * loading would freeze a vocabulary — or fail the whole bundle over an empty
 * one — before the page exists. The controller asks once, when it starts.
 *
 * With validation, delivery, and the agent-context family selector here, this
 * list covers every row the inventory exposes to an agent. The definitions test
 * compares the two sets directly, so a new row without a tool fails immediately.
 * `verification` is the one family absent by design: its rows are
 * `internal-only`, and the controller refuses a definition that names one.
 */
import { listWebmcpAppearanceToolDefinitions } from './webmcp-appearance-tools';
import { listWebmcpCapabilityToolDefinitions } from './webmcp-capability-tools';
import { listWebmcpCompositionToolDefinitions } from './webmcp-composition-tools';
import { listWebmcpContentToolDefinitions } from './webmcp-content-tools';
import { listWebmcpDeliveryToolDefinitions } from './webmcp-delivery-tools';
import { listWebmcpFigureToolDefinitions } from './webmcp-figure-tools';
import { listWebmcpLayerToolDefinitions } from './webmcp-layer-tools';
import { listWebmcpMediaToolDefinitions } from './webmcp-media-tools';
import { listWebmcpMotionToolDefinitions } from './webmcp-motion-tools';
import { listWebmcpPlacementToolDefinitions } from './webmcp-placement-tools';
import { listWebmcpPlayheadToolDefinitions } from './webmcp-playhead-tools';
import { listWebmcpSessionToolDefinitions } from './webmcp-session-tools';
import { listWebmcpSoundToolDefinitions } from './webmcp-sound-tools';
import { listWebmcpTransportToolDefinitions } from './webmcp-transport-tools';
import { listWebmcpValidationToolDefinitions } from './webmcp-validation-tools';

import type { WebmcpToolDefinition } from './webmcp-tool-controller';

export function listWebmcpToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		...listWebmcpCapabilityToolDefinitions(),
		...listWebmcpCompositionToolDefinitions(),
		...listWebmcpSessionToolDefinitions(),
		...listWebmcpTransportToolDefinitions(),
		...listWebmcpLayerToolDefinitions(),
		...listWebmcpContentToolDefinitions(),
		...listWebmcpFigureToolDefinitions(),
		...listWebmcpPlacementToolDefinitions(),
		...listWebmcpAppearanceToolDefinitions(),
		...listWebmcpMotionToolDefinitions(),
		...listWebmcpSoundToolDefinitions(),
		...listWebmcpMediaToolDefinitions(),
		...listWebmcpPlayheadToolDefinitions(),
		...listWebmcpValidationToolDefinitions(),
		...listWebmcpDeliveryToolDefinitions()
	];
}
