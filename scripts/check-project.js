'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const online = fs.readFileSync(path.join(root, 'online.js'), 'utf8');
const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const officialDatabase = JSON.parse(fs.readFileSync(path.join(root, 'team-data.json'), 'utf8'));

function extractJsonObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'Não foi encontrado o marcador: ' + marker);
  const start = markerIndex + marker.length;
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(source.slice(start, i + 1));
      }
    }
  }

  throw new Error('Objeto JSON não terminou corretamente: ' + marker);
}

const clientDatabase = extractJsonObject(html, 'const realPlayerData = ');
assert.deepStrictEqual(
  clientDatabase,
  officialDatabase,
  'A base de jogadores no navegador precisa ser igual à base validada pelo servidor.'
);

const teamNames = Object.keys(officialDatabase);
assert.equal(teamNames.length, 18, 'A base precisa conter as 18 turmas/anos esperados.');
for (const [teamName, players] of Object.entries(officialDatabase)) {
  assert.ok(Array.isArray(players) && players.length > 0, 'Elenco vazio: ' + teamName);
  for (const player of players) {
    assert.ok(player.name && typeof player.name === 'string', 'Jogador sem nome em ' + teamName);
    assert.ok(['GOL', 'ZAG', 'ALA', 'MEI', 'ATA'].includes(player.position), 'Posição inválida em ' + teamName);
    assert.ok(Number.isInteger(player.overall) && player.overall >= 40 && player.overall <= 99, 'Overall inválido em ' + teamName);
  }
}

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
assert.ok(inlineScripts.length > 0, 'O HTML precisa conter o código principal do jogo.');
inlineScripts.forEach((match, index) => {
  new vm.Script(match[2], { filename: 'index.html:inline-script-' + (index + 1) });
});

assert.ok(html.includes('src="/socket.io/socket.io.js"'), 'O cliente Socket.IO precisa ser carregado pelo servidor.');
assert.ok(html.includes('src="/online.js"'), 'O módulo online precisa ser carregado.');
assert.ok(server.includes("app.get('/healthz'"), 'O servidor precisa expor o health check do Render.');
assert.ok(server.includes("socket.on('room:startTournament'"), 'O servidor precisa controlar o início do torneio.');
assert.ok(server.includes("socket.on('room:setMode'"), 'O anfitrião precisa configurar o modo geral da sala.');
assert.ok(server.includes("socket.on('stage:confirm'"), 'Cada participante ativo precisa confirmar a fase.');
assert.ok(server.includes("requiredReadyIds.every"), 'A fase só pode avançar após as confirmações necessárias.');
assert.ok(server.includes("socket.on('match:submit'"), 'O servidor precisa receber os placares.');
assert.ok(server.includes("matches.every((match) => match.played)"), 'Uma fase só pode avançar após todos os resultados.');
assert.ok(server.includes('O placar não corresponde aos gols registrados na partida.'), 'O placar precisa corresponder à linha do tempo validada.');
assert.ok(online.includes("emit('room:submitRoster'"), 'O elenco deve ser enviado ao servidor.');
assert.ok(online.includes("emit('match:submit'"), 'O resultado deve ser confirmado pelo servidor.');
assert.ok(online.includes("emit('stage:confirm'"), 'O cliente deve enviar a confirmação da próxima fase.');
assert.ok(online.includes("emit('room:setMode'"), 'O cliente deve enviar o modo escolhido pelo anfitrião.');
assert.ok(html.includes('id="btn-online-confirm-stage"'), 'A tela de espera precisa ter o botão de confirmação da fase.');
assert.ok(html.includes('id="btn-room-mode-blind"') && html.includes('id="btn-room-mode-classic"'), 'A sala precisa oferecer os dois modos globais.');

assert.equal(pkg.scripts.start, 'node server.js');
assert.ok(pkg.dependencies.express && pkg.dependencies['socket.io'] && pkg.dependencies.redis);
assert.ok(render.includes('runtime: node'));
assert.ok(render.includes('buildCommand: npm install'));
assert.ok(render.includes('startCommand: npm start'));
assert.ok(render.includes('healthCheckPath: /healthz'));
assert.ok(render.includes('key: REDIS_URL'));
assert.ok(render.includes('type: keyvalue'));

console.log('Validação concluída: HTML/JS válido, 18 bases sincronizadas, regras online e configuração do Render verificadas.');
