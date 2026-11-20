import { describe, expect, it } from 'vitest';
import init from './index';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { normalizeWordPressSource, summarizeD1BatchResults } from './service';
import { classifyWordPressImportError } from './index';

function collectHooks() {
  const hooks = new Map<string, Function>();
  init({
    pluginId: 'typecho-plugin-wordpress-import',
    HookPoints: {} as any,
    addHook: ((point: string, _pluginId: string, handler: Function) => {
      hooks.set(point, handler);
    }) as any,
  } as PluginInitContext);
  return hooks;
}

describe('WordPress import plugin', () => {
  it('registers the admin API, page renderer, and navigation hook', () => {
    const hooks = collectHooks();
    expect([...hooks.keys()]).toEqual(['route:request', 'admin:page', 'admin:footer']);
  });

  it('renders its admin page only for the matching plugin slug', () => {
    const hooks = collectHooks();
    const render = hooks.get('admin:page')!;
    expect(render('original', { slug: 'other' })).toBe('original');
    const html = render('', { slug: 'wordpress-import', csrfToken: 'csrf-value' });
    expect(html).toContain('wordpress-import-file');
    expect(html).toContain('/api/admin/wordpress-import');
    expect(html).toContain('csrf-value');
    expect(html).toContain('确认导入');
    expect(html).toContain('function splitWxr');
    expect(html).toContain('MAX_PART_BYTES=24*1024*1024');
    expect(html).toContain("childText(item,'post_parent')");
    expect(html).toContain("key!=='_thumbnail_id'");
    expect(html).toContain('crypto.subtle.digest');
    expect(html).toContain('重新选择同一原始文件并重新分析');
  });

  it('leaves unrelated plugin requests untouched', async () => {
    const hooks = collectHooks();
    const handler = hooks.get('route:request')!;
    const original = { handled: false };
    await expect(handler(original, { path: '/api/admin/notes' })).resolves.toBe(original);
  });
});


describe('WordPress source identity', () => {
  it('normalizes host and removes query/hash while preserving subdirectory paths', () => {
    expect(normalizeWordPressSource('HTTPS://Example.COM/blog/?export=1#top'))
      .toBe('https://example.com/blog');
  });

  it('rejects exports without a valid source URL', () => {
    expect(() => normalizeWordPressSource('')).toThrow('缺少 WordPress 站点地址');
    expect(() => normalizeWordPressSource('ftp://example.com')).toThrow('站点地址无效');
  });
});


describe('D1 import write metrics', () => {
  it('sums exact rows-written and SQL duration metadata from batch results', () => {
    expect(summarizeD1BatchResults([
      { meta: { rows_written: 12, duration: 4.5 } },
      { meta: { rows_written: 8, duration: 2 } },
    ], 2, 11)).toEqual({
      rowsWritten: 20,
      statementCount: 2,
      batchDurationMs: 11,
      sqlDurationMs: 6.5,
    });
  });

  it('keeps zero metrics for an empty batch result', () => {
    expect(summarizeD1BatchResults([], 0, 0)).toEqual({
      rowsWritten: 0,
      statementCount: 0,
      batchDurationMs: 0,
      sqlDurationMs: 0,
    });
  });
});

describe('WordPress import D1 error classification', () => {
  it('recognizes the Free plan daily row quota', () => {
    expect(classifyWordPressImportError(new Error(
      "Your account has exceeded D1's free tier daily row write limit.",
    )).status).toBe(429);
  });

  it('recognizes database capacity exhaustion', () => {
    expect(classifyWordPressImportError(new Error('Exceeded maximum DB size.')).status).toBe(507);
  });

  it('recognizes overloaded and timeout errors separately', () => {
    expect(classifyWordPressImportError(new Error('D1 DB is overloaded. Too many requests queued.')).status).toBe(503);
    expect(classifyWordPressImportError(new Error('D1 DB storage operation exceeded timeout.')).status).toBe(504);
  });

  it('reads nested D1 causes and preserves XML validation errors', () => {
    expect(classifyWordPressImportError(Object.assign(new Error('Failed query'), {
      cause: new Error('D1_ERROR: Network connection lost.'),
    })).status).toBe(503);
    expect(classifyWordPressImportError(new Error('WXR XML 格式无效')).message).toBe('WXR XML 格式无效');
  });
});
