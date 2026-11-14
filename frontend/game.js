/* Bong Bong Party - original 2007-style arena, 100% sprite/WAV kit runtime.
   Authoritative game state arrives from QPyServe/FastAPI via WebSockets.
   Never trust a browser for collisions, wins, items, or movement speed. */
const $ = id => document.getElementById(id);
const W=15,H=13,TILE=64,WIDTH=W*TILE,HEIGHT=H*TILE;
const ROOT='/assets/';
const LABELS={berry_pixie:'Berry Pixie',cloud_tech:'Cloud Tech',duckling:'Duckling',fox_scout:'Fox Scout',frog_kid:'Frog Kid',little_bat:'Little Bat',night_wizard:'Night Wizard',turtle_scholar:'Turtle Scholar'};
const MAPS={village:['Làng Gỗ','wood','stone_pillar'],garden:['Vườn Nấm','grass','stone_pillar'],candy:['Đảo Kẹo','pink','gold_block'],winter:['Làng Tuyết','ice','stone_pillar'],castle:['Thành Cổ','cobble','stone_pillar'],desert:['Ốc Đảo','sand','gold_block'],moon:['Quảng Trường','stone','gold_block'],lagoon:['Biển Xanh','water','stone_pillar']};
const ITEM_NAMES={extra_balloon:'Thêm bóng',water_range:'Sức nước',speed:'Tốc độ',skates:'Giày trượt',kick:'Đá bóng',glove:'Ném bóng',shield:'Khiên',remote:'Điều khiển nổ',star:'Ngôi sao'};
const gameCanvas=$('gameCanvas'),c=gameCanvas.getContext('2d',{alpha:false});
const session={nick:localStorage.getItem('bb_nick')||'',avatar:localStorage.getItem('bb_avatar')||'frog_kid',id:'',room:'',ws:null,world:null,prior:new Map(),snapAt:0,lastEvent:0,eventsReady:false,seq:0,retries:0,manualExit:false,keys:new Set(),touchDir:'',sentDir:'',lastSent:0,zoom:localStorage.getItem('bb_camera')!=='off',offline:false,rosterHash:'',countdown:-1};
const pref={music:localStorage.getItem('bb_music')!=='off',sfx:localStorage.getItem('bb_sfx')!=='off',musicVolume:Number(localStorage.getItem('bb_music_vol')??55)/100,sfxVolume:Number(localStorage.getItem('bb_sfx_vol')??70)/100};
const assets={manifest:null,images:new Map(),sounds:new Map(),errors:[],ready:false};
const assetUrl=(category,name)=>`${ROOT}${category}/${name}`;
function image(category,name){return assets.images.get(`${category}/${name}`)}
function sound(name){return assets.sounds.get(name)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setStatus(text,good=false){$('serverStatus').classList.toggle('ok',good);$('serverStatus').innerHTML=`<span class="status-dot"></span> ${text}`}
function toast(text,ms=2200){const t=$('gameToast');t.textContent=text;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,ms)}
function safeText(text){return String(text??'').replace(/[<>\x00-\x1f]/g,'').slice(0,120)}
async function loadAssets(){
  try{
    const response=await fetch(assetUrl('','asset_manifest.json').replace('//asset_manifest','/asset_manifest'),{cache:'force-cache'});
    if(!response.ok)throw Error(`Manifest HTTP ${response.status}`);
    assets.manifest=await response.json();
    const loaders=[];
    for(const [cat, names] of Object.entries(assets.manifest.categories)){
      if(!/0[1-8]_/.test(cat))continue;
      for(const name of names){
        if(cat==='08_audio'){
          const wav=new Audio(assetUrl(cat,name));wav.preload='auto';
          wav.addEventListener('error',()=>assets.errors.push(`${cat}/${name}`),{once:true});
          assets.sounds.set(name.replace(/\.wav$/,''),wav);
          // Decode audio lazily: do not delay a playable lobby for large WAV downloads.
          wav.load();
        }else{
          const img=new Image();img.decoding='async';img.src=assetUrl(cat,name);
          assets.images.set(`${cat}/${name}`,img);
          loaders.push(img.decode().catch(()=>assets.errors.push(`${cat}/${name}`)));
        }
      }
    }
    await Promise.all(loaders);
    assets.ready=true;
    if(assets.errors.length)console.warn('Unable to load game assets:',assets.errors);
  }catch(err){
    assets.errors.push('manifest: '+String(err));
    console.error('Asset kit could not be loaded',err);
    setStatus('Thiếu hình/âm thanh');
  }
}
function audioUnlock(){
  // Autoplay is forbidden until a user gesture; initialize on interaction only.
  if(!assets.ready)return;
  const bg=sound('original_retro_lobby_loop');
  if(bg){bg.loop=true;bg.volume=pref.music?pref.musicVolume*.78:0;
    if(bg.paused)bg.play().catch(()=>{});
  }
  // iOS Safari initializes the media elements while this gesture is active.
  if(!audioUnlock.once){
    audioUnlock.once=true;
    for(const [key,wav] of assets.sounds){
      if(key==='original_retro_lobby_loop')continue;
      wav.muted=true;
      const promise=wav.play();
      if(promise)promise.then(()=>{wav.pause();wav.currentTime=0;wav.muted=false}).catch(()=>{wav.muted=false});
    }
  }
}
function playSound(name){
  if(!pref.sfx)return;
  const original=sound(name);if(!original)return;
  const a=original.cloneNode(true);a.volume=Math.min(1,pref.sfxVolume);
  a.play().catch(()=>{});
  a.onended=()=>{a.removeAttribute('src');a.load()};
}
function updateSound(){
  $('musicToggle').classList.toggle('off',!pref.music);$('soundToggle').classList.toggle('off',!pref.sfx);
  const bg=sound('original_retro_lobby_loop');
  if(bg){bg.volume=pref.music?pref.musicVolume*.78:0;if(pref.music && audioUnlock.once && bg.paused)bg.play().catch(()=>{});}
}
function drawSprite(category,name,x,y,size=TILE,alpha=1,flip=false){
  const img=image(category,name+'.png');
  if(!img?.complete||!img.naturalWidth)return;
  c.save();c.globalAlpha=alpha;
  if(flip){c.translate(x+size,y);c.scale(-1,1);c.drawImage(img,0,0,size,size)}
  else c.drawImage(img,x,y,size,size);
  c.restore();
}
function renderMap(t){
  c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;
  c.clearRect(0,0,WIDTH,HEIGHT);
  const world=session.world;
  const floor=MAPS[world?.map??'village']?.[1]??'wood';
  const solid=MAPS[world?.map??'village']?.[2]??'stone_pillar';
  const me=world?.players?.find(p=>p.id===session.id);
  const small=matchMedia('(max-width:760px)').matches;
  // Mobile framing follows player; viewport remains fixed logical ratio, preventing collision drift.
  if(small && session.zoom && world?.state==='playing' && me?.alive){
    const viewW=9.4*TILE,viewH=viewW*H/W,scale=WIDTH/viewW;
    const camX=Math.max(0,Math.min(WIDTH-viewW,me.x*TILE-viewW/2));
    const camY=Math.max(0,Math.min(HEIGHT-viewH,me.y*TILE-viewH/2));
    c.setTransform(scale,0,0,scale,-camX*scale,-camY*scale);
  }
  const demo=!world;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    drawSprite('02_floor_tiles',floor,x*TILE,y*TILE);
  }
  if(demo){for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    if(x===0||y===0||x===W-1||y===H-1||(x%2===0&&y%2===0))drawSprite('03_obstacles',solid,x*TILE,y*TILE);
    else if((x*3+y*5)%7===0)drawSprite('03_obstacles','wood_crate',x*TILE,y*TILE);
  }}else{
    for(const [x,y] of world.walls??[])drawSprite('03_obstacles',solid,x*TILE,y*TILE);
    for(const [x,y,type] of world.crates??[])drawSprite('03_obstacles',type||'wood_crate',x*TILE,y*TILE);
    for(const [x,y,kind] of world.pickups??[]){
      const wobble=Math.sin(t*.004+x*1.7)*3;
      drawSprite('04_powerups',kind,x*TILE,y*TILE+wobble);
    }
    for(const b of world.bombs??[]){
      const age=(2.15-b.fuse)*1000;
      const frame=Math.min(3,Math.max(0,Math.floor((age%660)/165)));
      drawSprite('05_water_balloons',`balloon_0${frame}`,b.x*TILE,b.y*TILE);
    }
    for(const [x,y,ttl] of world.blasts??[]){
      const idx=Math.max(0,Math.min(5,Math.floor((.49-ttl)/.49*6)));
      drawSprite('06_water_blasts',`water_burst_0${idx}`,x*TILE,y*TILE);
    }
    const players=[...world.players].sort((a,b)=>a.y-b.y);
    for(const p of players){
      if(!p.alive && !p.trapped)continue;
      let x=p.x,y=p.y;
      // Short bounded extrapolation smooths 12Hz authoritative snapshots without teleporting.
      if(!p.trapped && p.alive && p.connected){
        const elapsed=Math.min(.085,Math.max(0,(performance.now()-session.snapAt)/1000));
        const [dx,dy]=p.dir??[0,0];
        if(Math.abs(dx)+Math.abs(dy)===1){x+=dx*p.speed*elapsed;y+=dy*p.speed*elapsed;}
      }
      const moving=p.dir && (p.dir[0]||p.dir[1]);
      const bob=moving?Math.sin(t*.018+p.x)*2:0;
      const spriteSize=64;
      const px=x*TILE-1,py=y*TILE-8+bob;
      if(p.id===session.id){
        c.fillStyle='#fff459';c.strokeStyle='#03629e';c.lineWidth=2;
        c.beginPath();c.ellipse(x*TILE,y*TILE+19,20,7,0,0,2*Math.PI);c.fill();c.stroke();
      }
      drawSprite('01_characters',p.avatar||'frog_kid',px-spriteSize/2,py-spriteSize/2,spriteSize,p.connected?1:.52,Boolean(p.dir?.[0]===-1));
      if(p.trapped){
        c.save();c.globalAlpha=.85;c.fillStyle='#63dfff73';c.strokeStyle='#c2ffff';c.lineWidth=3;
        c.beginPath();c.arc(x*TILE,y*TILE-6,27,0,Math.PI*2);c.fill();c.stroke();c.restore();
        drawSprite('06_water_blasts','water_burst_01',x*TILE-29,y*TILE-37,58,.7);
      }
      if(p.star){c.fillStyle='#ffe26b';c.font='bold 20px serif';c.fillText('✦',x*TILE+16,y*TILE-24)}
      if(p.shield){c.strokeStyle='#ffef87';c.lineWidth=2;c.beginPath();c.arc(x*TILE,y*TILE-5,30,0,2*Math.PI);c.stroke()}
      // Historical screenshots show names over heads.
      const label=safeText(p.name);
      c.save();c.font='bold 12px Verdana';c.textAlign='center';c.lineWidth=3;
      c.strokeStyle='#124075';c.strokeText(label,x*TILE,y*TILE-39,95);
      c.fillStyle='#fff';c.fillText(label,x*TILE,y*TILE-39,95);c.restore();
    }
  }
  if(world?.state==='playing' && world.countdown>0){
    c.save();c.setTransform(1,0,0,1,0,0);
    c.fillStyle='#014a8a8f';c.fillRect(0,HEIGHT*.35,WIDTH,HEIGHT*.22);
    c.textAlign='center';c.font='bold 90px Verdana';c.lineWidth=7;c.strokeStyle='#035199';c.strokeText(world.countdown,WIDTH/2,HEIGHT*.5);
    c.fillStyle='#ffe65c';c.fillText(world.countdown,WIDTH/2,HEIGHT*.5);c.restore();
  }
}
function render(){renderMap(performance.now());requestAnimationFrame(render)}
function renderAvatarPicker(){
  $('avatarPicker').replaceChildren();
  for(const avatar of Object.keys(LABELS)){
    const button=document.createElement('button');button.type='button';button.className='avatar-choice'+(session.avatar===avatar?' selected':'');button.title=LABELS[avatar];button.setAttribute('aria-label',LABELS[avatar]);button.setAttribute('aria-pressed',String(session.avatar===avatar));
    const img=document.createElement('img');img.src=assetUrl('01_characters',avatar+'.png');img.alt='';button.append(img);
    button.addEventListener('click',()=>{
      audioUnlock();playSound('pickup');session.avatar=avatar;localStorage.setItem('bb_avatar',avatar);
      $('selectedAvatar').src=img.src;$('selectedAvatarName').textContent=LABELS[avatar];
      renderAvatarPicker();send({type:'avatar',value:avatar});
    });$('avatarPicker').append(button);
  }
  $('selectedAvatar').src=assetUrl('01_characters',session.avatar+'.png');$('selectedAvatarName').textContent=LABELS[session.avatar];
}
function renderItemPreview(){const parent=$('itemPreview');parent.replaceChildren();for(const name of Object.keys(ITEM_NAMES)){
  const img=document.createElement('img');img.src=assetUrl('04_powerups',name+'.png');img.alt=ITEM_NAMES[name];img.title=ITEM_NAMES[name];parent.append(img);
}}
function setScreen(game){$('homeScreen').hidden=game;$('gameScreen').hidden=!game;document.body.classList.toggle('in-game',game)}
function rememberName(){session.nick=safeText($('nickname').value||session.nick||'Khách nhỏ').slice(0,16);$('nickname').value=session.nick;localStorage.setItem('bb_nick',session.nick)}
async function refreshRooms(){
  try{
    const response=await fetch('/api/rooms',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
    const rooms=await response.json();const node=$('roomList');node.replaceChildren();
    if(!rooms.length){const empty=document.createElement('div');empty.className='empty-list';empty.textContent='Chưa có phòng nào. Hãy tạo phòng đầu tiên!';node.append(empty);return}
    for(const room of rooms){
      const row=document.createElement('div');row.className='room-row';
      const name=document.createElement('strong');name.textContent='#'+room.id;
      const theme=document.createElement('span');theme.textContent=MAPS[room.map]?.[0]??'Đấu trường';
      const stats=document.createElement('span');stats.className='room-state';stats.textContent=`${room.players}/8 · ${room.mode==='teams'?'Đội':'Tự do'}`;
      const button=document.createElement('button');button.textContent=room.state==='playing'?'XEM':'VÀO';button.addEventListener('click',()=>joinRoom(room.id));
      row.append(name,theme,stats,button);node.append(row);
    }
  }catch(e){console.warn('Could not load public rooms',e)}
}
async function createRoom(isPrivate){
  rememberName();audioUnlock();
  try{
    const response=await fetch('/api/rooms'+(isPrivate?'?private=true':''),{method:'POST',credentials:'same-origin'});
    if(!response.ok){const detail=await response.json();throw Error(detail.detail||'Không thể tạo phòng')}
    const {id}=await response.json();joinRoom(id);
  }catch(e){alert(e.message)}
}
async function quickPlay(){rememberName();audioUnlock();
  try{
    const rooms=await(await fetch('/api/rooms')).json();
    const target=rooms.find(r=>r.state==='waiting'&&r.players<8);
    if(target)return joinRoom(target.id);
  }catch{}createRoom(false);
}
async function joinRoom(code){
  code=String(code||'').trim().toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
  if(code.length!==6)return alert('Mã phòng gồm 6 ký tự!');
  rememberName();audioUnlock();session.manualExit=false;session.room=code;
  history.replaceState({},'',`?room=${code}`);setScreen(true);$('currentRoom').textContent=code;
  $('boardOverlay').hidden=false;
  connectSocket();
}
function connectSocket(){
  if(!session.room || session.manualExit)return;
  if(session.ws){try{session.ws.onclose=null;session.ws.close()}catch{}}
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${protocol}://${location.host}/ws/${session.room}?name=${encodeURIComponent(session.nick)}&avatar=${encodeURIComponent(session.avatar)}`);
  session.ws=ws;setStatus('Đang vào phòng...');
  ws.addEventListener('open',()=>{session.retries=0;session.seq=0;session.lastSent=0;session.sentDir='';setStatus('Đã kết nối',true)});
  ws.addEventListener('message',e=>{
    let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==='welcome'){
      session.id=m.id;session.world=null;session.lastEvent=0;session.eventsReady=false;session.rosterHash='';
      return;
    }
    if(m.type==='state')receiveState(m);
    if(m.type==='chat')addChat(m.name,m.text);
  });
  ws.addEventListener('close',event=>{
    if(session.ws!==ws||session.manualExit)return;
    setStatus('Mất kết nối');
    if([4401,4404,4409,4403].includes(event.code)){
      session.manualExit=true;alert(event.code===4401?'Phiên đã hết hạn. Hãy tải lại trang để nhận phiên mới.':event.code===4404?'Không tìm thấy phòng!':event.code===4409?'Phòng đã đầy!':'Kết nối bị từ chối');leaveRoom();return;
    }
    const wait=Math.min(8000,500*Math.pow(1.65,session.retries++));toast('Đang kết nối lại…');setTimeout(()=>{if(!session.manualExit&&session.ws===ws)connectSocket()},wait);
  });
}
function send(payload){if(session.ws?.readyState===WebSocket.OPEN){session.ws.send(JSON.stringify(payload));return true}return false}
function receiveState(world){
  const prev=session.world;session.world=world;session.snapAt=performance.now();
  if(!session.eventsReady){session.lastEvent=Math.max(0,...(world.events??[]).map(e=>e.id??0));session.eventsReady=true;}
  else for(const event of world.events??[]){if(event.id>session.lastEvent){handleEvent(event);session.lastEvent=event.id}}
  if(world.state==='playing' && world.countdown!==session.countdown && world.countdown>0){
    playSound('countdown_tick');
  }
  session.countdown=world.countdown;
  const mins=String(Math.floor(world.time/60)).padStart(2,'0');const secs=String(world.time%60).padStart(2,'0');$('timer').textContent=`${mins}:${secs}`;
  $('currentRoom').textContent=world.room;
  $('playerCounter').textContent=`${world.players.filter(p=>p.connected).length} / 8`;
  renderOverlay();
  const rosterKey=JSON.stringify(world.players.map(p=>[p.id,p.name,p.avatar,p.team,p.alive,p.trapped,p.ready,p.connected,p.spectator,p.score]));
  if(rosterKey!==session.rosterHash){session.rosterHash=rosterKey;renderRoster()}
  renderInventory();
  if(prev?.state!==world.state){
    if(world.state==='playing'){playSound('countdown_tick');session.keys.clear();sendInput(true)}
    if(world.state==='finished')playResult(world);
  }
}
function handleEvent(e){
  const key=e.type;
  const sounds={bomb:'balloon_place',inflate:'balloon_inflate',splash:'water_burst',trap:'trapped_in_bubble',rescue:'rescue_teammate',pickup:'pickup',speed_boost:'speed_boost',shield:'pickup',kick:'balloon_place'};
  if(sounds[key])playSound(sounds[key]);
  if(key==='trap' && e.who===session.id)toast('Bạn bị nhốt! Chờ đồng đội cứu!');
  if(key==='rescue' && e.who===session.id)toast('Được cứu rồi!');
  if(key==='pickup' && e.who===session.id)toast('Nhặt được: '+(ITEM_NAMES[e.kind]||e.kind));
  if(key==='disconnect')toast('Một người chơi mất kết nối');
}
function playResult(w){const me=w.players.find(p=>p.id===session.id);let win=false;if(me)win=w.mode==='teams'?String(me.team)===w.winner:me.id===w.winner;
  if(win){playSound('victory_jingle');toast('CHIẾN THẮNG! Trận quá hay!',4000)}
  else{playSound('defeat_jingle');toast(w.winner==='draw'?'HÒA!':'HẸN TRẬN SAU!',4000)}
}
function renderOverlay(){
  const w=session.world;if(!w)return;
  const overlay=$('boardOverlay');overlay.hidden=w.state==='playing';
  if(w.state==='playing')return;
  const me=w.players.find(p=>p.id===session.id),host=w.host===session.id;
  $('overlayTitle').textContent=w.state==='finished'?(w.winner==='draw'?'TRẬN HÒA!':'KẾT THÚC TRẬN!'):'SẴN SÀNG CHƠI CHƯA?';
  $('overlayDesc').textContent=w.state==='finished'?'Cùng chơi lại ván nữa nhé!':'Chọn bản đồ, chờ bạn bè vào và sẵn sàng.';
  $('mapPicker').value=w.map||'village';$('mapPicker').disabled=!host;
  for(const button of $('modeButtons').querySelectorAll('button')){
    button.classList.toggle('selected',button.dataset.mode===w.mode);button.disabled=!host;
  }
  const parent=$('overlayPlayers');parent.replaceChildren();
  for(let i=0;i<8;i++){
    const p=w.players[i];const card=document.createElement('div');card.className='waiting-player'+(p?'':' empty');
    if(p){const img=document.createElement('img');img.src=assetUrl('01_characters',p.avatar+'.png');img.alt='';
      const name=document.createElement('strong');name.textContent=p.name;
      const status=document.createElement('small');status.textContent=p.connected?(p.ready?'SẴN SÀNG':'CHƯA SẴN SÀNG'):'MẤT MẠNG';
      card.append(img,name,status);
    }else card.textContent='CHỜ BẠN';
    parent.append(card);
  }
  const ready=$('readyButton'),start=$('startGame');
  ready.hidden=host;ready.classList.toggle('sprite-cancel',Boolean(me?.ready));ready.classList.toggle('sprite-ready',!me?.ready);
  ready.textContent=me?.ready?'HỦY':'SẴN SÀNG';
  start.hidden=!host;start.textContent=w.state==='finished'?'CHƠI LẠI':'BẮT ĐẦU';
  const anyUnready=w.players.some(p=>p.id!==session.id&&p.connected&&!p.ready);
  start.disabled=anyUnready;
  $('waitingNote').textContent=host?(anyUnready?'Hãy chờ tất cả bạn bè sẵn sàng.':'Bạn là chủ phòng. Bấm bắt đầu khi đã sẵn sàng!'):'Đang chờ chủ phòng bắt đầu trận đấu.';
}
function renderRoster(){
  const node=$('roster');node.replaceChildren();const w=session.world;if(!w)return;
  for(const p of w.players){const row=document.createElement('div');row.className='player-card'+(p.id===session.id?' mine':'')+(!p.alive&&!p.spectator?' dead':'')+(p.trapped?' trapped':'')+(!p.connected?' disconnected':'');
    const img=document.createElement('img');img.src=assetUrl('01_characters',p.avatar+'.png');img.alt='';
    const info=document.createElement('div');info.className='player-meta';const name=document.createElement('b');name.textContent=p.name+(p.id===w.host?' ★':'');
    const line=document.createElement('small');line.textContent=`${w.mode==='teams'?'Đội '+(p.team+1)+' · ':''}${p.score} điểm · ${p.spectator?'Đang xem':!p.connected?'Mất kết nối':p.trapped?'Bị nhốt':!p.alive?'Đã loại':w.state==='waiting'?(p.ready?'Sẵn sàng':'Đang chờ'):'Đang chơi'}`;
    info.append(name,line);row.append(img,info);node.append(row);
  }
}
function renderInventory(){
  const w=session.world,me=w?.players?.find(p=>p.id===session.id),parent=$('inventory');
  if(!me)return;
  if(parent.childElementCount!==9){parent.replaceChildren();for(const kind of Object.keys(ITEM_NAMES)){const img=document.createElement('img');img.src=assetUrl('04_powerups',kind+'.png');img.title=ITEM_NAMES[kind];img.alt=ITEM_NAMES[kind];img.dataset.kind=kind;parent.append(img);}}
  for(const img of parent.children){const kind=img.dataset.kind;
    const owned=kind==='speed'?me.speed>3:kind==='water_range'?me.power>2:kind==='extra_balloon'?me.capacity>1:kind==='skates'?me.speed>3.7:kind==='kick'?me.kick:kind==='glove'?me.glove:kind==='shield'?me.shield:kind==='remote'?me.remote:kind==='star'?me.star:false;
    img.style.opacity=owned?'1':'.45';
  }
  $('myStats').textContent=`Bóng: ${me.capacity}  ·  Sức nước: ${me.power}  ·  Tốc độ: ${me.speed.toFixed(1)}${me.shield?'  ·  Khiên: '+me.shield:''}`;
  $('mobileThrow').disabled=!me.glove;$('mobileRemote').disabled=!me.remote;
}
function addChat(name,text){const row=document.createElement('p');const b=document.createElement('b');b.textContent=safeText(name)+': ';row.append(b,document.createTextNode(safeText(text)));
  const node=$('chatMessages');node.append(row);while(node.children.length>80)node.firstChild.remove();node.scrollTop=node.scrollHeight;
}
function currentDir(){let dx=0,dy=0;const k=session.keys;
  if(k.has('ArrowLeft')||k.has('a'))dx=-1;
  if(k.has('ArrowRight')||k.has('d'))dx=1;
  if(!dx){if(k.has('ArrowUp')||k.has('w'))dy=-1;if(k.has('ArrowDown')||k.has('s'))dy=1}
  if(session.touchDir){const t=session.touchDir;if(t==='left'){dx=-1;dy=0}else if(t==='right'){dx=1;dy=0}else if(t==='up'){dx=0;dy=-1}else if(t==='down'){dx=0;dy=1}}
  return [dx,dy];
}
function sendInput(force=false){
  if(session.world?.state!=='playing')return;
  const [dx,dy]=currentDir(),dir=dx+','+dy,now=performance.now();
  // Keep-alive inputs guarantee stable movement after bursty network tick arrival.
  if(force||dir!==session.sentDir||now-session.lastSent>85){session.sentDir=dir;session.lastSent=now;send({type:'input',seq:++session.seq,dx,dy})}
}
function leaveRoom(){session.manualExit=true;if(session.ws){session.ws.onclose=null;session.ws.close();session.ws=null}
  session.room='';session.world=null;session.id='';session.eventsReady=false;session.rosterHash='';session.keys.clear();session.touchDir='';
  history.replaceState({},'',location.pathname);setScreen(false);setStatus('Sẵn sàng',true);refreshRooms();
}
async function boot(){
  setStatus('Đang tải tài nguyên...');
  $('nickname').value=session.nick;$('musicVolume').value=Math.round(pref.musicVolume*100);$('sfxVolume').value=Math.round(pref.sfxVolume*100);
  updateSound();
  try{const r=await fetch('/api/session',{credentials:'same-origin'});if(!r.ok)throw Error('Session unavailable');const s=await r.json();
    if(!session.nick){session.nick=s.suggestedName;$('nickname').value=session.nick}
    setStatus('Sẵn sàng',true);
  }catch{setStatus('Mất kết nối')}
  await loadAssets();
  renderAvatarPicker();renderItemPreview();refreshRooms();
  setInterval(()=>{if($('homeScreen').hidden)return;refreshRooms()},6500);
  const requested=new URLSearchParams(location.search).get('room');if(requested&&requested.length===6)joinRoom(requested);
  requestAnimationFrame(render);
}
$('quickPlay').addEventListener('click',quickPlay);
$('createRoom').addEventListener('click',()=>createRoom(true));
$('practice').addEventListener('click',()=>createRoom(true));
$('joinForm').addEventListener('submit',e=>{e.preventDefault();joinRoom($('roomCode').value)});
$('refreshRooms').addEventListener('click',refreshRooms);
$('leaveRoom').addEventListener('click',leaveRoom);
$('logo').addEventListener('click',()=>{if(session.room && !confirm('Rời phòng hiện tại?'))return;leaveRoom()});
$('readyButton').addEventListener('click',()=>{audioUnlock();const me=session.world?.players.find(p=>p.id===session.id);send({type:'ready',value:!me?.ready});playSound('pickup')});
$('startGame').addEventListener('click',()=>{audioUnlock();send({type:'start'})});
$('mapPicker').addEventListener('change',e=>send({type:'map',value:e.target.value}));
for(const button of $('modeButtons').querySelectorAll('button'))button.addEventListener('click',()=>send({type:'mode',value:button.dataset.mode}));
$('shareRoom').addEventListener('click',()=>{const url=location.href;const copy=navigator.clipboard?.writeText(url);
  Promise.resolve(copy).then(()=>toast('Đã sao chép liên kết phòng!')).catch(()=>prompt('Link phòng:',url));
});
$('chatForm').addEventListener('submit',e=>{e.preventDefault();const input=$('chatInput'),txt=input.value.trim();if(txt){send({type:'chat',value:txt});input.value=''}});
$('musicToggle').addEventListener('click',()=>{audioUnlock();pref.music=!pref.music;localStorage.setItem('bb_music',pref.music?'on':'off');updateSound()});
$('soundToggle').addEventListener('click',()=>{audioUnlock();pref.sfx=!pref.sfx;localStorage.setItem('bb_sfx',pref.sfx?'on':'off');updateSound();if(pref.sfx)playSound('pickup')});
$('musicVolume').addEventListener('input',e=>{audioUnlock();pref.musicVolume=Number(e.target.value)/100;localStorage.setItem('bb_music_vol',e.target.value);updateSound()});
$('sfxVolume').addEventListener('input',e=>{pref.sfxVolume=Number(e.target.value)/100;localStorage.setItem('bb_sfx_vol',e.target.value)});
$('zoomMap').addEventListener('click',()=>{session.zoom=!session.zoom;localStorage.setItem('bb_camera',session.zoom?'on':'off')});
$('mobileBomb').addEventListener('pointerdown',e=>{e.preventDefault();audioUnlock();send({type:'bomb'})});
$('mobileThrow').addEventListener('pointerdown',e=>{e.preventDefault();send({type:'throw'})});
$('mobileRemote').addEventListener('pointerdown',e=>{e.preventDefault();send({type:'detonate'})});
for(const button of document.querySelectorAll('.dpad button')){
  const release=e=>{e.preventDefault();button.classList.remove('pressed');if(session.touchDir===button.dataset.dir)session.touchDir='';sendInput(true)};
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);session.touchDir=button.dataset.dir;button.classList.add('pressed');sendInput(true)});
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
window.addEventListener('keydown',e=>{
  if(document.activeElement?.matches('input, textarea, select'))return;
  const key=e.key.length===1?e.key.toLowerCase():e.key;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','w','a','s','d','r','e'].includes(key))e.preventDefault();
  if(key===' ' && !e.repeat){audioUnlock();send({type:'bomb'});return}
  if(key==='r'&&!e.repeat){send({type:'throw'});return}
  if(key==='e'&&!e.repeat){send({type:'detonate'});return}
  session.keys.add(key);sendInput(true);
});
window.addEventListener('keyup',e=>{const key=e.key.length===1?e.key.toLowerCase():e.key;session.keys.delete(key);sendInput(true)});
window.addEventListener('blur',()=>{session.keys.clear();session.touchDir='';sendInput(true)});
window.addEventListener('pagehide',()=>{session.keys.clear();session.touchDir='';sendInput(true)});
setInterval(()=>sendInput(),55);
boot();
