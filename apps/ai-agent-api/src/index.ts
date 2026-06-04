import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { handleError } from './middleware/error'
import auth from './routes/auth'
import user from './routes/user'
import admin from './routes/admin'
import { authMiddleware, requireRole } from './middleware/auth'
const app = new Hono()

app.use('*',logger())
app.use('*', cors())

app.onError(handleError)

app.route('/auth', auth)

app.use('/user/*',authMiddleware)
app.route('/user', user)

app.use('/admin/*', requireRole('admin'))
app.route('/admin', admin)
// GET - 返回纯文本
app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app