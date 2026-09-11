/**
 * Tiny typed templating: a tagged template that escapes every interpolated
 * value unless it is already rendered markup. No template engine dependency.
 */

export class Markup {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return '';
  }
  if (value instanceof Markup) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(render).join('');
  }
  return escapeHtml(String(value));
}

/** Builds markup; interpolations are escaped unless they are Markup or arrays of Markup. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Markup {
  let out = '';
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) {
      out += render(values[i]);
    }
  });
  return new Markup(out);
}

/**
 * A long URL as text with line break opportunities after each `/`, encoded
 * space, `?` and `&`, so it wraps at segment boundaries rather than mid-word.
 * <wbr> adds no characters, so selecting and copying the text is unaffected.
 */
export function breakableUrl(url: string): Markup {
  const schemeEnd = url.indexOf('://');
  const head = schemeEnd === -1 ? '' : url.slice(0, schemeEnd + 3);
  const rest = schemeEnd === -1 ? url : url.slice(schemeEnd + 3);
  return new Markup(escapeHtml(head) + escapeHtml(rest).replace(/(\/|%20|\?|&amp;)/g, '$1<wbr>'));
}

/** Marks a string as already safe markup. Use only for constant fragments. */
export function raw(markup: string): Markup {
  return new Markup(markup);
}
