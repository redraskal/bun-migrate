# bun-migrate

A database-agnostic SQLite/PostgreSQL/MySQL migration system for Bun, inspired by `sql-migrate`.

## Install

```bash
bun i redraskal/bun-migrate#main
```

## Migration File Format

Migrations use timestamped filenames with up/down SQL:

```bash
20231207_120000_create_accounts.sql
20231207_120001_add_users_table.sql
```

Each migration file contains:

- **Up migration** (required): SQL to apply the migration
- **Down migration** (optional): SQL to rollback the migration, separated by `-- migration: down`

Example migration file:

```sql
CREATE TABLE accounts (
	id INTEGER PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	password TEXT NOT NULL
);

-- migration: down
DROP TABLE accounts;
```

## Usage

### SQLite

```typescript
import Database from "bun:sqlite";
import { up, down, status, createSqliteAdapter } from "bun-migrate";

const db = new Database("app.db");
const adapter = createSqliteAdapter(db);

// Apply pending migrations
await up(adapter, {
	migrationsPath: "./migrations",
	verbose: true,
});

// Check migration status
const statuses = await status(adapter, {
	migrationsPath: "./migrations",
});

// Rollback migrations
await down(adapter, 1, {
	migrationsPath: "./migrations",
	verbose: true,
});
```

### PostgreSQL

```typescript
import { createPostgresAdapter } from "bun-migrate";

const client = /* your postgres client */;
const adapter = createPostgresAdapter(client);

await up(adapter, {
	migrationsPath: "./migrations",
	dialect: "postgres",
	verbose: true,
});
```

### Custom Database

```typescript
import { createGenericAdapter } from "bun-migrate";

const db = /* your database */;
const adapter = createGenericAdapter(db);

await up(adapter, {
	migrationsPath: "./migrations",
	dialect: "mysql",
	verbose: true,
});
```

## API

### `up(adapter, options?)`

Applies all pending migrations in order.

**Options:**

- `migrationsPath`: Path to migrations folder (default: `./migrations`)
- `dialect`: Database dialect - `"sqlite"` | `"postgres"` | `"mysql"` (default: `"sqlite"`)
- `verbose`: Log migration progress (default: `true`)

### `down(adapter, steps, options?)`

Rolls back the last `steps` applied migrations.

**Parameters:**

- `steps`: Number of migrations to rollback (default: `1`)

**Options:**

- `migrationsPath`: Path to migrations folder (default: `./migrations`)
- `dialect`: Database dialect (default: `"sqlite"`)
- `verbose`: Log rollback progress (default: `true`)

### `status(adapter, options?)`

Returns status of all available migrations.

**Returns:** Array of `MigrationStatus` objects:

```typescript
{
	version: string; // Migration version (e.g., "20231207_120000")
	name: string; // Migration name
	appliedAt: string | null; // When applied, or null if pending
	status: "applied" | "pending";
}
```

## Adapters

### `createSqliteAdapter(database)`

Creates an adapter for Bun's SQLite database.

### `createPostgresAdapter(client)`

Creates an adapter for PostgreSQL clients.

### `createGenericAdapter(database)`

Creates an adapter for any database with `exec`, `query`, `prepare`, or `run` methods.

## 4. Apply your migrations

```ts
import Database from "bun:sqlite";
import { migrate, migrations } from "bun-migrate";

const db = new Database("bun.sqlite");

await migrate(db);
// "🌩️ Running migrations..."
// "    ⚡ 1.initial.sql"
// "    ⚡ 2.create_accounts.sql"
// ...

// or specify a folder
await migrate(db, {
	migrations: "./cool_migrations",
});

const files = await migrations("./cool_migrations");
console.log(files);
/**
 * [
 * 	{
 * 		id: 1,
 * 		name: "1.initial.sql",
 * 		content: "CREATE TABLE..."
 * 	},
 * 	...
 * ]
 */
```

This project was created using `bun init` in bun v0.6.15. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
