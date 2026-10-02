<script lang="ts">
	import {
		DIAGRAM_LABEL_TEXT_BOX_MAX_WIDTH,
		DIAGRAM_LABEL_TEXT_BOX_MIN_WIDTH,
		type DiagramEdgeGeometry,
		type DiagramEndpoint,
		type DiagramLabelGeometry,
		type DiagramPositionGeometry,
		type DiagramPrimitive
	} from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import {
		cloneDiagramPrimitiveGeometry,
		resolveDiagramPrimitiveGeometry
	} from '$lib/utils/diagram-geometry';
	import Field from './Field.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import InspectorSection from './InspectorSection.svelte';

	// The Block's explicit placement (ADR-0036 §7): every positional number is
	// a first-class field. Route/control belong to the edge's orientation
	// geometry; position + scale belong to the DOM primitives.
	interface Props {
		primitive: DiagramPrimitive;
	}

	let { primitive: el }: Props = $props();

	const nodeOptions = $derived(
		(engineState.surface.diagram ?? []).filter((entry) => entry.type === 'node')
	);

	function fraction(value: string): number | null {
		const n = Number(value);
		return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
	}

	function setPoint(point: { x: number; y: number }, axis: 'x' | 'y', value: string): void {
		const n = fraction(value);
		if (n !== null) point[axis] = n;
	}

	function setScale(geometry: DiagramPositionGeometry, value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		geometry.scale = Math.max(0.25, Math.min(4, n));
	}

	function setTextBoxWidth(geometry: DiagramLabelGeometry, value: string): void {
		if (value.trim() === '') {
			geometry.maxWidth = undefined;
			return;
		}
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		geometry.maxWidth = Math.max(
			DIAGRAM_LABEL_TEXT_BOX_MIN_WIDTH,
			Math.min(DIAGRAM_LABEL_TEXT_BOX_MAX_WIDTH, n)
		);
	}

	// Endpoint editing: a node ref or an explicit point. Switching to `point`
	// materialises the endpoint's current node centre-ish default; switching to
	// `node` takes the first node.
	function endpointMode(endpoint: DiagramEndpoint): 'node' | 'point' {
		return 'node' in endpoint ? 'node' : 'point';
	}

	function setEndpointMode(geometry: DiagramEdgeGeometry, end: 'from' | 'to', mode: string): void {
		const current = geometry[end];
		if (mode === 'node') {
			const first = nodeOptions[0];
			if (!first) return;
			geometry[end] = { node: 'node' in current ? current.node : first.id };
		} else {
			geometry[end] = 'node' in current ? { x: 0.5, y: 0.5 } : current;
		}
	}

	function setEndpointNode(geometry: DiagramEdgeGeometry, end: 'from' | 'to', id: string): void {
		geometry[end] = { node: id };
	}

	function toggleControl(geometry: DiagramEdgeGeometry, enabled: boolean): void {
		geometry.control = enabled ? { x: 0.5, y: 0.4 } : undefined;
	}

	function toggleOrientationCustomization(checked: boolean): void {
		const orientation = engineState.transport.orientation;
		if (checked) {
			// The branches are textually identical but must stay separate: the
			// geometry resolver's overloads only resolve on a narrowed primitive.
			switch (el.type) {
				case 'node':
				case 'stat-callout': {
					const geometry = cloneDiagramPrimitiveGeometry(
						resolveDiagramPrimitiveGeometry(el, orientation)
					);
					if (!el.orientationOverrides) el.orientationOverrides = {};
					el.orientationOverrides[orientation] = geometry;
					return;
				}
				case 'label': {
					const geometry = cloneDiagramPrimitiveGeometry(
						resolveDiagramPrimitiveGeometry(el, orientation)
					);
					if (!el.orientationOverrides) el.orientationOverrides = {};
					el.orientationOverrides[orientation] = geometry;
					return;
				}
				case 'edge-arrow': {
					const geometry = cloneDiagramPrimitiveGeometry(
						resolveDiagramPrimitiveGeometry(el, orientation)
					);
					if (!el.orientationOverrides) el.orientationOverrides = {};
					el.orientationOverrides[orientation] = geometry;
					return;
				}
				case 'timeline-segment': {
					const geometry = cloneDiagramPrimitiveGeometry(
						resolveDiagramPrimitiveGeometry(el, orientation)
					);
					if (!el.orientationOverrides) el.orientationOverrides = {};
					el.orientationOverrides[orientation] = geometry;
					return;
				}
			}
		}

		const overrides = el.orientationOverrides;
		if (!overrides) return;
		delete overrides[orientation];
		if (!overrides.horizontal && !overrides.vertical) {
			el.orientationOverrides = undefined;
		}
	}
</script>

