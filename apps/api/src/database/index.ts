import { Hono } from 'hono'

import d1UsersDrizzle from "./d1UsersDrizzle";
import d1Users from "./d1Users";
import kvCrud from "./kvCrud";

const databaseRoutes = new Hono();

databaseRoutes.route("/d1-users-drizzle", d1UsersDrizzle);
databaseRoutes.route('/d1-users', d1Users)
databaseRoutes.route('/kv-crud', kvCrud)

export default databaseRoutes