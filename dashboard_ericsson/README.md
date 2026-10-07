# FH Saturation API

Backend of the microwave-link (FH) saturation dashboard. An administrator uploads a daily Excel/CSV export of
bandwidth-utilization histograms; the API validates it, stores it, and serves the figures the dashboard needs:
how many sites are good / medium / critical, the top and bottom sites, the top wilayas, and one page per site.

- **Stack:** Node.js, Express 5, MongoDB (Mongoose 9), JWT authentication, ExcelJS, Jest + Supertest.
- **Language:** plain JavaScript (CommonJS). There is **no build step**: what you run is what is in the repository.
- **API reference:** [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3).

## Architecture

```
server.js            starts the process: config check, MongoDB connection, HTTP server, graceful shutdown
app.js               the Express app: security middleware, routes, error handler (no listen() here, so tests can import it)
routes/              URL -> controller (+ role checks)
controllers/         HTTP layer: read the request, call a service, shape the answer; errorController = the one error handler
models/              Mongoose schemas and indexes: Site, Link, Import, ImportIssue, Measurement, User
utils/calc/          PURE calculation module (tails, S(theta), mean utilization, P95): no Express, no Mongoose
utils/               the rest, mostly pure functions: excelReader, parsers, rowValidator, importPlanner, dashboardBuilder,
                     siteList, siteDetail, wilayaStats ... and the DB-facing services: importService, dashboardService
utils/security.js    helmet, CORS, rate limiting, request ids, request log
utils/logger.js      structured (JSON) logging
config/              thresholds (good/medium/critical), wilaya names, site-page report texts
docs/openapi.yaml    API documentation
tests/               Jest tests (unit + real-database integration)
```

How the data flows: `POST /imports` runs **upload -> read -> validate -> plan -> store** in one request. Every row
is *accepted* (measured `OK`, or a PM failure kept as coverage information, possibly with warnings) or *rejected*.
A site's **load** is the 95th percentile of its daily utilization, taken on its worst measured link of the most
recent day. A site whose links all failed that day is `no_data` (counted, never ranked). The wilaya of a site is
derived from its NeId (5 digits: first two; 4 digits: first one).

## Requirements

- Node.js 22 (the only version it has been tested on: 22.13.1)
- MongoDB, **standalone is enough** (no replica set, no transactions are used). Tested on 8.0.4; other versions are untested.
- Docker is optional: it is only a convenient way to run MongoDB

## Installation

```bash
npm install
cp .env.example config.env      # the app reads ./config.env (NOT .env.example); then edit it
```

Start MongoDB, either with Docker:

```bash
docker compose up -d            # MongoDB 8 on 127.0.0.1:27017, data in the "mongo-data" volume
```

or use any MongoDB you already have and point `DATABASE_LOCAL` at it.

Create the first administrator (reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `config.env`, then remove the password from the file):

```bash
npm run create-admin            # creates the admin, or resets the password of an existing one
```

Passwords must have at least 12 characters (72 bytes at most). Other users (role `viewer`, read-only) are created
by inserting a `User` document (`models/userModel.js`); there is no registration endpoint on purpose.

## Environment variables (`config.env`)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DATABASE_LOCAL` | yes | | MongoDB connection string of the app |
| `JWT_SECRET` | yes | | At least 32 characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | no | `1d` | Token lifetime: `30m`, `12h`, `1d`... |
| `PORT` | no | `3000` | HTTP port |
| `NODE_ENV` | no | | `development` or `production` |
| `CORS_ORIGIN` | no | none | Comma-separated browser origins allowed to call the API (your frontend URL). Empty = no CORS headers |
| `RATE_LIMIT_MAX` | no | `300` | Requests per IP per 15 min, whole API (`/health` excluded) |
| `LOGIN_RATE_MAX` | no | `10` | FAILED logins per IP per 15 min |
| `TRUST_PROXY` | no | off | Number of reverse proxies in front of the API, so the limiter sees the real client IP |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `DATABASE_TEST` | for tests | | Base URL of the test databases. **Its name must contain "test"**; tests append a suffix and drop those databases |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | for `create-admin` | | See above |
| `BCRYPT_COST` | no | `12` | Password hashing cost (the tests lower it) |

