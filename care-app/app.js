// ============================================================
// 关怀探访系统 · 前端逻辑（Firebase：Auth + Firestore）
// ============================================================
firebase.initializeApp(window.CARE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();
const SS   = firebase.firestore.FieldValue.serverTimestamp;

let ME = null;          // {id,name,email,role,area,active,approved}
let PROFILES = [];      // 所有用户（负责人/管理员可见）
let signupMode = false;

const $ = id => document.getElementById(id);
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ROLE_LABEL = {admin:'管理员', leader:'负责人', volunteer:'同工'};
const today = () => new Date().toISOString().slice(0,10);

// ---------- 认证 ----------
function toggleAuth(){
  signupMode = !signupMode;
  $('name-wrap').style.display = signupMode ? 'block' : 'none';
  $('auth-btn').textContent = signupMode ? '注册' : '登录';
  $('toggle-auth').textContent = signupMode ? '已有账号？登录' : '还没有账号？注册';
  $('forgot-link').style.display = signupMode ? 'none' : '';
  $('forgot-sep').style.display  = signupMode ? 'none' : '';
  $('auth-msg').textContent = '';
}

async function doAuth(){
  const email = $('email').value.trim(), pw = $('pw').value;
  const msg = $('auth-msg'); msg.className='msg'; msg.textContent='';
  if (!email || !pw){ msg.className='msg err'; msg.textContent='请输入邮箱和密码'; return; }
  $('auth-btn').disabled = true;
  try {
    if (signupMode){
      const name = $('rname').value.trim();
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      await db.collection('profiles').doc(cred.user.uid).set({
        name: name || email.split('@')[0], email,
        role:'volunteer', approved:false, active:true, area:'', createdAt: SS()
      });
      // onAuthStateChanged 会接管 → 显示「等待批准」
    } else {
      await auth.signInWithEmailAndPassword(email, pw);
    }
  } catch(e){ msg.className='msg err'; msg.textContent = translateErr(e.code || e.message); }
  $('auth-btn').disabled = false;
}

async function doLogout(){ await auth.signOut(); location.reload(); }

async function forgotPassword(){
  const email = $('email').value.trim();
  const msg = $('auth-msg'); msg.className='msg';
  if (!email){ msg.className='msg err'; msg.textContent='请先在上面填写你的邮箱'; return; }
  try {
    await auth.sendPasswordResetEmail(email);
    msg.className='msg ok'; msg.textContent='重置邮件已发送，请查收邮箱并按链接设置新密码。';
  } catch(e){ msg.className='msg err'; msg.textContent = translateErr(e.code || e.message); }
}

function translateErr(c){
  const m = {
    'auth/invalid-credential':'邮箱或密码错误',
    'auth/wrong-password':'密码错误',
    'auth/user-not-found':'该邮箱未注册',
    'auth/invalid-email':'邮箱格式不正确',
    'auth/email-already-in-use':'该邮箱已注册，请直接登录',
    'auth/weak-password':'密码至少 6 位',
    'auth/too-many-requests':'尝试过于频繁，请稍后再试'
  };
  return m[c] || c;
}

// ---------- 启动 ----------
auth.onAuthStateChanged(async user => {
  if (!user){
    ['app-view','pending-view'].forEach(id=>$(id).style.display='none');
    $('login-view').style.display='flex';
    return;
  }
  await boot(user);
});

async function boot(user){
  let snap = await db.collection('profiles').doc(user.uid).get();
  if (!snap.exists){
    await db.collection('profiles').doc(user.uid).set({
      name:user.email.split('@')[0], email:user.email,
      role:'volunteer', approved:false, active:true, area:'', createdAt: SS()
    });
    snap = await db.collection('profiles').doc(user.uid).get();
  }
  ME = { id:user.uid, ...snap.data() };

  if (!ME.approved && ME.role !== 'admin'){
    $('login-view').style.display='none';
    $('app-view').style.display='none';
    $('pending-who').textContent = ME.name || ME.email;
    $('pending-view').style.display='flex';
    return;
  }
  $('login-view').style.display='none';
  $('pending-view').style.display='none';
  $('app-view').style.display='block';
  $('who').innerHTML = `${esc(ME.name||ME.email)} <span class="rolechip">${ROLE_LABEL[ME.role]}</span>`;
  buildTabs();
  if (isLeader()) await loadProfiles();
  renderActive();
}

const isLeader = () => ME && (ME.role==='leader' || ME.role==='admin');
const isAdmin  = () => ME && ME.role==='admin';

// ---------- 标签页 ----------
function buildTabs(){
  const tabs = [{id:'todo',label:'我的待办'}];
  if (isLeader()) tabs.push({id:'board',label:'探访看板'},{id:'register',label:'登记新朋友'});
  if (isAdmin())  tabs.push({id:'users',label:'用户管理'},{id:'groups',label:'小组管理'},{id:'settings',label:'设置'});
  const nav = $('tabs'); nav.innerHTML='';
  tabs.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t.label; b.dataset.p = t.id;
    b.onclick = () => selectTab(t.id);
    nav.appendChild(b);
  });
  selectTab(tabs[0].id);
}
let activeTab = 'todo';
function selectTab(id){
  activeTab = id;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.p===id));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('p-'+id).classList.add('active');
  renderActive();
}
function renderActive(){
  if (activeTab==='todo') loadTodo();
  else if (activeTab==='board') loadBoard();
  else if (activeTab==='register') fillAssigneeSelect();
  else if (activeTab==='users') loadUsers();
  else if (activeTab==='groups') loadGroups();
  else if (activeTab==='settings') loadSettings();
}

