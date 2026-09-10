import type { Cloud } from './types.js';

/** What kind of Microsoft host the link is on. M2 adds consumer OneDrive, short links and wrappers. */
export type HostKind = 'sharepoint' | 'unknown';

export interface HostInfo {
  kind: HostKind;
  /** Lower cased host name exactly as it appears in the link. */
  host: string;
  cloud: Cloud;
  /** First host label with any `-my` suffix removed. Empty when unknown. */
  tenant: string;
  /** True for `-my` hosts (OneDrive for Business personal sites). */
  personal: boolean;
}

const SHAREPOINT_CLOUDS: ReadonlyArray<{ suffix: string; cloud: Cloud }> = [
  { suffix: '.sharepoint.com', cloud: 'global' },
  { suffix: '.sharepoint.us', cloud: 'gcc-high' },
  { suffix: '.sharepoint-mil.us', cloud: 'dod' },
  { suffix: '.sharepoint.cn', cloud: 'china' },
];

const LOOKS_LIKE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i;

/**
 * Parses the input as a URL, returning undefined for anything that is not
 * an http(s) URL. Input without a scheme but with a host like shape gets
 * `https://` prepended, so `contoso.sharepoint.com/sites/...` still works.
 */
export function safeParseUrl(input: string): URL | undefined {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : LOOKS_LIKE_HOST.test(input) ? `https://${input}` : input;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined;
  }
  if (url.hostname === '') {
    return undefined;
  }
  return url;
}

/** Classifies a host name into a Microsoft cloud and extracts the tenant. */
export function classifyHost(hostname: string): HostInfo {
  const host = hostname.toLowerCase();
  for (const { suffix, cloud } of SHAREPOINT_CLOUDS) {
    if (host.endsWith(suffix) && host.length > suffix.length) {
      const firstLabel = host.slice(0, host.length - suffix.length);
      if (firstLabel.includes('.')) {
        break;
      }
      const personal = firstLabel.endsWith('-my');
      const tenant = personal ? firstLabel.slice(0, -'-my'.length) : firstLabel;
      return { kind: 'sharepoint', host, cloud, tenant, personal };
    }
  }
  return { kind: 'unknown', host, cloud: 'unknown', tenant: '', personal: false };
}
