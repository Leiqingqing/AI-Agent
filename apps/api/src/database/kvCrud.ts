import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

type KvCrudEnv = {
  Bindings: {
    MY_KV: KVNamespace
  }
}

type PutDataRequest = {
  value: unknown
}

const kvCrud = new Hono<KvCrudEnv>()

function parseStoredValue(rawValue: string) {
  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}

kvCrud.put('/data/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<PutDataRequest>()

  if (typeof body.value === 'undefined') {
    throw new HTTPException(400, {
      message: 'request body must include a value field',
    })
  }

  await c.env.MY_KV.put(key, JSON.stringify(body.value))

  return c.json({
    success: true,
    action: 'put',
    key,
    value: body.value,
  })
})

kvCrud.get('/data/:key', async (c) => {
  const key = c.req.param('key')
  const rawValue = await c.env.MY_KV.get(key)

  if (rawValue === null) {
    throw new HTTPException(404, {
      message: `kv key not found: ${key}`,
    })
  }

  return c.json({
    success: true,
    action: 'get',
    key,
    value: parseStoredValue(rawValue),
  })
})

kvCrud.delete('/data/:key', async (c) => {
  const key = c.req.param('key')

  await c.env.MY_KV.delete(key)

  return c.json({
    success: true,
    action: 'delete',
    key,
  })
})

kvCrud.get('/list', async (c) => {
  const limitParam = c.req.query('limit')
  const prefix = c.req.query('prefix')
  const cursor = c.req.query('cursor')
  const parsedLimit = limitParam ? Number(limitParam) : undefined

  if (typeof parsedLimit !== 'undefined' && Number.isNaN(parsedLimit)) {
    throw new HTTPException(400, {
      message: 'limit query must be a valid number',
    })
  }

  const result = await c.env.MY_KV.list({
    cursor,
    prefix,
    limit: parsedLimit,
  })
  const nextCursor = 'cursor' in result ? result.cursor : undefined

  return c.json({
    success: true,
    action: 'list',
    keys: result.keys,
    list_complete: result.list_complete,
    cursor: nextCursor,
  })
})

export default kvCrud