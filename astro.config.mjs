// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import externalLinks from './src/plugins/external-links.mjs';

// 実ドメインに合わせて置換する
const SITE = 'https://news.example.com';

// https://astro.build/config
export default defineConfig({
	site: SITE,
	integrations: [
		externalLinks(),
		starlight({
			title: 'ニュースダイジェスト',
			locales: {
				root: { label: '日本語', lang: 'ja' },
			},
			// 一般公開しないため全ページ noindex
			head: [
				{
					tag: 'meta',
					attrs: { name: 'robots', content: 'noindex, nofollow' },
				},
			],
			sidebar: [
				{
					label: 'ダイジェスト',
					items: [{ autogenerate: { directory: 'digests' } }],
				},
			],
			// サイドバーを日付降順（新しい順）に並べ替える
			routeMiddleware: './src/starlightRouteData.ts',
			pagefind: true,
			components: {
				MarkdownContent: './src/components/MarkdownContent.astro',
			},
		}),
	],
});
