import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const UserSchema = sqliteTable('users',{
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role:text('role').notNull().default('user'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})