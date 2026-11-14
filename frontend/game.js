/* Bong Bong Party: original canvas artwork, original synthesized audio,
   authoritative QPyServe/FastAPI WebSocket multiplayer. No external assets. */
const $ = id => document.getElementById(id);
const W = 15, H = 13, TILE = 60;
const COLORS = {
  coral: {skin:'#ffb8a5',edge:'#f26f76',ears:'#ff8491',belly:'#fff0d6',hat:'#ff6f75'},
  aqua:  {skin:'#b2f2fa',edge:'#44b6d9',ears:'#6bd4ec',belly:'#eeffff',hat:'#39afdb'},
  lilac: {skin:'#dfc5ff',edge:'#a47fdb',ears:'#bd9df1',belly:'#f8edff',hat:'#a58bea'},
  lemon: {skin:'#fff1a1',edge:'#f4bb58',ears:'#ffd875',belly:'#fffadd',hat:'#e6b143'},
  mint:  {skin:'#baf4d8',edge:'#5dbfa7',ears:'#78dfb3',belly:'#e8ffea',hat:'#48be9e'},
  rose:  {skin:'#ffd0dc',edge:'#ed86a7',ears:'#ffabc2',belly:'#fff2f2',hat:'#ee83a2'},
  sky:   {skin:'#bee7ff',edge:'#77b1e9',ears:'#8ed1f6',belly:'#effaff',hat:'#529ddc'},
  peach: {skin:'#ffceaa',edge:'#ed9d75',ears:'#f7b98b',belly:'#fff0d8',hat:'#f29974'}
};
const state = {id:'',room:'',socket:null,world:null,previous:new Map(),receivedAt:0,
  keys:new Set(), mobileDir:'',sentDir:'',name:'',autoStart:false,manualExit:false,
  retries:0,toastTimer:null,audioEnabled:localStorage.getItem('bb_sound')!=='off',
  musicEnabled:localStorage.getItem('bb_music')!=='off',zoomMobile:localStorage.getItem('bb_zoom')!=='off',lastEvents:[],roomListTimer:0};

// WebAudio instruments are tiny and entirely original. They don't load or copy game audio.
const audio = {ctx:null,master:null,step:0,timer:null};
const theme = [392,0,440,523.25,659.25,523.25,440,0,392,440,523.25,0,587.33,523.25,440,0,
  349.23,0,392,440,523.25,0,440,392,349.23,0,392,523.25,440,392,329.63,0];
const bass = [174.61,174.61,174.61,174.61,196,196,196,196,220,220,220,220,196,196,196,196];
function initAudio(){
  if(!audio.ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC)return;
    audio.ctx = new AC();audio.master=audio.ctx.createGain();audio.master.gain.value=.18;audio.master.connect(audio.ctx.destination);
  }
  if(audio.ctx.state==='suspended')audio.ctx.resume().catch(()=>{});
  if(!audio.timer){audio.timer=window.setInterval(()=>{
    if(!state.musicEnabled || document.hidden || !audio.ctx || audio.ctx.state!=='running')return;
    const k=audio.step++;const note=theme[k%theme.length];
    if(note)tone(note,.16,'triangle',.15);
    if(k%4===0)tone(bass[(k/4|0)%bass.length],.29,'sine',.17);
    if(k%2===1)tick(.025);
  },230);}
}
function tone(freq,duration=.12,shape='sine',volume=.22,slide=1){
  if(!audio.ctx || !state.audioEnabled)return;
  const t=audio.ctx.currentTime,o=audio.ctx.createOscillator(),g=audio.ctx.createGain();
  o.type=shape;o.frequency.setValueAtTime(freq,t);if(slide!==1)o.frequency.exponentialRampToValueAtTime(Math.max(55,freq*slide),t+duration);
  g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(volume,t+.009);
  g.gain.exponentialRampToValueAtTime(.001,t+duration);
  o.connect(g);g.connect(audio.master);o.start(t);o.stop(t+duration+.008);
}
function tick(volume=.05){tone(5500,.018,'sine',volume,.5)}
function sfx(type){
  if(!state.audioEnabled || !audio.ctx)return;
  if(type==='tap')tone(590,.085,'sine',.21,1.22);
  if(type==='bomb'){tone(360,.15,'sine',.32,.55);setTimeout(()=>tone(560,.11,'triangle',.15,1.22),35)}
  if(type==='splash'){tone(180,.27,'sawtooth',.15,.3);setTimeout(()=>tone(770,.25,'sine',.25,.62),60)}
  if(type==='trap'){tone(880,.3,'sine',.23,.37);setTimeout(()=>tone(660,.2,'triangle',.13,.6),110)}
  if(type==='pickup'){[660,830,990].forEach((f,i)=>setTimeout(()=>tone(f,.13,'triangle',.18),i*70))}
  if(type==='rescue'){[523,659,784].forEach((f,i)=>setTimeout(()=>tone(f,.2,'sine',.23),i*85))}
  if(type==='win'){[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.38,'triangle',.21),i*155))}
}
function updateAudioButtons(){
  $('soundToggle').classList.toggle('muted',!state.audioEnabled);
  $('musicToggle').classList.toggle('muted',!state.musicEnabled);
  $('soundToggle').title=state.audioEnabled?'Tắt hiệu ứng':'Bật hiệu ứng';
  $('musicToggle').title=state.musicEnabled?'Tắt nhạc':'Bật nhạc';
}

