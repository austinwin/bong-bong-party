from __future__ import annotations

import time

from fastapi.testclient import TestClient

from main import app, Room, Bomb, Player, ROOMS, W, H, clean_name


def make_duo(mode='teams'):
    r = Room('ABCDEF', 'a')
    r.players = {'a': Player('a', 'Mây', 'coral'), 'b': Player('b', 'Bé', 'aqua')}
    r.mode = mode
    for player in r.players.values():
        player.socket = object()
    assert r.start('a', 100.0)
    r.countdown_end = 100
    return r


def test_map_shape_and_spawn_safety():
    r=make_duo()
    assert len(r.walls)>0 and len(r.crates)>0
    for y in range(H):
        assert (0, y) in r.walls and (W-1,y) in r.walls
    for x in range(W):
        assert (x,0) in r.walls and (x,H-1) in r.walls
    for p in r.players.values():
        assert (int(p.x),int(p.y)) not in r.walls | r.crates


def test_bombs_do_not_pass_through_crates_or_walls():
    r=make_duo()
    r.crates={(3,1)}
    r.bombs={(1,1): Bomb(1,1,'a',90,5)}
    r.explode((1,1),100)
    cells={(v.x,v.y) for v in r.blasts}
    assert (1,1) in cells and (2,1) in cells and (3,1) in cells
    assert (4,1) not in cells
    assert (3,1) not in r.crates
    assert (0,1) not in cells


def test_chain_reaction_and_pickup():
    r=make_duo()
    r.crates=set()
    r.bombs={(1,1):Bomb(1,1,'a',110,3),(3,1):Bomb(3,1,'b',110,2)}
    r.explode((1,1),100)
    assert not r.bombs
    assert (3,1) in {(v.x,v.y) for v in r.blasts}


def test_collision_prevents_moving_through_walls():
    r=make_duo()
    p=r.players['a']
    assert r.collision(.4,1.5,p)
    assert not r.collision(1.5,1.5,p)


def test_touch_turn_assist_centers_an_open_lane_and_stops_at_a_crate():
    r = make_duo()
    r.walls, r.crates = {(2, 2)}, {(1, 3)}
    p = r.players['a']
    p.x, p.y, p.dx, p.dy = 1.79, 1.69, 0, 1
    for step in range(30):
        r.move_player(p, 1 / 30, 100 + step / 30)
        assert not r.collision(p.x, p.y, p)
    assert p.x == 1.5
    assert 2.5 < p.y < 2.73


def test_traps_rescue_and_victory():
    r=make_duo()
    r.crates=set()
    pa,pb=r.players['a'],r.players['b']
    pa.x=pa.y=1.5;pb.x=pb.y=4.5
    r.blasts=[]
    r.bombs={(1,1):Bomb(1,1,'b',100,1)}
    r.update(.01,100)
    assert pa.trapped_until>100
    # If no teammate appears, bubble expires, and opposite team wins.
    r.update(.01,106)
    assert not pa.alive
    assert r.state=='finished' and r.winner=='1'


def test_team_rescue():
    r=Room('ABCDEF','a')
    r.players={
        'a':Player('a','Mây','coral'),
        'b':Player('b','Bé','aqua'),
        'c':Player('c','Cà','lilac')
    }
    for player in r.players.values():
        player.socket = object()
    assert r.start('a', 100)
    r.countdown_end = 100
    a,b,c=r.players.values()
    a.x,a.y=1.5,1.5
    c.x,c.y=1.6,1.5  # a and c are teammates (0 and 2)
    b.x,b.y=13.5,11.5
    a.trapped_until=104
    r.update(.01,101)
    assert a.alive and a.trapped_until==0


def test_ffa_elimination():
    r=make_duo('solo')
    r.players['a'].alive=False
    r.update(.01,101)
    assert r.state=='finished' and r.winner=='b'


def test_guest_cookie_and_http_api():
    ROOMS.clear()
    with TestClient(app) as c:
        guest=c.get('/api/session')
        assert guest.status_code==200
        assert 'bb_guest' in c.cookies
        assert 'HttpOnly' in guest.headers['set-cookie']
        assert guest.json()['id']==c.get('/api/session').json()['id']
        created=c.post('/api/rooms'); assert created.status_code==200
        code=created.json()['id']; assert len(code)==6 and code in ROOMS
        assert c.get('/api/health').json()['ok']
    ROOMS.clear()


def test_multiplayer_websocket_handshake():
    ROOMS.clear()
    with TestClient(app) as first, TestClient(app) as second:
        first.get('/api/session');second.get('/api/session')
        code=first.post('/api/rooms').json()['id']
        with first.websocket_connect(f'/ws/{code}?name=Mây') as a:
            assert a.receive_json()['type']=='welcome'
            assert len(a.receive_json()['players'])==1
            with second.websocket_connect(f'/ws/{code}?name=Hồng') as b:
                assert b.receive_json()['type']=='welcome'
                assert len(b.receive_json()['players'])==2
                b.send_json({'type': 'ready', 'value': True})
                while not all(p['ready'] for p in a.receive_json()['players']):
                    pass
                a.send_json({'type': 'start'})
                while a.receive_json()['state'] != 'playing':
                    pass
                ROOMS[code].countdown_end = time.monotonic()
                for seq in (1, 1):
                    a.send_json({'type': 'bomb', 'seq': seq, 'round': 1})
                snap_a = a.receive_json()
                while not snap_a['bombs']:
                    snap_a = a.receive_json()
                snap_b = b.receive_json()
                while not snap_b['bombs']:
                    snap_b = b.receive_json()
                assert snap_a['bombs'][0]['x'] == snap_b['bombs'][0]['x'] == 1
                assert [e['type'] for e in snap_a['events']].count('bomb') == 1
    ROOMS.clear()


def test_private_rooms_hidden_and_public_ids_are_room_scoped():
    ROOMS.clear()
    with TestClient(app) as c:
        c.get('/api/session')
        private=c.post('/api/rooms?private=true').json()['id']
        assert private in ROOMS and ROOMS[private].private
        with c.websocket_connect(f'/ws/{private}?name=Hello') as ws:
            hello=ws.receive_json()
            state=ws.receive_json()
            cookie=c.cookies.get('bb_guest')
            assert hello['id']!=cookie
            assert state['players'][0]['id']==hello['id']
            assert state['host']==hello['id']
            assert private not in [r['id'] for r in c.get('/api/rooms').json()]
    ROOMS.clear()


def test_reject_unknown_room_with_meaningful_websocket_close_code():
    from starlette.websockets import WebSocketDisconnect
    ROOMS.clear()
    with TestClient(app) as c:
        c.get('/api/session')
        try:
            with c.websocket_connect('/ws/ABCD12') as ws:
                ws.receive_json()
        except WebSocketDisconnect as exc:
            assert exc.code==4404
        else:
            raise AssertionError('Unknown room accepted')


def test_disconnect_counts_as_loss():
    r=make_duo()
    r.players.pop('a')
    r.update(0.01,101)
    assert r.state=='finished' and r.winner=='1'
