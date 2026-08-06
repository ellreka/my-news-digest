import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import type { SidebarEntry } from '@astrojs/starlight/route-data';

/**
 * autogenerate されたサイドバーは `sidebar.order`（YYYYMMDD）の昇順・
 * ディレクトリ名の昇順で並ぶため、ダイジェスト配下を再帰的に反転させて
 * 新しい日付が上に来るようにする。
 */
function reverseDeep(entries: SidebarEntry[]): SidebarEntry[] {
	return entries
		.map((entry) =>
			entry.type === 'group'
				? { ...entry, entries: reverseDeep(entry.entries) }
				: entry
		)
		.reverse();
}

export const onRequest = defineRouteMiddleware((context) => {
	const { sidebar } = context.locals.starlightRoute;

	for (const entry of sidebar) {
		if (entry.type === 'group' && entry.label === 'ダイジェスト') {
			entry.entries = reverseDeep(entry.entries);
		}
	}
});
