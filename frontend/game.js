import { Arena, drawPreview } from './arena.js';
import { ArcadeAudio, assetUrl, loadImages, readManifest } from './media.js';

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
  ArrowUp: [0, -1], w: [0, -1], ArrowLeft: [-1, 0], a: [-1, 0],
  ArrowDown: [0, 1], s: [0, 1], ArrowRight: [1, 0], d: [1, 0],
};
const directions = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] };
const effects = {
  bomb: 'balloon_place', inflate: 'balloon_inflate', splash: 'water_burst',
  trap: 'trapped_in_bubble', rescue: 'rescue_teammate', pickup: 'pickup',
  speed_boost: 'speed_boost', shield: 'pickup', kick: 'balloon_place',
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
  keys: new Set(), touch: null, overview: stored('bb_camera', 'on') === 'off',
  pending: false, ready: false, chatIds: new Set(),
};
function volume(key, fallback) {
  const value = Number(stored(key, fallback));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : fallback / 100;
}
const preferences = {
  music: stored('bb_music', 'on') !== 'off', sfx: stored('bb_sfx', 'on') !== 'off',
  musicVolume: volume('bb_music_vol', 55), sfxVolume: volume('bb_sfx_vol', 70),
};
const audio = new ArcadeAudio(preferences);
const arena = new Arena($('gameCanvas'));
let maps = {};

function status(text, connected = false) {
  $('serverStatus').textContent = text;
  $('serverStatus').classList.toggle('ok', connected);
}

function toast(text, duration = 2400) {
  const node = $('gameToast');
  clearTimeout(toast.timer);
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
  img.src = assetUrl(category, name + '.png');
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
  $('selectedAvatar').src = assetUrl('01_characters', avatar + '.png');
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
  $('timer').textContent = '02:45';
  $('chatMessages').replaceChildren();
  $('currentRoom').textContent = code;
  $('homeScreen').hidden = true;
  $('gameScreen').hidden = false;
  $('boardOverlay').hidden = false;
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
  $('gameScreen').hidden = true;
  $('arena').hidden = true;
  $('mobileControls').hidden = true;
  $('keyboardHelp').hidden = true;
  $('statsPanel').hidden = true;
  $('soundPanel').hidden = true;
  $('audioSettings').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('in-match');
  $('homeScreen').hidden = false;
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
      state.sentDirection = '';
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
  if (!first && world.state === 'finished' && previous?.state !== 'finished') {
    audio.play(winner(localPlayer(), world) ? 'victory_jingle' : 'defeat_jingle');
  }
  if (world.round !== previous?.round && world.state === 'playing') clearInput();
  const active = world.state === 'playing';
  const me = localPlayer();
  $('arena').hidden = $('keyboardHelp').hidden = $('statsPanel').hidden = !active;
  $('mobileControls').hidden = !active || me?.spectator;
  $('boardOverlay').hidden = active;
  $('shareRoom').hidden = world.practice;
  document.body.classList.toggle('in-match', active);
  if (active !== (previous?.state === 'playing')) window.scrollTo(0, 0);
  const mins = String(Math.floor(world.time / 60)).padStart(2, '0');
  $('timer').textContent = mins + ':' + String(world.time % 60).padStart(2, '0');
  $('playerCounter').textContent = `${world.players.filter(player => player.connected).length} / ${world.practice ? 1 : 8}`;
  if (active) arena.receive(world, maps[world.map], state.id);
  else renderRoom(world);
  renderRoster(world);
  if (active) renderInventory(me);
}

function localPlayer() {
  return state.world?.players.find(player => player.id === state.id);
}

