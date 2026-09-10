/** The three Copilot hosts the extension may run on (invariant 17). */
export const WORK_HOSTS: ReadonlySet<string> = new Set(['m365.cloud.microsoft', 'copilot.cloud.microsoft']);
export const CONSUMER_HOST = 'copilot.microsoft.com';

export type SurfaceKind = 'work' | 'consumer' | 'other';

export function surfaceOf(hostname: string): SurfaceKind {
  const host = hostname.toLowerCase();
  if (WORK_HOSTS.has(host)) {
    return 'work';
  }
  if (host === CONSUMER_HOST) {
    return 'consumer';
  }
  return 'other';
}
