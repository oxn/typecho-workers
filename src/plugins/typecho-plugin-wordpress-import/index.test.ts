import { describe, expect, it } from 'vitest';
import init, { classifyWordPressImportError } from './index';
import { wordpressImportAdminPageHtml } from './admin';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { addWordPressTermAncestors, isWordPressImportDuplicate, mapWordPressContentStatus, normalizeWordPressSource, selectWordPressImportItems, summarizeD1BatchResults } from './service';

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
    const scriptStart = html.indexOf('<script>') + '<script>'.length;
    const scriptEnd = html.indexOf('</script>', scriptStart);
    const script = scriptStart >= '<script>'.length && scriptEnd >= scriptStart ? html.slice(scriptStart, scriptEnd) : null;
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect(script!.match(/match\(\/\\d\+\/g\)/g)).toHaveLength(2);
    expect(script).toContain("filename.replace(/\\.xml$/i");
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
    expect(html).toContain('name="dedupeFields" value="title" checked');
    expect(html).toContain('name="dedupeFields" value="slug" checked');
    expect(html).toContain('name="dedupeFields" value="id"');
    expect(html).toContain('selectedDedupeFields');
    expect(html).toContain('dedupeSelectionKey');

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
    expect(html).not.toContain('crypto.subtle');
    expect(html).toContain('currentXml!==lastPreview.sourceXml');
    expect(html).toContain('重新选择同一原始文件并重新分析');
    expect(html).toContain('D1 实际写入行数');
    expect(html).toContain('已确认提交');
    expect(html).toContain('function hasImportableItems');
    expect(html).toContain("lastPreview={sourceXml:sourceXml,selection:chosenTypes.join(',')+'|'+chosenDedupeFields.join(','),parts:parts,reports:reports}");
    expect(html).toContain('当前分片只写入尚未成功导入的所选内容及其附件');
  });

  it('leaves unrelated plugin requests untouched', async () => {
    const hooks = collectHooks();
    const handler = hooks.get('route:request')!;
    const original = { handled: false };
    await expect(handler(original, { path: '/api/admin/notes' })).resolves.toBe(original);
  });
});



describe('WordPress duplicate matching options', () => {
  const item = { title: 'Same title', slug: 'same-slug', oldId: 12 };
  const existing = { title: 'Same title', slug: 'same-slug', wordpressId: 99, source: 'https://other.example' };

  it('requires every selected field to match the same existing content row', () => {
    expect(isWordPressImportDuplicate(item, existing, 'https://source.example', ['title', 'slug'])).toBe(true);
    expect(isWordPressImportDuplicate(item, { ...existing, slug: 'different-slug' }, 'https://source.example', ['title', 'slug'])).toBe(false);
    expect(isWordPressImportDuplicate(item, { ...existing, title: 'Different title' }, 'https://source.example', ['title', 'slug'])).toBe(false);
  });

  it('supports title-only and slug-only matching independently', () => {
    expect(isWordPressImportDuplicate(item, { ...existing, slug: 'different-slug' }, 'https://source.example', ['title'])).toBe(true);
    expect(isWordPressImportDuplicate(item, { ...existing, title: 'Different title' }, 'https://source.example', ['slug'])).toBe(true);
  });

  it('matches IDs within the same source and keeps legacy source-less ID markers compatible', () => {
    expect(isWordPressImportDuplicate(item, { ...existing, wordpressId: 12 }, 'https://other.example', ['id'])).toBe(true);
    expect(isWordPressImportDuplicate(item, { ...existing, wordpressId: 12 }, 'https://source.example', ['id'])).toBe(false);
    expect(isWordPressImportDuplicate(item, { title: '', slug: '', wordpressId: 12 }, 'https://source.example', ['id'])).toBe(true);
  });

  it('requires ID and the other selected fields to match together', () => {
    expect(isWordPressImportDuplicate(item, { ...existing, wordpressId: 12 }, 'https://other.example', ['title', 'id'])).toBe(true);
    expect(isWordPressImportDuplicate(item, { ...existing, wordpressId: 99 }, 'https://other.example', ['title', 'id'])).toBe(false);
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

describe('WordPress taxonomy hierarchy', () => {
  it('creates missing parent and grandparent terms without changing shared migration code', () => {
    const dataset: any = {
      metas: [{ mid: 11, name: 'Child', slug: 'child', type: 'category', description: null, count: 0, order: 0, parent: 0 }],
    };
    const source: any = {
      terms: [
        { domain: 'category', slug: 'root', name: 'Root', parentSlug: '', description: 'root description' },
        { domain: 'category', slug: 'parent', name: 'Parent', parentSlug: 'root', description: '' },
        { domain: 'category', slug: 'child', name: 'Child', parentSlug: 'parent', description: '' },
      ],
    };

    addWordPressTermAncestors(dataset, source, [], 10);

    expect(dataset.metas).toHaveLength(3);
    expect(dataset.metas[0].parent).toBe(12);
    expect(dataset.metas.find((meta: any) => meta.slug === 'parent')).toMatchObject({ mid: 12, parent: 13 });
    expect(dataset.metas.find((meta: any) => meta.slug === 'root')).toMatchObject({ mid: 13, parent: 0 });
  });

  it('reuses an existing parent term instead of inserting a duplicate', () => {
    const dataset: any = {
      metas: [{ mid: 21, name: 'Child', slug: 'child', type: 'category', description: null, count: 0, order: 0, parent: 0 }],
    };
    const source: any = {
      terms: [
        { domain: 'category', slug: 'parent', name: 'Parent', parentSlug: '', description: '' },
        { domain: 'category', slug: 'child', name: 'Child', parentSlug: 'parent', description: '' },
      ],
    };

    addWordPressTermAncestors(dataset, source, [{ mid: 7, type: 'category', slug: 'parent' }], 20);

    expect(dataset.metas).toHaveLength(1);
    expect(dataset.metas[0].parent).toBe(7);
  });

  it('keeps note topics in their own taxonomy and breaks malformed parent cycles', () => {
    const dataset: any = {
      metas: [{ mid: 31, name: 'Topic B', slug: 'topic-b', type: 'note_topic', description: null, count: 0, order: 0, parent: 0 }],
    };
    const source: any = {
      terms: [
        { domain: 'topic', slug: 'topic-a', name: 'Topic A', parentSlug: 'topic-b', description: '' },
        { domain: 'topic', slug: 'topic-b', name: 'Topic B', parentSlug: 'topic-a', description: '' },
        { domain: 'category', slug: 'topic-a', name: 'Category A', parentSlug: '', description: '' },
      ],
    };

    addWordPressTermAncestors(dataset, source, [], 30);

    expect(dataset.metas.filter((meta: any) => meta.type === 'note_topic')).toHaveLength(2);
    expect(dataset.metas.find((meta: any) => meta.slug === 'topic-a' && meta.type === 'note_topic')).toBeTruthy();
    expect(dataset.metas.find((meta: any) => meta.slug === 'topic-a' && meta.type === 'category')).toBeUndefined();
  });
});
