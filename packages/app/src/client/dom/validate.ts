/**
 * Browser side of authenticated validation (BC-036 to BC-041). Bundled by
 * esbuild into public/validate.js and loaded only when the server is
 * configured for sign in. Tokens live in MSAL's sessionStorage cache and
 * never reach the server (decision D3, invariant 15).
 *
 * Every result the validator can check (Derived, Inferred, and Unresolved
 * sharing and document id links) verifies automatically once signed in, with
 * the button kept for retries; the history page verifies every unverified
 * entry in one go.
 *
 * Diagnostics: with `localStorage['breadcrumb:debug'] = '1'` every event is
 * logged to the console; when the server runs with CLIENT_LOG=true the same
 * events are posted to the server log. Tokens are never included.
 */
import { InteractionRequiredAuthError, LogLevel, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
import type { ParseSuccess } from '@breadcrumb/parser';
import { validateResult, type GraphClient, type ValidationOutcome } from '../../validation/graphValidation.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_LOGGED_BODY = 8000;

function safeStorage<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

const DEBUG = safeStorage(() => window.localStorage.getItem('breadcrumb:debug') === '1') === true;
const CLIENT_LOG = document.body.dataset['clientLog'] === '1';

/** Records a diagnostic event: console when debugging, server log when CLIENT_LOG is on. */
function trace(event: string, detail: Record<string, unknown> = {}): void {
  if (DEBUG || CLIENT_LOG) {
    console.info(`[breadcrumb] ${event}`, detail);
  }
  if (!CLIENT_LOG) {
    return;
  }
  try {
    void fetch('/api/client-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, detail, page: window.location.pathname, popup: window.opener !== null, at: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Diagnostics must never break the page.
  }
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const e = error as Error & { errorCode?: string; subError?: string };
    return { name: e.name, errorCode: e.errorCode, subError: e.subError, message: e.message };
  }
  return { message: String(error) };
}

function truncated(body: unknown): unknown {
  const text = JSON.stringify(body);
  return text !== undefined && text.length > MAX_LOGGED_BODY ? `${text.slice(0, MAX_LOGGED_BODY)}… (${text.length} characters)` : body;
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

/** A visible status line under the header for sign in progress and problems. */
function setAuthStatus(text: string, kind: 'ok' | 'problem' = 'problem'): void {
  const status = byId('auth-status');
  if (status !== null) {
    status.textContent = text;
    status.dataset['kind'] = kind;
    status.hidden = text === '';
  }
  announce(text);
}

/** True when this page is the redirect target of a sign in popup or silent iframe. */
function isAuthResponse(): boolean {
  const carries = (params: URLSearchParams): boolean => params.has('state') && (params.has('code') || params.has('error'));
  return carries(new URLSearchParams(window.location.hash.replace(/^#/, ''))) || carries(new URLSearchParams(window.location.search));
}

interface ValidatableEntry {
  id: number;
  previousState: string;
  result: ParseSuccess;
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
    const keys = [...new URLSearchParams(window.location.hash.replace(/^#/, '')).keys(), ...new URLSearchParams(window.location.search).keys()];
    trace('redirect-page', { responseKeys: keys });
    try {
      await broadcastResponseToMainFrame();
      trace('redirect-bridge-ok');
    } catch (error) {
      trace('redirect-bridge-error', describeError(error));
      setAuthStatus(`Sign in could not complete: ${error instanceof Error ? error.message : String(error)}`);
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
    system: {
      loggerOptions: {
        logLevel: DEBUG || CLIENT_LOG ? LogLevel.Info : LogLevel.Error,
        piiLoggingEnabled: false,
        loggerCallback: (level, message) => {
          if (DEBUG || CLIENT_LOG) {
            trace('msal', { level: LogLevel[level], message });
          }
        },
      },
    },
  });
  try {
    await msal.initialize();
  } catch (error) {
    trace('msal-initialize-error', describeError(error));
    setAuthStatus(`Microsoft sign in could not start: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

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

  /**
   * True while this page has a Microsoft popup open. MSAL records an
   * interaction in sessionStorage; if a page is reloaded or closed while its
   * popup is open, that record outlives it and every later sign in fails with
   * interaction_in_progress. A page with no popup of its own therefore
   * overrides the leftover record, and ignores clicks while its own is open.
   */
  let popupOpen = false;

  trace('init', {
    origin: window.location.origin,
    accounts: msal.getAllAccounts().length,
    validateBlocks: validateBlocks.length,
    autoBlocks: validateBlocks.filter((b) => b.dataset['auto'] === '1').length,
    scopes,
  });

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
      const result = await msal.acquireTokenSilent({ scopes, account: current });
      trace('token-ok', { scopes: result.scopes, expiresOn: result.expiresOn?.toISOString() });
      return result.accessToken;
    } catch (error) {
      trace('token-silent-error', describeError(error));
      if (error instanceof InteractionRequiredAuthError) {
        if (popupOpen) {
          throw new Error('A Microsoft sign in window is already open; finish it first.');
        }
        setAuthStatus('Your sign in has expired or needs consent. Complete the Microsoft window that opened (it may be behind this one).');
        popupOpen = true;
        try {
          const result = await msal.acquireTokenPopup({ scopes, account: current, overrideInteractionInProgress: true });
          msal.setActiveAccount(result.account);
          setAuthStatus('');
          return result.accessToken;
        } finally {
          popupOpen = false;
        }
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
      trace('graph', { method, path, requestHeaders: extraHeaders, requestBody, status: response.status, requestId: headers['request-id'], body: truncated(body) });
      return { status: response.status, headers, body };
    };
    return {
      get: (path, extraHeaders = {}) => send('GET', path, undefined, extraHeaders),
      post: (path, requestBody, extraHeaders = {}) => send('POST', path, requestBody, extraHeaders),
    };
  }

  type EntryOutcome = ValidationOutcome | { ok: false; kind: 'server'; message: string; calls: string[] };

  /** Validates one entry with Graph and records it on the server. */
  async function validateEntry(entry: ValidatableEntry): Promise<EntryOutcome> {
    trace('validate-start', { id: entry.id, form: entry.result.form, state: entry.result.state });
    const outcome = await validateResult(entry.result, graphClient(await acquireToken()));
    if (!outcome.ok) {
      trace('validate-outcome', { id: entry.id, ok: false, kind: outcome.kind, message: outcome.message, calls: outcome.calls });
      return outcome;
    }
    const response = await fetch(`/api/history/${entry.id}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ previousState: entry.previousState, verified: outcome.verified }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      trace('validate-record-error', { id: entry.id, status: response.status, message: body.message });
      return { ok: false, kind: 'server', message: `Graph confirmed the item but the server did not record it: ${body.message ?? response.status}.`, calls: outcome.verified.calls };
    }
    trace('validate-outcome', { id: entry.id, ok: true, path: outcome.verified.path, method: outcome.verified.methodText, calls: outcome.verified.calls });
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

  const runners = new Map<HTMLElement, () => Promise<void>>();

  // Per result blocks: explicit button, or automatic for links the validator can attempt.
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
      let outcome: EntryOutcome;
      try {
        outcome = await validateEntry(entry);
      } catch (error) {
        trace('validate-error', { id, ...describeError(error) });
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
    runners.set(block, run);
    button.addEventListener('click', () => void run());
  }

  /** Starts automatic validation for blocks that ask for it, once per entry per session. */
  function autoValidate(): void {
    if (account() === null) {
      if (runners.size > 0) trace('auto-skip', { reason: 'not signed in' });
      return;
    }
    for (const [block, run] of runners) {
      if (block.dataset['auto'] !== '1') {
        continue;
      }
      const id = block.dataset['validateId'];
      const key = `breadcrumb:auto:${id}`;
      if (safeStorage(() => window.sessionStorage.getItem(key)) === '1') {
        trace('auto-skip', { id, reason: 'already attempted this session; use the button to retry' });
        continue;
      }
      safeStorage(() => window.sessionStorage.setItem(key, '1'));
      trace('auto-start', { id });
      const status = block.querySelector<HTMLElement>('.validate-status');
      if (status !== null) status.textContent = 'Resolving this link with Microsoft Graph…';
      void run();
    }
  }

  // History page: verify every unverified entry Graph can check (extension submissions included).
  if (validateAll !== null) {
    const button = validateAll.querySelector<HTMLButtonElement>('button');
    const status = validateAll.querySelector<HTMLElement>('[role="status"]');
    if (button !== null && status !== null) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Listing unverified entries…';
        let entries: ValidatableEntry[];
        try {
          const response = await fetch('/api/history/validatable?limit=100');
          entries = ((await response.json()) as { entries: ValidatableEntry[] }).entries;
        } catch (error) {
          status.textContent = `Could not list entries: ${error instanceof Error ? error.message : String(error)}.`;
          button.disabled = false;
          return;
        }
        trace('validate-all-start', { count: entries.length });
        if (entries.length === 0) {
          status.textContent = 'Nothing to verify: every entry Graph can check is already Verified.';
          button.disabled = false;
          return;
        }
        let resolved = 0;
        let failed = 0;
        for (const [index, entry] of entries.entries()) {
          status.textContent = `Validating ${index + 1} of ${entries.length} (${resolved} resolved, ${failed} not resolved)…`;
          let outcome: EntryOutcome;
          try {
            outcome = await validateEntry(entry);
          } catch (error) {
            trace('validate-error', { id: entry.id, ...describeError(error) });
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
              countdown(button, outcome.retryAfterSeconds ?? 30, 'Verify all unverified');
              return;
            }
            if (outcome.kind === 'auth') {
              status.textContent = `Stopped: ${outcome.message} ${resolved} resolved so far.`;
              button.disabled = false;
              return;
            }
          }
        }
        trace('validate-all-done', { resolved, failed });
        status.textContent = `Done: ${resolved} resolved, ${failed} could not be resolved. Reloading…`;
        window.setTimeout(() => window.location.reload(), 800);
      });
    }
  }

  signIn.addEventListener('click', async () => {
    if (popupOpen) {
      trace('signin-click-ignored', { reason: 'popup already open on this page' });
      setAuthStatus('A Microsoft sign in window is already open. Finish it there; it may be behind this window.', 'ok');
      return;
    }
    trace('signin-click');
    setAuthStatus('Signing in: complete the Microsoft window that opened. If you cannot see it, it may be behind this window.', 'ok');
    popupOpen = true;
    try {
      // Overrides only a record left by a page that no longer exists; this page has no popup open.
      const result = await msal.loginPopup({ scopes, prompt: 'select_account', overrideInteractionInProgress: true });
      msal.setActiveAccount(result.account);
      trace('signin-ok', { scopes: result.scopes, tenant: result.tenantId });
      setAuthStatus('');
    } catch (error) {
      trace('signin-error', describeError(error));
      const detail = describeError(error);
      const code = String(detail['errorCode'] ?? '');
      const message =
        code === 'user_cancelled'
          ? 'Sign in was cancelled: the Microsoft window was closed.'
          : code === 'popup_window_error'
            ? 'The browser blocked the Microsoft sign in window. Allow pop-ups for this site and try again.'
            : `Sign in did not complete: ${String(detail['message'] ?? code ?? 'unknown error')}`;
      setAuthStatus(message);
    } finally {
      popupOpen = false;
    }
    render();
    // A page opened before signing in may hold links waiting to be resolved.
    autoValidate();
  });

  signOut.addEventListener('click', async () => {
    // Local sign out: discard the session's tokens without a round trip to Microsoft.
    await msal.clearCache();
    msal.setActiveAccount(null);
    render();
    trace('signout');
    setAuthStatus('Signed out. Validation controls are hidden until you sign in again.', 'ok');
  });

  render();
  autoValidate();
}

void main().catch((error: unknown) => {
  trace('main-error', describeError(error));
  setAuthStatus(`The sign in script failed: ${error instanceof Error ? error.message : String(error)}`);
});
