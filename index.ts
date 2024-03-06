import Database from "bun:sqlite";
import KV from "bun-kv";
import { exists, readdir } from "node:fs/promises";
import { join } from "node:path";

export type Migration = {
	id: number;
	name: string;
	content: string;
};

export type MigrateOptions = {
	migrations: string | Migration[];
	log?: boolean;
};

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

export async function migrations(path: string) {
	if (!(await exists(path))) return [];

	const filenames = await readdir(path);

	return await Promise.all(
		filenames.map(async (filename) => {
			const file = Bun.file(join(path, filename));

			return {
				id: Number(filename.split(".")[0]),
				name: filename,
				content: withoutComments(await file.text()),
			} as Migration;
		})
	);
}

export async function migrate(database: Database, options?: MigrateOptions) {
	const kv = new KV(database, "__migrations__");
	let last = Number(kv.get("last")) || -1;

	if (!options) {
		options = {
			migrations: await migrations("./migrations"),
			log: true,
		};
	}

	if (typeof options.migrations === "string") {
		options.migrations = await migrations(options.migrations);
	}

	if (options.migrations.length == 0) return;

	if (options.log) {
		console.log("🌩️ Running migrations...");
	}

	database.transaction((migrations: Migration[], log?: boolean) => {
		for (let i = 0; i < migrations.length; i++) {
			const migration = migrations[i];

			if (migration.id > last) {
				if (log) {
					console.log(`	⚡ ${migration.name}`);
				}

				database.run(migration.content);
			}
		}
	})(options.migrations, options.log);

	kv.set("last", `${options.migrations[options.migrations.length - 1].id}`);
}
