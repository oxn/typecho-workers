import { describe, expect, it } from 'vitest';
import {
  protectVideoIframesForMarkdown,
  replaceVideoIframesWithPlaceholders,
  restoreVideoIframesAfterMarkdown,
  videoPlayerRuntime,
  videoProviderForSource,
} from './video-player';

describe('Warm CY isolated video player module', () => {
  it('recognizes only the supported HTTPS embed hosts', () => {
    expect(videoProviderForSource('https://www.youtube.com/embed/demo')).toBe('youtube');
    expect(videoProviderForSource('//player.bilibili.com/player.html?bvid=BV1TEST')).toBe('bilibili');
    expect(videoProviderForSource('https://player.vimeo.com/video/123')).toBe('vimeo');
    expect(videoProviderForSource('http://www.youtube.com/embed/demo')).toBeNull();
    expect(videoProviderForSource('https://user@www.youtube.com/embed/demo')).toBeNull();
    expect(videoProviderForSource('https://www.youtube.com:8443/embed/demo')).toBeNull();
    expect(videoProviderForSource('https://youtube.com/embed/demo')).toBeNull();
    expect(videoProviderForSource('https://evil.example/embed/demo')).toBeNull();
  });

  it('protects supported provider iframes from Markdown parsing and restores them', () => {
    const source = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315"></iframe>';
    const protectedContent = protectVideoIframesForMarkdown(source);
    expect(protectedContent).not.toContain('<iframe');
    expect(protectedContent).toContain('CYVIDEOIFRAMEX');
    expect(restoreVideoIframesAfterMarkdown('<p>' + protectedContent + '</p>')).toBe(source);
  });

  it('does not alter unsupported or insecure iframe markup during Markdown protection', () => {
    const unsupported = '<iframe src="https://evil.example/embed/demo"></iframe>';
    const insecure = '<iframe src="http://www.youtube.com/embed/demo"></iframe>';
    expect(protectVideoIframesForMarkdown(unsupported)).toBe(unsupported);
    expect(protectVideoIframesForMarkdown(insecure)).toBe(insecure);
  });

  it('converts supported iframes to responsive placeholders and preserves aspect ratio', () => {
    const source = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315"></iframe>';
    const output = replaceVideoIframesWithPlaceholders(source);
    expect(output).toContain('class="cy-video-player"');
    expect(output).toContain('data-cy-video-provider="youtube"');
    expect(output).toContain('data-cy-video-ratio="1.77778"');
    expect(output).toContain('data-cy-video-src="https://www.youtube.com/embed/demo"');
    expect(output).not.toContain('<iframe');
  });

  it('escapes iframe source attributes and leaves untrusted providers untouched', () => {
    const source = '<iframe src="https://player.bilibili.com/player.html?a=1&amp;b=2" width="100%" height="480"></iframe>';
    const output = replaceVideoIframesWithPlaceholders(source);
    expect(output).toContain('data-cy-video-src="https://player.bilibili.com/player.html?a=1&amp;b=2"');
    const untrusted = '<iframe src="https://evil.example/embed/demo"></iframe>';
    expect(replaceVideoIframesWithPlaceholders(untrusted)).toBe(untrusted);
  });

  it('keeps the browser runtime fully disabled when the feature is off', () => {
    expect(videoPlayerRuntime(false)).toBe('');
  });

  it('uses eager native iframes and handles navigation, inserted nodes, and load errors', () => {
    const runtime = videoPlayerRuntime(true);
    expect(runtime).toContain('data-cy-video-player-runtime');
    expect(runtime).toContain("frame.loading = 'eager'");
    expect(runtime).toContain("document.createElement('iframe')");
    expect(runtime).toContain("window.addEventListener('instantclick:newpage', start)");
    expect(runtime).toContain('new MutationObserver');
    expect(runtime).toContain("root.dataset.cyVideoState = 'error'");
    expect(runtime).toContain('player.bilibili.com');
  });
});
