import type { AuthConfig } from '../config.js';
import { html, type Markup } from './html.js';

export type NavItem = 'convert' | 'history';

/** Everything a page needs from the server beyond its own data. */
export interface ViewContext {
  /** Present when Microsoft sign in is configured (BC-036); exposed to the browser as data attributes. */
  auth?: AuthConfig | undefined;
}

export interface LayoutOptions {
  title: string;
  active?: NavItem;
  body: Markup;
  context: ViewContext;
}

export function layout(options: LayoutOptions): string {
  const nav = (item: NavItem, href: string, label: string): Markup =>
    html`<a href="${href}" ${options.active === item ? html`aria-current="page"` : ''}>${label}</a>`;
  const auth = options.context.auth;

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${options.title} · BreadCrumb</title>
  <link rel="stylesheet" href="/static/app.css">
  <script src="/static/app.js" defer></script>
  ${auth !== undefined ? html`<script src="/static/validate.js" type="module"></script>` : ''}
</head>
<body${auth !== undefined ? html` data-auth-tenant="${auth.tenantId}" data-auth-client="${auth.clientId}" data-auth-scopes="${auth.scopes.join(' ')}"` : ''}>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header class="site-header">
    <a class="brand" href="/">BreadCrumb</a>
    <nav aria-label="Main">
      ${nav('convert', '/', 'Convert')}
      ${nav('history', '/history', 'History')}
    </nav>
    ${
      auth !== undefined
        ? html`<div id="auth" class="auth" hidden>
      <span id="auth-account" class="auth-account" hidden></span>
      <button type="button" id="auth-signin">Sign in to Microsoft</button>
      <button type="button" id="auth-signout" class="secondary" hidden>Sign out</button>
    </div>`
        : ''
    }
  </header>
  <main id="main" tabindex="-1">
    ${options.body}
  </main>
  <div id="announcer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
</body>
</html>
`.value;
}
