'use strict';

/**
 * test/server-startup.test.js
 *
 * HTTP Server Foundation tests.
 * Verifies that the server starts, listens on the configured port,
 * dispatches routes correctly (405 on wrong methods for known paths),
 * returns 404 for unknown paths, strips query strings before matching,
 * and wraps every error in a well-formed JSON body.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, resetState } = require('../server.js');

/** Port dedicated to this test file; avoids conflicts with other suites. */
const PORT = 3101;

/** @type {http.Server} */
let server;

before(async () => {
  server = await startServer(PORT);
});

after(() => new Promise((resolve) => {
  resetState();
  server.close(resolve);
}));

/**
 * Sends an HTTP request to the test server.
 *
 * @param {string} method
 * @param {string} path
 * @param {object} [body]  When provided, serialised as JSON body.
 * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, raw: string}>}
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : {},
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: /** @type {number} */ (res.statusCode),
          headers: res.headers,
          raw: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// --- Server lifecycle ---

describe('startServer', () => {
  it('resolves with an http.Server instance', () => {
    assert.ok(
      server instanceof http.Server,
      'startServer() should resolve with an http.Server'
    );
  });

  it('server is listening on the specified port', () => {
    const addr = /** @type {import('net').AddressInfo} */ (server.address());
    assert.ok(addr !== null, 'server.address() should not be null while listening');
    assert.strictEqual(addr.port, PORT);
  });

  it('server accepts incoming connections and returns a valid HTTP status', async () => {
    const res = await request('GET', '/');
    assert.ok(
      res.status >= 100 && res.status < 600,
      `expected a valid HTTP status code, got ${res.status}`
    );
  });
});

// --- Route dispatching: method not allowed ---
// Receiving 405 (not 404) proves the route handler was entered,
// confirming that dispatch reached the right branch instead of falling
// through to the catch-all.

describe('Route dispatching - method not allowed on /api/todos', () => {
  it('PUT /api/todos returns 405', async () => {
    const res = await request('PUT', '/api/todos');
    assert.strictEqual(res.status, 405);
  });

  it('DELETE /api/todos returns 405', async () => {
    const res = await request('DELETE', '/api/todos');
    assert.strictEqual(res.status, 405);
  });

  it('PATCH /api/todos returns 405', async () => {
    const res = await request('PATCH', '/api/todos');
    assert.strictEqual(res.status, 405);
  });
});

describe('Route dispatching - method not allowed on /api/todos/:id', () => {
  it('GET /api/todos/1 returns 405', async () => {
    const res = await request('GET', '/api/todos/1');
    assert.strictEqual(res.status, 405);
  });

  it('POST /api/todos/1 returns 405', async () => {
    const res = await request('POST', '/api/todos/1');
    assert.strictEqual(res.status, 405);
  });

  it('PUT /api/todos/1 returns 405', async () => {
    const res = await request('PUT', '/api/todos/1');
    assert.strictEqual(res.status, 405);
  });
});

// --- Route dispatching: catch-all 404 ---

describe('Route dispatching - catch-all 404 for unknown paths', () => {
  it('GET /unknown-path returns 404', async () => {
    const res = await request('GET', '/unknown-path');
    assert.strictEqual(res.status, 404);
  });

  it('GET /api (no resource segment) returns 404', async () => {
    const res = await request('GET', '/api');
    assert.strictEqual(res.status, 404);
  });

  it('GET /api/todos/abc (non-numeric id) returns 404', async () => {
    const res = await request('GET', '/api/todos/abc');
    assert.strictEqual(res.status, 404);
  });

  it('DELETE /api/todos/abc (non-numeric id) returns 404', async () => {
    const res = await request('DELETE', '/api/todos/abc');
    assert.strictEqual(res.status, 404);
  });

  it('GET /api/todos/1/extra (extra segments) returns 404', async () => {
    const res = await request('GET', '/api/todos/1/extra');
    assert.strictEqual(res.status, 404);
  });
});

// --- Route dispatching: query strings stripped before matching ---
// Verifies the router ignores query strings when choosing a handler.

describe('Route dispatching - query strings stripped before matching', () => {
  it('PUT /api/todos?foo=bar still returns 405 (not 404)', async () => {
    const res = await request('PUT', '/api/todos?foo=bar');
    assert.strictEqual(res.status, 405);
  });

  it('DELETE /api/todos?x=y still returns 405', async () => {
    const res = await request('DELETE', '/api/todos?x=y');
    assert.strictEqual(res.status, 405);
  });

  it('PUT /api/todos/1?a=b still returns 405', async () => {
    const res = await request('PUT', '/api/todos/1?a=b');
    assert.strictEqual(res.status, 405);
  });
});

// --- JSON response format ---

describe('JSON response format for error responses', () => {
  it('catch-all 404 response has Content-Type: application/json', async () => {
    const res = await request('GET', '/nonexistent');
    assert.ok(
      typeof res.headers['content-type'] === 'string' &&
        res.headers['content-type'].includes('application/json'),
      'Content-Type should include application/json'
    );
  });

  it('catch-all 404 response body is valid JSON', async () => {
    const res = await request('GET', '/nonexistent');
    assert.doesNotThrow(
      () => JSON.parse(res.raw),
      'response body should be parseable JSON'
    );
  });

  it('catch-all 404 response body has a non-empty error string', async () => {
    const res = await request('GET', '/nonexistent');
    const body = JSON.parse(res.raw);
    assert.strictEqual(typeof body.error, 'string', 'body.error should be a string');
    assert.ok(body.error.length > 0, 'body.error should not be empty');
  });

  it('405 response has Content-Type: application/json', async () => {
    const res = await request('PUT', '/api/todos');
    assert.ok(
      typeof res.headers['content-type'] === 'string' &&
        res.headers['content-type'].includes('application/json'),
      'Content-Type should include application/json'
    );
  });

  it('405 response body is valid JSON with a non-empty error string', async () => {
    const res = await request('PUT', '/api/todos');
    const body = JSON.parse(res.raw);
    assert.strictEqual(typeof body.error, 'string');
    assert.ok(body.error.length > 0, 'body.error should not be empty');
  });
});
