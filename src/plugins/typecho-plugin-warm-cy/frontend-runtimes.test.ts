import { describe, expect, it } from 'vitest';
import { adminNavigationRuntime, globalSearchRuntime } from './frontend-runtimes';

describe('Warm CY frontend runtimes', () => {
  it('renders the global search runtime with an escaped site base', () => {
    const runtime = globalSearchRuntime(JSON.stringify('https://example.com/'));
    expect(runtime).toContain('data-warm-cy-global-search');
    expect(runtime).toContain('const searchBase = "https://example.com/";');
    expect(runtime).toContain("data-warm-search-dialog");
    expect(runtime).toContain("instantclick:newpage");
    expect(runtime).toContain("encodeURIComponent(keyword)");
  });

  it('renders the admin navigation runtime with the configured page path', () => {
    const runtime = adminNavigationRuntime('/admin/plugin/cy-companion');
    expect(runtime).toContain('data-warm-cy-admin-navigation');
    expect(runtime).toContain("const pluginPath = '/admin/plugin/cy-companion';");
    expect(runtime).toContain('warm-theme-config-form');
    expect(runtime).toContain('warm-theme-settings-card');
    expect(runtime).toContain('CY 功能显示');
  });
});
