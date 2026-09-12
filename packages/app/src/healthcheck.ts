/**
 * Container health check (BC-047): requests /healthz on the loopback address
 * over HTTP, or HTTPS when TLS_CERT_FILE is set, and exits 0 only on a 200.
 * The certificate is not verified here: its name is the public host name, not
 * 127.0.0.1, and this request never leaves the container.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const port = Number(process.env['PORT'] ?? '3000');
const tls = (process.env['TLS_CERT_FILE'] ?? '').trim() !== '';

const request = (tls ? httpsRequest : httpRequest)(
  { host: '127.0.0.1', port, path: '/healthz', method: 'GET', timeout: 4000, ...(tls ? { rejectUnauthorized: false } : {}) },
  (response) => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);
request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});
request.on('error', () => process.exit(1));
request.end();
