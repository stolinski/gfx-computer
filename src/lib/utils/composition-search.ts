/**
 * The text a library search compares against: what the person typed, trimmed
 * and lower-cased. An empty result means no search is in force.
 */
export function normalizeCompositionSearchQuery(query: string): string {
	return query.trim().toLowerCase();
}

/**
 * Whether a composition is a match for a normalized search query
 * (`normalizeCompositionSearchQuery`): the query appears in its name or in its
 * slug. With no query in force everything matches.
 */
export function matchesCompositionSearchQuery(
	normalizedQuery: string,
	name: string,
	slug: string
): boolean {
	if (normalizedQuery === '') return true;
	return (
		name.toLowerCase().includes(normalizedQuery) || slug.toLowerCase().includes(normalizedQuery)
	);
}
