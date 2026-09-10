/**
 * Browser side of authenticated validation (BC-036, BC-037, BC-038, BC-041).
 * Bundled by esbuild into public/validate.js and loaded only when the server
 * is configured for sign in. Tokens live in MSAL's sessionStorage cache and
 * never reach the server (decision D3, invariant 15).
 */
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import type { ParseSuccess } from '@breadcrumb/parser';
import { validateResult, type GraphClient, type ValidationOutcome } from '../../validation/graphValidation.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

async function main(): Promise<void> {
  const { authTenant, authClient, authScopes } = document.body.dataset;
  if (authTenant === undefined || authClient === undefined) {
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
  }

  signIn.addEventListener('click', async () => {
    try {
      const result = await msal.loginPopup({ scopes, prompt: 'select_account' });
      msal.setActiveAccount(result.account);
    } catch (error) {
      announce(`Sign in did not complete: ${error instanceof Error ? error.message : String(error)}`);
    }
    render();
  });

  signOut.addEventListener('click', async () => {
    // Local sign out: discard the session's tokens without a round trip to Microsoft.
    await msal.clearCache();
    msal.setActiveAccount(null);
    render();
    announce('Signed out. Validation controls are hidden until you sign in again.');
  });

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
    return {
      async get(path) {
        const response = await fetch(`${GRAPH_BASE}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
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
        return { status: response.status, headers, body };
      },
    };
  }

  for (const block of validateBlocks) {
    const button = block.querySelector<HTMLButtonElement>('.validate-button');
    const status = block.querySelector<HTMLElement>('.validate-status');
    const json = block.querySelector<HTMLScriptElement>('script.result-json');
    const id = block.dataset['validateId'];
    const previousState = block.dataset['previousState'];
    if (button === null || status === null || json === null || id === undefined || previousState === undefined) {
      continue;
    }
    const result = JSON.parse(json.textContent ?? 'null') as ParseSuccess | null;
    if (result === null) {
      continue;
    }

    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Asking Microsoft Graph…';
      let outcome: ValidationOutcome;
      try {
        outcome = await validateResult(result, graphClient(await acquireToken()));
      } catch (error) {
        status.textContent = `Could not get a sign in token: ${error instanceof Error ? error.message : String(error)}. The result is unchanged.`;
        button.disabled = false;
        return;
      }
      if (!outcome.ok) {
        status.textContent = `${outcome.message} The result is unchanged.`;
        if (outcome.kind === 'throttled' && outcome.retryAfterSeconds !== undefined) {
          let remaining = outcome.retryAfterSeconds;
          button.textContent = `Retry in ${remaining}s`;
          const timer = window.setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
              window.clearInterval(timer);
              button.textContent = 'Validate with Microsoft Graph';
              button.disabled = false;
            } else {
              button.textContent = `Retry in ${remaining}s`;
            }
          }, 1000);
          return;
        }
        button.disabled = false;
        return;
      }
      const response = await fetch(`/api/history/${id}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ previousState, verified: outcome.verified }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        status.textContent = `Graph confirmed the item but the server did not record it: ${body.message ?? response.status}. The stored result is unchanged.`;
        button.disabled = false;
        return;
      }
      status.textContent = 'Verified. Reloading…';
      window.location.href = `/history/${id}?validated=1`;
    });
  }

  render();
}

function announce(text: string): void {
  const announcer = document.getElementById('announcer');
  if (announcer !== null) {
    announcer.textContent = '';
    announcer.textContent = text;
  }
}

void main();
