import { Hono } from "hono";
import { AppEnv } from "../types";
import { drizzle } from "drizzle-orm/d1";
import { UserSchema } from "../db/schema";

const admin = new Hono<AppEnv>();

admin.get("/users",  async (c) => {
    const db = drizzle(c.env.DB, { schema: { UserSchema } })
    const users = await db.query.UserSchema.findMany()
    return c.json({
        success: true,
        data: users
    })      
});

export type AdminRoute = typeof admin
export default admin