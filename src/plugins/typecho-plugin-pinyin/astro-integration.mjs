/**
 * Build the pinyin editor bundle before Vite evaluates the plugin entrypoint.
 */
export default function pinyinBuildIntegration() {
  return {
    name: 'typecho-plugin-pinyin-client-build',
    hooks: {
      'astro:config:setup': async ({ command, logger }) => {
        if (command !== 'build' && command !== 'dev') return;
        await import('./scripts/build-client.mjs');
        logger.info('Typecho Pinyin client assets are ready.');
      },
    },
  };
}