// ---------- 数据加载 ----------
async function loadProfiles(){
  const qs = await db.collection('profiles').get();
  PROFILES = qs.docs.map(d => ({ id:d.id, ...d.data() }));
}

async function fetchVisitors(filter){
  let qs;
  if (filter==='mine'){
    qs = await db.collection('visitors').where('assigneeId','==',ME.id).get();
  } else {
    qs = await db.collection('visitors').get();
  }
  const arr = qs.docs.map(d => ({ id:d.id, ...d.data() }));
  arr.sort((a,b) => String(b.firstVisit||'').localeCompare(String(a.firstVisit||'')));
  return arr;
}

// ---------- 我的待办 ----------
async function loadTodo(){
  const list = (await fetchVisitors('mine')).filter(v => ['待分配','跟进中','已联系'].includes(v.status));
  const el = $('todo-list');
  el.innerHTML = list.length ? list.map(v => vcard(v)).join('')
    : '<p class="muted">暂无分配给你的待办。</p>';
}

// ---------- 看板 ----------
async function loadBoard(){
  const list = await fetchVisitors('all');
  const cols = ['待分配','跟进中','已联系','已安排小组','福音群','失联'];
  $('board').innerHTML = cols.map(c => {
    const items = list.filter(v => v.status===c);
    if (!items.length) return '';
    return `<div class="col-head">${c}（${items.length}）</div>` + items.map(v => vcard(v)).join('');
  }).join('') || '<p class="muted">还没有访客记录，去「登记新朋友」添加。</p>';
}

// ---------- 访客卡片 ----------
function vcard(v){
  const assignee = v.assigneeName || '未分配';
  const canEdit = isLeader() || v.assigneeId===ME.id;
  let acts = '';
  if (canEdit && v.status!=='失联'){
    acts += `<button class="btn btn-sm" onclick="openFeedback('${v.id}','${esc(v.name)}')">填反馈</button>`;
    acts += `<button class="btn btn-sm btn-ghost" onclick="incVisit('${v.id}')">+1 来访</button>`;
  }
  if (isLeader()){
    acts += `<button class="btn btn-sm btn-ghost" onclick="assignPrompt('${v.id}')">分配同工</button>`;
    acts += `<button class="btn btn-sm btn-ghost" onclick="statusPrompt('${v.id}')">改状态</button>`;
  }
  return `<div class="card vcard">
    <div class="vh"><span class="vn">${esc(v.name)}</span>
      <span class="badge b-${v.status}">${v.status}</span></div>
    <div class="meta">📞 ${esc(v.phone)||'—'} ｜ ${esc(v.identity)} ｜ 区域：${esc(v.area)||'—'} ｜ 来访 ${v.visitCount} 次</div>
    <div class="meta">首访：${esc(v.firstVisit)||'—'} ｜ 同工：${esc(assignee)}${v.lastResult ? (' ｜ 末次：'+esc(v.lastResult)) : ''}</div>
    ${v.note?`<div class="meta muted">备注：${esc(v.note)}</div>`:''}
    <div class="actions">${acts}</div>
  </div>`;
}

// ---------- 登记 ----------
function fillAssigneeSelect(){
  const sel = $('f-assignee'); if (!sel) return;
  sel.innerHTML = '<option value="">（自动/稍后分配）</option>' +
    PROFILES.filter(p=>p.active!==false).map(p=>`<option value="${p.id}">${esc(p.name||p.email)}（${ROLE_LABEL[p.role]}）</option>`).join('');
}

