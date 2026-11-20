import { describe, expect, it } from 'vitest';
import init, { classifyWordPressImportError } from './index';
import { wordpressImportAdminPageHtml } from './admin';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { mapWordPressContentStatus, normalizeWordPressSource, selectWordPressImportItems, summarizeD1BatchResults } from './service';

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

describe('WordPress importer generated browser script', () => {
  it('keeps generated JavaScript valid and preserves digit regexes after template rendering', () => {
    const html = wordpressImportAdminPageHtml('test-token');
    const script = html.match(/<script>([\\s\\S]*?)<\\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect(script!.match(/match\\(\\/\\\\d\\+\\/g\\)/g)).toHaveLength(2);
    expect(script).toContain("filename.replace(/\\\\.xml$/i");
  });

  it('reports non-JSON server responses as readable request errors', () => {
    const html = wordpressImportAdminPageHtml('test-token');
    expect(html).toContain('服务器未返回有效 JSON');
    expect(html).toContain('服务器返回了无法识别的数据');
  });
});

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
    expect(html).toContain('name="contentTypes" value="post"');
    expect(html).toContain('name="contentTypes" value="page"');
    expect(html).toContain('name="contentTypes" value="note"');
    expect(html).toContain('selectionKey');
    expect(html).toContain('/api/admin/wordpress-import');
    expect(html).toContain('csrf-value');
    expect(html).toContain('确认导入');
    expect(html).toContain('function splitWxr(xml,filename,selectedTypes)');
    expect(html).toContain('var selectedTypeSet=new Set(selectedTypes)');
    expect(html).toContain('selectionKey');
    expect(html).toContain('MAX_PART_BYTES=24*1024*1024');
    expect(html).toContain("childText(item,'post_parent')");
    expect(html).toContain("key!=='_thumbnail_id'");
    expect(html).toContain('crypto.subtle.digest');
    expect(html).toContain('重新选择同一原始文件并重新分析');
    expect(html).toContain('D1 实际写入行数');
    expect(html).toContain('已确认提交');
    expect(html).toContain('function hasImportableItems');
    expect(html).toContain('lastPreview={hash:hash,selection:chosenTypes.join(','),parts:parts,reports:reports}');
    expect(html).toContain('当前分片只写入尚未成功导入的所选内容及其附件');
  });

  it('leaves unrelated plugin requests untouched', async () => {
    const hooks = collectHooks();
    const handler = hooks.get('route:request')!;
    const original = { handled: false };
    await expect(handler(original, { path: '/api/admin/notes' })).resolves.toBe(original);
  });
});


describe('WordPress post status mapping', () => {
  it('maps native WordPress statuses to Typecho post states', () => {
    expect(mapWordPressContentStatus('post', 'publish')).toEqual({ type: 'post', status: 'publish' });
    expect(mapWordPressContentStatus('post', 'pending')).toEqual({ type: 'post', status: 'waiting' });
    expect(mapWordPressContentStatus('page', 'pending')).toEqual({ type: 'page', status: 'waiting' });
    expect(mapWordPressContentStatus('post', 'private')).toEqual({ type: 'post', status: 'private' });
    expect(mapWordPressContentStatus('post', 'future')).toEqual({ type: 'post', status: 'hidden' });
    expect(mapWordPressContentStatus('post', 'draft')).toEqual({ type: 'post_draft', status: 'draft' });
    expect(mapWordPressContentStatus('post', 'auto-draft')).toEqual({ type: 'post_draft', status: 'draft' });
    expect(mapWordPressContentStatus('post', ' PENDING ')).toEqual({ type: 'post', status: 'waiting' });
  });

  it('keeps trashed and unknown statuses unpublished', () => {
    expect(mapWordPressContentStatus('post', 'trash')).toEqual({ type: 'post_draft', status: 'draft' });
    expect(mapWordPressContentStatus('post', 'future-custom-status')).toEqual({ type: 'post_draft', status: 'draft' });
  });

  it('does not rewrite attachment or note status handling in the shared builder', () => {
    expect(mapWordPressContentStatus('attachment', 'inherit')).toBeNull();
    expect(mapWordPressContentStatus('note', 'publish')).toBeNull();
  });
});

describe('WordPress selective content filtering', () => {
  const item = (postType: string, oldId: number, parentId = 0, postMeta: Array<{ key: string; value: string }> = []) => ({
    postType, oldId, parentId, postMeta,
  }) as any;

  it('imports only selected content and retains referenced or child attachments', () => {
    const source = {
      siteTitle: 'Example',
      siteUrl: 'https://example.com',
      authors: [],
      terms: [],
      items: [
        item('post', 10, 0, [{ key: '_thumbnail_id', value: '90' }]),
        item('page', 20),
        item('note', 30, 0, [{ key: 'images', value: '[91, 92]' }]),
        item('attachment', 90, 10),
        item('attachment', 95, 90),
        item('attachment', 91),
        item('attachment', 92),
        item('attachment', 93, 20),
        item('attachment', 94),
      ],
    } as any;

    const postsOnly = selectWordPressImportItems(source, ['post']);
    expect(postsOnly.items.map((entry: any) => entry.oldId)).toEqual([10, 90, 95]);

    const notesOnly = selectWordPressImportItems(source, ['note']);
    expect(notesOnly.items.map((entry: any) => entry.oldId)).toEqual([30, 91, 92]);

    const pagesOnly = selectWordPressImportItems(source, ['page']);
    expect(pagesOnly.items.map((entry: any) => entry.oldId)).toEqual([20, 93]);
  });

  it('keeps selected types independent and excludes unselected content', () => {
    const source = {
      siteTitle: 'Example',
      siteUrl: 'https://example.com',
      authors: [],
      terms: [],
      items: [item('post', 1), item('page', 2), item('note', 3), item('attachment', 4)],
    } as any;
    expect(selectWordPressImportItems(source, ['post', 'note']).items.map((entry: any) => entry.postType))
      .toEqual(['post', 'note']);
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
