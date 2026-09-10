import type { Cloud } from './types.js';

/** What kind of host the link is on. */
export type HostKind = 'sharepoint' | 'onedrive-consumer' | 'shortlink' | 'teams' | 'safelinks' | 'unknown';

export interface HostInfo {
  kind: HostKind;
  /** Lower cased host name exactly as it appears in the link. */
  host: string;
  cloud: Cloud;
  /** First host label with any `-my` suffix removed. Empty when there is no tenant. */
  tenant: string;
  /** True for `-my` hosts (OneDrive for Business personal sites). */
  personal: boolean;
}

/** SharePoint Online host suffixes per cloud (BC-020). */
const SHAREPOINT_CLOUDS: ReadonlyArray<{ suffix: string; cloud: Cloud }> = [
  { suffix: '.sharepoint.com', cloud: 'global' },
  { suffix: '.sharepoint.us', cloud: 'gcc-high' },
  { suffix: '.sharepoint-mil.us', cloud: 'dod' },
  { suffix: '.sharepoint.cn', cloud: 'china' },
];

/** Short link hosts the server may expand (BC-027). Nothing else is ever fetched. */
export const SHORT_LINK_HOSTS: ReadonlySet<string> = new Set(['1drv.ms']);

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

/** Classifies a host name into a kind and cloud and extracts the tenant. */
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
  if (host === 'onedrive.live.com') {
    return { kind: 'onedrive-consumer', host, cloud: 'global', tenant: '', personal: true };
  }
  if (SHORT_LINK_HOSTS.has(host)) {
    return { kind: 'shortlink', host, cloud: 'global', tenant: '', personal: true };
  }
  if (host === 'teams.microsoft.com') {
    return { kind: 'teams', host, cloud: 'global', tenant: '', personal: false };
  }
  if (host.endsWith('.safelinks.protection.outlook.com')) {
    return { kind: 'safelinks', host, cloud: 'global', tenant: '', personal: false };
  }
  const firstLabel = host.split('.')[0] ?? '';
  const personal = firstLabel.endsWith('-my');
  return { kind: 'unknown', host, cloud: 'unknown', tenant: personal ? firstLabel.slice(0, -3) : firstLabel, personal };
}
