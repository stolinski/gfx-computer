import { getPacksPage } from '$lib/server/packs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return getPacksPage();
};
