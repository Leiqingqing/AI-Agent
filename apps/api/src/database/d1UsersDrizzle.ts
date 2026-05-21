import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { asc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'

import { demoUsers } from '../db/schema'

type D1UsersDrizzleEnv = {
  Bindings: CloudflareBindings
}

const createUserSchema = z.object({
  username: z.string().min(2, 'username must be at least 2 characters'),
  email: z.string().email('email must be valid'),
  age: z.number().int().min(0, 'age must be zero or greater'),
})

const updateUserSchema = createUserSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'at least one field is required for update',
)

const batchQuerySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'ids must contain at least one item'),
})

const d1UsersDrizzle = new Hono<D1UsersDrizzleEnv>()

async function ensureUsersTable(database: CloudflareBindings['MY_DB']) {
  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS demo_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        age INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run()
}

function parseWithSchema<T>(result: z.SafeParseReturnType<unknown, T>) {
  if (!result.success) {
    throw new HTTPException(400, {
      message: 'request body validation failed',
      cause: result.error.flatten(),
    })
  }

  return result.data
}

function getDatabase(database: CloudflareBindings['MY_DB']) {
  return drizzle(database, { schema: { demoUsers } })
}

d1UsersDrizzle.use('*', async (c, next) => {
  await ensureUsersTable(c.env.MY_DB)
  await next()
})

d1UsersDrizzle.post('/users', async (c) => {
  const body = await c.req.json()
  const payload = parseWithSchema(createUserSchema.safeParse(body))
  const database = getDatabase(c.env.MY_DB)
  const [user] = await database.insert(demoUsers).values(payload).returning()

  return c.json({
    success: true,
    action: 'create',
    user,
  })
})

d1UsersDrizzle.get('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) {
    throw new HTTPException(400, {
      message: 'user id must be a valid number',
    })
  }

  const database = getDatabase(c.env.MY_DB)
  const [user] = await database.select().from(demoUsers).where(eq(demoUsers.id, id)).limit(1)

  if (!user) {
    throw new HTTPException(404, {
      message: `user not found: ${id}`,
    })
  }

  return c.json({
    success: true,
    action: 'get',
    user,
  })
})

d1UsersDrizzle.put('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) {
    throw new HTTPException(400, {
      message: 'user id must be a valid number',
    })
  }

  const body = await c.req.json()
  const payload = parseWithSchema(updateUserSchema.safeParse(body))
  const database = getDatabase(c.env.MY_DB)
  const [currentUser] = await database
    .select()
    .from(demoUsers)
    .where(eq(demoUsers.id, id))
    .limit(1)

  if (!currentUser) {
    throw new HTTPException(404, {
      message: `user not found: ${id}`,
    })
  }

  const [updatedUser] = await database
    .update(demoUsers)
    .set({
      username: payload.username ?? currentUser.username,
      email: payload.email ?? currentUser.email,
      age: payload.age ?? currentUser.age,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(demoUsers.id, id))
    .returning()

  return c.json({
    success: true,
    action: 'update',
    user: updatedUser,
  })
})

d1UsersDrizzle.delete('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) {
    throw new HTTPException(400, {
      message: 'user id must be a valid number',
    })
  }

  const database = getDatabase(c.env.MY_DB)
  const [deletedUser] = await database.delete(demoUsers).where(eq(demoUsers.id, id)).returning()

  if (!deletedUser) {
    throw new HTTPException(404, {
      message: `user not found: ${id}`,
    })
  }

  return c.json({
    success: true,
    action: 'delete',
    user: deletedUser,
  })
})

d1UsersDrizzle.post('/users/batch-get', async (c) => {
  const body = await c.req.json()
  const payload = parseWithSchema(batchQuerySchema.safeParse(body))
  const database = getDatabase(c.env.MY_DB)
  const users = await database
    .select()
    .from(demoUsers)
    .where(inArray(demoUsers.id, payload.ids))
    .orderBy(asc(demoUsers.id))

  return c.json({
    success: true,
    action: 'batch-get',
    users,
    requestedIds: payload.ids,
  })
})

export default d1UsersDrizzle