/**
 * 关怀探访系统 · 自动任务
 * 由 GitHub Actions 每天定时运行（见 .github/workflows/care-automation.yml）
 *
 *   每天：检查来访达标、四周失联
 *   周三：给「待分配」访客自动分配同工并发提醒邮件
 *   周五：对未跟进的二次提醒 + 通知探访负责人
 *
 * 环境变量（由 GitHub Secrets 注入）：
 *   FIREBASE_SERVICE_ACCOUNT  Firebase 服务账号 JSON（整段）
 *   GMAIL_USER                发信 Gmail 地址
 *   GMAIL_APP_PASSWORD        Gmail 应用专用密码
 *   RUN_TASK                  auto（默认，按星期）/ assign / escalate / daily / all
 */
const { Firestore } = require('@google-cloud/firestore');
const nodemailer = require('nodemailer');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'newlife-care-e61cf';

// 认证：优先用服务账号 JSON（若有）；否则用应用默认凭证（Workload Identity Federation）。
// @google-cloud/firestore 基于 google-auth-library，原生支持 WIF 的 external_account 凭证。
let db;
if (process.env.FIREBASE_SERVICE_ACCOUNT){
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  db = new Firestore({
    projectId: svc.project_id || PROJECT_ID,
    credentials: { client_email: svc.client_email, private_key: svc.private_key }
  });
} else {
  db = new Firestore({ projectId: PROJECT_ID }); // ADC / WIF（GOOGLE_APPLICATION_CREDENTIALS）
}

const GMAIL_USER = process.env.GMAIL_USER;
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

async function sendMail(to, subject, text){
  if (!to){ console.log('  跳过发信（无收件人）：', subject); return; }
  try {
    await transporter.sendMail({ from: `关怀探访系统 <${GMAIL_USER}>`, to, subject, text });
    console.log('  ✓ 邮件 →', to, '|', subject);
  } catch(e){ console.error('  ✗ 邮件失败 →', to, e.message); }
}

function localWeekday(){
  return new Intl.DateTimeFormat('en-US', { timeZone:'America/Edmonton', weekday:'long' }).format(new Date());
}
const toDate = ts => (ts && typeof ts.toDate === 'function') ? ts.toDate() : (ts ? new Date(ts) : null);

async function getConfig(){
  const def = {
    churchName:'新生命国语播道会', goalVisits:4, lostWeeks:4,
    careLeaderEmail:'', gospelLeaderEmail:'',
    appUrl:'https://calgarynewlife.github.io/NewlifeWebsite/care-app/', rrPointer:0
  };
  const d = await db.collection('config').doc('app').get();
  return d.exists ? { ...def, ...d.data() } : def;
}

// ─────────────────────────────────────────────
// 周三：分配同工
// ─────────────────────────────────────────────
async function assignNewVisitors(cfg){
  console.log('[分配] 查找待分配访客…');
  const vis = await db.collection('visitors').where('status','==','待分配').get();
  if (vis.empty){ console.log('  无待分配访客'); return; }
  const profs = await db.collection('profiles').where('approved','==',true).get();
  const pool = profs.docs.map(d=>({id:d.id,...d.data()}))
    .filter(p=>p.active!==false && (p.role==='volunteer'||p.role==='leader'));
  if (!pool.length){ console.log('  无可用同工'); return; }

  let ptr = cfg.rrPointer || 0;
  for (const doc of vis.docs){
    const v = doc.data();
    let vol = pool.find(p=>p.area && v.area && (v.area.includes(p.area)||p.area.includes(v.area)));
    if (!vol){ vol = pool[ptr % pool.length]; ptr++; }
    await doc.ref.update({
      assigneeId:vol.id, assigneeName:vol.name||vol.email,
      assignDate:new Date(), status:'跟进中', escalated:false
    });
    await sendMail(vol.email, `【关怀探访】本周请致电欢迎新朋友：${v.name}`,
`${vol.name||''} 弟兄姊妹，平安！

本周分配给您一位新朋友，请在本周三或周四致电，再次欢迎并鼓励他/她再来教会：

  姓名：${v.name}
  电话：${v.phone||'（未填）'}
  身份：${v.identity||'未知'}
  居住区域：${v.area||'（未填）'}
  首次来访：${v.firstVisit||''}
  备注：${v.note||'无'}

联系后请登录系统，在「我的待办」里点「填反馈」记录结果（很重要，否则周五会再次提醒并通知负责人）：
${cfg.appUrl}

愿主使用您成为祝福！
${cfg.churchName} · 关怀探访系统`);
  }
  await db.collection('config').doc('app').set({ rrPointer: ptr }, { merge:true });
  console.log(`  已分配 ${vis.size} 位`);
}

// ─────────────────────────────────────────────
// 周五：升级未跟进
// ─────────────────────────────────────────────
async function escalateUnfollowed(cfg){
  console.log('[升级] 检查未跟进…');
  const vis = await db.collection('visitors').where('status','==','跟进中').get();
  for (const doc of vis.docs){
    const v = doc.data();
    if (v.escalated) continue;
    const assignD = toDate(v.assignDate), lastC = toDate(v.lastContactDate);
    if (lastC && assignD && lastC >= assignD) continue; // 本轮已联系

    let email = null;
    if (v.assigneeId){
      const p = await db.collection('profiles').doc(v.assigneeId).get();
      if (p.exists) email = p.data().email;
    }
    if (email) await sendMail(email, `【再次提醒】新朋友 ${v.name} 尚未跟进`,
`${v.assigneeName||''} 平安！

本周分配给您的新朋友 ${v.name}（电话 ${v.phone||''}）系统里还没有您的联系反馈。
若已联系，请登录补填：${cfg.appUrl}
若本周未能联系，负责人将接手跟进。

${cfg.churchName} · 关怀探访系统`);

    if (cfg.careLeaderEmail) await sendMail(cfg.careLeaderEmail, `【需接手】${v.name} 本周未被跟进`,
`负责人您好：

新朋友 ${v.name}（电话 ${v.phone||''}，区域 ${v.area||'未填'}）本周分配给 ${v.assigneeName||'（未分配）'}，
但截至周五仍无联系反馈。请进一步跟踪，或亲自联系。

系统：${cfg.appUrl}

${cfg.churchName} · 关怀探访系统`);

    await doc.ref.update({ escalated:true });
  }
  console.log('  升级检查完成');
}

