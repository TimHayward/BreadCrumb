import type { FormMatcher } from './context.js';
import { libraryView } from './libraryView.js';

/**
 * Form matchers in the order they are tried. M2 inserts wrapper unwrapping
 * (Safe Links, Teams) before everything else and appends the remaining forms
 * from the link form matrix after `libraryView`.
 */
export const forms: readonly FormMatcher[] = [libraryView];
