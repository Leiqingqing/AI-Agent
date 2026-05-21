import { Hono } from 'hono'

import simpleJwtAuth from './simpleJwtAuth'

const authRoutes = new Hono()

authRoutes.route('/simple-jwt', simpleJwtAuth)

export default authRoutes