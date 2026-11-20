'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, resetState } = require('../server.js');

/** Assigned in before(); stores the port the test server is listening on. */
let TEST_PORT = 0;

/**
 * Makes an HTTP request to the test server.
 * Automatically JSON-serialises body and sets Content-Type / Content-Length
 * when body is non-null.
 *
 * @param {string} method  HTTP method
 * @param {string} path    URL path
 * @param {object|null} body  Request body; JSON-serialised when non-null
 * @param {Record<string,string>} extraHeaders  Additional request headers
 * @returns {Promise<{status: number, headers: object, data: any}>}
 */
function makeRequest(method, path, body, extraHeaders) {
  if (body === undefined) body = null;
  if (extraHeaders === undefined) extraHeaders = {};
  return new Promise((resolve, reject) => {
    const bodyStr = body !== null ? JSON.stringify(body) : null;
    const headers = Object.assign({}, extraHeaders);
    if (bodyStr !== null) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr, 'utf8'));
    }
    const req = http.request(
      { host: 'localhost', port: TEST_PORT, path, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data;
          try { data = JSON.parse(raw); } catch (_e) { data = raw; }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr !== null) req.write(bodyStr);
    req.end();
  });
}

/**
 * Makes an HTTP request with a pre-serialised raw string body.
 * Use this to test invalid JSON payloads or missing Content-Type scenarios.
 *
 * @param {string} method
 * @param {string} path
 * @param {string} rawBody
 * @param {Record<string,string>} headers
 * @returns {Promise<{status: number, headers: object, data: any}>}
 */
function makeRawRequest(method, path, rawBody, headers) {
  if (headers === undefined) headers = {};
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: TEST_PORT, path, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data;
          try { data = JSON.parse(raw); } catch (_e) { data = raw; }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

describe('POST /api/todos', () => {
  let server;

  before(async () => {
    server = await startServer(0); // OS assigns a free port; avoids conflicts
    TEST_PORT = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    resetState();
  });

  // -- Happy-path ------------------------------------------------------------------

  test('returns HTTP 201 with the created todo object', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: 'Buy groceries' });
    assert.equal(res.status, 201);
    assert.equal(res.data.id, 1);
    assert.equal(res.data.title, 'Buy groceries');
    assert.equal(res.data.completed, false);
  });

  test('trims surrounding whitespace from title', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: '  Walk the dog  ' });
    assert.equal(res.status, 201);
    assert.equal(res.data.title, 'Walk the dog');
  });

  test('assigns auto-incrementing IDs across sequential requests', async () => {
    const r1 = await makeRequest('POST', '/api/todos', { title: 'First' });
    const r2 = await makeRequest('POST', '/api/todos', { title: 'Second' });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r1.data.id, 1);
    assert.equal(r2.data.id, 2);
  });

  test('new todo is retrievable via GET /api/todos', async () => {
    await makeRequest('POST', '/api/todos', { title: 'Task A' });
    const getRes = await makeRequest('GET', '/api/todos', null);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.length, 1);
    assert.equal(getRes.data[0].title, 'Task A');
    assert.equal(getRes.data[0].completed, false);
  });

  test('ignores any client-supplied completed field', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: 'Task', completed: true });
    assert.equal(res.status, 201);
    assert.equal(res.data.completed, false);
  });

  test('response Content-Type is application/json', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: 'Check headers' });
    assert.ok(
      (res.headers['content-type'] || '').includes('application/json'),
      'Content-Type must include application/json'
    );
  });

  // -- Validation errors -----------------------------------------------------------

  test('empty title returns 400 with descriptive error', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: '' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Title cannot be empty');
  });

  test('whitespace-only title returns 400', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Title cannot be empty');
  });

  test('missing title field returns 400', async () => {
    const res = await makeRequest('POST', '/api/todos', { note: 'no title here' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Missing title field');
  });

  test('title longer than 500 characters returns 400', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: 'a'.repeat(501) });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Title too long');
  });

  test('title of exactly 500 characters is accepted', async () => {
    const res = await makeRequest('POST', '/api/todos', { title: 'a'.repeat(500) });
    assert.equal(res.status, 201);
    assert.equal(res.data.title.length, 500);
  });

  test('malformed JSON body returns 400', async () => {
    const rawBody = '{ invalid json }';
    const res = await makeRawRequest('POST', '/api/todos', rawBody, {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(rawBody, 'utf8')),
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Invalid JSON');
  });

  test('missing Content-Type header returns 400', async () => {
    const rawBody = JSON.stringify({ title: 'Task' });
    const res = await makeRawRequest('POST', '/api/todos', rawBody, {
      'Content-Length': String(Buffer.byteLength(rawBody, 'utf8')),
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Content-Type must be application/json');
  });

  test('failed creation does not modify the todo list', async () => {
    const listBefore = await makeRequest('GET', '/api/todos', null);
    await makeRequest('POST', '/api/todos', { title: '' }); // fails validation
    const listAfter = await makeRequest('GET', '/api/todos', null);
    assert.deepEqual(listAfter.data, listBefore.data);
  });
});
