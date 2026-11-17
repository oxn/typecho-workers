import { and, eq, sql } from 'drizzle-orm';
import { parsePluginOption } from 'typecho/plugin-sdk';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { schema } from '@/db';

const SAVE_SLUG_PARAM = '__pinyinSlug';
const DEFAULT_TITLE_LENGTH = 100;
const DEFAULT_SLUG_LENGTH = 300;
const DEFAULT_SLUG_ATTEMPTS = 50;

type EditorExtra = {
  options?: Record<string, unknown>;
  post?: { cid?: number; slug?: string | null };
  page?: { cid?: number; slug?: string | null };
};

type SaveExtra = {
  request?: Request;
  db?: any;
  options?: Record<string, unknown>;
};

type PinyinConfig = { titleLength: number; slugLength: number; slugAttempts: number };

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getConfig(options?: Record<string, unknown>): PinyinConfig {
  const raw = parsePluginOption(options?.['plugin:typecho-plugin-pinyin']);
  return {
    titleLength: boundedInteger(raw.titleLength, DEFAULT_TITLE_LENGTH, 1, 500),
    slugLength: boundedInteger(raw.slugLength, DEFAULT_SLUG_LENGTH, 1, 1000),
    slugAttempts: boundedInteger(raw.slugAttempts, DEFAULT_SLUG_ATTEMPTS, 1, 200),
  };
}

/**
 * Convert a title to a URL-safe ASCII slug.
 * Pinyin conversion stays in the Worker; the editor only sends the title.
 */
