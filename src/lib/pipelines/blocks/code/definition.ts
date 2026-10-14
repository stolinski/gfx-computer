import type { BlockPipelineDefinition } from '$lib/platform/pipelines/definition-types';

export const codeBlockDefinition = {
	type: 'code'
} satisfies BlockPipelineDefinition<'code'>;
