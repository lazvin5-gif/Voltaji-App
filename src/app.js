import { BleClient, numbersToDataView, dataViewToNumbers } from '@capacitor-community/bluetooth-le';
/* Voltaji PWA — Web Bluetooth control for NBPower chargers.
   Protocol ported from the NBPower app (v2.0.15/16). No login, no server. */

// ---------- i18n ----------
// Each entry: [Georgian, English, Russian]
const STR = {
  tagline:        ['დააკავშირე დამტენი', 'Connect your charger', 'Подключите зарядку'],
  connect:        ['დაკავშირება', 'Connect', 'Подключить'],
  connecting:     ['ვუკავშირდები...', 'Connecting...', 'Подключение...'],
  note:           ['ჩართე Bluetooth. ინტერნეტი არ სჭირდება.',
                   'Turn on Bluetooth. No internet needed.',
                   'Включите Bluetooth. Интернет не нужен.'],
  status:         ['სტატუსი', 'Status', 'Статус'],
  charging:       ['იტენება', 'Charging', 'Идёт зарядка'],
  halfCharging:   ['ნახევარი სიმძლავრით', 'Half power', 'Половинная мощность'],
  plugNotInserted:['კაბელი არ არის ჩართული', 'Plug not inserted', 'Кабель не подключён'],
  carNotStarted:  ['ავტომობილი არ არის მზად', 'Car not ready', 'Авто не готово'],
  timing:         ['ტაიმერის მოლოდინში', 'Waiting (timer)', 'Ожидание (таймер)'],
  waitCooling:    ['გაგრილების მოლოდინი', 'Cooling down', 'Охлаждение'],
  updating:       ['პროგრამის განახლება', 'Updating firmware', 'Обновление прошивки'],
  unknownState:   ['უცნობი', 'Unknown', 'Неизвестно'],
  currentLimit:   ['დენის ზღვარი', 'Current limit', 'Предел тока'],
  temperature:    ['ტემპერატურა', 'Temperature', 'Температура'],
  error:          ['შეცდომა', 'Error', 'Ошибка'],
  current:        ['დენის ძალა', 'Current', 'Ток'],
  timer:          ['ტაიმერი', 'Timer', 'Таймер'],
  hours:          ['სთ', 'h', 'ч'],
  noLimit:        ['ლიმიტის გარეშე', 'No limit', 'Без лимита'],
  start:          ['დაწყება', 'Start', 'Старт'],
  stop:           ['გაჩერება', 'Stop', 'Стоп'],
  earth:          ['დამიწება/ნულის დაცვა', 'Earth/neutral protection', 'Защита заземления/нуля'],
  earthHint:      ['დამიწების გარეშე მუშაობა', 'Works without earthing', 'Работа без заземления'],
  on:             ['ჩართ.', 'ON', 'ВКЛ'],
  off:            ['გამორთ.', 'OFF', 'ВЫКЛ'],
  confirmStop:    ['გავაჩერო დატენვა?', 'Stop charging?', 'Остановить зарядку?'],
  started:        ['დატენვა დაიწყო', 'Charging started', 'Зарядка начата'],
  stopped:        ['დატენვა შეჩერდა', 'Charging stopped', 'Зарядка остановлена'],
  saved:          ['შენახულია', 'Saved', 'Сохранено'],
  saveFailed:     ['ვერ შეინახა', 'Save failed', 'Не сохранено'],
  needActivation: ['დამტენი არ არის გააქტიურებული. გააქტიურეთ NBPower აპით (ინტერნეტით).',
                   'Charger not activated. Activate it once with the NBPower app (online).',
                   'Зарядка не активирована. Активируйте её в приложении NBPower (с интернетом).'],
  // short error messages
  noBluetooth:    ['Bluetooth მიუწვდომელია', 'Bluetooth not available', 'Bluetooth недоступен'],
  disconnected:   ['კავშირი გაწყდა', 'Disconnected', 'Соединение разорвано'],
  noDeviceFound:  ['დამტენი ვერ მოიძებნა', 'No charger found', 'Зарядка не найдена'],
  needHttps:      ['ჩართე Bluetooth', 'Enable Bluetooth', 'Включите Bluetooth'],
  connectFailed:  ['დაკავშირება ვერ მოხერხდა', 'Connection failed', 'Ошибка подключения'],
  btPermission:   ['ჩართე Bluetooth', 'Enable Bluetooth', 'Включите Bluetooth'],
  charger:        ['დამტენი', 'Charger', 'Зарядка'],
  renamePrompt:   ['დაარქვი სახელი დამტენს:', 'Name this charger:', 'Назовите зарядку:'],
};
const LANGS=['ka','en','ru'];
let lang = 0; // index into LANGS
function t(k){ const a=STR[k]; return a ? (a[lang]!==undefined?a[lang]:a[0]) : k; }

