'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, resetState } = require('../server');

/** @type {import('node:http').Server} */
let server;
/** @type {number} */
let port;

before(async () => {
  server = await startServer(0);
  const addr = server.address();
  port = addr.port;
});

after(() => new Promise((resolve, reject) => {
  server.close((err) => (err ? reject(err) : resolve(undefined)));
}));

// リセットで各テストを独立させる
beforeEach(() => {
  resetState();
});

/**
 * テストサーバーへ JSON HTTP リクエストを送信し、ステータスとボディを返す。
 *
 * @param {string} method
 * @param {string} path
 * @param {object|null} [body]
 * @returns {Promise<{status: number, data: any}>}
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const headers = payload !== null
      ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }
      : {};
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            if (raw.length > 0) data = JSON.parse(raw);
          } catch (_e) {
            data = raw;
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/**
 * POST で todo を作成し HTTP 201 を検証してから作成オブジェクトを返す。
 *
 * @param {string} [title]
 * @returns {Promise<{id: number, title: string, completed: boolean}>}
 */
async function seedTodo(title = 'Test todo') {
  const r = await makeRequest('POST', '/api/todos', { title });
  assert.strictEqual(r.status, 201, `seedTodo: expected 201, got ${r.status}`);
  return r.data;
}

// ── PATCH /api/todos/:id ────────────────────────────────────────────────────

test('PATCH /api/todos/:id sets completed to true', async () => {
  const todo = await seedTodo('Buy milk');
  const r = await makeRequest('PATCH', `/api/todos/${todo.id}`, { completed: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.id, todo.id);
  assert.strictEqual(r.data.title, todo.title);
  assert.strictEqual(r.data.completed, true);
});

test('PATCH /api/todos/:id sets completed to false', async () => {
  const todo = await seedTodo('Write tests');
  await makeRequest('PATCH', `/api/todos/${todo.id}`, { completed: true });
  const r = await makeRequest('PATCH', `/api/todos/${todo.id}`, { completed: false });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.completed, false);
});

test('PATCH /api/todos/:id returns 404 for non-existent id', async () => {
  const r = await makeRequest('PATCH', '/api/todos/9999', { completed: true });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.data.error, 'Todo not found');
});

test('PATCH /api/todos/:id returns 400 when completed field is missing', async () => {
  const todo = await seedTodo();
  const r = await makeRequest('PATCH', `/api/todos/${todo.id}`, {});
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'Missing completed field');
});

test('PATCH /api/todos/:id returns 400 when completed is not boolean', async () => {
  const todo = await seedTodo();
  const r = await makeRequest('PATCH', `/api/todos/${todo.id}`, { completed: 'yes' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'Completed must be boolean');
});

test('PATCH /api/todos/:id returns 400 for invalid JSON', async () => {
  const todo = await seedTodo();
  const payload = '{ bad json }';
  const r = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/todos/${todo.id}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'Invalid JSON');
});

test('PATCH /api/todos/:id response includes all todo fields', async () => {
  const todo = await seedTodo('Check fields');
  const r = await makeRequest('PATCH', `/api/todos/${todo.id}`, { completed: true });
  assert.strictEqual(r.status, 200);
  assert.ok('id' in r.data, 'response must have id');
  assert.ok('title' in r.data, 'response must have title');
  assert.ok('completed' in r.data, 'response must have completed');
  assert.strictEqual(r.data.completed, true);
});

// ── DELETE /api/todos/:id ───────────────────────────────────────────────────

test('DELETE /api/todos/:id returns 204 with no body', async () => {
  const todo = await seedTodo('Clean house');
  const r = await makeRequest('DELETE', `/api/todos/${todo.id}`);
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.data, null);
});

test('DELETE /api/todos/:id removes the todo from the list', async () => {
  const todo = await seedTodo('Read book');
  await makeRequest('DELETE', `/api/todos/${todo.id}`);
  const getR = await makeRequest('GET', '/api/todos');
  assert.strictEqual(getR.status, 200);
  const found = getR.data.some((t) => t.id === todo.id);
  assert.strictEqual(found, false);
});

test('DELETE /api/todos/:id returns 404 for non-existent id', async () => {
  const r = await makeRequest('DELETE', '/api/todos/9999');
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.data.error, 'Todo not found');
});

test('DELETE /api/todos/:id only removes the targeted todo', async () => {
  const t1 = await seedTodo('Todo 1');
  const t2 = await seedTodo('Todo 2');
  const t3 = await seedTodo('Todo 3');

  await makeRequest('DELETE', `/api/todos/${t2.id}`);

  const r = await makeRequest('GET', '/api/todos');
  assert.strictEqual(r.status, 200);
  const ids = r.data.map((t) => t.id);
  assert.ok(ids.includes(t1.id), 'todo 1 should still exist');
  assert.ok(!ids.includes(t2.id), 'todo 2 should be deleted');
  assert.ok(ids.includes(t3.id), 'todo 3 should still exist');
});
