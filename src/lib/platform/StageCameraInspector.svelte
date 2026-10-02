<script lang="ts">
	import { engineState } from './engine-state.svelte';
	import {
		ENGINE_EASES,
		STAGE_CAMERA_POSE_LIMITS,
		type Ease,
		type StageCameraPose,
		type StageCameraTravel
	} from './engine-schema';
	import {
		parseUnitIntervalInput,
		restStageCameraPose,
		setStageCameraPoseAim,
		setStageCameraPoseAngle,
		setStageCameraPoseDistance,
		stageCameraTravelFrom
	} from './stage-camera-editing';
	import InspectorSection from './InspectorSection.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';
	import Field from './Field.svelte';

	// The Camera inspector (ADR-0060 §2): what the Camera row opens. The legacy
	// move, the rest pose, its one travel, and the vertical camera — the fields
	// the stage camera has (ADR-0057, ADR-0059), edited where the entity is
	// selected. Only the tall frame can carry its own camera, so the shared
	// Customize control appears there; while it is on, the pose and travel
	// fields edit the vertical camera. Reachable only while the stage is on, so `stage` is never absent
	// in practice; the guard keeps the component honest if the row outlives it.
	const easeOptions = Object.entries(ENGINE_EASES) as [Ease, (typeof ENGINE_EASES)[Ease]][];

	const POSE_ANGLE_FIELDS = [
		{ key: 'yaw', label: 'Yaw°', limit: STAGE_CAMERA_POSE_LIMITS.yawDegrees },
		{ key: 'pitch', label: 'Pitch°', limit: STAGE_CAMERA_POSE_LIMITS.pitchDegrees },
		{ key: 'roll', label: 'Roll°', limit: STAGE_CAMERA_POSE_LIMITS.rollDegrees }
	] as const;

	const verticalFrame = $derived(engineState.transport.orientation === 'vertical');
	// The pose and travel the fields edit: the vertical camera's while the tall
	// frame is customized, else the shared camera's. An absent vertical field
	// keeps the shared one, so its fields start from the shared values.
	const cameraOwner = $derived.by(() => {
		const camera = engineState.stage?.camera;
		if (!camera) return null;
		return verticalFrame && camera.vertical ? camera.vertical : camera;
	});

	function togglePose(): void {
		const stage = engineState.stage;
		const owner = cameraOwner;
		if (!stage || !owner) return;
		if (owner.pose) {
			owner.pose = undefined;
			return;
		}
		const shared = stage.camera.pose;
		owner.pose =
			owner !== stage.camera && shared
				? { ...shared, aim: { ...shared.aim } }
				: restStageCameraPose();
	}

	function toggleTravel(): void {
		const stage = engineState.stage;
		const owner = cameraOwner;
		if (!stage || !owner) return;
		owner.travel = owner.travel
			? undefined
			: stageCameraTravelFrom(owner.pose ?? stage.camera.pose ?? restStageCameraPose());
	}

	// The vertical camera starts as a copy of the horizontal pose and travel,
	// so turning it on changes nothing until a field moves.
	function toggleVertical(checked: boolean): void {
		const stage = engineState.stage;
		if (!stage) return;
		if (!checked) {
			stage.camera.vertical = undefined;
			return;
		}
		const pose = stage.camera.pose ?? restStageCameraPose();
		const travel = stage.camera.travel;
		stage.camera.vertical = {
			pose: { ...pose, aim: { ...pose.aim } },
			travel: travel
				? { ...travel, to: { ...travel.to, aim: travel.to.aim ? { ...travel.to.aim } : undefined } }
				: undefined
		};
	}
</script>