function roundRect(c,x,y,w,h,r,fill,stroke,lw=1){
  c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill()}
  if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke()}
}
function ellipse(c,x,y,rx,ry,fill,stroke,lw=1){
  c.beginPath();c.ellipse(x,y,rx,ry,0,0,2*Math.PI);if(fill){c.fillStyle=fill;c.fill()}
  if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke()}
}
function star(c,x,y,r,fill,points=5){
  c.beginPath();for(let i=0;i<points*2;i++){
    let a=Math.PI*i/points-Math.PI/2,rr=i%2?r*.48:r;
    if(i===0)c.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);
    else c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);
  }c.closePath();c.fillStyle=fill;c.fill();
}
function drawCharacter(c,p,px,py,scale=56,t=0){
  const col=COLORS[p.color]||COLORS.coral;
  c.save();c.translate(px,py);c.scale(scale/100,scale/100);
  const moving=Math.sin(t*0.014+px)*2.6;
  ellipse(c,0,42,39,10,'#326b8150');
  if(p.alive===false)c.globalAlpha=.5;
  // Soft mittens, dancing little shoes, and a small rotund body.
  ellipse(c,-21,33+moving,15,10,col.edge,'#397a9b',2.7);
  ellipse(c,22,33-moving,15,10,col.edge,'#397a9b',2.7);
  ellipse(c,0,11,35,33,col.skin,'#4783a1',4);
  ellipse(c,0,17,22,23,col.belly);
  ellipse(c,-33,15,10,14,col.skin,'#4783a1',2.5);
  ellipse(c,33,15,10,14,col.skin,'#4783a1',2.5);
  const variant=Object.keys(COLORS).indexOf(p.color)%4;
  if(variant===1){ // floppy rabbit ears
    c.save();c.rotate(-.17);ellipse(c,-26,-48,14,34,col.edge,'#4783a1',3);ellipse(c,-26,-48,7,22,'#ffe3f0');c.restore();
    c.save();c.rotate(.17);ellipse(c,26,-48,14,34,col.edge,'#4783a1',3);ellipse(c,26,-48,7,22,'#ffe3f0');c.restore();
  }else if(variant===2){ // cat ears
    c.beginPath();c.moveTo(-41,-30);c.lineTo(-40,-72);c.lineTo(-10,-48);c.closePath();c.fillStyle=col.edge;c.fill();c.strokeStyle='#4783a1';c.lineWidth=3;c.stroke();
    c.beginPath();c.moveTo(41,-30);c.lineTo(40,-72);c.lineTo(10,-48);c.closePath();c.fillStyle=col.edge;c.fill();c.stroke();
    c.beginPath();c.moveTo(-35,-43);c.lineTo(-34,-61);c.lineTo(-20,-47);c.fillStyle='#fff4fa';c.fill();
    c.beginPath();c.moveTo(35,-43);c.lineTo(34,-61);c.lineTo(20,-47);c.fill();
  }else if(variant===3){ // tiny bear ears
    ellipse(c,-35,-45,18,18,col.edge,'#4783a1',3);ellipse(c,35,-45,18,18,col.edge,'#4783a1',3);
    ellipse(c,-35,-45,8,9,'#fff0e8');ellipse(c,35,-45,8,9,'#fff0e8');
  }else{ // round puff ears
    ellipse(c,-35,-42,20,19,col.edge,'#4783a1',3);ellipse(c,35,-42,20,19,col.edge,'#4783a1',3);
    ellipse(c,-35,-42,9,10,'#ffdde0');ellipse(c,35,-42,9,10,'#ffdde0');
  }
  ellipse(c,0,-21,46,39,col.skin,'#417d9d',3.8);
  ellipse(c,-18,-29,13,16,'#fff');ellipse(c,17,-29,13,16,'#fff');
  ellipse(c,-16,-28,5.5,9,'#284e6d');ellipse(c,19,-28,5.5,9,'#284e6d');
  ellipse(c,-14,-31,2.7,4,'white');ellipse(c,21,-31,2.7,4,'white');
  ellipse(c,-30,-8,9,5,'#ff8fa59b');ellipse(c,30,-8,9,5,'#ff8fa59b');
  ellipse(c,0,-14,5,4,col.edge);
  c.beginPath();c.arc(0,-10,8,0,Math.PI);c.strokeStyle='#a25c73';c.lineWidth=2.8;c.stroke();
  ellipse(c,-16,-50,19,6,'#ffffff80');
  // Star badge gives the silhouette its own visual identity.
  star(c,0,18,9,'#ffdb62');
  c.restore();
}
function drawWaterBomb(c,x,y,fuse,t){
  const bob=Math.sin(t*.008+x)*2;
  ellipse(c,x+5,y+20,21,7,'#376b7c52');
  c.save();c.translate(x,y+bob);
  ellipse(c,0,0,23,23,'#197fac','#246590',3);
  ellipse(c,-4,-6,17,17,'#43d4f2');
  ellipse(c,-10,-11,8,6,'#eaffffdd');
  ellipse(c,8,10,8,5,'#1798cd');
  ellipse(c,7,-26,4,8,'#f6be66','#9e8256',2);
  star(c,10,-34,Math.max(3,6-fuse),'#fff5ae');
  c.restore();
}
function drawCrate(c,x,y,t,idx){
  const color=idx%3===0?'#ffa76f':idx%3===1?'#f9d778':'#a5e3aa';
  const shadow=idx%3===0?'#d87d56':idx%3===1?'#d8aa54':'#78b99c';
  roundRect(c,x+5,y+9,52,48,11,shadow,'#ffffffa9',2);
  roundRect(c,x+3,y+4,52,45,11,color,'#fff7cb',3);
  roundRect(c,x+10,y+10,38,33,7,'#ffffff28');
  roundRect(c,x+24,y+6,10,39,4,'#ffffff74');
  roundRect(c,x+7,y+21,44,8,4,'#ffffff54');
  star(c,x+29,y+26,8,'#fff8dc');
  ellipse(c,x+14,y+13,7,3,'#ffffff9b');
}
function drawWall(c,x,y,idx){
  const colors=['#80dcef','#a1e9f5','#9ad4ef'];
  roundRect(c,x+3,y+8,55,52,13,'#5ab7d6','#daffff',2.2);
  roundRect(c,x+3,y+2,55,49,13,colors[idx%3],'#e8ffff',3);
  roundRect(c,x+9,y+8,43,12,7,'#e6fdffbd');
  ellipse(c,x+16,y+18,5,4,'#ffffff');
  ellipse(c,x+45,y+36,7,4,'#45b4d849');
  c.beginPath();c.moveTo(x+16,y+30);c.lineTo(x+25,y+40);c.lineTo(x+37,y+29);c.strokeStyle='#ffffff92';c.lineWidth=3;c.stroke();
}
function drawPickup(c,x,y,kind,t){
  const wobble=Math.sin(t*.006+x*3)*4;
  ellipse(c,x,y+18,17,5,'#255e6940');
  ellipse(c,x,y+wobble,18,19,'#fff9db','#ffba65',3);
  star(c,x,y+wobble,11,kind==='speed'?'#fbbd4e':kind==='range'?'#ff7e88':'#6bc8f4');
  c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.font='bold 17px system-ui';c.fillText(kind==='range'?'↗':kind==='speed'?'⚡':'+',x,y+wobble+1);
}
function drawBlast(c,x,y,t){
  const a=.8+.2*Math.sin(t*.019+x);
  c.save();c.globalAlpha=a;
  roundRect(c,x+8,y+4,44,52,17,'#44cfff8c');
  roundRect(c,x+4,y+12,52,36,17,'#65e9faaf');
  ellipse(c,x+30,y+30,24,24,'#83f2ff77');
  ellipse(c,x+19,y+17,7,8,'#efffffec');
  ellipse(c,x+40,y+35,6,7,'#ecffffba');
  star(c,x+36,y+15,7,'#fff4b1');c.restore();
}
const gameCanvas=$('gameCanvas'),ctx=gameCanvas.getContext('2d');
const heroCanvas=$('heroCanvas'),hctx=heroCanvas.getContext('2d');
function drawArena(t){
  const c=ctx;
  c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,900,780);
  const w=state.world;
  const me=w?.players?.find(p=>p.id===state.id);
  const camera=window.innerWidth<=800 && state.zoomMobile && w?.state==='playing' && me?.alive;
  let camX=0,camY=0;
  if(camera){
    const viewW=9.4*TILE,viewH=viewW*H/W;
    camX=Math.max(0,Math.min(900-viewW,me.x*TILE-viewW/2));
    camY=Math.max(0,Math.min(780-viewH,me.y*TILE-viewH/2));
    c.setTransform(900/viewW,0,0,780/viewH,-camX*(900/viewW),-camY*(780/viewH));
  }
  c.fillStyle='#b2eacd';c.fillRect(0,0,900,780);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    c.fillStyle=(x+y)%2?'#c1f2da':'#b4ebd3';c.fillRect(x*TILE,y*TILE,TILE,TILE);
    if((x*13+y*23)%17===0){
      ellipse(c,x*TILE+18,y*TILE+44,3,6,'#8edbaf');
      ellipse(c,x*TILE+43,y*TILE+19,2.5,4,'#8edbaf');
    }
    if((x*7+y*17)%31===0){star(c,x*TILE+30,y*TILE+30,4,'#fff9cc')}
  }
  if(!w){
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(x===0||y===0||x===W-1||y===H-1||(x%2===0&&y%2===0))drawWall(c,x*TILE,y*TILE,x+y);
      else if((x*5+y*11)%9<4 && x>2 && x<12 && y>1 && y<11)drawCrate(c,x*TILE,y*TILE,t,x+y);
    }
    return;
  }
  for(const [x,y] of w.walls||[])drawWall(c,x*TILE,y*TILE,x+y);
  for(const [x,y] of w.crates||[])drawCrate(c,x*TILE,y*TILE,t,x+y);
  for(const [x,y,kind] of w.pickups||[])drawPickup(c,x*TILE+30,y*TILE+28,kind,t);
  for(const b of w.bombs||[])drawWaterBomb(c,b.x*TILE+30,b.y*TILE+31,b.fuse,t);
  for(const [x,y] of w.blasts||[])drawBlast(c,x*TILE,y*TILE,t);
  const sorted=[...(w.players||[])].sort((a,b)=>a.y-b.y);
  for(const p of sorted){
    if(!p.alive)continue;
    // Interpolate remote entities for smooth 60fps visuals between server ticks.
    const prev=state.previous.get(p.id);
    const alpha=Math.max(0,Math.min(1,(performance.now()-state.receivedAt)/85));
    const x=prev?prev.x+(p.x-prev.x)*alpha:p.x;
    const y=prev?prev.y+(p.y-prev.y)*alpha:p.y;
    const px=x*TILE, py=y*TILE;
    if(p.id===state.id){ellipse(c,px,py+23,28,10,'#fff8b9ac')}
    drawCharacter(c,p,px,py+2,52,t);
    if(p.trapped){
      const grad=c.createRadialGradient(px-14,py-15,5,px,py,38);
      grad.addColorStop(0,'#ffffff85');grad.addColorStop(.65,'#77e2ff47');grad.addColorStop(1,'#25b8ef90');
      ellipse(c,px,py,36,41,grad,'#ffffffdf',3.3);
      ellipse(c,px-17,py-20,9,4,'#ffffffd9');
    }
    const name=p.id===state.id?'★ '+p.name:p.name;
    c.font='900 11px "Trebuchet MS",system-ui';c.textBaseline='middle';c.textAlign='center';
    const width=Math.min(110,c.measureText(name).width+15);
    roundRect(c,px-width/2,py-56,width,20,10,p.id===state.id?'#fff7d6':'#ffffffef','#c9ddec',1.3);
    c.fillStyle=p.id===state.id?'#bb8441':'#377b99';c.fillText(name,px,py-46,width-8);
  }
  if(camera){
    c.setTransform(1,0,0,1,0,0);
    // Small tactical overview remains visible when the mobile view follows the player.
    const mx=729,my=12,mw=158,mh=138;
    roundRect(c,mx,my,mw,mh,13,'#f2fcffdc','#ffffffed',3);
    c.save();c.translate(mx+7,my+8);c.scale((mw-14)/900,(mh-16)/780);
    c.fillStyle='#beeeda';c.fillRect(0,0,900,780);
    c.fillStyle='#8ad5ea';for(const [x,y] of w.walls||[])c.fillRect(x*TILE,y*TILE,TILE,TILE);
    c.fillStyle='#efbe76';for(const [x,y] of w.crates||[])c.fillRect(x*TILE,y*TILE,TILE,TILE);
    for(const p of w.players||[]){if(!p.alive)continue;
      ellipse(c,p.x*TILE,p.y*TILE,29,29,p.id===state.id?'#fa728e':'#2787cc','#ffffff',7);
    }
    c.restore();
  }
}
function drawHero(t){
  if($('homeScreen').hidden)return;
  const c=hctx;c.clearRect(0,0,660,440);
  const ground=c.createLinearGradient(0,255,0,440);ground.addColorStop(0,'#a4eac1');ground.addColorStop(1,'#84d8a1');
  c.fillStyle=ground;c.beginPath();c.ellipse(330,410,390,155,0,0,Math.PI*2);c.fill();
  ellipse(c,105,350,70,25,'#72d5b05d');ellipse(c,523,368,80,20,'#72d5b05d');
  [[45,150,23],[134,220,13],[480,97,16],[611,230,27],[353,160,10],[255,92,12]].forEach(([x,y,r],i)=>{
    ellipse(c,x,y+Math.sin(t*.001+i)*7,r,r,'#ffffff4f','#ffffffaf',3);
    ellipse(c,x-r*.3,y-r*.3,r*.2,r*.18,'#fff');
  });
  for(const [x,y] of [[100,385],[220,355],[406,378],[543,399]]){
    ellipse(c,x,y,5,5,'#ffe37f');ellipse(c,x-7,y+3,5,4,'#fff7cc');ellipse(c,x+7,y+3,5,4,'#fff7cc');
  }
  drawWaterBomb(c,325,290,1, t);
  drawCharacter(c,{color:'coral',alive:true},205,290+Math.sin(t*.003)*4,183,t);
  drawCharacter(c,{color:'aqua',alive:true},457,286+Math.sin(t*.003+2)*7,174,t);
  drawCharacter(c,{color:'lemon',alive:true},351,374+Math.sin(t*.003+4)*3,121,t);
  star(c,300,115,23,'#ffe49c');star(c,556,154,13,'#fffac2');star(c,107,274,11,'#fff2b0');
}
function animate(t){drawArena(t);drawHero(t);requestAnimationFrame(animate)}requestAnimationFrame(animate);

