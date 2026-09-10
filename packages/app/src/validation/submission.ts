/**
 * Checks the shape of a validation posted by the browser before it is
 * stored. The server trusts the browser's Graph work (risk R12) but not its
 * data types.
 */
import type { ValidationSubmission, VerifiedResult } from './types.js';

const PREVIOUS_STATES = new Set(['Derived', 'Inferred', 'Unresolved']);

type Result = { ok: true; value: ValidationSubmission } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

export function parseSubmission(body: unknown): Result {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object.' };
  const { previousState, verified } = body;
  if (!isString(previousState) || !PREVIOUS_STATES.has(previousState)) {
    return { ok: false, error: '"previousState" must be Derived, Inferred or Unresolved.' };
  }
  if (!isRecord(verified)) return { ok: false, error: '"verified" must be an object.' };
  const { path, folderUrl, fileUrl, components, corrections, identifierCheck, graph, validatedAt, calls, methodText } = verified;
  if (!isString(path) || path === '') return { ok: false, error: '"verified.path" must be a non-empty string.' };
  if (!isString(folderUrl) || !folderUrl.startsWith('https://')) return { ok: false, error: '"verified.folderUrl" must be an https URL.' };
  if (!optionalString(fileUrl)) return { ok: false, error: '"verified.fileUrl" must be a string when present.' };
  if (!isRecord(components)) return { ok: false, error: '"verified.components" must be an object.' };
  for (const key of ['tenant', 'host', 'sitePath', 'library'] as const) {
    if (!isString(components[key])) return { ok: false, error: `"verified.components.${key}" must be a string.` };
  }
  if (!isStringArray(components['folders'])) return { ok: false, error: '"verified.components.folders" must be an array of strings.' };
  if (!optionalString(components['fileName'])) return { ok: false, error: '"verified.components.fileName" must be a string when present.' };
  if (!isRecord(corrections)) return { ok: false, error: '"verified.corrections" must be an object.' };
  for (const [key, value] of Object.entries(corrections)) {
    if (!isRecord(value) || !isString(value['was']) || !isString(value['now'])) {
      return { ok: false, error: `"verified.corrections.${key}" must have string "was" and "now".` };
    }
  }
  if (identifierCheck !== undefined) {
    if (!isRecord(identifierCheck) || !isString(identifierCheck['linkValue']) || !isString(identifierCheck['graphValue']) || typeof identifierCheck['matches'] !== 'boolean') {
      return { ok: false, error: '"verified.identifierCheck" is malformed.' };
    }
  }
  if (!isRecord(graph) || !isString(graph['driveId']) || !isString(graph['itemId'])) {
    return { ok: false, error: '"verified.graph" must carry string driveId and itemId.' };
  }
  for (const key of ['siteId', 'listItemUniqueId', 'webUrl'] as const) {
    if (!optionalString(graph[key])) return { ok: false, error: `"verified.graph.${key}" must be a string when present.` };
  }
  if (!isString(validatedAt) || Number.isNaN(Date.parse(validatedAt))) return { ok: false, error: '"verified.validatedAt" must be an ISO 8601 timestamp.' };
  if (!isStringArray(calls)) return { ok: false, error: '"verified.calls" must be an array of strings.' };
  if (!isString(methodText) || methodText === '') return { ok: false, error: '"verified.methodText" must be a non-empty string.' };

  const value: VerifiedResult = {
    path,
    folderUrl,
    components: {
      tenant: components['tenant'] as string,
      host: components['host'] as string,
      sitePath: components['sitePath'] as string,
      library: components['library'] as string,
      folders: components['folders'],
    },
    corrections: corrections as VerifiedResult['corrections'],
    graph: { driveId: graph['driveId'], itemId: graph['itemId'] },
    validatedAt: new Date(validatedAt).toISOString(),
    calls,
    methodText,
  };
  if (isString(components['fileName'])) value.components.fileName = components['fileName'];
  if (isString(graph['siteId'])) value.graph.siteId = graph['siteId'];
  if (isString(graph['listItemUniqueId'])) value.graph.listItemUniqueId = graph['listItemUniqueId'];
  if (isString(graph['webUrl'])) value.graph.webUrl = graph['webUrl'];
  if (isString(fileUrl)) value.fileUrl = fileUrl;
  if (identifierCheck !== undefined) {
    value.identifierCheck = identifierCheck as unknown as NonNullable<VerifiedResult['identifierCheck']>;
  }
  return { ok: true, value: { previousState: previousState as ValidationSubmission['previousState'], verified: value } };
}
