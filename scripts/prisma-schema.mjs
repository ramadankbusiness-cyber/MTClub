import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const postgresSchemaPath = path.join(root, "prisma", "schema.prisma");
const localSchemaPath = path.join(root, "prisma", "schema.local.sqlite.prisma");
export function getDatabaseProvider() {
  const configured = process.env.DATABASE_PROVIDER;
  if (configured === "postgresql" || configured === "sqlite") return configured;
  return process.env.DATABASE_URL?.startsWith("postgres") ? "postgresql" : "sqlite";
}

export async function createLocalSqliteSchema() {
  let schema = await readFile(postgresSchemaPath, "utf8");
  schema = schema.replace('provider = "postgresql"', 'provider = "sqlite"');
  schema = schema.replace(/^\s*directUrl\s*=.*\r?\n/gm, "");
  schema = schema.replace(/@db\.VarChar\(\d+\)/g, "");
  schema = schema.replace(/@db\.Date/g, "");
  await writeFile(localSchemaPath, schema, "utf8");
  return localSchemaPath;
}

export async function withLocalSqliteSchema(callback) {
  const schemaPath = await createLocalSqliteSchema();
  try {
    return await callback(schemaPath);
  } finally {
    await rm(schemaPath, { force: true });
  }
}
