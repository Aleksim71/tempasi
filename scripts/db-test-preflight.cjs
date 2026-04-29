#!/usr/bin/env node
// scripts/db-test-preflight.cjs
"use strict";

const { Client } = require("pg");

const HELP = [
  "Tempasi DB test preflight",
  "",
  "Usage:",
  "  node scripts/db-test-preflight.cjs",
  "  npm run test:db:check",
  "",
  "Environment:",
  "  DATABASE_URL_TEST is preferred.",
  "  DATABASE_URL is used as fallback.",
].join("\n");

function maskDatabaseUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:****@");
  }
}

function pickDatabaseUrl(env) {
  if (env.DATABASE_URL_TEST && env.DATABASE_URL_TEST.trim()) {
    return { key: "DATABASE_URL_TEST", value: env.DATABASE_URL_TEST.trim() };
  }
  if (env.DATABASE_URL && env.DATABASE_URL.trim()) {
    return { key: "DATABASE_URL", value: env.DATABASE_URL.trim() };
  }
  return { key: null, value: null };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const selected = pickDatabaseUrl(process.env);

  console.log("Tempasi test DB preflight");
  console.log("------------------------");

  if (!selected.value) {
    console.error("ERROR: missing DATABASE_URL_TEST or DATABASE_URL.");
    console.error("");
    console.error("Example:");
    console.error("  DATABASE_URL_TEST='postgres://tempasi:tempasi@127.0.0.1:5432/tempasi_test' npm run test:db:check");
    process.exit(1);
  }

  console.log(`Selected env: ${selected.key}`);
  console.log(`Database URL: ${maskDatabaseUrl(selected.value)}`);

  const client = new Client({
    connectionString: selected.value,
    application_name: "tempasi-test-db-preflight",
  });

  try {
    await client.connect();

    const result = await client.query(`
      select
        current_database() as database_name,
        current_user as database_user,
        inet_server_addr()::text as server_addr,
        inet_server_port() as server_port,
        version() as postgres_version
    `);

    const row = result.rows[0] || {};

    console.log("");
    console.log("Connection: OK");
    console.log(`Database:   ${row.database_name || "unknown"}`);
    console.log(`User:       ${row.database_user || "unknown"}`);
    console.log(`Server:     ${(row.server_addr || "local")}:${row.server_port || "unknown"}`);
    console.log(`Postgres:   ${String(row.postgres_version || "unknown").split(",")[0]}`);

    const tables = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
      limit 20
    `);

    console.log("");
    console.log(`Visible public tables: ${tables.rowCount}`);
    for (const item of tables.rows) {
      console.log(`- ${item.table_name}`);
    }

    console.log("");
    console.log("Result: DB preflight passed.");
  } catch (error) {
    console.error("");
    console.error("Connection: FAILED");
    console.error(`Reason: ${error && error.message ? error.message : String(error)}`);
    console.error("");
    console.error("This is an environment/database problem, not necessarily an application-code regression.");
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
