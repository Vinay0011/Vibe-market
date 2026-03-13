const SUPABASE_URL = 'https://xjxmicyrizovrwmjztwk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeG1pY3lyaXpvdnJ3bWp6dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMjE0MDEsImV4cCI6MjA4ODY5NzQwMX0.LkI8GWjmaAOSVINE10fEsyBCItrghTYzj5SVRCYvoHU';
const TG_TOKEN = '8222924269:AAHE-PT37NB0OUtxo80PcEgOOsdqWgjYZoo';
const TG_CHAT  = '7784672658';
const TG_API   = 'https://api.telegram.org/bot' + TG_TOKEN;

const SB_H = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Prefer':        'return=representation',
};

let DB = { listings: [], promoted: [], pending: [] };
let DB_LOADED = false;

async function sbGet(key) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/vm_data?key=eq.' + key + '&select=value', { headers: SB_H });
    const d = await r.json();
    const val = d && d[0] && d[0].value;
    return Array.isArray(val) ? val : [];
  } catch(e) { return []; }
}

async function sbSet(key, value) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/vm_data?key=eq.' + key, {
      method: 'PATCH',
      headers: SB_H,
      body: JSON.stringify({ value }),
    });
  } catch(e) { console.error('sbSet failed', key, e); }
}

async function loadDB() {
  try {
    const [listings, promoted, pending] = await Promise.all([
      sbGet('listings'),
      sbGet('promoted'),
      sbGet('pending'),
    ]);
    DB = { listings, promoted, pending };
    DB_LOADED = true;
  } catch(e) {
    console.error('loadDB failed', e);
    DB_LOADED = true;
  }
}

async function saveDB() {
  await Promise.all([
    sbSet('listings', DB.listings),
    sbSet('promoted', DB.promoted),
    sbSet('pending',  DB.pending),
  ]);
}

async function tgSend(text) {
  try {
    await fetch(TG_API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
    });
  } catch(e) {}
}

let _polling = false;
function startPoll() {
  if (_polling) return;
  _polling = true;
  (async function poll() {
    try {
      const off = +(localStorage.getItem('vm_off') || 0);
      const r = await fetch(TG_API + '/getUpdates?offset=' + off + '&timeout=4');
      const d = await r.json();
      if (d.ok) {
        for (const u of d.result) {
          localStorage.setItem('vm_off', u.update_id + 1);
          const m = u.message;
          if (!m || String(m.chat.id) !== TG_CHAT) continue;
          handleCmd((m.text || '').trim());
        }
      }
    } catch(e) {}
    setTimeout(poll, 4000);
  })();
}

async function handleCmd(t) {
  if (!DB_LOADED) return;
  const lo = t.toLowerCase();
  if (lo.startsWith('approve ')) { await cmdApprove(t.slice(8).trim()); return; }
  if (lo.startsWith('reject '))  { await cmdReject(t.slice(7).trim());  return; }
  if (lo === 'list pending') {
    const p = DB.pending;
    if (!p.length) { tgSend('No pending requests.'); return; }
    let msg = '📋 <b>Pending (' + p.length + ')</b>\n\n';
    p.forEach(x => { msg += '🆔 <code>' + x.id + '</code>\n📦 ' + x.name + '\n🔗 ' + (x.url||'—') + '\n👤 ' + x.contact + '\n\n'; });
    msg += 'approve &lt;ID&gt;  |  reject &lt;ID&gt;';
    tgSend(msg);
  }
}

async function cmdApprove(id) {
  await loadDB();
  const i = DB.pending.findIndex(x => x.id === id || x.id.endsWith(id));
  if (i === -1) { tgSend('Not found: <code>' + id + '</code>'); return; }
  const item = DB.pending.splice(i, 1)[0];
  DB.promoted.unshift(item);
  await saveDB();
  renderFeatured();
  updateStats();
  tgSend('APPROVED!\n' + item.name + ' is now LIVE!\n' + (item.url||'—'));
}

async function cmdReject(id) {
  await loadDB();
  const i = DB.pending.findIndex(x => x.id === id || x.id.endsWith(id));
  if (i === -1) { tgSend('Not found: <code>' + id + '</code>'); return; }
  const item = DB.pending.splice(i, 1)[0];
  await saveDB();
  tgSend('REJECTED: ' + item.name);
}

