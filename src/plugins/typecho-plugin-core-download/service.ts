import { and, eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import type { Database } from 'typecho/db';
import { setOption } from 'typecho/plugin-sdk';

export const CORE_DOWNLOAD_META_FIELD = 'core_download_meta_box';
export const CORE_DOWNLOAD_SETTINGS_OPTION = 'core_download_set';

export interface CoreDownloadItem {
  name: string;
  key: string;
  url: string;
  resource_name: string;
  show_type: string;
  [key: string]: unknown;
}
export interface CoreDownloadPostData {
  open: boolean;
  content: string;
  download_list: CoreDownloadItem[];
  [key: string]: unknown;
}
export interface CoreDownloadSettings {
  need_update: boolean;
  open: boolean;
  last_update: number;
  complaint_url: string;
  theme_color: string;
  border_radius: string;
  copyright_str: string;
  [key: string]: unknown;
}
export interface CoreDownloadThemeData {
  postData: CoreDownloadPostData;
  settings: CoreDownloadSettings;
}

const DEFAULT_POST_DATA: CoreDownloadPostData = { open: true, content: '', download_list: [] };
const DEFAULT_ITEM: CoreDownloadItem = { name: 'local', key: '', url: '', resource_name: '', show_type: '' };

function phpTruthy(value: unknown): boolean {
  return value !== false && value !== 0 && value !== '' && value !== '0' && value !== null && value !== undefined;
}

export function getDefaultCoreDownloadSettings(): CoreDownloadSettings {
  return {
    need_update: false,
    open: false,
    last_update: Math.floor(Date.now() / 1000),
    complaint_url: '',
    theme_color: '#409EFF',
    border_radius: '8',
    copyright_str: '本站所有资源均来源于网络，仅供学习使用，请下载后24小时内删除',
  };
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export function decodeBase64Json(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeBase64Utf8(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function encodeBase64Json(value: Record<string, unknown>): string {
  return encodeBase64Utf8(JSON.stringify(value));
}

/** Match Options::getMetaBoxOptions() without changing the WordPress field shape. */
export function normalizeCoreDownloadPostData(value: unknown): CoreDownloadPostData {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawList = Array.isArray(source.download_list) ? source.download_list : [];
  return {
    ...DEFAULT_POST_DATA,
    ...source,
    open: source.open === undefined ? true : phpTruthy(source.open),
    content: typeof source.content === 'string' ? source.content : '',
    download_list: rawList.map(item => ({
      ...DEFAULT_ITEM,
      ...(item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {}),
    })) as CoreDownloadItem[],
  };
}

function normalizeSettings(value: Record<string, unknown> | null): CoreDownloadSettings {
  return { ...getDefaultCoreDownloadSettings(), ...(value || {}) } as CoreDownloadSettings;
}

export async function getCoreDownloadSettings(db: Database): Promise<CoreDownloadSettings> {
  const row = await db.query.options.findFirst({
    where: and(eq(schema.options.name, CORE_DOWNLOAD_SETTINGS_OPTION), eq(schema.options.user, 0)),
    columns: { value: true },
  });
  return normalizeSettings(decodeBase64Json(row?.value));
}

export async function saveCoreDownloadSettings(db: Database, input: unknown): Promise<CoreDownloadSettings> {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const current = await getCoreDownloadSettings(db);
  const next: CoreDownloadSettings = {
    ...current,
    open: source.open === true,
    theme_color: typeof source.theme_color === 'string' && source.theme_color.trim()
      ? source.theme_color.trim() : current.theme_color,
    border_radius: typeof source.border_radius === 'string' || typeof source.border_radius === 'number'
      ? String(source.border_radius).trim() : current.border_radius,
    complaint_url: typeof source.complaint_url === 'string' ? source.complaint_url : current.complaint_url,
    copyright_str: typeof source.copyright_str === 'string' ? source.copyright_str : current.copyright_str,
  };
  await setOption(db, CORE_DOWNLOAD_SETTINGS_OPTION, encodeBase64Json(next));
  return next;
}

/** Read the original WordPress post meta from typecho_fields without changing its name or encoding. */
export async function getCoreDownloadForTheme(db: Database, cid: number): Promise<CoreDownloadThemeData | null> {
  const [field, importedField, settingsRow] = await Promise.all([
    db.query.fields.findFirst({
      where: and(eq(schema.fields.cid, cid), eq(schema.fields.name, CORE_DOWNLOAD_META_FIELD)),
      columns: { str_value: true },
    }),
    db.query.fields.findFirst({
      where: and(eq(schema.fields.cid, cid), eq(schema.fields.name, 'wordpress:' + CORE_DOWNLOAD_META_FIELD)),
      columns: { str_value: true },
    }),
    db.query.options.findFirst({
      where: and(eq(schema.options.name, CORE_DOWNLOAD_SETTINGS_OPTION), eq(schema.options.user, 0)),
      columns: { value: true },
    }),
  ]);
  // The bundled WordPress importer preserves source meta under wordpress:<key>.
  // Prefer the exact original Typecho field when present, then read that import copy.
  let decodedPostData = decodeBase64Json(field?.str_value);
  if (!decodedPostData && importedField?.str_value) {
    const importedValue = importedField.str_value;
    decodedPostData = decodeBase64Json(importedValue);
    if (!decodedPostData) {
      try {
        const importedValues: unknown = JSON.parse(importedValue);
        if (Array.isArray(importedValues) && typeof importedValues[0] === 'string') {
          decodedPostData = decodeBase64Json(importedValues[0]);
        }
      } catch {
        // A single imported postmeta value is normally stored directly.
      }
    }
  }
  if (!decodedPostData) return null;
  const postData = normalizeCoreDownloadPostData(decodedPostData);
  const settings = normalizeSettings(decodeBase64Json(settingsRow?.value));
  if (!postData.open || postData.download_list.length === 0 || settings.open === false) return null;
  return { postData, settings };
}
