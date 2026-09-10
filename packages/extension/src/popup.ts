// M1 stub. Proves the extension bundle consumes the shared parser package
// (BC-001) so that BC-042 can build on it without changing the wiring.
import { PARSER_VERSION } from '@breadcrumb/parser';

const status = document.getElementById('status');
if (status) {
  status.textContent = `${status.textContent} Parser ${PARSER_VERSION}.`;
}