async function registerVisitor(){
  const msg = $('reg-msg'); msg.className='msg'; msg.textContent='';
  const name = $('f-name').value.trim();
  if (!name){ msg.className='msg err'; msg.textContent='请填写姓名'; return; }
  const aid = $('f-assignee').value || null;
  const ap = aid ? PROFILES.find(p=>p.id===aid) : null;
  const rec = {
    name, phone:$('f-phone').value.trim(), email:$('f-email').value.trim(),
    area:$('f-area').value.trim(), identity:$('f-identity').value,
    firstVisit: $('f-first').value || today(),
    visitCount: parseInt($('f-count').value||'1',10),
    note:$('f-note').value.trim(), createdBy: ME.id, createdAt: SS(),
    assigneeId: aid, assigneeName: ap ? (ap.name||ap.email) : null,
    status: aid ? '跟进中' : '待分配',
    assignDate: aid ? new Date() : null,
    lastResult: null, lastContactDate: null, escalated: false
  };
  try {
    await db.collection('visitors').add(rec);
    msg.className='msg ok'; msg.textContent='已登记！';
    ['f-name','f-phone','f-email','f-area','f-note'].forEach(id=>$(id).value='');
    $('f-count').value='1';
  } catch(e){ msg.className='msg err'; msg.textContent='登记失败：'+e.message; }
}

// ---------- 操作 ----------
async function incVisit(id){
  const ref = db.collection('visitors').doc(id);
  const s = await ref.get();
  await ref.update({ visitCount:(s.data().visitCount||0)+1 });
  renderActive();
}

async function assignPrompt(id){
  const pool = PROFILES.filter(p=>p.active!==false);
  const opts = pool.map((p,i)=>`${i+1}. ${p.name||p.email}`).join('\n');
  const n = prompt('分配给哪位同工？输入序号：\n'+opts);
  if (!n) return;
  const p = pool[parseInt(n,10)-1];
  if (!p) return;
  await db.collection('visitors').doc(id).update({
    assigneeId:p.id, assigneeName:p.name||p.email, status:'跟进中',
    assignDate:new Date(), escalated:false
  });
  renderActive();
}

async function statusPrompt(id){
  const s = prompt('改为哪个状态？\n待分配 / 跟进中 / 已联系 / 已安排小组 / 福音群 / 失联');
  if (!['待分配','跟进中','已联系','已安排小组','福音群','失联'].includes(s)) return;
  await db.collection('visitors').doc(id).update({ status:s });
  renderActive();
}

// ---------- 反馈弹窗 ----------
let fbVisitor = null;
function openFeedback(id, name){
  fbVisitor = id;
  $('m-title').textContent = '探访反馈 · ' + name;
  $('m-note').value=''; $('m-enc').checked=true; $('mr1').checked=true; $('m-msg').textContent='';
  $('modal').classList.add('open');
}
function closeModal(){ $('modal').classList.remove('open'); }
async function submitFeedback(){
  const result = document.querySelector('input[name=mresult]:checked').value;
  const encouraged = $('m-enc').checked;
  const note = $('m-note').value.trim();
  try {
    await db.collection('followups').add({
      visitorId: fbVisitor, byId: ME.id, byName: ME.name||ME.email,
      result, encouraged, note, createdAt: SS()
    });
    const ref = db.collection('visitors').doc(fbVisitor);
    const cur = (await ref.get()).data();
    const upd = { lastResult:result, lastContactDate:new Date() };
    if (result==='已联系' && cur.status==='跟进中') upd.status='已联系';
    await ref.update(upd);
    closeModal(); renderActive();
  } catch(e){ $('m-msg').className='msg err'; $('m-msg').textContent='失败：'+e.message; }
}

