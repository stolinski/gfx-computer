/**
 * The slug a composition is stored under in the session: the id in `/p/<slug>`
 * and the key the session store writes.
 *
 * Derived from the composition's own name so a stored piece is recognizable in
 * a URL, and de-duplicated against the slugs already taken — the store
 * overwrites by slug, so a colliding slug silently replaces someone's work, and
 * a corpus Preset's slug is its Starter's own route, which no store writes under.
 */

/** The slug shape the session store accepts. */
export const COMPOSITION_SESSION_SLUG_PATTERN = /^[a-z0-9_-]+$/;

/** What a name with no slug-safe characters left in it becomes. */
export const FALLBACK_COMPOSITION_SESSION_SLUG = 'composition';

/** How long a derived slug runs before it is cut; a URL is not a title. */
export const COMPOSITION_SESSION_SLUG_MAX_LENGTH = 48;

/**
 * A composition name reduced to the store's slug alphabet: accents folded to
 * their base letters, everything else collapsed to single hyphens.
 */
export function slugifyCompositionName(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-_]+|[-_]+$/g, '')
		.slice(0, COMPOSITION_SESSION_SLUG_MAX_LENGTH)
		.replace(/[-_]+$/g, '');
	return slug || FALLBACK_COMPOSITION_SESSION_SLUG;
}

/**
 * The slug a new composition takes: its name's slug when that is free, and the
 * first numbered variant that is not when it is not.
 */
export function createCompositionSessionSlug(name: string, takenSlugs: Iterable<string>): string {
	const base = slugifyCompositionName(name);
	const taken = new Set(takenSlugs);
	if (!taken.has(base)) return base;

	let counter = 2;
	while (taken.has(`${base}-${counter}`)) counter += 1;
	return `${base}-${counter}`;
}
