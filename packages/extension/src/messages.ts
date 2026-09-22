/** Messages between the popup and the content script. */
import type { SurfaceKind } from './hosts.js';
import type { ProbeReport } from './probe.js';

export interface Citation {
  url: string;
  /** Visible text of the citation, if any, used as a label before parsing. */
  text?: string;
}

/**
 * How much of the page to read. A long chat can cite dozens of files, so the
 * default is the latest answer only; "chat" is the whole conversation.
 */
export type ExtractScope = 'latest' | 'chat';

export interface ExtractRequest {
  type: 'breadcrumb:extract';
  scope?: ExtractScope;
}

export interface ExtractResponse {
  type: 'breadcrumb:extracted';
  surface: SurfaceKind;
  host: string;
  citations: Citation[];
  /** How the citations were found, for diagnostics. */
  strategy: string;
  /** The scope that was read. */
  scope: ExtractScope;
}

export interface SampleRequest {
  type: 'breadcrumb:sample';
}

export interface SampleResponse {
  type: 'breadcrumb:sample';
  /** Redacted markup of the likely response container. */
  sample: string;
}

export interface ProbeRequest {
  type: 'breadcrumb:probe';
}

export interface ProbeResponse {
  type: 'breadcrumb:probe';
  report: ProbeReport | null;
  error?: string;
}

export type PopupToContent = ExtractRequest | SampleRequest | ProbeRequest;
export type ContentToPopup = ExtractResponse | SampleResponse | ProbeResponse;
