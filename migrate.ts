#!/usr/bin/env bun

import Database from "bun:sqlite";
import { createSqliteAdapter, createPostgresAdapter, createGenericAdapter } from "./index";
import { up, down, status } from "./index";

type Dialect = "sqlite" | "postgres" | "mysql";

interface Args {
	command: "up" | "down" | "status" | "reset";
	dialect: Dialect;
	migrationsPath: string;
	database: string;
	steps?: number;
}

function printHelp() {
	console.log(`
bun-migrate - SQLite/PostgreSQL/MySQL migration tool

USAGE:
  bun migrate.ts <command> [options]

COMMANDS:
  up              Apply pending migrations
  down            Rollback migrations
  reset           Rollback all migrations
  status          Show migration status

OPTIONS:
  --dialect       Database dialect: sqlite, postgres, mysql (default: sqlite)
  --database      Database name/file/URL (default: app.db for sqlite)
                  SQLite: file path (e.g., ./data/app.db)
                  PostgreSQL: connection string (e.g., postgres://user:pass@host:5432/dbname)
                  MySQL: connection string (e.g., mysql://user:pass@host:3306/dbname)
  --migrations    Path to migrations directory (default: ./migrations)
  --steps         Number of migrations to rollback (for down command, default: 1)
  --help          Show this help message

DEPENDENCIES:
  SQLite          Built-in with Bun
  PostgreSQL      Install with: bun add postgres
  MySQL           Install with: bun add mysql2

EXAMPLES:
  # SQLite (default)
  bun migrate.ts up --database ./data/app.db --migrations ./migrations
  
  # PostgreSQL (requires 'bun add postgres')
  bun migrate.ts up --dialect postgres --database postgres://user:pass@localhost/mydb
  bun migrate.ts status --dialect postgres --database postgres://user:pass@localhost/mydb
  
  # MySQL (requires 'bun add mysql2')
  bun migrate.ts down --steps 2 --dialect mysql --database mysql://root:pass@localhost/mydb
  bun migrate.ts reset --dialect mysql --database mysql://root:pass@localhost/mydb
	`);
}

function parseArgs(): Args {
	const args = Bun.argv.slice(2);

	if (args.length === 0 || args.includes("--help")) {
		printHelp();
		process.exit(0);
	}

	const command = args[0] as "up" | "down" | "status" | "reset";
	if (!["up", "down", "status", "reset"].includes(command)) {
		console.error(`❌ Unknown command: ${command}`);
		printHelp();
		process.exit(1);
	}

	let dialect: Dialect = "sqlite";
	let migrationsPath = "./migrations";
	let database = "app.db";
	let steps = 1;

	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--dialect" && args[i + 1]) {
			dialect = args[i + 1] as Dialect;
			i++;
		} else if (args[i] === "--database" && args[i + 1]) {
			database = args[i + 1];
			i++;
		} else if (args[i] === "--migrations" && args[i + 1]) {
			migrationsPath = args[i + 1];
			i++;
		} else if (args[i] === "--steps" && args[i + 1]) {
			steps = parseInt(args[i + 1], 10);
			i++;
		}
	}

	if (!["sqlite", "postgres", "mysql"].includes(dialect)) {
		console.error(`❌ Invalid dialect: ${dialect}`);
		process.exit(1);
	}

	return {
		command,
		dialect,
		migrationsPath,
		database,
		steps,
	};
}

async function main() {
	const { command, dialect, migrationsPath, database, steps } = parseArgs();

	try {
		if (dialect === "sqlite") {
			const db = new Database(database);
			const adapter = createSqliteAdapter(db);

			await executeCommand(command, adapter, dialect, migrationsPath, steps);

			db.close();
		} else if (dialect === "postgres") {
			// Using postgres package
			const postgres = await import("postgres");
			const sql = postgres.default(database);
			const adapter = createPostgresAdapter(sql);

			await executeCommand(command, adapter, dialect, migrationsPath, steps);

			await sql.end();
		} else if (dialect === "mysql") {
			// Using mysql2 package
			const mysql = await import("mysql2/promise");
			const connection = await mysql.createConnection(database);
			const adapter = createGenericAdapter(connection);

			await executeCommand(command, adapter, dialect, migrationsPath, steps);

			await connection.end();
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes("Cannot find module")) {
			const missingPackage = dialect === "postgres" ? "postgres" : "mysql2";
			console.error(`❌ ${missingPackage} package not installed. Install with: bun add ${missingPackage}`);
		} else {
			console.error("❌ Migration failed:", error);
		}
		process.exit(1);
	}
}

async function executeCommand(
	command: "up" | "down" | "status" | "reset",
	adapter: any,
	dialect: Dialect,
	migrationsPath: string,
	steps: number
) {
	if (command === "up") {
		await up(adapter, {
			migrationsPath,
			dialect,
			verbose: true,
		});
	} else if (command === "down") {
		await down(adapter, steps, {
			migrationsPath,
			dialect,
			verbose: true,
		});
	} else if (command === "reset") {
		const statuses = await status(adapter, {
			migrationsPath,
			dialect,
		});

		const appliedCount = statuses.filter((s) => s.status === "applied").length;

		if (appliedCount === 0) {
			console.log("ℹ️  No applied migrations to reset");
			return;
		}

		console.log(`⚠️  Resetting all ${appliedCount} applied migration(s)...`);
		await down(adapter, appliedCount, {
			migrationsPath,
			dialect,
			verbose: true,
		});
	} else if (command === "status") {
		const statuses = await status(adapter, {
			migrationsPath,
			dialect,
		});

		if (statuses.length === 0) {
			console.log("ℹ️  No migrations found");
			return;
		}

		console.log("\n📋 Migration Status:\n");
		const table = statuses.map((m) => ({
			Version: m.version,
			Name: m.name,
			Status: m.status === "applied" ? "✓ Applied" : "○ Pending",
			"Applied At": m.appliedAt ? new Date(m.appliedAt).toLocaleString() : "-",
		}));

		console.table(table);
	}
}
main();
