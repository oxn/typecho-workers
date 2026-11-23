import { describe, expect, it } from 'vitest';
import { buildCoreDownloadClientScript } from './client-runtime';
import {
  decodeBase64Json,
  decodeBase64Utf8,
  encodeBase64Json,
  encodeBase64Utf8,
  normalizeCoreDownloadPostData,
} from './service';

describe('CoreDownload WordPress compatibility', () => {
  it('round-trips UTF-8 Base64 values', () => {
    const value = '<p>资源下载：百度网盘</p>';
    expect(decodeBase64Utf8(encodeBase64Utf8(value))).toBe(value);
  });

  it('round-trips the original Base64(JSON) post meta structure', () => {
    const original = {
      open: true,
      content: encodeBase64Utf8('<p>说明内容</p>'),
      download_list: [{
        name: 'baidu',
        key: '1234',
        url: 'https://example.com',
        resource_name: '测试资源',
        show_type: '',
        legacy_extra: 'keep-me',
      }],
    };
    const encoded = encodeBase64Json(original);
    expect(decodeBase64Json(encoded)).toEqual(original);
    expect(normalizeCoreDownloadPostData(decodeBase64Json(encoded))).toMatchObject({
      open: true,
      content: original.content,
      download_list: [{
        name: 'baidu',
        key: '1234',
        url: 'https://example.com',
        resource_name: '测试资源',
        show_type: '',
        legacy_extra: 'keep-me',
      }],
    });
  });

  it('matches PHP truthiness for the original open flag', () => {
    expect(normalizeCoreDownloadPostData({ open: '0' }).open).toBe(false);
    expect(normalizeCoreDownloadPostData({ open: false }).open).toBe(false);
  });

  it('uses original defaults without dropping unknown item keys', () => {
    const normalized = normalizeCoreDownloadPostData({
      download_list: [{ name: 'aliyun', custom_key: 'preserve' }],
    });
    expect(normalized.open).toBe(true);
    expect(normalized.download_list[0]).toMatchObject({
      name: 'aliyun',
      key: '',
      url: '',
      resource_name: '',
      show_type: '',
      custom_key: 'preserve',
    });
  });

  it('rejects malformed Base64(JSON)', () => {
    expect(decodeBase64Json('not-base64-json')).toBeNull();
  });
});


describe('CoreDownload standalone frontend', () => {
  it('generates a valid same-origin browser script', () => {
    const script = buildCoreDownloadClientScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('/api/core-download/data');
    expect(script).toContain('data-core-download');
    expect(script).toContain('core-download-warp');
  });
});
