/**
 * Browser side of authenticated validation (BC-036, BC-037, BC-038, BC-041).
 * Bundled by esbuild into public/validate.js and loaded only when the server
 * is configured for sign in. Tokens live in MSAL's sessionStorage cache and
 * never reach the server (decision D3, invariant 15).
 *
 * Token sharing links validate automatically once signed in; other results
 * keep an explicit button; the history page can validate every Unresolved
 * entry in one go.
 */
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
import type { ParseSuccess } from '@breadcrumb/parser';
import { validateResult, type GraphClient, type ValidationOutcome } from '../../validation/graphValidation.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const DEBUG = safeStorage(() => window.localStorage.getItem('breadcrumb:debug') === '1');

function safeStorage<T>(read: () => T, fallback?: T): T | undefined {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function announce(text: string): void {
  const announcer = document.getElementById('announcer');
  if (announcer !== null) {
    announcer.textContent = '';
    announcer.textContent = text;
  }
}

interface ValidatableEntry {
  id: number;
  previousState: string;
  result: ParseSuccess;
}

/** True when this page is the redirect target of a sign in popup or silent iframe. */
function isAuthResponse(): boolean {
  const carries = (params: URLSearchParams): boolean => params.has('state') && (params.has('code') || params.has('error'));
  return carries(new URLSearchParams(window.location.hash.replace(/^#/, ''))) || carries(new URLSearchParams(window.location.search));
}

async function main(): Promise<void> {
  const { authTenant, authClient, authScopes } = document.body.dataset;
  if (authTenant === undefined || authClient === undefined) {
    return;
  }
  // MSAL 5: the sign in popup lands back on this page (the registered redirect
  // URI) and must hand the response to the opener through the redirect bridge,
  // because the Microsoft sign in page cuts the opener link.
  if (isAuthResponse()) {
    try {
      await broadcastResponseToMainFrame();
    } catch (error) {
      document.body.prepend(`Sign in could not complete: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }
  const scopes = (authScopes ?? '').split(/\s+/).filter((s) => s !== '');
  const msal = new PublicClientApplication({
    auth: {
      clientId: authClient,
      authority: `https://login.microsoftonline.com/${authTenant}`,
      redirectUri: `${window.location.origin}/`,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await msal.initialize();

  const panel = byId('auth');
  const accountLabel = byId('auth-account');
  const signIn = byId<HTMLButtonElement>('auth-signin');
  const signOut = byId<HTMLButtonElement>('auth-signout');
  const validateBlocks = Array.from(document.querySelectorAll<HTMLElement>('.validate[data-validate-id]'));
  const validateAll = byId('validate-all');
  if (panel === null || accountLabel === null || signIn === null || signOut === null) {
    return;
  }

  const account = (): AccountInfo | null => msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;

  function render(): void {
    const current = account();
    panel!.hidden = false;
    accountLabel!.hidden = current === null;
    accountLabel!.textContent = current === null ? '' : `Signed in as ${current.username}`;
    signIn!.hidden = current !== null;
    signOut!.hidden = current === null;
    for (const block of validateBlocks) {
      block.hidden = current === null;
    }
    if (validateAll !== null) {
      validateAll.hidden = current === null;
    }
  }

  async function acquireToken(): Promise<string> {
    const current = account();
    if (current === null) {
      throw new Error('Sign in first.');
    }
    try {
      return (await msal.acquireTokenSilent({ scopes, account: current })).accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        announce('Your sign in has expired. Please sign in again.');
        const result = await msal.acquireTokenPopup({ scopes, account: current });
        msal.setActiveAccount(result.account);
        return result.accessToken;
      }
      throw error;
    }
  }

  function graphClient(token: string): GraphClient {
    const send = async (method: 'GET' | 'POST', path: string, requestBody: unknown, extraHeaders: Record<string, string>) => {
      const response = await fetch(`${GRAPH_BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...extraHeaders,
        },
        ...(method === 'POST' ? { body: JSON.stringify(requestBody) } : {}),
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (DEBUG) {
        console.info('[breadcrumb] graph', { method, path, requestHeaders: extraHeaders, requestBody, status: response.status, headers, body });
      }
      return { status: response.status, headers, body };
    };
    return {
      get: (path, extraHeaders = {}) => send('GET', path, undefined, extraHeaders),
      post: (path, requestBody, extraHeaders = {}) => send('POST', path, requestBody, extraHeaders),
    };
  }

  /** Validates one entry with Graph and records it on the server. */
  async function validateEntry(entry: ValidatableEntry): Promise<ValidationOutcome | { ok: false; kind: 'server'; message: string; calls: string[] }> {
    const outcome = await validateResult(entry.result, graphClient(await acquireToken()));
    if (!outcome.ok) {
      return outcome;
    }
    const response = await fetch(`/api/history/${entry.id}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ previousState: entry.previousState, verified: outcome.verified }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return { ok: false, kind: 'server', message: `Graph confirmed the item but the server did not record it: ${body.message ?? response.status}.`, calls: outcome.verified.calls };
    }
    return outcome;
  }

  function countdown(button: HTMLButtonElement, seconds: number, label: string): void {
    let remaining = seconds;
    button.disabled = true;
    button.textContent = `Retry in ${remaining}s`;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        button.textContent = label;
        button.disabled = false;
      } else {
        button.textContent = `Retry in ${remaining}s`;
      }
    }, 1000);
  }

  // Per result blocks: explicit button, or automatic for token links.
  for (const block of validateBlocks) {
    const button = block.querySelector<HTMLButtonElement>('.validate-button');
    const status = block.querySelector<HTMLElement>('.validate-status');
    const json = block.querySelector<HTMLScriptElement>('script.result-json');
    const id = Number(block.dataset['validateId']);
    const previousState = block.dataset['previousState'];
    if (button === null || status === null || json === null || !Number.isInteger(id) || previousState === undefined) {
      continue;
    }
    const result = JSON.parse(json.textContent ?? 'null') as ParseSuccess | null;
    if (result === null) {
      continue;
    }
    const entry: ValidatableEntry = { id, previousState, result };

    const run = async (): Promise<void> => {
      button.disabled = true;
      status.textContent = 'Asking Microsoft Graph…';
      let outcome: Awaited<ReturnType<typeof validateEntry>>;
      try {
        outcome = await validateEntry(entry);
      } catch (error) {
        status.textContent = `Could not get a sign in token: ${error instanceof Error ? error.message : String(error)}. The result is unchanged.`;
        button.disabled = false;
        return;
      }
      if (!outcome.ok) {
        status.textContent = `${outcome.message} The result is unchanged.`;
        if (outcome.kind === 'throttled' && outcome.retryAfterSeconds !== undefined) {
          countdown(button, outcome.retryAfterSeconds, 'Validate with Microsoft Graph');
          return;
        }
        button.disabled = false;
        return;
      }
      status.textContent = 'Verified. Reloading…';
      window.location.href = `/history/${id}?validated=1`;
    };

    button.addEventListener('click', () => void run());

    const autoKey = `breadcrumb:auto:${id}`;
    if (block.dataset['auto'] === '1' && account() !== null && safeStorage(() => window.sessionStorage.getItem(autoKey)) !== '1') {
      safeStorage(() => window.sessionStorage.setItem(autoKey, '1'));
      status.textContent = 'Resolving this link with Microsoft Graph…';
      void run();
    }
  }

  // History page: validate every Unresolved entry (BC-038, extension submissions).
  if (validateAll !== null) {
    const button = validateAll.querySelector<HTMLButtonElement>('button');
    const status = validateAll.querySelector<HTMLElement>('[role="status"]');
    if (button !== null && status !== null) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Listing Unresolved entries…';
        let entries: ValidatableEntry[];
        try {
          const response = await fetch('/api/history/validatable?limit=100');
          entries = ((await response.json()) as { entries: ValidatableEntry[] }).entries;
        } catch (error) {
          status.textContent = `Could not list entries: ${error instanceof Error ? error.message : String(error)}.`;
          button.disabled = false;
          return;
        }
        if (entries.length === 0) {
          status.textContent = 'Nothing to validate: no Unresolved sharing or document links in history.';
          button.disabled = false;
          return;
        }
        let resolved = 0;
        let failed = 0;
        for (const [index, entry] of entries.entries()) {
          status.textContent = `Validating ${index + 1} of ${entries.length} (${resolved} resolved, ${failed} not resolved)…`;
          let outcome: Awaited<ReturnType<typeof validateEntry>>;
          try {
            outcome = await validateEntry(entry);
          } catch (error) {
            status.textContent = `Stopped: ${error instanceof Error ? error.message : String(error)}. ${resolved} resolved so far.`;
            button.disabled = false;
            return;
          }
          if (outcome.ok) {
            resolved += 1;
          } else {
            failed += 1;
            if (outcome.kind === 'throttled') {
              status.textContent = `Graph asked to slow down after ${resolved} resolved. ${outcome.message}`;
              countdown(button, outcome.retryAfterSeconds ?? 30, 'Validate all Unresolved');
              return;
            }
            if (outcome.kind === 'auth') {
              status.textContent = `Stopped: ${outcome.message} ${resolved} resolved so far.`;
              button.disabled = false;
              return;
            }
          }
        }
        status.textContent = `Done: ${resolved} resolved, ${failed} could not be resolved. Reloading…`;
        window.setTimeout(() => window.location.reload(), 800);
      });
    }
  }

  signIn.addEventListener('click', async () => {
    try {
      const result = await msal.loginPopup({ scopes, prompt: 'select_account' });
      msal.setActiveAccount(result.account);
    } catch (error) {
      announce(`Sign in did not complete: ${error instanceof Error ? error.message : String(error)}`);
    }
    render();
    // A page opened before signing in may hold a token link waiting to be resolved.
    for (const block of validateBlocks) {
      if (block.dataset['auto'] === '1' && account() !== null) {
        block.querySelector<HTMLButtonElement>('.validate-button')?.click();
      }
    }
  });

  signOut.addEventListener('click', async () => {
    // Local sign out: discard the session's tokens without a round trip to Microsoft.
    await msal.clearCache();
    msal.setActiveAccount(null);
    render();
    announce('Signed out. Validation controls are hidden until you sign in again.');
  });

  render();
}

void main();
