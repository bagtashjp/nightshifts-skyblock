import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from "dotenv";
import { db, createPlayer, createSkyblock } from "./dragon-ball.js";
import sql from '@radically-straightforward/sqlite';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== Express Setup ====
const app = express();
const PORT = process.env.PORT;

app.use(express.json());
function authMiddleware(req, res, next) {
	const auth = req.headers['authorization'];
	if (!auth) { return res.status(401).json({ error: 'Missing Authorization header' }) }
	const token = auth.replace('Bearer ', '');
	if (token !== process.env.MIDDLEWARE_TOKEN) {
		return res.status(403).json({ error: 'Invalid Authorization token' });
	}
	next();
}
app.use(authMiddleware);

app.post('/player/perms', ({ body }, res) => {
	const perms = db.all(sql`
		SELECT sp.*, sb.upgrade_level
		FROM skyblock_perms sp
		JOIN skyblocks sb ON sp.grid_id = sb.grid_id
		WHERE sp.player_id = ${body.player_id}
	`);
	parsedPerm = {};
	perms.forEach(e => {
		parsedPerm[e.grid_id] = {
			upgrade_level: e.upgrade_level,
			break_perm: !!e.break_perm,
			place_perm: !!e.place_perm,
			chest_perm: !!e.chest_perm,
			doors_perm: !!e.doors_perm,
			other_perm: !!e.other_perm
		}
	});
	res.json(parsedPerm);
});

app.post('/credit/save', ({ body }, res) => {
	db.run(sql`
		UPDATE players
		SET credits = ${ body.credits }
		WHERE player_id = ${ body.player_id }
	`);
});

app.post('/credit/saveall', ({ body }, res) => {
	const cases = body.credmap.map(e => `WHEN ${e.id} THEN ${e.credits}`).join(" ");
	const ids = body.credmap.map(e => e.id).join(", ");
	db.run(sql`
		UPDATE players
		SET credits = CASE id
			${cases}
		END
		WHERE id IN (${ids})
	`);
});

app.post('/player/new', ({body}, res) => {
	console.log(JSON.stringify(body));
	console.log(`New Player [${body.display_name}] recording to database.`);
	let confirm = createPlayer(body.player_id, body.xuid, body.display_name);
	if (confirm) {
		console.log(" ^ Recorded successfull!");
		res.sendStatus(200);
	} else {
		res.sendStatus(500);
	}
});

app.post('/player/new-skyblock', ({body}, res) => {
	console.log(`Creating Skyblock for player id: [${body.player_id}].`);
	createSkyblock(body.player_id, body.grid_id);
});


app.post('/skyblock/retrieve', ({body}, res) => {
	let data = db.get(sql`
		SELECT * FROM skyblocks
		WHERE player_id = ${body.player_id}
	`);
	data.perms = db.all(sql`
		SELECT * FROM skyblock_perms
		WHERE grid_id = ${data.grid_id}
	`)
	res.json(data);
})
app.get('/players', (req, res) => {
	const data = db.all(sql`
		SELECT id FROM players
	`);
	console.log("Passer");
	res.json(data.map(e => e.id));
});

app.get('/globals', (req, res) => {
	const data = db.get(sql`
		SELECT * FROM global_params
		WHERE id = 1
	`);
	res.json(data);
});

app.listen(PORT, () => {
	console.log(`Express listening on port ${PORT}`);
});

// ==== Logging ====
const now = new Date();
const utc = now.getTime() + now.getTimezoneOffset() * 60000;
const gmt8 = new Date(utc + 8 * 3600000);
const pad = (n) => n.toString().padStart(2, '0');
const timestamp = `${pad(gmt8.getMonth() + 1)}-${pad(gmt8.getDate())}_${pad(gmt8.getHours())}-${pad(gmt8.getMinutes())}-${pad(gmt8.getSeconds())}`;
const logFileName = `${timestamp}.txt`;
const logStream = fs.createWriteStream(path.join(__dirname, 'Logs', logFileName));


