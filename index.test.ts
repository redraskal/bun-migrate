import { expect, test } from "bun:test";
import Database from "bun:sqlite";
import { up, down, status, withoutComments, createSqliteAdapter, loadMigrations } from ".";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const TEMP_MIGRATIONS_DIR = "/tmp/bun-migrate-test";

async function setupMigrationsDir() {
	rmSync(TEMP_MIGRATIONS_DIR, { recursive: true, force: true });
	mkdirSync(TEMP_MIGRATIONS_DIR, { recursive: true });
}

async function createMigration(version: string, name: string, upSql: string, downSql?: string) {
	const content = downSql !== undefined ? `${upSql}\n-- migration: down\n${downSql}` : upSql;
	writeFileSync(join(TEMP_MIGRATIONS_DIR, `${version}_${name}.sql`), content);
}

test("up() apply migrations", async () => {
	const database = new Database();
	const adapter = createSqliteAdapter(database);
	await setupMigrationsDir();
	await createMigration(
		"20231207_120000",
		"create_accounts",
		`
			CREATE TABLE accounts (
				id INTEGER PRIMARY KEY,
				username TEXT,
				password TEXT
			);
		`,
		`DROP TABLE accounts;`
	);

	await up(adapter, {
		migrationsPath: TEMP_MIGRATIONS_DIR,
		verbose: false,
	});

	const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
	expect(tables.map((t: any) => t.name)).toContain("accounts");
});

test("down() rollback migrations", async () => {
	const database = new Database();
	const adapter = createSqliteAdapter(database);
	await setupMigrationsDir();
	await createMigration(
		"20231207_120000",
		"create_accounts",
		`
			CREATE TABLE accounts (
				id INTEGER PRIMARY KEY,
				username TEXT
			);
		`,
		`DROP TABLE accounts;`
	);

	await up(adapter, {
		migrationsPath: TEMP_MIGRATIONS_DIR,
		verbose: false,
	});

	await down(adapter, 1, {
		migrationsPath: TEMP_MIGRATIONS_DIR,
		verbose: false,
	});

	const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
	expect(tables.map((t: any) => t.name)).not.toContain("accounts");
});

test("status() returns migration status", async () => {
	const database = new Database();
	const adapter = createSqliteAdapter(database);
	await setupMigrationsDir();
	await createMigration(
		"20231207_120000",
		"create_accounts",
		`CREATE TABLE accounts (id INTEGER PRIMARY KEY);`,
		`DROP TABLE accounts;`
	);
	await createMigration(
		"20231207_120001",
		"create_users",
		`CREATE TABLE users (id INTEGER PRIMARY KEY);`,
		`DROP TABLE users;`
	);

	// Check status before applying
	let statuses = await status(adapter, {
		migrationsPath: TEMP_MIGRATIONS_DIR,
	});
	expect(statuses[0].status).toBe("pending");
	expect(statuses[1].status).toBe("pending");

	// Apply migrations
	await up(adapter, {
		migrationsPath: TEMP_MIGRATIONS_DIR,
		verbose: false,
	});

	// Check status after applying
	statuses = await status(adapter, {
		migrationsPath: TEMP_MIGRATIONS_DIR,
	});

	expect(statuses.length).toBe(2);
	expect(statuses[0].status).toBe("applied");
	expect(statuses[1].status).toBe("applied");
});

// prettier-ignore
test("withoutComments() removes comments", async () => {
	const filtered = withoutComments(`
		# test comment!!! :D
		create table test (
			thing, #esd8yr9fy8s90dfy
			other_thing # !!!!!!!!11111
			#apple
		);
		# test #
		create table ice_cream (
			flavor
		);
	`);

	expect(filtered).toBe(`
		
		create table test (
			thing, 
			other_thing 
			
		);
		
		create table ice_cream (
			flavor
		);
	`);
});

test("loadMigrations() scans migration files from directory", async () => {
	const migrations = loadMigrations("./migrate_test");

	expect(migrations.length).toBe(3);
	expect(migrations[0].version).toBe("20231207_120000");
	expect(migrations[0].name).toBe("create_accounts");
	expect(migrations[0].up).toContain("CREATE TABLE accounts");
	expect(migrations[0].down).toContain("DROP TABLE accounts");

	expect(migrations[1].version).toBe("20231207_120001");
	expect(migrations[1].name).toBe("create_users");

	expect(migrations[2].version).toBe("20231207_120002");
	expect(migrations[2].name).toBe("create_posts");
	expect(migrations[2].up).toContain("CREATE TABLE posts");
	expect(migrations[2].up).not.toContain("# Add posts");
	expect(migrations[2].up).not.toContain("# Create index");
});
