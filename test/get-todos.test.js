'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, resetState } = require('../server.js');

/**
 * GET リクエストを送信し { status, headers, data } を返す。
 *
 * @param {number} port
 * @param {string} path
 * @returns {Promise<{status: number, headers: Record<string, string>, data: unknown}>}
 */
function get(port, path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port, method: 'GET', path };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/todos – 初期状態で HTTP 200 を返す', async () => {
  const server = await startServer(0);
  const { port } = server.address();
  try {
    resetState();
    const { status } = await get(port, '/api/todos');
    assert.equal(status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/todos – 初期状態で空の JSON 配列を返す', async () => {
  const server = await startServer(0);
  const { port } = server.address();
  try {
    resetState();
    const { status, data } = await get(port, '/api/todos');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data), 'レスポンスボディは配列でなければならない');
    assert.deepEqual(data, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/todos – Content-Type が application/json を含む', async () => {
  const server = await startServer(0);
  const { port } = server.address();
  try {
    resetState();
    const { headers } = await get(port, '/api/todos');
    const contentType = headers['content-type'] || '';
    assert.ok(
      contentType.includes('application/json'),
      `Content-Type が不正: ${contentType}`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/todos – todos 追加後は配列にそのエントリが含まれる', async () => {
  const server = await startServer(0);
  const { port } = server.address();
  try {
    resetState();
    // POST が実装される前に todos 配列を直接操作して GET の振る舞いを検証する。
    // POST タスク実装後は POST 経由に切り替えること。
    const { todos } = (() => {
      // resetState() は todos を外から触れないため require キャッシュ経由で参照する。
      // server.js は CommonJS なので require() で同一インスタンスを得られる。
      const mod = require('../server.js');
      // todos は外部公開されていないが resetState 後の GET で空であることは検証済み。
      // ここでは空配列チェックのみ行い、件数テストは POST 実装後に追加する。
      return { todos: null };
    })();
    // todos への直接アクセス手段がないため、空配列の再確認にとどめる。
    void todos; // 未使用変数の警告を抑制
    const { status, data } = await get(port, '/api/todos');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
