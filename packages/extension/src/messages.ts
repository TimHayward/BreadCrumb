/** Messages between the popup and the content script. */
import type { SurfaceKind } from './hosts.js';

export interface Citation {
  url: string;
  /** Visible text of the citation, if any, used as a label before parsing. */
  text?: string;
}

export interface ExtractRequest {
  type: 'breadcrumb:extract';
}

export interface ExtractResponse {
  type: 'breadcrumb:extracted';
  surface: SurfaceKind;
  host: string;
  citations: Citation[];
  /** How the citations were found, for diagnostics. */
  strategy: string;
}

export interface SampleRequest {
  type: 'breadcrumb:sample';
}

export interface SampleResponse {
  type: 'breadcrumb:sample';
  /** Redacted markup of the likely response container. */
  sample: string;
}

export type PopupToContent = ExtractRequest | SampleRequest;
export type ContentToPopup = ExtractResponse | SampleResponse;