function initLang(){
  try { const i=LANGS.indexOf(localStorage.getItem('lang')); if(i>=0) lang=i; } catch(e){}
  document.documentElement.lang = LANGS[lang];
}
function setLang(l){
  lang = l;
  try { localStorage.setItem('lang', LANGS[l]); } catch(e){}
  document.documentElement.lang = LANGS[lang];
  render();
}

// ---------- protocol ----------
// Full 128-bit UUIDs (Bluefy on iOS rejects the 0xFFE0 shorthand).
const SVC_FFE0='0000ffe0-0000-1000-8000-00805f9b34fb';
const SVC_FFD0='0000ffd0-0000-1000-8000-00805f9b34fb';
const SVC_FFC0='0000ffc0-0000-1000-8000-00805f9b34fb';
const CH_FFE1='0000ffe1-0000-1000-8000-00805f9b34fb';
const CH_FFD1='0000ffd1-0000-1000-8000-00805f9b34fb';
const CMD = { version:1, password:41, status:49, readSettings:47, writeSettings:48, startChallenge:66, start:67 };

function ampToPwm(a){ return Math.round(250*a/60); }
function pwmToAmp(p){
  let e = p/250*10*6; const f = e%1;
  let add = (f>=0.3 && f<=0.7)?0.5 : (f>0.7?1:0);
  return Math.floor(e)+add;
}
function passwordBytes(pwd){
  let s=(pwd||'').slice(0,6); while(s.length<6) s+='0';
  return Array.from(s).map(c=>c.charCodeAt(0));
}
function buildStart(ch, durMin, delayMin, amps, isDc, dcAmps){
  const l = new Array(isDc?13:11).fill(0);
  l[6]=(durMin>>8)&255; l[7]=durMin&255;
  l[8]=(delayMin>>8)&255; l[9]=delayMin&255;
  l[10]=Math.max(13, ampToPwm(amps));
  const f=i=> i<ch.length?ch[i]:0;
  const t6=l[6], e7=l[7];
  l[0]=((f(0)<<8|f(1)) % (255 & ((t6+1)|e7)))&255;
  l[1]=((f(1)<<8|f(2)) % (255 & ((t6+2)|e7)))&255;
  l[2]=((f(2)<<8|f(3)) % (255 & ((t6+3)|e7)))&255;
  l[3]=1; l[4]=1; l[5]=0;
  if(isDc){ const m=Math.round(10*dcAmps); l[11]=(m>>8)&255; l[12]=m&255; }
  return l;
}
function buildStop(){ return [1,1,1,1,1,0,0,0,0,0,0]; }
// Earth/neutral (grounding) protection = settings byte 0, bit 5 (aclCheck).
function setEarth(block, on){
  const out=block.slice(); if(out.length<1) out.push(0);
  out[0]=(on ? (out[0]|0x20) : (out[0] & ~0x20)) & 0xFF; return out;
}
function earthOn(block){ return block.length>0 && (block[0]&0x20)!==0; }
function maxAmps(block){ return block.length>10 ? Math.min(block[10]||32,50) : 32; }

