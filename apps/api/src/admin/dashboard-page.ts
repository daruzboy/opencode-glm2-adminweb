// Halaman dashboard admin — SATU string HTML self-contained (tanpa build tool, tanpa CDN).
// Disajikan di GET /admin; data via fetch ke /api/admin/dashboard/* dgn x-admin-token
// (diminta sekali, disimpan localStorage).
//
// Kategori konsumen (bahasa PO, 2026-07-15): Prospek (belum berlangganan) · Batal
// (prospek diam >2 minggu, atau di-set manual) · Aktif (berlangganan) · Nonaktif
// (berhenti). DB tetap memakai enum TenantStatus; pemetaan dilakukan di sini.

export const DASHBOARD_PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Simple-Web Admin</title>
<style>
:root{--bg:#0f1115;--card:#181b22;--line:#2a2f3a;--tx:#e6e9ef;--dim:#9aa3b2;--acc:#4f8cff;--ok:#3fb37f;--warn:#e0a93e;--bad:#e05d5d}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--tx)}
header{display:flex;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
h1{font-size:16px;margin:0}nav{display:flex;gap:4px;flex-wrap:wrap}
nav button{background:none;border:1px solid var(--line);color:var(--dim);padding:6px 12px;border-radius:8px;cursor:pointer}
nav button.on{color:var(--tx);border-color:var(--acc)}
main{padding:20px;max-width:1280px;margin:0 auto}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;white-space:nowrap}
.b{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.b.ok{color:var(--ok)}.b.warn{color:var(--warn)}.b.bad{color:var(--bad)}
button.act{background:var(--acc);border:0;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px}
button.ghost{background:none;border:1px solid var(--line);color:var(--dim);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px}
input,select,textarea{background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:6px;padding:6px 8px;font:inherit}
textarea{font-family:ui-monospace,monospace;font-size:12.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi .v{font-size:22px;font-weight:700}.kpi .l{color:var(--dim);font-size:12px}
.dim{color:var(--dim)}.err{color:var(--bad);padding:8px 0}
#login{max-width:380px;margin:80px auto;text-align:center}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
pre{white-space:pre-wrap;overflow-x:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}
</style></head><body>
<header><h1>🛠️ Simple-Web Admin</h1>
<nav id="tabs"></nav><span style="flex:1"></span>
<button class="ghost" onclick="localStorage.removeItem('admtok');location.reload()">Keluar</button></header>
<main id="main"></main>
<script>
const TABS=[['konsumen','Konsumen'],['tiket','Tiket'],['masukan','Keluhan & Saran'],['token','Token & Biaya'],['sop','SOP'],['setelan','Pengaturan'],['sistem','Sistem']];
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
  try{await({konsumen,tiket,masukan,token,sop,setelan,sistem})[tab]()}catch(e){M.innerHTML='<p class="err">'+esc(e.message)+'</p>'+(String(e.message).includes('token')?'<button class="ghost" onclick="localStorage.removeItem(\\'admtok\\');location.reload()">Ganti token</button>':'')}
}
window.render=render;

// ── Konsumen ──────────────────────────────────────────────────────────────────
const KATS=['Prospek','Batal','Aktif','Nonaktif'];
const KAT2STATUS={Prospek:'TRIALING',Batal:'CANCELED',Aktif:'ACTIVE',Nonaktif:'SUSPENDED'};
const DUA_MINGGU=14*864e5;
function kat(c){
  if(c.status==='ACTIVE')return 'Aktif';
  if(c.status==='CANCELED')return 'Batal';
  if(c.status==='TRIALING')return (c.lastInboundAt&&Date.now()-new Date(c.lastInboundAt).getTime()>DUA_MINGGU)?'Batal':'Prospek';
  return 'Nonaktif';
}
let CUST=[],KATF='Semua';
window.setKat=v=>{KATF=v;drawKonsumen()};

async function konsumen(){
  CUST=(await api('/customers')).customers;
  drawKonsumen();
}
function drawKonsumen(){
  const badge={Aktif:'ok',Prospek:'warn',Batal:'bad',Nonaktif:''};
  const rows=CUST.filter(c=>KATF==='Semua'||kat(c)===KATF);
  const n=k=>CUST.filter(c=>kat(c)===k).length;
  M.innerHTML='<div class="row"><label class="dim">Kategori:</label><select onchange="setKat(this.value)">'+
  ['Semua',...KATS].map(k=>'<option value="'+k+'"'+(k===KATF?' selected':'')+'>'+k+' ('+(k==='Semua'?CUST.length:n(k))+')</option>').join('')+
  '</select><span class="dim">Prospek = belum berlangganan · Batal = prospek diam &gt;2 minggu · Aktif = berlangganan · Nonaktif = berhenti</span></div>'+
  '<div class="card"><table><tr><th>Konsumen</th><th>Status</th><th>Layanan s.d.</th><th>Pesan</th><th>Situs</th><th>Catatan admin</th><th>Chat terakhir</th><th>Tiket/Masukan</th><th>Aksi</th></tr>'+
  (rows.length?rows.map(c=>{const k=kat(c);return '<tr><td><b>'+esc(c.name)+'</b><br><span class="dim">'+esc(c.slug)+'</span><br><a href="#" onclick="lihatMemori(\\''+c.tenantId+'\\');return false">🧠 memori</a></td>'+
  '<td><span class="b '+(badge[k]||'')+'">'+k+'</span><br><span class="dim" style="font-size:11px">'+esc(c.status)+'</span></td>'+
  '<td>'+(c.serviceEndsAt?tgl(c.serviceEndsAt)+'<br><span class="dim" style="font-size:11px">berbayar</span>':tgl(c.trialEndsAt)+(c.trialEndsAt?'<br><span class="dim" style="font-size:11px">trial</span>':''))+'</td><td>'+c.usedMessages+'/'+c.quotaMessages+'</td>'+
  '<td>'+(c.websiteSlug?esc(c.websiteSlug)+' <span class="dim">'+esc(c.websiteStatus||'')+'</span><br>'+
    (c.previewUrl?'<a href="'+esc(c.previewUrl)+'" target="_blank" rel="noopener">pratinjau ↗</a>':'')+
    (c.liveUrl?(c.previewUrl?' · ':'')+'<a href="'+esc(c.liveUrl)+'" target="_blank" rel="noopener">live ↗</a>':''):'—')+'</td>'+
  '<td style="max-width:220px">'+(c.adminNote?esc(c.adminNote):'<span class="dim">—</span>')+' <button class="ghost" onclick="ubahNote(\\''+c.tenantId+'\\')" title="Ubah catatan">✎</button></td>'+
  '<td>'+tgl(c.lastInboundAt)+'</td><td>'+(c.openTickets?c.openTickets+' tiket ':'')+(c.unresolvedFeedback?c.unresolvedFeedback+' masukan':'')+((c.openTickets||c.unresolvedFeedback)?'':'—')+'</td>'+
  '<td style="white-space:nowrap"><select onchange="aksiKat(\\''+c.tenantId+'\\',this.value)" title="Ubah kategori">'+
    KATS.map(x=>'<option'+(x===k?' selected':'')+'>'+x+'</option>').join('')+'</select><br>'+
  '<button class="act" onclick="aksiTrial(\\''+c.tenantId+'\\')">+Trial</button> '+
  '<button class="ghost" onclick="aksiKuota(\\''+c.tenantId+'\\')">+Kuota</button></td></tr>'}).join(''):'<tr><td colspan="9" class="dim">Tidak ada konsumen pada kategori ini.</td></tr>')+'</table></div>';
}
window.aksiTrial=async id=>{const d=prompt('Perpanjang trial berapa hari?','14');if(!d)return;await api('/customers/'+id+'/trial',{method:'POST',body:JSON.stringify({days:Number(d)})});render()};
window.aksiKuota=async id=>{const d=prompt('Tambah kuota pesan berapa?','100');if(!d)return;await api('/customers/'+id+'/quota',{method:'POST',body:JSON.stringify({amount:Number(d)})});render()};
window.aksiKat=async(id,k)=>{await api('/customers/'+id+'/status',{method:'POST',body:JSON.stringify({status:KAT2STATUS[k]})});render()};
window.ubahNote=async id=>{
  const c=CUST.find(x=>x.tenantId===id);
  const n=prompt('Catatan admin untuk '+(c?c.name:id)+' (kosongkan untuk menghapus):',c&&c.adminNote?c.adminNote:'');
  if(n===null)return;
  await api('/customers/'+id+'/note',{method:'POST',body:JSON.stringify({note:n})});render();
};

// Memori/konteks konsumen (TenantProfile — diisi bot dari percakapan & build).
window.lihatMemori=async id=>{
  const c=CUST.find(x=>x.tenantId===id);
  M.innerHTML='<p class="dim">Memuat…</p>';
  try{
    const {profile}=await api('/customers/'+id+'/profile');
    M.innerHTML='<div class="row"><button class="ghost" onclick="render()">← Kembali</button><h2 style="margin:0">🧠 Memori: '+esc(c?c.name:id)+'</h2></div>'+
    (profile?
      '<div class="card"><h3>Nama pelanggan (dipanggil bot)</h3><p>'+esc(profile.customerName||'—')+'</p>'+
      '<h3>Catatan bot (preferensi/larangan/gaya)</h3>'+((profile.notes||[]).length?'<ul>'+profile.notes.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p class="dim">Belum ada.</p>')+
      '<h3>Brief situs terakhir (build sukses)</h3>'+(profile.brief?'<pre>'+esc(JSON.stringify(profile.brief,null,2))+'</pre>':'<p class="dim">Belum ada build sukses.</p>')+
      '<p class="dim">Diperbarui: '+tgl(profile.updatedAt)+'</p></div>'
      :'<div class="card"><p class="dim">Belum ada memori untuk konsumen ini — terisi otomatis saat bot mengobrol (nama, preferensi) dan saat build situs sukses (brief).</p></div>');
  }catch(e){M.innerHTML='<p class="err">'+esc(e.message)+'</p>'}
};

// ── Tiket (per TOPIK; bot mengklasifikasikan otomatis dari chat) ──────────────
const TOPIK={'konten':'Konten','tampilan':'Tampilan','ganti-tema':'Ganti Tema','fitur':'Fitur','akun':'Akun','gangguan':'Gangguan','teknis':'Teknis'};
function tiketRow(t){
  const pri=t.priority==='tinggi';
  return '<tr'+(t.status==='DONE'?' style="opacity:.5"':'')+'><td>'+esc(t.tenantName)+'</td>'+
  '<td>'+(t.topic?'<span class="b">'+esc(TOPIK[t.topic]||t.topic)+'</span>':'<span class="dim">—</span>')+'</td>'+
  '<td>'+(pri?'⚡ ':'')+'<b>'+esc(t.subject)+'</b>'+(t.body?'<br><span class="dim">'+esc(t.body)+'</span>':'')+'</td>'+
  '<td><span class="b '+(t.status==='DONE'?'ok':t.status==='IN_PROGRESS'?'warn':'bad')+'">'+esc(t.status)+'</span></td><td>'+tgl(t.createdAt)+'</td>'+
  '<td style="white-space:nowrap">'+
  (t.status!=='DONE'?'<button class="ghost" onclick="tiketPri(\\''+t.id+'\\',\\''+(pri?'normal':'tinggi')+'\\')" title="Ubah prioritas">'+(pri?'⬇ normal':'⚡ prioritas')+'</button> ':'')+
  (t.status==='OPEN'?'<button class="ghost" onclick="tiketSet(\\''+t.id+'\\',\\'IN_PROGRESS\\')">Kerjakan</button> ':'')+
  (t.status!=='DONE'?'<button class="act" onclick="tiketSet(\\''+t.id+'\\',\\'DONE\\')">✓ Selesai</button>':'<span class="dim">selesai</span>')+'</td></tr>';
}
async function tiket(){
  const [{tickets},{customers}]=await Promise.all([api('/tickets'),api('/customers')]);
  const opts=customers.map(c=>'<option value="'+c.tenantId+'">'+esc(c.name)+'</option>').join('');
  const topikOpts=Object.entries(TOPIK).map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('');
  const head='<tr><th>Konsumen</th><th>Topik</th><th>Subjek</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr>';
  const prioritas=tickets.filter(t=>t.priority==='tinggi'&&t.status!=='DONE');
  M.innerHTML='<div class="card"><p class="dim">Bot mengklasifikasikan permintaan pelanggan dari chat (Konten · Tampilan · Ganti Tema · Fitur · Akun · Gangguan · Teknis) dan memasukkannya ke daftar ini otomatis. Tambah manual:</p>'+
  '<div class="row"><select id="tt">'+opts+'</select><select id="tp">'+topikOpts+'</select>'+
  '<input id="ts" placeholder="Subjek tiket" style="flex:1;min-width:200px">'+
  '<label class="dim"><input id="tpri" type="checkbox"> prioritas</label>'+
  '<button class="act" onclick="tiketBaru()">Buat tiket</button></div></div>'+
  '<div class="card"><h3>⚡ Prioritas — segera dikerjakan</h3><table>'+head+
  (prioritas.length?prioritas.map(tiketRow).join(''):'<tr><td colspan="6" class="dim">Tidak ada tiket prioritas. 👍</td></tr>')+'</table></div>'+
  '<div class="card"><h3>Semua tiket (terlama dulu)</h3><table>'+head+
  (tickets.length?tickets.map(tiketRow).join(''):'<tr><td colspan="6" class="dim">Belum ada tiket.</td></tr>')+'</table></div>';
}
window.tiketBaru=async()=>{
  const s=document.getElementById('ts').value.trim();if(!s)return alert('Subjek wajib');
  await api('/tickets',{method:'POST',body:JSON.stringify({tenantId:document.getElementById('tt').value,subject:s,
    topic:document.getElementById('tp').value,priority:document.getElementById('tpri').checked?'tinggi':'normal'})});
  render();
};
window.tiketSet=async(id,st)=>{await api('/tickets/'+id+'/status',{method:'POST',body:JSON.stringify({status:st})});render()};
window.tiketPri=async(id,p)=>{await api('/tickets/'+id+'/priority',{method:'POST',body:JSON.stringify({priority:p})});render()};

// ── Keluhan & Saran ───────────────────────────────────────────────────────────
async function masukan(){
  const {feedback}=await api('/feedback');
  M.innerHTML='<div class="card"><p class="dim">Bot mencatat otomatis saat pelanggan menyampaikan keluhan/saran di chat.</p>'+
  '<table><tr><th>Konsumen</th><th>Jenis</th><th>Isi</th><th>Waktu</th><th></th></tr>'+
  (feedback.length?feedback.map(f=>'<tr'+(f.resolvedAt?' style="opacity:.5"':'')+'><td>'+esc(f.tenantName)+'</td>'+
  '<td><span class="b '+(f.kind==='keluhan'?'bad':'ok')+'">'+esc(f.kind)+'</span></td><td>'+esc(f.text)+'</td><td>'+tgl(f.createdAt)+'</td>'+
  '<td>'+(f.resolvedAt?'<span class="dim">selesai</span>':'<button class="act" onclick="fbRes(\\''+f.id+'\\')">Tandai selesai</button>')+'</td></tr>').join(''):'<tr><td colspan="5" class="dim">Belum ada masukan.</td></tr>')+'</table></div>';
}
window.fbRes=async id=>{await api('/feedback/'+id+'/resolve',{method:'POST',body:'{}'});render()};

// ── Token & Biaya ─────────────────────────────────────────────────────────────
async function token(){
  const u=await api('/usage');
  M.innerHTML=(u.priceConfigured?'':'<p class="err">Harga token belum diisi (tab Pengaturan) — biaya tampil $0.</p>')+
  '<div class="grid">'+
  kpi(Number(u.totalTokenIn||0).toLocaleString('id'),'Token masuk')+kpi(Number(u.totalTokenOut||0).toLocaleString('id'),'Token keluar')+
  kpi('$'+Number(u.totalCostUsd||0).toFixed(4),'Perkiraan biaya')+kpi(String(u.totalCalls||0),'Panggilan LLM')+'</div>'+
  '<div class="card"><h3>Per konsumen</h3><table><tr><th>Konsumen</th><th>Token in/out</th><th>Panggilan</th><th>Biaya</th></tr>'+
  ((u.byTenant||[]).length?u.byTenant.map(x=>'<tr><td>'+esc(x.tenantName||x.tenantId)+'</td><td>'+Number(x.tokenIn).toLocaleString('id')+' / '+Number(x.tokenOut).toLocaleString('id')+'</td><td>'+x.calls+'</td><td>$'+Number(x.costUsd).toFixed(4)+'</td></tr>').join(''):'<tr><td colspan="4" class="dim">Belum ada data.</td></tr>')+'</table></div>'+
  '<div class="card"><h3>Harian</h3><table><tr><th>Tanggal</th><th>Token in/out</th><th>Panggilan</th><th>Biaya</th></tr>'+
  ((u.daily||[]).length?u.daily.map(d=>'<tr><td>'+esc(d.day)+'</td><td>'+Number(d.tokenIn).toLocaleString('id')+' / '+Number(d.tokenOut).toLocaleString('id')+'</td><td>'+d.calls+'</td><td>$'+Number(d.costUsd).toFixed(4)+'</td></tr>').join(''):'<tr><td colspan="4" class="dim">Belum ada data.</td></tr>')+'</table></div>';
}
const kpi=(v,l)=>'<div class="kpi"><div class="v">'+v+'</div><div class="l">'+l+'</div></div>';

// ── SOP bot ───────────────────────────────────────────────────────────────────
async function sop(){
  const {sop}=await api('/sop');
  M.innerHTML='<p class="dim">Bot memakai SOP tersimpan pada pesan BERIKUTNYA — tanpa restart. Lebih dari 8.000 karakter akan dipotong bot.</p>'+
  sop.map((d,i)=>'<div class="card"><h3>'+esc(d.title)+'</h3><p class="dim">'+esc(d.path)+'</p>'+
  '<textarea id="sop'+i+'" data-which="'+esc(d.which)+'" rows="16" style="width:100%"></textarea><br><br>'+
  '<button class="act" onclick="sopSave('+i+')">Simpan '+esc(d.title)+'</button> <span id="sopmsg'+i+'" class="dim"></span></div>').join('');
  sop.forEach((d,i)=>{document.getElementById('sop'+i).value=d.text});
}
window.sopSave=async i=>{
  const t=document.getElementById('sop'+i);
  await api('/sop',{method:'PUT',body:JSON.stringify({which:t.dataset.which,text:t.value})});
  document.getElementById('sopmsg'+i).textContent='✓ tersimpan '+new Date().toLocaleTimeString('id-ID');
};

// ── Pengaturan LLM ────────────────────────────────────────────────────────────
async function setelan(){
  const s=await api('/settings');
  const models=['deepseek-v4-flash','deepseek-v4-pro'];
  const custom=!models.includes(s.model);
  M.innerHTML='<div class="card"><h3>Model AI</h3>'+
  '<p class="dim">flash = hemat &amp; cepat. pro = model <i>reasoning</i>: lebih pintar tapi lebih mahal &amp; lambat. Perubahan berlaku pada panggilan berikutnya, tanpa restart. Jangan lupa sesuaikan harga token saat ganti model.</p>'+
  '<div class="row"><select id="mdl">'+models.map(m=>'<option value="'+m+'"'+(m===s.model?' selected':'')+'>'+m+'</option>').join('')+
  '<option value="__lain"'+(custom?' selected':'')+'>lainnya…</option></select>'+
  '<input id="mdlx" placeholder="nama model" value="'+(custom?esc(s.model):'')+'" style="'+(custom?'':'display:none')+'">'+
  (s.modelOverridden?'<button class="ghost" onclick="setPatch({model:\\'\\'})">↩ kembali ke env</button>':'<span class="dim">(dari env)</span>')+'</div>'+
  '<h3>API key</h3><p class="dim">Terpasang: <b>'+(s.apiKeyMasked?esc(s.apiKeyMasked):'—')+'</b> '+(s.apiKeyOverridden?'(override dashboard) <button class="ghost" onclick="setPatch({apiKey:\\'\\'})">↩ kembali ke env</button>':'(dari env)')+'</p>'+
  '<input id="key" type="password" placeholder="isi hanya bila ingin mengganti" style="width:min(360px,100%)" autocomplete="off">'+
  '<h3>Harga token (USD per 1 juta)</h3>'+
  '<div class="row">Input <input id="pin" type="number" step="0.01" min="0" value="'+s.priceInputPer1M+'" style="width:110px"> Output <input id="pout" type="number" step="0.01" min="0" value="'+s.priceOutputPer1M+'" style="width:110px">'+(s.priceOverridden?'<span class="dim">(override dashboard)</span>':'<span class="dim">(dari env)</span>')+'</div>'+
  '<br><button class="act" onclick="setelanSimpan()">Simpan pengaturan</button> <span id="setmsg" class="dim"></span></div>'+
  (s.subscription?hargaCard(s.subscription):'');
  document.getElementById('mdl').onchange=e=>{document.getElementById('mdlx').style.display=e.target.value==='__lain'?'':'none'};
}
const rp=n=>n==null?'—':'Rp'+Number(n).toLocaleString('id-ID');
function hargaCard(sub){
  return '<div class="card"><h3>💰 Harga langganan</h3>'+
  '<p class="dim">Yang DITAGIHKAN ke konsumen setelah situs tayang = harga promo bila diisi, selain itu harga normal. Kosongkan promo untuk mengakhiri diskon. Link bayar berlaku 24 jam; lewat itu situs ditahan.</p>'+
  '<div class="row">Harga normal (Rp) <input id="subp" type="number" step="1000" min="1000" value="'+(sub.priceIdr??'')+'" style="width:130px">'+
  ' Harga promo (Rp) <input id="subd" type="number" step="1000" min="1000" value="'+(sub.discountIdr??'')+'" placeholder="tanpa promo" style="width:130px">'+
  ' Periode (hari) <input id="subper" type="number" min="1" max="365" value="'+sub.periodDays+'" style="width:80px"></div>'+
  '<p>Ditagihkan sekarang: <b>'+rp(sub.effectiveIdr)+'</b>'+(sub.discountIdr?' <span class="dim">(promo — normal '+rp(sub.priceIdr)+')</span>':'')+' <span class="dim">/ '+sub.periodDays+' hari · sumber: '+sub.source+'</span></p>'+
  '<button class="act" onclick="hargaSimpan()">Simpan harga</button> <span id="submsg" class="dim"></span></div>';
}
window.hargaSimpan=async()=>{
  const v=id=>document.getElementById(id).value.trim();
  const p={subscriptionPriceIdr:v('subp')===''?'':Number(v('subp')),
           subscriptionDiscountIdr:v('subd')===''?'':Number(v('subd')),
           subscriptionPeriodDays:v('subper')===''?'':Number(v('subper'))};
  await api('/settings',{method:'POST',body:JSON.stringify(p)});
  document.getElementById('submsg').textContent='✓ tersimpan';setTimeout(render,700);
};
window.setPatch=async p=>{await api('/settings',{method:'POST',body:JSON.stringify(p)});render()};
window.setelanSimpan=async()=>{
  const sel=document.getElementById('mdl').value;
  const model=sel==='__lain'?document.getElementById('mdlx').value.trim():sel;
  if(!model)return alert('Nama model wajib diisi');
  const p={model,priceInputPer1M:Number(document.getElementById('pin').value),priceOutputPer1M:Number(document.getElementById('pout').value)};
  const key=document.getElementById('key').value.trim();
  if(key)p.apiKey=key;
  await api('/settings',{method:'POST',body:JSON.stringify(p)});
  document.getElementById('setmsg').textContent='✓ tersimpan';
  setTimeout(render,700);
};

// ── Sistem ────────────────────────────────────────────────────────────────────
async function sistem(){
  const s=await api('/system');
  const q=Object.entries(s.queues||{}).map(([n,c])=>'<tr><td>'+esc(n)+'</td><td>'+c.waiting+'</td><td>'+c.active+'</td><td>'+c.failed+'</td></tr>').join('');
  M.innerHTML='<div class="grid">'+
  kpi(s.load1+' <span class="dim" style="font-size:13px">/ '+s.cpuCount+' cpu</span>','Load 1 menit (VPS)')+
  kpi(s.memUsedMb+' <span class="dim" style="font-size:13px">/ '+s.memTotalMb+' MB</span>','Memori terpakai')+
  kpi(s.diskUsedGb+' <span class="dim" style="font-size:13px">/ '+s.diskTotalGb+' GB</span>','Disk terpakai')+
  kpi(s.uptimeHours+' jam','Uptime host')+'</div>'+
  '<div class="card"><h3>Model AI aktif</h3><p><b>'+esc(s.model)+'</b> — $'+s.pricePer1M.input+' / $'+s.pricePer1M.output+' per 1 jt token (in/out) · ubah di tab Pengaturan</p></div>'+
  '<div class="card"><h3>Antrean job</h3><table><tr><th>Antrean</th><th>Menunggu</th><th>Aktif</th><th>Gagal</th></tr>'+(q||'<tr><td colspan="4" class="dim">Redis tak terhubung.</td></tr>')+'</table></div>';
}
render();
</script></body></html>`;
