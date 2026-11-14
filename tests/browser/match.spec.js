import { test, expect, devices } from '@playwright/test';

function monitor(page) {
  const history = [];
  const errors = [];
  const downloads = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('.wav') && response.ok()) downloads.add(path);
  });
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => history.push(JSON.parse(payload)));
  });
  return { history, errors, downloads, state: () => history.findLast(frame => frame.type === 'state') };
}

async function trackPlayback(page) {
  await page.addInitScript(() => {
    const context = window.AudioContext || window.webkitAudioContext;
    window.arcadePlayback = { clips: [], decoded: 0 };
    const resume = context.prototype.resume;
    context.prototype.resume = function () {
      window.arcadePlayback.context = this;
      return resume.call(this);
    };
    const decode = context.prototype.decodeAudioData;
    context.prototype.decodeAudioData = async function (...args) {
      const buffer = await decode.apply(this, args);
      window.arcadePlayback.decoded++;
      return buffer;
    };
    const create = context.prototype.createBufferSource;
    context.prototype.createBufferSource = function () {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (...args) => {
        window.arcadePlayback.clips.push({ seconds: source.buffer.duration, loop: source.loop, state: this.state });
        start(...args);
      };
      return source;
    };
  });
}

test('guest room, ready, movement, audio, trap, reconnect and rematch', async ({ page, browser, baseURL }, info) => {
  test.skip(info.project.name === 'android-chromium', 'Android Chromium covers simultaneous touches in its own test.');
  const mobile = info.project.name === 'iphone-webkit';
  const press = (locator) => mobile ? locator.tap() : locator.click();
  const other = await browser.newContext(mobile ? devices['iPhone 13'] : devices['Desktop Chrome']);
  try {
    const peer = await other.newPage();
    const first = monitor(page), second = monitor(peer);
    await trackPlayback(page);
    await page.goto('/');
    await page.locator('#nickname').fill('Ếch QA');
    await page.locator('#nickname').blur();
    await press(page.getByRole('button', { name: 'Ếch Xanh', exact: true }));
    await expect.poll(() => page.evaluate(() => window.arcadePlayback.decoded)).toBe(26);
    await expect.poll(() => page.evaluate(() => window.arcadePlayback.clips.some(clip => clip.loop && clip.seconds > 34 && clip.state === 'running'))).toBeTruthy();
    expect(first.downloads.size).toBe(26);
    await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeInViewport();
    if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/${info.project.name}-lobby.png` });

    await press(page.getByRole('button', { name: 'Tạo phòng' }));
    await expect(page.locator('#overlayPlayers img')).toHaveCount(1);
    const code = await page.locator('#currentRoom').textContent();
    await peer.goto(baseURL);
    await peer.locator('#nickname').fill('Vịt QA');
    await peer.locator('#nickname').blur();
    await press(peer.getByRole('button', { name: 'Vịt Vàng', exact: true }));
    await peer.getByRole('textbox', { name: 'Mã phòng' }).fill(code);
    await peer.getByRole('textbox', { name: 'Mã phòng' }).blur();
    await press(peer.getByRole('button', { name: 'Vào phòng', exact: true }));
    await expect(page.locator('#overlayPlayers img')).toHaveCount(2);
    await expect(page.locator('#overlayPlayers')).toContainText('Ếch QA');
    await expect(page.locator('#overlayPlayers')).toContainText('Vịt QA');
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();
    await press(peer.getByRole('button', { name: 'Sẵn sàng', exact: true }));
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
    await peer.getByRole('textbox', { name: 'Tin nhắn' }).fill('Chào phòng!');
    await peer.getByRole('textbox', { name: 'Tin nhắn' }).blur();
    await press(peer.getByRole('button', { name: 'Gửi', exact: true }));
    await expect(page.getByRole('log')).toContainText('Chào phòng!');
    await page.locator('#mapPicker').selectOption('winter');
    await expect(peer.locator('#mapPicker')).toHaveValue('winter');
    if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/${info.project.name}-room.png` });

    await press(page.getByRole('button', { name: 'Bắt đầu' }));
    await expect(page.locator('#gameCanvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.arcadePlayback.clips.some(clip => clip.loop && clip.seconds > 28 && clip.seconds < 29))).toBeTruthy();
    await expect.poll(() => first.state().countdown).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await expect.poll(() => first.state().countdown).toBe(0);
    expect(first.state().bombs).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Đặt bóng nước' })).toBeInViewport();
    await expect(page.locator('#joystick')).toBeInViewport();
    if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/${info.project.name}-arena.png` });
    const firstId = first.history.findLast(frame => frame.type === 'welcome').id;
    const cheer = page.getByRole('button', { name: 'Cổ vũ', exact: true });
    await press(cheer);
    await expect(cheer).toBeDisabled();
    await expect.poll(() => second.state().events.some(event => event.type === 'cheer' && event.who === firstId)).toBeTruthy();
    const peerId = second.history.findLast(frame => frame.type === 'welcome').id;
    const revision = second.state().revision;
    await peer.keyboard.down('a');
    await expect.poll(() => second.state().revision).toBeGreaterThan(revision + 2);
    await peer.keyboard.up('a');
    expect(second.state().players.find(player => player.id === peerId).x).toBe(13.5);
    const peerStick = peer.locator('#joystick');
    if (mobile) {
      await peer.keyboard.down('ArrowLeft');
      await expect.poll(() => first.state().players.find(player => player.id === peerId).x).toBeLessThan(13.2);
      await peer.keyboard.up('ArrowLeft');
    } else {
      const box = await peerStick.boundingBox();
      await peer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await peer.mouse.down();
      await peer.mouse.move(box.x - 12, box.y + box.height / 2, { steps: 5 });
      await expect.poll(() => first.state().players.find(player => player.id === peerId).x).toBeLessThan(13.2);
      await expect(peerStick).toHaveAttribute('data-active', 'left');
      await peer.mouse.up();
      await expect(peerStick).toHaveAttribute('data-active', '');
    }
    const positions = first.state().players.length;
    await peer.reload();
    await expect.poll(() => second.history.filter(frame => frame.type === 'welcome').length).toBe(2);
    expect(second.history.findLast(frame => frame.type === 'welcome').id).toBe(peerId);
    await expect.poll(() => second.state().players.length).toBe(positions);

    if (mobile) await page.getByRole('button', { name: 'Đặt bóng nước' }).tap();
    else await page.keyboard.press('Space');
    await expect.poll(() => second.state().bombs.length).toBe(1);
    await expect.poll(() => second.state().players.some(player => player.trapped)).toBeTruthy();
    await expect(page.locator('#overlayTitle')).toHaveText('Kết thúc trận', { timeout: 10000 });
    await expect(peer.locator('#overlayTitle')).toHaveText('Chiến thắng!');
    await expect.poll(() => page.evaluate(() => window.arcadePlayback.clips.map(clip => Math.round(clip.seconds * 100)))).toEqual(
      expect.arrayContaining([10, 19, 24, 34, 35, 42, 48, 145])
    );
    await expect(page.getByRole('button', { name: 'Chơi lại' })).toBeDisabled();
    await press(peer.getByRole('button', { name: 'Sẵn sàng', exact: true }));
    await press(page.getByRole('button', { name: 'Chơi lại' }));
    await expect.poll(() => first.state().round).toBe(2);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    await press(page.getByRole('button', { name: 'Thoát' }));
    await expect(page.getByRole('button', { name: 'Tạo phòng' })).toBeVisible();
  } finally {
    await other.close();
  }
});

test('first phone tap unlocks sound before loading and can recover after interruption', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'Exercises the iPhone WebKit audio path.');
  await trackPlayback(page);
  let releaseManifest;
  const manifest = new Promise(resolve => { releaseManifest = resolve; });
  await page.route('**/assets/asset_manifest.json', async route => {
    await manifest;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  try {
    await page.getByRole('button', { name: 'Bật âm thanh', exact: true }).tap();
    await expect(page.locator('#audioSettings')).toHaveAttribute('data-audio', 'loading');
  } finally {
    releaseManifest();
  }
  await expect(page.locator('#audioSettings')).toHaveAttribute('data-audio', 'on');
  await expect.poll(() => page.evaluate(() => window.arcadePlayback.clips.some(clip => clip.loop))).toBe(true);
  await page.evaluate(async () => {
    const audio = window.arcadePlayback.context;
    await audio.suspend();
  });
  await expect(page.locator('#audioSettings')).toHaveAttribute('data-audio', 'locked');
  const effects = await page.evaluate(() => window.arcadePlayback.clips.filter(clip => !clip.loop).length);
  await page.getByRole('button', { name: 'Bật âm thanh', exact: true }).tap();
  await expect(page.locator('#audioSettings')).toHaveAttribute('data-audio', 'on');
  await expect.poll(() => page.evaluate(() => window.arcadePlayback.clips.filter(clip => !clip.loop).length)).toBeGreaterThan(effects);
});

test('short phone keeps the board, joystick and sound within reach', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'Checks the small WebKit portrait and landscape viewports.');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Tập chơi' })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Tập chơi' }).tap();
  await page.getByRole('button', { name: 'Bắt đầu' }).tap();
  await expect(page.locator('#arena')).toBeVisible();
  for (const viewport of [{ width: 320, height: 568 }, { width: 750, height: 342 }]) {
    await page.setViewportSize(viewport);
    for (const id of ['gameCanvas', 'joystick', 'mobileBomb', 'audioSettings', 'zoomMap', 'cheer']) {
      await expect(page.locator('#' + id)).toBeInViewport({ ratio: .99 });
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
  }
  await page.locator('#audioSettings').tap();
  await expect(page.getByRole('button', { name: 'Thử âm thanh' })).toBeInViewport();
  await page.getByRole('button', { name: 'Người chơi và vật phẩm' }).tap();
  await expect(page.getByRole('heading', { name: 'Thông tin trận' })).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Vật phẩm' })).toBeVisible();
  await page.getByRole('button', { name: 'Đóng', exact: true }).tap();
  await expect(page.locator('#gameSide')).toBeHidden();
  await expect(page.locator('#joystick')).toBeInViewport({ ratio: 1 });
});

test('the phone starts closer to the costume, eases out to the full board and remembers the view', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'Measures arena composition on the phone viewport.');
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.id === 'gameCanvas' && args[0].src?.includes('/10_costumes/')) {
        const transform = this.getTransform();
        this.canvas.dataset.costume = new URL(args[0].src).pathname;
        this.canvas.dataset.costumeScale = String(Math.hypot(transform.a, transform.b));
        this.canvas.dataset.costumeHeight = String(args[4] * Math.hypot(transform.c, transform.d) / (this.canvas.width / this.canvas.clientWidth));
        (window.cameraScales ??= []).push(Math.hypot(transform.a, transform.b));
      }
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  const fox = page.getByRole('button', { name: 'Cáo Cam', exact: true });
  await fox.tap();
  await expect(page.locator('#avatarPicker img[src*="/10_costumes/"]')).toHaveCount(8);
  await expect(page.locator('#selectedAvatar')).toHaveAttribute('src', /10_costumes\/fox_scout.webp/);
  await page.getByRole('button', { name: 'Tập chơi' }).tap();
  await page.getByRole('button', { name: 'Bắt đầu' }).tap();
  await expect(page.getByRole('button', { name: 'Đặt bóng nước' })).toBeEnabled();
  const canvas = page.locator('#gameCanvas');
  await expect(canvas).toHaveAttribute('data-costume', '/assets/10_costumes/fox_scout.webp');
  await expect(page.locator('#cameraLabel')).toHaveText('Theo nhân vật');
  const closeScale = Number(await canvas.getAttribute('data-costume-scale'));
  expect(Number(await canvas.getAttribute('data-costume-height'))).toBeGreaterThan(68);
  await expect(canvas).toBeInViewport({ ratio: .99 });
  if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/iphone-follow.png` });
  await page.getByRole('button', { name: 'Xem toàn bản đồ' }).tap();
  await expect(page.locator('#cameraLabel')).toHaveText('Toàn bản đồ');
  await expect.poll(async () => Number(await canvas.getAttribute('data-costume-scale'))).toBeLessThan(closeScale * .55);
  const intermediateViews = await page.evaluate(initial => window.cameraScales.filter(scale => scale > initial * .63 && scale < initial * .94), closeScale);
  expect(intermediateViews.length).toBeGreaterThan(2);
  if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/iphone-overview.png` });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Bật camera theo nhân vật' })).toBeVisible();
});

test('touch predicts movement during delayed snapshots and can plant a balloon with a second finger', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'android-chromium', 'Uses native Chromium multitouch input.');
  const record = monitor(page);
  let hold = false;
  let held;
  let relay;
  let delivered;
  const motion = new Set();
  page.on('response', response => {
    if (response.ok() && response.url().includes('/12_motion/')) motion.add(response.url());
  });
  await page.routeWebSocket('**/ws/**', socket => {
    const server = socket.connectToServer();
    relay = socket;
    server.onMessage(message => {
      const frame = JSON.parse(message);
      if (hold && frame.type === 'state') {
        held = message;
      } else {
        if (frame.type === 'state') delivered = frame;
        socket.send(message);
      }
    });
  });
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.id === 'gameCanvas' && /\/(10_costumes|12_motion)\//.test(args[0].src || '')) {
        const path = new URL(args[0].src).pathname;
        if (window.costumeFrame?.path !== path) window.poseChanges = (window.poseChanges || 0) + 1;
        window.costumeFrame = { path, x: this.getTransform().e };
        (window.runFrames ??= new Set()).add(path);
      }
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tập chơi' }).tap();
  await page.getByRole('button', { name: 'Bắt đầu' }).tap();
  const bombButton = page.getByRole('button', { name: 'Đặt bóng nước' });
  await expect(bombButton).toBeEnabled();
  await page.getByRole('button', { name: 'Xem toàn bản đồ' }).tap();
  // Wait for the camera to settle before using a fixed screen-space movement baseline.
  await expect.poll(() => page.evaluate(() => window.costumeFrame?.x)).toBeLessThan(120);
  const stick = page.locator('#joystick');
  await expect(stick).toBeInViewport();
  const bounds = await stick.boundingBox();
  const bomb = await bombButton.boundingBox();
  const devtools = await context.newCDPSession(page);
  const point = (box, id) => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), id });
  const center = point(bounds, 1);
  const right = { ...center, x: Math.round(center.x + bounds.width * .37) };
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
  await expect(stick).toHaveClass(/grabbed/);
  await expect(stick).toHaveAttribute('data-active', '');
  await expect.poll(() => page.evaluate(() => window.costumeFrame?.path)).toMatch(/10_costumes/);
  await expect.poll(() => page.evaluate(async () => {
    const x = window.costumeFrame.x;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.abs(window.costumeFrame.x - x);
  })).toBeLessThan(.02);
  const x = await page.evaluate(() => window.costumeFrame.x);
  await page.evaluate(() => { window.poseChanges = 0; });
  hold = true;
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [right] });
  await expect(stick).toHaveAttribute('data-active', 'right');
  await expect.poll(() => stick.evaluate(el => Number.parseFloat(el.style.getPropertyValue('--stick-x')))).toBeGreaterThan(10);
  await expect.poll(() => page.evaluate(() => window.costumeFrame.x)).toBeGreaterThan(x + 8);
  await expect.poll(() => page.evaluate(() => window.costumeFrame.path)).toMatch(/12_motion\/.*-side/);
  expect(await page.evaluate(() => window.poseChanges)).toBeLessThan(4);
  expect(delivered.players[0].x).toBe(1.5);
  hold = false;
  if (held) relay.send(held);
  await expect.poll(() => delivered.players[0].x).toBeGreaterThan(1.85);
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [right, point(bomb, 2)] });
  await expect.poll(() => delivered.bombs.length).toBe(1);
  await expect.poll(() => delivered.players[0].x).toBeGreaterThan(2.35);
  if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/joystick-drag.png` });
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(stick).not.toHaveClass(/grabbed/);
  await expect(stick).toHaveAttribute('data-active', '');
  await expect.poll(() => stick.evaluate(el => el.style.getPropertyValue('--stick-x'))).toBe('');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(motion.size).toBe(32);
  expect(await page.evaluate(() => [...window.runFrames].filter(path => /-side(?:-pass)?\.webp$/.test(path)))).toHaveLength(2);
  expect(record.errors).toEqual([]);
});
