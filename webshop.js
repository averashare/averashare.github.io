/* ============================================================
   webshop.js — অনলাইন দোকান (অ্যাডমিন/ম্যানেজারের দিক)  ·  সংস্করণ ৫.৮
   ১) পণ্য ও দোকানের তথ্য "পাবলিক কপি" হিসেবে averamart_public/shop-এ সিঙ্ক হয় (ক্রয়মূল্য/লাভ/ন্যূনতম স্টক কখনো যায় না)
   ২) কাস্টমারের অর্ডার averamart_weborders-এ আসে → "ওয়েব অর্ডার" পেইজ থেকে এক ক্লিকে সাধারণ অর্ডারে রূপান্তর
   app.js ও secure.js-এর পরে লোড হয়; সরিয়ে দিলে আগের অ্যাপ হুবহু আগের মতোই চলে।
   ============================================================ */
(function(){
'use strict';
const COL = 'averamart_weborders', PUB = 'averamart_public', PUB_IMG = 'averamart_public_img';
const WS = {orders:[], first:true, unsub:null, pubIv:null, timer:null, filter:'new', lastSync:0, syncErr:'', busy:false};
const E = id => document.getElementById(id);
const TS = () => firebase.firestore.FieldValue.serverTimestamp();
const r2 = n => Math.round(Number(n||0)*100)/100;

/* ---------- মেনু ---------- */
(function addNav(){
  const i = NAV_ITEMS.findIndex(x => x.key==='orders');
  NAV_ITEMS.splice(i+1, 0, {key:'weborders', label:'ওয়েব অর্ডার', icon:'🌐', roles:['admin','manager']});
  const j = NAV_ITEMS.findIndex(x => x.key==='settings');
  NAV_ITEMS.splice(j<0 ? NAV_ITEMS.length : j, 0, {key:'webshop', label:'অনলাইন দোকান', icon:'🏪', roles:['admin']});
})();

/* ---------- দোকানের সেটিংস ---------- */
function shopCfg(){
  const st = CACHE.settings || {}, digits = String(st.phone||'').replace(/\D/g,'');
  return Object.assign({
    enabled:false, setup:false,
    heroTitle:'ঘরে বসে নিরাপদ ও বিশুদ্ধ পণ্য',
    heroText:'প্রকৃতির ছোঁয়া, নিরাপদ আস্থা — বাছাই করা অর্গানিক ও নিত্যপ্রয়োজনীয় পণ্য, ক্যাশ অন ডেলিভারিতে আপনার দরজায়।',
    phone1: st.phone||'', phone2:'', whatsapp: digits ? ('88' + digits.replace(/^88/,'').replace(/^0?/,'0')) : '',
    facebook:'', localArea:'রাজশাহী', deliveryLocal:0, deliveryOutside:0, freeDeliveryMin:0, minOrder:0,
    codNote:'পণ্য হাতে পেয়ে টাকা পরিশোধ করুন', showHidden:false,
    strip1t:'', strip1d:'', strip2t:'', strip2d:'', strip3t:'', strip3d:'',
    howTitle:'', how1t:'', how1d:'', how2t:'', how2d:'', how3t:'', how3d:''
  }, st.shop || {});
}
function shopUrl(){ try{ return new URL('shop.html', location.href).href; }catch(e){ return 'shop.html'; } }

/* ---------- পাবলিক কপি তৈরি ও সিঙ্ক ---------- */
function wsLot(p){
  const b = Number(p.priceBasis)||1;
  if(b!==1) return b;                                   // যেমন ৫ কেজির প্যাক → একবারে ৫ কেজি
  if(parsePackUnit(p.unit)) return 1;                   // "৫০০ গ্রাম" লেখা একক → একবারে ১ প্যাক
  return (p.unit==='কেজি' || p.unit==='লিটার') ? 0.5 : 1;
}
function wsItem(p){
  const it = {id:p.id, n:p.name, c:p.category||'', u:p.unit||'কেজি', pr:Number(p.retail)||0, b:Number(p.priceBasis)||1, lot:wsLot(p), s:Math.max(0, r3(p.stock)), d:String(p.webDesc||'')};
  if(p.hasImg){ it.hi = 1; it.iv = p.imgV || 0; }
  return it;
}
function wsIncluded(){ const sh = (CACHE.settings && CACHE.settings.shop) || {}; return CACHE.products.filter(p => p.web && (sh.showHidden || !p.hidden) && Number(p.retail)>0); }
async function wsThumb(pid, v){
  const snap = await docRef('img__'+pid).get();
  if(!snap.exists) return null;
  const img = await lfLoadImage(snap.data().data); if(!img) return null;
  const sc = Math.min(1, 480/Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.naturalWidth*sc)); cv.height = Math.max(1, Math.round(img.naturalHeight*sc));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  let d = cv.toDataURL('image/webp', 0.8); if(!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', 0.82);
  return d;
}
async function wsPublish(manual){
  if(typeof db==='undefined' || !db || !getSession() || WS.busy) return;
  const sh = shopCfg();
  if(!sh.setup && !manual) return;                      // অ্যাডমিন একবার সেটআপ না করলে নিজে থেকে কিছু প্রকাশ হয় না
  WS.busy = true; WS.syncErr = '';
  try{
    if(!WS.pubIv){
      WS.pubIv = {};
      try{ const s = await db.collection(PUB).doc('shop').get(); if(s.exists) (s.data().items||[]).forEach(x => { if(x.hi) WS.pubIv[x.id] = x.iv; }); }catch(e){}
    }
    const items = wsIncluded().map(wsItem);
    for(const it of items){
      if(!it.hi || WS.pubIv[it.id]===it.iv) continue;
      try{ const d = await wsThumb(it.id, it.iv); if(d){ await db.collection(PUB_IMG).doc(it.id).set({data:d, v:it.iv}); WS.pubIv[it.id] = it.iv; } else { delete it.hi; delete it.iv; } }
      catch(e){ delete it.hi; delete it.iv; }
    }
    const st = CACHE.settings;
    const pub = {
      shop:{enabled:!!sh.enabled, name:'Avera Mart', tagline:st.tagline||'', address:st.businessAddress||'', heroTitle:sh.heroTitle, heroText:sh.heroText,
        phone1:sh.phone1, phone2:sh.phone2, whatsapp:String(sh.whatsapp||'').replace(/\D/g,''), facebook:sh.facebook, localArea:sh.localArea,
        deliveryLocal:Number(sh.deliveryLocal)||0, deliveryOutside:Number(sh.deliveryOutside)||0, freeDeliveryMin:Number(sh.freeDeliveryMin)||0, minOrder:Number(sh.minOrder)||0, codNote:sh.codNote,
        strip1t:sh.strip1t||'', strip1d:sh.strip1d||'', strip2t:sh.strip2t||'', strip2d:sh.strip2d||'', strip3t:sh.strip3t||'', strip3d:sh.strip3d||'',
        howTitle:sh.howTitle||'', how1t:sh.how1t||'', how1d:sh.how1d||'', how2t:sh.how2t||'', how2d:sh.how2d||'', how3t:sh.how3t||'', how3d:sh.how3d||''},
      items, updatedAt:Date.now()
    };
    if(JSON.stringify(pub).length > 900000) throw new Error('পণ্য তালিকা Firebase-এর ১ MB সীমার কাছে পৌঁছে গেছে — কিছু পণ্য অনলাইন থেকে সরান।');
    await db.collection(PUB).doc('shop').set(pub);
    WS.lastSync = Date.now();
  }catch(e){ WS.syncErr = (e && e.message) || String(e); }
  WS.busy = false;
  if(currentPage==='webshop' && E('wsStatus')) E('wsStatus').innerHTML = syncStatusHtml();
}
function wsSchedule(){ clearTimeout(WS.timer); WS.timer = setTimeout(() => wsPublish(false), 2500); }

/* পণ্য বদলালেই (স্টক/দাম/নাম) পাবলিক কপি নিজে থেকে হালনাগাদ */
const _saveCollection = window.saveCollection;
window.saveCollection = function(name){
  const r = _saveCollection.apply(this, arguments);
  if(name==='products' && r!==false) wsSchedule();
  return r;
};

/* ---------- ওয়েব অর্ডার শোনা ---------- */
const _attach = window.attachListeners;
window.attachListeners = function(){ _attach.apply(this, arguments); startOrders(); };
function startOrders(){
  if(WS.unsub) return;
  WS.unsub = db.collection(COL).orderBy('createdAt','desc').limit(300).onSnapshot(snap => {
    const added = WS.first ? [] : snap.docChanges().filter(c => c.type==='added' && !c.doc.metadata.hasPendingWrites && (c.doc.data().status==='new'));
    WS.orders = snap.docs.map(d => Object.assign({id:d.id}, d.data()));
    WS.first = false;
    wsBadge();
    if(added.length) notifyNew(added.length);
    if(currentPage==='weborders'){ const mh = E('modalHolder'); if(!(mh && mh.innerHTML.trim())) renderWebOrders(); }
    if(currentPage==='dashboard') injectDashBanner();
  }, err => { WS.err = err && err.message || ''; });
}
function newCount(){ return WS.orders.filter(o => o.status==='new').length; }
function wsBadge(){
  const n = newCount();
  document.querySelectorAll('#sideNav .nav-item').forEach(b => {
    if(!(b.getAttribute('onclick')||'').includes("'weborders'")) return;
    const old = b.querySelector('.ws-badge'); if(old) old.remove();
    if(n>0){ const s = document.createElement('span'); s.className = 'ws-badge'; s.textContent = n;
      s.style.cssText = 'background:#C0392B;color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 6px;font-size:12px;display:inline-grid;place-items:center;margin-inline:6px;'; b.firstElementChild.after(s); }
  });
}
const _renderNav = window.renderNav;
window.renderNav = function(){ _renderNav.apply(this, arguments); wsBadge(); };
let toastEl = null;
function notifyNew(n){
  try{ const A = window.AudioContext || window.webkitAudioContext; if(A){ const c = new A(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = .08; o.start(); setTimeout(() => { o.stop(); c.close(); }, 350); } }catch(e){}
  if(!toastEl){ toastEl = document.createElement('div'); toastEl.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:14px;z-index:99999;background:#123C69;color:#fff;padding:10px 16px;border-radius:12px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer;max-width:92vw;text-align:center;'; toastEl.onclick = () => { toastEl.style.display='none'; go('weborders'); }; document.body.appendChild(toastEl); }
  toastEl.textContent = `🌐 ${n}টি নতুন ওয়েব অর্ডার এসেছে — দেখতে ট্যাপ করুন`; toastEl.style.display = 'block';
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, 9000);
}
function injectDashBanner(){
  const pc = E('pageContent'); if(!pc || E('wsDashBanner')) return;
  const n = newCount(); if(!n) return;
  pc.insertAdjacentHTML('afterbegin', `<div id="wsDashBanner" class="flash" style="cursor:pointer;" onclick="go('weborders')">🌐 <b>${n}টি নতুন ওয়েব অর্ডার</b> অপেক্ষায় আছে — দেখতে এখানে ট্যাপ করুন।</div>`);
}
const _renderDashboard = window.renderDashboard;
window.renderDashboard = function(){ _renderDashboard.apply(this, arguments); injectDashBanner(); };

/* ---------- ওয়েব অর্ডার পেইজ ---------- */
function fmtWhen(o){ try{ const d = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null; return d ? fmtDT(d.toISOString()) : 'এইমাত্র'; }catch(e){ return ''; } }
function phoneWa(ph){ return '88' + String(ph||'').replace(/\D/g,'').replace(/^88/,''); }
function checkOrder(w){
  const issues = [];
  (w.items||[]).forEach(wi => {
    const p = CACHE.products.find(x => x.id===wi.pid);
    if(!p){ issues.push(`${wi.name}: পণ্যটি এখন তালিকায় নেই`); return; }
    if(Math.abs((Number(p.retail)||0) - Number(wi.price)) > 0.0001) issues.push(`${wi.name}: দাম বদলেছে (কাস্টমার দেখেছে ${money(wi.price)}, এখন ${money(p.retail)} প্রতি ${p.unit||'কেজি'}) — রূপান্তরে এখনকার দাম বসবে`);
    if(Number(p.stock) < Number(wi.qty)) issues.push(`${wi.name}: স্টকে আছে ${fmtStock(p.stock,p)}, চেয়েছে ${wi.qty} ${wi.unit||''}`);
  });
  return issues;
}
function orderCard(w){
  const st = w.status;
  const badge = st==='new' ? '<span class="badge badge-pending">নতুন</span>' : st==='imported' ? `<span class="badge badge-delivered">অর্ডারে নেওয়া হয়েছে${w.orderId?' · '+esc(w.orderId):''}</span>` : '<span class="badge badge-cancelled">বাতিল</span>';
  const issues = st==='new' ? checkOrder(w) : [];
  const lines = (w.items||[]).map(it => `<tr><td>${esc(it.name)}</td><td>${esc(it.qty)} ${esc(it.unit||'')}</td><td class="cell-num">${money(it.line)}</td></tr>`).join('');
  return `<div class="panel" style="${st==='new'?'border-left:4px solid var(--amber);':''}">
    <div class="panel-head"><h3 style="margin:0;">${esc(w.id)} ${badge}</h3><span class="muted-cell">${fmtWhen(w)}</span></div>
    <p style="margin:6px 0;"><b>${esc(w.customerName)}</b> · <a href="tel:${esc(w.phone)}">${esc(w.phone)}</a><br><span class="muted-cell">${esc(w.address)}</span>${w.note?`<br>📝 <span class="muted-cell">${esc(w.note)}</span>`:''}
      <br><span class="muted-cell">এলাকা: ${w.area==='outside'?'অন্য জেলা':'স্থানীয়'} · পেমেন্ট: ক্যাশ অন ডেলিভারি</span></p>
    <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>টাকা</th></tr></thead><tbody>${lines}
      <tr><td colspan="2" style="text-align:right;">পণ্যের দাম</td><td class="cell-num">${money(w.subtotal)}</td></tr>
      <tr><td colspan="2" style="text-align:right;">ডেলিভারি ${w.deliveryTbd?'(কাস্টমারকে জানানো হয়নি — ঠিক করুন)':''}</td><td class="cell-num">${w.deliveryTbd?'—':money(w.delivery)}</td></tr>
      <tr><td colspan="2" style="text-align:right;"><b>মোট</b></td><td class="cell-num">${money(Number(w.subtotal||0)+(w.deliveryTbd?0:Number(w.delivery||0)))}</td></tr></tbody></table></div>
    ${issues.length ? `<div class="flash" style="margin-top:10px;background:#FFF4D6;">⚠️ <b>দেখে নিন:</b><br>${issues.map(esc).join('<br>')}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <a class="btn btn-outline btn-sm" href="tel:${esc(w.phone)}">📞 কল</a>
      <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phoneWa(w.phone)}?text=${encodeURIComponent('আসসালামু আলাইকুম, আপনার অর্ডার ('+w.id+') পেয়েছি। কনফার্ম করার জন্য যোগাযোগ করছি।')}">💬 WhatsApp</a>
      ${st==='new' ? `<button class="btn btn-accent btn-sm" onclick="wsImport('${esc(w.id)}')">✅ অর্ডারে গ্রহণ করুন</button><button class="btn btn-sm btn-danger" onclick="wsCancel('${esc(w.id)}')">❌ বাতিল</button>` : ''}
    </div></div>`;
}
window.renderWebOrders = function(){
  const f = WS.filter, list = WS.orders.filter(o => f==='all' || o.status==='new');
  E('pageContent').innerHTML = `
    <div class="panel"><div class="panel-head"><h3>ওয়েব অর্ডার (শপ পেইজ থেকে)</h3>
      <select onchange="WS_setFilter(this.value)"><option value="new" ${f==='new'?'selected':''}>শুধু নতুন (${newCount()})</option><option value="all" ${f==='all'?'selected':''}>সব (সর্বশেষ ৩০০টি)</option></select></div>
      <p class="muted-cell" style="margin:0;">কাস্টমার শপ পেইজে অর্ডার করলে এখানে আসে। ফোনে কনফার্ম করে "অর্ডারে গ্রহণ করুন" চাপলে সেটা সাধারণ অর্ডার (পেন্ডিং, বাকি) হয়ে যায় — এরপর আগের মতোই ডেলিভারড করলে স্টক কমবে।</p></div>
    ${list.length ? list.map(orderCard).join('') : '<div class="panel"><div class="empty-state">এখন কোনো নতুন ওয়েব অর্ডার নেই</div></div>'}
    <div id="modalHolder"></div>`;
};
window.WS_setFilter = v => { WS.filter = v; renderWebOrders(); };
window.wsImport = function(id){
  const w = WS.orders.find(x => x.id===id); if(!w || w.status!=='new') return;
  if(!guardDate(todayStr(), 'এন্ট্রি')) return;
  const items = [];
  (w.items||[]).forEach(wi => {
    const p = CACHE.products.find(x => x.id===wi.pid); if(!p) return;
    const qty = Number(wi.qty), unitPrice = Number(p.retail)||0;
    if(!(qty>0) || !(unitPrice>0)) return;
    items.push({productId:p.id, qty, unitPrice, standardPrice:unitPrice, lineDiscount:0, discType:'amt', discVal:0, lineSurcharge:0, surType:'amt', surVal:0, pl:'retail', dq:qty, du:p.unit||'কেজি'});
  });
  if(!items.length){ alert('এই অর্ডারের কোনো পণ্য এখন তালিকায় নেই — অর্ডারে নেওয়া গেল না। কাস্টমারকে ফোন করে বাতিল করুন বা হাতে নতুন অর্ডার দিন।'); return; }
  const issues = checkOrder(w);
  const dropped = (w.items||[]).length - items.length;
  if(!confirm(`${w.customerName}-এর অর্ডারটি সাধারণ অর্ডারে নেবেন?` + (dropped?`\n\n⚠️ ${dropped}টি পণ্য তালিকায় না থাকায় বাদ যাবে।`:'') + (issues.length?`\n\nসতর্কতা:\n- `+issues.join('\n- '):''))) return;
  const orders = CACHE.orders.slice();
  const subtotal = items.reduce((s,it) => s + lineAmt(it), 0);
  const delivery = w.deliveryTbd ? 0 : (Number(w.delivery)||0);
  const order = {
    id: genId('ORD-', orders), date: todayStr(), customerName: w.customerName, phone: w.phone, shareholderId:'',
    address: w.address + (w.note ? ' (নোট: ' + w.note + ')' : ''), items, discount:0, priceList:'retail',
    total: Math.max(0, r2(subtotal + delivery)), deliveryCharge: delivery, source:'Website',
    paymentStatus:'Due', paidAmount:0, paymentMethod:'Cash', transactionRef:'', status:'Pending', webOrderId: w.id
  };
  orders.push(order);
  if(!saveCollection('orders', orders)) return;
  db.collection(COL).doc(id).update({status:'imported', orderId:order.id, handledBy:(getSession()||{}).role||'', handledAt:TS()})
    .catch(e => alert('⚠️ অর্ডার তৈরি হয়েছে (' + order.id + ') কিন্তু ওয়েব অর্ডারের অবস্থা বদলানো যায়নি: ' + (e.message||e) + '\nআবার "গ্রহণ করুন" চাপবেন না — নইলে দুটি অর্ডার হয়ে যাবে।'));
  if(order.deliveryCharge===0 && w.deliveryTbd) alert('ডেলিভারি চার্জ কাস্টমারকে জানানো হয়নি, তাই ০ বসেছে। দরকার হলে অর্ডার সংশোধন করে চার্জ দিন (' + order.id + ')।');
  setFlash('orders', `✅ ওয়েব অর্ডার <b>${esc(w.id)}</b> এখন অর্ডার <b>${order.id}</b> (পেন্ডিং)। ডেলিভারড করলে স্টক কমবে।`, order.id);
  go('orders');
};
window.wsCancel = function(id){
  const w = WS.orders.find(x => x.id===id); if(!w || w.status!=='new') return;
  if(!confirm(`${w.customerName}-এর অর্ডার (${id}) বাতিল করবেন?`)) return;
  db.collection(COL).doc(id).update({status:'cancelled', handledBy:(getSession()||{}).role||'', handledAt:TS()}).catch(e => alert('বাতিল করা যায়নি: ' + (e.message||e)));
};

/* ---------- অনলাইন দোকান (সেটিংস ও পণ্য বাছাই) — শুধু অ্যাডমিন ---------- */
function syncStatusHtml(){
  if(WS.busy) return '⏳ সিঙ্ক হচ্ছে...';
  if(WS.syncErr) return `<span style="color:var(--red);">⚠️ সিঙ্ক হয়নি: ${esc(WS.syncErr)}<br>Firebase Rules-এ নতুন নিয়ম (FIREBASE-RULES-SHOP.txt) বসানো হয়েছে কিনা দেখুন।</span>`;
  return WS.lastSync ? '✅ সর্বশেষ সিঙ্ক: ' + fmtDT(new Date(WS.lastSync).toISOString()) : 'এই সেশনে এখনো সিঙ্ক হয়নি';
}
function prodRow(p){
  const n = wsIncluded().some(x => x.id===p.id);
  return `<tr style="${p.hidden?'opacity:.6;':''}">
    <td><input type="checkbox" ${p.web?'checked':''} onchange="wsToggle('${p.id}',this.checked)" title="অনলাইনে দেখাবে"></td>
    <td>${esc(p.name)}<br><span class="muted-cell" style="font-size:11.5px;">${p.id} · ${esc(p.category||'')}${p.hidden?' · <b>লুকানো পণ্য</b>':''}${p.web && !p.hidden && !(Number(p.retail)>0)?' · <b style="color:var(--red)">বিক্রয়মূল্য নেই</b>':''}</span></td>
    <td class="cell-num">${money(packPrice(p,'retail'))}<br><span class="muted-cell" style="font-size:11.5px;">/ ${fmtBasis(p)||('১ '+esc(p.unit||'কেজি'))}</span></td>
    <td>${fmtStock(p.stock,p)}</td>
    <td><input value="${esc(p.webDesc||'')}" maxlength="120" placeholder="ছোট বর্ণনা (ঐচ্ছিক)" style="width:100%;min-width:150px;padding:6px;border:1px solid var(--border);border-radius:7px;" onchange="wsDesc('${p.id}',this.value)"></td>
    <td>${p.hasImg?'🖼️ আছে':'<span class="muted-cell">নেই</span>'}<br><label class="btn btn-outline btn-sm" style="margin-top:4px;cursor:pointer;">${p.hasImg?'বদলান':'ছবি দিন'}<input type="file" accept="image/*" class="hidden" onchange="wsUploadImg('${p.id}',this)"></label></td>
  </tr>`;
}
window.renderWebShop = function(){
  const c = shopCfg(), inc = wsIncluded().length;
  const fld = (id, label, val, ph, type) => `<div class="form-field"><label>${label}</label><input id="${id}" type="${type||'text'}" ${type==='number'?'min="0" step="any"':''} value="${esc(val)}" placeholder="${esc(ph||'')}"></div>`;
  E('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>🏪 অনলাইন দোকান</h3></div>
      <p style="margin:0 0 10px;">কাস্টমারের জন্য আলাদা পেইজ — লগইন ছাড়াই পণ্য দেখে কার্ট থেকে ক্যাশ অন ডেলিভারিতে অর্ডার করা যায়। অর্ডার "ওয়েব অর্ডার" মেনুতে আসে।</p>
      <div class="form-field"><label>দোকানের লিংক (কাস্টমারকে দিন, ফেসবুক/WhatsApp-এ শেয়ার করুন)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;"><input id="wsLink" readonly value="${esc(shopUrl())}" style="flex:1;min-width:220px;">
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText(E_('wsLink').value).then(()=>alert('কপি হয়েছে'))">কপি</button>
        <a class="btn btn-outline btn-sm" href="shop.html" target="_blank" rel="noopener">খুলে দেখুন</a></div></div>
      <p id="wsStatus" class="muted-cell" style="margin:8px 0 0;">${syncStatusHtml()}</p>
    </div>
    <div class="panel">
      <h3>দোকানের তথ্য ও ডেলিভারি</h3>
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1;"><label style="display:flex;gap:8px;align-items:center;"><input id="ws_enabled" type="checkbox" ${c.enabled?'checked':''}> <b>অনলাইন অর্ডার চালু</b> <span class="muted-cell">(বন্ধ থাকলে পণ্য দেখা যাবে, অর্ডার নেওয়া যাবে না)</span></label></div>
        ${fld('ws_heroTitle','মূল শিরোনাম',c.heroTitle)}
        ${fld('ws_heroText','ছোট পরিচিতি',c.heroText)}
        ${fld('ws_phone1','ফোন নম্বর ১',c.phone1,'01XXXXXXXXX')}
        ${fld('ws_phone2','ফোন নম্বর ২ (ঐচ্ছিক)',c.phone2)}
        ${fld('ws_whatsapp','WhatsApp নম্বর (দেশের কোডসহ)',c.whatsapp,'8801XXXXXXXXX')}
        ${fld('ws_facebook','ফেসবুক পেজের লিংক (ঐচ্ছিক)',c.facebook,'https://facebook.com/...')}
        ${fld('ws_localArea','স্থানীয় এলাকার নাম',c.localArea)}
        ${fld('ws_deliveryLocal','স্থানীয় ডেলিভারি চার্জ (৳)',c.deliveryLocal,'','number')}
        ${fld('ws_deliveryOutside','অন্য জেলার ডেলিভারি চার্জ (৳)',c.deliveryOutside,'','number')}
        ${fld('ws_freeDeliveryMin','এর বেশি কিনলে ডেলিভারি ফ্রি (৳, ০ = নেই)',c.freeDeliveryMin,'','number')}
        ${fld('ws_minOrder','সর্বনিম্ন অর্ডার (৳, ০ = নেই)',c.minOrder,'','number')}
        ${fld('ws_codNote','টাকা দেওয়ার নিয়ম (লেখা)',c.codNote)}
        <div class="form-field" style="grid-column:1/-1;"><label style="display:flex;gap:8px;align-items:center;"><input id="ws_showHidden" type="checkbox" ${c.showHidden?'checked':''} onchange="wsShowHidden(this.checked)"> <b>লুকানো পণ্যও অনলাইনে দেখানো যাবে</b> <span class="muted-cell">(বন্ধ থাকলে লুকানো পণ্য টিক দেওয়া থাকলেও যাবে না। চাপলেই কার্যকর হয়)</span></label></div>
      </div>
      <h3 style="margin-top:16px;">হোম পেইজের তিনটি বক্স (খালি রাখলে আগের লেখাই থাকবে)</h3>
      <div class="form-grid">
        ${fld('ws_strip1t','বক্স ১ — শিরোনাম',c.strip1t,'ক্যাশ অন ডেলিভারি')}
        ${fld('ws_strip1d','বক্স ১ — লেখা',c.strip1d,'যেমন: পণ্য হাতে পেয়ে টাকা দিন')}
        ${fld('ws_strip2t','বক্স ২ — শিরোনাম',c.strip2t,'হোম ডেলিভারি')}
        ${fld('ws_strip2d','বক্স ২ — লেখা',c.strip2d,'খালি রাখলে ডেলিভারি চার্জ দেখাবে')}
        ${fld('ws_strip3t','বক্স ৩ — শিরোনাম',c.strip3t,'সহজ অর্ডার')}
        ${fld('ws_strip3d','বক্স ৩ — লেখা',c.strip3d,'কার্ট থেকে অর্ডার করুন অথবা সরাসরি মেসেজ দিন')}
      </div>
      <h3 style="margin-top:16px;">"কীভাবে অর্ডার করবেন" অংশ (পেইজের নিচে; খালি রাখলে আগের লেখাই থাকবে)</h3>
      <div class="form-grid">
        ${fld('ws_howTitle','অংশের শিরোনাম',c.howTitle,'কীভাবে অর্ডার করবেন')}
        <div></div>
        ${fld('ws_how1t','ধাপ ১ — শিরোনাম',c.how1t,'পছন্দ করুন')}
        ${fld('ws_how1d','ধাপ ১ — লেখা',c.how1d,'পণ্যের নিচের বাটনে ক্লিক করে কার্টে যোগ করুন।')}
        ${fld('ws_how2t','ধাপ ২ — শিরোনাম',c.how2t,'ঠিকানা দিন')}
        ${fld('ws_how2d','ধাপ ২ — লেখা',c.how2d,'নাম, মোবাইল নম্বর ও পূর্ণ ঠিকানা লিখুন।')}
        ${fld('ws_how3t','ধাপ ৩ — শিরোনাম',c.how3t,'পণ্য হাতে পেয়ে টাকা দিন')}
        ${fld('ws_how3d','ধাপ ৩ — লেখা',c.how3d,'অর্ডারের পর আমরা ফোনে কনফার্ম করব...')}
      </div>
      <p class="muted-cell" style="margin:8px 0 0;">দুই ডেলিভারি চার্জই ০ রাখলে কাস্টমারকে "চার্জ কনফার্মের সময় জানানো হবে" দেখাবে।</p>
      <div style="margin-top:14px;"><button class="btn btn-primary" onclick="wsSaveCfg()">সংরক্ষণ করে দোকানে প্রকাশ করুন</button></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>অনলাইনে কোন পণ্য দেখাবেন</h3><div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="wsAll(true)">সব চালু পণ্য টিক দিন</button><button class="btn btn-outline btn-sm" onclick="wsAll(false)">সব টিক তুলুন</button><button class="btn btn-accent btn-sm" onclick="wsSyncNow()">🔄 এখনই সিঙ্ক</button></div></div>
      <p class="muted-cell" style="margin:0 0 8px;">এখন অনলাইনে যাচ্ছে: <b id="wsInc">${inc}টি</b> পণ্য। শুধু নাম, বিক্রয়মূল্য ও স্টক যায় — ক্রয়মূল্য, লাভ ও অন্য কিছু যায় না। পণ্যের দাম/স্টক বদলালে কয়েক সেকেন্ডে নিজে থেকে হালনাগাদ হয়।</p>
      <div class="table-wrap"><table><thead><tr><th>অনলাইনে</th><th>পণ্য</th><th>বিক্রয়মূল্য</th><th>স্টক</th><th>বর্ণনা</th><th>ছবি</th></tr></thead>
      <tbody>${CACHE.products.map(prodRow).join('') || '<tr><td colspan="6" class="empty-state">কোনো পণ্য নেই</td></tr>'}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>`;
};
window.E_ = E;
function numVal(id){ return Math.max(0, Number(String(E(id).value||'0').replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d))) || 0); }
window.wsSaveCfg = async function(){
  if(!isAdmin()) return;
  const shop = {setup:true, enabled:E('ws_enabled').checked, heroTitle:E('ws_heroTitle').value.trim(), heroText:E('ws_heroText').value.trim(),
    phone1:E('ws_phone1').value.trim(), phone2:E('ws_phone2').value.trim(), whatsapp:E('ws_whatsapp').value.replace(/\D/g,''), facebook:E('ws_facebook').value.trim(),
    localArea:E('ws_localArea').value.trim() || 'স্থানীয়', deliveryLocal:numVal('ws_deliveryLocal'), deliveryOutside:numVal('ws_deliveryOutside'),
    freeDeliveryMin:numVal('ws_freeDeliveryMin'), minOrder:numVal('ws_minOrder'), codNote:E('ws_codNote').value.trim(), showHidden:E('ws_showHidden').checked,
    strip1t:E('ws_strip1t').value.trim(), strip1d:E('ws_strip1d').value.trim(), strip2t:E('ws_strip2t').value.trim(), strip2d:E('ws_strip2d').value.trim(), strip3t:E('ws_strip3t').value.trim(), strip3d:E('ws_strip3d').value.trim(),
    howTitle:E('ws_howTitle').value.trim(), how1t:E('ws_how1t').value.trim(), how1d:E('ws_how1d').value.trim(), how2t:E('ws_how2t').value.trim(), how2d:E('ws_how2d').value.trim(), how3t:E('ws_how3t').value.trim(), how3d:E('ws_how3d').value.trim()};
  if(shop.facebook && !/^https?:\/\//i.test(shop.facebook)){ alert('ফেসবুক লিংক https:// দিয়ে শুরু হতে হবে।'); return; }
  saveSettings({...CACHE.settings, shop});
  E('wsStatus').innerHTML = '⏳ প্রকাশ হচ্ছে...';
  await wsPublish(true);
  E('wsStatus').innerHTML = syncStatusHtml();
  if(!WS.syncErr) alert('✅ সংরক্ষিত ও প্রকাশিত।' + (shop.enabled ? '' : '\n\n(মনে রাখবেন: "অনলাইন অর্ডার চালু" টিক না থাকায় কাস্টমার এখন অর্ডার দিতে পারবে না।)'));
};
window.wsSyncNow = async function(){ E('wsStatus').innerHTML = '⏳ সিঙ্ক হচ্ছে...'; await wsPublish(true); E('wsStatus').innerHTML = syncStatusHtml(); };
function saveProductsPatch(fn){ const products = CACHE.products.map(p => fn(p) || p); saveCollection('products', products); }
window.wsToggle = function(id, on){ saveProductsPatch(p => p.id===id ? {...p, web:!!on} : null); const el = E('wsInc'); if(el) el.textContent = wsIncluded().length + 'টি'; };
window.wsDesc = function(id, v){ saveProductsPatch(p => p.id===id ? {...p, webDesc:String(v||'').trim().slice(0,120)} : null); };
window.wsShowHidden = function(on){
  if(!isAdmin()) return;
  saveSettings({...CACHE.settings, shop:{...(CACHE.settings.shop||{}), showHidden:!!on}});
  wsSchedule(); const el = E('wsInc'); if(el) el.textContent = wsIncluded().length + 'টি';
};
window.wsAll = function(on){
  const sh = CACHE.settings.shop || {};
  if(!confirm(on ? (sh.showHidden ? 'সব পণ্য (লুকানোসহ) অনলাইনে দেখাবেন?' : 'সব চালু (লুকানো নয়) পণ্য অনলাইনে দেখাবেন?') : 'সব পণ্য অনলাইন থেকে সরাবেন?')) return;
  saveProductsPatch(p => (on ? (sh.showHidden || !p.hidden) : true) ? {...p, web:!!on} : null); renderWebShop();
};
window.wsUploadImg = async function(pid, input){
  const file = input.files[0]; input.value = ''; if(!file) return;
  try{
    const data = await lfProcessFile(file), v = Date.now();
    await docRef('img__'+pid).set({data, v});
    saveProductsPatch(p => p.id===pid ? {...p, hasImg:true, imgV:v} : null);
    renderWebShop();
  }catch(e){ alert('ছবি সংরক্ষণ হয়নি: ' + (e.message||e)); }
};
})();
