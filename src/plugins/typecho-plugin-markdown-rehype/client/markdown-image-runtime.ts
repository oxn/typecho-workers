import { drawBlurhashToCanvas } from './lib/blurhash';

function showImagePlaceholder(inner: HTMLElement, alt: string, block: boolean): void {
  if (inner.querySelector('.rin-image-placeholder')) return;
  const placeholder = document.createElement('span');
  placeholder.className = 'rin-image-placeholder ' + (block ? 'is-block' : 'is-inline');
  if (alt) {
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', alt);
  }
  placeholder.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="8.5" cy="9" r="1.5" fill="currentColor"/><path d="m4 17 5-5 3 3 3-4 5 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  inner.append(placeholder);
}

function enhanceImage(image: HTMLImageElement): void {
  if (image.dataset.rinImageEnhanced === '1') return;
  image.dataset.rinImageEnhanced = '1';
  const block = image.dataset.rinImageLayout === 'block';
  const rounded = block;
  const scale = block ? '0.75' : '0.5';
  const outer = document.createElement('span');
  outer.className = block ? 'rin-image-block' : 'rin-image-inline';
  const inner = document.createElement('span');
  inner.className = 'rin-image-inner' + (rounded ? ' is-rounded' : '');
  inner.style.zoom = scale;
  const width = Number.parseInt(image.getAttribute('width') || '', 10);
  const height = Number.parseInt(image.getAttribute('height') || '', 10);
  if (width > 0 && height > 0) inner.style.aspectRatio = width + ' / ' + height;

  const blurhash = image.dataset.blurhash || '';
  let canvas: HTMLCanvasElement | null = null;
  if (blurhash) {
    canvas = document.createElement('canvas');
    canvas.className = 'rin-image-blurhash' + (rounded ? ' is-rounded' : '');
    canvas.setAttribute('aria-hidden', 'true');
    try { drawBlurhashToCanvas(canvas, blurhash); }
    catch (error) { console.error('Failed to render blurhash', error); canvas = null; }
    if (canvas) inner.append(canvas);
  }

  image.classList.add('rin-image-element');
  if (rounded) image.classList.add('is-rounded');
  inner.append(image);
  outer.append(inner);
  image.before(outer);

  const loaded = () => {
    image.classList.remove('is-loading', 'is-hidden');
    inner.querySelector('.rin-image-placeholder')?.remove();
    canvas?.remove();
  };
  const failed = () => {
    image.classList.remove('is-loading');
    image.classList.add('is-hidden');
    if (!blurhash || !canvas) showImagePlaceholder(inner, image.alt || '', block);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', failed);
  if (image.complete) {
    if (image.naturalWidth > 0) loaded();
    else failed();
  } else if (canvas) {
    image.classList.add('is-loading');
  }
}

function createLightbox(): {
  open: (image: HTMLImageElement) => void;
  close: () => void;
} {
  let root = document.querySelector<HTMLElement>('.rin-lightbox');
  if (!root) {
    root = document.createElement('div');
    root.className = 'rin-lightbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Image viewer');
    root.innerHTML = '<div class="rin-lightbox-toolbar"><span class="rin-lightbox-counter"></span><button type="button" data-action="zoom-out" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button type="button" data-action="zoom-in" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button><a data-action="download" href="#" download aria-label="Download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg></a><button type="button" data-action="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m18 6-12 12M6 6l12 12"/></svg></button></div><button type="button" class="rin-lightbox-nav rin-lightbox-prev" data-action="prev" aria-label="Previous image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button><img class="rin-lightbox-image" alt=""><button type="button" class="rin-lightbox-nav rin-lightbox-next" data-action="next" aria-label="Next image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button><div class="rin-lightbox-caption"></div>';
    document.body.append(root);
  }
  const image = root.querySelector<HTMLImageElement>('.rin-lightbox-image')!;
  const counter = root.querySelector<HTMLElement>('.rin-lightbox-counter')!;
  const caption = root.querySelector<HTMLElement>('.rin-lightbox-caption')!;
  const download = root.querySelector<HTMLAnchorElement>('[data-action="download"]')!;
  let activeIndex = -1;
  let activeRoot: Element | null = null;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let pointerDrag: { x: number; y: number; originX: number; originY: number } | null = null;
  let touchStart: { x: number; y: number; originX: number; originY: number } | null = null;
  let pinchStart: { distance: number; zoom: number } | null = null;
  const slides = () => activeRoot ? Array.from(activeRoot.querySelectorAll<HTMLImageElement>('img')).filter(item => item.getAttribute('src')) : [];
  const resetZoom = () => { zoom = 1; offsetX = 0; offsetY = 0; };
  const render = () => {
    const list = slides();
    if (activeIndex < 0 || activeIndex >= list.length) return;
    const active = list[activeIndex];
    image.src = active.currentSrc || active.src;
    image.alt = active.alt || '';
    image.style.transform = 'translate3d(' + offsetX + 'px,' + offsetY + 'px,0) scale(' + zoom + ')';
    image.classList.toggle('is-zoomed', zoom > 1);
    counter.textContent = (activeIndex + 1) + ' / ' + list.length;
    caption.textContent = active.alt || '';
    const src = active.currentSrc || active.src;
    download.href = src;
    download.download = src.split('/').pop() || '';
    root!.querySelector<HTMLElement>('.rin-lightbox-prev')!.style.visibility = list.length > 1 ? 'visible' : 'hidden';
    root!.querySelector<HTMLElement>('.rin-lightbox-next')!.style.visibility = list.length > 1 ? 'visible' : 'hidden';
  };
  const move = (direction: number) => {
    const count = slides().length;
    if (count < 2) return;
    activeIndex = (activeIndex + direction + count) % count;
    resetZoom();
    render();
  };
  const close = () => {
    activeIndex = -1;
    activeRoot = null;
    pointerDrag = null;
    touchStart = null;
    pinchStart = null;
    resetZoom();
    root!.classList.remove('is-open');
    image.removeAttribute('src');
    document.body.style.removeProperty('overflow');
  };
  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (target === root) { close(); return; }
    if (action === 'close') close();
    else if (action === 'zoom-in') { zoom = Math.min(zoom + .25, 4); render(); }
    else if (action === 'zoom-out') { zoom = Math.max(zoom - .25, 1); if (zoom === 1) { offsetX = 0; offsetY = 0; } render(); }
    else if (action === 'next') move(1);
    else if (action === 'prev') move(-1);
  });
  image.addEventListener('dblclick', event => {
    event.preventDefault();
    zoom = zoom > 1 ? 1 : 2;
    if (zoom === 1) { offsetX = 0; offsetY = 0; }
    render();
  });
  root.addEventListener('wheel', event => {
    if (!root!.classList.contains('is-open')) return;
    event.preventDefault();
    if (event.deltaY < 0) zoom = Math.min(zoom + .1, 4);
    else zoom = Math.max(zoom - .1, 1);
    if (zoom === 1) { offsetX = 0; offsetY = 0; }
    render();
  }, { passive: false });
  root.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || zoom <= 1 || event.target !== image) return;
    pointerDrag = { x: event.clientX, y: event.clientY, originX: offsetX, originY: offsetY };
    image.setPointerCapture?.(event.pointerId);
    image.classList.add('is-dragging');
  });
  root.addEventListener('pointermove', event => {
    if (!pointerDrag) return;
    offsetX = pointerDrag.originX + event.clientX - pointerDrag.x;
    offsetY = pointerDrag.originY + event.clientY - pointerDrag.y;
    render();
  });
  const endPointerDrag = () => {
    pointerDrag = null;
    image.classList.remove('is-dragging');
  };
  root.addEventListener('pointerup', endPointerDrag);
  root.addEventListener('pointercancel', endPointerDrag);
  const touchDistance = (touches: TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };
  root.addEventListener('touchstart', event => {
    if (!root!.classList.contains('is-open')) return;
    if (event.touches.length >= 2) {
      pinchStart = { distance: touchDistance(event.touches), zoom };
      touchStart = null;
      event.preventDefault();
    } else if (event.touches.length === 1) {
      touchStart = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        originX: offsetX,
        originY: offsetY,
      };
    }
  }, { passive: false });
  root.addEventListener('touchmove', event => {
    if (pinchStart && event.touches.length >= 2) {
      zoom = Math.max(1, Math.min(4, pinchStart.zoom * touchDistance(event.touches) / Math.max(1, pinchStart.distance)));
      if (zoom === 1) { offsetX = 0; offsetY = 0; }
      render();
      event.preventDefault();
      return;
    }
    if (touchStart && event.touches.length === 1 && zoom > 1) {
      offsetX = touchStart.originX + event.touches[0].clientX - touchStart.x;
      offsetY = touchStart.originY + event.touches[0].clientY - touchStart.y;
      render();
      event.preventDefault();
    }
  }, { passive: false });
  root.addEventListener('touchend', event => {
    if (pinchStart) { pinchStart = null; touchStart = null; return; }
    if (!touchStart) return;
    const end = event.changedTouches[0];
    const deltaX = end ? end.clientX - touchStart.x : 0;
    if (zoom <= 1 && Math.abs(deltaX) > 55) move(deltaX < 0 ? 1 : -1);
    touchStart = null;
  });
  document.addEventListener('keydown', event => {
    if (!root!.classList.contains('is-open')) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === '+' || event.key === '=') { zoom = Math.min(zoom + .25, 4); render(); }
    else if (event.key === '-') { zoom = Math.max(zoom - .25, 1); if (zoom === 1) { offsetX = 0; offsetY = 0; } render(); }
  });
  return {
    open: selected => {
      activeRoot = selected.closest('.toc-content');
      const list = slides();
      const selectedSrc = selected.currentSrc || selected.src;
      activeIndex = list.findIndex(item => (item.currentSrc || item.src) === selectedSrc);
      if (activeIndex < 0) return;
      resetZoom();
      render();
      root!.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    },
    close,
  };
}


let lightbox: ReturnType<typeof createLightbox> | null = null;

function initialize(root: Element): void {
  root.querySelectorAll<HTMLImageElement>('img').forEach(enhanceImage);
  if (root.getAttribute('data-rin-image-click-bound') !== '1') {
    root.setAttribute('data-rin-image-click-bound', '1');
    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const image = target.closest('img.rin-image-element') as HTMLImageElement | null;
      if (image) lightbox?.open(image);
    });
  }
}

(window as any).__rinMarkdownImageRuntime = { initialize };
