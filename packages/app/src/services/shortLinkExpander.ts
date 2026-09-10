/**
 * Server side short link expansion (BC-027). Only hosts in the parser's
 * short link allow list are ever fetched; the first redirect that leaves the
 * allow list is taken as the final URL without being requested. No cookies
 * are sent (Node's fetch has no cookie jar) and redirects are followed by
 * hand so the hop count is bounded and visible.
 */
import { SHORT_LINK_HOSTS } from '@breadcrumb/parser';

export interface ExpanderConfig {
  enabled: boolean;
  timeoutMs: number;
  maxHops: number;
}

export type ExpansionFailureReason = 'disabled' | 'not_allowed' | 'timeout' | 'network' | 'too_many_redirects' | 'no_redirect';

export type ExpansionResult =
  | { ok: true; finalUrl: string; hops: number }
  | { ok: false; reason: ExpansionFailureReason; message: string };

export interface ShortLinkExpander {
  readonly enabled: boolean;
  expand(url: string): Promise<ExpansionResult>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_MAX_HOPS = 5;

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function createShortLinkExpander(config: ExpanderConfig, fetchImpl: FetchLike = (u, i) => fetch(u, i)): ShortLinkExpander {
  return {
    enabled: config.enabled,
    async expand(url) {
      if (!config.enabled) {
        return { ok: false, reason: 'disabled', message: 'Short link expansion is switched off (SHORTLINK_EXPANSION_ENABLED is false).' };
      }
      let current = url;
      for (let hop = 0; hop < config.maxHops; hop++) {
        const host = hostOf(current);
        if (host === undefined || !SHORT_LINK_HOSTS.has(host)) {
          return { ok: false, reason: 'not_allowed', message: `${host ?? 'The link'} is not on the short link allow list, so it was not fetched.` };
        }
        let response: Response;
        try {
          response = await fetchImpl(current, {
            method: 'HEAD',
            redirect: 'manual',
            signal: AbortSignal.timeout(config.timeoutMs),
            headers: { 'user-agent': 'BreadCrumb/0.2 (+short link expansion)', accept: '*/*' },
          });
        } catch (error) {
          const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
          return {
            ok: false,
            reason: timedOut ? 'timeout' : 'network',
            message: timedOut
              ? `The request to ${host} did not answer within ${config.timeoutMs} ms.`
              : `The request to ${host} failed: ${error instanceof Error ? error.message : String(error)}.`,
          };
        }
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location !== null && location !== '') {
          let next: string;
          try {
            next = new URL(location, current).href;
          } catch {
            return { ok: false, reason: 'network', message: `${host} answered with a redirect to an invalid location.` };
          }
          const nextHost = hostOf(next);
          if (nextHost !== undefined && SHORT_LINK_HOSTS.has(nextHost)) {
            current = next;
            continue;
          }
          return { ok: true, finalUrl: next, hops: hop + 1 };
        }
        return {
          ok: false,
          reason: 'no_redirect',
          message: `${host} answered ${response.status} without redirecting, so there is no target link to read.`,
        };
      }
      return { ok: false, reason: 'too_many_redirects', message: `The short link redirected more than ${config.maxHops} times without leaving ${[...SHORT_LINK_HOSTS].join(', ')}.` };
    },
  };
}
