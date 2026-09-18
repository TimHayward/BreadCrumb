/**
 * Options page: grant the extension access to a tenant's SharePoint hosts
 * (BC-049, invariant 17) and test what the browser session can confirm.
 */
import type { LinkReport } from './spTest.js';
import { tenantOrigins } from './spTest.js';

const tenantInput = document.getElementById('tenant') as HTMLInputElement;
const grant = document.getElementById('grant') as HTMLButtonElement;
const revoke = document.getElementById('revoke') as HTMLButtonElement;
const grantStatus = document.getElementById('grant-status') as HTMLElement;
const linksInput = document.getElementById('links') as HTMLTextAreaElement;
const test = document.getElementById('test') as HTMLButtonElement;
const testStatus = document.getElementById('test-status') as HTMLElement;
const output = document.getElementById('test-output') as HTMLPreElement;

const TENANT_KEY = 'spTenant';

async function showGrant(): Promise<void> {
  const origins = tenantOrigins(tenantInput.value);
  if (origins === undefined) {
    grantStatus.textContent = 'Enter the tenant name, for example contoso for contoso.sharepoint.com.';
    return;
  }
  const granted = await chrome.permissions.contains({ origins });
  grantStatus.textContent = granted ? `Access granted to ${origins.join(' and ')}.` : `No access yet to ${origins.join(' and ')}.`;
}

void chrome.storage.sync.get(TENANT_KEY).then((stored) => {
  tenantInput.value = typeof stored[TENANT_KEY] === 'string' ? (stored[TENANT_KEY] as string) : '';
  if (tenantInput.value !== '') void showGrant();
});
tenantInput.addEventListener('change', () => void showGrant());

grant.addEventListener('click', async () => {
  const origins = tenantOrigins(tenantInput.value);
  if (origins === undefined) {
    grantStatus.textContent = 'Enter the tenant name, for example contoso for contoso.sharepoint.com.';
    return;
  }
  await chrome.storage.sync.set({ [TENANT_KEY]: tenantInput.value.trim() });
  try {
    const granted = await chrome.permissions.request({ origins });
    grantStatus.textContent = granted ? `Access granted to ${origins.join(' and ')}.` : 'Access was not granted.';
  } catch (error) {
    grantStatus.textContent = `The browser refused the request: ${error instanceof Error ? error.message : String(error)}`;
  }
});

revoke.addEventListener('click', async () => {
  const origins = tenantOrigins(tenantInput.value);
  if (origins === undefined) return;
  const removed = await chrome.permissions.remove({ origins });
  grantStatus.textContent = removed ? 'Access removed.' : 'Nothing to remove.';
});

test.addEventListener('click', async () => {
  const links = linksInput.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (links.length === 0) {
    testStatus.textContent = 'Paste one or more links first.';
    return;
  }
  test.disabled = true;
  testStatus.textContent = 'Asking SharePoint…';
  const response = (await chrome.runtime.sendMessage({ type: 'breadcrumb:sp-test', links })) as { ok: boolean; reports?: LinkReport[]; error?: string };
  test.disabled = false;
  if (!response.ok || response.reports === undefined) {
    testStatus.textContent = `The test failed: ${response.error ?? 'no answer from the service worker'}`;
    return;
  }
  const reports = response.reports;
  const calls = reports.flatMap((r) => r.calls);
  const worked = calls.filter((c) => c.ok).length;
  testStatus.textContent = `${worked} of ${calls.length} SharePoint calls answered 2xx. The detail is below.`;
  output.hidden = false;
  output.textContent = reports
    .map((r) =>
      [
        `${r.link}`,
        `  form ${r.form ?? '?'} on ${r.host ?? '?'}${r.permission !== undefined ? `, access ${r.permission}` : ''}${r.note !== undefined ? ` (${r.note})` : ''}`,
        ...r.calls.map((c) => `  ${c.label}: ${c.status ?? 'no response'} ${c.error ?? ''}${c.finalUrl !== undefined ? ` → ended at ${c.finalUrl}` : ''}`),
      ].join('\n'),
    )
    .join('\n\n');
});
