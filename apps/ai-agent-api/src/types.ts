// cloudflare worker global scope
export type Bindings ={
    // Add your KV namespaces, Durable Object bindings, R2 buckets, etc. here.
    DB: D1Database;
    JWT_SECRET: string;
}
// hono context variables
export type Variables = {
    jwtPayload:{
        sub: number;
        name: string;
        password_hash: string;
        create_at: number;
        exp: number;
        role: string;
    }
}

export type AppEnv = {
    Bindings: Bindings;
    Variables: Variables;
}