'use strict';

/**
 * Input Validation and Error Handling Tests
 *
 * Covers:
 *  - Content-Type checks (POST, PATCH)
 *  - Malformed JSON rejection
 *  - Non-object JSON body rejection
 *  - Title validation: missing, empty, whitespace-only, too long
 *  - `completed` validation: missing, non-boolean
 *  - 404 for non-existent resource on PATCH / DELETE
 *  - Consistent error response shape { error: string }
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, resetState } = require('../server.js');

let server;
let port;

before(async () => {
  // Port 0 lets the OS assign a free port – avoids conflicts with parallel test files.
  server = await startServer(0);
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

/**
 * Sends a raw HTTP request to the test server.
 *
 * Unlike a typed JSON helper, this function accepts a raw body string so that
 * tests can deliberately send malformed JSON or omit headers.
 *
 * @param {string} method
 * @param {string} path
 * @param {string|null} rawBody  - Already-serialised body; null sends no body.
 * @param {Record<string, string>} headers - Request headers.
 * @returns {Promise<{status: number, data: unknown, headers: Record<string,string>}>}
 */
function rawRequest(method, path, rawBody, headers) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    if (rawBody != null) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(rawBody, 'utf8'));
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let data = body;
          try { data = JSON.parse(body); } catch (_) { /* leave as string */ }
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (rawBody != null) req.write(rawBody);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: create a valid todo so PATCH tests have a real resource
// ---------------------------------------------------------------------------

async function createValidTodo(title = 'Test todo') {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    JSON.stringify({ title }),
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 201, 'Setup: failed to create todo');
  return res.data;
}

// ===========================================================================
// Content-Type validation
// ===========================================================================

test('POST /api/todos without Content-Type header returns 400', async () => {
  const res = await rawRequest('POST', '/api/todos', '{"title":"task"}', {});
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Content-Type must be application/json');
});

test('POST /api/todos with form-encoded Content-Type returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    'title=task',
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Content-Type must be application/json');
});

test('POST /api/todos with text/plain Content-Type returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{"title":"task"}',
    { 'Content-Type': 'text/plain' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Content-Type must be application/json');
});

test('PATCH /api/todos/:id without Content-Type header returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{"completed":true}',
    {}
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Content-Type must be application/json');
});

test('PATCH /api/todos/:id with wrong Content-Type returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    'completed=true',
    { 'Content-Type': 'text/plain' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Content-Type must be application/json');
});

// ===========================================================================
// Malformed JSON
// ===========================================================================

test('POST /api/todos with malformed JSON returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{ invalid json }',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Invalid JSON');
});

test('POST /api/todos with trailing comma JSON returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{"title":"task",}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Invalid JSON');
});

test('POST /api/todos with empty body returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
});

test('PATCH /api/todos/:id with malformed JSON returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{ bad }',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Invalid JSON');
});

// ===========================================================================
// Non-object JSON body
// ===========================================================================

test('POST /api/todos with JSON array body returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '[{"title":"task"}]',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
});

test('POST /api/todos with JSON null body returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    'null',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
});

test('POST /api/todos with JSON string body returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '"just a string"',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
});

// ===========================================================================
// Title field validation (POST)
// ===========================================================================

test('POST /api/todos with missing title field returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Missing title field');
});

test('POST /api/todos with empty string title returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{"title":""}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Title cannot be empty');
});

test('POST /api/todos with whitespace-only title returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{"title":"   "}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Title cannot be empty');
});

test('POST /api/todos with tab-only title returns 400', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{"title":"\t\n"}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Title cannot be empty');
});

test('POST /api/todos with title of exactly 500 chars succeeds', async () => {
  const title = 'a'.repeat(500);
  const res = await rawRequest(
    'POST',
    '/api/todos',
    JSON.stringify({ title }),
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 201);
  assert.equal(res.data.title, title);
});

test('POST /api/todos with title of 501 chars returns 400', async () => {
  const title = 'a'.repeat(501);
  const res = await rawRequest(
    'POST',
    '/api/todos',
    JSON.stringify({ title }),
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Title too long');
});

test('POST /api/todos with title of 1000 chars returns 400', async () => {
  const title = 'x'.repeat(1000);
  const res = await rawRequest(
    'POST',
    '/api/todos',
    JSON.stringify({ title }),
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Title too long');
});

// ===========================================================================
// `completed` field validation (PATCH)
// ===========================================================================

test('PATCH /api/todos/:id with missing completed field returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Missing completed field');
});

test('PATCH /api/todos/:id with string completed returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{"completed":"true"}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Completed must be boolean');
});

test('PATCH /api/todos/:id with numeric 1 completed returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{"completed":1}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Completed must be boolean');
});

test('PATCH /api/todos/:id with null completed returns 400', async () => {
  const todo = await createValidTodo();
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{"completed":null}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Completed must be boolean');
});

// ===========================================================================
// 404 – resource not found
// ===========================================================================

test('PATCH /api/todos/:id with non-existent id returns 404', async () => {
  const res = await rawRequest(
    'PATCH',
    '/api/todos/99999',
    '{"completed":true}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Todo not found');
});

test('DELETE /api/todos/:id with non-existent id returns 404', async () => {
  const res = await rawRequest('DELETE', '/api/todos/99999', null, {});
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Todo not found');
});

test('PATCH /api/todos/:id after deleting the todo returns 404', async () => {
  const todo = await createValidTodo();
  // Delete first
  const del = await rawRequest('DELETE', `/api/todos/${todo.id}`, null, {});
  assert.equal(del.status, 204);
  // Now PATCH the removed todo
  const res = await rawRequest(
    'PATCH',
    `/api/todos/${todo.id}`,
    '{"completed":true}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Todo not found');
});

// ===========================================================================
// Error response shape consistency
// ===========================================================================

test('all 400 error responses include a string error field', async () => {
  const cases = [
    // [rawBody, headers]
    ['{"title":"task"}', {}],                                   // no content-type
    ['{ bad }', { 'Content-Type': 'application/json' }],          // bad json
    ['{}', { 'Content-Type': 'application/json' }],               // missing title
    ['{"title":""}', { 'Content-Type': 'application/json' }],  // empty title
  ];

  for (const [body, headers] of cases) {
    const res = await rawRequest('POST', '/api/todos', body, headers);
    assert.equal(res.status, 400, `expected 400 for body=${body}`);
    assert.ok(
      res.data !== null && typeof res.data === 'object' && !Array.isArray(res.data),
      'error response body must be a JSON object'
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(res.data, 'error'),
      'error response must have an "error" key'
    );
    assert.equal(typeof res.data.error, 'string', '"error" value must be a string');
  }
});

test('all 400 error responses have Content-Type application/json', async () => {
  const res = await rawRequest(
    'POST',
    '/api/todos',
    '{}',
    { 'Content-Type': 'application/json' }
  );
  assert.equal(res.status, 400);
  assert.ok(
    (res.headers['content-type'] || '').includes('application/json'),
    'Content-Type must be application/json on error responses'
  );
});

test('404 response for unknown path has correct error shape', async () => {
  const res = await rawRequest('GET', '/api/nonexistent', null, {});
  assert.equal(res.status, 404);
  assert.ok(typeof res.data === 'object' && res.data !== null);
  assert.equal(typeof res.data.error, 'string');
});
