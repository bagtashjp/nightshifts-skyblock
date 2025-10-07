import sqlite from "better-sqlite3";
import sql from "sql-template-strings";

const db = new sqlite.Database('dragonballs.db');
db.pragma("foreign_keys = ON");
db.exec(sql`
	CREATE TABLE IF NOT EXISTS players (
		id INTEGER PRIMARY KEY,
		username TEXT NOT NULL,
		xuid TEXT NOT NULL,
		created_at INTEGER DEFAULT (strftime('%s','now')),
		display_name TEXT NOT NULL,
		credits INTEGER DEFAULT 0,
		tokens INTEGER DEFAULT 0,
		skyblock_id INTEGER,-- Removed NOT NULL to support circular reference
		discord_username TEXT,
		avatar_url TEXT,
		FOREIGN KEY(skyblock_id) REFERENCES skyblocks(id)
	);
	CREATE TABLE IF NOT EXISTS skyblocks (
		id INTEGER PRIMARY KEY,
		owner_id INTEGER NOT NULL, 
		grid_x INTEGER NOT NULL,
		grid_z INTEGER NOT NULL,
		upgrade_level INTEGER DEFAULT 1,
		spawn_x INTEGER DEFAULT 0
			-- Fanciness. Will still do server-side validations.
			CHECK(spawn_x >= (-10 * upgrade_level) AND spawn_x <= (10 * upgrade_level)),
		spawn_z INTEGER DEFAULT 0
			CHECK(spawn_z >= (-10 * upgrade_level) AND spawn_z <= (10 * upgrade_level)),
		spawn_y INTEGER DEFAULT 100 CHECK(spawn_y >= -64 AND spawn_y <= 319),
		FOREIGN KEY(owner_id) REFERENCES players(id),
		UNIQUE(grid_x, grid_z)
	);
	-- F*cking SQL don't support hierarchical data.
	CREATE TABLE IF NOT EXISTS skyblock_perms (
		skyblock_id INTEGER,
		player_id INTEGER,
		break_perm INTEGER DEFAULT 1,
		place_perm INTEGER DEFAULT 1,
		chest_perm INTEGER DEFAULT 1,
		doors_perm INTEGER DEFAULT 1,
		other_perm INTEGER DEFAULT 1, -- All interact events except chests and doors
		PRIMARY KEY(skyblock_id, player_id),
		FOREIGN KEY(skyblock_id) REFERENCES skyblocks(id),
		FOREIGN KEY(player_id) REFERENCES players(id)
	);
`);

export function createPlayer(id, username, xuid, displayName) {
	try {
		db.prepare(sql`
			INSERT INTO players (id, username, xuid, display_name)
			VALUES (${id}, ${username}, ${xuid}, ${displayName})
		`).run();
	} catch (err) {
		console.error("Failed to create player: ", err.message);
		throw err;
	}
}

export function createSkyblock(ownerId, gridX, gridZ) {
	try {
		const info = db.prepare(sql`
			INSERT INTO skyblocks (owner_id, grid_x, grid_z)
			VALUES (${ownerId}, ${gridX}, ${gridZ})
		`).run();

		// Inserts the skyblock into the player data.
		const skyblockId = info.lastInsertRowid;
		db.prepare(sql`
			UPDATE players
			SET skyblock_id = ${skyblockId}
			WHERE id = ${ownerId}
		`).run();
		return skyblockId;
	} catch (err) {
		console.error("Failed to create skyblock: ", err.message);
		throw err;
	}
}

export function getPerms(x, z) {
	try {
		const info = db.prepare(sql`
			SELECT * 
			FROM skyblock_perms 
			WHERE skyblock_id = (
				SELECT id 
				FROM skyblocks 
				WHERE grid_x = ${x} AND grid_z = ${z}
			);
		`).all();
		return info;
	} catch (err) {
		console.error("Failed to get skyblock permission list: ", err.message);
		throw err;
	}
}

export function addPerms(skyblockId, playerId) {
	try {
		if (db.prepare(sql`
			INSERT OR IGNORE INTO skyblock_perms (skyblock_id, player_id)
			VALUES (${skyblockId}, ${playerId})
		`).run().changes === 0) {
			throw new Error("Player already exists.");;
		}
	} catch (err) {
		console.error("Failed to add permission: ", err.message);
		throw err;
	}
}

export function deletePerms(skyblockId, playerId) {
	try {
		if (db.prepare(sql`
			DELETE FROM skyblock_perms
			WHERE skyblock_id = ${skyblockId} AND player_id = ${playerId}
		`).run().changes === 0) {
			throw new Error("Player doesn't exist.");
		} 
	} catch (err) {
		console.error("Failed to remove permission: ", err.message);
		throw err;
	}
}
export function updatePerms(skyblockId, playerId, perms) {
	try {
		/* ChatGPT sees this as security issue. IDC I'm a genius */
		if (db.prepare(sql`UPDATE skyblock_perms `
			.append(`
				SET break_perm = ${perms.break_perm ?? "break_perm"}, 
					place_perm = ${perms.place_perm ?? "place_perm"},
					chest_perm = ${perms.chest_perm ?? "chest_perm"},
					doors_perm = ${perms.doors_perm ?? "doors_perm"},
					other_perm = ${perms.other_perm ?? "other_perm"}
			`).append(sql`WHERE skyblock_id = ${skyblockId} AND player_id = ${playerId}`)
		).run().changes === 0) {
			throw new Error("Player doesn't exist or nothing has changed.");
		} 
	} catch (err) {
		console.error("Failed to update permission: ", err.message);
		throw err;
	}
}
export function rawExec(statement) {
	try {
		const info = db.exec(statement);
		return info;
	} catch (err) {
		console.error("Run failed: ", err.message);
		throw err;
	}
}
export function rawRun(statement) {
	try {
		const info = db.prepare(statement).run();
		return info;
	} catch (err) {
		console.error("Run failed: ", err.message);
		throw err;
	}
}
export function rawGet(statement) {
	try {
		const info = db.prepare(statement).get();
		return info;
	} catch (err) {
		console.error("Run failed: ", err.message);
		throw err;
	}
}
export function rawAll(statement) {
	try {
		const info = db.prepare(statement).all();
		return info;
	} catch (err) {
		console.error("Run failed: ", err.message);
		throw err;
	}
}