{#snippet poseFields(pose: StageCameraPose, prefix: string)}
	{#each POSE_ANGLE_FIELDS as field (field.key)}
		<Field label={`${prefix}${field.label}`}>
			<input
				type="number"
				min={-field.limit}
				max={field.limit}
				step="any"
				value={pose[field.key]}
				oninput={(e) =>
					setStageCameraPoseAngle(
						pose,
						field.key,
						Number((e.currentTarget as HTMLInputElement).value),
						field.limit
					)}
			/>
		</Field>
	{/each}
	<Field label={`${prefix}Distance`}>
		<input
			type="number"
			min={STAGE_CAMERA_POSE_LIMITS.minDistance}
			max={STAGE_CAMERA_POSE_LIMITS.maxDistance}
			step="any"
			value={pose.distance}
			oninput={(e) =>
				setStageCameraPoseDistance(pose, Number((e.currentTarget as HTMLInputElement).value))}
		/>
	</Field>
	<Field label={`${prefix}Aim`}>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${prefix}Aim x`}
			value={pose.aim.x}
			oninput={(e) =>
				setStageCameraPoseAim(pose, 'x', Number((e.currentTarget as HTMLInputElement).value))}
		/>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${prefix}Aim y`}
			value={pose.aim.y}
			oninput={(e) =>
				setStageCameraPoseAim(pose, 'y', Number((e.currentTarget as HTMLInputElement).value))}
		/>
	</Field>
{/snippet}

{#snippet travelFields(
	travel: StageCameraTravel,
	pose: StageCameraPose | undefined,
	prefix: string
)}
	{#each POSE_ANGLE_FIELDS as field (field.key)}
		<Field label={`${prefix}To ${field.label}`}>
			<input
				type="number"
				min={-field.limit}
				max={field.limit}
				step="any"
				value={travel.to[field.key] ?? pose?.[field.key] ?? 0}
				oninput={(e) =>
					setStageCameraPoseAngle(
						travel.to,
						field.key,
						Number((e.currentTarget as HTMLInputElement).value),
						field.limit
					)}
			/>
		</Field>
	{/each}
	<Field label={`${prefix}To distance`}>
		<input
			type="number"
			min={STAGE_CAMERA_POSE_LIMITS.minDistance}
			max={STAGE_CAMERA_POSE_LIMITS.maxDistance}
			step="any"
			value={travel.to.distance ?? pose?.distance ?? 1}
			oninput={(e) =>
				setStageCameraPoseDistance(travel.to, Number((e.currentTarget as HTMLInputElement).value))}
		/>
	</Field>
	<Field label={`${prefix}To aim`}>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${prefix}Travel aim x`}
			value={travel.to.aim?.x ?? pose?.aim.x ?? 0.5}
			oninput={(e) =>
				setStageCameraPoseAim(travel.to, 'x', Number((e.currentTarget as HTMLInputElement).value))}
		/>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${prefix}Travel aim y`}
			value={travel.to.aim?.y ?? pose?.aim.y ?? 0.5}
			oninput={(e) =>
				setStageCameraPoseAim(travel.to, 'y', Number((e.currentTarget as HTMLInputElement).value))}
		/>
	</Field>
	<Field label={`${prefix}Travel window`}>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${prefix}Travel start`}
			value={travel.start}
			oninput={(e) => {
				const n = parseUnitIntervalInput((e.currentTarget as HTMLInputElement).value);
				if (n !== null) travel.start = n;
			}}
		/>
		<input
			type="number"
			min="0"
			max="1"
			step="any"
			aria-label={`${prefix}Travel duration`}
			value={travel.duration}
			oninput={(e) => {
				const n = parseUnitIntervalInput((e.currentTarget as HTMLInputElement).value);
				if (n !== null) travel.duration = n;
			}}
		/>
	</Field>
	<Field label={`${prefix}Travel ease`}>
		<select
			value={travel.ease}
			onchange={(e) => {
				travel.ease = (e.currentTarget as HTMLSelectElement).value as Ease;
			}}
		>
			{#each easeOptions as [value, opt] (value)}
				<option {value}>{opt.label}</option>
			{/each}
		</select>
	</Field>
{/snippet}

{#if engineState.stage}
	{@const stage = engineState.stage}
	<InspectorSection label="Camera">
		{#snippet action()}
			{#if verticalFrame}
				<OrientationCustomizeToggle
					customized={!!stage.camera.vertical}
					onchange={toggleVertical}
				/>
			{/if}
		{/snippet}
		<Field label="Move">
			<select
				value={stage.camera.move}
				onchange={(e) => {
					stage.camera.move = (e.currentTarget as HTMLSelectElement).value as
						'static' | 'push' | 'drift';
				}}
			>
				<option value="static">Static</option>
				<option value="push">Push</option>
				<option value="drift">Drift</option>
			</select>
		</Field>
		{#if stage.camera.move !== 'static'}
			<Field label="Amount">
				<input
					type="number"
					min="0"
					max="1"
					step="any"
					value={stage.camera.amount ?? 0.15}
					oninput={(e) => {
						stage.camera.amount = parseFloat((e.currentTarget as HTMLInputElement).value) || 0.15;
					}}
				/>
			</Field>
			<Field label="Ease">
				<select
					value={stage.camera.ease}
					onchange={(e) => {
						stage.camera.ease = (e.currentTarget as HTMLSelectElement).value as Ease;
					}}
				>
					{#each easeOptions as [value, opt] (value)}
						<option {value}>{opt.label}</option>
					{/each}
				</select>
			</Field>
		{/if}
		{#if cameraOwner}
			{@const owner = cameraOwner}
			<Field label="Pose">
				<InspectorToggle checked={!!owner.pose} label="Camera pose" onchange={togglePose} />
			</Field>
			{#if owner.pose}
				{@render poseFields(owner.pose, '')}
			{/if}
			<Field label="Travel">
				<InspectorToggle checked={!!owner.travel} label="Camera travel" onchange={toggleTravel} />
			</Field>
			{#if owner.travel}
				{@render travelFields(owner.travel, owner.pose ?? stage.camera.pose, '')}
			{/if}
		{/if}
	</InspectorSection>
{/if}
