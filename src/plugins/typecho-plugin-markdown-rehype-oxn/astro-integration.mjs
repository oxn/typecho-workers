/**
 * Build this plugin's browser assets before Astro/Vite evaluates plugin entrypoints.
 * This avoids relying on workspace postinstall scripts, which Bun may skip.
 */
export default function markdownRehypeBuildIntegration() {
  return {
    name: 'markdown-rehype-oxn-client-build',
    hooks: {
      'astro:config:setup': async ({ command, logger }) => {
        if (command !== 'build' && command !== 'dev') return;
        await import('./scripts/build-client.mjs');
        logger.info('Markdown Rehype OXN client assets are ready.');
      },
    },
  };
}
