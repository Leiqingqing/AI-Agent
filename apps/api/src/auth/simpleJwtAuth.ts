import { Hono } from 'hono'
import { jwt, sign } from 'hono/jwt'

const jwtSecret = 'lqq_dev'
const jwtAlgorithm = 'HS256'

type JwtUserPayload = {
  userId: string
  username: string
  exp?: number
  iat?: number
}

type AuthDemoEnv = {
  Variables: {
    jwtPayload: JwtUserPayload
  }
}

const simpleJwtAuth = new Hono<AuthDemoEnv>()

simpleJwtAuth.post('/login', async (c) => {
  const body = await c.req.json<{ userId?: string; username?: string }>()
  const userId = body.userId?.trim()
  const username = body.username?.trim()

  if (!userId || !username) {
    return c.json(
      {
        success: false,
        message: 'userId and username are required',
      },
      400,
    )
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const token = await sign(
    {
      userId,
      username,
      iat: issuedAt,
      exp: issuedAt + 60 * 60,
    },
    jwtSecret,
    jwtAlgorithm,
  )

  return c.json({
    success: true,
    message: 'login success',
    token,
    tokenType: 'Bearer',
    user: {
      userId,
      username,
    },
  })
})

simpleJwtAuth.use('/me', jwt({ secret: jwtSecret, alg: jwtAlgorithm }))

simpleJwtAuth.get('/me', (c) => {
  const jwtPayload = c.get('jwtPayload')

  return c.json({
    success: true,
    message: 'jwt verified',
    user: {
      userId: jwtPayload.userId,
      username: jwtPayload.username,
    },
    jwtPayload,
  })
})

export default simpleJwtAuth