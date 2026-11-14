"""Tests for production mechanics, authentication, and complete asset delivery."""
import json
import struct
import wave
import time
from pathlib import Path
from fastapi.testclient import TestClient
from main import (app, Room, Player, Bomb, ROOMS, AVATARS, ITEMS, MAPS, sign_guest,
                  verify_guest_token, DISCONNECT_GRACE, cleanup, TICK)

ROOT=Path(__file__).parents[1]
KIT=ROOT/'frontend'/'assets'
EXPECTED_COUNTS={'01_characters':8,'02_floor_tiles':8,'03_obstacles':10,
                 '04_powerups':9,'05_water_balloons':4,'06_water_blasts':6,
                 '07_ui':4,'08_audio':11,'00_reference_boards':5,'09_previews':2}


def make_room(players=2, mode='solo'):
    room=Room('ABCDEF','g0',mode=mode)
    room.players={f'g{i}':Player(f'p{i}',f'P{i}',avatar=AVATARS[i]) for i in range(players)}
    assert room.start('g0',100.0)
    room.countdown_end=100
    room.crates=set()
    return room


def test_supplied_asset_manifest_complete_and_files_valid():
    manifest=json.loads((KIT/'asset_manifest.json').read_text())
    for category,count in EXPECTED_COUNTS.items():
        names=manifest['categories'][category]
        assert len(names)==count,(category,len(names))
        folder=ROOT/'reference'/category if category.startswith(('00','09')) else KIT/category
        for filename in names:
            file=folder/filename
            assert file.exists() and file.stat().st_size>100,file
            if filename.endswith('.png'):
                data=file.read_bytes()
                assert data[:8]==b'\x89PNG\r\n\x1a\n'
                width,height=struct.unpack('>II',data[16:24])
                assert width>0 and height>0
                if category not in ('00_reference_boards','09_previews','07_ui'):
                    assert (width,height)==(64,64)
            if filename.endswith('.wav'):
                with wave.open(str(file),'rb') as w:
                    assert w.getnframes()>0 and w.getframerate()>0
    assert len(AVATARS)==8 and len(MAPS)==8 and len(ITEMS)==9


def test_guest_token_signature_rejects_tamper_and_expiry():
    guest='a'*32
    valid=sign_guest(guest,int(time.time()+3600))
    assert verify_guest_token(valid,guest)
    assert not verify_guest_token(valid,'b'*32)
    assert not verify_guest_token(valid[:-4]+'ffff',guest)
    assert not verify_guest_token(sign_guest(guest,1),guest)


def test_cookie_signature_checked_on_websocket():
    from starlette.websockets import WebSocketDisconnect
    ROOMS.clear()
    with TestClient(app) as c:
        guest=c.get('/api/session');assert guest.status_code==200
        assert c.cookies.get('bb_guest') and c.cookies.get('bb_reconnect')
        code=c.post('/api/rooms').json()['id']
        c.cookies.set('bb_reconnect','forged')
        try:
            with c.websocket_connect('/ws/'+code) as ws:
                ws.receive_json()
        except WebSocketDisconnect as ex:
            assert ex.code==4401
        else:raise AssertionError('WebSocket accepted invalid token')
    ROOMS.clear()


def test_nine_powerups_have_real_server_effects():
    for kind in ITEMS:
        r=make_room();p=r.players['g0']
        r.award(p,kind,100)
        effect={'speed':p.speed>3,'water_range':p.power>2,
                'extra_balloon':p.capacity>1,'kick':p.kicks,'glove':p.throws,
                'skates':p.speed>3,'shield':p.shield>0,'remote':p.remote,
                'star':p.invulnerable_until>100}[kind]
        assert effect,kind
        assert r.events[-1]['type'] in ('pickup','speed_boost')


def test_shield_absorbs_explosion_once():
    r=make_room()
    p=r.players['g0'];p.x=p.y=1.5;p.shield=1
    r.bombs={(1,1):Bomb(1,1,'p1',90,2)}
    r.update(.01,100)
    assert p.shield==0 and p.trapped_until==0 and p.invulnerable_until>100


def test_remote_trigger_only_owners_remote_balloons():
    r=make_room()
    a,b=r.players.values();a.remote=True
    r.bombs={(1,1):Bomb(1,1,a.id,120,2,remote=True),(13,11):Bomb(13,11,b.id,120,2)}
    assert r.remote_detonate(a,100)
    assert (1,1) not in r.bombs and (13,11) in r.bombs
    assert not r.remote_detonate(b,100.5)


