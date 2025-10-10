import sql, {Database} from "@radically-straightforward/sqlite";
import path from 'path';

const dbPath = path.join('worlds', 'n-world', 'dragonballs.db');
export const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma('journal_mode = WAL');
db.execute(sql`
	CREATE TABLE IF NOT EXISTS global_params (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		spiral_x INTEGER DEFAULT 2,
		spiral_z INTEGER DEFAULT -1,
		spiral_inc INTEGER DEFAULT 3,
		spiral_step INTEGER DEFAULT 3,
		spiral_dir INTEGER DEfAULT 0
	);
	CREATE TABLE IF NOT EXISTS players (
		id TEXT PRIMARY KEY,
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
		owner_id TEXT NOT NULL, 
		grid_id INTEGER NOT NULL,
		upgrade_level INTEGER DEFAULT 1,
		spawn_x INTEGER DEFAULT 0
			-- For fanciness. Will still do server-side validations.
			CHECK(spawn_x >= (-10 * upgrade_level) AND spawn_x <= (10 * upgrade_level)),
		spawn_z INTEGER DEFAULT 0
			CHECK(spawn_z >= (-10 * upgrade_level) AND spawn_z <= (10 * upgrade_level)),
		spawn_y INTEGER DEFAULT 100 CHECK(spawn_y >= -64 AND spawn_y <= 319),
		FOREIGN KEY(owner_id) REFERENCES players(id)
	);
	-- F*cking SQL don't support hierarchical data.
	CREATE TABLE IF NOT EXISTS skyblock_perms (
		player_id TEXT,
		grid_id INTEGER,
		break_perm INTEGER DEFAULT 1,
		place_perm INTEGER DEFAULT 1,
		chest_perm INTEGER DEFAULT 1,
		doors_perm INTEGER DEFAULT 1,
		other_perm INTEGER DEFAULT 1, -- All interact events except chests and doors
		PRIMARY KEY(player_id, grid_id),
		FOREIGN KEY(grid_id) REFERENCES skyblocks(grid_id) ON UPDATE CASCADE
		FOREIGN KEY(player_id) REFERENCES players(id)
	);
	INSERT OR IGNORE INTO global_params(id)
	VALUES (1);
`);

export function createPlayer(id, xuid, displayName) {
	try {
		db.run(sql`
			INSERT INTO players (id, xuid, display_name)
			VALUES (${id}, ${xuid}, ${displayName})
		`);
		return true;
	} catch (err) {
		console.error("Failed to create player: ", err.message);
		return false;
	}
}

export function createSkyblock(ownerId, gridId) {
	try {
		const info = db.run(sql`
			INSERT INTO skyblocks (owner_id, grid_id)
			VALUES (${ownerId}, ${gridId})
		`);
		// Inserts the skyblock into the player data.
		const skyblockId = info.lastInsertRowid;
		db.run(sql`
			UPDATE players
			SET skyblock_id = ${skyblockId}
			WHERE id = ${ownerId}
		`);
		return true;
	} catch (err) {
		console.error("Failed to create skyblock: ", err.message);
		return false;
	}
}

export function getPerms(x, z) {
	try {
		const info = db.all(sql`
			SELECT * 
			FROM skyblock_perms 
			WHERE skyblock_id = (
				SELECT id 
				FROM skyblocks 
				WHERE grid_x = ${x} AND grid_z = ${z}
			);
		`);
		return info;
	} catch (err) {
		console.error("Failed to get skyblock permission list: ", err.message);
		throw err;
	}
}

export function addPerms(skyblockId, playerId) {
	try {
		if (db.run(sql`
			INSERT OR IGNORE INTO skyblock_perms (skyblock_id, player_id)
			VALUES (${skyblockId}, ${playerId})
		`).changes === 0) {
			throw new Error("Player already exists.");;
		}
	} catch (err) {
		console.error("Failed to add permission: ", err.message);
		throw err;
	}
}

export function deletePerms(skyblockId, playerId) {
	try {
		if (db.run(sql`
			DELETE FROM skyblock_perms
			WHERE skyblock_id = ${skyblockId} AND player_id = ${playerId}
		`).changes === 0) {
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
		if (db.run(sql`UPDATE skyblock_perms `
			.append(`
				SET break_perm = ${perms.break_perm ?? "break_perm"}, 
					place_perm = ${perms.place_perm ?? "place_perm"},
					chest_perm = ${perms.chest_perm ?? "chest_perm"},
					doors_perm = ${perms.doors_perm ?? "doors_perm"},
					other_perm = ${perms.other_perm ?? "other_perm"}
			`).append(sql`WHERE skyblock_id = ${skyblockId} AND player_id = ${playerId}`)
		).changes === 0) {
			throw new Error("Player doesn't exist or nothing has changed.");
		} 
	} catch (err) {
		console.error("Failed to update permission: ", err.message);
		throw err;
	}
}
export function rawExec(statement) {
	try {
		const info = db.execute(statement);
		return info;
	} catch (err) {
		console.error("Run failed: ", err.message);
		throw err;
	}
}