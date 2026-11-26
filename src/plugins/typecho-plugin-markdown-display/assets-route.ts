import type { EarlyRequestContext } from 'typecho/plugin-sdk';

type StaticAssetsBinding = {
  fetch(request: Request): Promise<Response>;
};

const localAssets = import.meta.glob('./assets/**/*.{js,css,woff,woff2,ttf}', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
}) as Record<string, string>;

export async function serveMarkdownDisplayAsset(
  context: EarlyRequestContext,
  requestedPath: string,
): Promise<Response> {
  let path: string;
  try {
    path = decodeURIComponent(requestedPath);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    return new Response('Not Found', { status: 404 });
  }

  const assetUrl = localAssets['./assets/' + path];
  if (!assetUrl) return new Response('Not Found', { status: 404 });

  const assets = context.env.ASSETS as StaticAssetsBinding | undefined;
  if (!assets || typeof assets.fetch !== 'function') {
    return new Response('Static assets unavailable', { status: 503 });
  }

  const response = await assets.fetch(new Request(new URL(assetUrl, context.request.url)));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
