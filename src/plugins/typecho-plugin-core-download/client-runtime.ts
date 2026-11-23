import { CORE_DOWNLOAD_NETDISK_ICONS } from './icons-netdisk';
import { CORE_DOWNLOAD_UI_ICONS } from './icons-ui';

/**
 * Build the browser runtime as a same-origin JavaScript response.
 * This keeps the plugin self-contained: no theme script import or public
 * build artifact is required.
 */
export function buildCoreDownloadClientScript(): string {
  const netdiskIcons = JSON.stringify(CORE_DOWNLOAD_NETDISK_ICONS);
  const uiIcons = JSON.stringify(CORE_DOWNLOAD_UI_ICONS);

  return `(() => {
    const NETDISK_ICONS = ${netdiskIcons};
    const UI_ICONS = ${uiIcons};
    const NETWORK_NAMES = {
      local: '本地下载', aliyun: '阿里云盘', baidu: '百度云盘', '360': '360网盘',
      ct: '诚通网盘', lanzou: '蓝奏云', '123': '123盘', github: 'github',
      quark: '夸克', uc: 'UC', weiyun: '微云', wenshushu: '文叔叔',
      xunlei: '迅雷', jianguo: '坚果云', tianyi: '天翼云', hecai: '和彩云',
      onedrive: 'OneDrive'
    };
    const IMAGE_BASE = '/plugins/typecho-plugin-core-download/static/img/';

    const appendSvg = (target, source) => {
      if (!source) return;
      const holder = document.createElement('div');
      holder.innerHTML = source;
      if (holder.firstElementChild) target.appendChild(holder.firstElementChild);
    };

    const decodeBase64 = value => {
      const binary = atob(String(value).replace(/\\s/g, ''));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    };

    const stripPhpSlashes = value =>
      value.replace(/\\\\(['"\\\\])/g, '$1').replace(/\\\\0/g, '\\0');

    const createItem = item => {
      const card = document.createElement('div');
      card.className = 'core-download-item';
      const inner = document.createElement('div');
      const link = document.createElement('a');
      link.href = typeof item.url === 'string' ? item.url : '';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const header = document.createElement('div');
      header.className = 'core-download-item-header';
      const left = document.createElement('div');
      left.className = 'header-left';
      const network = typeof item.name === 'string' ? item.name : 'local';
      appendSvg(left, NETDISK_ICONS[network] || '');
      const networkName = document.createElement('div');
      networkName.textContent = NETWORK_NAMES[network] || '';
      left.appendChild(networkName);
      header.appendChild(left);
      appendSvg(header, UI_ICONS['open-link'] || '');
      link.appendChild(header);
      inner.appendChild(link);

      const body = document.createElement('div');
      body.className = 'core-download-item-body';
      if (typeof item.resource_name === 'string' && item.resource_name) {
        const resourceName = document.createElement('div');
        resourceName.className = 'resource-name';
        resourceName.textContent = item.resource_name;
        body.appendChild(resourceName);
      }
      const keyLine = document.createElement('div');
      keyLine.className = 'netdisk-key';
      const key = item.key ? String(item.key) : '';
      keyLine.appendChild(document.createTextNode('密码：' + (key || '无')));
      if (key) {
        const copy = document.createElement('span');
        copy.className = 'copy-key';
        copy.setAttribute('role', 'button');
        copy.tabIndex = 0;
        copy.setAttribute('data-clipboard-text', key);
        copy.title = '复制提取码';
        copy.setAttribute('aria-label', '复制提取码');
        copy.style.backgroundImage = 'url("' + IMAGE_BASE + 'copy.svg")';
        const copyKey = async event => {
          event.preventDefault();
          try {
            await navigator.clipboard.writeText(key);
            copy.title = '已复制';
            copy.classList.add('copied');
            window.setTimeout(() => {
              copy.title = '复制提取码';
              copy.classList.remove('copied');
            }, 1500);
          } catch {
            copy.title = '复制失败';
          }
        };
        copy.addEventListener('click', copyKey);
        copy.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') copyKey(event);
        });
        keyLine.appendChild(document.createTextNode(' '));
        keyLine.appendChild(copy);
      }
      body.appendChild(keyLine);
      inner.appendChild(body);
      card.appendChild(inner);
      return card;
    };

    const render = (root, config) => {
      const data = config.postData || {};
      const settings = config.settings || {};
      const list = Array.isArray(data.download_list) ? data.download_list : [];
      if (!data.open || settings.open === false || list.length === 0) {
        root.remove();
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'core-download-warp';
      wrapper.style.setProperty('--theme-color', settings.theme_color || '#409EFF');
      wrapper.style.setProperty('--border-radius', String(settings.border_radius ?? '8') + 'px');

      const title = document.createElement('div');
      title.className = 'download-title';
      const titleLeft = document.createElement('div');
      titleLeft.className = 'download-title-left';
      titleLeft.textContent = '资源下载';
      const titleRight = document.createElement('div');
      titleRight.className = 'download-title-right';
      const complaint = document.createElement('a');
      complaint.href = settings.complaint_url || '';
      complaint.target = '_blank';
      complaint.rel = 'noopener noreferrer';
      appendSvg(complaint, UI_ICONS.warn_icon || '');
      complaint.appendChild(document.createTextNode('投诉'));
      titleRight.appendChild(complaint);
      title.append(titleLeft, titleRight);
      wrapper.appendChild(title);

      const description = document.createElement('div');
      if (typeof data.content === 'string' && data.content) {
        try {
          description.innerHTML = stripPhpSlashes(decodeBase64(data.content));
        } catch {
          description.textContent = '';
        }
      }
      wrapper.appendChild(description);

      const listTitle = document.createElement('div');
      listTitle.className = 'download-title-2';
      listTitle.textContent = '下载地址';
      wrapper.appendChild(listTitle);

      const listElement = document.createElement('div');
      listElement.className = 'core-download-url-list';
      list.forEach(item => listElement.appendChild(createItem(item || {})));
      wrapper.appendChild(listElement);

      const footer = document.createElement('div');
      footer.className = 'core-download-footer';
      const copyright = document.createElement('div');
      copyright.className = 'copyright-str';
      copyright.innerHTML = settings.copyright_str || '';
      const logoWrap = document.createElement('div');
      logoWrap.className = 'copyright-right';
      const logoLink = document.createElement('a');
      logoLink.href = 'https://www.lovestu.com/coredownload.html';
      logoLink.target = '_blank';
      logoLink.rel = 'noopener noreferrer';
      appendSvg(logoLink, UI_ICONS.front_logo || '');
      logoWrap.appendChild(logoLink);
      footer.append(copyright, logoWrap);
      wrapper.appendChild(footer);
      root.replaceChildren(wrapper);
    };

    const mount = async () => {
      const roots = Array.from(document.querySelectorAll('[data-core-download]'))
        .filter(root => root.dataset.mounted !== '1');
      if (!roots.length) return;
      roots.forEach(root => { root.dataset.mounted = '1'; });
      try {
        const pageUrl = new URL(location.href);
        const dataUrl = new URL('/api/core-download/data', location.origin);
        dataUrl.searchParams.set('path', location.pathname);
        const password = pageUrl.searchParams.get('password');
        if (password) dataUrl.searchParams.set('password', password);
        const response = await fetch(dataUrl.toString(), {
          credentials: 'same-origin', headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Download data request failed');
        const config = await response.json();
        roots.forEach(root => config ? render(root, config) : root.remove());
      } catch {
        roots.forEach(root => root.remove());
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  })();`;
}
