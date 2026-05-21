import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(2, 'name must be at least 2 characters'),
  age: z.number().int().positive('age must be a positive integer'),
})

const zodHttpException = new Hono()

zodHttpException.post('/users', async (c) => {
  const body = await c.req.json()
  const parsedBody = createUserSchema.safeParse(body)

  if (!parsedBody.success) {
    throw new HTTPException(400, {
      message: 'request body validation failed',
      cause: parsedBody.error.flatten(),
    })
  }

  return c.json({
    success: true,
    data: {
      id: 'demo-user-001',
      ...parsedBody.data,
    },
  })
})

zodHttpException.get('/business-error', () => {
  throw new HTTPException(409, {
    message: 'demo business rule rejected the request',
  })
})

export default zodHttpException