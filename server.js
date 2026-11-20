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
 * Handles POST /api/todos – creates a new todo from the JSON request body.
 *
 * Validation sequence:
 *   1. Content-Type must include application/json  → HTTP 400
 *   2. Body must be valid JSON object              → HTTP 400
 *   3. `title` field must be present               → HTTP 400
 *   4. `title` after trimming must be non-empty    → HTTP 400
 *   5. `title` after trimming must be ≤ 500 chars  → HTTP 400
 *   6. Body size must not exceed MAX_BODY_SIZE      → HTTP 413
 *
 * On success creates the todo, appends it to `todos`, and responds
 * with HTTP 201 and the new todo object.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleCreateTodo(req, res) {
  // 1. Require Content-Type: application/json
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    sendJson(res, 400, { error: 'Content-Type must be application/json' });
    return;
  }

  // 2. Read and parse the request body
  let parsed;
  try {
    const rawBody = await readRequestBody(req);
    parsed = JSON.parse(rawBody);
  } catch (err) {
    if (err.code === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Payload Too Large' });
    } else {
      sendJson(res, 400, { error: 'Invalid JSON' });
    }
    return;
  }

  // 3. Body must be a plain JSON object (not null, array, or primitive)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendJson(res, 400, { error: 'Request body must be a JSON object' });
    return;
  }

  // 4. `title` field must be present
  if (!Object.prototype.hasOwnProperty.call(parsed, 'title')) {
    sendJson(res, 400, { error: 'Missing title field' });
    return;
  }

  // 5. Title must be non-empty after trimming surrounding whitespace
  const title = String(parsed.title).trim();
  if (title.length === 0) {
    sendJson(res, 400, { error: 'Title cannot be empty' });
    return;
  }

  // 6. Title length guard (max 500 characters after trim)
  if (title.length > 500) {
    sendJson(res, 400, { error: 'Title too long' });
    return;
  }

  // Atomically assign ID and persist (single-threaded; no lock needed)
  const todo = { id: nextId++, title, completed: false };
  todos.push(todo);

  sendJson(res, 201, todo);
}

/**
 * Handles PATCH /api/todos/:id – updates the completion status of a todo.
 *
 * Validation sequence:
 *   1. Content-Type must include application/json  → HTTP 400
 *   2. Body must be valid JSON object              → HTTP 400
 *   3. `completed` field must be present           → HTTP 400
 *   4. `completed` must be a boolean               → HTTP 400
 *   5. Todo with given id must exist               → HTTP 404
 *
 * On success updates todo.completed and responds with HTTP 200 and the
 * updated todo object.
 *
 * @param {number} id  Parsed todo ID from the URL path
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleToggleTodo(id, req, res) {
  // 1. Require Content-Type: application/json
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    sendJson(res, 400, { error: 'Content-Type must be application/json' });
    return;
  }

  // 2. Read and parse the request body
  let parsed;
  try {
    const rawBody = await readRequestBody(req);
    parsed = JSON.parse(rawBody);
  } catch (err) {
    if (err.code === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Payload Too Large' });
    } else {
      sendJson(res, 400, { error: 'Invalid JSON' });
    }
    return;
  }

  // 3. Body must be a plain JSON object (not null, array, or primitive)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendJson(res, 400, { error: 'Request body must be a JSON object' });
    return;
  }

  // 4. `completed` field must be present
  if (!Object.prototype.hasOwnProperty.call(parsed, 'completed')) {
    sendJson(res, 400, { error: 'Missing completed field' });
    return;
  }

  // 5. `completed` must be a boolean (not truthy/falsy)
  if (typeof parsed.completed !== 'boolean') {
    sendJson(res, 400, { error: 'Completed must be boolean' });
    return;
  }

  // Find the todo by ID; return 404 if absent
  const todo = todos.find((t) => t.id === id);
  if (!todo) {
    sendJson(res, 404, { error: 'Todo not found' });
    return;
  }

  // Apply update and respond with the updated object
  todo.completed = parsed.completed;
  sendJson(res, 200, todo);
}

/**
 * Handles DELETE /api/todos/:id – removes a todo from the in-memory list.
 *
 * Returns HTTP 204 (No Content) on success.
 * Returns HTTP 404 if no todo with the given id exists.
 *
 * @param {number} id  Parsed todo ID from the URL path
 * @param {http.ServerResponse} res
 */
function handleDeleteTodo(id, res) {
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) {
    sendJson(res, 404, { error: 'Todo not found' });
    return;
  }

  // Remove the todo and respond with 204 No Content (empty body)
  todos.splice(index, 1);
  res.writeHead(204);
  res.end();
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
      handleCreateTodo(req, res).catch((err) => {
        console.error('Unhandled error in handleCreateTodo:', err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal server error' });
        }
      });
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  // ── /api/todos/:id  (resource)  ───────────────────────────────────────
  const idMatch = /^\/api\/todos\/(\d+)$/.exec(url);
  if (idMatch) {
    const id = parseInt(idMatch[1], 10);
    if (method === 'PATCH') {
      handleToggleTodo(id, req, res).catch((err) => {
        console.error('Unhandled error in handleToggleTodo:', err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal server error' });
        }
      });
      return;
    }
    if (method === 'DELETE') {
      handleDeleteTodo(id, res);
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
      console.log(`Server listening on port ${server.address().port}`);
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