function canSubmitToday() {
  const last = localStorage.getItem('vm_last_submit');
  if (!last) return true;
  return new Date(parseInt(last)).toDateString() !== new Date().toDateString();
}
function markSubmittedToday() {
  localStorage.setItem('vm_last_submit', Date.now().toString());
}
function timeUntilMidnight() {
  const now = new Date();
  const mid = new Date(now); mid.setHours(24,0,0,0);
  const diff = mid - now;
  return Math.floor(diff/3600000) + 'h ' + Math.floor((diff%3600000)/60000) + 'm';
}

function safeUrl(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : 'https://' + url;
}

const curEl = document.getElementById('cur');
const curR  = document.getElementById('cur-r');
let mx=0, my=0, rx=0, ry=0;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  curEl.style.left = mx + 'px';
  curEl.style.top  = my + 'px';
});
(function a() {
  rx += (mx-rx)*.12; ry += (my-ry)*.12;
  curR.style.left = rx + 'px';
  curR.style.top  = ry + 'px';
  requestAnimationFrame(a);
})();

const cv = document.getElementById('bgc'), ctx = cv.getContext('2d');
let W, H, pts = [];
const rsz = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
rsz();
window.addEventListener('resize', rsz);
class P {
  constructor() { this.re(); }
  re() {
    this.x  = Math.random()*W; this.y  = Math.random()*H;
    this.vx = (Math.random()-.5)*.25; this.vy = (Math.random()-.5)*.25;
    this.r  = Math.random()*1.3+.2;   this.a  = Math.random()*.42+.08;
    this.c  = Math.random()>.65 ? '#00ffe0' : Math.random()>.5 ? '#bf00ff' : '#fff';
  }
  up() {
    this.x += this.vx; this.y += this.vy;
    if (this.x<0||this.x>W||this.y<0||this.y>H) this.re();
  }
  dr() {
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.fillStyle = this.c; ctx.globalAlpha = this.a; ctx.fill(); ctx.globalAlpha = 1;
  }
}
for (let i=0; i<150; i++) pts.push(new P());
(function loop() {
  ctx.clearRect(0,0,W,H);
  pts.forEach(p => { p.up(); p.dr(); });
  for (let i=0; i<pts.length; i++) for (let j=i+1; j<pts.length; j++) {
    const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
    if (d<90) {
      ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
      ctx.strokeStyle='#00ffe0'; ctx.globalAlpha=(1-d/90)*.04; ctx.lineWidth=.4;
      ctx.stroke(); ctx.globalAlpha=1;
    }
  }
  requestAnimationFrame(loop);
})();

window.addEventListener('scroll', () => {
  document.getElementById('nav').classList.toggle('scrolled', scrollY > 50);
});

const ro = new IntersectionObserver(es => es.forEach((e,i) => {
  if (e.isIntersecting) setTimeout(() => e.target.classList.add('vis'), i*65);
}), { threshold: .07 });
document.querySelectorAll('.reveal').forEach(el => ro.observe(el));

function updateStats() {
  document.getElementById('st-total').textContent    = DB.listings.length;
  const cs = new Set(DB.listings.map(l => l.contact || 'anon'));
  document.getElementById('st-creators').textContent = cs.size;
  document.getElementById('st-feat').textContent     = DB.promoted.length;
}

function tbadge(t) {
  const map = {
    website:['tb-w','Website'], webapp:['tb-a','Web App'],
    saas:['tb-w','SaaS'],       tool:['tb-a','Tool'],
    other:['tb-b','Other']
  };
  const [cls, lbl] = map[t] || ['tb-b','Other'];
  return '<span class="tb ' + cls + '">' + lbl + '</span>';
}

function statusLabel(s) {
  return s==='beta' ? '🟡 Beta' : s==='wip' ? '🔧 WIP' : '🟢 Live';
}

