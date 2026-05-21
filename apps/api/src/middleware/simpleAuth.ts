import { Hono } from 'hono'
import type { Context, Next } from 'hono'

type MiddlewareDemoEnv = {
  Variables: {
    executionOrder: string[]
  }
}

const simpleAuth = new Hono<MiddlewareDemoEnv>()

function recordStep(c: Context<MiddlewareDemoEnv>, step: string) {
  const executionOrder = c.get('executionOrder') ?? []
  executionOrder.push(step)
  c.set('executionOrder', executionOrder)
}

async function requestLogger(c: Context<MiddlewareDemoEnv>, next: Next) {
  c.set('executionOrder', ['requestLogger:start'])

  await next()

  recordStep(c, 'requestLogger:end')
  c.res.headers.set('X-Execution-Order', c.get('executionOrder').join(' -> '))
}

async function apiKeyAuth(c: Context<MiddlewareDemoEnv>, next: Next) {
  recordStep(c, 'apiKeyAuth:start')

  const apiKey = c.req.header('X-API-Key')

  if (apiKey !== 'demo-secret-key') {
    recordStep(c, 'apiKeyAuth:unauthorized')

    return c.json(
      {
        message: 'missing or invalid X-API-Key',
        note: 'check the X-Execution-Order response header for the full middleware order',
        executionOrder: c.get('executionOrder'),
        expectedApiKey: 'demo-secret-key',
      },
      401,
    )
  }

  recordStep(c, 'apiKeyAuth:authorized')

  await next()

  recordStep(c, 'apiKeyAuth:end')
}

function buildRoutePayload(c: Context<MiddlewareDemoEnv>, routeName: string) {
  recordStep(c, `${routeName}:handler`)

  return {
    route: routeName,
    executionOrder: c.get('executionOrder'),
  }
}

simpleAuth.use('*', requestLogger)

simpleAuth.get('/public', (c) => {
  return c.json({
    message: 'public route, no api key required',
    note: 'check the X-Execution-Order response header for the full middleware order',
    ...buildRoutePayload(c, 'public'),
  })
})

simpleAuth.use('/protected/*', apiKeyAuth)

simpleAuth.get('/protected/profile', (c) => {
  return c.json({
    message: 'protected route, api key accepted',
    note: 'check the X-Execution-Order response header for the full middleware order',
    apiKeyFromHeader: c.req.header('X-API-Key'),
    ...buildRoutePayload(c, 'protected/profile'),
  })
})

export default simpleAuth