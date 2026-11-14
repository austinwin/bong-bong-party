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
    await expect.poll(() => page.evaluate(() => window.arcadePlayback.decoded)).toBe(11);
    await expect.poll(() => page.evaluate(() => window.arcadePlayback.clips.some(clip => clip.loop && clip.state === 'running'))).toBeTruthy();
    expect(first.downloads.size).toBe(11);
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
    await expect.poll(() => first.state().countdown).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await expect.poll(() => first.state().countdown).toBe(0);
    expect(first.state().bombs).toHaveLength(0);
    if (mobile) await expect(page.getByRole('button', { name: 'Đặt bóng nước' })).toBeInViewport();
    if (process.env.CAPTURE_QA) await page.screenshot({ path: `${process.env.CAPTURE_QA}/${info.project.name}-arena.png` });
    const peerId = second.history.findLast(frame => frame.type === 'welcome').id;
    await peer.keyboard.down('ArrowLeft');
    await expect.poll(() => first.state().players.find(player => player.id === peerId).x).toBeLessThan(13.2);
    await peer.keyboard.up('ArrowLeft');
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
      expect.arrayContaining([10, 19, 34, 35, 42, 98])
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

test('touch movement and balloon placement can run together', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'android-chromium', 'Uses native Chromium multitouch input.');
  const record = monitor(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Tập chơi' }).tap();
  await page.getByRole('button', { name: 'Bắt đầu' }).tap();
  await expect.poll(() => record.state().countdown).toBe(0);
  const right = await page.getByRole('button', { name: 'Phải' }).boundingBox();
  const bomb = await page.getByRole('button', { name: 'Đặt bóng nước' }).boundingBox();
  const devtools = await context.newCDPSession(page);
  const point = (box, id) => ({ x: (box.x + box.width / 2) | 0, y: (box.y + box.height / 2) | 0, id });
  const joystick = point(right, 1);
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [joystick] });
  await expect.poll(() => record.state().players[0].x).toBeGreaterThan(1.85);
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [joystick, point(bomb, 2)] });
  await expect.poll(() => record.state().bombs.length).toBe(1);
  await expect.poll(() => record.state().players[0].x).toBeGreaterThan(2.35);
  await devtools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(record.errors).toEqual([]);
});
