(function () {
  'use strict';
  const STORE_ID = 'gincana4x0:playerId';
  const STORE_NAME = 'gincana4x0:playerName';
  const STORE_ROOM = 'gincana4x0:roomCode';
  const originalShowScreen = window.showScreen;
  const originalStartDrafting = window.startDrafting;
  const originalConfirm = window.confirmCaptainAndStart;
  const originalPrepare = window.prepareAndLaunchMatch;
  const originalFinalize = window.finalizeFullTimeMatch;
  const originalProceed = window.proceedAfterMatch;
  const originalSummary = window.showTournamentSummary;
  const originalSelectMode = window.selectMode;
  const stages = ['oitavas', 'quartas', 'semi', 'final'];
  const byId = (id) => document.getElementById(id);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function get(key) { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function put(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (_) {} }
  function makeId() {
    return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : ('p-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  const online = {
    id: get(STORE_ID) || makeId(), name: get(STORE_NAME), code: get(STORE_ROOM).toUpperCase(),
    enabled: Boolean(get(STORE_ROOM)), hostId: null, room: null, tournament: null, currentMatchId: null
  };
  put(STORE_ID, online.id);
  function setStatus(message, isError) {
    const node = byId('online-connection-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('text-red-600', Boolean(isError));
    node.classList.toggle('text-gray-500', !isError);
  }
  function waiting(title, message) {
    if (byId('online-waiting-title')) byId('online-waiting-title').textContent = title;
    if (byId('online-waiting-text')) byId('online-waiting-text').textContent = message;
    if (online.room) renderPlayerRows(byId('online-waiting-players'), online.room);
    renderStageReadyButton();
    window.showScreen('screen-online-waiting');
  }
  function applyRoomMode(mode) {
    const roomMode = mode === 'blind' ? 'blind' : 'classic';
    if (typeof originalSelectMode === 'function') originalSelectMode(roomMode);
    if (typeof gameState !== 'undefined') gameState.selectedMode = roomMode;
    ['btn-mode-classic', 'btn-mode-blind'].forEach((id) => {
      const button = byId(id);
      if (button) {
        button.disabled = Boolean(online.enabled && online.room);
        button.classList.toggle('opacity-50', button.disabled);
        button.classList.toggle('cursor-not-allowed', button.disabled);
      }
    });
  }
  function renderRoomModeControls(state) {
    const mode = state.mode === 'blind' ? 'blind' : 'classic';
    const canEdit = online.enabled && online.id === state.hostId && ['lobby', 'drafting'].includes(state.phase);
    const classic = byId('btn-room-mode-classic');
    const blind = byId('btn-room-mode-blind');
    [[classic, 'classic'], [blind, 'blind']].forEach(([button, value]) => {
      if (!button) return;
      button.disabled = !canEdit || mode === value;
      button.classList.toggle('bg-black', mode === value);
      button.classList.toggle('text-white', mode === value);
      button.classList.toggle('bg-white', mode !== value);
      button.classList.toggle('text-gray-900', mode !== value);
      button.classList.toggle('opacity-50', !canEdit);
    });
    const description = byId('online-room-mode-description');
    if (description) {
      description.textContent = mode === 'blind'
        ? 'Modo da sala: ÀS CEGAS — todos jogam com os overalls ocultos.'
        : 'Modo da sala: CLÁSSICO — todos veem os overalls.';
    }
  }
  function renderStageReadyButton() {
    const button = byId('btn-online-confirm-stage');
    if (!button) return;
    const tournament = online.tournament;
    const matches = tournament && tournament.stages && tournament.stages[tournament.stage] || [];
    const ownMatch = matches.find((match) =>
      (match.teamA && match.teamA.id === online.id) || (match.teamB && match.teamB.id === online.id)
    );
    const required = Boolean(tournament && tournament.phase === 'playing' && ownMatch && ownMatch.played);
    const ready = Boolean(tournament && (tournament.readyPlayers || []).includes(online.id));
    button.classList.toggle('hidden', !required);
    button.disabled = !required || ready;
    button.classList.toggle('opacity-50', button.disabled);
    if (!required) return;
    button.textContent = ready
      ? '✓ CONFIRMADO — AGUARDANDO OS OUTROS'
      : 'CONFIRMAR E AGUARDAR OS OUTROS (' + (tournament.readyCount || 0) + '/' + (tournament.requiredReadyCount || 0) + ')';
  }
  window.selectMode = function (mode) {
    if (online.enabled && online.room) {
      applyRoomMode(online.room.mode);
      return;
    }
    if (typeof originalSelectMode === 'function') return originalSelectMode(mode);
  };
  function emit(event, payload, callback) {
    const socket = window.gincanaSocket;
    if (!socket || !socket.connected) {
      setStatus('Sem conexão com o servidor online. Verifique a internet e tente novamente.', true);
      if (callback) callback({ ok: false, error: 'Sem conexão com o servidor.' });
      return;
    }
    socket.emit(event, payload || {}, callback || function () {});
  }
  function renderPlayerRows(container, state) {
    if (!container) return;
    container.innerHTML = '';
    (state.players || []).forEach((player) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 border border-gray-200 bg-white px-3 py-2 text-xs';
      const label = document.createElement('span');
      label.className = 'font-semibold text-gray-800';
      let textLabel = player.name;
      if (player.id === online.hostId) textLabel += ' • ANFITRIÃO';
      textLabel += ' — ' + (player.ready ? 'ELENCO PRONTO' : (player.status || 'NA SALA'));
      if (!player.connected) textLabel += ' (DESCONECTADO)';
      label.textContent = textLabel;
      const badge = document.createElement('span');
      badge.className = player.ready ? 'font-sports text-green-700' : 'font-sports text-gray-400';
      badge.textContent = player.ready ? '✓ PRONTO' : '…';
      row.append(label, badge);
      container.appendChild(row);
    });
    if (!(state.players || []).length) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-gray-500';
      empty.textContent = 'A sala está vazia.';
      container.appendChild(empty);
    }
  }
  function renderRoom(state) {
    online.room = state;
    online.hostId = state.hostId;
    applyRoomMode(state.mode);
    renderRoomModeControls(state);
    const panel = byId('online-room-panel');
    if (panel) panel.classList.remove('hidden');
    if (byId('online-room-code-display')) byId('online-room-code-display').textContent = state.code;
    if (byId('online-room-code-input')) byId('online-room-code-input').value = state.code;
    if (byId('online-room-summary')) byId('online-room-summary').textContent = state.playerCount + '/' + state.maxPlayers + ' participantes • ' + state.readyCount + ' elenco(s) pronto(s)';
    if (byId('btn-online-enter-setup')) {
      byId('btn-online-enter-setup').disabled = ['tournament', 'finished'].includes(state.phase);
      byId('btn-online-enter-setup').classList.toggle('opacity-50', byId('btn-online-enter-setup').disabled);
    }
    if (byId('btn-online-leave-room')) {
      byId('btn-online-leave-room').disabled = ['tournament', 'finished'].includes(state.phase);
      byId('btn-online-leave-room').classList.toggle('opacity-50', byId('btn-online-leave-room').disabled);
    }
    renderPlayerRows(byId('online-room-players'), state);
    renderPlayerRows(byId('online-waiting-players'), state);
    const launch = byId('btn-online-launch-tournament');
    if (launch) {
      const canShow = online.enabled && online.id === state.hostId && state.canStart && ['lobby', 'drafting'].includes(state.phase);
      launch.classList.toggle('hidden', !canShow);
      launch.disabled = !canShow;
      launch.classList.toggle('opacity-50', !canShow);
    }
    setStatus('Conectado à sala ' + state.code + '. Compartilhe o código com seus amigos.');
  }
  function connectOnline() {
    if (typeof window.io !== 'function') {
      setStatus('O modo online precisa do servidor Node/Render. O modo offline continua disponível.', true);
      return;
    }
    const socket = window.io({ transports: ['websocket', 'polling'] });
    window.gincanaSocket = socket;
    socket.on('connect', function () {
      setStatus('Conectado ao servidor online.');
      if (!online.code) return;
      emit('room:reconnect', { code: online.code, playerId: online.id, name: online.name || get(STORE_NAME) || 'Jogador' }, function (res) {
        if (!res || !res.ok) {
          online.enabled = false; online.code = ''; put(STORE_ROOM, '');
          setStatus(res && res.error ? res.error : 'Não foi possível recuperar a sala.', true);
          window.showScreen('screen-online-lobby');
          return;
        }
        online.enabled = true;
        renderRoom(res.state);
        if (res.roster) restoreRoster(res.roster);
        if (res.state.phase === 'tournament' || res.state.phase === 'finished') waiting('RECONECTANDO AO CAMPEONATO', 'Recuperando o estado oficial do campeonato…');
        else window.showScreen('screen-online-lobby');
      });
    });
    socket.on('connect_error', () => setStatus('Não foi possível conectar ao servidor online.', true));
    socket.on('disconnect', () => setStatus('Conexão interrompida. Tentando reconectar automaticamente…', true));
    socket.on('room:state', (state) => {
      if (!state || state.code !== online.code) return;
      online.enabled = true;
      renderRoom(state);
    });
    socket.on('tournament:state', (state) => {
      if (state && state.roomCode === online.code) handleTournament(state);
    });
  }
  function makeTeamPool() {
    const pool = {};
    Object.entries(TEAMS_DATABASE).forEach(([name, players]) => {
      pool[name] = (players || []).map((p) => ({ name: p.name, position: p.position, overall: p.overall }));
    });
    return pool;
  }
  function restoreRoster(roster) {
    if (!roster || !Array.isArray(roster.squad)) return;
    gameState.userSquad = roster.squad.map((entry) => ({ slotId: entry.slotId, player: entry.player, captain: Boolean(entry.captain) }));
    gameState.captainPlayerId = roster.captainPlayerId;
    gameState.selectedFormationKey = roster.formationKey || gameState.selectedFormationKey;
    gameState.selectedMode = roster.mode || gameState.selectedMode;
    gameState.currentDrawnRoom = roster.teamName || gameState.currentDrawnRoom;
  }
  function participantPlayers(participant) {
    return (participant && Array.isArray(participant.squad) ? participant.squad : [])
      .map((entry) => entry && entry.player ? entry.player : entry).filter(Boolean);
  }
  function displayName(participant) {
    return participant ? (participant.displayName || participant.teamName || participant.name || 'Time') : 'Time';
  }
  function mapMatch(match) {
    let a = match.teamA, b = match.teamB;
    let scoreA = match.scoreA, scoreB = match.scoreB;
    let penA = match.penaltyScoreA, penB = match.penaltyScoreB;
    const myA = a && a.id === online.id;
    const myB = b && b.id === online.id;
    const isMyMatch = Boolean(myA || myB);
    if (myB) {
      [a, b] = [b, a];
      [scoreA, scoreB] = [scoreB, scoreA];
      [penA, penB] = [penB, penA];
    }
    const aPlayers = participantPlayers(a), bPlayers = participantPlayers(b);
    const aDisplay = displayName(a), bDisplay = displayName(b);
    if (aDisplay && aPlayers.length) TEAMS_DATABASE[aDisplay] = aPlayers;
    if (bDisplay && bPlayers.length) TEAMS_DATABASE[bDisplay] = bPlayers;
    let winner = null;
    if (match.winnerId) {
      if (a && match.winnerId === a.id) winner = isMyMatch ? 'SEU TIME' : aDisplay;
      else if (b && match.winnerId === b.id) winner = bDisplay;
      else winner = match.winnerName;
    }
    return {
      matchId: match.id, onlineMatchId: match.id, onlineControllerId: match.controllerId,
      onlineIsMyMatch: isMyMatch, onlineIsController: match.controllerId === online.id,
      teamA: { id: a && a.id, name: isMyMatch ? 'SEU TIME' : aDisplay, displayName: aDisplay, isUser: isMyMatch, ovr: a && a.ovr || 70, players: aPlayers },
      teamB: { id: b && b.id, name: bDisplay, displayName: bDisplay, isUser: false, ovr: b && b.ovr || 70, players: bPlayers },
      played: Boolean(match.played), winner, winnerId: match.winnerId,
      scoreA: scoreA || 0, scoreB: scoreB || 0,
      penaltyScoreA: penA == null ? null : penA, penaltyScoreB: penB == null ? null : penB,
      timeline: match.timeline || []
    };
  }
  function rebuildStats(data) {
    gameState.userPlayerStatsMap = {};
    gameState.tournamentPlayerStatsMap = {};
    gameState.campaignStats = { games: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
    (data.participants || []).forEach((participant) => {
      participantPlayers(participant).forEach((player) => {
        const stats = { player, teamName: participant.displayName || participant.teamName, games: 0, goals: 0, assists: 0, ratings: [] };
        gameState.tournamentPlayerStatsMap[player.id] = stats;
        if (participant.id === online.id) gameState.userPlayerStatsMap[player.id] = stats;
      });
    });
    Object.values(data.stages || {}).forEach((matches) => (matches || []).forEach((match) => {
      if (!match.played) return;
      [...participantPlayers(match.teamA), ...participantPlayers(match.teamB)].forEach((player) => {
        const stats = gameState.tournamentPlayerStatsMap[player.id];
        if (stats) { stats.games += 1; stats.ratings.push(7.5); }
      });
      (match.timeline || []).forEach((event) => {
        if ((event.type === 'GOAL' || event.type === 'GOAL_PENALTY') && event.scorer && gameState.tournamentPlayerStatsMap[event.scorer.id]) gameState.tournamentPlayerStatsMap[event.scorer.id].goals += 1;
        if (event.type === 'GOAL' && event.assister && gameState.tournamentPlayerStatsMap[event.assister.id]) gameState.tournamentPlayerStatsMap[event.assister.id].assists += 1;
      });
      if ((match.teamA && match.teamA.id === online.id) || (match.teamB && match.teamB.id === online.id)) {
        const userA = match.teamA && match.teamA.id === online.id;
        const userScore = userA ? match.scoreA : match.scoreB;
        const oppScore = userA ? match.scoreB : match.scoreA;
        gameState.campaignStats.games += 1;
        gameState.campaignStats.gf += userScore;
        gameState.campaignStats.ga += oppScore;
        if (userScore === oppScore) gameState.campaignStats.draws += 1;
        if (match.winnerId === online.id) gameState.campaignStats.wins += 1;
        else gameState.campaignStats.losses += 1;
      }
    }));
  }
  function handleTournament(data) {
    online.tournament = data;
    if (data.roomMode) applyRoomMode(data.roomMode);
    const own = (data.participants || []).find((p) => p.id === online.id);
    if (own) restoreRoster({ teamName: own.teamName, squad: own.squad, captainPlayerId: own.captainPlayerId, formationKey: own.formationKey, mode: data.roomMode || own.mode });
    rebuildStats(data);
    stages.forEach((stage) => {
      gameState.bracket[stage] = (data.stages && data.stages[stage] || []).map(mapMatch);
    });
    gameState.currentBracketStage = data.stage || 'oitavas';
    gameState.currentPhase = data.phase === 'finished' ? 'SUMMARY' : 'BRACKET';
    const current = data.stages && data.stages[data.stage] || [];
    const ownCurrent = current.find((m) => (m.teamA && m.teamA.id === online.id) || (m.teamB && m.teamB.id === online.id));
    const matchVisible = byId('screen-match-play') && !byId('screen-match-play').classList.contains('hidden');
    const activeServerMatch = gameState.activeMatch && gameState.activeMatch.onlineMatchId
      ? Object.values(data.stages || {}).flat().find((match) => match.id === gameState.activeMatch.onlineMatchId)
      : null;
    if (matchVisible && activeServerMatch && !activeServerMatch.played) return;
    renderBracketView();
    if (data.phase === 'finished') { showOnlineSummary(data); return; }
    if (ownCurrent && !ownCurrent.played) {
      const localMatch = gameState.bracket[data.stage].find((m) => m.onlineMatchId === ownCurrent.id);
      if (localMatch) {
        online.currentMatchId = localMatch.onlineMatchId;
        setPhaseBadge('MATA-MATA (' + String(data.stage).toUpperCase() + ')');
        window.showScreen('screen-tournament');
        return;
      }
    }
    if (ownCurrent && ownCurrent.played) {
      waiting('PARTIDA CONFIRMADA', 'Seu resultado está confirmado no servidor. Aguarde os outros confrontos; a próxima fase só será liberada quando todos terminarem.');
    } else {
      waiting('AGUARDANDO OUTRAS PARTIDAS', 'Sua equipe não tem confronto pendente nesta rodada. Os jogadores ativos continuam suas partidas; a fase só muda depois que todos os resultados forem confirmados.');
    }
  }
  function showOnlineSummary(data) {
    if (typeof originalSummary === 'function') originalSummary();
    const champion = data.champion || (data.participants || []).find((p) => p.id === data.championId);
    const won = Boolean(champion && champion.id === online.id);
    if (byId('summary-title')) byId('summary-title').textContent = won ? 'CAMPEÃO GINCANA 4x0!' : 'CAMPEÃO: ' + displayName(champion);
    if (byId('summary-subtitle')) byId('summary-subtitle').textContent = won
      ? 'Parabéns! Sua equipe conquistou o campeonato online.'
      : 'O campeonato online foi concluído. Confira os resultados e as estatísticas da sua campanha.';
    if (byId('summary-trophy-icon')) byId('summary-trophy-icon').textContent = won ? '🏆' : '⚽';
    const banner = byId('summary-banner');
    if (banner) { banner.classList.toggle('bg-yellow-400', won); banner.classList.toggle('bg-gray-100', !won); }
  }
  function rosterPayload() {
    return {
      formationKey: gameState.selectedFormationKey,
      mode: online.room && online.room.mode ? online.room.mode : gameState.selectedMode,
      teamName: gameState.currentDrawnRoom || 'Turma sorteada', captainPlayerId: gameState.captainPlayerId,
      squad: gameState.userSquad.map((entry) => ({
        slotId: entry.slotId,
        player: {
          id: entry.player.id,
          name: entry.player.name,
          position: entry.player.position,
          overall: entry.player.overall,
          room: entry.player.room
        }
      }))
    };
  }

  window.showScreen = function (screenId) {
    ['screen-online-lobby', 'screen-online-waiting'].forEach((id) => { if (byId(id)) byId(id).classList.add('hidden'); });
    originalShowScreen(screenId);
  };
  window.startDrafting = function () {
    if (online.enabled && online.code) emit('room:enterSetup', {}, (res) => { if (res && res.ok === false) setStatus(res.error, true); });
    return originalStartDrafting();
  };
  window.confirmCaptainAndStart = function () {
    if (!online.enabled || !online.code) return originalConfirm();
    if (!gameState.captainPlayerId || gameState.userSquad.length !== 7) return;
    const button = byId('btn-confirm-captain');
    const errorBox = byId('captain-save-error');
    if (errorBox) { errorBox.textContent = ''; errorBox.classList.add('hidden'); }
    if (button) { button.disabled = true; button.textContent = 'SALVANDO ELENCO...'; }
    waiting('ENVIANDO ELENCO', 'Salvando seu time. O campeonato fica bloqueado até todos terminarem a montagem.');
    emit('room:submitRoster', { roster: rosterPayload() }, (res) => {
      if (!res || !res.ok) {
        const message = res && res.error ? res.error : 'Não foi possível enviar o elenco.';
        setStatus(message, true);
        if (errorBox) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
        if (button) { button.disabled = false; button.textContent = 'TENTAR CONFIRMAR NOVAMENTE'; }
        window.showScreen('screen-captain');
        return;
      }
      restoreRoster(res.roster);
      if (button) button.textContent = 'ELENCO ENVIADO ✓';
      waiting('ELENCO CONFIRMADO', res.tournamentStarted
        ? 'Todos confirmaram os elencos! O mata-mata está começando e a tabela será sincronizada para a sala.'
        : 'Seu elenco está confirmado e salvo. Fique nesta tela; quando o último participante confirmar, o mata-mata começa automaticamente.');
    });
  };
  window.prepareAndLaunchMatch = function () {
    if (!online.enabled || !online.tournament) return originalPrepare();
    const match = (gameState.bracket[gameState.currentBracketStage] || []).find((item) => item.onlineIsMyMatch && !item.played);
    if (!match) { waiting('AGUARDANDO PARTIDAS', 'Você não tem uma partida pendente nesta rodada.'); return; }
    online.currentMatchId = match.onlineMatchId;
    if (!match.onlineIsController) {
      const controller = (online.tournament.participants || []).find((player) => player.id === match.onlineControllerId);
      waiting(
        'AGUARDANDO O CONFRONTO COMPARTILHADO',
        'Esta partida tem um único placar oficial para os dois times. ' +
          (controller ? controller.name : 'O responsável pela partida') +
          ' foi escolhido pelo servidor para executar a simulação; assim que terminar, o resultado será sincronizado para a sala.'
      );
      return;
    }
    gameState.activeMatch = match;
    setupUserMatchPreCalculations(match);
    initMatchSimulationUI(match);
  };
  window.finalizeFullTimeMatch = function () {
    if (!online.enabled || !online.tournament || !gameState.activeMatch) return originalFinalize();
    const match = gameState.activeMatch;
    if (match.onlineIsController) return originalFinalize();
    const oldCampaign = clone(gameState.campaignStats);
    const oldUserStats = clone(gameState.userPlayerStatsMap);
    const oldTournamentStats = clone(gameState.tournamentPlayerStatsMap);
    originalFinalize();
    gameState.campaignStats = oldCampaign;
    gameState.userPlayerStatsMap = oldUserStats;
    gameState.tournamentPlayerStatsMap = oldTournamentStats;
    if (byId('btn-next-after-match')) byId('btn-next-after-match').textContent = 'PARTIDA SIMULADA — AGUARDANDO RESULTADO OFICIAL';
  };
  window.proceedAfterMatch = function () {
    if (!online.enabled || !online.tournament) return originalProceed();
    const match = gameState.activeMatch;
    if (!match || !match.onlineMatchId) return originalProceed();
    if (!match.onlineIsController) {
      if (online.tournament.phase === 'finished') return showOnlineSummary(online.tournament);
      waiting('AGUARDANDO RESULTADO OFICIAL', 'O responsável pelo confronto enviará o resultado oficial. Depois que o placar aparecer como confirmado, clique em “Confirmar e aguardar os outros” para liberar a próxima fase.');
      return;
    }
    if (!match.played) { waiting('PARTIDA NÃO FINALIZADA', 'Finalize a simulação antes de enviar o resultado ao servidor.'); return; }
    if (match._onlineControllerCommitted) return;
    match._onlineControllerCommitted = true;
    const payload = {
      matchId: match.onlineMatchId, scoreA: match.scoreA, scoreB: match.scoreB,
      penaltyScoreA: match.scoreA === match.scoreB ? match.penaltyScoreA : null,
      penaltyScoreB: match.scoreA === match.scoreB ? match.penaltyScoreB : null,
      timeline: match.timeline || []
    };
    waiting('RESULTADO ENVIADO', 'O servidor recebeu o placar. Aguarde os outros confrontos da rodada.');
    emit('match:submit', payload, (res) => {
      if (!res || !res.ok) {
        match._onlineControllerCommitted = false;
        const message = res && res.error ? res.error : 'Não foi possível confirmar o resultado.';
        setStatus(message, true);
        waiting('RESULTADO PENDENTE', message + ' Tente confirmar novamente.');
      }
    });
  };

  function setupHandlers() {
    const nameInput = byId('online-player-name');
    if (nameInput && online.name) nameInput.value = online.name;
    const roomModeClassic = byId('btn-room-mode-classic');
    if (roomModeClassic) roomModeClassic.addEventListener('click', () => {
      emit('room:setMode', { mode: 'classic' }, (res) => {
        if (!res || !res.ok) return setStatus(res && res.error ? res.error : 'Não foi possível alterar o modo.', true);
        renderRoom(res.state);
        setStatus('Modo da sala definido: OVR visível para todos.');
      });
    });
    const roomModeBlind = byId('btn-room-mode-blind');
    if (roomModeBlind) roomModeBlind.addEventListener('click', () => {
      emit('room:setMode', { mode: 'blind' }, (res) => {
        if (!res || !res.ok) return setStatus(res && res.error ? res.error : 'Não foi possível alterar o modo.', true);
        renderRoom(res.state);
        setStatus('Modo da sala definido: OVR oculto para todos.');
      });
    });
    const confirmStage = byId('btn-online-confirm-stage');
    if (confirmStage) confirmStage.addEventListener('click', () => {
      const tournament = online.tournament;
      if (!tournament || !tournament.stage) return;
      const requestedStage = tournament.stage;
      confirmStage.disabled = true;
      confirmStage.textContent = 'REGISTRANDO CONFIRMAÇÃO...';
      emit('stage:confirm', { stage: requestedStage }, (res) => {
        if (!res || !res.ok) {
          confirmStage.disabled = false;
          const message = res && res.error ? res.error : 'Não foi possível confirmar a próxima fase.';
          setStatus(message, true);
          return renderStageReadyButton();
        }
        if (online.tournament && online.tournament.phase === 'playing' && online.tournament.stage === requestedStage) {
          waiting('CONFIRMAÇÃO REGISTRADA', 'Sua confirmação ficou salva. ' +
            (res.readyCount || 0) + '/' + (res.requiredReadyCount || 0) +
            ' participantes ativos confirmaram; a fase avança automaticamente quando todos confirmarem.');
        }
      });
    });
    const create = byId('btn-online-create');
    if (create) create.addEventListener('click', () => {
      if (!window.gincanaSocket || !window.gincanaSocket.connected) return setStatus('O servidor não está conectado. Abra a versão hospedada no Render.', true);
      const name = ((nameInput && nameInput.value) || '').trim().slice(0, 24);
      if (name.length < 2) return setStatus('Digite um nome com pelo menos 2 caracteres.', true);
      emit('room:create', { playerId: online.id, name }, (res) => {
        if (!res || !res.ok) { setStatus(res && res.error ? res.error : 'Não foi possível criar a sala.', true); return; }
        online.enabled = true; online.code = res.state.code; online.name = name; online.hostId = res.state.hostId;
        put(STORE_ROOM, online.code); put(STORE_NAME, name); renderRoom(res.state); window.showScreen('screen-online-lobby');
      });
    });
    const join = byId('btn-online-join');
    if (join) join.addEventListener('click', () => {
      if (!window.gincanaSocket || !window.gincanaSocket.connected) return setStatus('O servidor não está conectado. Abra a versão hospedada no Render.', true);
      const name = ((nameInput && nameInput.value) || '').trim().slice(0, 24);
      const code = ((byId('online-room-code-input') && byId('online-room-code-input').value) || '').trim().toUpperCase();
      if (name.length < 2 || !code) return setStatus('Digite seu nome e o código da sala.', true);
      emit('room:join', { playerId: online.id, name, code }, (res) => {
        if (!res || !res.ok) { setStatus(res && res.error ? res.error : 'Não foi possível entrar na sala.', true); return; }
        online.enabled = true; online.code = res.state.code; online.name = name; online.hostId = res.state.hostId;
        put(STORE_ROOM, online.code); put(STORE_NAME, name); renderRoom(res.state); if (res.roster) restoreRoster(res.roster);
        window.showScreen('screen-online-lobby');
      });
    });
    const enter = byId('btn-online-enter-setup');
    if (enter) enter.addEventListener('click', () => {
      if (!online.enabled || !online.code) return;
      emit('room:enterSetup', {}, (res) => { if (res && res.ok === false) setStatus(res.error, true); });
      window.showScreen('screen-setup');
    });
    const leave = byId('btn-online-leave-room');
    if (leave) leave.addEventListener('click', () => emit('room:leave', {}, (res) => {
      if (!res || !res.ok) return setStatus(res && res.error ? res.error : 'Não foi possível sair da sala.', true);
      online.enabled = false; online.code = ''; online.room = null; online.tournament = null;
      ['btn-mode-classic', 'btn-mode-blind'].forEach((id) => {
        const button = byId(id);
        if (button) { button.disabled = false; button.classList.remove('opacity-50', 'cursor-not-allowed'); }
      });
      put(STORE_ROOM, '');
      if (byId('online-room-panel')) byId('online-room-panel').classList.add('hidden');
      setStatus('Você saiu da sala. Pode criar outra ou jogar offline.');
      window.showScreen('screen-online-lobby');
    }));
    const copyButton = byId('btn-online-copy-code');
    if (copyButton) copyButton.addEventListener('click', () => {
      if (!online.code) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(online.code).then(() => setStatus('Código copiado: ' + online.code)).catch(() => setStatus('Código da sala: ' + online.code));
      } else setStatus('Código da sala: ' + online.code);
    });
    const offline = byId('btn-offline-mode');
    if (offline) offline.addEventListener('click', () => {
      const finish = () => {
        online.enabled = false; online.code = ''; online.room = null; online.tournament = null;
        ['btn-mode-classic', 'btn-mode-blind'].forEach((id) => {
          const button = byId(id);
          if (button) { button.disabled = false; button.classList.remove('opacity-50', 'cursor-not-allowed'); }
        });
        put(STORE_ROOM, '');
        if (byId('online-room-panel')) byId('online-room-panel').classList.add('hidden');
        window.showScreen('screen-setup');
      };
      if (online.enabled && online.code && online.room && !['tournament', 'finished'].includes(online.room.phase)) emit('room:leave', {}, finish);
      else finish();
    });
    const launch = byId('btn-online-launch-tournament');
    if (launch) launch.addEventListener('click', () => {
      launch.disabled = true;
      emit('room:startTournament', {}, (res) => {
        if (!res || !res.ok) { launch.disabled = false; setStatus(res && res.error ? res.error : 'Não foi possível iniciar o campeonato.', true); return; }
        waiting('SORTEANDO AS OITAVAS', 'O servidor está montando a tabela oficial. A rodada só termina quando todos os confrontos estiverem confirmados.');
      });
    });
    const back = byId('btn-online-back-to-lobby');
    if (back) back.addEventListener('click', () => {
      if (online.tournament) {
        const current = online.tournament.stages && online.tournament.stages[online.tournament.stage] || [];
        const own = current.find((m) => (m.teamA && m.teamA.id === online.id) || (m.teamB && m.teamB.id === online.id));
        if (own && !own.played) window.showScreen('screen-tournament');
        else window.showScreen('screen-online-waiting');
      } else window.showScreen('screen-online-lobby');
    });
  }
  window.addEventListener('load', () => {
    setupHandlers();
    if (typeof window.io === 'function') connectOnline();
    else setStatus('Modo online requer servidor Node/Render. Você ainda pode usar “JOGAR OFFLINE”.', true);
    if (online.enabled && online.code) waiting('RECONECTANDO À SALA', 'Recuperando a sala e o estado oficial do servidor…');
    else window.showScreen('screen-online-lobby');
  });
})();