def test_throw_requires_glove_and_finds_free_landing_tile():
    r=make_room();p=r.players['g0'];p.x=p.y=1.5;p.dx=1
    assert not r.place_bomb(p,100,thrown=True)
    p.throws=True
    assert r.place_bomb(p,100.5,thrown=True)
    assert any(x>=2 for x,y in r.bombs)


def test_kick_moves_bomb_one_cell_without_overlap():
    r=make_room();p=r.players['g0'];p.kicks=True
    r.bombs={(2,1):Bomb(2,1,'p1',120,2,owner_exited=True)}
    # Collision query attempts moving east into a bomb on a clear tile.
    assert not r.collision(2.30,1.5,p,direction=(1,0))
    assert (3,1) in r.bombs and (2,1) not in r.bombs


def test_same_round_spawns_no_immediate_teleports():
    r=make_room(8)
    coords=[(int(p.x),int(p.y)) for p in r.players.values()]
    assert len(set(coords))==8
    assert all(pos not in r.walls|r.crates for pos in coords)


def test_team_rescue_and_enemy_finish_by_contact():
    r=make_room(4,mode='teams')
    p=list(r.players.values());p[0].trapped_until=105;p[0].x=p[0].y=1.5
    p[2].x,p[2].y=1.6,1.5
    p[1].x,p[1].y=13.5,11.5
    r.update(.03,101)
    assert p[0].alive and p[0].trapped_until==0
    p[0].invulnerable_until=0;p[0].trapped_until=106
    p[2].x,p[2].y=7.5,11.5
    p[1].x,p[1].y=1.6,1.5
    r.update(.03,102)
    assert not p[0].alive and p[1].score==1


def test_disconnect_does_not_immediately_remove_guest():
    r=make_room()
    p=r.players['g1'];p.socket=None;p.disconnected_at=100
    cleanup(r,100+DISCONNECT_GRACE-.1)
    assert 'g1' in r.players
    cleanup(r,100+DISCONNECT_GRACE+.1)
    assert 'g1' not in r.players


def test_choose_all_map_themes_and_change_obstacles():
    for map_id,spec in MAPS.items():
        r=make_room();r.map_id=map_id;r.reset_map()
        assert spec['floor'] in json.loads((KIT/'asset_manifest.json').read_text())['categories']['02_floor_tiles'][0] or spec['floor']+'.png' in json.loads((KIT/'asset_manifest.json').read_text())['categories']['02_floor_tiles']
        assert all(kind in spec['blocks'] for kind in r.crate_types.values())


def test_message_protocol_host_only_map_and_ready():
    ROOMS.clear()
    with TestClient(app) as a,TestClient(app) as b:
        a.get('/api/session');b.get('/api/session')
        code=a.post('/api/rooms').json()['id']
        with a.websocket_connect(f'/ws/{code}?name=Host&avatar=frog_kid') as wa:
            assert wa.receive_json()['type']=='welcome';wa.receive_json()
            with b.websocket_connect(f'/ws/{code}?name=Joiner&avatar=duckling') as wb:
                assert wb.receive_json()['type']=='welcome';wb.receive_json()
                wb.send_json({'type':'map','value':'candy'})
                assert ROOMS[code].map_id=='village'
                wa.send_json({'type':'map','value':'candy'})
                # Wait for handler to read and process the frame.
                for _ in range(12):
                    if wa.receive_json().get('map')=='candy':break
                assert ROOMS[code].map_id=='candy'
                wb.send_json({'type':'ready','value':False})
                for _ in range(12):
                    if not ROOMS[code].players[next(k for k in ROOMS[code].players if k!=ROOMS[code].host)].ready:break
                    wb.receive_json()
                wa.send_json({'type':'start'})
                assert ROOMS[code].state=='waiting'
                wb.send_json({'type':'ready','value':True})
                for _ in range(12):
                    if ROOMS[code].players[next(k for k in ROOMS[code].players if k!=ROOMS[code].host)].ready:break
                    wb.receive_json()
                wa.send_json({'type':'start'})
                for _ in range(15):
                    if wa.receive_json().get('state')=='playing':break
                assert ROOMS[code].state=='playing'
    ROOMS.clear()
