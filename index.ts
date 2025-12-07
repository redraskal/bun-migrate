import { existsSync, readdirSync, readFileSync } from "fs";

export type Migration = {
	version: string;
	name: string;
	up: string;
	down: string;
};

export type MigrateOptions = {
	migrationsPath?: string;
	verbose?: boolean;
};

export type MigrationStatus = {
	version: string;
	name: string;
	appliedAt: string | null;
	status: "applied" | "pending";
};

// Database adapter interface for database-agnostic support
export interface DatabaseAdapter {
	exec(sql: string): void | Promise<void>;
	prepare(sql: string): {
		all(...params: any[]): any[] | Promise<any[]>;
		run(...params: any[]): void | Promise<void>;
	};
	transaction(fn: () => void): () => void | Promise<void>;
}

// SQLite adapter
export function createSqliteAdapter(database: any): DatabaseAdapter {
	return {
		exec: (sql: string) => database.exec(sql),
		prepare: (sql: string) => database.prepare(sql),
		transaction: (fn: () => void) => () => database.transaction(fn)(),
	};
}

// PostgreSQL adapter
export function createPostgresAdapter(sql: any): DatabaseAdapter {
	return {
		exec: async (sql_text: string) => {
			await sql.unsafe(sql_text);
		},
		prepare: (sql_text: string) => ({
			all: async (...params: any[]) => {
				const result = await sql.unsafe(sql_text, params);
				return Array.isArray(result) ? result : [];
			},
			run: async (...params: any[]) => {
				await sql.unsafe(sql_text, params);
			},
		}),
		transaction: (fn: () => void) => async () => {
			await sql.begin(async (trx: any) => {
				fn();
			});
		},
	};
}

// Generic adapter for any database with query/run methods
export function createGenericAdapter(database: any): DatabaseAdapter {
	const isAsync = database.query && database.query.constructor.name === "AsyncFunction";

	return {
		exec: async (sql: string) => {
			if (database.query) {
				await database.query(sql);
			} else if (database.exec) {
				database.exec(sql);
			} else {
				throw new Error("Database adapter must have query or exec method");
			}
		},
		prepare: (sql: string) => ({
			all: async (...params: any[]) => {
				if (database.query) {
					const [rows] = await database.query(sql, params);
					return Array.isArray(rows) ? rows : [];
				} else if (database.prepare) {
					return database.prepare(sql).all(...params);
				}
				return [];
			},
			run: async (...params: any[]) => {
				if (database.query) {
					await database.query(sql, params);
				} else if (database.prepare) {
					database.prepare(sql).run(...params);
				}
			},
		}),
		transaction: (fn: () => void) => async () => {
			if (database.query) {
				await database.query("START TRANSACTION");
				try {
					fn();
					await database.query("COMMIT");
				} catch (error) {
					await database.query("ROLLBACK");
					throw error;
				}
			} else {
				fn();
			}
		},
	};
}

const MIGRATIONS_TABLE = "__migrations__";

function initializeMigrationsTable(adapter: DatabaseAdapter, dialect: "sqlite" | "postgres" | "mysql" = "sqlite") {
	let createTableSql = "";

	if (dialect === "postgres") {
		createTableSql = `
			CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
				version TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
		`;
	} else if (dialect === "mysql") {
		createTableSql = `
			CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
				version VARCHAR(255) PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
		`;
	} else {
		// SQLite
		createTableSql = `
			CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
				version TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
		`;
	}

	const result = adapter.exec(createTableSql);
	if (result instanceof Promise) {
		throw new Error("Async exec not supported in synchronous context. Use async functions or sync adapters.");
	}
}

export function withoutComments(str: String) {
	let result = "";
	let omit = false;
	let char: string;

	for (let i = 0; i < str.length; i++) {
		char = str.charAt(i);

		if (char == "#") {
			omit = true;
		} else if (char == "\n") {
			omit = false;
		}

		if (!omit) {
			result += char;
		}
	}

	return result;
}

export function loadMigrations(path: string): Migration[] {
	if (!existsSync(path)) return [];

	const filenames = readdirSync(path);
	const migrations: Migration[] = [];

	for (const filename of filenames.sort()) {
		if (!filename.endsWith(".sql")) continue;

		const content = readFileSync(`${path}/${filename}`, "utf-8");

		// Parse migration file: split by -- migration:down marker
		const parts = content.split(/--\s*migration:\s*down\s*/i);
		const up = withoutComments(parts[0]).trim();
		const down = parts[1] ? withoutComments(parts[1]).trim() : "";

		// Extract version from filename (e.g., 20231207_120000_create_users.sql)
		const match = filename.match(/^(\d+_\d+)_(.+)\.sql$/);
		if (!match) continue;

		const [, version, name] = match;

		migrations.push({
			version,
			name,
			up,
			down,
		});
	}

	return migrations;
}

