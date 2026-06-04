import { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export const handleError = async (error: Error,c:Context) => {
    if (error instanceof HTTPException) {

        return c.json({
            success: false,
            error: {
                code: error.status,
                message: error.message,
                status: error.status
            }
        }, error.status)
    }
    return c.json({
        success: false,
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "服务器内部错误",
            status: 500
        }
    }, 500)
}   
