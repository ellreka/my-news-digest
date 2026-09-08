/**
 * Open article source links in another tab during Markdown rendering.
 * Register on Astro's existing Sätteri processor without another dependency.
 * @returns {import('astro').AstroIntegration}
 */
export default function externalLinks() {
	return {
		name: 'digest-external-links',
			hooks: {
			'astro:config:setup': ({ config }) => {
				if (!config.site) throw new Error('digest-external-links requires a configured site URL.');
				const site = new URL(config.site);
				const digestDirectory = new URL('src/content/docs/digests/', config.root).href;
				const processor = config.markdown.processor;
				const options = /** @type {{ hastPlugins?: unknown[] }} */ (processor.options);
				if (processor.name !== 'satteri' || !Array.isArray(options.hastPlugins)) {
					throw new Error('digest-external-links requires the Sätteri Markdown processor.');
				}

				options.hastPlugins.push({
					name: 'digest-external-links',
					element: {
						filter: ['a'],
						/**
						 * @param {{ properties: Record<string, unknown> }} node
						 * @param {{ fileURL?: URL, setProperty: (node: object, key: string, value: unknown) => void }} context
						 */
						visit(node, context) {
							if (!context.fileURL?.href.startsWith(digestDirectory)) return;
							const { href, rel } = node.properties;
							if (typeof href !== 'string') return;

							let destination;
							try {
								destination = new URL(href, site);
							} catch {
								return;
							}
							if (!['http:', 'https:'].includes(destination.protocol)) return;
							if (destination.origin === site.origin) return;

							const relations = Array.isArray(rel)
								? rel.map(String)
								: typeof rel === 'string' ? rel.split(/\s+/).filter(Boolean) : [];
							context.setProperty(node, 'target', '_blank');
							context.setProperty(node, 'rel', [...new Set([...relations, 'noopener', 'noreferrer'])]);
						},
					},
				});
			},
		},
	};
}
