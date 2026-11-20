'use strict';

const http = require('node:http');

/**
 * In-memory todo list.  Each entry has the shape:
 *   { id: number, title: string, completed: boolean }
 *
 * @type {Array<{id: number, title: string, completed: boolean}>}
 */
let todos = [];

/**
 * Monotonically increasing counter used to assign unique IDs to new todos.
 * Starts at 1 and is incremented each time a todo is created.
 */
let nextId = 1;

/** Maximum accepted request body size (bytes). Larger payloads are rejected with 413. */
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

/**
 * Resets the in-memory todo list and ID counter to their initial values.
 * Intended only for use in test before / after hooks.
 */
function resetState() {
  todos = [];
  nextId = 1;
}

/**
 * Collects all `data` events from an incoming request and resolves with
 * the full body as a UTF-8 string.  Rejects with an Error whose `.code`
 * property is `'PAYLOAD_TOO_LARGE'` when the body exceeds MAX_BODY_SIZE.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_SIZE) {
        settled = true;
        const err = new Error('Payload Too Large');
        // @ts-ignore – attaching a code property for caller identification
        err.code = 'PAYLOAD_TOO_LARGE';
        req.destroy(err);
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

/**
 * Writes an HTTP response with `status` and a JSON-serialised `data` body.
 * Sets `Content-Type: application/json` and a matching `Content-Length`.
 *
 * @param {http.ServerResponse} res
 * @param {number} status  HTTP status code (e.g. 200, 201, 204, 400, 404)
 * @param {unknown} data   Value serialised as the JSON response body
 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  res.end(body);
}

/**
 * Central request dispatcher.  Parses the incoming URL path and HTTP method
 * then routes to the matching handler.  Any unrecognised path / method
 * combination returns a JSON 404 response.
 *
 * Route table:
 *   GET    /               → static HTML UI
 *   GET    /api/todos      → list all todos
 *   POST   /api/todos      → create a new todo
 *   PATCH  /api/todos/:id  → update todo completion status
 *   DELETE /api/todos/:id  → remove a todo
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function handleRequest(req, res) {
  const method = req.method || 'GET';
  // Drop any query string; routing decisions are based on path alone.
  const url = (req.url || '/').replace(/\?.*$/, '');

  console.log(`${method} ${url}`);

  // ── Static UI  GET /  ─────────────────────────────────────────────────
  if (url === '/' && method === 'GET') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  // ── /api/todos  (collection)  ─────────────────────────────────────────
  if (url === '/api/todos') {
    if (method === 'GET') {
      sendJson(res, 200, todos);
      return;
    }
    if (method === 'POST') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  // ── /api/todos/:id  (resource)  ───────────────────────────────────────
  const idMatch = /^\/api\/todos\/(\d+)$/.exec(url);
  if (idMatch) {
    if (method === 'PATCH') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (method === 'DELETE') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  // ── Catch-all 404  ────────────────────────────────────────────────────
  sendJson(res, 404, { error: 'Not found' });
}

/**
 * Creates an HTTP server wired to `handleRequest` and starts listening on
 * `port`.  Resolves with the server instance once it is ready to accept
 * connections; rejects if the port cannot be bound.
 *
 * @param {number} [port=3000]
 * @returns {Promise<http.Server>}
 */
function startServer(port = 3000) {
  const server = http.createServer(handleRequest);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
      resolve(server);
    });
  });
}

// Export public API consumed by the test suite.
module.exports = { startServer, resetState };

// When invoked directly (`node server.js`), start on the default port.
if (require.main === module) {
  startServer(3000).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
