/**
 * Intelligence plugin persisted settings (options key: plugin:typecho-plugin-intelligence).
 */
import { parsePluginOption } from 'typecho/plugin-sdk';
import { normalizeSearchProvider, type SearchProvider } from './search';

export const PLUGIN_ID = 'typecho-plugin-intelligence';
export const INTELLIGENCE_SUMMARY_FIELD = 'intelligence_summary';

export { normalizeSearchProvider, type SearchProvider } from './search';

export const MASKED_SECRET = '********';

/** short ≈ 80 / medium ≈ 120 / long ≈ 200 Chinese characters */
export const SUMMARY_LENGTH_PRESETS = ['short', 'medium', 'long'] as const;
export type SummaryLengthPreset = (typeof SUMMARY_LENGTH_PRESETS)[number];

export const SUMMARY_LENGTH_CHARS: Record<SummaryLengthPreset, number> = {
  short: 80,
  medium: 120,
  long: 200,
};

export interface IntelligenceSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: string;
  maxTokens: string;
  /** "0" | "1" — generate AI summary on publish */
  autoSummary: string;
  /** Target summary length preset */
  summaryLength: SummaryLengthPreset;
  /** default | bing | google */
  searchProvider: SearchProvider;
}

export const SETTINGS_DEFAULTS: IntelligenceSettings = {
  endpoint: 'https://open.bigmodel.cn/api/paas/v4/',
  apiKey: '',
  model: 'glm-4.7-flash',
  temperature: '0.7',
  maxTokens: '128000',
  autoSummary: '0',
  summaryLength: 'medium',
  searchProvider: 'default',
};

const MAX_OUTPUT_TOKENS = 512_000;

export function normalizeAutoSummary(value: unknown): string {
  if (value === true || value === 1 || value === '1') return '1';
  return '0';
}

export function normalizeSummaryLength(value: unknown): SummaryLengthPreset {
  return SUMMARY_LENGTH_PRESETS.includes(value as SummaryLengthPreset)
    ? (value as SummaryLengthPreset)
    : SETTINGS_DEFAULTS.summaryLength;
}

export function summaryTargetChars(preset: SummaryLengthPreset): number {
  return SUMMARY_LENGTH_CHARS[normalizeSummaryLength(preset)];
}

/** Completion budget sized to the target length so models cannot dump essays. */
export function summaryMaxTokens(targetChars: number): number {
  return Math.min(512, Math.max(96, Math.ceil(targetChars * 2.5) + 48));
}

export function normalizeSettings(settings?: Record<string, unknown>): IntelligenceSettings {
  return {
    endpoint: String(settings?.endpoint || '').trim(),
    apiKey: String(settings?.apiKey || '').trim(),
    model: String(settings?.model || '').trim(),
    temperature: String(settings?.temperature || SETTINGS_DEFAULTS.temperature).trim(),
    maxTokens: String(settings?.maxTokens || SETTINGS_DEFAULTS.maxTokens).trim(),
    autoSummary: normalizeAutoSummary(settings?.autoSummary),
    summaryLength: normalizeSummaryLength(settings?.summaryLength),
    searchProvider: normalizeSearchProvider(settings?.searchProvider),
  };
}

export function loadSettings(options?: Record<string, unknown>): IntelligenceSettings {
  const raw = parsePluginOption(options?.[`plugin:${PLUGIN_ID}`] as string | undefined);
  return {
    ...SETTINGS_DEFAULTS,
    ...normalizeSettings(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}),
  };
}

/** True when endpoint, API key, and model are all present (AI features can run). */
export function isAiConfigured(config: Pick<IntelligenceSettings, 'endpoint' | 'apiKey' | 'model'>): boolean {
  return Boolean(config.endpoint && config.apiKey && config.model);
}

/**
 * Validate Intelligence settings for save. Does not hit the provider.
 * Missing endpoint/apiKey/model does not block save — AI features stay off until complete.
 */
export function validateSettings(settings?: Record<string, unknown>): IntelligenceSettings {
  const config = normalizeSettings(settings);

  if (config.endpoint) {
    let url: URL;
    try {
      url = new URL(config.endpoint);
    } catch {
      throw new Error('接口地址格式不正确');
    }
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('接口地址必须使用 http 或 https');
    }
  }

  const temperature = Number(config.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('temperature 必须是 0 到 2 之间的数字');
  }

  const maxTokens = Number(config.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > MAX_OUTPUT_TOKENS) {
    throw new Error(`max tokens 必须是 128 到 ${MAX_OUTPUT_TOKENS} 之间的整数`);
  }

  return config;
}

export function toFormValues(config: IntelligenceSettings): Record<string, string> {
  return {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    autoSummary: config.autoSummary,
    summaryLength: config.summaryLength,
    searchProvider: config.searchProvider,
  };
}

export function maskSecretFormValues(values: Record<string, string>): Record<string, string> {
  return {
    ...values,
    apiKey: values.apiKey ? MASKED_SECRET : '',
  };
}

export function restoreSecretFormValues(
  incoming: Record<string, unknown>,
  previous: Record<string, string>,
): Record<string, unknown> {
  const next = { ...incoming };
  if (String(next.apiKey || '') === MASKED_SECRET) {
    next.apiKey = previous.apiKey || '';
  }
  return next;
}

export function isAutoSummaryEnabled(config: IntelligenceSettings): boolean {
  return config.autoSummary === '1' && isAiConfigured(config);
}
