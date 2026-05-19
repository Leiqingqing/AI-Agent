import { Hono } from 'hono'

const app = new Hono()

// GET - 返回纯文本
app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// GET - 返回 JSON
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

// GET - 带路径参数
app.get('/api/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, name: `User ${id}` })
})

// POST - 接收 JSON body
app.post('/api/users', async (c) => {
  const body = await c.req.json()
  return c.json({ message: 'User created', data: body }, 201)
})


export default app
