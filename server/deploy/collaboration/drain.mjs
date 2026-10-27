import { readFileSync } from 'node:fs';
const endpoint = new URL(process.env.VOEX_COLLAB_URL || ('http://' + (process.env.VOEX_COLLAB_HOST || '127.0.0.1') + ':' + (process.env.VOEX_COLLAB_PORT || '8091')));
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
  throw new Error('Drain requires a loopback service URL');
const file = process.env.VOEX_COLLAB_SECRET_FILE;
if (!file) throw new Error('VOEX_COLLAB_SECRET_FILE is required');
const secret = readFileSync(file, 'utf8').trim();
const response = await fetch(new URL('/internal/collab/drain', endpoint), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Collab-Secret': secret },
  body: '{}',
  signal: AbortSignal.timeout(28000),
});
const result = await response.json().catch(() => ({}));
if (!response.ok || result.success !== true)
  throw new Error('Drain did not complete; keep the API and collaboration service running and investigate.');
console.log('Collaboration rooms are persisted and drained. Stop collaboration before stopping the Go API.');