function parseInfo(p){
  const at=i=> i<p.length?p[i]:0;
  const v=at(0), num=at(1);
  return {
    fw: v===255?0:v, model: num===255?0:num, meters: at(2), runMode: at(3),
    activated: (at(4)&2)!==0, netDisabled:(at(5)&1)!==0,
    isDc: num===30,
    needsActivation: (v>33) && (at(4)&2)===0,
  };
}
function parseStatus(p, fw){
  const at=i=> i<p.length?p[i]:255;
  const stateMap=['plugNotInserted','carNotStarted','timing','charging','halfCharging','waitCooling'];
  let st = at(0)===255 ? 'updating' : (stateMap[at(0)]||'unknownState');
  // Temperatures live in bytes 1,2,4,15 (each value - 40 °C, 255 = no sensor).
  const temps=[at(1),at(2),at(4),at(15)].filter(v=>v!==255).map(v=>v-40);
  return {
    stateKey: st, charging: st==='charging'||st==='halfCharging',
    tempC: temps.length ? temps[0] : null,
    currentLimit: pwmToAmp(at(3)),
    errorCode: at(5)===255?0:at(5),
  };
}

// ---------- BLE connection (Capacitor native plugin) ----------
class Charger {
  constructor(){ this.reqId=0; this.pending=new Map(); this.lastWrite=0; this.noNotify=false; this.canWriteNoResp=false; this.onDisconnect=null; this.onNotify=null; this.device=null; this.deviceId=null; }

  async connect(){
    await BleClient.initialize({ androidNeverForLocation:true });
    const dev = await BleClient.requestDevice({
      namePrefix: 'NBPower',
      optionalServices: [SVC_FFE0, SVC_FFD0, SVC_FFC0],
    });
    this.deviceId = dev.deviceId;
    this.device = { name: dev.name || '' };
    await BleClient.connect(this.deviceId, ()=>{ if(this.onDisconnect) this.onDisconnect(); });

    const services = await BleClient.getServices(this.deviceId);
    let svc=null;
    for(const s of services){
      const u=(s.uuid||'').toLowerCase();
      if(u===SVC_FFE0){ svc=s; this.noNotify=false; break; }
      if(u===SVC_FFD0){ svc=s; this.noNotify=true; }
    }
    if(!svc){ await this.disconnect(); throw new Error('charger service not found'); }
    this.service = svc.uuid.toLowerCase();

    let ch=null;
    for(const c of (svc.characteristics||[])){
      const u=(c.uuid||'').toLowerCase();
      if(u===CH_FFE1 || u===CH_FFD1){ ch=c; break; }
    }
    if(!ch){ await this.disconnect(); throw new Error('charger characteristic not found'); }
    this.char = ch.uuid.toLowerCase();
    this.canWriteNoResp = !!(ch.properties && ch.properties.writeWithoutResponse);

    if(!this.noNotify){
      await BleClient.startNotifications(this.deviceId, this.service, this.char, (v)=> this._onData(v));
    }
  }

  async disconnect(){
    for(const c of this.pending.values()){ try{ c.reject(new Error('disconnected')); }catch(e){} }
    this.pending.clear();
    try{ if(this.deviceId) await BleClient.disconnect(this.deviceId); }catch(e){}
  }

  _onData(dv){
    const b=dataViewToNumbers(dv);
    if(!b || b.length<2) return;
    if(this.onNotify) this.onNotify(b);
    const key=(b[0]<<8)|b[1];
    const c=this.pending.get(key);
    if(c){ this.pending.delete(key); c.resolve(b.slice(2)); }
  }
  _next(){ this.reqId=(this.reqId+1)&0xff; return this.reqId; }
  async _pace(){ const w=20-(Date.now()-this.lastWrite); if(w>0) await new Promise(r=>setTimeout(r,w)); this.lastWrite=Date.now(); }

