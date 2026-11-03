import { describe, expect, it } from 'vitest';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import init, { transformMathSource } from './index';

function setup() {
  const hooks = new Map<string, (...args: any[]) => any>();
  init({
    pluginId: 'typecho-plugin-markdown',
    addHook: ((name: string, _pluginId: string, handler: (...args: any[]) => any) => {
      hooks.set(name, handler);
    }) as PluginInitContext['addHook'],
  } as PluginInitContext);
  return hooks;
}

describe('typecho-plugin-markdown', () => {
  it('converts inline dollar and bracket math into safe Markdown code spans', () => {
    const result = transformMathSource('公式 $a+b$ 和 \\(x^2\\)');
    expect(result).toContain('`$a+b$`');
    expect(result).not.toContain('```math');
    expect(result).toContain('`$x^2$`');
    expect(result).not.toContain('<span');
  });

  it('converts display math blocks into ordinary fenced code blocks', () => {
    const result = transformMathSource('开始\n$$\nx^2 + y^2\n$$\n结束');
    expect(result).toContain('```math\nx^2 + y^2\n```');
    const bracketBlock = transformMathSource('开始\n\\[\nx + y\n\\]\n结束');
    expect(bracketBlock).toContain('```math\nx + y\n```');
  });

  it('supports one-line display math', () => {
    expect(transformMathSource('$$x^2$$')).toContain('```math\nx^2\n```');
    expect(transformMathSource('$x^2$')).toBe('`$x^2$`');
    expect(transformMathSource('\\[x^2\\]')).toContain('```math\nx^2\n```');
  });

  it('does not rewrite math-like text inside fenced or inline code', () => {
    const source = [
      '```text',
      '$not math$',
      '```',
      'Use `$not math$` as a literal example.',
      'Real formula: $x+y$.',
    ].join('\n');
    const result = transformMathSource(source);
    expect(result).toContain('$not math$');
    expect(result).toContain('`$not math$`');
    expect(result).toContain('`$x+y$`');
  });

  it('registers shared frontend and editor assets without adding HTML to Markdown source', () => {
    const hooks = setup();
    expect(hooks.get('content:markdown')!('$x$')).toContain('`$x$`');
    expect(hooks.get('archive:footer')!('')).toContain('markdown-loader.js');
    const adminFooter = hooks.get('admin:footer')!;
    expect(adminFooter('', { activeMenu: 'write-page', title: '创建新页面' })).toContain('markdown-loader.js');
    expect(adminFooter('', { activeMenu: 'manage-posts', title: '编辑文章' })).toContain('markdown-loader.js');
    expect(adminFooter('', { activeMenu: 'manage-pages', title: '编辑页面' })).toContain('markdown-loader.js');
    expect(adminFooter('', { activeMenu: 'manage-posts', title: '文章管理' })).toBe('');
  });
});