export async function up(
	adapter: DatabaseAdapter,
	options: MigrateOptions & { dialect?: "sqlite" | "postgres" | "mysql" } = {}
) {
	const migrationsPath = options.migrationsPath || "./migrations";
	const verbose = options.verbose !== false;
	const dialect = options.dialect || "sqlite";

	initializeMigrationsTable(adapter, dialect);

	const availableMigrations = loadMigrations(migrationsPath);
	const prepared = adapter.prepare(`SELECT version FROM ${MIGRATIONS_TABLE}`);
	const allRows = await Promise.resolve(prepared.all());
	const appliedVersions = new Set((allRows as Array<{ version: string }>).map((row) => row.version));

	const pending = availableMigrations.filter((m) => !appliedVersions.has(m.version));

	if (pending.length === 0) {
		if (verbose) console.log("✓ No pending migrations");
		return;
	}

	if (verbose) console.log(`📤 Applying ${pending.length} migration(s)...`);

	for (const migration of pending) {
		try {
			const txn = adapter.transaction(() => {
				adapter.exec(migration.up);
				const stmt = adapter.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (version, name) VALUES (?, ?)`);
				stmt.run(migration.version, migration.name);
			});
			await Promise.resolve(txn());

			if (verbose) {
				console.log(`  ✓ ${migration.version} - ${migration.name}`);
			}
		} catch (error) {
			console.error(`  ✗ ${migration.version} - ${migration.name}: ${error}`);
			throw error;
		}
	}

	if (verbose) console.log("✓ Migrations applied successfully");
}

export async function down(
	adapter: DatabaseAdapter,
	steps: number = 1,
	options: MigrateOptions & { dialect?: "sqlite" | "postgres" | "mysql" } = {}
) {
	const migrationsPath = options.migrationsPath || "./migrations";
	const verbose = options.verbose !== false;
	const dialect = options.dialect || "sqlite";

	initializeMigrationsTable(adapter, dialect);

	const availableMigrations = loadMigrations(migrationsPath);
	const prepared = adapter.prepare(`SELECT version, name FROM ${MIGRATIONS_TABLE} ORDER BY version DESC LIMIT ?`);
	const appliedRows = await Promise.resolve(prepared.all(steps));
	const appliedMigrations = appliedRows as Array<{ version: string; name: string }>;

	if (appliedMigrations.length === 0) {
		if (verbose) console.log("✓ No migrations to rollback");
		return;
	}

	if (verbose) console.log(`📥 Rolling back ${appliedMigrations.length} migration(s)...`);

	for (const applied of appliedMigrations) {
		const migration = availableMigrations.find((m) => m.version === applied.version);
		if (!migration || !migration.down) {
			throw new Error(`Cannot rollback ${applied.version}: down migration not defined`);
		}

		try {
			const txn = adapter.transaction(() => {
				adapter.exec(migration.down);
				adapter.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`).run(migration.version);
			});
			await Promise.resolve(txn());

			if (verbose) {
				console.log(`  ✓ ${migration.version} - ${migration.name}`);
			}
		} catch (error) {
			console.error(`  ✗ ${migration.version} - ${migration.name}: ${error}`);
			throw error;
		}
	}

	if (verbose) console.log("✓ Rollback completed successfully");
}

export async function status(
	adapter: DatabaseAdapter,
	options: MigrateOptions & { dialect?: "sqlite" | "postgres" | "mysql" } = {}
): Promise<MigrationStatus[]> {
	const migrationsPath = options.migrationsPath || "./migrations";
	const dialect = options.dialect || "sqlite";

	initializeMigrationsTable(adapter, dialect);

	const availableMigrations = loadMigrations(migrationsPath);
	const prepared = adapter.prepare(`SELECT version, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY applied_at`);
	const appliedRows = await Promise.resolve(prepared.all());
	const typedRows = appliedRows as Array<{ version: string; applied_at: string }>;

	const appliedMap = new Map(typedRows.map((row) => [row.version, row.applied_at]));

	const statuses: MigrationStatus[] = availableMigrations.map((m) => ({
		version: m.version,
		name: m.name,
		appliedAt: appliedMap.get(m.version) || null,
		status: appliedMap.has(m.version) ? "applied" : "pending",
	}));

	return statuses;
}
