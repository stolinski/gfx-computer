<script lang="ts">
	import { engineState } from './engine-state.svelte';
	import { STAGE_CAMERA_POSE_LIMITS, type Overlay, type OverlayPlacement } from './engine-schema';
	import { cloneOverlayPlacement, resolveOverlayPlacement } from '$lib/utils/overlay-placement';
	import { isStageBodyOverlay } from './pipelines/depth-stage-planes';
	import InspectorSection from './InspectorSection.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import Field from './Field.svelte';

	// The overlay's placement editor: anchor, offsets / normalized rect, scale,
	// rotation, and (while a depth stage or depth-of-field Effect is active)
	// the focal-plane z. Mutates the live engine-state placement in place.
	interface Props {
		overlay: Overlay;
	}

	let { overlay: ov }: Props = $props();

	// The anchor picker is a 3×3 placement grid (DaVinci-style) — the engine has
	// no middle-left/right anchors, so those two cells are structural voids, and
	// normalized-rect rides beside the grid as the free-placement mode.
	const ANCHOR_GRID: readonly (OverlayPlacement['anchor'] | null)[] = [
		'top-left',
		'top-center',
		'top-right',
		null,
		'center',
		null,
		'bottom-left',
		'bottom-center',
		'bottom-right'
	];

	const OFFSET_FIELDS = [
		{ key: 'x', label: 'Offset X' },
		{ key: 'y', label: 'Offset Y' }
	] as const;

	const RECT_FIELDS = [
		{ key: 'x', label: 'Rect X', fallback: 0 },
		{ key: 'y', label: 'Rect Y', fallback: 0 },
		{ key: 'width', label: 'Width', fallback: 1 },
		{ key: 'height', label: 'Height', fallback: 1 }
	] as const;

	const placement = $derived(
		resolveOverlayPlacement(ov.position, engineState.transport.orientation)
	);

	// Focal-plane z (ADR-0021 semantics, signed by ADR-0057): 0 = the Surface
	// plane, 1 = the backdrop, negative = lifted toward the camera; absent → the
	// Overlay-Layer default 0.7 at render, or the Surface plane (0) for a body
	// Overlay, which stands on the page (ADR-0062). Only consulted by the depth stage
	// (ADR-0028) and the depth-of-field Effect (rack focus rides its focusPull
	// params), so the row only shows then.
	const depthActive = $derived(
		engineState.stage !== undefined ||
			engineState.effects.some((effect) => effect.type === 'depth-of-field')
	);
	// A pose (ADR-0057) turns the Overlay's own plane on the depth stage; with
	// an explicit z it is what lifts the Overlay onto that plane.
	const stageActive = $derived(engineState.stage?.type === 'depth');

	const POSE_FIELDS = [
		{ key: 'yaw', label: 'Yaw°', limit: STAGE_CAMERA_POSE_LIMITS.yawDegrees },
		{ key: 'pitch', label: 'Pitch°', limit: STAGE_CAMERA_POSE_LIMITS.pitchDegrees },
		{ key: 'roll', label: 'Roll°', limit: STAGE_CAMERA_POSE_LIMITS.rollDegrees }
	] as const;

	function setPose(key: 'yaw' | 'pitch' | 'roll', value: string, limit: number): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		const pose = ov.pose ?? { yaw: 0, pitch: 0, roll: 0 };
		pose[key] = Math.max(-limit, Math.min(limit, n));
		ov.pose = pose;
	}

	function setAnchor(target: OverlayPlacement, value: string): void {
		target.anchor = value as OverlayPlacement['anchor'];
	}

	function setOffset(target: OverlayPlacement, key: 'x' | 'y', value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		if (!target.offset) target.offset = { x: 0, y: 0 };
		target.offset[key] = Math.max(0, Math.min(1, n));
	}

	// Normalized-rect placement (fractions of the composition; unclamped on
	// purpose — offscreen rects are how shader overlays park outside the frame).
	function setRect(
		target: OverlayPlacement,
		key: 'x' | 'y' | 'width' | 'height',
		value: string
	): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		if (!target.rect) target.rect = { x: 0, y: 0, width: 1, height: 1 };
		target.rect[key] = n;
	}

	function setScale(target: OverlayPlacement, value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		target.scale = Math.max(0.1, Math.min(8, n));
	}

	function setRotation(target: OverlayPlacement, value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		target.rotation = Math.max(-360, Math.min(360, n));
	}

	function setZ(value: string): void {
		const n = Number(value);
		if (!Number.isFinite(n)) return;
		ov.z = Math.max(-1, Math.min(1, n));
	}

	function toggleOrientationCustomization(checked: boolean): void {
		const orientation = engineState.transport.orientation;
		if (checked) {
			const cloned = cloneOverlayPlacement(resolveOverlayPlacement(ov.position, orientation));
			if (!ov.position.orientationOverrides) ov.position.orientationOverrides = {};
			ov.position.orientationOverrides[orientation] = cloned;
			return;
		}

		const overrides = ov.position.orientationOverrides;
		if (!overrides) return;
		delete overrides[orientation];
		if (!overrides.horizontal && !overrides.vertical) {
			ov.position.orientationOverrides = undefined;
		}
	}