function winner(player, world) {
  return player && !player.spectator && (world.mode === 'teams' ? String(player.team) === world.winner : player.id === world.winner);
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
  if (effects[event.type]) audio.play(effects[event.type]);
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
  start.setAttribute('aria-label', finished ? 'Chơi lại' : 'Bắt đầu');
  $('waitingNote').textContent = !host ? 'Chờ chủ phòng bắt đầu.' :
    !enough ? 'Mời thêm người để bắt đầu.' : unready ? 'Chờ mọi người sẵn sàng.' :
    finished ? 'Bấm Bắt đầu để chơi lại.' : '';
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

function renderInventory(me) {
  if (!me) return;
  const owned = { ...me, speed: me.speed > 3, water_range: me.power > 2,
    extra_balloon: me.capacity > 1, skates: me.skates };
  const key = JSON.stringify([me.spectator, me.speed, me.power, me.capacity, me.skates, me.kick, me.glove, me.remote, me.shield, me.star]);
  if (state.inventoryKey === key) return;
  state.inventoryKey = key;
  for (const img of $('inventory').children) img.style.opacity = owned[img.dataset.kind] ? '1' : '.45';
  $('myStats').textContent = me.spectator ? 'Đang xem trận đấu' :
    `Bóng ${me.capacity} · Sức nước ${me.power} · Tốc độ ${me.speed.toFixed(1)}`;
  $('mobileThrow').disabled = !me.glove;
  $('mobileRemote').disabled = !me.remote;
}

function move(force = false) {
  if (state.world?.state !== 'playing') return;
  const key = [...state.keys].at(-1);
  const [dx, dy] = directions[state.touch?.dir] || directionKeys[key] || [0, 0];
  const direction = dx + ',' + dy;
  if (force || state.sentDirection !== direction || direction !== '0,0') {
    state.sentDirection = direction;
    send({ type: 'input', dx, dy, seq: ++state.seq });
  }
}

function clearInput() {
  state.keys.clear();
  state.touch = null;
  for (const button of $('dpad').children) button.classList.remove('pressed');
  move(true);
}

function act(type) {
  const me = localPlayer();
  if (state.world?.state !== 'playing' || state.world.countdown || !me?.alive || me.trapped) return;
  send({ type, round: state.world.round, seq: ++state.seq });
}

function updateAudioControls() {
  $('musicToggle').setAttribute('aria-pressed', String(preferences.music));
  $('soundToggle').setAttribute('aria-pressed', String(preferences.sfx));
  audio.update();
}

function updateCameraButton() {
  $('zoomMap').setAttribute('aria-pressed', String(state.overview));
  $('zoomMap').textContent = state.overview ? 'Theo nhân vật' : 'Toàn bản đồ';
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
    $('soundPanel').hidden = !$('soundPanel').hidden;
    $('audioSettings').setAttribute('aria-expanded', String(!$('soundPanel').hidden));
  };
  $('musicToggle').onclick = () => {
    preferences.music = !preferences.music;
    save('bb_music', preferences.music ? 'on' : 'off');
    updateAudioControls();
  };
  $('soundToggle').onclick = () => {
    preferences.sfx = !preferences.sfx;
    save('bb_sfx', preferences.sfx ? 'on' : 'off');
    updateAudioControls();
    audio.play('pickup');
  };
  for (const [id, key, store] of [['musicVolume', 'musicVolume', 'bb_music_vol'], ['sfxVolume', 'sfxVolume', 'bb_sfx_vol']]) {
    $(id).value = preferences[key] * 100;
    $(id).oninput = event => {
      preferences[key] = Number(event.target.value) / 100;
      save(store, event.target.value);
      audio.update();
    };
  }
  $('zoomMap').onclick = () => {
    state.overview = !state.overview;
    save('bb_camera', state.overview ? 'off' : 'on');
    updateCameraButton();
  };
  updateCameraButton();
  bindControls();
}

function bindControls() {
  function touchDirection(event) {
    const pad = $('dpad');
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-dir]');
    if (hit && pad.contains(hit)) state.touch.dir = hit.dataset.dir;
    else {
      const rect = pad.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
      state.touch.dir = Math.hypot(x, y) < 10 ? '' : Math.abs(x) > Math.abs(y) ?
        (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
    }
    for (const button of pad.children) button.classList.toggle('pressed', button.dataset.dir === state.touch.dir);
    move();
  }
  $('dpad').addEventListener('pointerdown', event => {
    if (state.touch || event.button !== 0) return;
    event.preventDefault();
    state.touch = { id: event.pointerId, dir: '' };
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDirection(event);
  });
  $('dpad').addEventListener('pointermove', event => {
    if (state.touch?.id === event.pointerId) touchDirection(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    $('dpad').addEventListener(type, event => {
      if (state.touch?.id !== event.pointerId) return;
      state.touch = null;
      for (const button of $('dpad').children) button.classList.remove('pressed');
      move(true);
    });
  }
  for (const [id, action] of [['mobileBomb', 'bomb'], ['mobileThrow', 'throw'], ['mobileRemote', 'detonate']]) {
    $(id).addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      audio.unlock();
      act(action);
    });
    $(id).addEventListener('click', event => { if (!event.detail) act(action); });
  }
  window.addEventListener('keydown', event => {
    if (event.target.matches?.('input, textarea, select') || state.world?.state !== 'playing' ||
      event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action = { ' ': 'bomb', r: 'throw', e: 'detonate' }[key];
    if (action || directionKeys[key]) {
      event.preventDefault();
      if (event.repeat) return;
      if (action) act(action);
      else { state.keys.add(key); move(true); }
    }
  });
  window.addEventListener('keyup', event => {
    if (state.keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)) move(true);
  });
  window.addEventListener('blur', clearInput);
  window.addEventListener('pagehide', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
  document.addEventListener('focusin', event => { if (event.target.matches('input, select, textarea')) clearInput(); });
  document.addEventListener('click', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  setInterval(move, 100);
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
    audio.prepare(manifest.categories['08_audio']);
    await loadImages(manifest);
    maps = catalog.maps;
    for (const avatar of catalog.avatars) {
      const button = node('button', undefined, 'avatar-choice');
      button.type = 'button';
      button.dataset.avatar = avatar;
      button.title = names[avatar];
      button.setAttribute('aria-label', names[avatar]);
      button.append(image('01_characters', avatar));
      button.onclick = () => { chooseAvatar(avatar); audio.play('pickup'); };
      $('avatarPicker').append(button);
    }
    chooseAvatar(state.avatar);
    for (const [kind, title] of Object.entries(items)) {
      const img = image('04_powerups', kind, title);
      img.title = title;
      img.dataset.kind = kind;
      $('itemPreview').append(img);
      $('inventory').append(img.cloneNode());
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
      arena.render(time, state.overview);
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
