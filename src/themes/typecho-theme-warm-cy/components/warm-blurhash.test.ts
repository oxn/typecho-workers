import { describe, expect, it } from 'vitest';
import { decodeBlurHash } from './warm-blurhash';

describe('Warm CY BlurHash decoder', () => {
  it('decodes Rin 4x3 component hashes using the base-9 size flag', () => {
    const pixels = decodeBlurHash('LfLp{l%09GXo.T-S%1tSIWj=t7f9', 2, 2);
    expect(pixels).toHaveLength(2 * 2 * 4);
    // Reference output from Rin's decoder for the first two pixels.
    expect(Array.from(pixels.slice(0, 8))).toEqual([218, 214, 220, 255, 201, 206, 207, 255]);
  });

  it('rejects malformed component flags and hash lengths', () => {
    expect(() => decodeBlurHash('not-a-valid-hash', 2, 2)).toThrow();
  });
});
