/** Short device label for the sessions list, e.g. "Chrome · Windows". */
export function describeDevice(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent;
  const browser = /YaBrowser\//.test(ua)
    ? 'Yandex Browser'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : undefined;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : undefined;
  if (browser !== undefined && os !== undefined) return `${browser} · ${os}`;
  return browser ?? os;
}

export function isMobileDevice(label: string | null | undefined): boolean {
  return label != null && /Android|iOS/.test(label);
}
