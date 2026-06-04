import { Hono } from "hono";
import { AppEnv } from "../types";
import z from "zod";
import { zValidator } from '@hono/zod-validator'
import { drizzle } from "drizzle-orm/d1";
import { UserSchema as users } from "../db/schema";
import { hashPassword, verifyPassword } from "../utils/password";
import { sign } from "hono/utils/jwt/jwt";
const auth = new Hono<AppEnv>()


    
// 注册校验规则
const registerSchema =z.object({
    name: z.string().min(2, "用户名至少需要2个字符").max(20, "用户名最多20个字符"),
    password: z.string().min(6, "密码至少需要6个字符").max(20, "密码最多20个字符"),
    email: z.string().email("请输入有效的邮箱地址"),
})

const loginSchema = z.object({
    email: z.string().email("请输入有效的邮箱地址"),
    password: z.string().min(6, "密码至少需要6个字符").max(20, "密码最多20个字符"),
})

// 注册之后要重新登陆
auth.post('/register',zValidator('json',registerSchema),async(c) => {
    const db =drizzle(c.env.DB, { schema: { users } })
    const { name, password, email } = c.req.valid('json')
    // 校验邮箱是否已被注册
    const exit = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.email, email)
    })  
    if(exit){
        return c.json({
            success: false,          
            error: {             
                
                code: "EMAIL_ALREADY_REGISTERED",           
                message: "该邮箱已被注册",
                status: 400,              
                path: c.req.path,              
                method: c.req.method            
            }          
        }, 400) 
    }
    // 生成password hash 
    const passwordHash = await hashPassword(password)
    // 将信息存进数据库
    const [newUser] = await db.insert(users).values({
        name,
        email,
        passwordHash
    }).returning()
    
    return c.json({
        success: true,
        data: {   
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role         
        }})
}).post('/login',zValidator('json',loginSchema),async(c) => {
    const { email, password } = c.req.valid('json')
    const db = drizzle(c.env.DB, { schema: { users } })
    const user = await db.query.users.findFirst({ 
        where: (users, { eq }) => eq(users.email, email)
     })

    if(!user){
        return c.json({
            success: false,
            error: {
                code: "USER_NOT_FOUND",
                message: "用户不存在",
                status: 404,
                path: c.req.path,
                method: c.req.method
            }
        }, 404)
    }
    const isPasswordValid = await verifyPassword(password, user.passwordHash)
    if(!isPasswordValid){
        return c.json({
            success: false, 
            error: {
                code: "INVALID_PASSWORD",
                message: "密码错误",
                status: 401,
                path: c.req.path,
                method: c.req.method
            }
        }, 401)
    }

    const token = await sign({ 
        id: user.id, 
        email: user.email , 
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // token 1小时后过期
    }, c.env.JWT_SECRET)
    
    return c.json({
        success: true,
        data: {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            },
            token,
           
        }
    })
})

export default auth
