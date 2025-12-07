import { expect, test, describe } from "bun:test";
import Database from "bun:sqlite";
import { createSqliteAdapter, up, down, status } from "./index";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const TEMP_DB = "/tmp/bun-migrate-cli-test.db";
const TEMP_MIGRATIONS_DIR = "/tmp/bun-migrate-cli-test";

async function setupMigrationsDir() {
	rmSync(TEMP_MIGRATIONS_DIR, { recursive: true, force: true });
	mkdirSync(TEMP_MIGRATIONS_DIR, { recursive: true });
}

function createMigration(version: string, name: string, upSql: string, downSql?: string) {
	const content = downSql !== undefined ? `${upSql}\n-- migration: down\n${downSql}` : upSql;
	writeFileSync(join(TEMP_MIGRATIONS_DIR, `${version}_${name}.sql`), content);
}

function cleanupDb() {
	rmSync(TEMP_DB, { force: true });
}

describe("migrate.ts CLI", () => {
	test("up command applies pending migrations", async () => {
		cleanupDb();
		await setupMigrationsDir();

		createMigration(
			"20231207_120000",
			"create_users",
			`CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL
			);`,
			`DROP TABLE users;`
		);

		createMigration(
			"20231207_120001",
			"create_posts",
			`CREATE TABLE posts (
				id INTEGER PRIMARY KEY,
				title TEXT NOT NULL,
				user_id INTEGER
			);`,
			`DROP TABLE posts;`
		);

		const db = new Database(TEMP_DB);
		const adapter = createSqliteAdapter(db);

		// Apply all migrations
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Verify both tables were created
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
		const tableNames = tables.map((t: any) => t.name);
		expect(tableNames).toContain("users");
		expect(tableNames).toContain("posts");

		// Verify migrations table exists and has 2 entries
		const migrations = db.prepare("SELECT COUNT(*) as count FROM __migrations__").all() as { count: number }[];
		expect(migrations[0]?.count).toBe(2);

		db.close();
	});

	test("down command rollsback migrations", async () => {
		cleanupDb();
		await setupMigrationsDir();

		createMigration(
			"20231207_120000",
			"create_users",
			`CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL
			);`,
			`DROP TABLE users;`
		);

		createMigration(
			"20231207_120001",
			"create_posts",
			`CREATE TABLE posts (
				id INTEGER PRIMARY KEY,
				title TEXT NOT NULL
			);`,
			`DROP TABLE posts;`
		);

		const db = new Database(TEMP_DB);
		const adapter = createSqliteAdapter(db);

		// Apply all migrations
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Rollback 1 migration (most recent, which is posts)
		await down(adapter, 1, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Verify only posts table was dropped, users still exists
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
		const tableNames = tables.map((t: any) => t.name);
		expect(tableNames).toContain("users");
		expect(tableNames).not.toContain("posts");

		// Verify migrations table shows only 1 applied migration
		const migrations = db.prepare("SELECT COUNT(*) as count FROM __migrations__").all() as { count: number }[];
		expect(migrations[0]?.count).toBe(1);

		db.close();
	});

	test("status command shows migration status", async () => {
		cleanupDb();
		await setupMigrationsDir();

		createMigration(
			"20231207_120000",
			"create_users",
			`CREATE TABLE users (id INTEGER PRIMARY KEY);`,
			`DROP TABLE users;`
		);

		createMigration(
			"20231207_120001",
			"create_posts",
			`CREATE TABLE posts (id INTEGER PRIMARY KEY);`,
			`DROP TABLE posts;`
		);

		const db = new Database(TEMP_DB);
		const adapter = createSqliteAdapter(db);

		// Check initial status - both pending
		let statuses = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});

		expect(statuses.length).toBe(2);
		expect(statuses[0]?.status).toBe("pending");
		expect(statuses[1]?.status).toBe("pending");

		// Apply all
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		const statusesAfter = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});

		expect(statusesAfter[0]?.status).toBe("applied");
		expect(statusesAfter[1]?.status).toBe("applied");

		// Rollback one
		await down(adapter, 1, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		const statusesRollback = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});

		expect(statusesRollback[0]?.status).toBe("applied");
		expect(statusesRollback[1]?.status).toBe("pending");

		db.close();
	});

	test("reset command rollsback all migrations", async () => {
		cleanupDb();
		await setupMigrationsDir();

		createMigration(
			"20231207_120000",
			"create_users",
			`CREATE TABLE users (id INTEGER PRIMARY KEY);`,
			`DROP TABLE users;`
		);

		createMigration(
			"20231207_120001",
			"create_posts",
			`CREATE TABLE posts (id INTEGER PRIMARY KEY);`,
			`DROP TABLE posts;`
		);

		createMigration(
			"20231207_120002",
			"create_comments",
			`CREATE TABLE comments (id INTEGER PRIMARY KEY);`,
			`DROP TABLE comments;`
		);

		const db = new Database(TEMP_DB);
		const adapter = createSqliteAdapter(db);

		// Apply all migrations
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Verify all applied
		let statuses = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});
		const appliedCount = statuses.filter((s) => s.status === "applied").length;
		expect(appliedCount).toBe(3);

		// Reset all
		await down(adapter, appliedCount, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Verify all rolled back
		statuses = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});
		const remainingApplied = statuses.filter((s) => s.status === "applied").length;
		expect(remainingApplied).toBe(0);

		// Verify all tables dropped
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
		const tableNames = tables.map((t: any) => t.name);
		expect(tableNames).not.toContain("users");
		expect(tableNames).not.toContain("posts");
		expect(tableNames).not.toContain("comments");

		db.close();
	});

	test("handles multiple steps rollback correctly", async () => {
		cleanupDb();
		await setupMigrationsDir();

		// Create 5 migrations
		for (let i = 0; i < 5; i++) {
			createMigration(
				`20231207_12000${i}`,
				`create_table_${i}`,
				`CREATE TABLE table_${i} (id INTEGER PRIMARY KEY);`,
				`DROP TABLE table_${i};`
			);
		}

		const db = new Database(TEMP_DB);
		const adapter = createSqliteAdapter(db);

		// Apply all 5
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Rollback 3 migrations (most recent 3: table_4, table_3, table_2)
		await down(adapter, 3, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		// Verify first 2 tables remain
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
		const tableNames = tables.map((t: any) => t.name);
		expect(tableNames).toContain("table_0");
		expect(tableNames).toContain("table_1");
		expect(tableNames).not.toContain("table_2");
		expect(tableNames).not.toContain("table_3");
		expect(tableNames).not.toContain("table_4");

		// Verify applied count
		const statuses = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});
		const appliedCount = statuses.filter((s) => s.status === "applied").length;
		expect(appliedCount).toBe(2);

		db.close();
	});

	test("preserves migration state across sessions", async () => {
		cleanupDb();
		await setupMigrationsDir();

		createMigration(
			"20231207_120000",
			"create_users",
			`CREATE TABLE users (id INTEGER PRIMARY KEY);`,
			`DROP TABLE users;`
		);

		// Session 1: Apply migration
		let db = new Database(TEMP_DB);
		let adapter = createSqliteAdapter(db);

		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		let statuses = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});
		expect(statuses[0]?.status).toBe("applied");

		db.close();

		// Session 2: Check status without applying again
		db = new Database(TEMP_DB);
		adapter = createSqliteAdapter(db);

		statuses = await status(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
		});

		expect(statuses[0]?.status).toBe("applied");
		expect(statuses[0]?.appliedAt).toBeDefined();

		db.close();
	});

	test("handles idempotent up (running up twice applies only new migrations)", async () => {
		cleanupDb();
		await setupMigrationsDir();

		createMigration(
			"20231207_120000",
			"create_users",
			`CREATE TABLE users (id INTEGER PRIMARY KEY);`,
			`DROP TABLE users;`
		);

		const db = new Database(TEMP_DB);
		const adapter = createSqliteAdapter(db);

		// Apply migration
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		let migrations = db.prepare("SELECT COUNT(*) as count FROM __migrations__").all() as { count: number }[];
		expect(migrations[0]?.count).toBe(1);

		// Apply again - should not re-apply
		await up(adapter, {
			migrationsPath: TEMP_MIGRATIONS_DIR,
			dialect: "sqlite",
			verbose: false,
		});

		migrations = db.prepare("SELECT COUNT(*) as count FROM __migrations__").all() as { count: number }[];
		expect(migrations[0]?.count).toBe(1);

		db.close();
	});
});
