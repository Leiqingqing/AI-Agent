---
name: hono-demo-generation
description: 'Generate Hono learning demos for this repository. Use when creating Hono examples, Hono route demos, Hono middleware demos, Hono validation demos, or Hono API learning examples under apps/api/src. Enforce topic-based folders, per-topic subrouters, and route registration in apps/api/src/index.ts.'
argument-hint: 'Describe the Hono topic, the learning point to demonstrate, and the expected route behavior'
user-invocable: true
---

# Hono Demo Generation

## When to Use

- Create a new Hono learning demo in `apps/api/src`
- Add a new Hono topic such as routing, middleware, validation, context, or error handling
- Expand the API app with a new topic-based Hono subrouter
- Standardize how Hono demos are organized in this repository

## Required Rules

1. All Hono demos must live under `apps/api/src`.
2. Group demos by topic under `apps/api/src/[topic]/`.
3. Each topic must be a standalone subrouter.
4. The topic router entry should be `apps/api/src/[topic]/index.ts`.
5. The app root router must mount topic routers from `apps/api/src/index.ts`.
6. Keep each demo focused on one learning point.
7. Prefer minimal, runnable examples over framework-heavy abstractions.
8. Reuse the repository's existing Hono style instead of introducing a new app structure.
9. Do not mix unrelated topics into one folder or one route file.
10. If the topic folder does not exist yet, create the folder and its `index.ts` router first.

## Repository Conventions

- `apps/api` is a Hono app.
- The current app entry is `apps/api/src/index.ts`.
- New topic routes should be mounted from the root app with `app.route(...)`.
- Topic folders should be named by responsibility, such as `routing`, `middleware`, `validation`, or `request`.
- Demo filenames should be camelCase and describe the learning point.
- Avoid generic names like `demo.ts`, `example.ts`, or `test.ts`.

## Topic Structure

Use this structure when adding a new topic:

```text
apps/api/src/
  index.ts
  [topic]/
    index.ts
    [demoName].ts
```

Example:

```text
apps/api/src/
  index.ts
  middleware/
    index.ts
    timingHeader.ts
```

## Implementation Procedure

1. Identify the Hono topic first.
2. Create or reuse `apps/api/src/[topic]/`.
3. Create `apps/api/src/[topic]/index.ts` if the topic router does not already exist.
4. Put each learning demo in its own file under that topic folder.
5. Export route registration from the topic router.
6. Mount the topic router in `apps/api/src/index.ts`.
7. Keep handlers short and readable.
8. Use `c.text(...)` or `c.json(...)` when they are sufficient.
9. Only introduce middleware, validation, or helper functions when the topic requires them.
10. Keep the final route shape obvious from the folder structure.

## Router Pattern

Use this pattern for a topic router:

```ts
import { Hono } from 'hono'

import timingHeader from './timingHeader'

const middlewareRoutes = new Hono()

middlewareRoutes.route('/timing-header', timingHeader)

export default middlewareRoutes
```

Use this pattern for a demo file:

```ts
import { Hono } from 'hono'

const timingHeader = new Hono()

timingHeader.get('/', async (c, next) => {
  const startedAt = Date.now()

  await next()

  c.header('x-response-time', `${Date.now() - startedAt}ms`)
})

timingHeader.get('/hello', (c) => {
  return c.json({ message: 'hello from timing header demo' })
})

export default timingHeader
```

Use this pattern in `apps/api/src/index.ts`:

```ts
import { Hono } from 'hono'

import middlewareRoutes from './middleware'

const app = new Hono()

app.route('/middleware', middlewareRoutes)

export default app
```

## Naming Guidance

- Topic folders should use short lowercase names.
- Demo files should use camelCase names based on the learning point.
- Prefer names like `pathParams.ts`, `jsonBody.ts`, `timingHeader.ts`, `zodValidator.ts`.
- Avoid filenames that only repeat the topic, such as `middlewareDemo.ts` or `routingExample.ts`.

## Demo Scope Guidance

- One route behavior per file is preferred.
- One topic router may aggregate multiple small demo files.
- Keep examples educational and runnable.
- Do not add unrelated business logic, authentication, database setup, or deployment changes unless the topic explicitly needs them.

## Local Validation Method

- After adding or changing a Hono demo, validate the exposed routes against the local dev server when it is already running.
- On Windows, prefer `curl.exe` instead of PowerShell's `curl` alias so request headers and response headers are easier to inspect.
- For the local API app in this repository, use `http://127.0.0.1:8787` by default unless the user states a different dev server address.
- Use `curl.exe -i` so the response status, headers, and body can be checked together.
- For middleware demos, verify both the success path and the failure path when the middleware can short-circuit the request.
- When the learning point is execution order, include or inspect a response header such as `X-Execution-Order` in addition to the JSON body.

Example validation commands for the `middleware/simpleAuth.ts` demo:

```powershell
curl.exe -i -sS http://127.0.0.1:8787/middleware/simple-auth/public
curl.exe -i -sS http://127.0.0.1:8787/middleware/simple-auth/protected/profile
curl.exe -i -sS http://127.0.0.1:8787/middleware/simple-auth/protected/profile -H "X-API-Key: demo-secret-key"
```

Expected results for that demo:

- `/public` returns `200` and shows `requestLogger:start -> public:handler -> requestLogger:end` in `X-Execution-Order`.
- `/protected/profile` without `X-API-Key` returns `401` and shows `requestLogger:start -> apiKeyAuth:start -> apiKeyAuth:unauthorized -> requestLogger:end` in `X-Execution-Order`.
- `/protected/profile` with `X-API-Key: demo-secret-key` returns `200` and shows `requestLogger:start -> apiKeyAuth:start -> apiKeyAuth:authorized -> protected/profile:handler -> apiKeyAuth:end -> requestLogger:end` in `X-Execution-Order`.

## Final Checklist

- The demo is under `apps/api/src/[topic]/`.
- The topic has its own `index.ts` router.
- The root router in `apps/api/src/index.ts` mounts the topic router.
- The demo file name is camelCase and responsibility-based.
- The code is minimal and focused on one Hono learning point.
- The generated routes are easy to discover from the folder layout.