function renderFeatured() {
  const track = document.getElementById('ft-track');
  const items = DB.promoted;
  if (!items.length) {
    track.innerHTML = '<div class="ft-empty">No featured projects yet — <a href="#promote">be the first for $5 →</a></div>';
    return;
  }
  track.innerHTML = '';
  items.forEach(item => {
    const c = document.createElement('div');
    c.className = 'fc';
    const u = safeUrl(item.url);
    c.innerHTML =
      '<div class="ft-badge">Featured · 7 Days</div>' +
      tbadge(item.ptype || 'other') +
      '<span class="c-icon">' + (item.icon||'🌐') + '</span>' +
      '<div class="c-name">' + item.name + '</div>' +
      '<div class="c-desc">' + (item.desc||'').substring(0,100) + ((item.desc||'').length>100?'…':'') + '</div>' +
      '<div class="c-tags">' + (item.tags||[]).slice(0,4).map(t=>'<span class="tag">'+t+'</span>').join('') + '</div>' +
      (u ? '<div class="c-url" style="cursor:pointer;" onclick="event.stopPropagation();window.open(\'' + u + '\',\'_blank\')">' + item.url + '</div>' : '');
    c.addEventListener('click', () => openDetail(item.id, 'promoted'));
    track.appendChild(c);
  });
}

function renderListings(filter, search) {
  filter = filter || 'all';
  search = (search || '').toLowerCase();
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const items = DB.listings.filter(d => {
    const fm = filter === 'all' || d.ptype === filter;
    const sm = !search ||
      d.name.toLowerCase().includes(search) ||
      (d.desc||'').toLowerCase().includes(search) ||
      (d.tagline||'').toLowerCase().includes(search);
    return fm && sm;
  });
  if (!items.length) {
    grid.innerHTML =
      '<div class="empty-st">' +
        '<div class="es-ico">🌐</div>' +
        '<div class="es-t">No projects yet</div>' +
        '<div class="es-s">Be the first — <a href="#list">submit yours for free →</a></div>' +
      '</div>';
    return;
  }
  items.forEach((item, i) => {
    const c = document.createElement('div');
    c.className = 'lc';
    c.style.animationDelay = (i*.06) + 's';
    const u = safeUrl(item.url);
    c.innerHTML =
      tbadge(item.ptype || 'other') +
      '<span class="c-icon">' + (item.icon||'🌐') + '</span>' +
      '<div class="c-name">' + item.name + '</div>' +
      (item.tagline ? '<div style="font-size:12px;color:var(--neon);font-weight:700;margin-bottom:6px;">' + item.tagline + '</div>' : '') +
      '<div class="c-desc">' + (item.desc||'').substring(0,100) + ((item.desc||'').length>100?'…':'') + '</div>' +
      '<div class="c-tags">' + (item.tags||[]).slice(0,4).map(t=>'<span class="tag">'+t+'</span>').join('') + '</div>' +
      '<div class="lc-meta">' +
        '<span class="lc-status">' + statusLabel(item.status||'live') + '</span>' +
        (item.built ? '<span class="lc-built">· ' + item.built + '</span>' : '') +
      '</div>' +
      (u ? '<div class="lc-url" style="cursor:pointer;" onclick="event.stopPropagation();window.open(\'' + u + '\',\'_blank\')">' + item.url + '</div>' : '') +
      '<button class="view-btn" onclick="event.stopPropagation();openDetail(\'' + item.id + '\',\'listing\');">View Details →</button>';
    c.addEventListener('click', () => openDetail(item.id, 'listing'));
    grid.appendChild(c);
    setTimeout(() => c.classList.add('vis'), i*50);
  });
  document.querySelectorAll('.lc').forEach(el => ro.observe(el));
}

document.querySelectorAll('.fb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    renderListings(btn.dataset.f, document.getElementById('srch').value);
  });
});
document.getElementById('srch').addEventListener('input', e => {
  renderListings(document.querySelector('.fb.on').dataset.f, e.target.value);
});

let _cc = '';

