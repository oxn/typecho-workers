import { CORE_DOWNLOAD_NETDISK_ICONS } from './icons-netdisk';
import { CORE_DOWNLOAD_UI_ICONS } from './icons-ui';

const IMAGE_BASE = '/__plugin-assets/typecho-plugin-core-download/img/';
const NETWORK_NAMES: Record<string, string> = {
  local: '本地下载', aliyun: '阿里云盘', baidu: '百度云盘', '360': '360网盘',
  ct: '诚通网盘', lanzou: '蓝奏云', '123': '123盘', github: 'github',
  quark: '夸克', uc: 'UC', weiyun: '微云', wenshushu: '文叔叔',
  xunlei: '迅雷', jianguo: '坚果云', tianyi: '天翼云', hecai: '和彩云',
  onedrive: 'OneDrive',
};

interface DownloadItem {
  name?: string;
  key?: string;
  url?: string;
  resource_name?: string;
  [key: string]: unknown;
}
interface MountConfig {
  postData?: { open?: boolean; content?: string; download_list?: DownloadItem[] };
  settings?: {
    open?: boolean;
    theme_color?: string;
    border_radius?: string | number;
    complaint_url?: string;
    copyright_str?: string;
  };
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stripPhpSlashes(value: string): string {
  return value.replace(/\\(['"\\])/g, '$1').replace(/\\0/g, '\0');
}

function appendInlineSvg(target: HTMLElement, svg: string): void {
  if (!svg) return;
  const holder = document.createElement('div');
  holder.innerHTML = svg;
  const element = holder.firstElementChild;
  if (element) target.appendChild(element);
}

function createDownloadItem(item: DownloadItem): HTMLElement {
  const card = document.createElement('div');
  card.className = 'core-download-item';
  const inner = document.createElement('div');

  const link = document.createElement('a');
  link.href = typeof item.url === 'string' ? item.url : '';
  link.target = '_blank';

  const header = document.createElement('div');
  header.className = 'core-download-item-header';
  const left = document.createElement('div');
  left.className = 'header-left';
  const network = typeof item.name === 'string' ? item.name : 'local';
  appendInlineSvg(left, CORE_DOWNLOAD_NETDISK_ICONS[network] || '');
  const networkName = document.createElement('div');
  networkName.textContent = NETWORK_NAMES[network] || '';
  left.appendChild(networkName);
  header.appendChild(left);
  appendInlineSvg(header, CORE_DOWNLOAD_UI_ICONS['open-link'] || '');
  link.appendChild(header);
  inner.appendChild(link);

  const body = document.createElement('div');
  body.className = 'core-download-item-body';
  const resourceNameValue = typeof item.resource_name === 'string' ? item.resource_name : '';
  if (resourceNameValue !== '') {
    const resourceName = document.createElement('div');
    resourceName.className = 'resource-name';
    resourceName.textContent = resourceNameValue;
    body.appendChild(resourceName);
  }

  const keyValue = item.key ? String(item.key) : '无';
  const keyLine = document.createElement('div');
  keyLine.className = 'netdisk-key';
  keyLine.appendChild(document.createTextNode('密码：' + keyValue));
  if (item.key) {
    const copy = document.createElement('span');
    copy.className = 'copy-key';
    copy.setAttribute('data-clipboard-text', String(item.key));
    copy.title = '复制提取码';
    copy.style.backgroundImage = 'url("' + IMAGE_BASE + 'copy.svg")';
    keyLine.appendChild(document.createTextNode(' '));
    keyLine.appendChild(copy);
  }
  body.appendChild(keyLine);
  inner.appendChild(body);
  card.appendChild(inner);
  return card;
}

function renderMount(root: HTMLElement, config: MountConfig): void {
  const data = config.postData || {};
  const settings = config.settings || {};
  const list = Array.isArray(data.download_list) ? data.download_list : [];
  if (!data.open || settings.open === false || list.length === 0) return;

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
  appendInlineSvg(complaint, CORE_DOWNLOAD_UI_ICONS.warn_icon || '');
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
  list.forEach(item => listElement.appendChild(createDownloadItem(item || {})));
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
  appendInlineSvg(logoLink, CORE_DOWNLOAD_UI_ICONS.front_logo || '');
  logoWrap.appendChild(logoLink);
  footer.append(copyright, logoWrap);
  wrapper.appendChild(footer);

  root.replaceChildren(wrapper);
}

function mountCoreDownload(): void {
  document.querySelectorAll<HTMLElement>('[data-core-download]').forEach(root => {
    if (root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    try {
      renderMount(root, JSON.parse(root.dataset.config || '{}') as MountConfig);
    } catch {
      root.replaceChildren();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountCoreDownload, { once: true });
} else {
  mountCoreDownload();
}