The process refuses to start, with a clear message, if the configuration is invalid.

## Running

```bash
npm run dev       # development: nodemon restarts on changes
npm start         # production: node server.js
```

For production, set `NODE_ENV=production`, a strong `JWT_SECRET`, `CORS_ORIGIN` to your frontend's origin, and
`TRUST_PROXY` if the API sits behind a proxy. The API speaks plain HTTP: put a TLS-terminating reverse proxy in front of it.
Run it from the project directory (it reads `./config.env`; real environment variables also work and take precedence).
`SIGINT`/`SIGTERM` finish the requests in progress and close the database connection.

Quick check: `curl http://localhost:3000/api/v1/health` -> `{"status":"success","message":"API is running","uptime":3,"database":"connected"}`

## Tests

```bash
npm test                     # the whole suite (needs MongoDB running at DATABASE_TEST)
npx jest security            # one file (by name)
```

- Unit tests need nothing; the `*.api.test.js`, `*.db.test.js`, `security`, `import.*`, `apiDocs` tests use a real MongoDB,
  each in its own database (`DATABASE_TEST` + a suffix), dropped at the end.
- The tests that need the **real workbook** look for `dev-data/congestion_data.xlsx` (git-ignored, not in the repository).
  Without it they are reported as *skipped*, never as passed. Put the file there to run them.
- There is no TypeScript and no linter configured in this project, so there is no typecheck/lint command and no build command.

## Authentication

`POST /api/v1/auth/login` with `{ "email", "password" }` returns a JWT (HS256). Send it on every other call as
`Authorization: Bearer <token>`. The token is checked on every request against the database: a deleted or disabled
account, or a password change, invalidates existing tokens immediately, and a role change applies at once.

| Role | Can do |
|---|---|
| `viewer` | read everything (history, rows, issues, dashboard, wilayas, sites) |
| `admin` | everything a viewer can, plus `POST /imports` and `DELETE /imports/:id` |

Failures are `401` (no, invalid or expired token) or `403` (wrong role).

## Import workflow

1. Log in as an admin.
2. `POST /api/v1/imports` with a multipart form, one file in the field **`file`** (`.xlsx` or `.csv`, 10 MB max).
   Columns are found by header name: `NeId, NeType, EntityType, MeasurePoint, EndTime (dd/mm/yyyy hh:mm:ss), Failure, Avg, Max, Min`
   and the 20 slices `0-5` ... `95-100`.
3. The file is read in memory, every row is validated (a measured row's 20 slices must add up to 86 400 s; a row with a
   `Failure` text is stored as a failure, never as a measurement; unparsable/duplicate rows are rejected), then stored.
   If anything fails, nothing is left behind.
4. The same file (SHA-256) cannot be imported twice (`409 IMPORT_DUPLICATE_FILE`). A row whose link and day already exist
   from an earlier import is skipped and reported as a `DUPLICATE_OF_EXISTING` warning.
5. Inspect it: `GET /imports/:id`, `/imports/:id/rows?filter=valid|failed`, `/imports/:id/issues`.
6. Changed your mind? `DELETE /api/v1/imports/:id` (admin) removes the import's measurements and issues, then the links
   and sites that nothing else uses. It is safe to repeat (`404` the second time), and if the server stops half-way the
   import stays hidden and a new `DELETE` finishes the job (after a 5-minute safety delay, `409` before).

## Example requests

```bash
BASE=http://localhost:3000/api/v1

# log in
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"your-password-here"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

# import a file
curl -s -X POST $BASE/imports -H "Authorization: Bearer $TOKEN" -F "file=@congestion_data.xlsx"

# dashboard (whole network, latest day) and "as of" a day
curl -s $BASE/dashboard -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/dashboard?date=2026-02-10" -H "Authorization: Bearer $TOKEN"

# sites: critical ones of wilaya 18, worst first, 20 per page
curl -s "$BASE/sites?condition=critical&wilaya=18&sort=load_desc&limit=20" -H "Authorization: Bearer $TOKEN"

# one site (siteId comes from the list), then cancel an import
curl -s $BASE/sites/<siteId> -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE $BASE/imports/<importId> -H "Authorization: Bearer $TOKEN"
```

