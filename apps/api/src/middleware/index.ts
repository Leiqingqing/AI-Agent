import { Hono } from 'hono'

import simpleAuth from './simpleAuth'

const middlewareRoutes = new Hono()

middlewareRoutes.route('/simple-auth', simpleAuth)

export default middlewareRoutes