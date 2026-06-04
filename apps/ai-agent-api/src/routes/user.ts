import { Hono } from "hono";
import { AppEnv } from "../types";
import { drizzle } from "drizzle-orm/d1";
import { UserSchema } from "../db/schema";
import { eq } from "drizzle-orm";

const user= new Hono<AppEnv>();


user.get('/profile',async(c) => {
const db = drizzle(c.env.DB, { schema: { UserSchema } })
const payload = c.get("jwtPayload")
const user = await db.select({
    id:UserSchema.id,
    name:UserSchema.name,
    email:UserSchema.email,
    role:UserSchema.role,
    createdAt:UserSchema.createdAt
}).from(UserSchema).where(eq(UserSchema.id, payload.sub)).get()
if(!user){
    return c.json({
        success: false,
        error: {
            code: "USER_NOT_FOUND",
            message: "用户不存在",
            status: 404,
        }
    })
}
return c.json({
    success: true,
    data: user
})
})
export type UserRoute = typeof user
export default user