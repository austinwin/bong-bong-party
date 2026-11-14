import { Arena, drawPreview } from './arena.js';
import { ArcadeAudio, assetUrl, avatarUrl, loadIllustrations, loadImages, loadMotion, readManifest } from './media.js';
import { stickIntent } from './movement.js';

const $ = id => document.getElementById(id);
const names = {
  berry_pixie: 'Bé Dâu', cloud_tech: 'Mây Xanh', duckling: 'Vịt Vàng', fox_scout: 'Cáo Cam',
  frog_kid: 'Ếch Xanh', little_bat: 'Dơi Tím', night_wizard: 'Phù Thủy', turtle_scholar: 'Rùa Con',
};
const items = {
  extra_balloon: 'Thêm bóng', water_range: 'Sức nước', speed: 'Tăng tốc', skates: 'Giày trượt',
  kick: 'Đá bóng', glove: 'Găng ném', shield: 'Khiên', remote: 'Điều khiển nổ', star: 'Ngôi sao',
};
const directionKeys = {
  ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right',
};
const directions = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] };
const effects = {
  bomb: ['place', 'balloon_place'], inflate: ['balloon_inflate'],
  splash: ['splash', 'water_burst'], trap: ['bubble', 'trapped_in_bubble'],
  rescue: ['rescue', 'rescue_teammate'], pickup: ['prize', 'pickup'],
  speed_boost: ['speed_boost'], shield: ['prize', 'pickup'], kick: ['kick', 'throw'], out: ['pop'],
  cheer: ['cheer', 'pickup'],
};
const trackNames = {
  bubble_plaza: 'Sảnh Bóng Bóng', village_dash: 'Đường Làng', frost_hop: 'Sân Băng',
  original_retro_lobby_loop: 'Nhạc sảnh cổ điển',
};
const connectionErrors = {
  4000: 'Phòng đang mở ở một thẻ khác.',
  4401: 'Phiên đã hết hạn. Vui lòng tải lại trang.',
  4403: 'Kết nối bị từ chối.',
  4404: 'Không tìm thấy phòng.',
  4409: 'Phòng đã đầy.',
};
function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
const initialAvatar = stored('bb_avatar', 'frog_kid');
const state = {
  avatar: names[initialAvatar] ? initialAvatar : 'frog_kid', nick: stored('bb_nick', ''),
  room: '', id: '', socket: null, world: null, retries: 0, lastEvent: 0, seq: 0,
  keys: new Set(), stick: null, overview: savedOverview(),
  haptics: stored('bb_haptics', 'on') === 'on',
  stickSide: stored('bb_stick_side', 'left') === 'right' ? 'right' : 'left',
  stickReach: stored('bb_stick_reach', 'normal') === 'short' ? 'short' : 'normal',
  pending: false, ready: false, chatIds: new Set(), cheerUntil: 0,
};
function volume(key, fallback) {
  const value = Number(stored(key, fallback));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : fallback / 100;
}
const preferences = {
  music: stored('bb_music', 'on') !== 'off', sfx: stored('bb_sfx', 'on') !== 'off',
  musicVolume: volume('bb_music_vol', 55), sfxVolume: volume('bb_sfx_vol', 70),
};
const audio = new ArcadeAudio(preferences, showAudioStatus);
const compactMatch = matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 540px)');
const arena = new Arena($('gameCanvas'));
let maps = {};

function savedOverview() {
  const value = stored('bb_camera', null);
  return value === null ? null : value === 'off';
}

function showOverview() {
  return state.overview ?? !compactMatch.matches;
}

function status(text, connected = false) {
  $('serverStatus').textContent = text;
  $('serverStatus').classList.toggle('ok', connected);
}

function toast(text, duration = 2400) {
  const node = $('gameToast');
  clearTimeout(toast.timer);
  const container = state.world?.state === 'playing' ? $('arena') : document.body;
  if (node.parentNode !== container) container.append(node);
  node.textContent = text;
  node.hidden = false;
  toast.timer = setTimeout(() => { node.hidden = true; }, duration);
}

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function image(category, name, alt = '') {
  const img = new Image();
  img.src = category === '01_characters' ? avatarUrl(name) : assetUrl(category, name + '.png');
  img.alt = alt;
  return img;
}

function profile() {
  state.nick = $('nickname').value.trim().replace(/[<>\x00-\x1f\x7f]/g, '').slice(0, 16) || state.nick || 'Khách nhỏ';
  $('nickname').value = state.nick;
  save('bb_nick', state.nick);
}

function chooseAvatar(avatar) {
  state.avatar = avatar;
  save('bb_avatar', avatar);
  $('selectedAvatar').src = avatarUrl(avatar);
  $('selectedAvatarName').textContent = names[avatar];
  for (const button of $('avatarPicker').children) {
    button.classList.toggle('selected', button.dataset.avatar === avatar);
    button.setAttribute('aria-pressed', String(button.dataset.avatar === avatar));
  }
}

