import { titleToPinyinSlug } from '../pinyin';

(function () {
  var script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  var formName = script.dataset.formName || '';
  var form = document.forms.namedItem(formName) as HTMLFormElement | null;
  var title = document.getElementById('title') as HTMLInputElement | null;
  var permalinkRow = document.querySelector('p.url-slug') as HTMLElement | null;
  if (!form || !title || !permalinkRow || form.dataset.pinyinSlugReady === '1') return;
  form.dataset.pinyinSlugReady = '1';

  var initialSlug = script.dataset.initialSlug || '';
  var currentCid = Number(script.dataset.currentCid || 0);
  var allowsSlugEdit = script.dataset.allowsSlugEdit === 'true';
  var titleMaxLength = Number(script.dataset.titleMaxLength || 100);
  var slugMaxLength = Number(script.dataset.slugMaxLength || 300);

  title.maxLength = titleMaxLength;
  var slug = document.getElementById('slug') as HTMLInputElement | null;

  permalinkRow.style.display = 'flex';
  permalinkRow.style.flexWrap = window.matchMedia('(max-width: 767px)').matches ? 'wrap' : 'nowrap';
  permalinkRow.style.alignItems = 'center';
  permalinkRow.style.gap = '8px';
  permalinkRow.style.maxWidth = '100%';
  permalinkRow.style.minWidth = '0';
  permalinkRow.style.overflowX = 'hidden';

  if (!slug) {
    var label = document.createElement('label');
    label.htmlFor = 'slug';
    label.textContent = '缩略名';
    label.style.cssText = 'flex:0 0 auto;margin-left:2px;';

    slug = document.createElement('input');
    slug.type = 'text';
    slug.id = 'slug';
    slug.autocomplete = 'off';
    slug.className = 'mono';
    slug.value = initialSlug;
    slug.placeholder = '输入缩略名';
    slug.setAttribute('aria-label', '缩略名');
    slug.style.cssText = 'box-sizing:border-box;flex:0 1 auto;width:120px;max-width:min(420px,100%);min-width:48px;white-space:nowrap;overflow:hidden;';
    permalinkRow.appendChild(label);
    permalinkRow.appendChild(slug);
  } else {
    slug.style.boxSizing = 'border-box';
    slug.style.flex = '0 1 auto';
    slug.style.width = '120px';
    slug.style.maxWidth = 'min(420px,100%)';
    slug.style.minWidth = '48px';
    slug.style.overflow = 'hidden';
  }

  slug.maxLength = slugMaxLength;
  if (slug.value.length > slugMaxLength) slug.value = slug.value.slice(0, slugMaxLength);

  var measureCanvas = document.createElement('canvas');

  function updateSlugInputWidth() {
    var mobile = window.matchMedia('(max-width: 767px)').matches;
    permalinkRow!.style.flexWrap = mobile ? 'wrap' : 'nowrap';
    var style = window.getComputedStyle(slug!);
    var context = measureCanvas.getContext && measureCanvas.getContext('2d');
    var text = String(slug!.value || slug!.placeholder || '');
    var measured = 120;
    if (context) {
      context.font = style.font;
      measured = Math.ceil(context.measureText(text).width) +
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) +
        (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0) + 14;
    }

    var available = Math.max(48, permalinkRow!.clientWidth);
    if (!mobile) {
      var siblingsWidth = 0;
      Array.prototype.forEach.call(permalinkRow!.children, function (child: Element) {
        if (child !== slug) siblingsWidth += child.getBoundingClientRect().width;
      });
      var gap = parseFloat(window.getComputedStyle(permalinkRow!).columnGap) || 0;
      available = Math.max(48, permalinkRow!.clientWidth - siblingsWidth -
        gap * Math.max(0, permalinkRow!.children.length - 1) - 2);
    }

    var width = Math.max(48, Math.min(measured, available, 420));
    slug!.style.width = width + 'px';
    slug!.style.maxWidth = mobile ? '100%' : width + 'px';
    slug!.style.flex = '0 1 auto';
  }

  var lastGenerated = '';
  var manual = String(initialSlug || '').trim() !== '';

  function generate(force: boolean) {
    var value = String(title!.value || '').trim();
    if (!value || (!force && (manual || (slug!.value && slug!.value !== lastGenerated)))) return;
    var generated = titleToPinyinSlug(value, slugMaxLength);
    if (!generated) return;
    lastGenerated = generated;
    slug!.value = generated;
    updateSlugInputWidth();
    slug!.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Generation is intentionally triggered only after leaving the title field.
  title.addEventListener('blur', function () {
    generate(false);
  });

  slug.addEventListener('input', function () {
    if (String(slug!.value || '') !== lastGenerated) manual = true;
    updateSlugInputWidth();
  });

  var regenerate = document.createElement('button');
  regenerate.type = 'button';
  regenerate.className = 'btn btn-xs';
  regenerate.textContent = '重新生成';
  regenerate.addEventListener('click', function () {
    manual = false;
    generate(true);
  });
  regenerate.style.cssText = 'flex:0 0 auto;white-space:nowrap;';
  permalinkRow.appendChild(regenerate);

  if (allowsSlugEdit) {
    var cid = document.createElement('span');
    cid.textContent = 'CID=' + (currentCid > 0 ? String(currentCid) : '保存后生成');
    cid.style.cssText = 'color:#999;font-size:12px;white-space:nowrap;margin-left:2px;';
    permalinkRow.appendChild(cid);
  }

  updateSlugInputWidth();
  window.addEventListener('resize', updateSlugInputWidth);
  if (window.ResizeObserver) {
    var slugRowObserver = new ResizeObserver(updateSlugInputWidth);
    slugRowObserver.observe(permalinkRow);
  }

  // The original server-side finishSave hook remains responsible for the
  // original duplicate-slug handling. The browser only submits the chosen slug.
  form.addEventListener('submit', function () {
    var value = String(slug!.value || '').trim();
    var target = new URL(form!.getAttribute('action') || '/api/admin/content', window.location.href);
    if (value) target.searchParams.set('__pinyinSlug', value);
    else target.searchParams.delete('__pinyinSlug');
    form!.setAttribute('action', target.pathname + target.search + target.hash);
  });
})();