// ==== Child Process (Bedrock) ====
const executable = process.platform === 'win32'
	? 'bedrock_server.exe'
	: './bedrock_serverMC';

const child = spawn(executable, {
	cwd: __dirname,
	stdio: ['pipe', 'pipe', 'pipe']
});

child.stderr.pipe(process.stderr);
child.stderr.pipe(logStream);
process.stdin.pipe(child.stdin);

let players = [];
let xuids = [];
let playerAvatars = {};

child.stdout.on('data', (data) => {
	const log = data.toString().trim();
	if (log.includes("INFO] Player connected")) {
		let [name, xuid] = log.split("Player connected: ")[1].split(", xuid: ");
		child.stdin.write(`scriptevent nodejs:xuid ${name}\u001F${xuid}\n`);
		// 	const row = db.rawGet(sql`
		// 		SELECT avatar_url FROM players
		// 		WHERE xuid = ${xuid}
		// 	`);
		// 	let gamerpic;
		// 	if (!row) {
		// 		gamerpic = getGamerpic(name, xuid);
		// 	} else if (!row.avatar_url) {
		// 		gamerpic = getGamerpic(name, xuid);
		// 		if (gamerpic) {
		// 			db.rawRun(sql`
		// 				UPDATE players
		// 				SET avatar_url = ${gamerpic}
		// 				WHERE xuid = ${xuid}
		// 			`);
		// 		}
		// 	} else {
		// 		gamerpic = row.avatar_url;
		// 	}
		// 	players.push(name);
		// 	xuids.push(xuid);
		// 	playerAvatars[xuid] = (gamerpic);
		// }
	}
	console.log(log);
	logStream.write(log + "\n");
});


child.on('close', (code) => {
	db.close();
	console.log(`Process exited with code ${code}`);
	process.exit(0);
});

// ==== Gamerpic Function ====
async function getGamerpic(name, xuid) {
	try {
		const data = await fetch(`https://xbl.io/api/v2/account/${xuid}`, {
			headers: {
				"accept": "*/*",
				"x-authorization": process.env.XBL_AUTH
			},
		});
		const status = data.status;
		const json = await data.json();
		if (status !== 200) {
			console.error(`Status ${status}`, json);
			return;
		}
		let gamerpic = json.profileUsers[0].settings[0].value;
		child.stdin.write(`scriptevent nodejs:gamerpic ${name}\u001F${gamerpic}\u001F${xuid}\n`);
		return gamerpic;
	} catch (err) {
		console.error("HTTP Error:", err);
		child.stdin.write(`scriptevent nodejs:gamerpic ${name}\u001F${""}\u001F${xuid}\n`);
		return null
		
	}
}

// ==== Discord Bot ====
export const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('clientReady', () => {
	console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async data => {
	if (data.author.bot) return;
	if (data.channelId == "1258643956384792596") { // NightShifts SMP's #the-smp channel
		const nickname = data.member?.nickname || data.author.username;
		const message = data.content.replace(/"/g, '\\"');
		child.stdin.write(`tellraw @a {"rawtext":[{"text":"\uE030 ${nickname} §7:§r ${message}"}]}\n`);
	}
});

//client.login(process.env.BOT_TOKEN);

// Helpers
function spiralNextXZ([x, z, incr = 0, step = 1, dir = 0]) {
	switch (dir) {
		case 0: // Right
			if (incr < step) return ([++x, z, ++incr, step, dir]);
			else return spiralNextXZ([x, z, 0, step, 1]);
		case 1: // Up
			if (incr < step) return ([x, ++z, ++incr, step, dir]);
			else return spiralNextXZ([x, z, 0, ++step, 2]);
		case 2: // Left 
			if (incr < step) return ([--x, z, ++incr, step, dir]);
			else return spiralNextXZ([x, z, 0, step, 3]);
		case 3: // Down
			if (incr < step) return ([x, --z, ++incr, step, dir]);
			else return spiralNextXZ([x, z, 0, ++step, 0]);
	}
}