function openDetail(id, source) {
  const pool = source === 'promoted' ? DB.promoted : DB.listings;
  const item = pool.find(d => d.id === id);
  if (!item) return;

  document.getElementById('d-ico').textContent     = item.icon || '🌐';
  document.getElementById('d-name').textContent    = item.name;
  document.getElementById('d-tagline').textContent = item.tagline || item.desc || '';

  const tb = document.getElementById('d-tbadge');
  const tmap = {
    website:['tb-w','Website'], webapp:['tb-a','Web App'],
    saas:['tb-w','SaaS'],       tool:['tb-a','Tool'],
    other:['tb-b','Other']
  };
  const [cls, lbl] = tmap[item.ptype||'other'] || ['tb-b','Other'];
  tb.className = 'tb ' + cls;
  tb.textContent = lbl;

  document.getElementById('d-tags').innerHTML = (item.tags||[]).map(t => '<span class="tag">'+t+'</span>').join('');
  document.getElementById('d-desc').textContent = item.desc || '';

  const u = safeUrl(item.url);
  const infoItems = [];
  if (item.url)     infoItems.push(['Live URL', '<a href="'+u+'" target="_blank" rel="noopener">'+item.url+'</a>']);
  if (item.status)  infoItems.push(['Status', statusLabel(item.status)]);
  if (item.built)   infoItems.push(['Built With', item.built]);
  if (item.revenue) infoItems.push(['Monthly Revenue', item.revenue]);
  if (item.users)   infoItems.push(['Users / Signups', item.users]);

  const infoSec = document.getElementById('d-info-sec');
  if (infoItems.length) {
    infoSec.style.display = '';
    document.getElementById('d-info').innerHTML = infoItems.map(([k,v]) =>
      '<div class="info-item"><div class="info-k">'+k+'</div><div class="info-v">'+v+'</div></div>'
    ).join('');
  } else infoSec.style.display = 'none';

  const techSec = document.getElementById('d-tech-sec');
  if (item.tags && item.tags.length) {
    techSec.style.display = '';
    document.getElementById('d-tech').innerHTML = item.tags.map(t => '<span class="tech-tag">'+t+'</span>').join('');
  } else techSec.style.display = 'none';

  const featSec = document.getElementById('d-feat-sec');
  if (item.features && item.features.length) {
    featSec.style.display = '';
    document.getElementById('d-feats').innerHTML = item.features.map(f =>
      '<div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--muted);line-height:1.5;">' +
        '<span style="color:var(--neon);font-size:9px;flex-shrink:0;margin-top:2px;">◈</span>' + f +
      '</div>'
    ).join('');
  } else featSec.style.display = 'none';

  _cc = item.contact || 'Not provided';
  document.getElementById('d-contact').textContent = _cc;

  const vb = document.getElementById('d-visit-btn');
  if (u) {
    vb.href = u;
    vb.style.display = 'flex';
  } else {
    vb.style.display = 'none';
  }

  document.getElementById('ov').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cpContact() { cp(_cc, document.querySelector('.cb-cp')); }
function closeOv(e)  { if (e.target === document.getElementById('ov')) closeDm(); }
function closeDm()   { document.getElementById('ov').classList.remove('open'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDm(); });

function cp(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const o = btn.textContent;
    btn.textContent = 'COPIED!';
    btn.style.color = 'var(--neon)';
    btn.style.borderColor = 'var(--neon)';
    setTimeout(() => { btn.textContent = o; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
  });
}

let _tt;
function toast(icon, title, sub, type) {
  const el = document.getElementById('toast');
  el.querySelector('.t-i').textContent = icon;
  el.querySelector('.t-t').textContent = title;
  el.querySelector('.t-s').textContent = sub;
  el.className = type === 'err' ? 'toast-err show' : 'show';
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 5500);
}

function checkLimitNotice() {
  const notice = document.getElementById('limit-notice');
  const btn    = document.querySelector('.list-form .btn-p');
  if (!canSubmitToday()) {
    notice.style.display = 'flex';
    notice.textContent   = "You've already submitted a project today. Come back in " + timeUntilMidnight() + ".";
    btn.disabled         = true;
    btn.style.opacity    = '.4';
    btn.style.cursor     = 'not-allowed';
  } else {
    notice.style.display = 'none';
    btn.disabled         = false;
    btn.style.opacity    = '';
    btn.style.cursor     = '';
  }
}

