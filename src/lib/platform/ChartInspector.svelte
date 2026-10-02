<script lang="ts">
	import {
		chartDomainIncludesFactualValues,
		createChartFactualDomain,
		replaceChartBlockType,
		setChartLayoutMode,
		setChartNormalizationTotal,
		type ChartBlockType
	} from './chart-authoring';
	import { engineState } from './engine-state.svelte';
	import ChartDataSection from './ChartDataSection.svelte';
	import ChartFrameSection from './ChartFrameSection.svelte';
	import ChartMotionSection from './ChartMotionSection.svelte';
	import ChartTargetsSection from './ChartTargetsSection.svelte';
	import Field from './Field.svelte';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';

	interface Props {
		blockId: string;
	}

	let { blockId }: Props = $props();
	const block = $derived(
		engineState.surface.chart?.items.find((item) => item.id === blockId) ?? null
	);

	function commitType(event: Event): void {
		if (!block) return;
		const select = event.currentTarget as HTMLSelectElement;
		const previous = block.type;
		if (!replaceChartBlockType(engineState.surface, blockId, select.value as ChartBlockType)) {
			select.value = previous;
			select.setCustomValidity(
				'Normalized charts require one non-negative series with a positive total.'
			);
			select.reportValidity();
			return;
		}
		select.setCustomValidity('');
	}

	function commitRequiredText(
		event: Event,
		currentValue: string,
		commit: (value: string) => void
	): void {
		const input = event.currentTarget as HTMLInputElement;
		const value = input.value.trim();
		if (!value) {
			input.value = currentValue;
			input.setCustomValidity('A value is required.');
			input.reportValidity();
			return;
		}
		input.setCustomValidity('');
		commit(value);
	}

	function toggleDomain(enabled: boolean): void {
		if (
			!block ||
			(block.type !== 'bar-chart' && block.type !== 'column-chart' && block.type !== 'line-chart')
		)
			return;
		if (!enabled) {
			block.domain = undefined;
			return;
		}
		block.domain = createChartFactualDomain(block);
	}

	function commitDomainBound(event: Event, field: 'min' | 'max'): void {
		if (
			!block ||
			(block.type !== 'bar-chart' && block.type !== 'column-chart' && block.type !== 'line-chart')
		)
			return;
		const input = event.currentTarget as HTMLInputElement;
		const previous = block.domain?.[field];
		const raw = input.value.trim();
		const candidate = { ...block.domain };
		if (raw === '') delete candidate[field];
		else {
			const value = Number(raw);
			if (!Number.isFinite(value)) {
				input.value = previous === undefined ? '' : String(previous);
				input.setCustomValidity('Domain bounds must be finite.');
				input.reportValidity();
				return;
			}
			candidate[field] = value;
		}
		if (!chartDomainIncludesFactualValues(block, candidate)) {
			input.value = previous === undefined ? '' : String(previous);
			input.setCustomValidity('Domain bounds must include zero and every factual value.');
			input.reportValidity();
			return;
		}
		input.setCustomValidity('');
		block.domain =
			candidate.min === undefined && candidate.max === undefined ? undefined : candidate;
	}

	function commitLayout(event: Event): void {
		if (!block) return;
		const select = event.currentTarget as HTMLSelectElement;
		if (!setChartLayoutMode(block, select.value as 'single' | 'grouped' | 'stacked')) {
			select.value =
				block.type === 'bar-chart' || block.type === 'column-chart' ? block.layout.mode : 'single';
			select.setCustomValidity(
				'Layout must match the series count, factual signs, and explicit domain.'
			);
			select.reportValidity();
			return;
		}
		select.setCustomValidity('');
	}

	function commitNormalizationTotal(event: Event): void {
		if (!block || (block.type !== 'unit-grid-chart' && block.type !== 'dot-field-chart')) return;
		const input = event.currentTarget as HTMLInputElement;
		const previous = block.normalization.total;
		if (!setChartNormalizationTotal(block, Number(input.value))) {
			input.value = String(previous);
			input.setCustomValidity('Total must be finite, positive, and equal the explicit part sum.');
			input.reportValidity();
			return;
		}
		input.setCustomValidity('');
	}

	function commitUnitCount(event: Event): void {
		if (!block || (block.type !== 'unit-grid-chart' && block.type !== 'dot-field-chart')) return;
		const input = event.currentTarget as HTMLInputElement;
		const previous = block.normalization.unitCount;
		const value = Number(input.value);
		if (!Number.isSafeInteger(value) || value < 10 || value > 1000) {
			input.value = String(previous);
			input.setCustomValidity('Unit count must be an integer from 10 through 1,000.');
			input.reportValidity();
			return;
		}
		input.setCustomValidity('');
		block.normalization.unitCount = value;
	}
