<script lang="ts">
	import type { OverlayEditorProps } from '$lib/platform/pipelines/types';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import Field from '$lib/platform/Field.svelte';
	import OrientationCustomizeToggle from '$lib/platform/OrientationCustomizeToggle.svelte';
	import {
		resolveMultiplayerSessionLayout,
		resolveMultiplayerSessionUserColor
	} from '$lib/utils/multiplayer-session-scene';
	import {
		MULTIPLAYER_SESSION_DEFAULT_LAYOUT,
		MULTIPLAYER_SESSION_DEFAULT_SIZES,
		MULTIPLAYER_SESSION_FORK_SIDES,
		type MultiplayerSessionContent,
		type MultiplayerSessionEvent,
		type MultiplayerSessionLayout
	} from './definition';

	let { overlay = $bindable() }: OverlayEditorProps<MultiplayerSessionContent> = $props();

	const MAX_USERS = 4;
	const MAX_EVENTS = 40;
	const EVENT_KINDS: MultiplayerSessionEvent['kind'][] = ['join', 'type', 'send', 'step', 'fork', 'wait'];
	const SIZE_FIELDS: { key: keyof typeof MULTIPLAYER_SESSION_DEFAULT_SIZES; label: string; max: number }[] = [
		{ key: 'textSize', label: 'Text size', max: 10 },
		{ key: 'titleSize', label: 'Title size', max: 10 },
		{ key: 'nameSize', label: 'Name size', max: 10 },
		{ key: 'cursorSize', label: 'Cursor size', max: 20 },
		{ key: 'paddingX', label: 'Padding X', max: 20 },
		{ key: 'paddingY', label: 'Padding Y', max: 20 },
		{ key: 'gap', label: 'Gap', max: 20 },
		{ key: 'radius', label: 'Corner', max: 10 }
	];
	const COLOR_FIELDS: { key: 'windowColor' | 'inkColor' | 'accentColor'; label: string; fallback: string }[] = [
		{ key: 'windowColor', label: 'Window', fallback: '#0e0e0d' },
		{ key: 'inkColor', label: 'Ink', fallback: '#f7f6f2' },
		{ key: 'accentColor', label: 'Accent', fallback: '#ffd54a' }
	];

	const orientation = $derived(engineState.transport.orientation);
	const customLayout = $derived(overlay.content.orientationOverrides?.[orientation]);
	const layout = $derived(
		resolveMultiplayerSessionLayout(
			{
				x: overlay.content.x ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.x,
				y: overlay.content.y ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.y,
				width: overlay.content.width ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.width,
				height: overlay.content.height ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.height,
				forkSide: overlay.content.forkSide ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.forkSide
			},
			overlay.content.orientationOverrides,
			orientation
		)
	);

	// Customize copies the layout this orientation shows now into its own
	// snapshot; turning it off returns the orientation to the shared layout.
	function toggleLayoutOverride(checked: boolean): void {
		const overrides = { ...overlay.content.orientationOverrides };
		if (checked) overrides[orientation] = { ...layout };
		else delete overrides[orientation];
		overlay.content.orientationOverrides =
			overrides.horizontal || overrides.vertical ? overrides : undefined;
	}

	function setLayout<K extends keyof MultiplayerSessionLayout>(field: K, value: MultiplayerSessionLayout[K]): void {
		const custom = overlay.content.orientationOverrides?.[orientation];
		const target: MultiplayerSessionLayout = custom ?? overlay.content;
		target[field] = value;
	}

	function numberFrom(event: Event, min: number, max: number): number | undefined {
		const n = Number((event.currentTarget as HTMLInputElement).value);
		return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined;
	}

	function addUser(): void {
		const taken = new Set(overlay.content.users.map((user) => user.id));
		let index = overlay.content.users.length + 1;
		while (taken.has(`person-${index}`)) index += 1;
		overlay.content.users.push({ id: `person-${index}`, name: `Person ${index}` });
	}

	function removeUser(index: number): void {
		const [removed] = overlay.content.users.splice(index, 1);
		overlay.content.events = overlay.content.events.filter(
			(event) => !('user' in event) || event.user !== removed.id
		);
		if (overlay.content.events.length === 0) addEvent();
	}

	function newEvent(kind: MultiplayerSessionEvent['kind'], at: number): MultiplayerSessionEvent {
		const user = overlay.content.users[0].id;
		switch (kind) {
			case 'join':
				return { kind, user, at };
			case 'type':
				return { kind, user, text: 'a new idea', at, duration: 0.1 };
			case 'send':
				return { kind, user, at };
			case 'step':
				return { kind, tool: 'read', text: 'a file', at };
			case 'fork':
				return { kind, label: 'a child run', at };
			case 'wait':
				return { kind, text: 'Approve this?', timerSeconds: 120, at };
		}
	}

	function addEvent(): void {
		const last = overlay.content.events.at(-1);
		overlay.content.events.push(newEvent('step', Math.min(1, (last?.at ?? 0) + 0.05)));
	}

	function changeEventKind(index: number, kind: MultiplayerSessionEvent['kind']): void {
		overlay.content.events[index] = newEvent(kind, overlay.content.events[index].at);
	}
</script>

<Field label="Title">
	<input type="text" bind:value={overlay.content.title} maxlength="32" />
</Field>
<Field label="Layout">
	<OrientationCustomizeToggle customized={customLayout !== undefined} onchange={toggleLayoutOverride} />
