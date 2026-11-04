import { describe, expect, it } from 'vitest';

import { describeDevice, isMobileDevice } from './device';

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  yandex:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 YaBrowser/25.10.0.0 Safari/537.36',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 16; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
};

describe('describeDevice', () => {
  it('names common browser and OS pairs', () => {
    expect(describeDevice(UA.chromeWin)).toBe('Chrome · Windows');
    expect(describeDevice(UA.edgeWin)).toBe('Edge · Windows');
    expect(describeDevice(UA.yandex)).toBe('Yandex Browser · Windows');
    expect(describeDevice(UA.safariIos)).toBe('Safari · iOS');
    expect(describeDevice(UA.firefoxAndroid)).toBe('Firefox · Android');
    expect(describeDevice(UA.safariMac)).toBe('Safari · macOS');
  });

  it('handles unknown input', () => {
    expect(describeDevice('curl/8.0')).toBeUndefined();
    expect(describeDevice(null)).toBeUndefined();
  });

  it('detects mobile labels', () => {
    expect(isMobileDevice('Safari · iOS')).toBe(true);
    expect(isMobileDevice('Chrome · Windows')).toBe(false);
    expect(isMobileDevice(null)).toBe(false);
  });
});
