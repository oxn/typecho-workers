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
  const outer = document.createElement('span');
  outer.className = block ? 'rin-image-block block w-full text-center my-4' : 'rin-image-inline inline-block align-middle mx-1';
  const inner = document.createElement('span');
  inner.className = 'rin-image-inner relative inline-block max-w-full overflow-hidden' + (rounded ? ' is-rounded rounded-xl' : '');
  const width = Number.parseInt(image.getAttribute('width') || '', 10);
  const height = Number.parseInt(image.getAttribute('height') || '', 10);
  // Warm's breakout rule sets width:auto on images, overriding HTML width hints.
  // Restore the parsed source width inline; max-width:100% still constrains it,
  // while height:auto in the stylesheet preserves the intrinsic aspect ratio.
  if (width > 0) image.style.width = width + 'px';
  if (width > 0 && height > 0) inner.style.aspectRatio = width + ' / ' + height;

  const blurhash = image.dataset.rinBlurhash || '';
  let canvas: HTMLCanvasElement | null = null;
  if (blurhash) {
    canvas = document.createElement('canvas');
    canvas.className = 'rin-image-blurhash absolute inset-0 h-full w-full scale-110 blur-sm' + (rounded ? ' is-rounded rounded-xl' : '');
    canvas.setAttribute('aria-hidden', 'true');
    try { drawBlurhashToCanvas(canvas, blurhash); }
    catch (error) { console.error('Failed to render blurhash', error); canvas = null; }
    if (canvas) inner.append(canvas);
  }

  // Match Rin's rendered <img> classes; data attributes identify the runtime-managed image.
  image.classList.add('mx-auto', 'max-w-full', 'cursor-zoom-in', 'transition-opacity');
  if (rounded) image.classList.add('rounded-xl');
  // Insert the wrapper at the image's original position before moving the image.
  // Moving first would make outer an ancestor of image, so image.before(outer)
  // would try to insert an ancestor into its own descendant and throw.
  image.before(outer);
  outer.append(inner);
  inner.append(image);

  const loaded = () => {
    image.classList.remove('opacity-0', 'hidden');
    image.classList.add('opacity-100');
    inner.querySelector('.rin-image-placeholder')?.remove();
    canvas?.remove();
  };
  const failed = () => {
    image.classList.remove('opacity-0', 'opacity-100');
    image.classList.add('hidden');
    if (!blurhash || !canvas) showImagePlaceholder(inner, image.alt || '', block);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', failed);
  if (image.complete) {
    if (image.naturalWidth > 0) loaded();
    else failed();
  } else if (canvas) {
    image.classList.add('opacity-0');
  } else {
    image.classList.add('opacity-100');
  }
}

function createLightbox(): {
  open: (image: HTMLImageElement) => void;
  close: () => void;
  isConnected: () => boolean;
} {
  let root = document.querySelector<HTMLElement>('.rin-lightbox');
  if (!root) {
    root = document.createElement('div');
    root.className = 'rin-lightbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Image viewer');
    root.setAttribute('tabindex', '-1');
    root.innerHTML = '<div class="rin-lightbox-toolbar"><span class="rin-lightbox-counter"></span><button type="button" data-action="zoom-out" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button type="button" data-action="zoom-in" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button><a data-action="download" href="#" download aria-label="Download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg></a><button type="button" data-action="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m18 6-12 12M6 6l12 12"/></svg></button></div><button type="button" class="rin-lightbox-nav rin-lightbox-prev" data-action="prev" aria-label="Previous image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button><img class="rin-lightbox-image" alt=""><button type="button" class="rin-lightbox-nav rin-lightbox-next" data-action="next" aria-label="Next image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>';
    document.body.append(root);
  }
  const image = root.querySelector<HTMLImageElement>('.rin-lightbox-image')!;
  const counter = root.querySelector<HTMLElement>('.rin-lightbox-counter')!;
  const download = root.querySelector<HTMLAnchorElement>('[data-action="download"]')!;
  let activeIndex = -1;
  let activeRoot: Element | null = null;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let pointerDrag: { x: number; y: number; originX: number; originY: number } | null = null;
  let touchStart: { x: number; y: number; originX: number; originY: number } | null = null;
  let pinchStart: { distance: number; zoom: number } | null = null;
  let previouslyFocusedElement: HTMLElement | null = null;
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
    const focusTarget = previouslyFocusedElement;
    previouslyFocusedElement = null;
    focusTarget?.focus();
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
    if (event.key === 'Tab') {
      const focusable = Array.from(root!.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href], [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        root!.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root!.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root!.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === '+' || event.key === '=') { zoom = Math.min(zoom + .25, 4); render(); }
    else if (event.key === '-') { zoom = Math.max(zoom - .25, 1); if (zoom === 1) { offsetX = 0; offsetY = 0; } render(); }
  });
  return {
    open: selected => {
      if (!root!.classList.contains('is-open')) {
        previouslyFocusedElement = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      }
      activeRoot = selected.closest('.warm-prose, .toc-content') || selected.parentElement;
      const list = slides();
      const selectedSrc = selected.currentSrc || selected.src;
      activeIndex = list.findIndex(item => (item.currentSrc || item.src) === selectedSrc);
      if (activeIndex < 0) return;
      resetZoom();
      render();
      root!.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      root!.querySelector<HTMLButtonElement>('[data-action="close"]')?.focus();
    },
    close,
    isConnected: () => root!.isConnected,
  };
}


let lightbox: ReturnType<typeof createLightbox> | null = null;

// Create the viewer once when the image runtime is loaded. Without this,
// the delegated image click handler has no viewer instance to open.
if (typeof document !== 'undefined' && document.body) {
  lightbox = createLightbox();
}

export function initializeImages(root: Element): void {
  // InstantClick replaces <body>, detaching the previous lightbox node while
  // this module remains cached. Recreate it against the current document body.
  if (!lightbox || !lightbox.isConnected()) lightbox = createLightbox();
  root.querySelectorAll<HTMLImageElement>('img').forEach(enhanceImage);
  if (root.getAttribute('data-rin-image-click-bound') !== '1') {
    root.setAttribute('data-rin-image-click-bound', '1');
    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const image = target.closest('img[data-rin-image-enhanced="1"]') as HTMLImageElement | null;
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      lightbox?.open(image);
    });
  }
}


