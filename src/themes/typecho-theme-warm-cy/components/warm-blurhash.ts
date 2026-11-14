const BASE83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function decode83(value: string): number {
  let result = 0;
  for (const character of value) {
    const digit = BASE83.indexOf(character);
    if (digit < 0) throw new Error('Invalid BlurHash character');
    result = result * 83 + digit;
  }
  return result;
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const normalized = Math.max(0, Math.min(1, value));
  return Math.round(255 * (normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055));
}

function signPow(value: number, exp: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), exp);
}

export function decodeBlurHash(hash: string, width: number, height: number): Uint8ClampedArray {
  if (hash.length < 6) throw new Error('Invalid BlurHash length');
  const sizeFlag = decode83(hash[0]);
  const componentsX = (sizeFlag % 9) + 1;
  const componentsY = Math.floor(sizeFlag / 9) + 1;
  if (componentsX > 9 || componentsY > 9 || hash.length !== 4 + 2 * componentsX * componentsY) {
    throw new Error('Invalid BlurHash component count');
  }
  const quantizedMaximum = decode83(hash[1]);
  const maximumValue = (quantizedMaximum + 1) / 166;
  const colors: number[][] = [];
  const dc = decode83(hash.slice(2, 6));
  colors.push([
    srgbToLinear(dc >> 16),
    srgbToLinear((dc >> 8) & 255),
    srgbToLinear(dc & 255),
  ]);
  for (let index = 1; index < componentsX * componentsY; index++) {
    const value = decode83(hash.slice(4 + index * 2, 6 + index * 2));
    const red = Math.floor(value / (19 * 19));
    const green = Math.floor(value / 19) % 19;
    const blue = value % 19;
    colors.push([
      signPow((red - 9) / 9, 2) * maximumValue,
      signPow((green - 9) / 9, 2) * maximumValue,
      signPow((blue - 9) / 9, 2) * maximumValue,
    ]);
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const redGreenBlue = [0, 0, 0];
      for (let j = 0; j < componentsY; j++) {
        for (let i = 0; i < componentsX; i++) {
          const basis = Math.cos(Math.PI * x * i / width) * Math.cos(Math.PI * y * j / height);
          const color = colors[i + j * componentsX];
          redGreenBlue[0] += color[0] * basis;
          redGreenBlue[1] += color[1] * basis;
          redGreenBlue[2] += color[2] * basis;
        }
      }
      const offset = 4 * (x + y * width);
      pixels[offset] = linearToSrgb(redGreenBlue[0]);
      pixels[offset + 1] = linearToSrgb(redGreenBlue[1]);
      pixels[offset + 2] = linearToSrgb(redGreenBlue[2]);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function drawBlurhashToCanvas(canvas: HTMLCanvasElement, hash: string): void {
  const width = 32;
  const height = 32;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  const imageData = context.createImageData(width, height);
  imageData.data.set(decodeBlurHash(hash, width, height));
  canvas.width = width;
  canvas.height = height;
  context.putImageData(imageData, 0, 0);
}

/** Render the placeholder on a sibling canvas, as Rin does, not on the hidden img itself. */
export function initWarmBlurhash(root: ParentNode = document): void {
  const images: HTMLImageElement[] = [];
  if (root instanceof HTMLImageElement) images.push(root);
  root.querySelectorAll?.('img[data-blurhash]').forEach(image => {
    if (image instanceof HTMLImageElement) images.push(image);
  });

  for (const image of images) {
    if (image.dataset.warmBlurhashReady === '1') continue;
    const hash = image.dataset.blurhash || '';
    if (!hash || image.parentElement?.tagName === 'PICTURE') continue;
    if (image.complete && image.naturalWidth > 0) {
      image.dataset.warmBlurhashReady = '1';
      continue;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.width = 32;
      canvas.height = 32;
      drawBlurhashToCanvas(canvas, hash);

      const parent = image.parentNode;
      if (!parent) continue;
      const wrapper = document.createElement('span');
      const display = window.getComputedStyle(image).display;
      wrapper.style.position = 'relative';
      wrapper.style.display = display === 'block' ? 'block' : 'inline-block';
      wrapper.style.maxWidth = '100%';
      wrapper.style.overflow = 'hidden';
      wrapper.style.verticalAlign = 'middle';

      const width = image.getAttribute('width');
      const height = image.getAttribute('height');
      if (width && height) wrapper.style.aspectRatio = width + ' / ' + height;

      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'cover';
      canvas.style.filter = 'blur(8px)';
      canvas.style.transform = 'scale(1.05)';
      canvas.style.pointerEvents = 'none';

      parent.insertBefore(wrapper, image);
      wrapper.append(canvas, image);
      image.dataset.warmBlurhashReady = '1';
      image.style.position = 'relative';
      image.style.zIndex = '1';
      image.style.transition = image.style.transition
        ? image.style.transition + ', opacity 180ms ease'
        : 'opacity 180ms ease';
      image.style.opacity = '0';

      const reveal = () => {
        image.style.opacity = '';
        canvas.remove();
        image.removeEventListener('load', reveal);
      };
      image.addEventListener('load', reveal, { once: true });
      // On failure, keep the decoded canvas visible as Rin does when an image fails.
    } catch {
      // Invalid hashes or unavailable canvas support must never affect the image.
    }
  }
}