</script>

{#if block}
	<InspectorSection label="Chart" summary={block.type}>
		<Field label="Type">
			<select aria-label="Chart type" value={block.type} onchange={commitType}>
				<option value="bar-chart">Bar</option>
				<option value="column-chart">Column</option>
				<option value="line-chart">Line</option>
				<option value="unit-grid-chart">Unit grid</option>
				<option value="dot-field-chart">Dot field</option>
			</select>
		</Field>
		<Field label="Title">
			<input
				type="text"
				aria-label="Chart title"
				value={block.title}
				onchange={(event) =>
					commitRequiredText(event, block.title, (value) => (block.title = value))}
			/>
		</Field>
		<Field label="Source">
			<input
				type="text"
				aria-label="Chart source note"
				value={block.sourceNote ?? ''}
				onchange={(event) => {
					const value = (event.currentTarget as HTMLInputElement).value.trim();
					block.sourceNote = value || undefined;
				}}
			/>
		</Field>
		<Field label="Progress">
			<InspectorToggle
				checked={block.progressBar ?? false}
				label="Screen progress bar"
				onchange={(checked) => (block.progressBar = checked)}
			/>
		</Field>
	</InspectorSection>

	<ChartDataSection {blockId} />

	<ChartFrameSection {blockId} />

	<InspectorSection label="Layout">
		{#if block.type === 'bar-chart' || block.type === 'column-chart' || block.type === 'line-chart'}
			{#if block.type === 'bar-chart' || block.type === 'column-chart'}
				<Field label="Mode">
					<select aria-label="Chart layout mode" value={block.layout.mode} onchange={commitLayout}>
						<option value="single" disabled={block.data.series.length !== 1}>Single</option>
						<option value="grouped" disabled={block.data.series.length < 2}>Grouped</option>
						<option
							value="stacked"
							disabled={block.data.series.length < 2 ||
								block.data.series.some((series) => series.values.some((datum) => datum.value < 0))}
							>Stacked</option
						>
					</select>
				</Field>
			{/if}
			<Field label="Domain">
				<InspectorToggle
					checked={block.domain !== undefined}
					label="Explicit domain"
					onchange={toggleDomain}
				/>
			</Field>
			{#if block.domain}
				<Field label="Minimum">
					<input
						type="number"
						step="any"
						aria-label="Chart domain minimum"
						value={block.domain.min ?? ''}
						onchange={(event) => commitDomainBound(event, 'min')}
					/>
				</Field>
				<Field label="Maximum">
					<input
						type="number"
						step="any"
						aria-label="Chart domain maximum"
						value={block.domain.max ?? ''}
						onchange={(event) => commitDomainBound(event, 'max')}
					/>
				</Field>
			{/if}
		{:else}
			<Field label="Total">
				<input
					type="number"
					aria-label="Normalized chart total"
					min="0"
					step="any"
					value={block.normalization.total}
					onchange={commitNormalizationTotal}
				/>
			</Field>
			<Field label="Units">
				<input
					type="number"
					aria-label="Normalized chart unit count"
					min="10"
					max="1000"
					step="1"
					value={block.normalization.unitCount}
					onchange={commitUnitCount}
				/>
			</Field>
		{/if}
	</InspectorSection>

	<InspectorSection label="Labels">
		<Field label="Categories">
			<InspectorToggle
				checked={block.labels.categories ?? true}
				label="Category labels"
				onchange={(checked) => (block.labels.categories = checked)}
			/>
		</Field>
		<Field label="Values">
			<InspectorToggle
				checked={block.labels.values}
				label="Value labels"
				onchange={(checked) => (block.labels.values = checked)}
			/>
		</Field>
		<Field label="Legend">
			<InspectorToggle
				checked={block.labels.legend}
				label="Legend"
				onchange={(checked) => (block.labels.legend = checked)}
			/>
		</Field>
		<Field label="Fill">
			<select
				aria-label="Chart fill role"
				value={block.fill.role}
				onchange={(event) => {
					block.fill.role = (event.currentTarget as HTMLSelectElement).value as
						'default' | 'series';
				}}
			>
				<option value="default">Default</option>
				<option value="series">Series</option>
			</select>
		</Field>
	</InspectorSection>

	<ChartTargetsSection {blockId} entryKind="highlight" />
	<ChartTargetsSection {blockId} entryKind="callout" />
	<ChartMotionSection {blockId} />
{/if}
