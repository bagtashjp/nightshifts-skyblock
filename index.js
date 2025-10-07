import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== Express Setup ====
const app = express();
const PORT = process.env.PORT;

app.use(express.json());

// Example API route
app.get('/', (req, res) => {
  res.send('Express server is running 🚀');
});


let players = [];
app.get('/players', (req, res) => {
  res.json({ players });
});

app.listen(PORT, () => {
  console.log(`Express listening on port ${PORT}`);
});

// ==== Logging ====
const now = new Date();
const utc = now.getTime() + now.getTimezoneOffset() * 60000;
const gmt8 = new Date(utc + 8 * 3600000);
const pad = (n) => n.toString().padStart(2, '0');
const timestamp = `${pad(gmt8.getMonth()+1)}-${pad(gmt8.getDate())}_${pad(gmt8.getHours())}-${pad(gmt8.getMinutes())}-${pad(gmt8.getSeconds())}`;
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

child.stdout.on('data', (data) => {
  const log = data.toString().trim();
  if (log.includes("INFO] Player connected")) {
    let [name, xuid] = log.split("Player connected: ")[1].split(", xuid: ");
    if (!players.includes(name)) {
      getGamerpic(name, xuid);
      players.push(name);
    }
  }
  console.log(log);
  logStream.write(log + "\n");
});


child.on('close', (code) => {
  console.log(`Process exited with code ${code}`);
  process.exit(0);
});

// ==== Gamerpic Function ====
async function getGamerpic(name, xuid) {
  try {
    const data = await fetch(`https://xbl.io/api/v2/account/${xuid}`, {
      headers: {
        "accept": "*/*",
        "x-authorization": "44062de4-5116-4552-b59d-5ecd2a367f93"
      },
    });
    const status = data.status;
    const json = await data.json();
    if (status !== 200) {
      console.error(`Status ${status}`, json);
      return;
    }
    let gamerpic = json.profileUsers[0].settings[0].value;
    child.stdin.write(`scriptevent nodejs:gamerpic ${name}\u001F${gamerpic}\n`);
  } catch (err) {
    console.error("HTTP Error:", err);
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

client.login(process.env.BOT_TOKEN);

// Helpers
function spiralNextXZ([x, z, incr=0, step=1, dir=0]) {
  switch (dir) {
    case 0: // Right
      if (incr < step) return ([++x,    z,  ++incr,   step,   dir]);
      else return spiralNextXZ([  x,    z,    0,      step,   1]);
    case 1: // Up
      if (incr < step) return ([  x,  ++z,  ++incr,   step,   dir]);
      else return spiralNextXZ([  x,    z,    0,    ++step,   2]);
    case 2: // Left 
      if (incr < step) return ([--x,    z,  ++incr,   step,   dir]);
      else return spiralNextXZ([  x,    z,    0,      step,   3]);
    case 3: // Down
      if (incr < step) return ([  x,  --z,  ++incr,   step,   dir]);
      else return spiralNextXZ([  x,    z,    0,    ++step,   0]);
  }
}