import { Hono } from 'hono'
import { HTTPException } from "hono/http-exception";

import authRoutes from "./auth";
import databaseRoutes from "./database";
import errorHandleRoutes from "./errorHandle";
import middlewareRoutes from "./middleware";

const app = new Hono()

app.route("/auth", authRoutes);
app.route("/database", databaseRoutes);
app.route("/middleware", middlewareRoutes);
app.route("/error-handle", errorHandleRoutes);

app.onError((error, c) => {
    if (error instanceof HTTPException) {
        const response = error.getResponse();
        const message = response.statusText || error.message || "request failed";
        const details = error.cause instanceof Error ? error.cause.message : error.cause;

        return c.json(
            {
                success: false,
                error: {
                    code: "HTTP_EXCEPTION",
                    message,
                    status: error.status,
                    path: c.req.path,
                    method: c.req.method,
                    details
                }
            },
            error.status
        );
    }

    return c.json(
        {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "unexpected server error",
                status: 500,
                path: c.req.path,
                method: c.req.method
            }
        },
        500
    );
});

app.notFound((c) => {
    return c.json(
        {
            success: false,
            error: {
                code: "NOT_FOUND",
                message: "route not found",
                status: 404,
                path: c.req.path,
                method: c.req.method
            }
        },
        404
    );
});

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