</script>

<InspectorSection label="Position">
	{#snippet action()}
		<OrientationCustomizeToggle
			customized={ov.position.orientationOverrides?.[engineState.transport.orientation] !==
				undefined}
			onchange={toggleOrientationCustomization}
		/>
	{/snippet}
	<Field label="Anchor">
		<div class="anchor-grid" role="group" aria-label="Anchor position">
			{#each ANCHOR_GRID as anchor, cellIndex (cellIndex)}
				{#if anchor}
					<button
						type="button"
						class="anchor-grid__cell"
						aria-label="Anchor {anchor}"
						aria-pressed={placement.anchor === anchor}
						onclick={() => setAnchor(placement, anchor)}
					></button>
				{:else}
					<span class="anchor-grid__void" aria-hidden="true"></span>
				{/if}
			{/each}
		</div>
		<button
			type="button"
			class="anchor-rect"
			aria-pressed={placement.anchor === 'normalized-rect'}
			onclick={() => setAnchor(placement, 'normalized-rect')}
		>
			rect
		</button>
	</Field>
	{#if placement.anchor !== 'normalized-rect'}
		{#each OFFSET_FIELDS as field (field.key)}
			<Field label={field.label}>
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={placement.offset?.[field.key] ?? 0}
					oninput={(e) =>
						setOffset(placement, field.key, (e.currentTarget as HTMLInputElement).value)}
				/>
			</Field>
		{/each}
	{:else}
		{#each RECT_FIELDS as field (field.key)}
			<Field label={field.label}>
				<input
					type="number"
					step="any"
					value={placement.rect?.[field.key] ?? field.fallback}
					oninput={(e) =>
						setRect(placement, field.key, (e.currentTarget as HTMLInputElement).value)}
				/>
			</Field>
		{/each}
	{/if}
	<Field label="Scale">
		<input
			type="number"
			min="0.1"
			max="8"
			step="any"
			value={placement.scale ?? 1}
			oninput={(e) => setScale(placement, (e.currentTarget as HTMLInputElement).value)}
		/>
	</Field>
	<Field label="Rotation°">
		<input
			type="number"
			min="-360"
			max="360"
			step="any"
			value={placement.rotation ?? 0}
			oninput={(e) => setRotation(placement, (e.currentTarget as HTMLInputElement).value)}
		/>
	</Field>
	{#if depthActive}
		<Field label="Z">
			<input
				type="number"
				min="-1"
				max="1"
				step="any"
				value={ov.z ?? ''}
				placeholder={isStageBodyOverlay(ov) ? '0' : '0.7'}
				oninput={(e) => setZ((e.currentTarget as HTMLInputElement).value)}
			/>
			<button type="button" class="clear-btn" onclick={() => (ov.z = undefined)}>×</button>
		</Field>
	{/if}
	{#if stageActive}
		{#each POSE_FIELDS as field (field.key)}
			<Field label={field.label}>
				<input
					type="number"
					min={-field.limit}
					max={field.limit}
					step="any"
					value={ov.pose?.[field.key] ?? 0}
					oninput={(e) =>
						setPose(field.key, (e.currentTarget as HTMLInputElement).value, field.limit)}
				/>
			</Field>
		{/each}
		{#if ov.pose}
			<Field label="Pose">
				<button type="button" class="clear-btn" onclick={() => (ov.pose = undefined)}>×</button>
			</Field>
		{/if}
	{/if}
</InspectorSection>

<style>
	.anchor-grid {
		display: grid;
		gap: 3px;
		grid-template-columns: repeat(3, 14px);
	}

	.anchor-grid__cell {
		background: var(--chrome-well);
		block-size: 14px;
		border: 1px solid var(--chrome-hairline);
		border-radius: 3px;
		cursor: pointer;
		inline-size: 14px;
		padding: 0;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.anchor-grid__cell:hover {
		border-color: var(--chrome-muted);
	}

	.anchor-grid__cell[aria-pressed='true'] {
		background: #ffd608;
		border-color: #ffd608;
	}

	.anchor-grid__cell:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	.anchor-grid__void {
		background: var(--chrome-well);
		block-size: 14px;
		border: 1px solid var(--chrome-hairline);
		border-radius: 3px;
		inline-size: 14px;
		opacity: 0.45;
	}

	.anchor-rect {
		background: var(--chrome-well);
		border: 1px solid var(--chrome-hairline);
		border-radius: 3px;
		color: var(--chrome-muted);
		cursor: pointer;
		font-family: 'Paper Mono', monospace;
		font-size: 0.62rem;
		margin-inline-start: var(--vs-xs);
		padding: 3px 7px;
		transition:
			border-color 100ms ease,
			color 100ms ease;
	}

	.anchor-rect:hover {
		color: var(--chrome-text);
	}

	.anchor-rect[aria-pressed='true'] {
		border-color: #ffd608;
		color: var(--chrome-text);
	}

	.anchor-rect:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	.clear-btn {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex: none;
		font-size: 1rem;
		line-height: 1;
		padding: 0 var(--vs-xs);
	}

	.clear-btn:hover {
		color: #f0453d;
	}
</style>