async function publicRooms() {
  const response = await fetch('/api/rooms', { cache: 'no-store' });
  if (!response.ok) throw new Error('Không tải được phòng.');
  return response.json();
}

async function refreshRooms() {
  try {
    const rooms = await publicRooms();
    $('roomCount').textContent = `${rooms.length} phòng công khai`;
    const list = $('roomList');
    const key = JSON.stringify(rooms);
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.replaceChildren();
    if (!rooms.length) {
      list.append(node('p', 'Chưa có phòng. Chơi nhanh hoặc tạo phòng để mời bạn!', 'empty-list'));
    }
    for (const room of rooms) {
      const row = node('div', undefined, 'room-row');
      const action = node('button', room.state === 'playing' ? 'Xem' : 'Vào', 'blue-button');
      action.disabled = room.open === 0;
      action.setAttribute('aria-label', `${action.textContent} phòng ${room.id}`);
      action.addEventListener('click', () => enter(room.id));
      row.append(node('strong', room.id), node('span', maps[room.map]?.name || room.map),
        node('span', `${room.players}/${room.capacity} · ${room.mode === 'teams' ? 'Đội' : 'Tự do'}`), action);
      list.append(row);
    }
  } catch (error) {
    $('roomCount').textContent = '';
    $('roomList').dataset.key = '';
    $('roomList').replaceChildren(node('p', error.message, 'empty-list'));
  }
}

async function findRoom(mode) {
  if (state.pending || state.room) return;
  audio.unlock();
  state.pending = true;
  try {
    const path = mode === 'quick' ? '/api/match' : mode === 'practice' ? '/api/rooms?practice=true' : '/api/rooms';
    const response = await fetch(path, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Không tạo được phòng.');
    enter(result.id, true);
  } catch (error) {
    toast(error.message);
  } finally {
    state.pending = false;
  }
}

function enter(rawCode, fromSearch = false) {
  const code = String(rawCode).trim().toUpperCase();
  if (!state.ready || state.room || (state.pending && !fromSearch)) return;
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    toast('Mã phòng gồm 6 chữ cái hoặc số từ 2 đến 9.');
    return;
  }
  profile();
  audio.unlock();
  state.room = code;
  state.retries = 0;
  state.chatIds.clear();
  state.inventoryKey = '';
  $('shareRoom').hidden = false;
  $('roomTag').hidden = false;
  $('matchTitle').textContent = 'Phòng chờ';
  $('matchCount').textContent = '';
  $('timer').textContent = '02:45';
  $('chatMessages').replaceChildren();
  $('currentRoom').textContent = code;
  $('homeScreen').hidden = true;
  $('gameScreen').hidden = false;
  $('boardOverlay').hidden = false;
  $('roundSummary').hidden = true;
  $('overlayTitle').textContent = 'Phòng chờ';
  $('overlayDesc').textContent = '';
  $('waitingNote').textContent = 'Đang kết nối phòng…';
  $('overlayPlayers').replaceChildren();
  $('roster').replaceChildren();
  $('startGame').hidden = true;
  $('readyButton').hidden = true;
  history.replaceState({}, '', '?room=' + code);
  window.scrollTo(0, 0);
  connect();
}

function send(message) {
  if (state.socket?.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(message));
  return true;
}

function leave(explicit = true) {
  if (explicit) send({ type: 'leave' });
  const old = state.socket;
  state.socket = null;
  old?.close();
  state.room = '';
  state.id = '';
  state.world = null;
  state.rosterKey = state.overlayKey = '';
  clearInput();
  arena.reset();
  audio.scene();
  state.previewAction = null;
  state.cheerUntil = 0;
  $('gameScreen').hidden = true;
  $('arena').hidden = true;
  $('matchReadout').hidden = true;
  $('controlSettings').hidden = true;
  $('playControls').hidden = true;
  $('statsPanel').hidden = true;
  toggleSoundPanel(false);
  document.body.classList.remove('in-match');
  updateMatchLayout();
  $('homeScreen').hidden = false;
  $('gameToast').hidden = true;
  history.replaceState({}, '', location.pathname);
  status('Sẵn sàng', true);
  refreshRooms();
}

function connect() {
  if (!state.room) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ name: state.nick, avatar: state.avatar });
  const socket = new WebSocket(`${protocol}//${location.host}/ws/${state.room}?${query}`);
  state.socket = socket;
  status('Đang vào phòng…');
  socket.addEventListener('message', event => {
    if (state.socket !== socket) return;
    const message = JSON.parse(event.data);
    if (message.type === 'welcome') {
      state.id = message.id;
      state.retries = 0;
      state.seq = 0;
      state.lastEvent = 0;
      state.firstSnapshot = true;
      state.lastRevision = 0;
      state.sentIntent = null;
      arena.resetLocalInput();
      status('Đã kết nối', true);
    } else if (message.type === 'state' && message.revision > state.lastRevision) {
      state.lastRevision = message.revision;
      receive(message);
    }
  });
  socket.addEventListener('close', event => {
    if (state.socket !== socket) return;
    clearInput();
    if (connectionErrors[event.code] || state.retries === 9) {
      const message = connectionErrors[event.code] || 'Không thể kết nối lại.';
      leave(false);
      toast(message, 4000);
      return;
    }
    status('Đang kết nối lại…');
    toast('Đang kết nối lại…');
    const delay = Math.min(5500, 430 * 1.62 ** state.retries++);
    setTimeout(() => {
      if (state.socket === socket) connect();
    }, delay);
  });
}

