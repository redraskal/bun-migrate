import Database from "bun:sqlite";
import KV from "bun-kv";
import { exists, readdir } from "node:fs/promises";
import { join } from "node:path";

const decoder = new TextDecoder();

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

	constructor(database: Database, path?: string, log?: boolean) {
		this.#database = database;
		this.#kv = new KV(database, "migrations");
		this.path = path || "./migrations";
		this.log = log || true;
	}

	async get() {
		if (!(await exists(this.path))) return [];
		const filenames = await readdir(this.path);
		return await Promise.all(
			filenames.map(async (filename) => {
				// https://github.com/oven-sh/bun/issues/2982
				const file = Bun.file(join(this.path, filename));
				const reader = await file.stream().getReader().read();
				return {
					id: Number(filename.split(".")[0]),
					filename: filename,
					content: decoder.decode(reader.value),
				} as Migration;
			})
		);
	}

	apply(migration: Migration) {
		this.#database.transaction(() => {
			const queries = migration.content.split(";");
			for (let i = 0; i < queries.length; i++) {
				let query = queries[i]
					.trim()
					.split("\n")
					.filter((line) => !line.startsWith("#"))
					.join("\n");
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
		return Number(this.#kv.get("last")) || -1;
	}

	async run() {
		const migrations = await this.get();
		if (migrations.length == 0) return false;
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
		return true;
	}

	static async run(database: Database, path?: string, log?: boolean) {
		return await new Migrations(database, path, log).run();
	}
}
