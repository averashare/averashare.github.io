/* ============================================================
   secure.js — রোলভিত্তিক সুরক্ষা (সংস্করণ ৫.৫)
   Firebase Authentication (ইমেইল + পাসওয়ার্ড) + Firestore Rules দিয়ে সার্ভার-স্তরেই অ্যাডমিন/ম্যানেজার আলাদা করে।
   বন্ধ করতে নিচের SECURE_MODE = false করুন এবং Firebase Rules আগের (FIREBASE-RULES.txt-এর "ফেরত যাওয়ার নিয়ম") বসান।
   ============================================================ */
const SECURE_MODE = true;

(function(){
if(!SECURE_MODE) return;

const ROLES_COL = 'averamart_roles', META_COL = 'averamart_meta';
const SEC = {user:null, role:null, name:'', loginId:'', busy:false, attached:false};
const E = id => document.getElementById(id);
const TS = () => firebase.firestore.FieldValue.serverTimestamp();

/* ফোন নম্বরকে ভেতরে একটি নকল ইমেইলে রূপান্তর (ব্যবহারকারী শুধু ফোন নম্বর লেখে) */
function secEmails(id){
  if(id.includes('@')) return [id];
  const out = [id + '@phone.averamart.app'];
  for(let i=2;i<=6;i++) out.push(id + '.' + i + '@phone.averamart.app');
  return out;
}
function secMsg(t){ const el = E('loginError'); if(el) el.textContent = t || ''; }
function secErrText(e){
  const c = e && e.code || '';
  if(c==='auth/too-many-requests') return 'অনেকবার ভুল হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন।';
  if(c==='auth/network-request-failed') return 'ইন্টারনেট সংযোগ নেই — নেট ঠিক হলে আবার চেষ্টা করুন।';
  if(c==='auth/operation-not-allowed') return 'Firebase Console → Authentication → Sign-in method-এ "Email/Password" চালু করা হয়নি।';
  if(c==='auth/weak-password') return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।';
  if(c==='auth/invalid-email') return 'ইমেইলটি সঠিক নয়।';
  if(c==='permission-denied' || c==='firestore/permission-denied') return 'সার্ভার অনুমতি দেয়নি — Firebase Rules ঠিকমতো বসানো হয়েছে কিনা দেখুন।';
  return (e && e.message) || String(e);
}

/* ---------- সেশন (এই ডিভাইসে কে লগইন) — এখন Firebase থেকে আসে, localStorage থেকে নয় ---------- */
window.getSession = function(){ return SEC.role ? {role:SEC.role, v:0} : null; };
window.sessionValid = function(s){ return !!s && !!SEC.role; };
window.saveSession = function(){};
window.needsSetup = function(){ return false; };
window.saveUsers = function(){};
window.patchUser = function(){};
window.handleSetupLogin = function(){};

/* পুরোনো পাসওয়ার্ড-ডকুমেন্ট (users) আর পড়া হয় না */
const _listenDoc = window.listenDoc;
window.listenDoc = function(name){
  if(name==='users'){ LOADED.users = true; return; }
  return _listenDoc.apply(this, arguments);
};

/* ---------- Firebase চালু ---------- */
window.initFirebase = function(){
  try{ firebase.initializeApp(firebaseConfig); }catch(e){ /* আগেই চালু */ }
  db = firebase.firestore();
  firebase.auth().onAuthStateChanged(user => { if(SEC.busy) return; secAfterAuth(user); });
};

async function secAfterAuth(user){
  if(!user){ SEC.user = null; SEC.role = null; boot(); return; }
  if(user.isAnonymous){ try{ await firebase.auth().signOut(); }catch(e){} return; }   // পুরোনো বেনামি সেশন বন্ধ
  let snap = null;
  try{ snap = await db.collection(ROLES_COL).doc(user.uid).get(); }
  catch(e){ secMsg('অনুমতি যাচাই করা যায়নি: ' + secErrText(e)); try{ await firebase.auth().signOut(); }catch(_){} return; }
  const r = snap.exists ? snap.data() : null;
  if(!r || !['admin','manager'].includes(r.role)){
    try{ await firebase.auth().signOut(); }catch(e){}
    secMsg('এই অ্যাকাউন্টে অ্যাপ ব্যবহারের অনুমতি নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।');
    return;
  }
  SEC.user = user; SEC.role = r.role; SEC.name = r.name || ''; SEC.loginId = r.loginId || user.email || '';
  CACHE.users = {...CACHE.users, [r.role]: {...(CACHE.users[r.role]||{}), name:SEC.name, loginId:SEC.loginId}};
  secMsg('');
  if(!SEC.attached){ SEC.attached = true; attachListeners(); }
  boot();
}

window.boot = function(){
  const session = getSession(), L = E('loginScreen'), A = E('appShell');
  if(session && allLoaded()){
    L.classList.add('hidden'); A.classList.remove('hidden');
    go(NAV_ITEMS.find(i => i.roles.includes(session.role)).key);
  } else if(session){
    L.classList.remove('hidden'); A.classList.add('hidden');
    E('loginFormWrap').classList.add('hidden'); E('loginStatus').textContent = '☁️ ডেটা লোড হচ্ছে...';
  } else {
    L.classList.remove('hidden'); A.classList.add('hidden');
    E('loginFormWrap').classList.remove('hidden'); E('loginStatus').textContent = '';
  }
};

/* ---------- লগইন ---------- */
window.handleLogin = async function(){
  const btn = E('loginBtn');
  const id = normLoginId(E('loginId').value), pass = E('loginPass').value;
  if(!id || !pass){ secMsg('ইমেইল/ফোন নম্বর ও পাসওয়ার্ড দুটোই লিখুন।'); return; }
  if(!validLoginId(id)){ secMsg('সঠিক ইমেইল অথবা ১১ সংখ্যার মোবাইল নম্বর লিখুন।'); return; }
  if(btn) btn.disabled = true; secMsg(''); SEC.busy = true;
  const auth = firebase.auth(); let user = null, lastErr = null, noRole = false;
  try{
    for(const em of secEmails(id)){
      try{
        const cred = await auth.signInWithEmailAndPassword(em, pass);
        const rs = await db.collection(ROLES_COL).doc(cred.user.uid).get();
        if(rs.exists){ user = cred.user; break; }
        noRole = true; await auth.signOut();          // পুরোনো (রিসেটে বাতিল) অ্যাকাউন্ট — পরের নামটা চেষ্টা
      }catch(e){
        const c = e && e.code || '';
        if(['auth/invalid-credential','auth/wrong-password','auth/user-not-found','auth/invalid-login-credentials'].includes(c)) continue;
        lastErr = e; break;
      }
    }
  } finally { SEC.busy = false; if(btn) btn.disabled = false; }
  if(user){ E('loginPass').value = ''; await secAfterAuth(user); return; }
  if(lastErr) secMsg(secErrText(lastErr));
  else if(noRole) secMsg('এই অ্যাকাউন্টে অ্যাপ ব্যবহারের অনুমতি নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।');
  else secMsg('ইমেইল/ফোন নম্বর বা পাসওয়ার্ড ভুল।');
};
window.handleLogout = function(){
  firebase.auth().signOut().catch(()=>{}).then(() => location.reload());
};

window.secForgot = async function(){
  const v = prompt('আপনার ইমেইল লিখুন — পাসওয়ার্ড বদলানোর লিংক সেখানে যাবে:', normLoginId(E('loginId').value));
  if(!v) return; const id = normLoginId(v);
  if(!id.includes('@')){ alert('ফোন নম্বর দিয়ে খোলা অ্যাকাউন্টের পাসওয়ার্ড অ্যাডমিন সেটিংস থেকে রিসেট করে দেবেন।'); return; }
  try{ await firebase.auth().sendPasswordResetEmail(id); alert('✅ ইমেইলে পাসওয়ার্ড বদলানোর লিংক পাঠানো হয়েছে (না পেলে স্প্যাম ফোল্ডার দেখুন)।'); }
  catch(e){ alert(secErrText(e)); }
};

/* ---------- প্রথমবার সেটআপ (শুধু মালিক): প্রথম অ্যাডমিন তৈরি ---------- */
window.secToggleSetup = function(){ E('secSetupBox').classList.toggle('hidden'); };
window.secSetup = async function(){
  const g = id => (E(id)||{value:''}).value, msg = E('secSetupMsg'), btn = E('secSetupBtn');
  msg.style.color = ''; msg.textContent = '';
  const code = g('su_code').trim(), name = g('su_name').trim(), id = normLoginId(g('su_id')), p1 = g('su_p1'), p2 = g('su_p2');
  if(!code){ msg.textContent = 'সেটআপ কোড লিখুন (Firebase Rules-এ আপনার বসানো কোড)।'; return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)){ msg.textContent = 'অ্যাডমিনের জন্য আসল ইমেইল দিন (পাসওয়ার্ড ভুললে ইমেইলে লিংক যাবে)।'; return; }
  if(p1.length < 6){ msg.textContent = 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'; return; }
  if(p1 !== p2){ msg.textContent = 'দুটি পাসওয়ার্ড মিলছে না।'; return; }
  btn.disabled = true; msg.textContent = 'অ্যাডমিন অ্যাকাউন্ট তৈরি হচ্ছে...'; SEC.busy = true;
  const auth = firebase.auth(); let cred = null;
  try{
    cred = await auth.createUserWithEmailAndPassword(id, p1);
    const uid = cred.user.uid, batch = db.batch();
    batch.set(db.collection(META_COL).doc('setup'), {createdAt:TS(), setupCode:code, uid});
    batch.set(db.collection(ROLES_COL).doc(uid), {role:'admin', name, loginId:id, email:id, setupCode:code, createdAt:TS()});
    await batch.commit();
  }catch(e){
    if(cred && cred.user){ try{ await cred.user.delete(); }catch(_){ try{ await auth.signOut(); }catch(__){} } }
    SEC.busy = false; btn.disabled = false;
    const c = e && e.code || '';
    msg.textContent = c==='auth/email-already-in-use' ? 'এই ইমেইলে অ্যাকাউন্ট আগেই খোলা হয়েছে — সেটআপ আগে হয়ে থাকলে উপরে লগইন করুন।'
      : (c==='permission-denied' ? 'সেটআপ হয়নি: সেটআপ কোড ভুল, অথবা সেটআপ আগেই সম্পন্ন, অথবা Firebase Rules এখনো বসানো হয়নি।' : secErrText(e));
    return;
  }
  SEC.busy = false; btn.disabled = false;
  await secAfterAuth(auth.currentUser);
  alert('✅ অ্যাডমিন অ্যাকাউন্ট তৈরি হয়েছে।\n\nএখন সেটিংস → "ব্যবহারকারী ও পাসওয়ার্ড" থেকে ম্যানেজারের অ্যাকাউন্ট দিন। তারপর FIREBASE-RULES.txt-এর "ধাপ ৪ — চূড়ান্ত নিয়ম" বসান।');
};

/* ---------- অ্যাডমিন পাসওয়ার্ড নিশ্চিতকরণ / নিজের পাসওয়ার্ড বদল ---------- */
async function secReauth(pass){
  const u = firebase.auth().currentUser;
  if(!u || !u.email) throw new Error('লগইন নেই');
  await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, pass));
}
window.confirmAdminPassword = async function(note){
  if(!isAdmin()) return false;
  const p = await askPassword('অ্যাডমিন পাসওয়ার্ড দিন', note);
  if(p===null) return false;
  try{ await secReauth(p); return true; }
  catch(e){ alert(e.code==='auth/too-many-requests' ? secErrText(e) : 'ভুল পাসওয়ার্ড — কিছু বদলানো হয়নি।'); return false; }
};
window.openChangePassword = function(){
  if(!getSession()) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(10,20,35,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML = `<div class="panel" style="max-width:380px;width:100%;margin:0;"><h3>🔑 পাসওয়ার্ড বদলান</h3>
    <div class="form-field"><label>বর্তমান পাসওয়ার্ড</label><input type="password" id="cp_old" autocomplete="current-password"></div>
    <div class="form-field" style="margin-top:10px;"><label>নতুন পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)</label><input type="password" id="cp_new" autocomplete="new-password"></div>
    <div class="form-field" style="margin-top:10px;"><label>নতুন পাসওয়ার্ড আবার</label><input type="password" id="cp_new2" autocomplete="new-password"></div>
    <p class="error-text" id="cp_err"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;"><button class="btn btn-outline btn-sm" id="cp_no">বাতিল</button><button class="btn btn-primary btn-sm" id="cp_yes">বদলান</button></div></div>`;
  document.body.appendChild(ov);
  const q = id => ov.querySelector('#'+id), err = q('cp_err');
  q('cp_no').onclick = () => ov.remove();
  q('cp_yes').onclick = async () => {
    const o = q('cp_old').value, n = q('cp_new').value, n2 = q('cp_new2').value;
    if(!o || !n){ err.textContent = 'সব ঘর পূরণ করুন।'; return; }
    if(n.length < 6){ err.textContent = 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'; return; }
    if(n !== n2){ err.textContent = 'নতুন পাসওয়ার্ড দুটি মিলছে না।'; return; }
    q('cp_yes').disabled = true;
    try{
      await secReauth(o);
      await firebase.auth().currentUser.updatePassword(n);
      ov.remove(); alert('✅ পাসওয়ার্ড বদলানো হয়েছে।');
    }catch(e){
      const bad = ['auth/wrong-password','auth/invalid-credential','auth/invalid-login-credentials'].includes(e && e.code);
      err.textContent = bad ? 'বর্তমান পাসওয়ার্ড ভুল।' : secErrText(e); q('cp_yes').disabled = false;
    }
  };
  setTimeout(() => q('cp_old').focus(), 50);
};

/* ---------- সেটিংস → ব্যবহারকারী ও পাসওয়ার্ড (শুধু অ্যাডমিন) ---------- */
window.usersPanelHtml = function(){
  setTimeout(secLoadManagers, 60);
  return `
    <div class="panel" id="usersPanel">
      <h3>ব্যবহারকারী ও পাসওয়ার্ড</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">লগইন এখন Firebase-এর নিরাপদ অ্যাকাউন্টে। রোল (অ্যাডমিন/ম্যানেজার) সার্ভারই যাচাই করে — অ্যাপ ছাড়া সরাসরি ডেটাবেজে ঢুকেও ম্যানেজার অ্যাডমিনের কাজ করতে পারে না।</p>
      <h4>👤 অ্যাডমিন (আপনি)</h4>
      <div class="form-grid">
        <div class="form-field"><label>নাম</label><input id="u_a_name" value="${esc(SEC.name)}"></div>
        <div class="form-field"><label>লগইন ইমেইল</label><input value="${esc(SEC.loginId)}" disabled></div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="secSaveAdminName()">💾 নাম সংরক্ষণ</button>
      <p style="font-size:12.5px;color:var(--text-muted);margin:8px 0 0;">পাসওয়ার্ড বদলাতে সাইডবারের "🔑 পাসওয়ার্ড" বাটন চাপুন। ভুলে গেলে লগইন পেইজে "পাসওয়ার্ড ভুলে গেছেন?" থেকে ইমেইলে লিংক নিন।</p>
      <hr style="border:none;border-top:1px solid var(--border);margin:18px 0;">
      <h4>🧑‍💼 ম্যানেজার</h4>
      <div id="secMgrBox"><span class="muted-cell">লোড হচ্ছে...</span></div>
      <div class="form-grid" style="margin-top:10px;">
        <div class="form-field"><label>নাম</label><input id="u_m_name"></div>
        <div class="form-field"><label>ইমেইল / মোবাইল নম্বর (লগইন)</label><input id="u_m_id" placeholder="name@gmail.com অথবা 01XXXXXXXXX" autocapitalize="none"></div>
        <div class="form-field span-2"><label>পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)</label>
          <div style="display:flex;gap:6px;"><input id="u_m_new" type="password" autocomplete="new-password" style="flex:1;"><button class="btn btn-outline btn-sm" type="button" onclick="fillRandomPass('u_m_new')">🎲 বানিয়ে দিন</button></div></div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="secSaveManager()">➕ ম্যানেজারের অ্যাকাউন্ট তৈরি / নতুন পাসওয়ার্ডসহ বদলান</button>
      <div class="flash warn" style="margin-top:14px;font-size:13px;">
        <b>ম্যানেজার পাসওয়ার্ড ভুলে গেলে:</b> ইমেইলওয়ালা ম্যানেজারকে উপরের "রিসেট ইমেইল পাঠান" চাপুন (সে ইমেইলে লিংক পাবে)। মোবাইল নম্বরওয়ালা হলে একই নম্বর ও নতুন পাসওয়ার্ড দিয়ে উপরের নীল বাটন চাপুন — পুরোনো অ্যাকাউন্ট বন্ধ হয়ে নতুনটা চালু হবে।
      </div>
    </div>`;
};
window.secSaveAdminName = async function(){
  const name = (E('u_a_name')||{value:''}).value.trim();
  try{ await db.collection(ROLES_COL).doc(SEC.user.uid).update({name}); SEC.name = name; CACHE.users.admin = {...(CACHE.users.admin||{}), name}; renderNav(); alert('✅ সংরক্ষিত হয়েছে।'); }
  catch(e){ alert(secErrText(e)); }
};
window.secLoadManagers = async function(){
  const box = E('secMgrBox'); if(!box || !isAdmin()) return;
  try{
    const snap = await db.collection(ROLES_COL).where('role','==','manager').get();
    if(snap.empty){ box.innerHTML = '<span class="badge badge-pending">ম্যানেজারের অ্যাকাউন্ট নেই</span>'; return; }
    box.innerHTML = snap.docs.map(d => { const x = d.data(), real = (x.email||'').indexOf('@phone.averamart.app') < 0;
      return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
        <span class="badge badge-open">লগইন চালু</span>
        <span style="flex:1;min-width:140px;"><b>${esc(x.name||'—')}</b> · ${esc(x.loginId||x.email||'')}</span>
        ${real ? `<button class="btn btn-outline btn-sm" onclick="secResetMail('${esc(x.email)}')">📧 রিসেট ইমেইল পাঠান</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="secDisableManager('${d.id}')">🚫 লগইন বন্ধ করুন</button></div>`; }).join('');
  }catch(e){ box.innerHTML = '<span class="error-text">তালিকা আনা যায়নি: ' + esc(secErrText(e)) + '</span>'; }
};
window.secResetMail = async function(em){
  if(!confirm(em + ' ঠিকানায় পাসওয়ার্ড রিসেটের লিংক পাঠানো হবে। এগোবেন?')) return;
  try{ await firebase.auth().sendPasswordResetEmail(em); alert('✅ ইমেইল পাঠানো হয়েছে।'); }catch(e){ alert(secErrText(e)); }
};
window.secDisableManager = async function(uid){
  if(!confirm('ম্যানেজারের লগইন বন্ধ করবেন? সে আর ডেটা দেখতে বা বদলাতে পারবে না (পরে নতুন করে অ্যাকাউন্ট দিতে পারবেন)।')) return;
  if(!(await confirmAdminPassword('ম্যানেজারের লগইন বন্ধ করতে নিজের অ্যাডমিন পাসওয়ার্ড দিন।'))) return;
  try{ await db.collection(ROLES_COL).doc(uid).delete(); alert('✅ ম্যানেজারের লগইন বন্ধ হয়েছে।'); secLoadManagers(); }catch(e){ alert(secErrText(e)); }
};
window.secSaveManager = async function(){
  if(!isAdmin()) return;
  const g = id => (E(id)||{value:''}).value, name = g('u_m_name').trim(), id = normLoginId(g('u_m_id')), pass = g('u_m_new');
  if(!validLoginId(id)){ alert('সঠিক ইমেইল (যেমন name@gmail.com) অথবা ১১ সংখ্যার মোবাইল নম্বর লিখুন।'); return; }
  if(pass.length < 6){ alert('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return; }
  if(id === normLoginId(SEC.loginId)){ alert('অ্যাডমিনের ইমেইলই ম্যানেজারের জন্য দেওয়া যাবে না — আলাদা দিন।'); return; }
  if(!(await confirmAdminPassword('ম্যানেজারের অ্যাকাউন্ট তৈরি/বদল করতে নিজের অ্যাডমিন পাসওয়ার্ড দিন।'))) return;
  let app2 = null;
  try{
    app2 = firebase.initializeApp(firebaseConfig, 'sec2-' + Date.now());     // আলাদা সংযোগ — অ্যাডমিনের লগইন অক্ষত থাকে
    const a2 = app2.auth(); let made = null, madeEmail = '';
    for(const em of secEmails(id)){
      try{ made = await a2.createUserWithEmailAndPassword(em, pass); madeEmail = em; break; }
      catch(e){
        if(e && e.code==='auth/email-already-in-use'){
          if(id.includes('@')) throw new Error('এই ইমেইলে অ্যাকাউন্ট আগেই আছে। পাসওয়ার্ড রিসেট করতে ম্যানেজারের পাশের "📧 রিসেট ইমেইল পাঠান" ব্যবহার করুন।');
          continue;
        }
        throw e;
      }
    }
    if(!made) throw new Error('নতুন অ্যাকাউন্ট খোলা যায়নি।');
    const uid = made.user.uid;
    const old = await db.collection(ROLES_COL).where('role','==','manager').get();
    await db.collection(ROLES_COL).doc(uid).set({role:'manager', name, loginId:id, email:madeEmail, createdAt:TS(), createdBy:SEC.user.uid});
    await Promise.all(old.docs.filter(d => d.id !== uid).map(d => d.ref.delete()));   // আগের ম্যানেজারের অ্যাকাউন্ট বন্ধ
    try{ await a2.signOut(); }catch(e){}
    alert(`✅ ম্যানেজারের অ্যাকাউন্ট তৈরি হয়েছে।\n\nলগইন: ${id}\nপাসওয়ার্ড: ${pass}\n\nএটি ম্যানেজারকে জানান। আগের ম্যানেজার অ্যাকাউন্ট (থাকলে) বন্ধ হয়ে গেছে।`);
    renderSettings();
  }catch(e){ alert(secErrText(e)); }
  finally{ if(app2) app2.delete().catch(()=>{}); }
};

/* ---------- লগইন পেইজের চেহারা ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const wrap = E('loginFormWrap'); if(!wrap) return;
  wrap.innerHTML = `
    <div class="field-group"><label>ইমেইল অথবা মোবাইল নম্বর</label>
      <input type="text" id="loginId" placeholder="name@gmail.com অথবা 01XXXXXXXXX" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div class="field-group"><label>পাসওয়ার্ড</label>
      <input type="password" id="loginPass" placeholder="আপনার পাসওয়ার্ড" autocomplete="current-password" onkeydown="if(event.key==='Enter')handleLogin()"></div>
    <button id="loginBtn" class="btn btn-primary btn-block" onclick="handleLogin()">প্রবেশ করুন</button>
    <p style="margin:10px 0 0;font-size:13px;"><a href="#" onclick="secForgot();return false;">পাসওয়ার্ড ভুলে গেছেন?</a></p>
`;
  const st = E('loginStatus'); if(st) st.textContent = '';
});
})();