function safeName(){return ($('nickname').value.trim().replace(/[<>\x00-\x1f]/g,'').slice(0,16)||'Khách nhỏ')}
function toast(message){const box=$('toast');box.textContent=message;box.hidden=false;clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>box.hidden=true,2300)}
function showHome(){
  state.manualExit=true;if(state.socket){state.socket.onclose=null;state.socket.close()}
  state.socket=null;state.room='';state.world=null;state.previous=new Map();
  $('gameScreen').hidden=true;$('homeScreen').hidden=false;
  state.keys.clear();state.mobileDir='';state.sentDir='';
  history.replaceState(null,'',location.pathname);loadRooms();
}
function goGame(code){
  state.manualExit=false;state.room=code.toUpperCase();state.world=null;
  $('homeScreen').hidden=true;$('gameScreen').hidden=false;
  $('currentRoom').textContent=state.room;
  history.replaceState(null,'','?room='+state.room);
  $('chatMessages').replaceChildren();appendChat('Hệ thống','Phòng '+state.room+' đã sẵn sàng!');
  connect();
}
async function api(path,options){
  const response=await fetch('/api'+path,{credentials:'same-origin',...options});
  if(!response.ok)throw new Error('Máy chủ bận. Hãy thử lại nhé.');
  return response.json();
}
async function createRoom(practice=false,privateRoom=true){
  initAudio();sfx('tap');
  try{state.autoStart=practice;
    const {id}=await api('/rooms?private='+String(privateRoom),{method:'POST'});
    goGame(id);
  }catch(err){alert(err.message)}
}
async function quickPlay(){
  initAudio();sfx('tap');
  try{
    const rooms=await api('/rooms');
    const found=rooms.find(r=>r.state==='waiting'&&r.players<r.capacity);
    if(found){state.autoStart=false;goGame(found.id)}
    else await createRoom(false,false);
  }catch(err){alert(err.message)}
}
function joinRoom(code){
  code=String(code||'').trim().toUpperCase();
  if(!/^[A-Z2-9]{6}$/.test(code)){alert('Mã phòng gồm 6 ký tự nhé!');return}
  initAudio();sfx('tap');state.autoStart=false;goGame(code);
}
function connect(){
  const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws/'+state.room+'?name='+encodeURIComponent(safeName()));
  state.socket=ws;
  ws.onopen=()=>{state.retries=0;setOnline(true);toast('Đã vào phòng! 🎉');};
  ws.onmessage=e=>{
    let msg;try{msg=JSON.parse(e.data)}catch{return}
    if(msg.type==='welcome'){
      state.id=msg.id;
      if(state.autoStart){state.autoStart=false;setTimeout(()=>send({type:'start'}),150)}
    }else if(msg.type==='state'){
      state.previous=new Map((state.world?.players||[]).map(p=>[p.id,{x:p.x,y:p.y}]));
      state.receivedAt=performance.now();state.world=msg;
      applyEvents(msg.events||[]);renderWorld();
    }else if(msg.type==='chat')appendChat(msg.name,msg.text);
  };
  ws.onclose=e=>{
    if(state.manualExit || ws!==state.socket)return;
    setOnline(false);
    if([4401,4403,4404,4409].includes(e.code)){
      if(e.code===4404)alert('Không tìm thấy phòng này. Phòng có thể đã đóng khi máy chủ nghỉ.');
      else if(e.code===4409)alert('Phòng đã đầy hoặc trận đang diễn ra.');
      else alert('Không thể vào phòng. Hãy tải lại trang và thử lại.');
      showHome();return;
    }
    const delay=Math.min(7000,700*Math.pow(1.5,Math.min(5,state.retries++)));
    toast('Mất kết nối, đang kết nối lại...');
    setTimeout(()=>{if(!state.manualExit&&state.room)connect()},delay);
  };
  ws.onerror=()=>{setOnline(false)};
}
function send(message){if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify(message))}
function setOnline(on){
  const el=$('serverStatus');el.classList.toggle('off',!on);
  el.querySelector('span').textContent=on?'Đang trực tuyến':'Đang kết nối';
}
function applyEvents(events){
  const mine=state.id;
  for(const ev of events){
    if(ev.type==='bomb')sfx('bomb');
    else if(ev.type==='splash')sfx('splash');
    else if(ev.type==='trap'&&ev.who===mine){sfx('trap');toast('Bạn đang bị nhốt! Cầu cứu nào! 🫧')}
    else if(ev.type==='rescue'){sfx('rescue');if(ev.who===mine)toast('Đồng đội đã cứu bạn! ♥')}
    else if(ev.type==='pickup'&&ev.who===mine){sfx('pickup');toast('Nhặt được kẹo tăng sức mạnh! ⭐')}
    else if(ev.type==='finish')sfx('win');
  }
}
function renderWorld(){
  const w=state.world;if(!w)return;
  $('playerCounter').textContent=w.players.length+'/8';
  $('timer').textContent=String(Math.floor(w.time/60)).padStart(2,'0')+':'+String(w.time%60).padStart(2,'0');
  const roster=$('roster');roster.replaceChildren();
  for(const p of w.players){
    const el=document.createElement('div');el.className='roster-player'+(p.id===state.id?' me':'')+(!p.alive?' out':'');
    const avatar=document.createElement('span');avatar.className='roster-avatar';avatar.style.background=COLORS[p.color]?.edge||'#77bade';avatar.textContent='●';
    const info=document.createElement('div');info.className='roster-info';
    const name=document.createElement('strong');name.textContent=p.name+(p.id===w.host?' 👑':'');
    const details=document.createElement('small');details.textContent=!p.alive?'Đã bị loại':p.trapped?'Trong bong bóng!':w.mode==='teams'?'Đội '+(p.team+1):'Chiến binh';
    info.append(name,details);
    const points=document.createElement('span');points.className='roster-score';points.textContent='★ '+p.score;
    el.append(avatar,info,points);roster.append(el);
  }
  const overlay=$('boardOverlay');overlay.hidden=w.state==='playing';
  $('mobileControls').hidden=w.state!=='playing';
  const host=w.host===state.id;
  if(w.state==='waiting'){
    $('overlayTitle').textContent='Hội bạn bong bóng!';
    $('overlayDesc').textContent='Mời bạn bè bằng mã phòng '+w.room+' hoặc đường dẫn chia sẻ nhé.';
    $('startGame').textContent='▶ BẮT ĐẦU CHƠI';
    $('startGame').hidden=!host;$('startGame').disabled=false;
    $('modeButtons').hidden=!host;
    $('waitingNote').textContent=host?'Có thể chơi thử một mình, hoặc chờ bạn bè vào cùng.':'Đang chờ chủ phòng bắt đầu...';
  }else if(w.state==='finished'){
    $('overlayTitle').textContent=w.winner==='draw'?'Hòa rồi! 🎈':winnerLabel(w);
    $('overlayDesc').textContent='Chơi thêm ván nữa nào? Các ngôi sao đã được cộng điểm!';
    $('startGame').textContent='↻ CHƠI LẠI';$('startGame').hidden=!host;
    $('modeButtons').hidden=!host;
    $('waitingNote').textContent=host?'Chọn kiểu đấu rồi bắt đầu ván mới.':'Đợi chủ phòng mở ván tiếp theo nhé!';
  }
  const chips=$('overlayPlayers');chips.replaceChildren();
  for(const p of w.players){
    const el=document.createElement('div');el.className='player-chip';
    const dot=document.createElement('span');dot.className='mini-dot';dot.style.background=COLORS[p.color]?.edge||'#7adbe2';
    el.append(dot,document.createTextNode(p.name));chips.append(el);
  }
  document.querySelectorAll('.mode-option').forEach(button=>button.classList.toggle('active',button.dataset.mode===w.mode));
}
function winnerLabel(w){
  if(w.mode==='teams')return 'Đội '+(Number(w.winner)+1)+' chiến thắng! 🏆';
  const p=w.players.find(p=>p.id===w.winner);return (p?.name||'Người chiến thắng')+' thắng rồi! 🏆';
}
function appendChat(sender,message){
  const list=$('chatMessages'),el=document.createElement('div');el.className='chat-entry';
  const name=document.createElement('strong');name.textContent=sender;
  const text=document.createElement('span');text.textContent=message;
  el.append(name,text);list.append(el);
  while(list.children.length>45)list.firstChild.remove();
  list.scrollTop=list.scrollHeight;
}
async function loadRooms(){
  if($('homeScreen').hidden)return;
  try{const rooms=await api('/rooms');const list=$('roomList');list.replaceChildren();
    const waiting=rooms.filter(r=>r.state==='waiting'&&r.players<8);
    if(!waiting.length){const empty=document.createElement('div');empty.className='empty-rooms';empty.textContent='Chưa có phòng mở. Bạn tạo phòng đầu tiên nhé! ✨';list.append(empty)}
    for(const room of waiting.slice(0,8)){
      const btn=document.createElement('button');
      const label=document.createElement('strong');label.textContent='🎮 '+room.id;
      const count=document.createElement('span');count.textContent=room.players+'/8 người · '+(room.mode==='teams'?'Đồng đội':'Tự do');
      btn.append(label,count);btn.onclick=()=>joinRoom(room.id);list.append(btn);
    }
  }catch{setOnline(false)}
}

