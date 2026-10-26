const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.GEMINI_API_KEY = 'synthetic-upstream-test-value';
process.env.GATEWAY_API_KEY = 'synthetic-caller-credential-for-offline-test';
const app = require('./gemini_gateway');

test('Generation And Download Routes Require A Configured Caller Key', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(base + route, options);
  const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
  try {
    assert.equal((await request('/healthz')).status, 200);
    for (const route of ['/v1/images/generations', '/v1/videos/generations']) {
      assert.equal((await request(route, post)).status, 401);
      assert.equal((await request(route, { ...post, headers: { ...post.headers, Authorization: 'Basic invalid' } })).status, 401);
      assert.equal((await request(route, { ...post, headers: { ...post.headers, Authorization: `Bearer ${'x'.repeat(40)}` } })).status, 401);
    }
    assert.equal((await request('/v1/videos/download')).status, 401);

    delete process.env.GATEWAY_API_KEY;
    assert.equal((await request('/v1/images/generations', post)).status, 503);
    process.env.GATEWAY_API_KEY = 'short';
    assert.equal((await request('/v1/videos/download')).status, 503);
    process.env.GATEWAY_API_KEY = 'synthetic-caller-credential-for-offline-test';

    const authorized = { ...post, headers: { ...post.headers, Authorization: `Bearer ${process.env.GATEWAY_API_KEY}` } };
    assert.equal((await request('/v1/images/generations', authorized)).status, 400);
    assert.equal((await request('/v1/videos/download', { headers: { Authorization: `Bearer ${process.env.GATEWAY_API_KEY}` } })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    delete process.env.GATEWAY_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }
});