function receive(world) {
  const previous = state.world;
  state.world = world;
  for (const event of world.events) {
    if (event.id > state.lastEvent && (!state.firstSnapshot || event.type === 'chat')) handleEvent(event);
    state.lastEvent = Math.max(event.id, state.lastEvent);
  }
  const first = state.firstSnapshot;
  state.firstSnapshot = false;
  if (world.countdown && world.countdown !== previous?.countdown) audio.play('countdown_tick');
  if (previous?.countdown && !world.countdown && world.state === 'playing') audio.play('go', { gain: .8 });
  if (!first && world.state === 'finished' && previous?.state !== 'finished') {
    audio.result(winner(localPlayer(), world));
  }
  const active = world.state === 'playing';
  audio.scene(active, active && world.time <= 30, world.map);
  if (!active && previous?.map !== world.map) audio.prepareMatch(world.map);
  const me = localPlayer();
  const wasActive = previous?.state === 'playing';
  if (world.round !== previous?.round) {
    state.cheerUntil = 0;
    state.practiceMoved = false;
  }
  if (active !== wasActive || world.round !== previous?.round ||
      ((!me?.alive || me.trapped) && (state.stick || state.keys.size))) {
    clearInput();
    state.previewAction = null;
  }
  $('arena').hidden = $('statsPanel').hidden = !active;
  $('playControls').hidden = !active || !me || me.spectator;
  $('controlSettings').hidden = $('playControls').hidden;
  $('zoomMap').hidden = !me?.alive;
  const controlsDisabled = !me?.alive || me?.trapped || Boolean(world.countdown);
  const available = me && !me.spectator && active
    ? Math.max(0, me.capacity - world.bombs.filter(bomb => bomb.owner === me.id).length)
    : 0;
  $('mobileBomb').disabled = controlsDisabled || available === 0;
  $('cheer').disabled = controlsDisabled || performance.now() < state.cheerUntil;
  $('mobileBomb').dataset.remaining = active && me && !me.spectator ? available : '';
  $('boardOverlay').hidden = active;
  $('shareRoom').hidden = world.practice;
  $('roomTag').hidden = world.practice;
  $('matchTitle').textContent = world.practice ? 'Tập chơi' : maps[world.map].name;
  document.body.classList.toggle('in-match', active);
  if (active !== wasActive) {
    $('gameToast').hidden = true;
    window.scrollTo(0, 0);
  }
  const mins = String(Math.floor(world.time / 60)).padStart(2, '0');
  setText('timer', mins + ':' + String(world.time % 60).padStart(2, '0'));
  $('timer').parentElement.classList.toggle('urgent', active && world.time <= 30);
  const count = `${world.players.filter(player => player.connected).length} / ${world.practice ? 1 : 8}`;
  $('playerCounter').textContent = $('matchCount').textContent = count;
  $('detailsCount').textContent = count;
  if (active) arena.receive(world, maps[world.map], state.id);
  else renderRoom(world);
  renderRoster(world);
  $('matchReadout').hidden = !active || !me || me.spectator;
  if (active) {
    renderInventory(me, controlsDisabled);
    if (me && !me.spectator) renderMatchReadout(world, me, available);
  }
  if (active !== wasActive) updateMatchLayout();
}

function localPlayer() {
  return state.world?.players.find(player => player.id === state.id);
}

function winner(player, world) {
  return player && !player.spectator && (world.mode === 'teams' ? String(player.team) === world.winner : player.id === world.winner);
}

function setText(id, value) {
  const label = $(id);
  const text = String(value);
  if (label.textContent !== text) label.textContent = text;
}

function renderMatchReadout(world, me, available) {
  const badge = $('playerBadge');
  const avatar = avatarUrl(me.avatar);
  if ($('playerPortrait').getAttribute('src') !== avatar) $('playerPortrait').src = avatar;
  badge.dataset.condition = me.trapped ? 'trapped' : me.alive ? 'active' : 'out';
  const trapped = me.bubbleTime ? `Bị nhốt ${me.bubbleTime}s` : 'Bị nhốt';
  setText('playerReadiness', me.trapped ? trapped : me.alive ? me.name : 'Đã loại');
  setText('gearBalloon', `${available}/${me.capacity}`);
  setText('gearRange', me.power);
  setText('gearSpeed', me.speed.toFixed(1));
  const tip = $('practiceTip');
  tip.hidden = !world.practice || !me.alive || me.trapped;
  if (!tip.hidden) {
    state.practiceMoved ||= Math.hypot(me.x - 1.5, me.y - 1.5) > .64;
    const stats = me.roundStats || {};
    setText('practiceTip', !state.practiceMoved ? 'Kéo cần để di chuyển' : !stats.placed ? 'Thử đặt một bóng nước' :
      !stats.cleared ? 'Phá thùng, né tia nước' : !stats.collected ? 'Tìm và nhặt vật phẩm' : 'Đã hoàn thành tập chơi!');
  }
}