async function submitListing() {
  if (!canSubmitToday()) {
    toast('⏳','Limit reached','You can only submit 1 project per day. Try again in ' + timeUntilMidnight() + '.','err');
    shake(document.querySelector('.list-form'));
    return;
  }
  const name = document.getElementById('ln').value.trim();
  const url  = document.getElementById('lurl').value.trim();
  const desc = document.getElementById('ldesc').value.trim();
  const ct   = document.getElementById('lct').value.trim();
  if (!name || !desc || !ct) {
    shake(document.querySelector('.list-form'));
    toast('⚠️','Missing fields','Name, description and contact are required.','err');
    return;
  }
  const btn = document.querySelector('.list-form .btn-p');
  btn.disabled = true;
  btn.textContent = 'PUBLISHING…';

  const feats = document.getElementById('lfeats').value.split('\n').map(s => s.trim()).filter(Boolean);
  const item = {
    id:        'l' + Date.now(),
    name, desc,
    url:       url || '',
    tagline:   document.getElementById('ltagline').value.trim(),
    ptype:     document.getElementById('ltype').value,
    status:    document.getElementById('lstatus').value,
    built:     document.getElementById('lbuilt').value,
    tags:      document.getElementById('ltags').value.split(',').map(s=>s.trim()).filter(Boolean),
    icon:      document.getElementById('lico').value.trim() || '🌐',
    features:  feats,
    revenue:   document.getElementById('lrev').value.trim(),
    users:     document.getElementById('lusers').value.trim(),
    contact:   ct,
    createdAt: Date.now(),
  };

  DB.listings.unshift(item);
  await saveDB();
  markSubmittedToday();

  ['ln','lurl','ltagline','ltags','lico','ldesc','lfeats','lrev','lusers','lct'].forEach(id => {
    document.getElementById(id).value = '';
  });
  btn.disabled = false;
  btn.textContent = 'PUBLISH FOR FREE →';
  renderListings();
  updateStats();
  checkLimitNotice();
  toast('✦','Project live!','"' + name + '" is now on VibeMarket.');
  setTimeout(() => document.getElementById('listings').scrollIntoView({ behavior:'smooth' }), 380);
}

async function submitPromo() {
  const name  = document.getElementById('pn').value.trim();
  const url   = document.getElementById('pu').value.trim();
  const type  = document.getElementById('ptype').value;
  const chain = document.getElementById('pchain').value;
  const desc  = document.getElementById('pdesc').value.trim();
  const tx    = document.getElementById('ptx').value.trim();
  const ct    = document.getElementById('pct').value.trim();
  if (!name || !tx || !ct) {
    shake(document.querySelector('.f-box'));
    toast('⚠️','Missing fields','Project name, Tx hash and contact are required.','err');
    return;
  }
  const btn = document.getElementById('promo-btn');
  btn.disabled = true;
  btn.textContent = '⏳ SENDING…';

  const pid = 'p' + Date.now();
  const item = {
    id: pid, name, url, desc,
    ptype:     type || 'other',
    icon:      '⚡',
    tags:      ['Featured'],
    contact:   ct,
    tx, chain,
    tagline:   desc,
    features:  [],
    status:    'live',
    built:     '',
    createdAt: Date.now(),
  };

  DB.pending.push(item);
  await saveDB();

  const msg =
    '🚀 <b>NEW PROMOTION REQUEST</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '📦 <b>Project:</b> ' + name + '\n' +
    '🔗 <b>URL:</b> ' + (url||'—') + '\n' +
    '📂 <b>Type:</b> ' + (type||'—') + '\n' +
    '⛓ <b>Chain:</b> ' + (chain||'—') + '\n' +
    '🔑 <b>Tx Hash:</b>\n<code>' + tx + '</code>\n' +
    '📞 <b>Contact:</b> ' + ct + '\n' +
    '📝 <b>Description:</b>\n' + (desc||'—') + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '🆔 <b>ID:</b> <code>' + pid + '</code>\n\n' +
    '✅ <b>approve ' + pid + '</b>\n' +
    '❌ <b>reject ' + pid + '</b>\n' +
    '📋 <b>list pending</b>';

  await tgSend(msg);
  btn.disabled = false;
  btn.textContent = '⚡ SUBMIT FOR APPROVAL';
  ['pn','pu','pdesc','ptx','pct'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ptype').value  = '';
  document.getElementById('pchain').value = '';
  toast('📬','Request submitted!',"We'll verify your Tx on-chain and go live within 30 minutes.");
  startPoll();
}

function shake(el) {
  el.style.animation = 'shk .38s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

async function init() {
  document.getElementById('grid').innerHTML =
    '<div class="loading-st"><div class="spinner"></div><div class="loading-txt">Loading projects…</div></div>';
  document.getElementById('ft-track').innerHTML =
    '<div class="ft-empty">Loading featured projects…</div>';
  await loadDB();
  renderFeatured();
  renderListings();
  updateStats();
  checkLimitNotice();
  startPoll();
}

init();