export function titleToPinyinSlug(title: string, maxLength = DEFAULT_SLUG_LENGTH): string {
  const source = title.trim();
  if (!source) return '';

  // Keep separators only where the original title contains whitespace,
  // punctuation, or symbols. Pinyin syllables inside a continuous Han run
  // are concatenated instead of being separated with hyphens.
  const slug = source
    .split(/([\s\p{P}\p{S}]+)/u)
    .map((part) => {
      if (!part) return '';
      if (/^[\s\p{P}\p{S}]+$/u.test(part)) return '-';

      return pinyin(part, { toneType: 'none', nonZh: 'consecutive' })
        .replace(/\s+/g, '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

/** Normalize a manually edited slug using the same URL-safe character set. */
function normalizeSlug(value: string, maxLength: number): string {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Claim a unique slug after the core save has created/updated the content row.
 * This mirrors the core compare-and-swap strategy and avoids a SELECT/UPDATE race.
 */
function appendSlugSuffix(base: string, suffix: string, maxLength: number): string {
  // Keep the configured limit even when it is shorter than the CID suffix.
  // Very short limits cannot fit both a separator and the full suffix, so
  // preserve the suffix characters without creating a leading hyphen.
  const suffixText = String(suffix).replace(/[^a-z0-9]/gi, '');
  if (maxLength < 3) return suffixText.slice(-maxLength);

  const suffixPart = suffixText.slice(-Math.max(1, maxLength - 2));
  const tail = `-${suffixPart}`;
  const head = base.slice(0, Math.max(1, maxLength - tail.length)).replace(/-+$/g, '');
  return `${head}${tail}`.slice(0, maxLength);
}

async function claimUniqueSlug(db: any, cid: number, base: string, maxAttempts: number, maxLength: number): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = attempt === 0
      ? base
      : attempt === maxAttempts - 1
        ? appendSlugSuffix(base, `${cid}-${Date.now().toString(36)}`, maxLength)
        : appendSlugSuffix(base, attempt === 1 ? String(cid) : `${cid}-${attempt}`, maxLength);
    const claimed = await db.update(schema.contents)
      .set({ slug: candidate })
      .where(and(
        eq(schema.contents.cid, cid),
        sql`NOT EXISTS (SELECT 1 FROM typecho_contents WHERE slug = ${candidate} AND cid != ${cid})`,
      ))
      .returning({ cid: schema.contents.cid });

    if (claimed.length > 0) return candidate;
  }

  throw new Error(`别名冲突重试已达 ${maxAttempts} 次，请修改别名后重试`);
}

/**
 * The core content endpoint intentionally ignores slug when the permalink
 * pattern has no {slug}. The editor places the requested value in the POST
 * URL, and the existing finishSave hook persists it after the core has claimed
 * its initial slug but before the core invalidates/warmups content caches.
 */
async function persistSubmittedSlug(content: Record<string, any>, extra?: SaveExtra): Promise<void> {
  const request = extra?.request;
  const db = extra?.db;
  if (!request || !db || request.method !== 'POST') return;

  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/content') return;

  const requestedSlug = url.searchParams.get(SAVE_SLUG_PARAM);
  if (!requestedSlug) return;

  const cid = Number(content.cid);
  const config = getConfig(extra?.options);
  const base = normalizeSlug(requestedSlug, config.slugLength);
  if (!Number.isSafeInteger(cid) || cid <= 0 || !base) return;
  if (String(content.slug || '') === base) return;

  const finalSlug = await claimUniqueSlug(db, cid, base, config.slugAttempts, config.slugLength);
  // finishData is the same object the core uses for its subsequent cache work.
  content.slug = finalSlug;
}

function editorHtml(
  formName: 'write_post' | 'write_page',
  allowsSlugEdit: boolean,
  currentSlug: string,
  currentCid: number,
  titleMaxLength: number,
  slugMaxLength: number,
): string {
  const attrs = [
    'src="/plugin-assets/typecho-plugin-pinyin/pinyin-editor.js"',
    'data-form-name="' + formName + '"',
    'data-initial-slug="' + escapeHtmlAttribute(currentSlug) + '"',
    'data-current-cid="' + (Number.isSafeInteger(currentCid) && currentCid > 0 ? String(currentCid) : '0') + '"',
    'data-allows-slug-edit="' + String(allowsSlugEdit) + '"',
    'data-title-max-length="' + titleMaxLength + '"',
    'data-slug-max-length="' + slugMaxLength + '"',
  ].join(' ');
  return '<script ' + attrs + '></script>';
}

function escapeHtmlAttribute(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plugin-owned settings presentation; embedded so disabling this plugin removes it. */
const pinyinAdminCss = [
  '.pinyin-settings-page .typecho-option { margin: 0 0 16px !important; padding: 18px 20px !important; border: 1px solid #e5e9ed !important; border-radius: 8px !important; background: #fff !important; }',
  '.pinyin-settings-page .typecho-option > li { padding: 0 !important; }',
  '.pinyin-settings-page .typecho-option input[type="text"], .pinyin-settings-page .typecho-option input[type="number"] { box-sizing: border-box; width: min(100%, 420px); min-height: 36px; padding: 7px 10px; border: 1px solid #c9cdd2; border-radius: 5px; background: #fff; color: #30343b; font: inherit; }',
  '.pinyin-settings-page .typecho-option input[type="text"]:focus, .pinyin-settings-page .typecho-option input[type="number"]:focus { border-color: #668fc4; outline: 0; box-shadow: 0 0 0 3px rgb(80 130 190 / 14%); }',
  '.pinyin-settings-page .typecho-option p.description, .pinyin-settings-page .typecho-option .description { margin: 8px 0 0 !important; color: #737b85; font-size: 13px; line-height: 1.7; }',
  '.pinyin-settings-page .typecho-option-submit { padding: 0 !important; border: 0 !important; background: transparent !important; }',
  '.pinyin-settings-page .typecho-option-submit > li { padding: 0 !important; }',
  '.pinyin-settings-page .typecho-option-submit .btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 40px; min-height: 40px; margin: 0; padding: 0 16px; border-radius: 6px; line-height: 1.4; }',
  '.pinyin-settings-page .pinyin-toolbar { display: flex; align-items: center; justify-content: flex-end; margin: 0 0 14px; }',
  '.pinyin-settings-page .pinyin-toolbar a { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 40px; min-height: 40px; margin: 0; padding: 0 16px; border: 1px solid #dce2e8; border-radius: 6px; background: #fff; color: #456f9f !important; text-decoration: none; font-size: 13px; line-height: 1.4; }',
  '.pinyin-settings-page .pinyin-toolbar a:hover { border-color: #668fc4; background: #f5f8fc; }',
  '@media (max-width: 767px) { .pinyin-settings-page .typecho-option { padding: 15px !important; } .pinyin-settings-page .typecho-option input[type="text"], .pinyin-settings-page .typecho-option input[type="number"] { width: 100%; max-width: 100%; } }',
].join('\n');

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('admin:header', pluginId, (html: string, extra?: { title?: string }) => {
    if (extra?.title !== '设置插件 拼音别名') return html;
    return `${html}<style data-typecho-pinyin-admin>${pinyinAdminCss}</style>`;
  }, 20);

  addHook('admin:footer', pluginId, (html: string) => {
    const script = [
      '<script data-typecho-pinyin-admin-navigation>',
      '(function () {',
      "  if (window.location.pathname !== '/admin/plugin-config' || new URLSearchParams(window.location.search).get('id') !== 'typecho-plugin-pinyin') return;",
      "  document.body.classList.add('pinyin-settings-page');",
      "  var form = document.querySelector('form[action^=\"/admin/plugin-config\"]');",
      "  if (!form || (form.previousElementSibling && form.previousElementSibling.classList.contains('pinyin-toolbar'))) return;",
      "  var toolbar = document.createElement('div');",
      "  toolbar.className = 'pinyin-toolbar';",
      "  var link = document.createElement('a');",
      "  link.href = '/admin/plugins';",
      "  link.textContent = '返回插件列表';",
      "  toolbar.append(link);",
      "  form.before(toolbar);",
      '})();',
      '</script>',
    ].join('\n');
    return html + script;
  }, 20);

  addHook('admin:writePost:bottom', pluginId, (html: string, extra?: EditorExtra) => {
    const pattern = String(extra?.options?.permalinkPattern || '/archives/{cid}/');
    const post = extra?.post;
    return html + editorHtml(
      'write_post',
      pattern.includes('{slug}'),
      String(post?.slug || ''),
      Number(post?.cid) || 0,
      getConfig(extra?.options).titleLength,
      getConfig(extra?.options).slugLength,
    );
  });

  addHook('admin:writePage:bottom', pluginId, (html: string, extra?: EditorExtra) => {
    const pattern = String(extra?.options?.pagePattern || '/{slug}.html');
    const page = extra?.page;
    return html + editorHtml(
      'write_page',
      pattern.includes('{slug}'),
      String(page?.slug || ''),
      Number(page?.cid) || 0,
      getConfig(extra?.options).titleLength,
      getConfig(extra?.options).slugLength,
    );
  });

  addHook('post:finishSave', pluginId, async (content: Record<string, any>, extra?: SaveExtra) => {
    await persistSubmittedSlug(content, extra);
  });

  addHook('page:finishSave', pluginId, async (content: Record<string, any>, extra?: SaveExtra) => {
    await persistSubmittedSlug(content, extra);
  });

}