function readDirection(){
  if(state.mobileDir){const d=state.mobileDir;return d==='left'?[-1,0]:d==='right'?[1,0]:d==='up'?[0,-1]:[0,1]}
  const keys=state.keys;
  if(keys.has('ArrowLeft')||keys.has('a'))return[-1,0];
  if(keys.has('ArrowRight')||keys.has('d'))return[1,0];
  if(keys.has('ArrowUp')||keys.has('w'))return[0,-1];
  if(keys.has('ArrowDown')||keys.has('s'))return[0,1];
  return[0,0];
}
setInterval(()=>{
  if(!state.room || state.world?.state!=='playing')return;
  const [dx,dy]=readDirection(),str=dx+','+dy;
  if(state.sentDir!==str){state.sentDir=str;send({type:'input',dx,dy})}
  else if(dx||dy)send({type:'input',dx,dy});
},43);
function placeBomb(){if(state.world?.state==='playing'){initAudio();send({type:'bomb'})}}
window.addEventListener('keydown',e=>{
  if($('gameScreen').hidden || document.activeElement instanceof HTMLInputElement)return;
  let k=e.key.length===1?e.key.toLowerCase():e.key;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d',' '].includes(k))e.preventDefault();
  if(k===' '&&!e.repeat)placeBomb();else state.keys.add(k);
});
window.addEventListener('keyup',e=>state.keys.delete(e.key.length===1?e.key.toLowerCase():e.key));
window.addEventListener('blur',()=>{state.keys.clear();state.mobileDir='';state.sentDir=''})
for(const button of document.querySelectorAll('[data-dir]')){
  const dir=button.dataset.dir;
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);state.mobileDir=dir});
  const release=e=>{e.preventDefault();if(state.mobileDir===dir)state.mobileDir=''};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);
}
$('mobileBomb').addEventListener('pointerdown',e=>{e.preventDefault();placeBomb()});
$('quickPlay').addEventListener('click',quickPlay);
$('createRoom').addEventListener('click',()=>createRoom(false,true));
$('practice').addEventListener('click',()=>createRoom(true,true));
$('joinForm').addEventListener('submit',e=>{e.preventDefault();joinRoom($('roomCode').value)});
$('refreshRooms').addEventListener('click',()=>{sfx('tap');loadRooms()});
$('startGame').addEventListener('click',()=>{initAudio();sfx('tap');send({type:'start'})});
$('leaveRoom').addEventListener('click',showHome);
$('logo').addEventListener('click',showHome);
$('zoomMap').addEventListener('click',()=>{state.zoomMobile=!state.zoomMobile;localStorage.setItem('bb_zoom',state.zoomMobile?'on':'off');$('zoomMap').textContent=state.zoomMobile?'◱':'⊞';sfx('tap')});
$('shareRoom').addEventListener('click',async()=>{
  const link=location.origin+location.pathname+'?room='+state.room;
  try{await navigator.clipboard.writeText(link);toast('Đã sao chép lời mời! 🔗')}
  catch{window.prompt('Gửi link này cho bạn bè nhé:',link)}
  sfx('tap');
});
$('chatForm').addEventListener('submit',e=>{
  e.preventDefault();const input=$('chatInput');const value=input.value.trim();if(!value)return;
  send({type:'chat',value});input.value='';
});
for(const button of document.querySelectorAll('.mode-option'))button.addEventListener('click',()=>{
  send({type:'mode',value:button.dataset.mode});sfx('tap');
});
$('nickname').addEventListener('change',()=>{
  state.name=safeName();localStorage.setItem('bb_name',state.name);
  if(state.room)send({type:'name',value:state.name});
});
$('soundToggle').addEventListener('click',()=>{
  initAudio();state.audioEnabled=!state.audioEnabled;localStorage.setItem('bb_sound',state.audioEnabled?'on':'off');updateAudioButtons();sfx('tap');
});
$('musicToggle').addEventListener('click',()=>{
  initAudio();state.musicEnabled=!state.musicEnabled;localStorage.setItem('bb_music',state.musicEnabled?'on':'off');updateAudioButtons();sfx('tap');
});

async function init(){
  updateAudioButtons();
  try{
    const guest=await api('/session');setOnline(true);
    state.name=localStorage.getItem('bb_name')||guest.suggestedName;
    $('nickname').value=state.name;
    const query=new URLSearchParams(location.search),room=query.get('room');
    if(room && /^[A-Z2-9]{6}$/i.test(room))goGame(room);
    else await loadRooms();
    state.roomListTimer=window.setInterval(loadRooms,10000);
  }catch{
    setOnline(false);$('nickname').value=localStorage.getItem('bb_name')||'Khách nhỏ';
  }
}
init();
