import Database from "bun:sqlite";
import KV from "bun-kv";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type Migration = {
	id: number;
	filename: string;
	content: string;
};

export default class Migrations {
	readonly #database: Database;
	readonly #kv: KV;
	path: string;
	log: boolean;

	constructor(database: Database, path: string, log?: boolean) {
		this.#database = database;
		this.#kv = new KV(database, "migrations");
		this.path = path;
		this.log = log || true;
	}

	async migrations() {
		const filenames = await readdir(this.path);
		return await Promise.all(
			filenames.map(async (filename) => {
				return {
					id: Number(filename.split(".")[0]),
					filename: filename,
					content: await Bun.file(join(this.path, filename)).text(),
				} as Migration;
			})
		);
	}

	apply(migration: Migration) {
		this.#database.transaction(() => {
			const queries = migration.content.split(";");
			for (let i = 0; i < queries.length; i++) {
				let query = queries[i].trim();
				if (query == "") continue;
				if (query.indexOf("BEGIN") > -1) {
					for (let end = i + 1; end < queries.length; end++) {
						if (queries[end].endsWith("END")) {
							query = queries
								.slice(i, end + 1)
								.join(";")
								.trim();
							i = end;
							break;
						}
					}
				}
				this.#database.exec(query);
			}
		})();
	}

	last() {
		return this.#kv.get("last") || -1;
	}

	async run() {
		const migrations = await this.migrations();
		const last = this.last();
		if (this.log) console.log("🌩️ Running migrations...");
		for (let i = 0; i < migrations.length; i++) {
			const migration = migrations[i];
			if (migration.id > last) {
				if (this.log) console.log(`	⚡ ${migration.filename}`);
				this.apply(migration);
			}
		}
		this.#kv.set("last", `${migrations[migrations.length - 1].id}`);
	}
}
