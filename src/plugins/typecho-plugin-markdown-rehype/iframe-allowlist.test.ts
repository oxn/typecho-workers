import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import {
  createArticleSanitizeSchema,
  DEFAULT_IFRAME_ATTRIBUTES,
  normalizeCustomIframeAttributes,
} from './index';

describe('Rehype iframe attribute allowlist settings', () => {
  it('normalizes additional HTML attributes and rejects executable or document-injection attributes', () => {
    expect(normalizeCustomIframeAttributes([
      'data-player-mode',
      'aria-description',
      'custom-token',
      'onclick',
      'onload',
      'src',
      'srcdoc',
      'nonce',
      'integrity',
      'width',
    ].join('\n'))).toEqual([
      'dataPlayerMode',
      'ariaDescription',
      'custom-token',
      'width',
    ]);
  });

  it('keeps built-in iframe attributes while adding configured attributes', () => {
    const schema = createArticleSanitizeSchema([...DEFAULT_IFRAME_ATTRIBUTES, 'dataPlayerMode', 'custom-token']);
    const iframe = schema.attributes.iframe as unknown[];
    expect(iframe).toContain('sandbox');
    expect(iframe).toContain('referrerPolicy');
    expect(iframe).toContain('allow');
    expect(iframe).toContain('dataPlayerMode');
    expect(iframe).toContain('custom-token');
  });

  it('preserves configured iframe attributes in rendered HTML but still strips event handlers and srcdoc', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeSanitize, createArticleSanitizeSchema([...DEFAULT_IFRAME_ATTRIBUTES, 'dataPlayerMode', 'custom-token']))
      .use(rehypeStringify);

    const html = String(await processor.process(
      '<iframe src="https://player.bilibili.com/player.html?aid=1" data-player-mode="wide" custom-token="yes" sandbox="allow-scripts" onload="alert(1)" srcdoc="<script>alert(1)</script>"></iframe>',
    ));

    expect(html).toContain('data-player-mode="wide"');
    expect(html).toContain('custom-token="yes"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('onload=');
    expect(html).not.toContain('srcdoc=');
  });
});
