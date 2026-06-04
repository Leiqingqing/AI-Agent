import { Context, Next } from "hono";
import { jwt } from "hono/jwt";
import { AppEnv } from "../types";
import { HTTPException } from "hono/http-exception";

export const authMiddleware = async (c: Context<AppEnv>,next: Next) => {
    const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET,alg:'HS256'});
    return jwtMiddleware(c,next)
}

export const requireRole = (role: string) => {
    return async (c: Context<AppEnv>, next: Next) => {
        const playload = c.get("jwtPayload")
        if(playload.role && playload.role !== role){
            throw new HTTPException(403,{message: "Forbidden: Insufficient permissions"})
        }    
        
        await next()
    };
};
