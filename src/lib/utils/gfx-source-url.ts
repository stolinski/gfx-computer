import { parseGfxReleaseCommit } from '$lib/platform/release-acceptance-manifest';

/** The public repository GFX's source is offered from (ADR-0069 §4). */
export const GFX_SOURCE_REPOSITORY_URL = 'https://github.com/stolinski/gfx-computer';

/**
 * Where a person using this build can get its source: the repository at the
 * commit the build was made from, or the repository itself when the served
 * release names no commit.
 */
export function gfxSourceUrl(release: string | null): string {
	const commit = parseGfxReleaseCommit(release);
	return commit === null
		? GFX_SOURCE_REPOSITORY_URL
		: `${GFX_SOURCE_REPOSITORY_URL}/tree/${commit}`;
}
