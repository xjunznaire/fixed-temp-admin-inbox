const $=id=>document.getElementById(id);let token=localStorage.getItem('whid-admin-token')||'';let currentUser=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(Number(v)).toLocaleString('id-ID'):'-';
async function api(path,options={}){const headers={...(options.headers||{}),...(token?{Authorization:`Bearer ${token}`}:{})};if(options.body)headers['content-type']='application/json';const r=await fetch(path,{...options,headers});let data={};try{data=await r.json()}catch{}if(!r.ok){if(r.status===401&&path!='/api/admin/login')logout(false);throw new Error(data.error||'Permintaan gagal.')}return data}
function showLogin(){ $('loginView').classList.remove('hidden');$('dashboardView').classList.add('hidden') }
function showDashboard(){ $('loginView').classList.add('hidden');$('dashboardView').classList.remove('hidden');$('whoami').textContent=`${currentUser?.login||currentUser?.email||''} · ${currentUser?.role||'admin'}`;updateRoleOptions() }
function updateRoleOptions(){const ownerOption=$('newRole')?.querySelector('option[value="owner"]');if(!ownerOption)return;ownerOption.disabled=currentUser?.role!=='owner';if(ownerOption.disabled&&$('newRole').value==='owner')$('newRole').value='admin'}
async function login(e){e.preventDefault();$('loginError').textContent='';$('loginBtn').disabled=true;try{const r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({login:$('login').value.trim(),password:$('password').value})});token=r.token;localStorage.setItem('whid-admin-token',token);currentUser=r.user;showDashboard();await loadAll()}catch(err){$('loginError').textContent=err.message}finally{$('loginBtn').disabled=false}}
async function logout(call=true){stopToolTimers();consolePaused=false;if(call&&token){try{await api('/api/admin/logout',{method:'POST'})}catch{}}token='';currentUser=null;localStorage.removeItem('whid-admin-token');showLogin()}
let consoleTimer=null,consolePaused=false;
function stopToolTimers(){if(consoleTimer){clearInterval(consoleTimer);consoleTimer=null}if(typeof totpTimer!=='undefined'&&totpTimer){clearInterval(totpTimer);totpTimer=null}}
function stopConsolePolling(){if(consoleTimer){clearInterval(consoleTimer);consoleTimer=null}}
function startConsolePolling(){if(consolePaused||consoleTimer)return;consoleTimer=setInterval(()=>{if(!$('consoleTab').classList.contains('hidden'))loadConsole(true)},5000)}
function switchTab(name){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!==name+'Tab'));if(name!=='console')stopConsolePolling();if(name==='mailboxes')loadMailboxes();if(name==='users')loadUsers();if(name==='cleaner')loadCleanerPreview();if(name==='console'){loadConsole();startConsolePolling()}}
function renderTrendChart(rows=[]){
  const data=Array.isArray(rows)?rows:[];
  if(!data.length){$('statsTrend').innerHTML='<p class="muted">Data tren belum tersedia.</p>';return}
  const maxFor=key=>Math.max(1,...data.map(row=>Number(row[key])||0));
  const height=(value,key)=>{const n=Number(value)||0;return n?Math.max(5,(n/maxFor(key))*100):0};
  const label=day=>{const d=new Date(`${day}T12:00:00+07:00`);return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',timeZone:'Asia/Jakarta'}).format(d)};
  $('statsTrend').innerHTML=data.map(row=>{
    const mailboxes=Number(row.mailboxes)||0,messages=Number(row.messages)||0,activity=Number(row.activity)||0;
    return `<div class="trend-day"><div class="trend-bars"><span class="trend-bar mailbox-bar" style="height:${height(mailboxes,'mailboxes')}%" title="${esc(label(row.day))} · Temp Mail: ${mailboxes}"></span><span class="trend-bar message-bar" style="height:${height(messages,'messages')}%" title="${esc(label(row.day))} · Email Masuk: ${messages}"></span><span class="trend-bar activity-bar" style="height:${height(activity,'activity')}%" title="${esc(label(row.day))} · Aktivitas: ${activity}"></span></div><span class="trend-date">${esc(label(row.day))}</span></div>`;
  }).join('');
}
async function loadStats(){
  const d=await api('/api/admin/stats');
  $('statTotal').textContent=d.totalMailboxes??0;
  $('statActive').textContent=d.activeMailboxes??0;
  $('statMessages').textContent=d.totalMessages??0;
  $('statHistory').textContent=d.historyEvents??0;
  $('statAdmins').textContent=d.adminRoleCount??0;
  $('statOwners').textContent=d.ownerUsers??0;
  $('statTodayMailboxes').textContent=d.todayMailboxes??0;
  $('statTodayMessages').textContent=d.todayMessages??0;
  $('statTodayHistory').textContent=d.todayHistory??0;
  renderTrendChart(d.dailyTrend||[]);
}
function historyHTML(rows){if(!rows.length)return '<p class="muted">Belum ada riwayat.</p>';return `<table><thead><tr><th>Waktu</th><th>Alamat</th><th>Aktivitas</th><th>Actor</th><th>Detail</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(date(x.created_at))}</td><td>${esc(x.address)}</td><td>${esc(x.event)}</td><td>${esc(x.actor)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</tbody></table>`}
async function loadRecent(){const d=await api('/api/admin/history?limit=8');$('recentHistory').innerHTML=historyHTML(d.history||[])}
async function loadMailboxes(){const q=encodeURIComponent($('mailSearch').value.trim());const d=await api('/api/admin/mailboxes?search='+q);const rows=d.mailboxes||[];$('mailboxesTable').innerHTML=rows.length?`<table><thead><tr><th>Alamat</th><th>Dibuat</th><th>Kedaluwarsa</th><th>Pesan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.address)}</td><td>${esc(date(x.created_at))}</td><td>${esc(date(x.expires_at))}</td><td>${x.message_count}</td><td><span class="pill ${Number(x.expires_at)<=Date.now()?'expired':''}">${Number(x.expires_at)>Date.now()?'Aktif':'Expired'}</span></td><td><button class="link-btn" data-inbox="${esc(x.address)}">Lihat inbox</button></td></tr>`).join('')}</tbody></table>`:'<p class="muted">Tidak ada alamat temp mail.</p>'}
async function viewInbox(address){try{const d=await api('/api/admin/mailboxes/'+encodeURIComponent(address)+'/messages');$('modalTitle').textContent=address;$('modalMeta').textContent=`${d.messages.length} pesan ditemukan`;const box=$('modalMessages');box.innerHTML=d.messages.length?d.messages.map(m=>`<article class="message"><h3>${esc(m.subject||'(Tanpa subjek)')}</h3><div class="message-meta">Dari: ${esc(m.from_address||'-')} · ${esc(date(m.received_at))}</div><pre>${esc(m.text_body||stripHtml(m.html_body)||'(Pesan tanpa isi teks)')}</pre></article>`).join(''):'<p class="muted">Belum ada email masuk.</p>';$('messageModal').classList.remove('hidden');await loadStats()}catch(e){alert(e.message)}}
function stripHtml(s){return String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}
async function loadUsers(){const d=await api('/api/admin/users');$('usersTable').innerHTML=d.users?.length?`<table><thead><tr><th>Email / Username / Login</th><th>Role</th><th>Terakhir Login</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>${d.users.map(u=>{const loginLabel=u.login&&u.login!==u.email?`<small>Username / Login: ${esc(u.login)}</small>`:'';const role=u.role||'admin';const canDelete=currentUser?.role==='owner'&&role==='admin'&&u.id!==currentUser?.id;const action=`<div class="user-actions"><span class="muted">Akun aktif</span>${canDelete?`<button class="link-btn delete-user" data-delete-user="${esc(u.id)}" aria-label="Hapus user admin ${esc(u.login||u.email||'')}">Hapus</button>`:''}</div>`;return `<tr><td><div class="user-identifiers">${esc(u.email||'—')}${loginLabel}</div></td><td><span class="role-pill ${role==='owner'?'owner':''}">${esc(role)}</span></td><td>${esc(date(u.last_login_at))}</td><td>${esc(date(u.created_at))}</td><td>${action}</td></tr>`}).join('')}</tbody></table>`:'<p class="muted">Belum ada akun.</p>'}
async function loadAll(){await Promise.all([loadStats(),loadRecent()])}
function formatBytes(value){if(value===null||value===undefined||!Number.isFinite(Number(value)))return 'Tidak tersedia';const n=Number(value);if(n<1024)return `${n} B`;const units=['KB','MB','GB','TB'];let v=n/1024,i=0;while(v>=1024&&i<units.length-1){v/=1024;i++}return `${v.toFixed(2)} ${units[i]}`}
function formatDuration(seconds){const n=Math.max(0,Number(seconds)||0);const d=Math.floor(n/86400),h=Math.floor((n%86400)/3600),m=Math.floor((n%3600)/60),s=Math.floor(n%60);return [d?`${d}h`:'',h?`${h}j`:'',m?`${m}m`:'',`${s}d`].filter(Boolean).join(' ')}
async function loadCleanerPreview(){const status=$('cleanerStatus');status.textContent='Memindai data…';$('runCleaner').disabled=true;try{const d=await api('/api/admin/cleaner/preview');const c=d.counts||{};$('cleanExpiredMailboxes').textContent=c.expiredMailboxes??0;$('cleanExpiredMessages').textContent=c.expiredMailboxMessages??0;$('cleanOldMessages').textContent=c.oldMessages??0;$('cleanOrphanMessages').textContent=c.orphanMessages??0;$('cleanExpiredSessions').textContent=c.expiredSessions??0;$('cleanTotalItems').textContent=d.totalItems??0;$('runCleaner').disabled=!d.canRun;$('cleanerPermission').textContent=d.canRun?'Akses owner aktif — pembersihan diizinkan.':'Hanya owner yang dapat menjalankan pembersihan.';$('cleanerScannedAt').textContent=`Scan terakhir: ${date(d.scannedAt)} · Pesan lama: lebih dari ${d.messageRetentionDays||7} hari.`;status.textContent=d.totalItems?`${d.totalItems} item terdeteksi. Periksa jumlahnya sebelum melanjutkan.`:'Database bersih — tidak ada item yang perlu dibersihkan.';status.className='tool-status '+(d.totalItems?'warning':'success')}catch(e){status.textContent=e.message;status.className='tool-status error';$('cleanerPermission').textContent='Gagal memeriksa izin.'}}
async function runDatabaseCleaner(){if(currentUser?.role!=='owner'){alert('Hanya owner yang dapat menjalankan Database Cleaner.');return}const count=$('cleanTotalItems').textContent;if(!confirm(`Jalankan Database Cleaner untuk item terdeteksi (${count})? Data mailbox kedaluwarsa, email lama/orphan, dan sesi admin kedaluwarsa akan dihapus. Riwayat audit tidak dihapus. Tindakan ini tidak dapat dibatalkan.`))return;const button=$('runCleaner');button.disabled=true;button.textContent='Membersihkan…';try{const d=await api('/api/admin/cleaner/run',{method:'POST',body:JSON.stringify({})});const c=d.cleaned||{};$('cleanerStatus').textContent=`Selesai. Dihapus: ${d.total||0} item — mailbox ${c.expiredMailboxes||0}, email ${((c.expiredMailboxMessages||0)+(c.oldMessages||0)+(c.orphanMessages||0))}, sesi ${c.expiredSessions||0}. Riwayat audit tetap disimpan.`;$('cleanerStatus').className='tool-status success';await Promise.all([loadCleanerPreview(),loadAll()]);if(!$('mailboxesTab').classList.contains('hidden'))await loadMailboxes()}catch(e){$('cleanerStatus').textContent=e.message;$('cleanerStatus').className='tool-status error'}finally{button.textContent='Bersihkan data terdeteksi';button.disabled=currentUser?.role!=='owner'}}
function consoleRow(row){const event=String(row.event||'event');return `<div class="console-line"><time>${esc(date(row.created_at))}</time><span class="console-address">${esc(row.address&&row.address!=='system'?row.address:'—')}</span><span class="console-event">${esc(event)}</span><span class="console-actor">${esc(row.actor||'system')}</span><span class="console-detail">${esc(row.detail||'—')}</span></div>`}
async function loadConsole(silent=false){try{const q=encodeURIComponent($('consoleSearch').value.trim());const d=await api('/api/admin/console?limit=160&search='+q);const logs=d.logs||[];$('consoleOutput').innerHTML=logs.length?logs.map(consoleRow).join(''):'<p class="console-empty">Belum ada log yang cocok.</p>';$('consoleLogCount').textContent=`${logs.length} baris`;$('consoleLiveStatus').textContent=consolePaused?'PAUSED · Pembaruan dihentikan':'LIVE · Sinkronisasi 5 detik';if(!silent)$('consoleOutput').scrollTop=0}catch(e){if(!silent)$('consoleOutput').innerHTML=`<p class="console-empty console-error">${esc(e.message)}</p>`}}
function toggleConsolePause(){consolePaused=!consolePaused;if(consolePaused){if(consoleTimer){clearInterval(consoleTimer);consoleTimer=null}}else if(!$('consoleTab').classList.contains('hidden'))startConsolePolling();$('consolePause').textContent=consolePaused?'Resume':'Pause';$('consoleLiveStatus').textContent=consolePaused?'PAUSED · Pembaruan dihentikan':'LIVE · Sinkronisasi 5 detik'}
$('refreshCleaner').addEventListener('click',loadCleanerPreview);$('runCleaner').addEventListener('click',runDatabaseCleaner);$('refreshConsole').addEventListener('click',()=>loadConsole());$('consolePause').addEventListener('click',toggleConsolePause);$('consoleSearch').addEventListener('input',()=>loadConsole(true));
$('loginForm').addEventListener('submit',login);$('homeBtn').addEventListener('click',()=>{window.location.assign('/')});$('logoutBtn').addEventListener('click',()=>logout());document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.go)));
$('refreshStats').addEventListener('click',async()=>{const b=$('refreshStats');b.disabled=true;try{await loadAll()}catch(e){alert(e.message)}finally{b.disabled=false}});
$('searchBtn').addEventListener('click',loadMailboxes);$('mailSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadMailboxes()});$('closeModal').addEventListener('click',()=>$('messageModal').classList.add('hidden'));$('messageModal').addEventListener('click',e=>{if(e.target.id==='messageModal')$('messageModal').classList.add('hidden')});
document.addEventListener('click',async e=>{const inbox=e.target.closest('[data-inbox]');if(inbox)viewInbox(inbox.dataset.inbox);const del=e.target.closest('[data-delete-user]');if(del&&confirm('Hapus User Admin ini? Tindakan ini tidak dapat dibatalkan.')){try{await api('/api/admin/users/'+encodeURIComponent(del.dataset.deleteUser),{method:'DELETE'});await Promise.all([loadUsers(),loadStats()])}catch(err){alert(err.message)}}});
let userSuccessTimer=null;$('newRole').addEventListener('change',updateRoleOptions);$('userForm').addEventListener('submit',async e=>{e.preventDefault();$('userError').textContent='';$('userSuccess').textContent='';if(userSuccessTimer){clearTimeout(userSuccessTimer);userSuccessTimer=null}try{await api('/api/admin/users',{method:'POST',body:JSON.stringify({email:$('newEmail').value,username:$('newUsername').value,role:$('newRole').value,password:$('newPassword').value})});$('userSuccess').textContent='Akun admin berhasil dibuat.';userSuccessTimer=setTimeout(()=>{$('userSuccess').textContent='';userSuccessTimer=null},5000);$('userForm').reset();updateRoleOptions();await loadUsers();await loadStats()}catch(err){$('userError').textContent=err.message}});
(async()=>{if(!token)return showLogin();try{const d=await api('/api/admin/me');currentUser=d.user;showDashboard();await loadAll()}catch{showLogin()}})();


// Browser-only TOTP authenticator (RFC 6238 / SHA-1, 30-second period).
let totpTimer=null;
function decodeBase32(input){
  const clean=String(input||'').toUpperCase().replace(/[\s=-]/g,'');
  if(!clean||!/^[A-Z2-7]+$/.test(clean))throw new Error('Secret key harus menggunakan karakter Base32 (A–Z dan 2–7).');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',bytes=[];
  for(const ch of clean){const value=alphabet.indexOf(ch);if(value<0)throw new Error('Secret key Base32 tidak valid.');bits+=value.toString(2).padStart(5,'0');}
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  if(!bytes.length)throw new Error('Secret key terlalu pendek atau tidak valid.');
  return new Uint8Array(bytes);
}
async function makeTotp(secret,now=Date.now()){
  const keyBytes=decodeBase32(secret);
  const counter=Math.floor(now/30000);
  const message=new Uint8Array(8);
  let value=counter;
  for(let i=7;i>=0;i--){message[i]=value&255;value=Math.floor(value/256);}
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,message));
  const offset=mac[mac.length-1]&15;
  const binary=((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3];
  return String(binary%1000000).padStart(6,'0');
}
async function updateTotp(){
  const secret=$('totpSecret')?.value.trim();if(!secret)return;
  try{
    if(!crypto?.subtle)throw new Error('Browser tidak mendukung Web Crypto. Buka dashboard melalui HTTPS.');
    const code=await makeTotp(secret);
    $('totpCode').textContent=`${code.slice(0,3)} ${code.slice(3)}`;
    $('totpCountdown').textContent=`Berganti dalam ${30-Math.floor(Date.now()/1000)%30} detik`;
    $('copyTotp').disabled=false;$('totpError').textContent='';
  }catch(e){$('totpCode').textContent='••• •••';$('totpCountdown').textContent='Secret key tidak valid';$('copyTotp').disabled=true;$('totpError').textContent=e.message}
}
function startTotpClock(){if(totpTimer)clearInterval(totpTimer);updateTotp();totpTimer=setInterval(updateTotp,1000)}
$('totpSecret').addEventListener('input',updateTotp);
$('copyTotp').addEventListener('click',async()=>{try{const code=await makeTotp($('totpSecret').value);await navigator.clipboard.writeText(code);$('copyTotp').textContent='Tersalin';setTimeout(()=>$('copyTotp').textContent='Salin kode',1400)}catch(e){$('totpError').textContent=e.message}});

// Extend tab activation without changing the existing Console polling behavior.
const originalSwitchTab=switchTab;
switchTab=function(name){originalSwitchTab(name);if(name==='authenticator')startTotpClock();else if(totpTimer){clearInterval(totpTimer);totpTimer=null}};