function renderSummary(me, world) {
  const summary = $('roundSummary');
  summary.hidden = world.state !== 'finished' || !me || me.spectator;
  if (summary.hidden) return;
  const { cleared = 0, collected = 0, rescued = 0 } = me.roundStats || {};
  summary.dataset.result = winner(me, world) ? 'win' : world.winner === 'draw' ? 'draw' : 'loss';
  const stats = [['03_obstacles', 'wood_crate', cleared, 'Thùng đã phá'],
    ['04_powerups', 'star', collected, 'Vật phẩm']];
  if (!world.practice && world.mode === 'teams') stats.push(['04_powerups', 'shield', rescued, 'Đồng đội đã cứu']);
  summary.replaceChildren(...stats.map(([category, art, total, label]) => {
    const stat = node('div', undefined, 'round-stat');
    stat.append(image(category, art), node('strong', total), node('span', label));
    return stat;
  }));
}

function handleEvent(event) {
  if (event.type === 'chat') {
    if (state.chatIds.has(event.id)) return;
    state.chatIds.add(event.id);
    const row = node('p');
    row.append(node('b', event.name + ' '), document.createTextNode(event.text));
    const log = $('chatMessages');
    log.append(row);
    if (log.children.length > 60) log.firstChild.remove();
    if (state.chatIds.size > 120) state.chatIds.delete(state.chatIds.values().next().value);
    log.scrollTop = log.scrollHeight;
    return;
  }
  arena.react(event);
  const self = event.who === state.id;
  const [sound, fallback] = event.thrown ? ['throw', 'balloon_place'] : effects[event.type] || [];
  const recentPreview = state.previewAction && performance.now() - state.previewAction.time < 650;
  if (sound && !(self && ((event.type === 'bomb' && recentPreview) || event.type === 'cheer'))) {
    const me = localPlayer();
    const distance = me?.alive && Number.isFinite(event.x) && Number.isFinite(event.y)
      ? Math.hypot(me.x - event.x, me.y - event.y) : 2.5;
    const gain = self ? 1 : Math.max(.33, 1 - distance * .105);
    audio.play(sound, { fallback, gap: .067, gain });
  }
  if (self && event.type === 'bomb') state.previewAction = null;
  if (self && ['pickup', 'rescue', 'trap', 'shield'].includes(event.type)) {
    if (state.haptics) navigator.vibrate?.(event.type === 'trap' ? [18, 35, 20] : 14);
  }
  if (event.who !== state.id) return;
  if (event.type === 'trap') toast(state.world.mode === 'teams' ? 'Bị nhốt! Chờ đồng đội cứu.' : 'Bạn bị nhốt trong bóng nước!');
  if (event.type === 'rescue') toast('Đồng đội đã cứu bạn!');
  if (event.type === 'out') toast('Bạn đã bị loại.');
  if (event.type === 'pickup') toast('Nhặt được ' + items[event.kind], 1400);
}

