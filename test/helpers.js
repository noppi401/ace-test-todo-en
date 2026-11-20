'use strict';

const http = require('node:http');

/** テストサーバーのポート番号（本番の 3000 と競合しないよう別ポートを使用） */
const TEST_PORT = 3001;

/**
 * テストサーバーに HTTP リクエストを送信する
 * @param {string} method - HTTP メソッド（GET, POST, PATCH, DELETE）
 * @param {string} path - リクエストパス（例: '/api/todos'）
 * @param {Object|null} [body=null] - リクエストボディ（JSON.stringify される）
 * @param {number} [port=TEST_PORT] - サーバーポート
 * @returns {Promise<{status: number, data: any, headers: Object}>}
 */
async function makeRequest(method, path, body = null, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;

    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (bodyStr !== null) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let data;
        try {
          data = rawData.length > 0 ? JSON.parse(rawData) : null;
        } catch (_parseErr) {
          // レスポンスが JSON でない場合（HTML など）はそのまま文字列として返す
          data = rawData;
        }
        resolve({
          status: res.statusCode,
          data,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);

    if (bodyStr !== null) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * テスト用サーバーを起動する
 * server.js が startServer(port) をエクスポートしている必要がある
 * @param {number} [port=TEST_PORT] - 起動ポート
 * @returns {Promise<import('node:http').Server>}
 */
async function startTestServer(port = TEST_PORT) {
  // server.js が未実装の段階でも helpers.js 自体のロードができるよう遅延 require を使用
  const { startServer } = require('../server.js');
  const server = startServer(port);
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
}

/**
 * テスト用サーバーを停止する
 * @param {import('node:http').Server} server
 * @returns {Promise<void>}
 */
async function closeTestServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

module.exports = { makeRequest, startTestServer, closeTestServer, TEST_PORT };
