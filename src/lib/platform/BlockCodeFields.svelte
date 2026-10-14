<script lang="ts">
	import { CODE_LANGUAGES, CODE_STEP_LIMIT, type DiagramCode } from './engine-schema';
	import Field from './Field.svelte';
	import {
		formatCodeHighlightRanges,
		parseCodeHighlightRanges
	} from '$lib/utils/code-highlight-ranges';

	// The Code Block's content: its language and its steps. Each step's move
	// window is edited on its own timeline row; here a step holds its code (empty
	// keeps the previous step's) and the lines it lights.
	interface Props {
		primitive: DiagramCode;
	}

	let { primitive: el }: Props = $props();

	const CODE_STEP_MOVE_DURATION = 0.08;

	function setStepCode(index: number, value: string): void {
		const step = el.steps[index];
		if (index === 0) {
			if (value.length > 0) step.code = value;
			return;
		}
		step.code = value.length > 0 ? value : undefined;
	}

	function setStepHighlight(index: number, value: string): void {
		const ranges = parseCodeHighlightRanges(value);
		if (!ranges) return;
		el.steps[index].highlight = ranges.length > 0 ? ranges : undefined;
	}

	function addStep(): void {
		const lastMove = el.steps.findLast((step) => step.move)?.move;
		const start = Math.min(
			1 - CODE_STEP_MOVE_DURATION,
			lastMove ? lastMove.start + lastMove.duration + 0.1 : 0.4
		);
		el.steps.push({ move: { start, duration: CODE_STEP_MOVE_DURATION, ease: 'smooth' } });
	}

	function removeStep(index: number): void {
		el.steps.splice(index, 1);
	}
</script>

<Field label="Language">
	<select
		value={el.language}
		onchange={(e) => {
			el.language = (e.currentTarget as HTMLSelectElement).value as typeof el.language;
		}}
	>
		{#each CODE_LANGUAGES as language (language)}
			<option value={language}>{language}</option>
		{/each}
	</select>
</Field>
{#each el.steps as step, index (index)}
	<Field label={`Step ${index + 1}`}>
		<textarea
			rows="6"
			spellcheck="false"
			value={step.code ?? ''}
			placeholder={index > 0 ? 'same code' : undefined}
			oninput={(e) => setStepCode(index, (e.currentTarget as HTMLTextAreaElement).value)}
		></textarea>
		<input
			type="text"
			aria-label={`Step ${index + 1} highlight`}
			placeholder="3-5, 7"
			value={formatCodeHighlightRanges(step.highlight ?? [])}
			onchange={(e) => setStepHighlight(index, (e.currentTarget as HTMLInputElement).value)}
		/>
		{#if index > 0}
			<button type="button" onclick={() => removeStep(index)}>Remove</button>
		{/if}
	</Field>
{/each}
{#if el.steps.length < CODE_STEP_LIMIT}
	<button type="button" onclick={addStep}>Add step</button>
{/if}
