#!/usr/bin/env node
/**
 * scripts/cleanup.cjs
 *
 * Solo mata (con taskkill /T /F) los PID registrados en scratch/.pids.json.
 * NUNCA mata procesos por nombre de imagen (electron.exe / node.exe) ni por puerto.
 * Con --list muestra qué mataría sin matar nada.
 */

const {
  PIDS_FILE,
  readPidsMap,
  writePidsMap,
  isPidAlive,
  killPidTree,
} = require('./lib/testenv.cjs');

const isListOnly = process.argv.includes('--list');
const map = readPidsMap();
const entries = Object.values(map).filter(
  (it) => it && it.pid && Number(it.pid) !== process.pid && Number(it.pid) !== process.ppid
);

const aliveEntries = [];
const deadPids = [];

for (const entry of entries) {
  if (isPidAlive(entry.pid)) {
    aliveEntries.push(entry);
  } else {
    deadPids.push(entry.pid);
  }
}

if (isListOnly) {
  if (aliveEntries.length === 0) {
    console.log(`[cleanup --list] 0 procesos activos registrados en ${PIDS_FILE}.`);
  } else {
    console.log(`[cleanup --list] Mataría ${aliveEntries.length} PID(s) registrados en ${PIDS_FILE}:`);
    for (const item of aliveEntries) {
      console.log(
        `  - PID ${item.pid} (${item.role || item.cmd || 'test'}) ${item.port ? `port=${item.port}` : ''} ${item.room ? `room=${item.room}` : ''}`.trim()
      );
    }
  }
  process.exit(0);
}

// Limpiar entradas ya muertas
for (const pid of deadPids) {
  delete map[String(pid)];
}
writePidsMap(map);

let killedCount = 0;
for (const item of aliveEntries) {
  if (killPidTree(item.pid)) {
    killedCount++;
    console.log(`[cleanup] Árbol de proceso eliminado: PID ${item.pid} (${item.role || 'test'})`);
  }
}

console.log(`[cleanup] Listo (${killedCount} PID(s) terminados de scratch/.pids.json).`);
process.exit(0);
