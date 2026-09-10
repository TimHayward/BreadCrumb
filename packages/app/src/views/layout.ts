import { html, type Markup } from './html.js';

export type NavItem = 'convert' | 'history';

export interface LayoutOptions {
  title: string;
  active?: NavItem;
  body: Markup;
}

export function layout(options: LayoutOptions): string {
  const nav = (item: NavItem, href: string, label: string): Markup =>
    html`<a href="${href}" ${options.active === item ? html`aria-current="page"` : ''}>${label}</a>`;

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${options.title} · BreadCrumb</title>
  <link rel="stylesheet" href="/static/app.css">
  <script src="/static/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header class="site-header">
    <a class="brand" href="/">BreadCrumb</a>
    <nav aria-label="Main">
      ${nav('convert', '/', 'Convert')}
      ${nav('history', '/history', 'History')}
    </nav>
  </header>
  <main id="main" tabindex="-1">
    ${options.body}
  </main>
  <div id="announcer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
</body>
</html>
`.value;
}
