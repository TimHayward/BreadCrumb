/** The one setting: the BreadCrumb API base URL typed on the options page. */
import { normaliseBaseUrl } from './popupModel.js';

const KEY = 'apiBaseUrl';

export async function getApiBaseUrl(): Promise<string | undefined> {
  const stored = await chrome.storage.sync.get(KEY);
  return normaliseBaseUrl(stored[KEY] as string | undefined);
}

export async function setApiBaseUrl(value: string): Promise<string | undefined> {
  const normalised = normaliseBaseUrl(value);
  await chrome.storage.sync.set({ [KEY]: normalised ?? '' });
  return normalised;
}
