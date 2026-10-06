<script lang="ts">
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { compositionEditHistory } from './composition-edit-history';
	import { runSetCompositionFigureMovesOperation } from './composition-figure-operations';
	import { FIGURE_MOVE_NAMES, type Figure, type FigureMove } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import Field from './Field.svelte';
	import { listFigureMoveStyles } from './figure-inspector-fields';
	import InspectorSection from './InspectorSection.svelte';
	import { NAMED_EASE_CURVES } from '$lib/utils/ease-curves';
	import { listFigureMarkIds } from '$lib/utils/figure-mark-ids';

	// Figure Moves (ADR-0067 §6): every named Move with its window in seconds,
	// its ease, and its own fields. The operation refuses an overshooting ease on
	// a quantity, a Move outside the reveal/exit, or a target the Figure lacks.

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	let operationMessage = $state<string | null>(null);

	const figure = $derived(
		(engineState.surface.figures ?? []).find((entry) => entry.id === blockId) ?? null
	);
	const seconds = $derived(engineState.transport.durationSeconds);
	const addable = $derived(FIGURE_MOVE_NAMES.filter((name) => name !== 'reveal'));

	async function write(moves: FigureMove[]): Promise<void> {
		operationMessage = null;
		const outcome = await runSetCompositionFigureMovesOperation({
			expectedRevision: compositionEditHistory.revision,
			figureId: blockId,
			moves
		});
		if (outcome.status === 'failed')
			operationMessage = describeCompositionOperationFailure(outcome);
	}

	function update(index: number, patch: Record<string, unknown>): void {
		if (!figure) return;
		const moves = figure.moves.map((move, moveIndex) =>
			moveIndex === index ? ({ ...move, ...patch } as FigureMove) : move
		);
		void write(moves);
	}

	function remove(index: number): void {
		if (!figure) return;
		void write(figure.moves.filter((_, moveIndex) => moveIndex !== index));
	}

	function advanceExtent(current: Figure): [number, number] {
		if (current.kind === 'bar-race') return [0, current.data.frames.length - 1];
		if (current.kind === 'slope') return [0, current.data.periods.length - 1];
		if (current.kind === 'line') {
			const xs = current.data.series.flatMap((series) => series.points.map((point) => point.x));
			return [Math.min(...xs), Math.max(...xs)];
		}
		return [0, 1];
	}

	function add(name: string): void {
		if (!figure) return;
		const marks = listFigureMarkIds(figure);
		const exit = figure.moves.find((move) => move.move === 'exit');
		const end = exit ? exit.start : 1;
		const start = Math.max(0, Math.min(end - 0.12, 0.5));
		const window = { start, duration: Math.max(0.02, Math.min(0.1, end - start)) };
		const firstNode = [...marks.positionable][0] ?? [...marks.all][0];
		const [from, to] = advanceExtent(figure);
		const next: Record<string, FigureMove> = {
			propagate: { move: 'propagate', ...window, repeat: 1 },
			pulse: { move: 'pulse', ...window, targets: [firstNode], repeat: 2 },
			flow: { move: 'flow', ...window, cycles: 3 },
			advance: { move: 'advance', ...window, from, to },
			focus: { move: 'focus', ...window, targets: [firstNode] },
			annotate: {
				move: 'annotate',
				...window,
				targets: [[...marks.annotations][0] ?? firstNode]
			},
			exit: { move: 'exit', start: Math.min(0.94, end), duration: 0.05, style: 'fade' }
		};
		const move = next[name];
		if (move) void write([...figure.moves, move]);
	}

	function targetsOf(move: FigureMove): string {
		return 'targets' in move && move.targets ? move.targets.join(', ') : '';
	}

	function parseTargets(raw: string): string[] {
		return raw
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
</script>

{#if figure}
	<InspectorSection label="Moves" summary={`${figure.moves.length}`}>
		{#snippet action()}
			<select
				aria-label="Add a Move"
				value=""
				onchange={(event) => {
					add(event.currentTarget.value);
					event.currentTarget.value = '';
				}}
			>
				<option value="" disabled>+ Add</option>
				{#each addable as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		{/snippet}
		{#each figure.moves as move, index (`${index}:${move.move}`)}
			<fieldset class="figure-move">
				<legend>
					{move.move}
					{#if move.move !== 'reveal'}
						<button class="quiet-action" type="button" onclick={() => remove(index)}>Remove</button>
					{/if}
				</legend>
				<Field label="Start s">
					<input
						type="number"
						min="0"
						step="0.05"
						value={Math.round(move.start * seconds * 100) / 100}
						onchange={(event) =>
							update(index, { start: Number(event.currentTarget.value) / seconds })}
					/>
				</Field>
				<Field label="Length s">
					<input
						type="number"
						min="0.05"
						step="0.05"
						value={Math.round(move.duration * seconds * 100) / 100}
						onchange={(event) =>
							update(index, { duration: Number(event.currentTarget.value) / seconds })}
					/>
				</Field>
				<Field label="Ease">
					<select
						value={move.ease ?? 'smooth'}
						onchange={(event) => update(index, { ease: event.currentTarget.value })}
					>
						{#each NAMED_EASE_CURVES as ease (ease)}
							<option value={ease}>{ease}</option>
						{/each}
					</select>
				</Field>
				{#if move.move === 'reveal' || move.move === 'exit'}
					<Field label="Style">
						<select
							value={move.style}
							onchange={(event) => update(index, { style: event.currentTarget.value })}
						>
							{#each listFigureMoveStyles(move.move) as style (style)}
								<option value={style}>{style}</option>
							{/each}
						</select>
					</Field>
				{/if}
				{#if move.move === 'propagate' || move.move === 'pulse'}
					<Field label="Repeat">
						<input
							type="number"
							min="1"
							max="8"
							step="1"
							value={move.repeat}
							onchange={(event) => update(index, { repeat: Number(event.currentTarget.value) })}
						/>
					</Field>
				{/if}
				{#if move.move === 'flow'}
					<Field label="Cycles">
						<input
							type="number"
							min="1"
							max="24"
							step="1"
							value={move.cycles}
							onchange={(event) => update(index, { cycles: Number(event.currentTarget.value) })}
						/>
					</Field>
				{/if}
				{#if move.move === 'advance'}
					<Field label="From">
						<input
							type="number"
							step="any"
							value={move.from}
							onchange={(event) => update(index, { from: Number(event.currentTarget.value) })}
						/>
					</Field>
					<Field label="To">
						<input
							type="number"
							step="any"
							value={move.to}
							onchange={(event) => update(index, { to: Number(event.currentTarget.value) })}
						/>
					</Field>
				{/if}
				{#if move.move === 'pulse' || move.move === 'focus' || move.move === 'annotate' || move.move === 'flow'}
					<Field label="Marks">
						<input
							type="text"
							aria-label="Move target Marks"
							value={targetsOf(move)}
							onchange={(event) => {
								const targets = parseTargets(event.currentTarget.value);
								update(
									index,
									move.move === 'flow' && targets.length === 0
										? { targets: undefined }
										: { targets }
								);
							}}
						/>
					</Field>
				{/if}
				{#if move.move === 'focus' && figure.kind === 'treemap'}
					<Field label="Zoom">
						<input
							type="checkbox"
							checked={move.zoom ?? false}
							onchange={(event) =>
								update(index, { zoom: event.currentTarget.checked || undefined })}
						/>
					</Field>
				{/if}
			</fieldset>
		{/each}
		{#if operationMessage}
			<small class="operation-error">{operationMessage}</small>
		{/if}
	</InspectorSection>
{/if}

<style>
	.figure-move {
		border: 0;
		margin: 0;
		padding: 0;
	}

	.figure-move legend {
		display: flex;
		justify-content: space-between;
		color: var(--chrome-muted);
		font-size: 0.7rem;
		inline-size: 100%;
		letter-spacing: 0.08em;
		padding: 0;
		text-transform: uppercase;
	}

	.quiet-action {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.operation-error {
		color: var(--sentry-red, #ef5454);
		font-size: 0.7rem;
	}
</style>