function renderRoom(world) {
  // Settings and focused inputs survive snapshots with no room changes.
  const key = JSON.stringify([world.state, world.round, world.host, world.map, world.mode, world.winner,
    world.players.map(p => [p.id, p.name, p.avatar, p.ready, p.connected, p.spectator, p.team])]);
  if (state.overlayKey === key) return;
  state.overlayKey = key;
  const finished = world.state === 'finished';
  const host = world.host === state.id;
  const me = localPlayer();
  renderSummary(me, world);
  const ready = $('readyButton'), start = $('startGame');
  const connected = world.players.filter(player => player.connected);
  const unready = connected.some(player => player.id !== state.id && !player.ready);
  const enough = connected.length >= (world.practice ? 1 : 2);
  $('overlayTitle').textContent = world.practice ? (finished ? 'Kết thúc tập chơi' : 'Tập chơi') :
    !finished ? 'Phòng chờ' : world.winner === 'draw' ? 'Trận hòa' : winner(me, world) ? 'Chiến thắng!' : 'Kết thúc trận';
  const winners = world.players.filter(player => winner(player, world));
  $('overlayDesc').textContent = finished && winners.length ? winners.map(player => player.name).join(', ') : '';
  $('mapPicker').value = world.map;
  $('mapPicker').disabled = !host;
  for (const button of $('modeButtons').children) {
    button.classList.toggle('selected', button.dataset.mode === world.mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === world.mode));
    button.disabled = !host || world.practice;
  }
  drawPreview($('mapPreview'), maps[world.map], world);
  const slots = [];
  for (let index = 0; index < (world.practice ? 1 : 8); index++) {
    const player = world.players[index];
    const card = node('div', undefined, 'waiting-player');
    if (!player) {
      card.classList.add('empty');
      card.textContent = 'Còn trống';
    } else {
      card.classList.toggle('winner', finished && winner(player, world));
      card.classList.toggle('ready', player.ready);
      const label = !player.connected ? 'Mất kết nối' : player.id === world.host ? 'Chủ phòng' : player.ready ? 'Sẵn sàng' : 'Chưa sẵn sàng';
      card.append(image('01_characters', player.avatar), node('strong', player.name), node('small', label));
    }
    slots.push(card);
  }
  $('overlayPlayers').replaceChildren(...slots);
  ready.hidden = host;
  ready.classList.toggle('sprite-ready', !me?.ready);
  ready.classList.toggle('sprite-cancel', Boolean(me?.ready));
  ready.setAttribute('aria-label', me?.ready ? 'Hủy sẵn sàng' : 'Sẵn sàng');
  start.hidden = !host;
  start.disabled = !enough || unready;
  start.classList.toggle('replay-button', finished);
  start.firstElementChild.hidden = !finished;
  start.setAttribute('aria-label', finished ? 'Chơi lại' : 'Bắt đầu');
  $('waitingNote').textContent = !host ? 'Chờ chủ phòng bắt đầu.' :
    !enough ? 'Mời thêm người để bắt đầu.' : unready ? 'Chờ mọi người sẵn sàng.' :
    '';
}

function renderRoster(world) {
  const key = JSON.stringify([world.state, world.mode, world.host,
    world.players.map(p => [p.id, p.avatar, p.name, p.team, p.score, p.trapped, p.alive, p.connected, p.spectator])]);
  if (key === state.rosterKey) return;
  state.rosterKey = key;
  $('roster').replaceChildren(...world.players.map(player => {
    const row = node('div', undefined, 'player-card');
    row.classList.toggle('mine', player.id === state.id);
    row.classList.toggle('team-one', world.mode === 'teams' && player.team === 1);
    row.classList.toggle('dead', !player.alive && !player.spectator);
    row.classList.toggle('trapped', player.trapped);
    row.classList.toggle('disconnected', !player.connected);
    const info = node('div', undefined, 'player-meta');
    const status = !player.connected ? 'Mất kết nối' : player.spectator ? 'Đang xem' :
      player.trapped ? 'Bị nhốt' : !player.alive ? 'Đã loại' : `${player.score} điểm`;
    info.append(node('b', player.name + (player.id === world.host ? ' ★' : '')),
      node('small', (world.mode === 'teams' ? `Đội ${player.team + 1} · ` : '') + status));
    row.append(image('01_characters', player.avatar), info);
    return row;
  }));
}

function renderInventory(me, controlsDisabled) {
  if (!me) return;
  const owned = { ...me, speed: me.speed > 3, water_range: me.power > 2,
    extra_balloon: me.capacity > 1, skates: me.skates };
  const key = JSON.stringify([controlsDisabled, me.spectator, me.speed, me.power, me.capacity, me.skates, me.kick, me.glove, me.remote, me.shield, me.star]);
  if (state.inventoryKey === key) return;
  state.inventoryKey = key;
  for (const img of $('inventory').children) img.style.opacity = owned[img.dataset.kind] ? '1' : '.45';
  $('myStats').textContent = me.spectator ? 'Đang xem trận đấu' :
    `Bóng ${me.capacity} · Sức nước ${me.power} · Tốc độ ${me.speed.toFixed(1)}`;
  $('mobileThrow').hidden = !me.glove;
  $('mobileRemote').hidden = !me.remote;
  $('mobileThrow').disabled = $('mobileRemote').disabled = controlsDisabled;
}

function move(keepAlive = false) {
  if (state.world?.state !== 'playing') return;
  const player = localPlayer();
  const canMove = player?.alive && !player.trapped && !state.world.countdown;
  const dir = canMove ? (state.stick?.direction ?? directionKeys[Array.from(state.keys).at(-1)] ?? '') : '';
  const pace = dir ? state.stick?.pace ?? 3 : 0;
  const stick = $('joystick');
  if (stick.dataset.active !== dir) stick.dataset.active = dir;
  if (stick.dataset.pace !== String(pace)) stick.dataset.pace = pace;
  const intent = dir + pace;
  if (state.sentIntent === intent && !(keepAlive && dir)) return;
  const [dx, dy] = directions[dir] || [0, 0];
  if (send({ type: 'input', dx, dy, pace, seq: ++state.seq })) {
    state.sentIntent = intent;
    arena.move(dx, dy, pace, state.seq);
  }
}

