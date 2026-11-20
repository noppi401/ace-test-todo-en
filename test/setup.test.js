'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// helpers.js のエクスポート検証
test('helpers モジュールが必要な関数をエクスポートする', () => {
  const helpers = require('./helpers.js');
  assert.strictEqual(typeof helpers.makeRequest, 'function', 'makeRequest は関数');
  assert.strictEqual(typeof helpers.startTestServer, 'function', 'startTestServer は関数');
  assert.strictEqual(typeof helpers.closeTestServer, 'function', 'closeTestServer は関数');
});

// TEST_PORT の妥当性検証
test('TEST_PORT が有効なポート番号で本番ポート 3000 と競合しない', () => {
  const { TEST_PORT } = require('./helpers.js');
  assert.strictEqual(typeof TEST_PORT, 'number', 'TEST_PORT は数値型');
  assert.ok(TEST_PORT > 0 && TEST_PORT <= 65535, 'TEST_PORT は有効なポート範囲内 (1-65535)');
  assert.notStrictEqual(TEST_PORT, 3000, 'TEST_PORT は本番ポート 3000 と異なる');
});

// package.json のスクリプト検証
test('package.json のテストスクリプトが node --test を使用している', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
  );
  assert.ok(pkg.scripts, 'scripts フィールドが存在する');
  assert.ok(pkg.scripts.test, 'test スクリプトが存在する');
  assert.ok(
    pkg.scripts.test.includes('node --test'),
    'test スクリプトが node --test を使用している'
  );
  assert.ok(pkg.scripts.start, 'start スクリプトが存在する');
  assert.ok(
    pkg.scripts.start.includes('server.js'),
    'start スクリプトが server.js を起動する'
  );
});

// package.json の engines フィールド検証
test('package.json の engines に Node.js v18 以上が指定されている', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
  );
  assert.ok(pkg.engines, 'engines フィールドが存在する');
  assert.ok(pkg.engines.node, 'engines.node が指定されている');
  // '>=18.0.0' のような文字列から先頭の数字を抽出して検証
  const match = pkg.engines.node.match(/(\d+)/);
  assert.ok(match, 'engines.node からバージョン番号が抽出できる');
  assert.ok(
    parseInt(match[1], 10) >= 18,
    'Node.js v18 以上が要件として指定されている'
  );
});

// README.md の存在とクイックスタート情報の検証
test('README.md が存在しクイックスタート情報を含む', () => {
  const readmePath = path.resolve(__dirname, '..', 'README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md が存在する');
  const content = fs.readFileSync(readmePath, 'utf8');
  assert.ok(content.includes('node server.js'), 'README にサーバー起動コマンドが記載されている');
  assert.ok(content.includes('npm test'), 'README にテスト実行コマンドが記載されている');
  assert.ok(content.includes('localhost:3000'), 'README にアクセス URL が記載されている');
});
