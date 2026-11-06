/**
 * Warm CY companion plugin video-player enhancement.
 *
 * Keeps provider validation, Markdown protection, iframe placeholder rendering,
 * and browser playback runtime outside the upstream theme/core.
 */

function encodeVideoPayload(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function decodeVideoPayload(hex: string): string {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('Invalid video payload');
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function escapeVideoAttribute(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

export function videoProviderForSource(source: string): 'youtube' | 'bilibili' | 'vimeo' | null {
  try {
    const normalized = source.replace(/&amp;/g, '&').trim();
    if (!normalized) return null;
    // Protocol-relative embeds inherit HTTPS; explicit HTTP, credentials and
    // non-default ports are not trusted even when the hostname looks valid.
    const url = new URL(normalized, 'https://localhost');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'www.youtube.com') return 'youtube';
    if (url.hostname === 'player.bilibili.com') return 'bilibili';
    if (url.hostname === 'player.vimeo.com') return 'vimeo';
  } catch {
    return null;
  }
  return null;
}

function readIframeAttribute(attributes: string, name: string): string {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = pattern.exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

export function protectVideoIframesForMarkdown(content: string): string {
  if (!/<iframe\b/i.test(content)) return content;
  return content.replace(/<iframe\b([^>]*)>(?:\s*<\/iframe\s*>)?/gi, (match, attributes: string) => {
    const source = readIframeAttribute(attributes, 'src').replace(/&amp;/g, '&');
    if (!source || !videoProviderForSource(source)) return match;
    return 'CYVIDEOIFRAMEX' + encodeVideoPayload(match) + 'XEND';
  });
}

export function restoreVideoIframesAfterMarkdown(content: string): string {
  if (!content.includes('CYVIDEOIFRAMEX')) return content;
  const restore = (_marker: string, payload: string) => {
    try { return decodeVideoPayload(payload); } catch { return ''; }
  };
  // A protected iframe is plain text to Marked, so a standalone embed may
  // be wrapped in <p>. Remove that wrapper before restoring the block iframe.
  return content
    .replace(/<p>\s*CYVIDEOIFRAMEX([0-9a-f]+)XEND\s*<\/p>/gi, restore)
    .replace(/CYVIDEOIFRAMEX([0-9a-f]+)XEND/g, restore);
}

export function replaceVideoIframesWithPlaceholders(content: string): string {
  if (!/<iframe\b/i.test(content)) return content;
  return content.replace(/<iframe\b([^>]*)>(?:\s*<\/iframe\s*>)?/gi, (match, attributes: string) => {
    const source = readIframeAttribute(attributes, 'src').replace(/&amp;/g, '&');
    const provider = videoProviderForSource(source);
    if (!source || !provider) return match;

    const requestedWidth = readIframeAttribute(attributes, 'width');
    const requestedHeight = readIframeAttribute(attributes, 'height');
    const width = /^\d{2,4}$/.test(requestedWidth) ? Number(requestedWidth) : 0;
    const height = /^\d{2,4}$/.test(requestedHeight) ? Number(requestedHeight) : 0;
    const ratio = width > 0 && height > 0
      ? Math.max(0.5, Math.min(3, width / height))
      : 16 / 9;

    return '<div class="cy-video-player" data-cy-video-player'
      + ' data-cy-video-provider="' + provider + '"'
      + ' data-cy-video-src="' + escapeVideoAttribute(source) + '"'
      + ' data-cy-video-ratio="' + ratio.toFixed(5) + '">'
      + '<div class="cy-video-player__status" role="status">正在加载视频…</div>'
      + '</div>';
  });
}

export function videoPlayerRuntime(enabled: boolean): string {
  if (!enabled) return '';
  return `<style data-cy-video-player-styles>
    .cy-video-player{position:relative;display:block;width:100%;max-width:100%;height:auto;aspect-ratio:var(--cy-video-ratio,16/9);overflow:hidden;background:transparent;border-radius:0.5rem}
    .warm-prose .cy-video-player{margin:1.5rem 0;background:#000;border-radius:10px}
    @media(max-width:640px){.warm-prose .cy-video-player{margin:1rem 0;border-radius:8px}}
    .cy-video-player iframe{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:100%;margin:0;border:0;border-radius:0;box-shadow:none;background:transparent}
    .cy-video-player__status{position:absolute;inset:0;display:grid;place-items:center;padding:1rem;color:inherit;background:transparent;text-align:center;font-size:14px;pointer-events:none}
    .cy-video-player__status[hidden]{display:none}
  </style><script data-cy-video-player-runtime>
    (() => {
      const providerHosts = new Map([
        ['youtube', 'www.youtube.com'],
        ['bilibili', 'player.bilibili.com'],
        ['vimeo', 'player.vimeo.com']
      ]);
      const mount = root => {
        if (!root || root.dataset.cyVideoMounted === '1') return;
        const source = root.dataset.cyVideoSrc || '';
        let url;
        // Protocol-relative embeds inherit HTTPS regardless of the page URL.
        // Recheck the same strict URL policy used by the server-side transformer.
        try { url = new URL(source, 'https://localhost'); } catch { return; }
        const provider = root.dataset.cyVideoProvider || '';
        if (url.protocol !== 'https:' || url.username || url.password || url.port
          || providerHosts.get(provider) !== url.hostname.toLowerCase()) return;

        const status = root.querySelector('.cy-video-player__status');
        const ratio = Number.parseFloat(root.dataset.cyVideoRatio || '');
        if (Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 3) {
          root.style.setProperty('--cy-video-ratio', String(ratio));
          root.style.aspectRatio = String(ratio);
        }

        // Keep the platform's native iframe as the playback engine. Do not
        // use lazy loading here: affected Android browsers may leave a
        // script-created lazy iframe unrequested while the embed is visible.
        const frame = document.createElement('iframe');
        if (provider === 'youtube') {
          if (!url.searchParams.has('playsinline')) url.searchParams.set('playsinline', '1');
        }
        frame.src = url.toString();
        frame.title = '视频播放器';
        frame.width = '100%';
        frame.height = '100%';
        frame.loading = 'eager';
        frame.allowFullscreen = true;
        frame.setAttribute('frameborder', provider === 'bilibili' ? 'no' : '0');
        frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        if (provider === 'bilibili') {
          frame.setAttribute('scrolling', 'no');
          frame.setAttribute('border', '0');
          frame.setAttribute('framespacing', '0');
          frame.setAttribute('allowfullscreen', 'true');
        }
        frame.addEventListener('load', () => {
          root.dataset.cyVideoState = 'frame-loaded';
          if (status) status.hidden = true;
        }, { once: true });
        frame.addEventListener('error', () => {
          root.dataset.cyVideoState = 'error';
          if (status) {
            status.hidden = false;
            status.textContent = '播放器框架请求失败，请检查网络或浏览器拦截设置。';
          }
        }, { once: true });

        root.appendChild(frame);
        root.dataset.cyVideoMounted = '1';
        root.dataset.cyVideoState = 'loading';
      };

      const scan = root => {
        if (!root) return;
        if (root.matches && root.matches('[data-cy-video-player]')) mount(root);
        if (root.querySelectorAll) root.querySelectorAll('[data-cy-video-player]').forEach(mount);
      };

      const start = () => scan(document);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
      window.addEventListener('instantclick:newpage', start);
      const observer = new MutationObserver(records => {
        for (const record of records) record.addedNodes.forEach(scan);
      });
      if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    })();
  </script>`;
}