function resetStick() {
  const stick = $('joystick');
  const pointer = state.stick?.id;
  state.stick = null;
  if (pointer !== undefined && stick.hasPointerCapture(pointer)) stick.releasePointerCapture(pointer);
  stick.classList.remove('grabbed');
  stick.style.removeProperty('--stick-x');
  stick.style.removeProperty('--stick-y');
}

function clearInput() {
  state.keys.clear();
  resetStick();
  move();
  arena.move(0, 0, 0, state.seq);
}

function act(type) {
  const me = localPlayer();
  if (state.world?.state !== 'playing' || state.world.countdown || !me?.alive || me.trapped) return;
  if ((type === 'throw' && !me.glove) || (type === 'detonate' && !me.remote)) return;
  if (type !== 'detonate' && state.world.bombs.filter(bomb => bomb.owner === me.id).length >= me.capacity) return;
  if (!send({ type, round: state.world.round, seq: ++state.seq })) return;
  if (type === 'detonate') return;
  const time = performance.now();
  const last = state.previewAction;
  if (last && time - last.time < 290) return;
  arena.cue(type);
  state.previewAction = { time };
  audio.play(type === 'throw' ? 'throw' : 'place', { fallback: 'balloon_place', gain: .85 });
  if (state.haptics) navigator.vibrate?.(10);
}

function updateAudioControls() {
  $('musicToggle').setAttribute('aria-pressed', String(preferences.music));
  $('soundToggle').setAttribute('aria-pressed', String(preferences.sfx));
  $('testSound').disabled = !preferences.sfx || !preferences.sfxVolume;
  audio.update();
}

function showAudioStatus(status, track) {
  setText('soundTrack', trackNames[track] || '');
  $('soundTrack').hidden = !trackNames[track];
  const button = $('audioSettings');
  if (button.dataset.audio === status && button.hasAttribute('aria-label')) return;
  const labels = { locked: 'Bật âm thanh', loading: 'Đang tải âm thanh', on: 'Âm thanh', muted: 'Âm thanh tắt', unavailable: 'Thử lại âm thanh' };
  const messages = {
    locked: 'Chạm để bật hoặc khôi phục âm thanh.',
    loading: 'Đang tải âm thanh…',
    on: 'Âm thanh đã sẵn sàng.',
    muted: 'Nhạc và hiệu ứng đang tắt.',
    unavailable: 'Âm thanh chưa tải được. Hãy thử lại.',
  };
  $('audioLabel').textContent = labels[status];
  button.dataset.audio = status;
  button.setAttribute('aria-label', labels[status]);
  $('audioStatus').textContent = messages[status];
}

function toggleSoundPanel(open) {
  $('soundPanel').hidden = !open;
  $('audioSettings').setAttribute('aria-expanded', String(open));
}

function toggleMatchDetails(open, returnFocus = false) {
  $('gameScreen').classList.toggle('details-open', open);
  $('matchDetails').setAttribute('aria-expanded', String(open));
  $('detailsBackdrop').hidden = !open;
  $('gameSide').inert = compactMatch.matches && document.body.classList.contains('in-match') && !open;
  document.querySelector('.play-panel').inert = open;
  if (open) $('closeDetails').focus();
  else if (returnFocus) $('matchDetails').focus();
}

function updateMatchLayout() {
  const compact = compactMatch.matches && document.body.classList.contains('in-match');
  const parent = document.querySelector(compact ? '.match-actions' : '.header-actions');
  if ($('audioSettings').parentNode !== parent) parent.prepend($('audioSettings'));
  const shareParent = compact ? $('detailsActions') : document.querySelector('.match-actions');
  if ($('shareRoom').parentNode !== shareParent) shareParent.prepend($('shareRoom'));
  updateCameraButton();
  toggleMatchDetails(false);
}

function updateCameraButton() {
  const overview = showOverview();
  $('zoomMap').setAttribute('aria-pressed', String(overview));
  $('zoomMap').setAttribute('aria-label', overview ? 'Bật camera theo nhân vật' : 'Xem toàn bản đồ');
  $('cameraLabel').textContent = overview ? 'Toàn bản đồ' : 'Theo nhân vật';
  $('zoomMap').title = overview ? 'Chuyển sang theo nhân vật' : 'Chuyển sang toàn bản đồ';
}