</Field>
<Field label="Place">
	<input type="number" aria-label="Left" min="0" max="1" step="0.01" value={layout.x} oninput={(e) => { const n = numberFrom(e, 0, 1); if (n !== undefined) setLayout('x', n); }} />
	<input type="number" aria-label="Top" min="0" max="1" step="0.01" value={layout.y} oninput={(e) => { const n = numberFrom(e, 0, 1); if (n !== undefined) setLayout('y', n); }} />
</Field>
<Field label="Size">
	<input type="number" aria-label="Width" min="0.2" max="1" step="0.01" value={layout.width} oninput={(e) => { const n = numberFrom(e, 0.2, 1); if (n !== undefined) setLayout('width', n); }} />
	<input type="number" aria-label="Height" min="0.2" max="1" step="0.01" value={layout.height} oninput={(e) => { const n = numberFrom(e, 0.2, 1); if (n !== undefined) setLayout('height', n); }} />
</Field>
<Field label="Forks">
	<select value={layout.forkSide} onchange={(e) => setLayout('forkSide', (e.currentTarget as HTMLSelectElement).value as MultiplayerSessionLayout['forkSide'])}>
		{#each MULTIPLAYER_SESSION_FORK_SIDES as side (side)}
			<option value={side}>{side}</option>
		{/each}
	</select>
</Field>
{#each SIZE_FIELDS as field (field.key)}
	<Field label={field.label}>
		<input
			type="number"
			min="0"
			max={field.max}
			step="0.1"
			value={overlay.content[field.key] ?? MULTIPLAYER_SESSION_DEFAULT_SIZES[field.key]}
			oninput={(e) => { const n = numberFrom(e, 0, field.max); if (n !== undefined) overlay.content[field.key] = n; }}
		/>
	</Field>
{/each}
{#each COLOR_FIELDS as field (field.key)}
	<Field label={field.label}>
		<input
			type="color"
			value={overlay.content[field.key] ?? field.fallback}
			oninput={(e) => (overlay.content[field.key] = (e.currentTarget as HTMLInputElement).value)}
		/>
		{#if overlay.content[field.key]}
			<button type="button" onclick={() => (overlay.content[field.key] = undefined)}>Pack</button>
		{/if}
	</Field>
{/each}

{#each overlay.content.users as user, index (user.id)}
	<Field label={`Person ${index + 1}`}>
		<input type="text" aria-label="Name" maxlength="20" bind:value={user.name} />
		<input
			type="color"
			aria-label="Colour"
			value={resolveMultiplayerSessionUserColor(overlay.content, user.id)}
			oninput={(e) => (user.color = (e.currentTarget as HTMLInputElement).value)}
		/>
		{#if overlay.content.users.length > 1}
			<button type="button" onclick={() => removeUser(index)}>Remove</button>
		{/if}
	</Field>
{/each}
{#if overlay.content.users.length < MAX_USERS}
	<button type="button" onclick={addUser}>Add person</button>
{/if}

{#each overlay.content.events as event, index (index)}
	<Field label={`At ${index + 1}`}>
		<select value={event.kind} onchange={(e) => changeEventKind(index, (e.currentTarget as HTMLSelectElement).value as MultiplayerSessionEvent['kind'])}>
			{#each EVENT_KINDS as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>
		<input type="number" aria-label="Time" min="0" max="1" step="0.005" bind:value={event.at} />
		{#if overlay.content.events.length > 1}
			<button type="button" onclick={() => overlay.content.events.splice(index, 1)}>Remove</button>
		{/if}
	</Field>
	{#if 'user' in event}
		<Field label="Who">
			<select
				value={event.user ?? ''}
				onchange={(e) => {
					const value = (e.currentTarget as HTMLSelectElement).value;
					if (event.kind === 'fork') event.user = value.length > 0 ? value : undefined;
					else if (value.length > 0) event.user = value;
				}}
			>
				{#if event.kind === 'fork'}<option value="">nobody</option>{/if}
				{#each overlay.content.users as user (user.id)}
					<option value={user.id}>{user.name}</option>
				{/each}
			</select>
		</Field>
	{/if}
	{#if event.kind === 'type'}
		<Field label="Types">
			<input type="text" maxlength="60" bind:value={event.text} />
			<input type="number" aria-label="Typing time" min="0.001" max="1" step="0.005" bind:value={event.duration} />
		</Field>
	{:else if event.kind === 'send'}
		<Field label="Tag">
			<input type="text" maxlength="16" value={event.tag ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; event.tag = v.length > 0 ? v : undefined; }} />
		</Field>
	{:else if event.kind === 'step'}
		<Field label="Step">
			<input type="text" aria-label="Tool" maxlength="16" bind:value={event.tool} />
			<input type="text" aria-label="Text" maxlength="60" bind:value={event.text} />
		</Field>
	{:else if event.kind === 'fork'}
		<Field label="Fork">
			<input type="text" aria-label="Label" maxlength="32" bind:value={event.label} />
			<input type="text" aria-label="Detail" maxlength="40" value={event.detail ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; event.detail = v.length > 0 ? v : undefined; }} />
		</Field>
	{:else if event.kind === 'wait'}
		<Field label="Waits on">
			<input type="text" maxlength="48" bind:value={event.text} />
			<input type="number" aria-label="Timer seconds" min="1" max="5999" step="1" value={event.timerSeconds ?? ''} oninput={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); event.timerSeconds = Number.isInteger(n) && n >= 1 ? Math.min(5999, n) : undefined; }} />
		</Field>
	{/if}
{/each}
{#if overlay.content.events.length < MAX_EVENTS}
	<button type="button" onclick={addEvent}>Add moment</button>
{/if}
