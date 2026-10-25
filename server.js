'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const TEAM_DATABASE = require('./team-data.json');

const PORT = Number(process.env.PORT || 10000);
const STATE_KEY = 'gincana-4x0:rooms:v1';
const MAX_PLAYERS = 16;
const STAGES = ['oitavas', 'quartas', 'semi', 'final'];
const rooms = new Map();
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
app.get('/online.js', (_req, res) => res.sendFile(path.join(__dirname, 'online.js')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((_req, res) => res.status(404).send('Página não encontrada.'));
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 25000, pingTimeout: 20000 });
let redis = null;
let persistQueue = Promise.resolve();
if (process.env.REDIS_URL) {
  redis = createClient({ url: process.env.REDIS_URL });
  redis.on('error', (err) => console.error('[redis]', err.message));
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 48);
}
function int(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback == null ? min : fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function findPlayerRoom(playerId) {
  for (const room of rooms.values()) if (room.players[playerId]) return room;
  return null;
}
function serializedRoom(room) {
  const copy = JSON.parse(JSON.stringify(room));
  Object.values(copy.players || {}).forEach((player) => {
    player.socketId = null;
    player.connected = false;
  });
  return copy;
}
function persistRooms() {
  if (!redis || !redis.isReady) return Promise.resolve();
  const snapshot = JSON.stringify([...rooms.values()].map(serializedRoom));
  persistQueue = persistQueue.catch(() => undefined)
    .then(() => redis.set(STATE_KEY, snapshot))
    .catch((err) => console.error('[persist]', err.message));
  return persistQueue;
}
function touch(room) { room.updatedAt = Date.now(); }
function publicRoomState(room) {
  const players = Object.values(room.players).sort((a, b) => a.joinOrder - b.joinOrder);
  const readyCount = players.filter((p) => Boolean(p.roster)).length;
  return {
    code: room.code, hostId: room.hostId, phase: room.phase,
    currentStage: room.tournament ? room.tournament.stage : null,
    playerCount: players.length, maxPlayers: MAX_PLAYERS, readyCount,
    canStart: players.length >= 2 && readyCount === players.length && ['lobby', 'drafting'].includes(room.phase),
    players: players.map((p) => ({
      id: p.id, name: p.name, connected: Boolean(p.connected), ready: Boolean(p.roster),
      status: p.roster ? 'ELENCO PRONTO' : (p.status === 'montando' ? 'MONTANDO ELENCO' : 'NA SALA')
    }))
  };
}
function publicParticipant(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.name, teamName: p.teamName, displayName: p.displayName,
    isHuman: Boolean(p.isHuman), isBot: Boolean(p.isBot), ovr: p.ovr,
    squad: p.squad, captainPlayerId: p.captainPlayerId, formationKey: p.formationKey, mode: p.mode
  };
}
function publicTournamentState(room) {
  const t = room.tournament;
  if (!t) return null;
  const stages = {};
  STAGES.forEach((stage) => {
    if (!t.stages[stage]) return;
    stages[stage] = t.stages[stage].map((m) => ({
      id: m.id, stage: m.stage, index: m.index,
      teamA: publicParticipant(t.participants[m.teamAId]),
      teamB: publicParticipant(t.participants[m.teamBId]),
      controllerId: m.controllerId, played: Boolean(m.played),
      scoreA: m.scoreA, scoreB: m.scoreB, penaltyScoreA: m.penaltyScoreA,
      penaltyScoreB: m.penaltyScoreB, winnerId: m.winnerId,
      winnerName: m.winnerId ? (t.participants[m.winnerId].displayName || '') : '',
      timeline: m.timeline || [], playedBy: m.playedBy || null
    }));
  });
  return {
    roomCode: room.code, phase: t.phase, stage: t.stage, stages,
    participants: Object.values(t.participants).map(publicParticipant),
    championId: t.championId || null,
    champion: t.championId ? publicParticipant(t.participants[t.championId]) : null
  };
}
function broadcastRoom(room) {
  touch(room);
  io.to(room.code).emit('room:state', publicRoomState(room));
  void persistRooms();
}
function broadcastTournament(room) {
  touch(room);
  io.to(room.code).emit('tournament:state', publicTournamentState(room));
  io.to(room.code).emit('room:state', publicRoomState(room));
  void persistRooms();
}
function cleanTeamPool(pool) {
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return null;
  const result = {};
  Object.entries(pool).slice(0, 50).forEach(([rawName, players]) => {
    const name = clean(rawName, 48);
    if (!name || !Array.isArray(players)) return;
    result[name] = players.slice(0, 20).map((p) => ({
      name: clean(p && p.name, 32) || 'Jogador',
      position: ['GOL', 'ZAG', 'ALA', 'MEI', 'ATA'].includes(clean(p && p.position, 8)) ? clean(p.position, 8) : 'MEI',
      overall: int(p && p.overall, 40, 99, 70)
    }));
  });
  return Object.keys(result).length ? result : null;
}
function normalizeRoster(playerId, raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Elenco inválido.');
  const input = Array.isArray(raw.squad) ? raw.squad.slice(0, 7) : [];
  if (input.length !== 7) throw new Error('O elenco precisa ter exatamente 7 jogadores.');

  const teamName = clean(raw.teamName, 48) || '';
  const sourcePlayers = TEAM_DATABASE[teamName];
  if (!sourcePlayers) throw new Error('A turma selecionada não existe na base oficial.');

  const expectedPositionsByFormation = {
    '1-2-3-1': { GOL: 1, ZAG: 2, ALA: 2, MEI: 1, ATA: 1 },
    '1-1-2-3': { GOL: 1, ZAG: 1, ALA: 2, MEI: 2, ATA: 1 },
    '1-3-2-1': { GOL: 1, ZAG: 3, ALA: 0, MEI: 2, ATA: 1 }
  };
  const formationKey = clean(raw.formationKey, 16) || '1-2-3-1';
  const expected = expectedPositionsByFormation[formationKey];
  if (!expected) throw new Error('Formação inválida.');

  const names = new Set();
  const squad = input.map((entry, index) => {
    const p = entry && entry.player ? entry.player : entry;
    const name = clean(p && p.name, 32);
    const position = clean(p && p.position, 8);
    if (!name) throw new Error('Há jogador sem nome.');
    if (!['GOL', 'ZAG', 'ALA', 'MEI', 'ATA'].includes(position)) throw new Error('Há posição inválida.');

    const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    if (names.has(normalized)) throw new Error('O elenco não pode ter jogadores repetidos.');
    names.add(normalized);

    // The selected player must exist in the server-held roster for the drawn class/year.
    const official = sourcePlayers.find((candidate) => {
      const officialName = String(candidate.name || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
      return officialName === normalized && candidate.position === position;
    });
    if (!official) throw new Error('Um jogador não pertence à turma sorteada.');
    return {
      slotId: clean(entry && entry.slotId, 24) || ('slot_' + (index + 1)),
      captain: false,
      player: {
        id: playerId + ':p' + (index + 1),
        name: official.name,
        position: official.position,
        overall: int(official.overall, 40, 99, 70),
        room: teamName
      }
    };
  });

  const actualPositions = squad.reduce((counts, entry) => {
    counts[entry.player.position] = (counts[entry.player.position] || 0) + 1;
    return counts;
  }, {});
  for (const position of ['GOL', 'ZAG', 'ALA', 'MEI', 'ATA']) {
    if ((actualPositions[position] || 0) !== expected[position]) {
      throw new Error('As posições escolhidas não correspondem à formação selecionada.');
    }
  }

  const requestedCaptain = clean(raw.captainPlayerId, 100);
  let captainIndex = input.findIndex((entry) => {
    const p = entry && entry.player ? entry.player : entry;
    return String(p && p.id) === requestedCaptain;
  });
  if (captainIndex < 0) captainIndex = 0;
  squad[captainIndex].captain = true;

  return {
    formationKey,
    mode: raw.mode === 'blind' ? 'blind' : 'classic',
    teamName,
    squad,
    captainPlayerId: squad[captainIndex].player.id,
    ovr: Math.round(squad.reduce((sum, entry) => sum + entry.player.overall, 0) / 7)
  };
}
function humanParticipant(player) {
  const r = player.roster;
  return {
    id: player.id, isHuman: true, isBot: false, name: player.name,
    teamName: r.teamName, displayName: player.name + ' (' + r.teamName + ')',
    squad: r.squad, captainPlayerId: r.captainPlayerId, formationKey: r.formationKey,
    mode: r.mode, ovr: r.ovr
  };
}
function addBots(room, count, usedClasses) {
  const pool = TEAM_DATABASE;
  const keys = shuffle(Object.keys(pool).filter((key) => (pool[key] || []).length));
  let serial = 1;
  for (let i = 0; i < count; i++) {
    const key = keys.find((candidate) => !usedClasses.has(candidate)) || keys[i % Math.max(1, keys.length)] || ('TIME CONVIDADO ' + (i + 1));
    usedClasses.add(key);
    const source = pool[key] || [
      { name: 'Goleiro', position: 'GOL', overall: 70 },
      { name: 'Zagueiro 1', position: 'ZAG', overall: 70 },
      { name: 'Zagueiro 2', position: 'ZAG', overall: 70 },
      { name: 'Ala 1', position: 'ALA', overall: 70 },
      { name: 'Meia', position: 'MEI', overall: 70 },
      { name: 'Ala 2', position: 'ALA', overall: 70 },
      { name: 'Atacante', position: 'ATA', overall: 70 }
    ];
    const id = 'bot-' + room.code + '-' + serial++;
    const remaining = [...source];
    const requiredPositions = ['GOL', 'ZAG', 'ZAG', 'ALA', 'ALA', 'MEI', 'ATA'];
    const selectedPlayers = requiredPositions.map((position, index) => {
      const foundIndex = remaining.findIndex((p) => p.position === position);
      if (foundIndex >= 0) return remaining.splice(foundIndex, 1)[0];
      return { name: position + ' reserva ' + (index + 1), position, overall: 70 };
    });
    const squad = selectedPlayers.map((p, index) => ({
      slotId: 'bot_slot_' + (index + 1), captain: index === 0,
      player: {
        id: id + ':p' + (index + 1),
        name: clean(p.name, 32) || ('Jogador ' + (index + 1)),
        position: p.position,
        overall: int(p.overall, 40, 99, 70),
        room: key
      }
    }));
    const team = {
      id, isHuman: false, isBot: true, name: key, teamName: key,
      displayName: key + ' — CPU ' + iPlusOne(i), squad,
      captainPlayerId: squad[0] ? squad[0].player.id : null,
      formationKey: '1-2-3-1', mode: 'classic',
      ovr: Math.round(squad.reduce((sum, entry) => sum + entry.player.overall, 0) / Math.max(1, squad.length))
    };
    room.tournament.participants[id] = team;
  }
}
function iPlusOne(value) { return value + 1; }
function makeMatch(stage, index, first, second) {
  let a = first;
  let b = second;
  if (!a.isHuman && b.isHuman) [a, b] = [b, a];
  return {
    id: stage + '_' + (index + 1), stage, index, teamAId: a.id, teamBId: b.id,
    controllerId: a.isHuman ? a.id : (b.isHuman ? b.id : null),
    played: false, scoreA: 0, scoreB: 0, penaltyScoreA: null, penaltyScoreB: null,
    winnerId: null, timeline: [], playedBy: null
  };
}
function shootout() {
  let a = int(Math.floor(Math.random() * 4) + 3, 3, 6, 4);
  let b = int(Math.floor(Math.random() * 4) + 3, 3, 6, 4);
  while (a === b) b = int(Math.floor(Math.random() * 4) + 3, 3, 6, 4);
  return [a, b];
}
function simulateCpuMatch(room, match) {
  if (match.played) return;
  const tournament = room.tournament;
  const a = tournament.participants[match.teamAId];
  const b = tournament.participants[match.teamBId];
  const difference = a.ovr - b.ovr;
  const scoreA = Math.floor(Math.random() * 3) + (difference > 5 ? 1 : 0);
  const scoreB = Math.floor(Math.random() * 3) + (difference < -5 ? 1 : 0);
  let penaltyA = null;
  let penaltyB = null;
  if (scoreA === scoreB) [penaltyA, penaltyB] = shootout();

  const events = [];
  const addGoalEvents = (team, goals) => {
    const players = (team.squad || []).map((entry) => entry.player).filter(Boolean);
    for (let i = 0; i < goals; i++) {
      if (!players.length) continue;
      const scorer = players[Math.floor(Math.random() * players.length)];
      const possibleAssisters = players.filter((p) => p.id !== scorer.id);
      const assister = possibleAssisters.length && Math.random() < 0.65
        ? possibleAssisters[Math.floor(Math.random() * possibleAssisters.length)]
        : null;
      events.push({
        type: 'GOAL',
        minute: 1 + Math.floor(Math.random() * 90),
        half: 'CPU',
        scorer: { id: scorer.id, name: scorer.name },
        assister: assister ? { id: assister.id, name: assister.name } : null
      });
    }
  };
  addGoalEvents(a, scoreA);
  addGoalEvents(b, scoreB);

  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.penaltyScoreA = penaltyA;
  match.penaltyScoreB = penaltyB;
  match.timeline = events.sort((left, right) => left.minute - right.minute);
  match.winnerId = scoreA === scoreB
    ? (penaltyA > penaltyB ? match.teamAId : match.teamBId)
    : (scoreA > scoreB ? match.teamAId : match.teamBId);
  match.played = true;
  match.playedBy = 'server-cpu';
}
function createMatchesFromTeams(stage, teams) {
  const matches = [];
  for (let i = 0; i < teams.length; i += 2) matches.push(makeMatch(stage, matches.length, teams[i], teams[i + 1]));
  return matches;
}
function progressTournament(room) {
  const t = room.tournament;
  if (!t || t.phase === 'finished') return;
  let guard = 0;
  while (guard++ < 4) {
    const matches = t.stages[t.stage] || [];
    matches.forEach((match) => {
      const a = t.participants[match.teamAId];
      const b = t.participants[match.teamBId];
      if (a && b && !a.isHuman && !b.isHuman && !match.played) simulateCpuMatch(room, match);
    });
    if (!matches.length || !matches.every((match) => match.played)) return;
    if (t.stage === 'final') {
      t.phase = 'finished';
      t.championId = matches[0].winnerId;
      room.phase = 'finished';
      return;
    }
    const nextStage = STAGES[STAGES.indexOf(t.stage) + 1];
    const winners = matches.map((match) => t.participants[match.winnerId]);
    t.stage = nextStage;
    t.stages[nextStage] = createMatchesFromTeams(nextStage, winners);
  }
}
function beginTournament(room) {
  const players = Object.values(room.players).sort((a, b) => a.joinOrder - b.joinOrder);
  if (players.length < 2) throw new Error('A sala precisa ter pelo menos 2 participantes.');
  if (players.length > MAX_PLAYERS) throw new Error('A sala ultrapassou o limite de participantes.');
  if (players.some((p) => !p.roster)) throw new Error('Todos precisam finalizar o elenco antes do início.');
  const participants = {};
  players.map(humanParticipant).forEach((p) => { participants[p.id] = p; });
  room.tournament = { phase: 'playing', stage: 'oitavas', stages: {}, participants, championId: null };
  const usedClasses = new Set(players.map((p) => p.roster.teamName));
  addBots(room, 16 - players.length, usedClasses);
  room.tournament.stages.oitavas = createMatchesFromTeams('oitavas', shuffle(Object.values(room.tournament.participants)));
  room.phase = 'tournament';
  progressTournament(room);
}
function cleanTimeline(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).map((event) => {
    const type = ['GOAL', 'GOAL_PENALTY', 'OWN_GOAL', 'SAVE', 'YELLOW_CARD', 'RED_CARD'].includes(clean(event && event.type, 20))
      ? clean(event.type, 20) : 'EVENT';
    const person = (p) => p && typeof p === 'object' ? { id: clean(p.id, 100), name: clean(p.name, 32) } : null;
    return {
      type, minute: int(event && event.minute, 0, 100, 0), half: clean(event && event.half, 8),
      scorer: person(event && event.scorer), assister: type === 'GOAL' ? person(event && event.assister) : null
    };
  });
}
function bindPlayer(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  socket.data.playerId = player.id;
  socket.data.roomCode = room.code;
  socket.join(room.code);
  touch(room);
}
io.on('connection', (socket) => {
  socket.on('room:create', async (data, ack) => {
    try {
      const id = clean(data && data.playerId, 100);
      const name = clean(data && data.name, 24);
      if (!id || name.length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
      const existing = findPlayerRoom(id);
      if (existing) throw new Error('Você já está na sala ' + existing.code + '.');
      const code = newCode();
      const room = {
        code, hostId: id, phase: 'lobby',
        players: {
          [id]: { id, name, socketId: socket.id, connected: true, joinOrder: 1, status: 'na sala', roster: null }
        },
        teamPool: null, tournament: null, createdAt: Date.now(), updatedAt: Date.now(), nextJoinOrder: 2
      };
      rooms.set(code, room);
      await socket.join(code);
      socket.data.playerId = id;
      socket.data.roomCode = code;
      if (typeof ack === 'function') ack({ ok: true, state: publicRoomState(room) });
      broadcastRoom(room);
      await persistRooms();
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Não foi possível criar a sala.' });
    }
  });
  socket.on('room:join', async (data, ack) => {
    try {
      const id = clean(data && data.playerId, 100);
      const name = clean(data && data.name, 24);
      const code = clean(data && data.code, 8).toUpperCase();
      if (!id || name.length < 2) throw new Error('Informe seu nome com pelo menos 2 caracteres.');
      const room = rooms.get(code);
      if (!room) throw new Error('Sala não encontrada. Confira o código.');
      let player = room.players[id];
      if (!player && !['lobby', 'drafting'].includes(room.phase)) throw new Error('O campeonato já começou e a sala não aceita novos participantes.');
      if (!player && Object.keys(room.players).length >= MAX_PLAYERS) throw new Error('A sala já está cheia (16 participantes).');
      const otherRoom = findPlayerRoom(id);
      if (otherRoom && otherRoom.code !== room.code) throw new Error('Você já está na sala ' + otherRoom.code + '.');
      if (!player) {
        player = { id, name, socketId: socket.id, connected: true, joinOrder: room.nextJoinOrder++, status: 'na sala', roster: null };
        room.players[id] = player;
      } else {
        player.socketId = socket.id;
        player.connected = true;
      }
      await socket.join(code);
      socket.data.playerId = id;
      socket.data.roomCode = code;
      touch(room);
      if (typeof ack === 'function') ack({ ok: true, state: publicRoomState(room), roster: player.roster || null });
      broadcastRoom(room);
      if (room.tournament) socket.emit('tournament:state', publicTournamentState(room));
      await persistRooms();
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Não foi possível entrar na sala.' });
    }
  });
  socket.on('room:reconnect', async (data, ack) => {
    try {
      const id = clean(data && data.playerId, 100);
      const code = clean(data && data.code, 8).toUpperCase();
      const room = rooms.get(code);
      const player = room && room.players[id];
      if (!room || !player) throw new Error('Não foi possível recuperar a sala. Entre com o código novamente.');
      bindPlayer(socket, room, player);
      if (typeof ack === 'function') ack({ ok: true, state: publicRoomState(room), roster: player.roster || null });
      broadcastRoom(room);
      if (room.tournament) socket.emit('tournament:state', publicTournamentState(room));
      await persistRooms();
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Falha ao reconectar.' });
    }
  });
  socket.on('room:enterSetup', async (_data, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      const player = room && room.players[socket.data.playerId];
      if (!room || !player) throw new Error('Entre em uma sala antes de montar o elenco.');
      if (!['lobby', 'drafting'].includes(room.phase)) throw new Error('O campeonato já começou.');
      room.phase = 'drafting';
      player.status = 'montando';
      broadcastRoom(room);
      await persistRooms();
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });
  socket.on('room:submitRoster', async (data, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      const player = room && room.players[socket.data.playerId];
      if (!room || !player) throw new Error('Entre novamente na sala antes de enviar seu elenco.');
      if (!['lobby', 'drafting'].includes(room.phase)) throw new Error('O campeonato já começou; o elenco foi bloqueado.');
      player.roster = normalizeRoster(player.id, data && data.roster);
      player.status = 'pronto';
      room.phase = 'drafting';
      touch(room);
      if (typeof ack === 'function') ack({ ok: true, roster: player.roster });
      broadcastRoom(room);
      await persistRooms();
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Não foi possível salvar o elenco.' });
    }
  });
  socket.on('room:startTournament', async (_data, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      if (socket.data.playerId !== room.hostId) throw new Error('Somente o anfitrião pode iniciar o campeonato.');
      const state = publicRoomState(room);
      if (!state.canStart) throw new Error('Aguarde todos os participantes finalizarem os elencos.');
      beginTournament(room);
      if (typeof ack === 'function') ack({ ok: true });
      broadcastTournament(room);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Não foi possível iniciar o campeonato.' });
    }
  });
  socket.on('match:submit', async (data, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      const playerId = socket.data.playerId;
      if (!room || !room.tournament || room.tournament.phase !== 'playing') throw new Error('Não existe partida ativa nesta sala.');
      const t = room.tournament;
      const match = (t.stages[t.stage] || []).find((m) => m.id === clean(data && data.matchId, 32));
      if (!match) throw new Error('Esta partida não pertence à rodada atual.');
      if (match.played) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true });
        return;
      }
      if (match.controllerId !== playerId) throw new Error('Somente o responsável escolhido pelo servidor pode confirmar o resultado.');
      const scoreA = Number(data && data.scoreA);
      const scoreB = Number(data && data.scoreB);
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) ||
          scoreA < 0 || scoreA > 30 || scoreB < 0 || scoreB > 30) {
        throw new Error('Placar inválido.');
      }
      let penaltyA = null;
      let penaltyB = null;
      if (scoreA === scoreB) {
        penaltyA = Number(data && data.penaltyScoreA);
        penaltyB = Number(data && data.penaltyScoreB);
        if (!Number.isInteger(penaltyA) || !Number.isInteger(penaltyB) ||
            penaltyA < 0 || penaltyA > 20 || penaltyB < 0 || penaltyB > 20 || penaltyA === penaltyB) {
          throw new Error('O empate precisa de pênaltis com vencedor definido.');
        }
      }
      match.scoreA = scoreA;
      match.scoreB = scoreB;
      match.penaltyScoreA = penaltyA;
      match.penaltyScoreB = penaltyB;
      match.timeline = cleanTimeline(data && data.timeline);
      match.winnerId = scoreA === scoreB
        ? (penaltyA > penaltyB ? match.teamAId : match.teamBId)
        : (scoreA > scoreB ? match.teamAId : match.teamBId);
      match.played = true;
      match.playedBy = playerId;
      progressTournament(room);
      touch(room);
      await persistRooms();
      if (typeof ack === 'function') ack({ ok: true });
      broadcastTournament(room);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Não foi possível confirmar o resultado.' });
    }
  });
  socket.on('room:leave', async (_data, ack) => {
    try {
      const room = rooms.get(socket.data.roomCode);
      const id = socket.data.playerId;
      if (!room || !id || !room.players[id]) throw new Error('Você não está em uma sala.');
      if (room.tournament) throw new Error('Depois que o campeonato começa, não é possível sair da sala.');
      delete room.players[id];
      socket.leave(room.code);
      if (Object.keys(room.players).length === 0) rooms.delete(room.code);
      else {
        if (room.hostId === id) {
          const next = Object.values(room.players).sort((a, b) => a.joinOrder - b.joinOrder)[0];
          room.hostId = next.id;
        }
        broadcastRoom(room);
      }
      socket.data.playerId = null;
      socket.data.roomCode = null;
      await persistRooms();
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Não foi possível sair da sala.' });
    }
  });
  socket.on('disconnect', async () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room && room.players[socket.data.playerId];
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (!room.tournament && room.hostId === player.id) {
      const nextHost = Object.values(room.players).filter((p) => p.connected).sort((a, b) => a.joinOrder - b.joinOrder)[0];
      if (nextHost) room.hostId = nextHost.id;
    }
    broadcastRoom(room);
    await persistRooms();
  });
});

async function start() {
  if (redis && !redis.isOpen) {
    try {
      await redis.connect();
      const raw = await redis.get(STATE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        saved.forEach((room) => {
          if (!room || !room.code || !room.players) return;
          if (Date.now() - Number(room.updatedAt || room.createdAt || Date.now()) > 7 * 24 * 60 * 60 * 1000) return;
          Object.values(room.players).forEach((p) => { p.socketId = null; p.connected = false; });
          rooms.set(room.code, room);
        });
        console.log('[redis] ' + rooms.size + ' sala(s) restaurada(s)');
      }
    } catch (err) {
      console.error('[redis] iniciando sem estado persistido: ' + err.message);
    }
  }
  server.listen(PORT, '0.0.0.0', () => console.log('GINCANA 4x0 online em 0.0.0.0:' + PORT));
}
start();
process.on('SIGTERM', async () => {
  await persistRooms();
  server.close(() => process.exit(0));
});