// ─────────────────────────────────────────────
// 每日：来访达标安排小组/福音群
// ─────────────────────────────────────────────
async function checkMilestones(cfg){
  console.log('[达标] 检查来访达标…');
  const goal = Number(cfg.goalVisits||4);
  const vis = await db.collection('visitors').where('visitCount','>=',goal).get();
  const groupsSnap = await db.collection('groups').get();
  const groups = groupsSnap.docs.map(d=>d.data());

  for (const doc of vis.docs){
    const v = doc.data();
    if (['已安排小组','福音群','失联'].includes(v.status)) continue;
    const identity = v.identity||'', area = v.area||'';

    if (identity.includes('基督徒')){
      const g = groups.find(g=>g.coverArea && area && (g.coverArea.includes(area)||area.includes(g.coverArea)));
      if (g && g.leaderEmail){
        await sendMail(g.leaderEmail, `【新组员】请接纳 ${v.name} 加入${g.name}`,
`${g.leaderName||''} 平安！

新朋友 ${v.name}（电话 ${v.phone||''}，区域 ${area}）已来教会 ${v.visitCount} 次，是基督徒，
按居住区域就近安排加入您带领的「${g.name}」。请与他/她联系，欢迎加入小组。

${cfg.churchName} · 关怀探访系统`);
      } else if (cfg.careLeaderEmail){
        await sendMail(cfg.careLeaderEmail, `【待手动安排小组】${v.name}`,
`新朋友 ${v.name}（区域 ${area||'未填'}）已达 ${v.visitCount} 次来访、是基督徒，但没有匹配到对口小组，请手动安排。

${cfg.churchName} · 关怀探访系统`);
      }
      await doc.ref.update({ status:'已安排小组' });
    } else if (identity.includes('慕道')){
      if (cfg.gospelLeaderEmail) await sendMail(cfg.gospelLeaderEmail, `【福音跟进】请接纳慕道友 ${v.name}`,
`福音事工负责人您好：

慕道友 ${v.name}（电话 ${v.phone||''}，区域 ${area||'未填'}）已来教会 ${v.visitCount} 次，
请加入福音聚会群并进一步跟踪。

${cfg.churchName} · 关怀探访系统`);
      await doc.ref.update({ status:'福音群' });
    } else {
      if (!v.milestoneNotified && cfg.careLeaderEmail){
        await sendMail(cfg.careLeaderEmail, `【请确认身份】${v.name} 已达标`,
`新朋友 ${v.name} 已来 ${v.visitCount} 次，但身份为「未知」，请确认是基督徒还是慕道友后再安排。

${cfg.churchName} · 关怀探访系统`);
        await doc.ref.update({ milestoneNotified:true });
      }
    }
  }
  console.log('  达标检查完成');
}

// ─────────────────────────────────────────────
// 每日：四周失联
// ─────────────────────────────────────────────
async function checkLostContact(cfg){
  console.log('[失联] 检查超期未联系…');
  const weeks = Number(cfg.lostWeeks||4), now = new Date();
  const vis = await db.collection('visitors').get();
  for (const doc of vis.docs){
    const v = doc.data();
    if (['已安排小组','福音群','失联'].includes(v.status)) continue;
    if (!v.firstVisit) continue;
    const days = (now - new Date(v.firstVisit)) / (1000*60*60*24);
    if (days < weeks*7) continue;
    if ((v.lastResult||'').includes('已联系')) continue;

    await doc.ref.update({ status:'失联' });
    if (cfg.careLeaderEmail) await sendMail(cfg.careLeaderEmail, `【转入失联】${v.name}`,
`新朋友 ${v.name}（电话 ${v.phone||''}）首次来访已满 ${weeks} 周仍未能成功联系，
系统已将其移入「失联名单」，不再自动联系。

${cfg.churchName} · 关怀探访系统`);
  }
  console.log('  失联检查完成');
}

// ─────────────────────────────────────────────
(async () => {
  const cfg = await getConfig();
  const task = (process.env.RUN_TASK || 'auto').toLowerCase();
  const wd = localWeekday();
  console.log(`运行开始 · 本地星期：${wd} · 任务：${task}`);

  const doDaily    = task==='auto' || task==='daily' || task==='all';
  const doAssign   = task==='assign' || task==='all' || (task==='auto' && wd==='Wednesday');
  const doEscalate = task==='escalate' || task==='all' || (task==='auto' && wd==='Friday');

  if (doAssign)   await assignNewVisitors(cfg);
  if (doEscalate) await escalateUnfollowed(cfg);
  if (doDaily){ await checkMilestones(cfg); await checkLostContact(cfg); }

  console.log('运行结束');
  process.exit(0);
})().catch(e => { console.error('运行出错：', e); process.exit(1); });