function bind() {
  $('quickPlay').onclick = () => findRoom('quick');
  $('createRoom').onclick = () => findRoom('public');
  $('practice').onclick = () => findRoom('practice');
  $('refreshRooms').onclick = refreshRooms;
  $('leaveRoom').onclick = () => leave();
  $('logo').onclick = () => { if (state.room) leave(); };
  $('nickname').onchange = profile;
  $('joinForm').onsubmit = event => { event.preventDefault(); enter($('roomCode').value); };
  $('shareRoom').onclick = async () => {
    if (!navigator.clipboard?.writeText && navigator.share) {
      try {
        await navigator.share({ title: 'Bong Bong Party', url: location.href });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Đã sao chép liên kết mời!');
    } catch {
      window.prompt('Liên kết mời', location.href);
    }
  };
  $('readyButton').onclick = () => send({ type: 'ready', value: !localPlayer()?.ready });
  $('startGame').onclick = () => send({ type: 'start' });
  $('mapPicker').onchange = event => send({ type: 'map', value: event.target.value });
  for (const button of $('modeButtons').children) button.onclick = () => send({ type: 'mode', value: button.dataset.mode });
  $('chatForm').onsubmit = event => {
    event.preventDefault();
    const input = $('chatInput');
    if (input.value.trim() && send({ type: 'chat', value: input.value.trim() })) input.value = '';
  };
  $('audioSettings').onclick = () => {
    const retry = ['locked', 'unavailable'].includes($('audioSettings').dataset.audio);
    audio.unlock({ testSound: retry, retry });
    toggleSoundPanel($('soundPanel').hidden || retry);
  };
  $('testSound').onclick = () => audio.unlock({ testSound: true, retry: true });
  $('hapticsToggle').hidden = typeof navigator.vibrate !== 'function';
  $('hapticsToggle').setAttribute('aria-pressed', String(state.haptics));
  $('hapticsToggle').onclick = () => {
    state.haptics = !state.haptics;
    save('bb_haptics', state.haptics ? 'on' : 'off');
    $('hapticsToggle').setAttribute('aria-pressed', String(state.haptics));
    if (state.haptics) navigator.vibrate?.(15);
  };
  $('musicToggle').onclick = () => {
    preferences.music = !preferences.music;
    save('bb_music', preferences.music ? 'on' : 'off');
    updateAudioControls();
    audio.unlock();
  };
  $('soundToggle').onclick = () => {
    preferences.sfx = !preferences.sfx;
    save('bb_sfx', preferences.sfx ? 'on' : 'off');
    updateAudioControls();
    audio.unlock({ testSound: preferences.sfx });
  };
  for (const [id, key, store] of [['musicVolume', 'musicVolume', 'bb_music_vol'], ['sfxVolume', 'sfxVolume', 'bb_sfx_vol']]) {
    $(id).value = preferences[key] * 100;
    $(id).oninput = event => {
      preferences[key] = Number(event.target.value) / 100;
      save(store, event.target.value);
      updateAudioControls();
      audio.unlock();
    };
  }
  $('zoomMap').onclick = () => {
    state.overview = !showOverview();
    save('bb_camera', state.overview ? 'off' : 'on');
    updateCameraButton();
  };
  $('playControls').dataset.stickSide = $('stickSide').value = state.stickSide;
  $('stickReach').value = state.stickReach;
  $('stickSide').onchange = event => {
    clearInput();
    state.stickSide = event.target.value;
    $('playControls').dataset.stickSide = state.stickSide;
    save('bb_stick_side', state.stickSide);
  };
  $('stickReach').onchange = event => {
    clearInput();
    state.stickReach = event.target.value;
    save('bb_stick_reach', state.stickReach);
  };
  $('cheer').onclick = () => {
    audio.unlock();
    if (!send({ type: 'cheer' })) return;
    state.cheerUntil = performance.now() + 2050;
    $('cheer').disabled = true;
    arena.cue('cheer');
    audio.play('cheer', { gain: .74, fallback: 'go' });
  };
  updateCameraButton();
  $('matchDetails').onclick = () => {
    toggleSoundPanel(false);
    clearInput();
    toggleMatchDetails(true);
  };
  for (const id of ['closeDetails', 'detailsBackdrop']) $(id).onclick = () => toggleMatchDetails(false, true);
  compactMatch.addEventListener('change', updateMatchLayout);
  document.addEventListener('click', event => {
    if (!$('soundPanel').hidden && !event.target.closest('#audioSettings, #soundPanel')) toggleSoundPanel(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!$('detailsBackdrop').hidden) toggleMatchDetails(false, true);
    if (!$('soundPanel').hidden) {
      toggleSoundPanel(false);
      $('audioSettings').focus();
    }
  });
  bindControls();
}

function bindControls() {
  const stick = $('joystick');
  function readStick(event) {
    const control = state.stick;
    const reach = control.radius * (state.stickReach === 'short' ? .76 : 1);
    const x = (event.clientX - control.x) / reach;
    const y = (event.clientY - control.y) / reach;
    const intent = stickIntent(x, y, control.direction, control.pace);
    Object.assign(control, intent);
    const [dx, dy] = directions[intent.direction] || [0, 0];
    const push = Math.abs(dx * x + dy * y);
    const travel = Math.max(0, Math.min(.53, (push - .08) * .79)) * control.radius;
    stick.style.setProperty('--stick-x', `${Math.round(dx * travel)}px`);
    stick.style.setProperty('--stick-y', `${Math.round(dy * travel)}px`);
    move();
  }
  stick.addEventListener('pointerdown', event => {
    const player = localPlayer();
    if (state.stick || event.button !== 0 || !player?.alive || player.trapped || state.world.countdown) return;
    event.preventDefault();
    const bounds = stick.getBoundingClientRect();
    const radius = bounds.width / 2;
    const x = bounds.left + radius, y = bounds.top + radius;
    const touchingKnob = event.pointerType !== 'mouse' && Math.hypot(event.clientX - x, event.clientY - y) < radius * .46;
    state.stick = { id: event.pointerId, radius, x: touchingKnob ? event.clientX : x,
      y: touchingKnob ? event.clientY : y, direction: '', pace: 0 };
    stick.setPointerCapture(event.pointerId);
    stick.classList.add('grabbed');
    readStick(event);
  });
  stick.addEventListener('pointermove', event => {
    if (state.stick?.id === event.pointerId) readStick(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stick.addEventListener(type, event => {
      if (state.stick?.id !== event.pointerId) return;
      resetStick();
      move();
    });
  }
  for (const [id, action] of [['mobileBomb', 'bomb'], ['mobileThrow', 'throw'], ['mobileRemote', 'detonate']]) {
    $(id).addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (event.pointerType === 'mouse') audio.unlock();
      act(action);
    });
    $(id).addEventListener('click', event => { if (!event.detail) act(action); });
  }
  window.addEventListener('keydown', event => {
    if (!$('detailsBackdrop').hidden || event.target.matches?.('input, textarea, select') || state.world?.state !== 'playing' ||
      event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action = { ' ': 'bomb', r: 'throw', e: 'detonate' }[key];
    if (action || directionKeys[key]) {
      event.preventDefault();
      if (event.repeat) return;
      if (action) act(action);
      else { state.keys.add(key); move(); }
    }
  });
  window.addEventListener('keyup', event => {
    if (state.keys.delete(event.key)) move();
  });
  window.addEventListener('blur', clearInput);
  window.addEventListener('resize', () => {
    if (state.stick) { resetStick(); move(); }
  }, { passive: true });
  window.addEventListener('pagehide', clearInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInput();
    audio.foregroundChanged();
  });
  window.addEventListener('pageshow', () => audio.foregroundChanged());
  document.addEventListener('pointerup', event => {
    if (event.pointerType !== 'mouse' && event.target.closest('#joystick, .bomb-action, .action-extras')) audio.unlock();
  }, { capture: true });
  document.addEventListener('focusin', event => { if (event.target.matches('input, select, textarea')) clearInput(); });
  document.addEventListener('click', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  setInterval(() => move(true), 90);
}

async function boot() {
  bind();
  try {
    const [manifest, guest, catalog] = await Promise.all([
      readManifest(),
      fetch('/api/session', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('Không kết nối được máy chủ.');
        return response.json();
      }),
      fetch('/api/assets').then(response => response.json()),
    ]);
    audio.prepare(manifest.categories['08_audio'], catalog.arcadeAudio, catalog.arcadeMusic);
    await Promise.all([loadImages(manifest), loadIllustrations(catalog.avatars)]);
    loadMotion(catalog.avatars, state.avatar);
    maps = catalog.maps;
    for (const avatar of catalog.avatars) {
      const button = node('button', undefined, 'avatar-choice');
      button.type = 'button';
      button.dataset.avatar = avatar;
      button.title = names[avatar];
      button.setAttribute('aria-label', names[avatar]);
      button.append(image('01_characters', avatar));
      button.onclick = () => {
        chooseAvatar(avatar);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          $('selectedAvatar').animate([
            { transform: 'translateY(0) scale(.98)' },
            { transform: 'translateY(-5px) scale(1.075)', offset: .42 },
            { transform: 'translateY(0) scale(1)' },
          ], { duration: 310, easing: 'ease-out' });
        }
        audio.play('pickup');
      };
      $('avatarPicker').append(button);
    }
    chooseAvatar(state.avatar);
    for (const [kind, title] of Object.entries(items)) {
      const img = image('04_powerups', kind, title);
      img.title = title;
      img.dataset.kind = kind;
      $('inventory').append(img);
    }
    for (const [id, map] of Object.entries(maps)) {
      const option = node('option', map.name);
      option.value = id;
      $('mapPicker').append(option);
    }
    state.nick = state.nick || guest.suggestedName;
    $('nickname').value = state.nick;
    state.ready = true;
    for (const id of ['nickname', 'quickPlay', 'createRoom', 'practice', 'joinRoom']) $(id).disabled = false;
    status('Sẵn sàng', true);
    refreshRooms();
    setInterval(() => { if (!state.room && !document.hidden) refreshRooms(); }, 5000);
    const requestedRoom = new URLSearchParams(location.search).get('room');
    if (requestedRoom) enter(requestedRoom);
    function frame(time) {
      arena.render(time, showOverview(), compactMatch.matches);
      if (arena.takeFootstep()) audio.play('step', { gain: .26, gap: .18, rate: .94 + Math.random() * .13 });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    status('Không tải được trò chơi');
    toast('Không tải được trò chơi. Hãy thử tải lại trang.', 5000);
  }
}

updateAudioControls();
boot();
