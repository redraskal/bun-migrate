# bun-migrate

A simple SQLite file-based migration system for Bun.

## 1. Install

```bash
bun i redraskal/bun-migrate#main
```

## 2. Pick a migrations folder

Choose a folder name, or use a default "migrations" folder in your project.

## 3. Add your first migration

Create a file in your migrations folder with the following name:

```bash
1.{name}.sql # Example: 1.initial.sql
```

Future migrations should have an incrementing or sequential id sequence.

Example:

- 1.initial.sql
- 2.create_accounts.sql
- 6.banana.sql

## 4. Apply your migrations

```ts
import Database from "bun:sqlite";
import Migrations from "bun-migrate";

const database = new Database("bun.sqlite");

// run migrations on ./migrations/...
await Migrations.run(database); // true
// "🌩️ Running migrations..."
// "    ⚡ 1.initial.sql"
// "    ⚡ 2.create_accounts.sql"
// ...

// or specify a folder
await Migrations.run(database, "./cool_migrations"); // true

// you can also access the class for additional methods
const migrations = new Migrations(database, "./cool_migrations", false);
// i disabled logging with the third parameter

const files = await migrations.get();
console.log(files);
/**
 * [
 * 	{
 * 		id: 1,
 * 		filename: "1.initial.sql",
 * 		content: "CREATE TABLE..."
 * 	},
 * 	...
 * ]
 */

// apply a single migration
files[0].apply();

// retrieve the last migration's id
migrations.last(); // 1

// run all migrations
await migrations.run(); // true
```

This project was created using `bun init` in bun v0.6.15. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
