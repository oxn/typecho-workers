const BASE83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
function decode83(value: string): number {
  let result = 0;
  for (const char of value) {
    const digit = BASE83.indexOf(char);
    if (digit < 0) throw new Error("Invalid blurhash character");
    result = result * 83 + digit;
  }
  return result;
}
function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(value: number): number {
  const normalized = Math.max(0, Math.min(1, value));
  return normalized <= 0.0031308
    ? Math.round(normalized * 12.92 * 255 + 0.5)
    : Math.round((1.055 * normalized ** (1 / 2.4) - 0.055) * 255 + 0.5);
}
function signPow(value: number, exp: number): number {
  return Math.sign(value) * Math.abs(value) ** exp;
}
function decodeDC(value: number): [number, number, number] {
  return [srgbToLinear(value >> 16), srgbToLinear((value >> 8) & 255), srgbToLinear(value & 255)];
}
function decodeAC(value: number, maximumValue: number): [number, number, number] {
  const r = Math.floor(value / (19 * 19));
  const g = Math.floor(value / 19) % 19;
  const b = value % 19;
  return [r, g, b].map(channel => signPow((channel - 9) / 9, 2) * maximumValue) as [number, number, number];
}
export function decodeBlurhash(blurhash: string, width: number, height: number, punch = 1): Uint8ClampedArray {
  if (!blurhash || blurhash.length < 6) throw new Error("Invalid blurhash");
  const sizeFlag = decode83(blurhash[0]);
  const componentX = sizeFlag % 9 + 1;
  const componentY = Math.floor(sizeFlag / 9) + 1;
  if (blurhash.length !== 4 + 2 * componentX * componentY) throw new Error("Invalid blurhash length");
  const maximumValue = (decode83(blurhash[1]) + 1) / 166;
  const colors: Array<[number, number, number]> = [decodeDC(decode83(blurhash.slice(2, 6)))];
  for (let i = 1; i < componentX * componentY; i++) {
    colors.push(decodeAC(decode83(blurhash.slice(4 + i * 2, 6 + i * 2)), maximumValue * punch));
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < componentY; j++) {
        for (let i = 0; i < componentX; i++) {
          const basis = Math.cos(Math.PI * x * i / width) * Math.cos(Math.PI * y * j / height);
          const color = colors[i + j * componentX] || [0, 0, 0];
          r += color[0] * basis; g += color[1] * basis; b += color[2] * basis;
        }
      }
      const offset = 4 * (y * width + x);
      pixels[offset] = linearToSrgb(r);
      pixels[offset + 1] = linearToSrgb(g);
      pixels[offset + 2] = linearToSrgb(b);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
export function drawBlurhashToCanvas(canvas: HTMLCanvasElement, blurhash: string, width = 32, height = 32): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixels = decodeBlurhash(blurhash, width, height);
  canvas.width = width;
  canvas.height = height;
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
}