## Errors

Every error has the same shape. Branch on `code`, not on `message`:

```json
{ "status": "fail", "code": "IMPORT_DUPLICATE_FILE", "message": "This file was already imported on ...",
  "details": { "importId": "..." }, "requestId": "0b0f5d0e-..." }
```

`status` is `fail` for 4xx and `error` for 5xx. Stack traces, MongoDB messages, file paths and token details are never
sent to the client; they are only in the server log, under the same `requestId` (also returned in the `X-Request-Id` header).
The list of codes per endpoint is in [`docs/openapi.yaml`](docs/openapi.yaml).

## API documentation

[`docs/openapi.yaml`](docs/openapi.yaml) documents every endpoint: method, path, auth and roles, parameters, bodies,
upload rules, example responses and error responses. Open it in any OpenAPI viewer (for example paste it into
https://editor.swagger.io or import it in Postman/Insomnia). A test (`tests/apiDocs.test.js`) fails if a route is added
without being documented, or if the document names an error code the code no longer sends.

## Logging

One JSON object per line on stdout (warnings and errors on stderr), e.g.
`{"time":"...","level":"info","message":"import committed","requestId":"...","importId":"...","counts":{...}}`.
Logged: server start/stop, every request (method, path, status, duration; never the query string or headers),
import started / prepared / committed / failed / reverted, refused requests (401, 403, 429) with the client IP, and
unexpected errors with their stack. Never logged: passwords, tokens, the JWT secret, file contents (a log field whose
name looks like a secret is redacted). Set `LOG_LEVEL` to change the verbosity; tests are silent.

## Security summary

helmet headers; CORS only for `CORS_ORIGIN`; global rate limit and a stricter failed-login limit; JSON bodies limited to
10 kB; uploads limited to one `.xlsx`/`.csv` file of 10 MB, kept in memory (never written to disk); JWT pinned to HS256;
passwords hashed with bcrypt; every query parameter validated before reaching the database (no operator objects, no
user-supplied regular expressions); unique indexes make duplicate files and duplicate measurements impossible even
under concurrent requests.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid configuration in config.env: JWT_SECRET is missing` (or too short) | Copy `.env.example` to `config.env` and set a secret of 32+ characters |
| Process exits with `could not connect to the database` | MongoDB is not running or `DATABASE_LOCAL` is wrong. `docker compose up -d`, then retry |
| `503 DATABASE_UNAVAILABLE` | The API is up but MongoDB went away; it recovers when MongoDB is back |
| Tests: `Refusing to run on a database whose name does not contain "test"` | Fix `DATABASE_TEST` in `config.env` |
| Tests: `MongoServerError: available disk space ... less than required minimum` | MongoDB refuses writes when its disk has under 500 MB free. Free some space or move its data directory |
| Tests are *skipped* | The real workbook `dev-data/congestion_data.xlsx` is not present (see Tests) |
| `401 TOKEN_EXPIRED` | Log in again |
| `429 RATE_LIMITED` | Wait for the `Retry-After` seconds; raise `RATE_LIMIT_MAX` / `LOGIN_RATE_MAX` if the limits are too low for you. Behind a proxy set `TRUST_PROXY`, or all users share one IP |
| Browser says CORS error | Put the frontend's exact origin (scheme + host + port) in `CORS_ORIGIN` and restart |
| Upload `400 UPLOAD_MALFORMED` / `UPLOAD_INVALID` | In Postman the form-data key must be exactly `file` and its type `File` |
| Upload `422 EXCEL_MISSING_COLUMNS` | The header row lacks required columns; `details.missing` lists them |
| `409 IMPORT_DUPLICATE_FILE` | That exact file was imported already. Revert the old import first if you really want to redo it |