<InspectorSection label="Geometry">
	{#snippet action()}
		<OrientationCustomizeToggle
			customized={el.orientationOverrides?.[engineState.transport.orientation] !== undefined}
			onchange={toggleOrientationCustomization}
		/>
	{/snippet}
	{#if el.type === 'edge-arrow'}
		{@const geometry = resolveDiagramPrimitiveGeometry(el, engineState.transport.orientation)}
		{#each ['from', 'to'] as const as end (end)}
			{@const endpoint = geometry[end]}
			<Field label={end === 'from' ? 'From' : 'To'}>
				<select
					value={endpointMode(endpoint)}
					onchange={(e) =>
						setEndpointMode(geometry, end, (e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="node" disabled={nodeOptions.length === 0}>node</option>
					<option value="point">point</option>
				</select>
				{#if 'node' in endpoint}
					<select
						value={endpoint.node}
						onchange={(e) =>
							setEndpointNode(geometry, end, (e.currentTarget as HTMLSelectElement).value)}
					>
						{#each nodeOptions as candidate (candidate.id)}
							<option value={candidate.id}>{candidate.id}</option>
						{/each}
					</select>
				{:else}
					<input
						type="number"
						min="0"
						max="1"
						step="any"
						value={endpoint.x}
						aria-label="{end} x"
						oninput={(e) => setPoint(endpoint, 'x', (e.currentTarget as HTMLInputElement).value)}
					/>
					<input
						type="number"
						min="0"
						max="1"
						step="any"
						value={endpoint.y}
						aria-label="{end} y"
						oninput={(e) => setPoint(endpoint, 'y', (e.currentTarget as HTMLInputElement).value)}
					/>
				{/if}
			</Field>
		{/each}
		<Field label="Route">
			<select
				value={geometry.route}
				onchange={(e) => {
					geometry.route = (e.currentTarget as HTMLSelectElement).value as typeof geometry.route;
				}}
			>
				<option value="straight">straight</option>
				<option value="elbow">elbow</option>
				<option value="arc">arc</option>
			</select>
		</Field>
		<Field label="Control">
			<InspectorToggle
				checked={geometry.control !== undefined}
				label="Curve control point"
				onchange={(checked) => toggleControl(geometry, checked)}
			/>
			{#if geometry.control}
				{@const control = geometry.control}
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={control.x}
					aria-label="control x"
					oninput={(e) => setPoint(control, 'x', (e.currentTarget as HTMLInputElement).value)}
				/>
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={control.y}
					aria-label="control y"
					oninput={(e) => setPoint(control, 'y', (e.currentTarget as HTMLInputElement).value)}
				/>
			{/if}
		</Field>
	{:else if el.type === 'timeline-segment'}
		{@const geometry = resolveDiagramPrimitiveGeometry(el, engineState.transport.orientation)}
		{#each ['from', 'to'] as const as end (end)}
			{@const point = geometry[end]}
			<Field label={end === 'from' ? 'From' : 'To'}>
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={point.x}
					aria-label="{end} x"
					oninput={(e) => setPoint(point, 'x', (e.currentTarget as HTMLInputElement).value)}
				/>
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={point.y}
					aria-label="{end} y"
					oninput={(e) => setPoint(point, 'y', (e.currentTarget as HTMLInputElement).value)}
				/>
			</Field>
		{/each}
	{:else}
		{@const geometry = resolveDiagramPrimitiveGeometry(el, engineState.transport.orientation)}
		<Field label="X">
			<input
				type="number"
				min="0"
				max="1"
				step="any"
				value={geometry.position.x}
				oninput={(e) =>
					setPoint(geometry.position, 'x', (e.currentTarget as HTMLInputElement).value)}
			/>
		</Field>
		<Field label="Y">
			<input
				type="number"
				min="0"
				max="1"
				step="any"
				value={geometry.position.y}
				oninput={(e) =>
					setPoint(geometry.position, 'y', (e.currentTarget as HTMLInputElement).value)}
			/>
		</Field>
		<Field label="Scale">
			<input
				type="number"
				min="0.25"
				max="4"
				step="any"
				value={geometry.scale ?? 1}
				oninput={(e) => setScale(geometry, (e.currentTarget as HTMLInputElement).value)}
			/>
		</Field>
		{#if el.type === 'label'}
			{@const labelGeometry = resolveDiagramPrimitiveGeometry(
				el,
				engineState.transport.orientation
			)}
			<Field label="Width">
				<input
					type="number"
					min={DIAGRAM_LABEL_TEXT_BOX_MIN_WIDTH}
					max={DIAGRAM_LABEL_TEXT_BOX_MAX_WIDTH}
					step="any"
					value={labelGeometry.maxWidth ?? ''}
					placeholder="auto"
					oninput={(e) =>
						setTextBoxWidth(labelGeometry, (e.currentTarget as HTMLInputElement).value)}
				/>
			</Field>
		{/if}
	{/if}
</InspectorSection>
