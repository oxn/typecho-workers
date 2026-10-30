/**
 * GitHub-style markdown alerts (`> [!NOTE]` / `> [!任意标题]` …).
 *
 * Applied as an HTML post-process so both `marked` (SSR) and HyperDown
 * (admin / plugin preview) produce the same alert markup.
 *
 * The text inside `[!…]` is shown as the alert title. Border accent
 * colors are only applied for NOTE / TIP / WARNING (case-insensitive).
 *
 * HyperDown with `enableLine(true)` merges consecutive `>` blocks into one
 * `<blockquote>` with multiple `<p>` children — those are split here so
 * each `[!label]` paragraph becomes its own alert.
 */

import { escapeHtml } from '@/lib/escape';

/** Labels that receive a colored left border (others keep the default). */
export const ALERT_COLOR_VARIANTS = ['note', 'tip', 'warning'] as const;
export type AlertColorVariant = (typeof ALERT_COLOR_VARIANTS)[number];

/** HyperDown injects empty `<span class="line" …>` markers for scroll sync. */
const LINE_SPAN_RE = /<span\b[^>]*\bclass=(["'])line\1[^>]*>\s*<\/span>/gi;
const MARKER_TAIL_RE = '(?:[ \\t]*<br\\s*\\/?>|[ \\t]*\\n|[ \\t]+)?';
/** Capture any non-empty label up to 64 chars (no nested `]`). */
const LABEL_CAPTURE = '([^\\]]{1,64}?)';
const HAS_ALERT_MARKER_RE = /\[![^\]]+\]/;
const PARAGRAPH_RE = /<p\b[^>]*>[\s\S]*?<\/p>/gi;

/**
 * Rewrite blockquotes that begin with (or contain) `[!label]` into alert
 * blockquotes with the extracted label shown as a title.
 *
 * Non-alert blockquotes are left unchanged.
 */
export function transformGithubAlerts(html: string): string {
  if (!html || !HAS_ALERT_MARKER_RE.test(html)) {
    return html;
  }

  return html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_full, inner: string) => {
    const cleaned = String(inner).replace(LINE_SPAN_RE, '').trim();
    if (!HAS_ALERT_MARKER_RE.test(cleaned)) {
      return `<blockquote>${inner}</blockquote>`;
    }

    // HyperDown line-mode: several consecutive quotes merged into one
    // blockquote with multiple <p> children. Split per paragraph.
    const paragraphs = cleaned.match(PARAGRAPH_RE);
    if (paragraphs && paragraphs.length > 0) {
      return splitMergedBlockquote(cleaned, paragraphs);
    }

    // HyperDown single alert without a wrapping <p>: [!label]<br>body
    const rawMatch = cleaned.match(
      new RegExp(`^\\[!${LABEL_CAPTURE}\\]${MARKER_TAIL_RE}([\\s\\S]*)$`, 'i'),
    );
    if (rawMatch) {
      const label = rawMatch[1].trim();
      if (label) return renderAlert(label, wrapAlertBody(rawMatch[2].trim()));
    }

    return `<blockquote>${inner}</blockquote>`;
  });
}

/**
 * Turn a merged HyperDown / marked blockquote into a sequence of normal
 * quotes and alert quotes, keyed off paragraphs that start with `[!label]`.
 */

function splitMergedBlockquote(cleaned: string, paragraphs: string[]): string {
  const alertParaRe = new RegExp(
    `^<p(?:\\s[^>]*)?>\\s*\\[!${LABEL_CAPTURE}\\]${MARKER_TAIL_RE}([\\s\\S]*?)<\\/p>$`,
    'i',
  );

  type QuoteSegment = { kind: 'quote'; html: string };
  type AlertSegment = { kind: 'alert'; label: string; body: string };
  type Segment = QuoteSegment | AlertSegment;

  const segments: Segment[] = [];
  let cursor = 0;
  let activeAlert: AlertSegment | null = null;

  for (const para of paragraphs) {
    const index = cleaned.indexOf(para, cursor);
    if (index === -1) continue;

    const before = cleaned.slice(cursor, index);
    cursor = index + para.length;

    const match = para.match(alertParaRe);

    if (match) {
      const label = match[1].trim();

      if (label) {
        if (before.trim()) {
          if (activeAlert) {
            activeAlert.body += before;
          } else {
            pushQuote(segments, before.trim());
          }
        }

        const body = match[2].trim();
        activeAlert = {
          kind: 'alert',
          label,
          body: body ? `<p>${body}</p>` : '',
        };
        segments.push(activeAlert);
        continue;
      }
    }

    if (activeAlert) {
      activeAlert.body += before + para;
    } else {
      if (before.trim()) pushQuote(segments, before.trim());
      pushQuote(segments, para);
    }
  }

  const after = cleaned.slice(cursor);
  if (after.trim()) {
    if (activeAlert) {
      activeAlert.body += after;
    } else {
      pushQuote(segments, after.trim());
    }
  }

  if (!segments.some(seg => seg.kind === 'alert')) {
    return `<blockquote>${cleaned}</blockquote>`;
  }

  return segments.map(seg => {
    if (seg.kind === 'alert') return renderAlert(seg.label, seg.body);
    return `<blockquote>${seg.html}</blockquote>`;
  }).join('');
}


function pushQuote(segments: Array<{ kind: 'quote'; html: string } | { kind: 'alert'; label: string; body: string }>, html: string): void {
  const last = segments[segments.length - 1];
  if (last?.kind === 'quote') {
    last.html += html;
    return;
  }
  segments.push({ kind: 'quote', html });
}

function wrapAlertBody(body: string): string {
  if (!body) return '';
  if (/^<(?:p|div|ul|ol|pre|h[1-6]|table|blockquote)\b/i.test(body)) return body;
  return `<p>${body}</p>`;
}

export function alertColorVariant(label: string): AlertColorVariant | null {
  const key = label.trim().toLowerCase();
  if (key === 'note' || key === 'tip' || key === 'warning') return key;
  return null;
}



function alertIcon(label: string): string {
  const icons: Record<string, string> = {
    // NOTE：信息圆圈
    note:
      '<path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>',

    // TIP：灯泡
    tip:
      '<path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/>',

    // IMPORTANT：消息气泡
    important:
      '<path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',

    // WARNING：三角形警告
    warning:
      '<path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',

    // CAUTION：八边形警告
    caution:
      '<path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>',
  };

  const key = label.trim().toLowerCase();
  const paths = icons[key] || icons.note;

  return `<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">${paths}</svg>`;
}


function renderAlert(label: string, body: string): string {
  const variant = alertColorVariant(label);
  const classes = variant
    ? `markdown-alert markdown-alert-${variant}`
    : 'markdown-alert';
  const safeLabel = escapeHtml(label);
  const icon = alertIcon(label);

  return (
    `<blockquote class="${classes}" data-alert="${safeLabel}">` +
    `<p class="markdown-alert-title">${icon}<span>${safeLabel}</span></p>` +
    (body ? body : '') +
    `</blockquote>`
  );
}