  async send(cmd, payload=[]){
    const attempt=async()=>{
      const reqId=this._next();
      const frame=[cmd,reqId,...payload];
      const key=(cmd<<8)|reqId;
      const p=new Promise((resolve,reject)=>{ this.pending.set(key,{resolve,reject}); });
      await this._pace();
      const dv=numbersToDataView(frame);
      if(this.noNotify || this.canWriteNoResp) await BleClient.writeWithoutResponse(this.deviceId,this.service,this.char,dv);
      else await BleClient.write(this.deviceId,this.service,this.char,dv);
      if(this.noNotify){
        await new Promise(r=>setTimeout(r,40));
        const v=await BleClient.read(this.deviceId,this.service,this.char); this._onData(v);
      }
      return Promise.race([ p, new Promise((_,rej)=>setTimeout(()=>{ this.pending.delete(key); rej(new Error('timeout')); },5000)) ]);
    };
    try{ return await attempt(); }catch(e){ return await attempt(); }
  }

  async checkPassword(pwd){
    const r=await this.send(CMD.password, passwordBytes(pwd));
    const b=r.length?r[0]:1;
    if(b===1||b===255) return;
    if(b===2) throw new Error('locked');
    if(b===3) throw new Error('network disabled');
    throw new Error('wrong password');
  }
  async getInfo(){ return parseInfo(await this.send(CMD.version)); }
  async getStatus(fw){ return parseStatus(await this.send(CMD.status,[1]), fw); }
  async readSettings(){ return await this.send(CMD.readSettings); }
  async writeSettings(block){ const r=await this.send(CMD.writeSettings, block); return r.length>0 && r[0]===1; }
  async startCharge(durMin, amps, isDc){
    const ch=await this.send(CMD.startChallenge);
    const payload=buildStart(ch, durMin, 0, amps, isDc, amps);
    const r=await this.send(CMD.start, payload);
    const r0=r.length?r[0]:0;
    if(r0<2 && durMin!==0) throw new Error('refused (code '+r0+')');
  }
  async stopCharge(){ await this.send(CMD.start, buildStop()); }
}

// ---------- per-charger nickname (stored on this phone) ----------
function chargerShortId(id){ const m=(id||'').match(/([0-9A-Fa-f]{4,6})$/); return m?m[1].toUpperCase():''; }
function getNick(id){ try{ return (JSON.parse(localStorage.getItem('nicks')||'{}'))[id]||''; }catch(e){ return ''; } }
function setNick(id,name){ try{ const o=JSON.parse(localStorage.getItem('nicks')||'{}'); if(name) o[id]=name; else delete o[id]; localStorage.setItem('nicks',JSON.stringify(o)); }catch(e){} }

// ---------- error helpers ----------
function rawErr(e){
  try{
    if(e==null) return 'null';
    const n=e.name?e.name+': ':'';
    const m=(e.message!==undefined && e.message!==null && e.message!=='') ? String(e.message) : '';
    if(n||m) return (n+m).trim();
    if(typeof e==='object') return JSON.stringify(e);
    return String(e);
  }catch(_){ return String(e); }
}
function friendlyError(e){
  if(!navigator.bluetooth) return t('noBluetooth');
  const name=(e&&e.name)||''; const raw=rawErr(e);
  if(name==='NotFoundError' || /cancel|no devices|not found/i.test(raw)) return t('noDeviceFound');
  if(name==='SecurityError' || /secure|https|permission|denied|unauthoriz/i.test(raw)) return t('needHttps')+' '+t('btPermission');
  if(/powered off|turned off|bluetooth.*off|state/i.test(raw)) return t('btPermission');
  return t('connectFailed');
}

// ---------- UI state ----------
const charger = new Charger();
let S = { screen:'connect', busy:false, info:null, status:null, settings:null,
          amps:16, maxAmps:32, timerHours:0, earth:true, error:null, errorRaw:null,
          chargerId:'', nickname:'' };
let pollTimer=null;
const PASSWORD='000000';

