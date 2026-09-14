/**
 * Personal (consumer) OneDrive links: `onedrive.live.com` and `1drv.ms`
 * short links (matrix rows 7a and 7b). BreadCrumb does not support consumer
 * OneDrive (decision of 2026-09-14): these links are recognised only so the
 * user is told plainly that they are not supported, instead of seeing a
 * generic "not a Microsoft 365 link" or an Unresolved result.
 */
import { failure } from '../result.js';
import type { FormMatcher } from './context.js';

export const consumerOneDrive: FormMatcher = (ctx) => {
  if (ctx.host.kind !== 'onedrive-consumer' && ctx.host.kind !== 'shortlink') {
    return undefined;
  }
  return failure('consumer_onedrive', { host: ctx.host.host });
};
