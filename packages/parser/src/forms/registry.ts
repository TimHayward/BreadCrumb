import { consumerOneDrive } from './consumer.js';
import type { FormMatcher } from './context.js';
import { directPath } from './directPath.js';
import { layoutsPages } from './layoutsPages.js';
import { libraryView } from './libraryView.js';
import { guestAccess, sharingPath, sharingToken } from './sharingLinks.js';

/**
 * Form matchers in the order they are tried. Wrapper removal (Teams, Safe
 * Links) happens before this list in index.ts. `directPath` is last because
 * it accepts any remaining path on a SharePoint host.
 */
export const forms: readonly FormMatcher[] = [
  libraryView,
  sharingPath,
  sharingToken,
  guestAccess,
  layoutsPages,
  consumerOneDrive,
  directPath,
];
