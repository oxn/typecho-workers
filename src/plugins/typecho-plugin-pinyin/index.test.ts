import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInitContext } from 'typecho/plugin-sdk';

const mocks = vi.hoisted(() => ({
  parsePluginOption: vi.fn((value: unknown) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return {}; }
    }
    return value && typeof value === 'object' ? value : {};
  }),
}));

vi.mock('typecho/plugin-sdk', () => ({
  parsePluginOption: mocks.parsePluginOption,
}));

import init from './index';
import { titleToPinyinSlug } from './pinyin';

function setup() {
  const hooks = new Map<string, (...args: any[]) => any>();
  init({
    pluginId: 'typecho-plugin-pinyin',
    addHook: ((name: string, _pluginId: string, handler: (...args: any[]) => any) => {
      hooks.set(name, handler);
    }) as PluginInitContext['addHook'],
  } as PluginInitContext);
  return hooks;
}

describe('typecho-plugin-pinyin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the original pinyin conversion output', () => {
    expect(titleToPinyinSlug('你好 Typecho')).toBe('nihao-typecho');
    expect(titleToPinyinSlug('中华人民共和国')).toBe('zhonghuarenmingongheguo');
    expect(titleToPinyinSlug('我的文章：标题')).toBe('wodewenzhang-biaoti');
    expect(titleToPinyinSlug('Hello, World!')).toBe('hello-world');
    expect(titleToPinyinSlug('  ')).toBe('');
  });

  it('respects the configured slug length and 300-character default', () => {
    expect(titleToPinyinSlug('a'.repeat(400))).toHaveLength(300);
    expect(titleToPinyinSlug('a'.repeat(20), 5)).toBe('aaaaa');
    expect(titleToPinyinSlug('你好', 3).length).toBeLessThanOrEqual(3);
  });

  it('injects the bundled browser script for both post and page editors', () => {
    const hooks = setup();
    const post = hooks.get('admin:writePost:bottom')!;
    const page = hooks.get('admin:writePage:bottom')!;

    const postHtml = post('', { options: { permalinkPattern: '/archives/{cid}/' } });
    expect(postHtml).toContain('/plugin-assets/typecho-plugin-pinyin/pinyin-editor.js');
    expect(postHtml).toContain('data-allows-slug-edit="false"');
    expect(postHtml).toContain('data-title-max-length="100"');
    expect(postHtml).toContain('data-slug-max-length="300"');

    const pageHtml = page('', { options: { pagePattern: '/{slug}.html' }, page: { slug: 'existing-slug' } });
    expect(pageHtml).toContain('data-allows-slug-edit="true"');
    expect(pageHtml).toContain('data-initial-slug="existing-slug"');
    expect(pageHtml).toContain('重新生成');
  });

  it('keeps the original post and page finishSave hooks for duplicate handling', () => {
    const hooks = setup();
    expect(hooks.has('post:finishSave')).toBe(true);
    expect(hooks.has('page:finishSave')).toBe(true);
    expect(hooks.has('route:request')).toBe(false);
  });
});
