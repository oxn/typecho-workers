import { describe, expect, it } from 'vitest';
import {
  loadSettings,
  isAiConfigured,
  isAutoSummaryEnabled,
  normalizeSearchProvider,
  normalizeSettings,
  normalizeSummaryLength,
  summaryMaxTokens,
  summaryTargetChars,
  validateSettings,
  maskSecretFormValues,
  restoreSecretFormValues,
  toFormValues,
  MASKED_SECRET,
  SETTINGS_DEFAULTS,
  SUMMARY_LENGTH_CHARS,
} from './config';

describe('intelligence config', () => {
  it('normalizes searchProvider, autoSummary, and summaryLength', () => {
    expect(normalizeSearchProvider('google')).toBe('google');
    expect(normalizeSearchProvider('nope')).toBe('default');
    expect(normalizeSettings({ autoSummary: '1', searchProvider: 'bing' }).autoSummary).toBe('1');
    expect(normalizeSettings({ autoSummary: true }).autoSummary).toBe('1');
    expect(normalizeSettings({}).autoSummary).toBe('0');
    expect(normalizeSummaryLength('short')).toBe('short');
    expect(normalizeSummaryLength('long')).toBe('long');
    expect(normalizeSummaryLength('nope')).toBe('medium');
    expect(normalizeSettings({ summaryLength: 'long' }).summaryLength).toBe('long');
    expect(normalizeSettings({}).summaryLength).toBe('medium');
    expect(summaryTargetChars('short')).toBe(SUMMARY_LENGTH_CHARS.short);
    expect(summaryTargetChars('medium')).toBe(SUMMARY_LENGTH_CHARS.medium);
    expect(summaryTargetChars('long')).toBe(SUMMARY_LENGTH_CHARS.long);
  });

  it('sizes summary max_tokens from the target character budget', () => {
    expect(summaryMaxTokens(80)).toBeLessThanOrEqual(512);
    expect(summaryMaxTokens(80)).toBeGreaterThanOrEqual(96);
    expect(summaryMaxTokens(200)).toBeGreaterThan(summaryMaxTokens(80));
  });

  it('validates LLM settings without requiring credentials', () => {
    expect(() => validateSettings({
      endpoint: 'https://example.com/v1/',
      apiKey: 'k',
      model: 'm',
      temperature: '0.5',
      maxTokens: '1024',
      autoSummary: '1',
      searchProvider: 'bing',
    })).not.toThrow();

    // Incomplete AI credentials must not block save (search / summary flags still persist).
    expect(validateSettings({
      ...SETTINGS_DEFAULTS,
      endpoint: '',
      apiKey: '',
      model: '',
      autoSummary: '1',
      searchProvider: 'google',
    })).toMatchObject({
      endpoint: '',
      apiKey: '',
      model: '',
      autoSummary: '1',
      searchProvider: 'google',
    });

    expect(validateSettings({
      ...SETTINGS_DEFAULTS,
      endpoint: '',
      apiKey: 'k',
      model: 'm',
    }).apiKey).toBe('k');

    expect(() => validateSettings({
      ...SETTINGS_DEFAULTS,
      endpoint: 'not-a-url',
    })).toThrow(/接口地址/);
  });

  it('masks and restores apiKey', () => {
    const masked = maskSecretFormValues(toFormValues({
      ...SETTINGS_DEFAULTS,
      apiKey: 'secret-key',
    }));
    expect(masked.apiKey).toBe(MASKED_SECRET);
    const restored = restoreSecretFormValues(
      { ...masked, model: 'new-model' },
      { ...masked, apiKey: 'secret-key' },
    );
    expect(restored.apiKey).toBe('secret-key');
    expect(restored.model).toBe('new-model');
  });
});

describe('legacy search settings', () => {
  it('ignores old searchScope instead of silently selecting an external engine', () => {
    expect(normalizeSettings({ searchScope: 'title_summary' }).searchProvider).toBe('default');
    expect(loadSettings({ 'plugin:typecho-plugin-intelligence': '{"searchScope":"title"}' }).searchProvider).toBe('default');
  });
  it('allows search-only configuration without an AI key', () => {
    expect(validateSettings({ ...SETTINGS_DEFAULTS, searchProvider: 'bing' }).searchProvider).toBe('bing');
    expect(validateSettings({ ...SETTINGS_DEFAULTS, autoSummary: '1' }).autoSummary).toBe('1');
  });
});


it('treats incomplete AI credentials as AI features off', () => {
  expect(isAiConfigured(SETTINGS_DEFAULTS)).toBe(false);
  expect(isAutoSummaryEnabled(SETTINGS_DEFAULTS)).toBe(false);
  expect(isAutoSummaryEnabled(validateSettings({ ...SETTINGS_DEFAULTS, autoSummary: '1' }))).toBe(false);
  expect(isAutoSummaryEnabled(validateSettings({
    ...SETTINGS_DEFAULTS,
    apiKey: 'key',
    autoSummary: '1',
  }))).toBe(true);
  expect(isAiConfigured(validateSettings({
    ...SETTINGS_DEFAULTS,
    endpoint: '',
    apiKey: 'key',
    model: 'm',
  }))).toBe(false);
});