// ---------- 用户管理 ----------
async function loadUsers(){
  await loadProfiles();
  const pending = PROFILES.filter(p=>!p.approved);
  const note = pending.length
    ? `<div class="card" style="border-left:4px solid var(--red)"><b style="color:var(--red)">有 ${pending.length} 位新注册用户待批准</b></div>` : '';
  const roleOpts = p => ['volunteer','leader','admin'].map(r=>
    `<option value="${r}" ${p.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('');
  $('users-list').innerHTML = note + PROFILES.map(p=>`
    <div class="card"${!p.approved?' style="border-left:4px solid var(--red)"':''}>
      <div class="vh"><span class="vn">${esc(p.name)||'（未填名）'}</span>
        ${ p.approved ? '<span class="badge b-已联系">✓ 已批准</span>'
                       : `<button class="btn btn-sm" onclick="setApproved('${p.id}',true)">批准登录</button>` }</div>
      <div class="meta">${esc(p.email)}</div>
      <div class="mrow"><label>角色</label>
        <select onchange="setRole('${p.id}',this.value)">${roleOpts(p)}</select></div>
      <div class="mrow"><label>区域</label>
        <input type="text" value="${esc(p.area)||''}" placeholder="负责区域（可选）" onchange="setArea('${p.id}',this.value)"></div>
      <label class="opt"><input type="checkbox" ${p.active!==false?'checked':''} onchange="setActive('${p.id}',this.checked)"> 启用该同工（用于自动分配）</label>
      ${ p.approved ? `<div style="margin-top:.5rem"><button class="del" onclick="setApproved('${p.id}',false)">撤销批准</button></div>` : '' }
    </div>`).join('');
}
async function setApproved(id,b){ await db.collection('profiles').doc(id).update({approved:b}); loadUsers(); }
async function setRole(id,r){ await db.collection('profiles').doc(id).update({role:r}); }
async function setArea(id,a){ await db.collection('profiles').doc(id).update({area:a}); }
async function setActive(id,b){ await db.collection('profiles').doc(id).update({active:b}); }

// ---------- 小组管理 ----------
async function loadGroups(){
  const qs = await db.collection('groups').orderBy('name').get();
  const groups = qs.docs.map(d=>({id:d.id, ...d.data()}));
  $('groups-list').innerHTML = groups.length
    ? groups.map(g=>`<div class="card">
        <div class="vh"><span class="vn">${esc(g.name)}</span>
          <button class="del" onclick="delGroup('${g.id}','${esc(g.name)}')">删除</button></div>
        <div class="meta">覆盖区域：${esc(g.coverArea)||'—'}</div>
        <div class="meta">负责人：${esc(g.leaderName)||'—'}｜${esc(g.leaderEmail)||'—'}</div>
        <div class="meta">聚会：${esc(g.meetTime)||'—'}</div>
      </div>`).join('')
    : '<p class="muted">还没有小组，用下面表单添加。</p>';
}
async function addGroup(){
  const msg = $('grp-msg'); msg.className='msg';
  const rec = { name:$('g-name').value.trim(), coverArea:$('g-area').value.trim(),
    leaderName:$('g-ln').value.trim(), leaderEmail:$('g-le').value.trim(), meetTime:$('g-time').value.trim() };
  if (!rec.name){ msg.className='msg err'; msg.textContent='请填写组名'; return; }
  try {
    await db.collection('groups').add(rec);
    ['g-name','g-area','g-ln','g-le','g-time'].forEach(id=>$(id).value='');
    msg.className='msg ok'; msg.textContent='已添加';
    loadGroups();
  } catch(e){ msg.className='msg err'; msg.textContent='失败：'+e.message; }
}
async function delGroup(id,name){
  if (!confirm('确定删除小组「'+name+'」？')) return;
  await db.collection('groups').doc(id).delete();
  loadGroups();
}

// ---------- 设置 ----------
async function loadSettings(){
  const d = await db.collection('config').doc('app').get();
  const c = d.exists ? d.data() : {};
  $('s-church').value = c.churchName || '新生命国语播道会';
  $('s-care').value   = c.careLeaderEmail || '';
  $('s-gospel').value = c.gospelLeaderEmail || '';
  $('s-goal').value   = c.goalVisits || 4;
  $('s-lost').value   = c.lostWeeks || 4;
  $('s-url').value    = c.appUrl || (location.origin + location.pathname);
}
async function saveSettings(){
  const msg = $('set-msg'); msg.className='msg';
  const rec = {
    churchName: $('s-church').value.trim(),
    careLeaderEmail: $('s-care').value.trim(),
    gospelLeaderEmail: $('s-gospel').value.trim(),
    goalVisits: parseInt($('s-goal').value||'4',10),
    lostWeeks: parseInt($('s-lost').value||'4',10),
    appUrl: $('s-url').value.trim()
  };
  try {
    await db.collection('config').doc('app').set(rec, { merge:true });
    msg.className='msg ok'; msg.textContent='已保存';
  } catch(e){ msg.className='msg err'; msg.textContent='保存失败：'+e.message; }
}
