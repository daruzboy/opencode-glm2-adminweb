// Halaman dashboard admin — SATU string HTML self-contained (tanpa build tool, tanpa CDN).
// Disajikan di GET /admin; data via fetch ke /api/admin/dashboard/* dgn x-admin-token
// (diminta sekali, disimpan localStorage).

export const DASHBOARD_PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>digimaestro · admin</title>
<style>
:root{--bg:#0f1115;--card:#181b22;--line:#2a2f3a;--tx:#e6e9ef;--dim:#9aa3b2;--acc:#4f8cff;--ok:#3fb37f;--warn:#e0a93e;--bad:#e05d5d}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--tx)}
header{display:flex;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg)}
h1{font-size:16px;margin:0}nav{display:flex;gap:4px;flex-wrap:wrap}
nav button{background:none;border:1px solid var(--line);color:var(--dim);padding:6px 12px;border-radius:8px;cursor:pointer}
nav button.on{color:var(--tx);border-color:var(--acc)}
main{padding:20px;max-width:1200px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;white-space:nowrap}
.b{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.b.ok{color:var(--ok)}.b.warn{color:var(--warn)}.b.bad{color:var(--bad)}
button.act{background:var(--acc);border:0;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px}
button.ghost{background:none;border:1px solid var(--line);color:var(--dim);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px}
input,select,textarea{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:6px;padding:6px 8px;font:inherit}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi .v{font-size:22px;font-weight:700}.kpi .l{color:var(--dim);font-size:12px}
.dim{color:var(--dim)}.err{color:var(--bad);padding:8px 0}
#login{max-width:380px;margin:80px auto;text-align:center}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
</style></head><body>
<header><h1>🛠️ digimaestro · admin</h1>
<nav id="tabs"></nav><span style="flex:1"></span>
<button class="ghost" onclick="localStorage.removeItem('admtok');location.reload()">Keluar</button></header>
<main id="main"></main>
<script>
const TABS=[['konsumen','Konsumen'],['tiket','Tiket'],['masukan','Keluhan & Saran'],['token','Token & Biaya'],['sistem','Sistem']];
let tab=location.hash.slice(1)||'konsumen';
const tok=()=>localStorage.getItem('admtok')||'';
const api=async(p,opt)=>{const r=await fetch('/api/admin/dashboard'+p,{...opt,headers:{'content-type':'application/json','x-admin-token':tok(),...(opt&&opt.headers)}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tgl=s=>s?new Date(s).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'—';
const M=document.getElementById('main');

function nav(){document.getElementById('tabs').innerHTML=TABS.map(([k,l])=>'<button class="'+(k===tab?'on':'')+'" onclick="go(\\''+k+'\\')">'+l+'</button>').join('')}
window.go=k=>{tab=k;location.hash=k;render()};

async function render(){
  nav();
  if(!tok()){M.innerHTML='<div id="login" class="card"><h2>Token admin</h2><p class="dim">ADMIN_DASHBOARD_TOKEN dari env server.</p><input id="t" type="password" style="width:100%"><br><br><button class="act" onclick="localStorage.setItem(\\'admtok\\',document.getElementById(\\'t\\').value);location.reload()">Masuk</button></div>';return}
  M.innerHTML='<p class="dim">Memuat…</p>';
  try{await({konsumen,tiket,masukan,token,sistem})[tab]()}catch(e){M.innerHTML='<p class="err">'+esc(e.message)+'</p>'+(String(e.message).includes('token')?'<button class="ghost" onclick="localStorage.removeItem(\\'admtok\\');location.reload()">Ganti token</button>':'')}
}

async function konsumen(){
  const {customers}=await api('/customers');
  const badge=s=>({TRIALING:'warn',ACTIVE:'ok',SUSPENDED:'bad',PAST_DUE:'bad'}[s]||'');
  M.innerHTML='<div class="card"><table><tr><th>Konsumen</th><th>Status</th><th>Trial s.d.</th><th>Pesan</th><th>Situs</th><th>Chat terakhir</th><th>Tiket/Masukan</th><th>Aksi</th></tr>'+
  customers.map(c=>'<tr><td><b>'+esc(c.name)+'</b><br><span class="dim">'+esc(c.slug)+'</span></td>'+
  '<td><span class="b '+badge(c.status)+'">'+esc(c.status)+'</span></td>'+
  '<td>'+tgl(c.trialEndsAt)+'</td><td>'+c.usedMessages+'/'+c.quotaMessages+'</td>'+
  '<td>'+(c.websiteSlug?esc(c.websiteSlug)+'<br><span class="dim">'+esc(c.websiteStatus)+'</span>':'—')+'</td>'+
  '<td>'+tgl(c.lastInboundAt)+'</td><td>'+(c.openTickets?c.openTickets+' tiket ':'')+(c.unresolvedFeedback?c.unresolvedFeedback+' masukan':'')+((c.openTickets||c.unresolvedFeedback)?'':'—')+'</td>'+
  '<td style="white-space:nowrap"><button class="act" onclick="aksiTrial(\\''+c.tenantId+'\\')">+Trial</button> '+
  '<button class="ghost" onclick="aksiKuota(\\''+c.tenantId+'\\')">+Kuota</button> '+
  '<button class="ghost" onclick="aksiStatus(\\''+c.tenantId+'\\',\\''+c.status+'\\')">Status</button></td></tr>').join('')+'</table></div>';
}
window.aksiTrial=async id=>{const d=prompt('Perpanjang trial berapa hari?','14');if(!d)return;await api('/customers/'+id+'/trial',{method:'POST',body:JSON.stringify({days:Number(d)})});render()};
window.aksiKuota=async id=>{const d=prompt('Tambah kuota pesan berapa?','100');if(!d)return;await api('/customers/'+id+'/quota',{method:'POST',body:JSON.stringify({amount:Number(d)})});render()};
window.aksiStatus=async(id,cur)=>{const s=prompt('Status baru (TRIALING/ACTIVE/PAST_DUE/SUSPENDED/CANCELED/ARCHIVED):',cur);if(!s)return;await api('/customers/'+id+'/status',{method:'POST',body:JSON.stringify({status:s.trim().toUpperCase()})});render()};

async function tiket(){
  const [{tickets},{customers}]=await Promise.all([api('/tickets'),api('/customers')]);
  const opts=customers.map(c=>'<option value="'+c.tenantId+'">'+esc(c.name)+'</option>').join('');
  M.innerHTML='<div class="card"><div class="row"><select id="tt">'+opts+'</select>'+
  '<input id="ts" placeholder="Subjek tiket" style="flex:1;min-width:200px">'+
  '<button class="act" onclick="tiketBaru()">Buat tiket</button></div></div>'+
  '<div class="card"><table><tr><th>Konsumen</th><th>Subjek</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr>'+
  (tickets.length?tickets.map(t=>'<tr><td>'+esc(t.tenantName)+'</td><td><b>'+esc(t.subject)+'</b>'+(t.body?'<br><span class="dim">'+esc(t.body)+'</span>':'')+'</td>'+
  '<td><span class="b '+(t.status==='DONE'?'ok':t.status==='IN_PROGRESS'?'warn':'bad')+'">'+esc(t.status)+'</span></td><td>'+tgl(t.createdAt)+'</td>'+
  '<td style="white-space:nowrap">'+(t.status!=='IN_PROGRESS'?'<button class="ghost" onclick="tiketSet(\\''+t.id+'\\',\\'IN_PROGRESS\\')">Kerjakan</button> ':'')+
  (t.status!=='DONE'?'<button class="act" onclick="tiketSet(\\''+t.id+'\\',\\'DONE\\')">Selesai</button>':'')+'</td></tr>').join(''):'<tr><td colspan="5" class="dim">Belum ada tiket.</td></tr>')+'</table></div>';
}
window.tiketBaru=async()=>{const s=document.getElementById('ts').value.trim();if(!s)return alert('Subjek wajib');await api('/tickets',{method:'POST',body:JSON.stringify({tenantId:document.getElementById('tt').value,subject:s})});render()};
window.tiketSet=async(id,st)=>{await api('/tickets/'+id+'/status',{method:'POST',body:JSON.stringify({status:st})});render()};

async function masukan(){
  const {feedback}=await api('/feedback');
  M.innerHTML='<div class="card"><p class="dim">Bot mencatat otomatis saat pelanggan menyampaikan keluhan/saran di chat.</p>'+
  '<table><tr><th>Konsumen</th><th>Jenis</th><th>Isi</th><th>Waktu</th><th></th></tr>'+
  (feedback.length?feedback.map(f=>'<tr'+(f.resolvedAt?' style="opacity:.5"':'')+'><td>'+esc(f.tenantName)+'</td>'+
  '<td><span class="b '+(f.kind==='keluhan'?'bad':'ok')+'">'+esc(f.kind)+'</span></td><td>'+esc(f.text)+'</td><td>'+tgl(f.createdAt)+'</td>'+
  '<td>'+(f.resolvedAt?'<span class="dim">selesai</span>':'<button class="act" onclick="fbRes(\\''+f.id+'\\')">Tandai selesai</button>')+'</td></tr>').join(''):'<tr><td colspan="5" class="dim">Belum ada masukan.</td></tr>')+'</table></div>';
}
window.fbRes=async id=>{await api('/feedback/'+id+'/resolve',{method:'POST',body:'{}'});render()};

async function token(){
  const u=await api('/usage');
  M.innerHTML=(u.priceConfigured?'':'<p class="err">Harga token belum diisi di env — biaya tampil $0.</p>')+
  '<div class="grid">'+
  kpi(Number(u.totalTokenIn||0).toLocaleString('id'),'Token masuk')+kpi(Number(u.totalTokenOut||0).toLocaleString('id'),'Token keluar')+
  kpi('$'+Number(u.totalCostUsd||0).toFixed(4),'Perkiraan biaya')+kpi(String(u.totalCalls||0),'Panggilan LLM')+'</div>'+
  '<div class="card"><h3>Per konsumen</h3><table><tr><th>Konsumen</th><th>Token in/out</th><th>Panggilan</th><th>Biaya</th></tr>'+
  ((u.byTenant||[]).length?u.byTenant.map(x=>'<tr><td>'+esc(x.tenantName||x.tenantId)+'</td><td>'+Number(x.tokenIn).toLocaleString('id')+' / '+Number(x.tokenOut).toLocaleString('id')+'</td><td>'+x.calls+'</td><td>$'+Number(x.costUsd).toFixed(4)+'</td></tr>').join(''):'<tr><td colspan="4" class="dim">Belum ada data.</td></tr>')+'</table></div>'+
  '<div class="card"><h3>Harian</h3><table><tr><th>Tanggal</th><th>Token in/out</th><th>Panggilan</th><th>Biaya</th></tr>'+
  ((u.daily||[]).length?u.daily.map(d=>'<tr><td>'+esc(d.day)+'</td><td>'+Number(d.tokenIn).toLocaleString('id')+' / '+Number(d.tokenOut).toLocaleString('id')+'</td><td>'+d.calls+'</td><td>$'+Number(d.costUsd).toFixed(4)+'</td></tr>').join(''):'<tr><td colspan="4" class="dim">Belum ada data.</td></tr>')+'</table></div>';
}
const kpi=(v,l)=>'<div class="kpi"><div class="v">'+v+'</div><div class="l">'+l+'</div></div>';

async function sistem(){
  const s=await api('/system');
  const q=Object.entries(s.queues||{}).map(([n,c])=>'<tr><td>'+esc(n)+'</td><td>'+c.waiting+'</td><td>'+c.active+'</td><td>'+c.failed+'</td></tr>').join('');
  M.innerHTML='<div class="grid">'+
  kpi(s.load1+' <span class="dim" style="font-size:13px">/ '+s.cpuCount+' cpu</span>','Load 1 menit (VPS)')+
  kpi(s.memUsedMb+' <span class="dim" style="font-size:13px">/ '+s.memTotalMb+' MB</span>','Memori terpakai')+
  kpi(s.diskUsedGb+' <span class="dim" style="font-size:13px">/ '+s.diskTotalGb+' GB</span>','Disk terpakai')+
  kpi(s.uptimeHours+' jam','Uptime host')+'</div>'+
  '<div class="card"><h3>Model AI aktif</h3><p><b>'+esc(s.model)+'</b> — $'+s.pricePer1M.input+' / $'+s.pricePer1M.output+' per 1 jt token (in/out)</p></div>'+
  '<div class="card"><h3>Antrean job</h3><table><tr><th>Antrean</th><th>Menunggu</th><th>Aktif</th><th>Gagal</th></tr>'+(q||'<tr><td colspan="4" class="dim">Redis tak terhubung.</td></tr>')+'</table></div>';
}
render();
</script></body></html>`;
