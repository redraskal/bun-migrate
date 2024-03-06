import { expect, test } from "bun:test";
import Database from "bun:sqlite";
import { Migration, migrate, withoutComments } from ".";

test("migrate() create table", async () => {
	const database = new Database();
	const migrations: Migration[] = [
		{
			id: 0,
			name: "create_accounts",
			content: `
				create table accounts (
					username,
					display_name,
					password
				);
			`,
		},
	];
	await migrate(database, {
		migrations,
		log: false,
	});
});

// prettier-ignore
test("migrate() using withoutComments()", async () => {
	const database = new Database();
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

	await migrate(database, {
		migrations: [{
			id: 0,
			name: "stuff",
			content: filtered,
		}],
		log: false,
	});
});
