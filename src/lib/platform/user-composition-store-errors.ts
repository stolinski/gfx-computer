/**
 * The refusals a User composition store raises about a slug, shared by both
 * backends so a caller can tell them apart without reading a message.
 *
 * These live beside the store rather than inside it because the store module is
 * the one every caller mocks; an error class a caller must narrow on has to
 * survive that.
 */

/**
 * A delete asked of a store that holds nothing at that slug — a 404 from the
 * origin store, an absent record in the browser-scoped one.
 *
 * A caller that only wants the composition gone can treat this as the end
 * state it asked for. Every other caller still hears a refusal, so deleting a
 * composition that was never there stays an error where it should be one.
 */
export class UserCompositionNotHeldError extends Error {
	readonly slug: string;

	constructor(slug: string, message: string) {
		super(message);
		this.name = 'UserCompositionNotHeldError';
		this.slug = slug;
	}
}

export function isUserCompositionNotHeldError(
	value: unknown
): value is UserCompositionNotHeldError {
	return value instanceof UserCompositionNotHeldError;
}

/**
 * A create or a save asked for a slug a corpus Preset already has
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3).
 *
 * `/p/<corpus-slug>` always shows the pristine Starter, so a record stored
 * under that slug could never be opened again. Both stores refuse to write one:
 * a 409 from the origin store, a thrown refusal in the browser-scoped one.
 */
export class UserCompositionStarterSlugError extends Error {
	readonly slug: string;

	constructor(slug: string) {
		super(
			`"${slug}" is the slug of a Starter this engine ships, so no composition can be stored under it; store it under a new slug.`
		);
		this.name = 'UserCompositionStarterSlugError';
		this.slug = slug;
	}
}

export function isUserCompositionStarterSlugError(
	value: unknown
): value is UserCompositionStarterSlugError {
	return value instanceof UserCompositionStarterSlugError;
}