function toast(msg){ const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2200); }

async function doConnect(){
  S.error=null; S.errorRaw=null; S.busy=true; render();
  try{
    await charger.connect();
    S.chargerId = (charger.device && charger.device.name) || '';
    S.nickname = getNick(S.chargerId);
    charger.onDisconnect = ()=>{ stopPolling(); S.screen='connect'; S.status=null; toast(t('disconnected')); render(); };
    await charger.checkPassword(PASSWORD);
    S.info = await charger.getInfo();
    if(S.info.needsActivation) S.error=t('needActivation');
    S.settings = await charger.readSettings();
    S.maxAmps = maxAmps(S.settings);
    S.earth = earthOn(S.settings);
    S.amps = Math.min(Math.max(S.amps,6), S.maxAmps);
    S.screen='control';
    startPolling();
  }catch(e){ S.error = friendlyError(e); S.errorRaw = rawErr(e); }
  S.busy=false; render();
}
function startPolling(){ stopPolling(); pollTimer=setInterval(refresh,3000); refresh(); }
function stopPolling(){ if(pollTimer) clearInterval(pollTimer); pollTimer=null; }
async function refresh(){ try{ S.status=await charger.getStatus(S.info?S.info.fw:0); render(); }catch(e){} }

async function run(fn, okMsg){
  S.busy=true; S.error=null; render();
  try{ await charger.checkPassword(PASSWORD); await fn(); if(okMsg) toast(okMsg); await refresh(); }
  catch(e){ S.error=friendlyError(e); S.errorRaw=rawErr(e); }
  S.busy=false; render();
}
function onStart(){ const dur=S.timerHours<=0?65535:Math.round(S.timerHours*60);
  run(()=>charger.startCharge(dur,S.amps,S.info&&S.info.isDc), t('started')); }
function onStop(){ if(!confirm(t('confirmStop'))) return; run(()=>charger.stopCharge(), t('stopped')); }
function onEarth(v){
  run(async()=>{ const ok=await charger.writeSettings(setEarth(S.settings,v));
    if(!ok) throw new Error(t('saveFailed'));
    S.settings=await charger.readSettings(); S.earth=earthOn(S.settings); }, t('saved'));
}
function disconnect(){ stopPolling(); charger.disconnect(); S.screen='connect'; S.status=null; render(); }

