import { getApiBaseUrl, setApiBaseUrl } from './storage.js';

const form = document.getElementById('form') as HTMLFormElement;
const input = document.getElementById('base-url') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;

void getApiBaseUrl().then((value) => {
  input.value = value ?? '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saved = await setApiBaseUrl(input.value);
  if (saved === undefined) {
    status.textContent = input.value.trim() === '' ? 'Cleared. The popup will ask for an address before sending anything.' : 'That is not a usable http or https address.';
    return;
  }
  input.value = saved;
  status.textContent = `Saved ${saved}.`;
});
