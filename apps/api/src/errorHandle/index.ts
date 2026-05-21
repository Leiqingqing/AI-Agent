import { Hono } from 'hono'

import zodHttpException from './zodHttpException'

const errorHandleRoutes = new Hono()

errorHandleRoutes.route('/zod-http-exception', zodHttpException)

export default errorHandleRoutes