// ---------- render ----------
function el(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }
function langPill(){
  return `<div class="langpill" id="langpill">
    <span class="${lang===0?'on':''}" data-l="0">KA</span>
    <span class="${lang===1?'on':''}" data-l="1">EN</span>
    <span class="${lang===2?'on':''}" data-l="2">RU</span></div>`;
}
function render(){
  const root=document.getElementById('app');
  root.innerHTML = S.screen==='connect' ? connectView() : controlView();
  root.querySelector('#langpill').onclick = e=>{ const s=e.target.closest('[data-l]'); if(s) setLang(+s.dataset.l); };
  if(S.screen==='connect'){
    const b=root.querySelector('#connectBtn'); if(b) b.onclick=doConnect;
  } else bindControl(root);
}
function connectView(){
  return `
  <div class="appbar"><img src="images/voltaji_wordmark.png" alt="Voltaji">${langPill()}</div>
  <div class="body">
    <div class="hero"><img src="images/voltaji_logo.png" alt="Voltaji"></div>
    <div class="tag">${t('tagline')}</div>
    ${S.busy ? '<div class="spin"></div>' :
      `<button class="btn" id="connectBtn">🔗 ${t('connect')}</button>`}
    ${S.error?`<div class="err" style="text-align:center">${S.error}</div>`:''}
    ${S.errorRaw?`<div class="hint" style="text-align:center;margin-top:6px">${String(S.errorRaw).slice(0,48)}</div>`:''}
    <div class="note">${t('note')}</div>
  </div>`;
}
function stateText(k){ return t(k); }
function controlView(){
  const st=S.status; const charging=st?st.charging:false;
  return `
  <div class="appbar">
    <button class="back" id="back">‹</button>
    <img src="images/voltaji_wordmark.png" alt="Voltaji">${langPill()}</div>
  <div class="body">
    <div class="chargerline">
      <span class="cname">${S.nickname ? S.nickname : t('charger')}</span>
      <span class="cid">· ${chargerShortId(S.chargerId)}</span>
      <button class="renamebtn" id="rename" title="rename">✏️</button>
    </div>
    ${S.error?`<div class="card" style="border-color:#f3c0c2"><div class="err" style="margin:0">${S.error}</div></div>`:''}
    <div class="card">
      <div class="statechip"><div class="sicon ${charging?'live':''}">${charging?'⚡':'⏻'}</div><div class="label">${t('status')}</div></div>
      <div class="state ${charging?'live':''}">${st?stateText(st.stateKey):'—'}</div>
      ${st?`<div class="metrics">
        <div class="metric"><span class="mi">⚡</span><div><div class="ml">${t('currentLimit')}</div><div class="mv">${st.currentLimit.toFixed(0)} A</div></div></div>
        <div class="metric"><span class="mi">🌡</span><div><div class="ml">${t('temperature')}</div><div class="mv">${st.tempC==null?'—':st.tempC+'°'}</div></div></div>
      </div>${st.errorCode?`<div class="err">${t('error')}: ${st.errorCode}</div>`:''}`:''}
    </div>
    <div class="card">
      <div class="row"><div class="label">${t('current')}</div><div class="big" style="font-size:24px">${Math.round(S.amps)} A</div></div>
      <input type="range" id="amp" min="6" max="${S.maxAmps}" step="1" value="${Math.round(S.amps)}" ${S.busy?'disabled':''}>
      <div class="hint">6 – ${S.maxAmps} A</div>
    </div>
    <div class="card">
      <div class="row"><div class="label">${t('timer')}</div><div class="big" style="font-size:18px">${S.timerHours<=0?t('noLimit'):S.timerHours.toFixed(1)+' '+t('hours')}</div></div>
      <input type="range" id="tmr" min="0" max="12" step="0.5" value="${S.timerHours}" ${S.busy?'disabled':''}>
    </div>
    <div class="card">
      <div class="row">
        <div><div style="font-weight:700">${t('earth')}</div><div class="hint" style="margin-top:4px">${t('earthHint')} · ${S.earth?t('on'):t('off')}</div></div>
        <label class="switch"><input type="checkbox" id="earth" ${S.earth?'checked':''} ${S.busy?'disabled':''}><span class="slider"></span></label>
      </div>
    </div>
    ${S.busy?'<div class="spin"></div>':''}
  </div>
  <div class="foot">
    <button class="btn ${charging?'stop':''}" id="action" ${S.busy?'disabled':''}>${charging?'⏹ '+t('stop'):'⚡ '+t('start')}</button>
  </div>`;
}
function bindControl(root){
  root.querySelector('#back').onclick=disconnect;
  const rn=root.querySelector('#rename');
  if(rn) rn.onclick=()=>{ const v=prompt(t('renamePrompt'), S.nickname||''); if(v!==null){ setNick(S.chargerId, v.trim()); S.nickname=getNick(S.chargerId); render(); } };
  const amp=root.querySelector('#amp'); if(amp){ amp.oninput=e=>{ S.amps=+e.target.value;
    root.querySelector('.card .big').textContent=Math.round(S.amps)+' A'; }; }
  const tmr=root.querySelector('#tmr'); if(tmr){ tmr.oninput=e=>{ S.timerHours=+e.target.value; render(); }; }
  const earth=root.querySelector('#earth'); if(earth) earth.onchange=e=>onEarth(e.target.checked);
  const act=root.querySelector('#action'); if(act) act.onclick=()=> (S.status&&S.status.charging)?onStop():onStart();
}

// ---------- boot ----------
initLang();
render();
