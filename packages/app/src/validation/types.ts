/**
 * Shapes shared by the browser side validator, the API that records its
 * result and the pages that render it (BC-037, BC-038, BC-040).
 */
import type { ConfidenceState } from '@breadcrumb/parser';

/** The components as Graph confirmed them. All are facts, so no per component flag. */
export interface VerifiedComponents {
  tenant: string;
  host: string;
  sitePath: string;
  library: string;
  folders: string[];
  fileName?: string;
}

/** A best effort value that Graph corrected, kept so the upgrade is visible. */
export interface Correction {
  was: string;
  now: string;
}

export interface GraphIdentity {
  siteId?: string;
  driveId: string;
  itemId: string;
  listItemUniqueId?: string;
  webUrl?: string;
}

/** The `d` identifier from a sharing link compared with the item's list item unique id (BC-037). */
export interface IdentifierCheck {
  linkValue: string;
  graphValue: string;
  matches: boolean;
}

export interface VerifiedResult {
  path: string;
  folderUrl: string;
  fileUrl?: string;
  components: VerifiedComponents;
  corrections: Partial<Record<'library' | 'folders' | 'sitePath' | 'fileName', Correction>>;
  identifierCheck?: IdentifierCheck;
  graph: GraphIdentity;
  /** ISO 8601 UTC. */
  validatedAt: string;
  /** The Graph calls made, in order, without hosts or tokens. */
  calls: string[];
  /** Plain language method text for the Verified result (BC-025). */
  methodText: string;
}

/** What the browser posts to `POST /api/history/:id/validate`. */
export interface ValidationSubmission {
  previousState: Exclude<ConfidenceState, 'Verified'>;
  verified: VerifiedResult;
}

/** A validation as stored and rendered. */
export interface ValidationRecord extends ValidationSubmission {
  id: number;
  conversionId: number;
}
