import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

type D1UsersEnv = {
  Bindings: {
    MY_DB: D1Database
  }
}

type UserRecord = {
  id: number
  username: string
  email: string
  age: number
  created_at: string
  updated_at: string
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

const d1Users = new Hono<D1UsersEnv>()

async function ensureUsersTable(database: D1Database) {
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

d1Users.use('*', async (c, next) => {
  await ensureUsersTable(c.env.MY_DB)
  await next()
})

d1Users.post('/users', async (c) => {
  const body = await c.req.json()
  const payload = parseWithSchema(createUserSchema.safeParse(body))

  const result = await c.env.MY_DB
    .prepare(
      `INSERT INTO demo_users (username, email, age)
       VALUES (?1, ?2, ?3)
       RETURNING id, username, email, age, created_at, updated_at`,
    )
    .bind(payload.username, payload.email, payload.age)
    .first<UserRecord>()

  return c.json({
    success: true,
    action: 'create',
    user: result,
  })
})

d1Users.get('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) {
    throw new HTTPException(400, {
      message: 'user id must be a valid number',
    })
  }

  const user = await c.env.MY_DB
    .prepare(
      `SELECT id, username, email, age, created_at, updated_at
       FROM demo_users
       WHERE id = ?1`,
    )
    .bind(id)
    .first<UserRecord>()

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

d1Users.put('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) {
    throw new HTTPException(400, {
      message: 'user id must be a valid number',
    })
  }

  const body = await c.req.json()
  const payload = parseWithSchema(updateUserSchema.safeParse(body))
  const currentUser = await c.env.MY_DB
    .prepare('SELECT id, username, email, age FROM demo_users WHERE id = ?1')
    .bind(id)
    .first<{ id: number; username: string; email: string; age: number }>()

  if (!currentUser) {
    throw new HTTPException(404, {
      message: `user not found: ${id}`,
    })
  }

  const nextUser = {
    username: payload.username ?? currentUser.username,
    email: payload.email ?? currentUser.email,
    age: payload.age ?? currentUser.age,
  }

  const updatedUser = await c.env.MY_DB
    .prepare(
      `UPDATE demo_users
       SET username = ?1,
           email = ?2,
           age = ?3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?4
       RETURNING id, username, email, age, created_at, updated_at`,
    )
    .bind(nextUser.username, nextUser.email, nextUser.age, id)
    .first<UserRecord>()

  return c.json({
    success: true,
    action: 'update',
    user: updatedUser,
  })
})

d1Users.delete('/users/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) {
    throw new HTTPException(400, {
      message: 'user id must be a valid number',
    })
  }

  const deletedUser = await c.env.MY_DB
    .prepare(
      `DELETE FROM demo_users
       WHERE id = ?1
       RETURNING id, username, email, age, created_at, updated_at`,
    )
    .bind(id)
    .first<UserRecord>()

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

d1Users.post('/users/batch-get', async (c) => {
  const body = await c.req.json()
  const payload = parseWithSchema(batchQuerySchema.safeParse(body))
  const placeholders = payload.ids.map((_, index) => `?${index + 1}`).join(', ')

  const result = await c.env.MY_DB
    .prepare(
      `SELECT id, username, email, age, created_at, updated_at
       FROM demo_users
       WHERE id IN (${placeholders})
       ORDER BY id ASC`,
    )
    .bind(...payload.ids)
    .all<UserRecord>()

  return c.json({
    success: true,
    action: 'batch-get',
    users: result.results,
    requestedIds: payload.ids,
  })
})

export default d1Users