import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  manifest_version: number;
  host_permissions: string[];
  permissions: string[];
  content_scripts: Array<{ matches: string[]; js: string[] }>;
  background: { service_worker: string };
  action: { default_popup: string };
}

describe('manifest (BC-042, invariant 17)', () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'manifest.json'), 'utf8')) as Manifest;
  const hosts = ['https://m365.cloud.microsoft/*', 'https://copilot.cloud.microsoft/*', 'https://copilot.microsoft.com/*'];

  it('is Manifest V3 with a popup, a content script and a service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.content_scripts[0]?.js).toEqual(['content.js']);
  });

  it('offers SharePoint only as an optional permission, granted per tenant at runtime (spike S9)', () => {
    const optional = (manifest as unknown as { optional_host_permissions?: string[] }).optional_host_permissions;
    expect(optional).toEqual(['https://*.sharepoint.com/*']);
  });

  it('declares host permissions for the three Copilot hosts and nothing broader', () => {
    expect([...manifest.host_permissions].sort()).toEqual([...hosts].sort());
    expect([...(manifest.content_scripts[0]?.matches ?? [])].sort()).toEqual([...hosts].sort());
    expect(manifest.permissions).not.toContain('<all_urls>');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('scripting');
  });
});
