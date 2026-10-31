/* ============================================================
   Avera Mart — Business Manager (Firebase Firestore backend)
   All devices share one cloud database via Firestore + Anonymous Auth.
   ============================================================ */

const COLLECTION = 'averamart';
let db = null;

/* In-memory cache — kept live in sync with Firestore via onSnapshot */
const CACHE = {
  products: [],
  orders: [],
  purchases: [],
  expenses: [],
  returns: [],
  shareholders: [],
  contributions: [],
  closings: [],
  leaflets: [],
  investments: [],
  settings: {
    dividendPercent: 50,
    productCategories: ['খাদ্যশস্য','ডাল','তেল','মসলা','অর্গানিক আইটেম','অন্যান্য'],
    expenseCategories: ['দোকান ভাড়া','পরিবহন ও কুরিয়ার','প্যাকেজিং','বেতন','বিদ্যুৎ বিল','অন্যান্য'],
    businessAddress: 'রাজশাহী, বাংলাদেশ',
    tagline: 'প্রকৃতির ছোঁয়া, নিরাপদ আস্থা',
    phone: '',
    website: ''
  },
  users: { admin:{pin:'1234'}, manager:{pin:'2222'} }   // পুরোনো ডেটাবেজে থাকা delivery এন্ট্রি মোছা হয় না — শুধু আর ব্যবহার হয় না
};
const LOADED = { products:false, orders:false, purchases:false, expenses:false, returns:false, shareholders:false, contributions:false, closings:false, leaflets:false, investments:false, settings:false, users:false };

const DEFAULT_PRODUCTS = [
  {id:'P001', name:'প্রিমিয়াম মিনিকেট চাল (৫ কেজি)', category:'খাদ্যশস্য', cost:340, retail:390, shareholder:365, stock:40, minStock:10},
  {id:'P002', name:'সয়াবিন তেল (৫ লিটার)', category:'তেল', cost:780, retail:850, shareholder:815, stock:15, minStock:8},
  {id:'P003', name:'মসুর ডাল (১ কেজি)', category:'ডাল', cost:110, retail:130, shareholder:120, stock:5, minStock:10}
];

/* ---------------- Firebase bootstrap ---------------- */
function initFirebase(){
  try{
    firebase.initializeApp(firebaseConfig);
  }catch(e){ /* already initialized */ }
  db = firebase.firestore();
  const auth = firebase.auth();

  auth.onAuthStateChanged(user => {
    if(user){
      attachListeners();
    } else {
      auth.signInAnonymously().catch(err => {
        document.getElementById('loginStatus').textContent =
          '⚠️ ক্লাউড সংযোগে সমস্যা হয়েছে। firebase-config.js ফাইলে সঠিক কনফিগারেশন বসানো আছে কিনা যাচাই করুন। (' + err.message + ')';
      });
    }
  });
}

function docRef(name){ return db.collection(COLLECTION).doc(name); }

/* ---- ডেটা সুরক্ষা ----
   ১) ক্যাশ (অফলাইন/ধীর নেট) থেকে "ডকুমেন্ট নেই" এলে আর ডেমো/খালি ডেটা লেখা হয় না — শুধু সার্ভার নিশ্চিত করলে তবেই নতুন ডেটা তৈরি হয়।
   ২) প্রতিবার সার্ভার থেকে ডেটা এলে এই ডিভাইসে একটা "নিরাপদ কপি" থাকে; ডেটা হঠাৎ অস্বাভাবিক কমে গেলে সতর্কতা ও ফেরত আনার বাটন আসে। */
const SAFE_COLS = ['products','orders','purchases','expenses','returns','shareholders','contributions','closings'];
const SAFE_ALERT = {};
function safeCopyUpdate(name, items){
  try{
    const raw = localStorage.getItem('AM_safe_'+name);
    const prev = raw ? JSON.parse(raw) : null;
    if(prev && prev.n >= 10 && items.length < prev.n*0.5){ SAFE_ALERT[name] = {prevN:prev.n, nowN:items.length, ts:prev.ts}; return; }
    delete SAFE_ALERT[name];
    localStorage.setItem('AM_safe_'+name, JSON.stringify({ts:Date.now(), n:items.length, items}));
  }catch(e){}
}
function renderDataLossBar(){
  let bar = document.getElementById('dataLossBar');
  const names = Object.keys(SAFE_ALERT);
  if(!names.length){ if(bar) bar.remove(); return; }
  if(!bar){ bar = document.createElement('div'); bar.id = 'dataLossBar'; bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#B3261E;color:#fff;padding:12px 14px;font-size:13.5px;line-height:1.6;box-shadow:0 -2px 10px rgba(0,0,0,.3);'; document.body.appendChild(bar); }
  const lbl = {products:'পণ্য',orders:'অর্ডার',purchases:'ক্রয়',expenses:'খরচ/আয়',returns:'রিটার্ন',shareholders:'শেয়ারহোল্ডার',contributions:'জমা',closings:'মাস ক্লোজিং', investments:'বিনিয়োগ', leaflets:'লিফলেট'};
  const detail = names.map(n => `${lbl[n]||n}: ${SAFE_ALERT[n].prevN}টি → ${SAFE_ALERT[n].nowN}টি`).join(' · ');
  const when = fmtDT(new Date(SAFE_ALERT[names[0]].ts).toISOString());
  bar.innerHTML = `⚠️ <b>ডেটা হঠাৎ অনেক কমে গেছে!</b> (${detail})<br>এই ডিভাইসে ${when}-এর নিরাপদ কপি আছে। ${isAdmin()?`<button onclick="restoreSafeCopy()" style="margin-top:6px;background:#fff;color:#B3261E;border:0;border-radius:6px;padding:7px 12px;font-weight:700;">⏪ নিরাপদ কপি থেকে ফেরত আনুন</button> <button onclick="dismissSafeAlert()" style="margin-top:6px;background:transparent;color:#fff;border:1px solid #fff;border-radius:6px;padding:7px 12px;">না, এটাই ঠিক</button>`:'অ্যাডমিনকে এখনই জানান।'}`;
}
function restoreSafeCopy(){
  if(!isAdmin()) return;
  const names = Object.keys(SAFE_ALERT);
  if(!names.length || !confirm('এই ডিভাইসের নিরাপদ কপি থেকে কমে যাওয়া ডেটা ফেরত আনবেন?\n\n(এখনকার ডেটার একটা ব্যাকআপ আগে নিজে থেকেই ডাউনলোড হবে)')) return;
  try{ downloadBackup(); }catch(e){}
  FORCE_SAVE = true; setTimeout(()=>{ FORCE_SAVE = false; }, 30000);
  names.forEach(n => { try{ const c = JSON.parse(localStorage.getItem('AM_safe_'+n)); if(c && Array.isArray(c.items)){ saveCollection(n, c.items); delete SAFE_ALERT[n]; } }catch(e){} });
  renderDataLossBar(); onCloudUpdate();
  alert('✅ ফেরত আনা হয়েছে। সংখ্যাগুলো একবার মিলিয়ে দেখুন।');
}
function dismissSafeAlert(){
  if(!confirm('ডেটা ইচ্ছা করেই কমানো হয়ে থাকলে এগিয়ে যান — পুরোনো নিরাপদ কপি মুছে নতুন কপি রাখা হবে।')) return;
  Object.keys(SAFE_ALERT).forEach(n => { try{ localStorage.removeItem('AM_safe_'+n); }catch(e){} delete SAFE_ALERT[n]; safeCopyUpdate(n, CACHE[n]||[]); });
  renderDataLossBar();
}
function listenDoc(name, apply, seed, items){
  let last = null;
  docRef(name).onSnapshot({includeMetadataChanges:true}, snap => {
    if(snap.exists){
      const data = snap.data(), js = JSON.stringify(data);
      if(js === last && LOADED[name]) return;      // শুধু মেটাডেটা বদলালে আবার রেন্ডার নয়
      last = js;
      apply(data);
      if(!snap.metadata.fromCache && items) safeCopyUpdate(name, items(data));
    } else {
      if(snap.metadata.fromCache) return;           // ক্যাশের "নেই" বিশ্বাস করা যাবে না — সার্ভারের উত্তরের অপেক্ষা
      seed();
    }
    LOADED[name] = true; onCloudUpdate(); renderDataLossBar();
    if(allLoaded() && !BK_TRIED){ BK_TRIED = true; setTimeout(() => runServerBackup(false), 8000); }
  }, err => {
    const el = document.getElementById('loginStatus');
    if(el) el.textContent = '⚠️ ডেটা লোড করা যায়নি (' + err.message + ')';
  });
}
function attachListeners(){
  const arr = (name, seedItems) => listenDoc(name,
    d => { CACHE[name] = d.items || []; },
    () => { docRef(name).set({items: seedItems}); CACHE[name] = seedItems; },
    d => d.items || []);
  arr('products', DEFAULT_PRODUCTS);
  ['orders','purchases','expenses','returns','shareholders','contributions','closings','leaflets','investments'].forEach(n => arr(n, []));
  listenDoc('settings', data => {
    // older deployments may not have the category lists yet — merge in the defaults once
    const merged = {
      dividendPercent: data.dividendPercent ?? CACHE.settings.dividendPercent,
      productCategories: data.productCategories && data.productCategories.length ? data.productCategories : CACHE.settings.productCategories,
      expenseCategories: data.expenseCategories && data.expenseCategories.length ? data.expenseCategories : CACHE.settings.expenseCategories,
      businessAddress: data.businessAddress || CACHE.settings.businessAddress,
      tagline: data.tagline ?? CACHE.settings.tagline,
      phone: data.phone ?? CACHE.settings.phone,
      website: data.website ?? CACHE.settings.website,
      qrImg: data.qrImg ?? CACHE.settings.qrImg,
      qrPlaces: data.qrPlaces ?? CACHE.settings.qrPlaces,
      qrCaption: data.qrCaption ?? CACHE.settings.qrCaption,
      shop: data.shop ?? CACHE.settings.shop
    };
    Object.keys(merged).forEach(k => { if(merged[k] === undefined) delete merged[k]; });   // Firestore-এ undefined মান লেখা যায় না
    CACHE.settings = merged;
    if(!data.productCategories || !data.expenseCategories || !data.businessAddress) docRef('settings').set(merged);
  }, () => { docRef('settings').set(CACHE.settings); });
  listenDoc('users', data => { CACHE.users = data; }, () => { docRef('users').set(CACHE.users); });
  // ১৫ সেকেন্ডেও সার্ভার থেকে সাড়া না এলে ব্যবহারকারীকে জানানো (ডেটা তৈরি/মোছা বন্ধ থাকে)
  setTimeout(() => {
    if(!allLoaded()){
      const el = document.getElementById('loginStatus');
      if(el) el.textContent = '⚠️ ইন্টারনেট সংযোগ দুর্বল — সার্ভার থেকে ডেটা আসেনি। নেট ঠিক হলে পেইজ রিফ্রেশ করুন। (নিরাপত্তার জন্য কোনো ডেটা তৈরি বা পরিবর্তন করা হচ্ছে না)';
    }
  }, 15000);
}

function allLoaded(){ return Object.values(LOADED).every(Boolean); }

function onCloudUpdate(){
  if(!allLoaded()) return;
  const loginScreenVisible = !document.getElementById('loginScreen').classList.contains('hidden');
  if(loginScreenVisible){
    document.getElementById('loginStatus').textContent = '';
    document.getElementById('loginFormWrap').classList.remove('hidden');
    refreshLoginMode();
    // আগের সেশন থাকলে (পেইজ খোলার সময় ডেটা আসেনি) এখন যাচাই করে ঢোকানো হবে
    if(getSession()) boot();
  } else {
    // পাসওয়ার্ড রিসেট/বদল হলে বা ব্যবহারকারী বাদ পড়লে পুরোনো সেশন বন্ধ
    if(!sessionValid(getSession())){ localStorage.removeItem('AM_session'); alert('আপনার লগইন তথ্য বদলে গেছে বা মেয়াদ শেষ — আবার লগইন করুন।'); boot(); return; }
    if(getSession().role==='admin' && needsSetup()){ if(currentPage!=='__setup'){ renderSetup(); } return; }
    // একটা ফর্ম খোলা থাকলে (কেউ টাইপ করছে) পেইজ রিফ্রেশ করে সেটা মুছে ফেলা হবে না
    const mh = document.getElementById('modalHolder');
    if(mh && mh.innerHTML.trim()) return;
    if(currentPage==='returns' && (document.getElementById('ret_order')||{}).value) return;
    if(currentPage==='leaflet' || currentPage==='catalog' || currentPage==='webshop') return;   // লিফলেট এডিটর চলাকালে রিফ্রেশ নয়
    if(currentPage==='invoice'){ renderInvoice((document.getElementById('inv_order')||{}).value || ''); return; }
    // live re-render current page so every device sees updates instantly
    const renderers = {
      dashboard: renderDashboard, products: renderProducts, orders: renderOrders,
      purchases: renderPurchases, expenses: renderExpenses, dues: renderDues, returns: renderReturns, discounts: renderDiscounts, inventory: renderInventory, shareholders: renderShareholders, profitloss: renderProfitLoss, closing: renderClosing, stockcheck: renderStockCheck, leaflet: renderLeaflet, catalog: renderCatalog, productsales: renderProductSales,
      invoice: renderInvoice, settings: renderSettings,
      weborders: () => renderWebOrders(), webshop: () => renderWebShop()
    };
    (renderers[currentPage] || renderDashboard)();
  }
}

/* ---------------- Firestore write helpers ---------------- */
let FORCE_SAVE = false;
function saveFailed(name, err){ alert('⚠️ সার্ভারে সংরক্ষণ হয়নি (' + name + '): ' + (err && err.message || err) + '\n\nপেইজ রিফ্রেশ করবেন না। ইন্টারনেট ও Firebase নিয়ম (rules) দেখুন, তারপর আবার চেষ্টা করুন।'); }
function saveCollection(name, arr){
  const prev = CACHE[name] || [];
  if(!FORCE_SAVE && prev.length >= 10 && arr.length < prev.length*0.5){
    alert('🛑 নিরাপত্তা: একসাথে অর্ধেকের বেশি এন্ট্রি মুছে ফেলা হচ্ছিল (' + name + ': ' + prev.length + ' → ' + arr.length + '), তাই সংরক্ষণ আটকে দেওয়া হয়েছে। অল্প অল্প করে মুছুন।');
    return false;
  }
  let size = 0; try{ size = JSON.stringify(arr).length; }catch(e){}
  if(size > 980000){ alert('🛑 ' + name + '-এর ডেটা Firebase-এর ১ MB সীমায় পৌঁছে গেছে — সংরক্ষণ করা যাচ্ছে না। ডেভেলপারকে জানান (সেটিংস → ডেটা ব্যবহার দেখুন)।'); return false; }
  CACHE[name] = arr;
  docRef(name).set({items: arr}).catch(e => saveFailed(name, e));
  return true;
}
function saveSettings(obj){ CACHE.settings = obj; try{ qrPrep(); }catch(e){} docRef('settings').set(obj).catch(e => saveFailed('settings', e)); }
function saveUsers(obj){ CACHE.users = obj; docRef('users').set(obj).catch(e => saveFailed('users', e)); }

/* ---------------- Helpers ---------------- */
function fmtBasis(p){ const n = Number(p&&p.priceBasis)||1; return n===1 ? '' : `${r3(n)} ${(p&&p.unit)||'কেজি'}`; }
function packPrice(p, field){ const n = Number(p&&p.priceBasis)||1; return Math.round(Number(p&&p[field]||0)*n*100)/100; }
function money(n){ return '৳' + Number(n||0).toLocaleString('en-BD', {maximumFractionDigits:2}); }
function todayStr(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function pickedDate(id){ const v = (document.getElementById(id)||{}).value; return /^\d{4}-\d{2}-\d{2}$/.test(v||'') ? v : todayStr(); }
function dateField(id, value){ return `<div class="form-field"><label>তারিখ (না বদলালে আজকের তারিখ)</label><input id="${id}" type="date" value="${value||todayStr()}"></div>`; }
function genId(prefix, list){
  const nums = list.map(x => parseInt((x.id||'').replace(/\D/g,'')) || 0);
  const next = (nums.length? Math.max(...nums) : 0) + 1;
  return prefix + String(next).padStart(3,'0');
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- v2.2 helpers ---------------- */
const UNIT_OPTIONS = ['কেজি','গ্রাম','লিটার','মিলিলিটার','পিস','ডজন','হালি','প্যাকেট','বস্তা'];
function isAdmin(){ const s = getSession(); return !!s && s.role==='admin'; }
function toTop(){ window.scrollTo({top:0, behavior:'smooth'}); }
function closeForm(fn){ fn(); toTop(); }
// ফর্ম খুলে অটোমেটিক সেখানে স্ক্রল করে নিয়ে যায় (নিচে নেমে খুঁজতে হয় না)
function openForm(html){
  const h = document.getElementById('modalHolder'); if(!h) return;
  h.innerHTML = html;
  requestAnimationFrame(()=>{
    const panel = h.firstElementChild || h;
    panel.scrollIntoView({behavior:'smooth', block:'start'});
    if(window.matchMedia && matchMedia('(pointer:fine)').matches){
      const f = h.querySelector('input:not([type=date]):not([type=checkbox]):not([type=file]):not([type=hidden]), textarea');
      if(f) f.focus({preventScroll:true});
    }
  });
}
// সংরক্ষণের পর সবুজ নোটিশ + নতুন/পরিবর্তিত সারিতে হলুদ দাগ
let FLASH = null;   // {page, html, warn, hl:[ids], scrolled}
function setFlash(page, html, hl, warn){ FLASH = {page, html, warn:!!warn, hl: [].concat(hl||[]), scrolled:false}; }
function clearFlash(){ FLASH = null; const el = document.getElementById('flashBox'); if(el) el.remove(); document.querySelectorAll('.row-hl').forEach(r=>r.classList.remove('row-hl')); }
function flashHtml(page){
  return (FLASH && FLASH.page===page) ? `<div class="flash ${FLASH.warn?'warn':''}" id="flashBox"><button class="flash-close" onclick="clearFlash()">✕</button>${FLASH.html}</div>` : '';
}
function hlClass(page, id){ return (FLASH && FLASH.page===page && FLASH.hl.includes(id)) ? 'row-hl' : ''; }
function scrollToHl(){
  if(!FLASH || FLASH.scrolled) return;
  const el = document.querySelector('tr.row-hl');
  FLASH.scrolled = true;
  if(el) setTimeout(()=>el.scrollIntoView({behavior:'smooth', block:'center'}), 60);
}
function stampEdit(obj){ obj.editedAt = new Date().toISOString(); obj.editedBy = (getSession()||{}).role || ''; return obj; }
function editedBadge(x){
  if(!x || !x.editedAt) return '';
  let when = ''; try{ when = new Date(x.editedAt).toLocaleString('bn-BD',{timeZone:'Asia/Dhaka'}); }catch(e){}
  return `<span class="badge badge-edited" title="${esc('সংশোধন: '+when)}">সংশোধিত</span>`;
}
function stockTotals(){
  let cost = 0, retail = 0, count = 0;
  CACHE.products.forEach(p=>{
    const st = Math.max(0, Number(p.stock)||0);
    if(st>0){ count++; cost += st*Number(p.cost||0); retail += st*Number(p.retail||0); }
  });
  return {cost: Math.round(cost*100)/100, retail: Math.round(retail*100)/100, count};
}
function adjustStock(products, items, sign){
  items.forEach(it=>{
    const i = products.findIndex(p=>p.id===it.productId);
    if(i>-1) products[i] = {...products[i], stock: r3(Number(products[i].stock) + sign*Number(it.qty||0))};
  });
}

/* An order can hold multiple product line items. Older orders saved before this
   feature only had a single productId/qty/unitPrice — this normalizes both shapes. */
function r3(n){ return Math.round(Number(n||0)*1000)/1000; }
const UNIT_FAMILY = {
  'কেজি': {label:'গ্রাম', factor:1000},
  'লিটার': {label:'মি.লি.', factor:1000},
  'ডজন': {label:'পিস', factor:12},
  'হালি': {label:'পিস', factor:4},
  'গ্রাম': {label:'কেজি', factor:0.001},
  'মিলিলিটার': {label:'লিটার', factor:0.001}
};
function subInfo(p){
  if(!p) return null;
  const fromText = parsePackUnit(p.unit);          // "৫০০ গ্রাম", "১ কেজি" ইত্যাদি লেখা থেকেই হিসাব — এটাই সঠিক
  if(fromText) return fromText;
  if(Number(p.packSize)>0) return {label: p.packLabel || 'গ্রাম', factor: Number(p.packSize), pack:true};
  const f = UNIT_FAMILY[p.unit];
  if(f) return {...f};
  return null;
}
// Understands units typed as text such as "৫০০ গ্রাম", "500g", "১ কেজি", "২৫০ মি.লি.", "১ লিটার", "১২ পিস"
function parsePackUnit(unit){
  const bn = '০১২৩৪৫৬৭৮৯';
  const t = String(unit||'').trim().replace(/[০-৯]/g, d => bn.indexOf(d)).replace(/\s+/g,' ');
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(গ্রাম|গ্রা\.?|gm|g|কেজি|কেজি\.?|kg|লিটার|ltr|l|মিলিলিটার|মি\.?লি\.?|ml|পিস|pcs)$/i);
  if(!m) return null;
  const n = Number(m[1]); if(!(n>0)) return null;
  const u = m[2].toLowerCase();
  if(['গ্রাম','গ্রা','গ্রা.','gm','g'].includes(u)) return {label:'গ্রাম', factor:n, pack:true};
  if(['কেজি','কেজি.','kg'].includes(u))           return {label:'গ্রাম', factor:n*1000, pack:true};
  if(['লিটার','ltr','l'].includes(u))              return {label:'মি.লি.', factor:n*1000, pack:true};
  if(u==='পিস' || u==='pcs')                       return {label:'পিস', factor:n, pack:true};
  return {label:'মি.লি.', factor:n, pack:true};
}
// every unit the seller may pick for a product; factor = how many of that unit make ONE base unit
function unitOptions(p){
  const base = {key:'base', label:(p&&p.unit)||'কেজি', factor:1};
  const info = subInfo(p);
  if(!info) return [base];
  const opts = [base, {key:'sub', label:info.label, factor:info.factor}];
  if(info.pack){
    if(info.label==='গ্রাম') opts.push({key:'big', label:'কেজি', factor:info.factor/1000});
    else if(info.label==='মি.লি.') opts.push({key:'big', label:'লিটার', factor:info.factor/1000});
  }
  return opts;
}
function optByKey(p,key){ const o = unitOptions(p); return o.find(x=>x.key===key) || o[0]; }
function unitSelectHtml(p, selectedKey, attrs){
  const o = unitOptions(p);
  if(o.length<2) return `<span class="muted-cell">${esc(o[0].label)}</span>`;
  return `<select ${attrs} style="padding:4px;border:1px solid var(--border);border-radius:6px;">${o.map(x=>`<option value="${x.key}" ${x.key===selectedKey?'selected':''}>${esc(x.label)}</option>`).join('')}</select>`;
}
function fmtQty(qty, p){
  const unit = (p && p.unit) || 'কেজি';
  const info = subInfo(p || {unit});
  const q = Number(qty);
  if(info && info.factor > 1 && q > 0 && q < 1) return `${r3(q*info.factor)} ${info.label}`;
  if(info && info.pack && q > 1 && Math.abs(q - Math.round(q)) > 0.0001) return `${r3(q)} ${unit} (${r3(q*info.factor)} ${info.label})`;
  return `${r3(q)} ${unit}`;
}
const kk = x => catKey(bnToEn(x));
function prodMatches(q, limit, includeHidden){
  const toks = String(q||'').trim().split(/\s+/).map(kk).filter(Boolean); if(!toks.length) return [];
  const res = [];
  CACHE.products.forEach(p => {
    if(!includeHidden && p.hidden) return;
    const nm = kk(p.name), hay = nm + '|' + kk(p.id) + '|' + kk(p.category||'');
    if(toks.every(t => hay.includes(t))) res.push({p, r: nm.startsWith(toks[0]) ? 0 : (nm.includes(toks[0]) ? 1 : 2)});
  });
  res.sort((a,b) => a.r-b.r || String(a.p.name).localeCompare(String(b.p.name),'bn'));
  return res.slice(0, limit||10).map(x => x.p);
}
function custList(){
  const seen = {}, out = [];
  CACHE.orders.slice().reverse().forEach(o => {
    if(!o.customerName) return; const k = kk(o.customerName) + '|' + kk(o.phone||''); if(seen[k]) return; seen[k] = 1;
    out.push({name:o.customerName, phone:o.phone||'', address:o.address||'', pl: PRICE_LISTS[o.priceList] ? o.priceList : 'retail'});
  });
  return out;
}
function custFind(q){
  const all = custList(), t = String(q||'').trim(); if(!t) return all.slice(0,6);
  const toks = t.split(/\s+/).map(kk).filter(Boolean);
  return all.filter(c => { const hay = kk(c.name) + '|' + kk(c.phone) + '|' + kk(c.address); return toks.every(x => hay.includes(x)); }).slice(0,8);
}
function supplierFind(q){
  const seen = {}, all = []; CACHE.purchases.slice().reverse().forEach(pu => { const n = (pu.supplier||'').trim(); if(!n || seen[kk(n)]) return; seen[kk(n)] = 1; all.push(n); });
  const toks = String(q||'').trim().split(/\s+/).map(kk).filter(Boolean);
  return (toks.length ? all.filter(n => toks.every(t => kk(n).includes(t))) : all).slice(0,8);
}
const SG_ITEMS = {};
function sgAttach(id, find, label, pick){
  const inp = document.getElementById(id); if(!inp) return;
  const wrap = inp.parentElement; wrap.style.position = 'relative';
  const box = document.createElement('div'); box.className = 'sg-box hidden'; wrap.appendChild(box);
  const show = () => {
    const items = find(inp.value); SG_ITEMS[id] = items;
    if(!items.length){ box.classList.add('hidden'); return; }
    box.innerHTML = items.map((it,i) => `<div class="sg-item" data-i="${i}">${label(it)}</div>`).join(''); box.classList.remove('hidden');
  };
  inp.addEventListener('input', show); inp.addEventListener('focus', show);
  inp.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 220));
  box.addEventListener('pointerdown', e => {
    const d = e.target.closest('.sg-item'); if(!d) return; e.preventDefault();
    const it = (SG_ITEMS[id]||[])[Number(d.dataset.i)]; box.classList.add('hidden'); if(it!==undefined) pick(it);
  });
}
function custLabel(c){ return `<b>${esc(c.name)}</b> <span class="muted-cell">${esc(c.phone)}</span>${c.address ? `<br><span class="muted-cell" style="font-size:11.5px;">${esc(c.address)}</span>` : ''}`; }
function custPick(c){
  const set = (id,v) => { const e = document.getElementById(id); if(e) e.value = v; };
  set('o_name', c.name); set('o_phone', c.phone); set('o_addr', c.address);
  if(c.pl && c.pl!==ORDER_PL && !ORDER_CART.length){ ORDER_PL = c.pl; const e = document.getElementById('o_pl'); if(e) e.value = c.pl; }
}
function custSuggestInit(){ ['o_name','o_phone','o_addr'].forEach(id => sgAttach(id, custFind, custLabel, custPick)); }
function purchaseSuggestInit(){
  sgAttach('pu_supplier', supplierFind, n => `<b>${esc(n)}</b>`, n => { const e = document.getElementById('pu_supplier'); if(e) e.value = n; });
  sgAttach('pu_pname', q => prodMatches(q, 10, true), p => `<b>${esc(p.name)}</b> <span class="muted-cell">${esc(p.unit||'কেজি')} · স্টক ${fmtStock(p.stock, p)}</span>`, p => { const e = document.getElementById('pu_pname'); if(e){ e.value = p.name; onPurchaseNameType(); } });
}
const PRICE_LISTS = {retail:'খুচরা', corporate:'কর্পোরেট'};
function unitListPrice(p, list){ const v = Number(p.corporate); return (list==='corporate' && v>0) ? v : Number(p.retail||0); }
function packListPrice(p, list){ const n = Number(p.priceBasis)||1; return Math.round(unitListPrice(p, list)*n*100)/100; }
function listPricesNote(p){
  const w = Number(p.wholesale)>0, c = Number(p.corporate)>0; if(!w && !c) return '';
  return `<br><span class="muted-cell" style="font-size:11px;">${w?'পাইকারি '+money(packListPrice(p,'wholesale')):''}${w&&c?' · ':''}${c?'কর্পোরেট '+money(packListPrice(p,'corporate')):''}</span>`;
}
function lineGross(it){ return Math.round(Number(it.qty)*Number(it.unitPrice)*100)/100; }
function lineDisc(it){
  const g = lineGross(it);
  if(it.discType==='pct') return Math.min(g, Math.round(g*(Number(it.discVal)||0))/100);
  if(it.discType==='amt') return Math.min(g, Math.round((Number(it.discVal)||0)*100)/100);
  return Math.min(g, Math.round((Number(it.lineDiscount)||0)*100)/100);
}
function lineSur(it){
  const g = lineGross(it);
  if(it.surType==='pct') return Math.round(g*(Number(it.surVal)||0))/100;
  if(it.surType==='amt') return Math.round((Number(it.surVal)||0)*100)/100;
  return Math.round((Number(it.lineSurcharge)||0)*100)/100;
}
function lineAmt(it){ return Math.round((lineGross(it) - lineDisc(it) + lineSur(it))*100)/100; }
// what the customer sees: exactly the unit the seller picked (e.g. "10 গ্রাম", "2 কেজি")
function fmtItem(it, p){ return (it.dq!=null && it.du) ? `${it.dq} ${it.du}` : fmtQty(it.qty, p); }
function syncDisp(it, p){
  if(it.du==null) return;
  const o = unitOptions(p).find(x=>x.label===it.du);
  it.dq = r3(it.qty*(o?o.factor:1));
}
// stock shown like "২ কেজি ৩৫০ গ্রাম" instead of a decimal
function fmtStock(stock, p){
  const unit = (p && p.unit) || 'কেজি';
  const info = subInfo(p);
  const st = Number(stock||0);
  if(st < 0) return '-' + fmtStock(-st, p);
  if(!info || info.pack || info.factor <= 1) return `${r3(st)} ${unit}`;
  const whole = Math.floor(st + 1e-9);
  const rem = Math.round((st - whole) * info.factor);
  if(whole===0 && rem===0) return `0 ${unit}`;
  if(whole===0) return `${rem} ${info.label}`;
  return rem ? `${whole} ${unit} ${rem} ${info.label}` : `${whole} ${unit}`;
}
function orderItems(o){
  if(o.items && o.items.length) return o.items;
  if(o.productId) return [{productId:o.productId, qty:o.qty, unitPrice:o.unitPrice}];
  return [];
}
function orderDue(o){
  const total = Number(o.total||0);
  const paid = (o.paidAmount!=null) ? Number(o.paidAmount) : (o.paymentStatus==='Paid' ? total : 0);
  return Math.max(0, total - paid);
}
function purchaseDue(pu){
  const total = Number(pu.totalCost||0);
  const paid = (pu.paidAmount!=null) ? Number(pu.paidAmount) : (pu.paymentStatus==='Paid' ? total : 0);
  return Math.max(0, total - paid);
}

const STATUS_BADGE = { 'Pending':'badge-pending','Processing':'badge-processing','Delivered':'badge-delivered','Cancelled':'badge-cancelled' };
const STATUS_BN = { 'Pending':'পেন্ডিং','Processing':'প্রসেসিং','Delivered':'ডেলিভারড','Cancelled':'বাতিল' };
const PAY_BADGE = { 'Paid':'badge-paid','Due':'badge-due','Partial':'badge-partial' };
const PAY_BN = { 'Paid':'পরিশোধিত','Due':'বাকি','Partial':'আংশিক' };
const PAY_METHODS = [
  {value:'Cash', label:'ক্যাশ'},
  {value:'Nagad', label:'নগদ'},
  {value:'bKash', label:'বিকাশ'},
  {value:'Rocket', label:'রকেট'},
  {value:'Bank', label:'ব্যাংক'}
];

/* ---------------- Session (who's logged in on THIS device) ---------------- */
const ROLES = ['admin','manager'];
function getSession(){
  let s = null;
  try{ const raw = localStorage.getItem('AM_session'); s = raw ? JSON.parse(raw) : null; }catch(e){ s = null; }
  // ডেলিভারি ম্যান রোল তুলে দেওয়া হয়েছে — পুরোনো ওই সেশন থাকলে সেটা আর চলবে না
  if(!s || !ROLES.includes(s.role)) return null;
  return s;
}

/* ---- লগইন: ইমেইল/ফোন + পাসওয়ার্ড ----
   পাসওয়ার্ড কখনো সরাসরি রাখা হয় না — PBKDF2 (লবণসহ, ১.৫ লক্ষ ধাপ) দিয়ে মিশিয়ে "users" ডকুমেন্টে থাকে।
   অ্যাডমিন সেটিংস থেকে ম্যানেজারের পাসওয়ার্ড রিসেট করেন; রিসেট হলে ওই ব্যবহারকারীর পুরোনো সব লগইন নিজে থেকে বন্ধ হয়ে যায়। */
const PBKDF2_ITER = 150000;
const ROLE_BN = {admin:'অ্যাডমিন', manager:'ম্যানেজার'};
function normLoginId(s){
  let t = bnToEn(String(s||'')).trim();
  if(t.includes('@')) return t.toLowerCase().replace(/\s+/g,'');
  t = t.replace(/[\s\-().]/g,'');
  if(t.startsWith('+88')) t = t.slice(3); else if(t.startsWith('88') && t.length===13) t = t.slice(2);
  return t;
}
function validLoginId(t){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) || /^01\d{9}$/.test(t); }
function b64enc(buf){ let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s); }
function b64dec(s){ const bin = atob(s), a = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i); return a; }
async function pbkdf2(pass, saltB64, iter){
  if(!(window.crypto && crypto.subtle)) throw new Error('এই ব্রাউজারে নিরাপদ পাসওয়ার্ড সুবিধা নেই — অ্যাপটি https লিংকে (যেমন Netlify/GitHub Pages) খুলুন।');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:b64dec(saltB64), iterations:iter}, key, 256);
  return b64enc(bits);
}
async function makeCred(pass){
  const salt = b64enc(crypto.getRandomValues(new Uint8Array(16)));
  return {salt, iter:PBKDF2_ITER, hash: await pbkdf2(pass, salt, PBKDF2_ITER)};
}
function hasCreds(u){ return !!(u && u.loginId && u.hash && u.salt); }
async function checkPass(u, pass){
  if(!hasCreds(u)) return false;
  return (await pbkdf2(pass, u.salt, u.iter || PBKDF2_ITER)) === u.hash;
}
function needsSetup(){ return !hasCreds((CACHE.users||{}).admin); }
function sessionValid(s){
  if(!s || !ROLES.includes(s.role)) return false;
  const u = (CACHE.users||{})[s.role];
  if(!hasCreds(u)) return s.role==='admin';          // নতুন লগইন চালুর আগের অ্যাডমিন সেশন — সেটআপ করানো হবে
  return Number(s.v||0) === Number(u.v||1);
}
function saveSession(role){
  const u = (CACHE.users||{})[role] || {};
  localStorage.setItem('AM_session', JSON.stringify({role, v: hasCreds(u) ? Number(u.v||1) : 0}));
}
// পুরোনো ব্যবহারকারী তথ্য (যেমন delivery, pin) অক্ষত রেখে শুধু বদলানো অংশ হালনাগাদ হয়
function patchUser(role, patch){
  const users = {...CACHE.users, [role]: {...(CACHE.users[role]||{}), ...patch}};
  saveUsers(users);
}
let LOGIN_FAIL = {n:0, until:0};
function loginWait(){ return Math.max(0, Math.ceil((LOGIN_FAIL.until - Date.now())/1000)); }
function loginFailed(errEl, msg){
  LOGIN_FAIL.n++;
  if(LOGIN_FAIL.n >= 5){ LOGIN_FAIL = {n:0, until:Date.now()+30000}; msg = 'অনেকবার ভুল হয়েছে — ৩০ সেকেন্ড পরে আবার চেষ্টা করুন।'; }
  errEl.textContent = msg;
}
async function handleLogin(){
  const errEl = document.getElementById('loginError'), btn = document.getElementById('loginBtn');
  if(!allLoaded()){ errEl.textContent = 'ক্লাউড ডেটা লোড হচ্ছে, একটু অপেক্ষা করুন।'; return; }
  if(loginWait() > 0){ errEl.textContent = `অনেকবার ভুল হয়েছে — ${loginWait()} সেকেন্ড পরে আবার চেষ্টা করুন।`; return; }
  const id = normLoginId(document.getElementById('loginId').value), pass = document.getElementById('loginPass').value;
  if(!id || !pass){ errEl.textContent = 'ইমেইল/ফোন নম্বর ও পাসওয়ার্ড দুটোই লিখুন।'; return; }
  if(btn) btn.disabled = true;
  try{
    const role = ROLES.find(r => { const u = CACHE.users[r]; return hasCreds(u) && normLoginId(u.loginId)===id; });
    const ok = role ? await checkPass(CACHE.users[role], pass) : false;
    if(ok){ LOGIN_FAIL = {n:0, until:0}; saveSession(role); errEl.textContent = ''; document.getElementById('loginPass').value = ''; boot(); }
    else { if(!role) await pbkdf2(pass, b64enc(new Uint8Array(16)), PBKDF2_ITER).catch(()=>{}); loginFailed(errEl, 'ইমেইল/ফোন নম্বর বা পাসওয়ার্ড ভুল।'); }
  }catch(e){ errEl.textContent = e.message || String(e); }
  finally{ if(btn) btn.disabled = false; }
}
// নতুন লগইন চালুর পর প্রথমবারের জন্য: অ্যাডমিন পুরোনো পিন দিয়ে ঢুকে নিজের ইমেইল/ফোন ও পাসওয়ার্ড সেট করবেন
function handleSetupLogin(){
  const errEl = document.getElementById('loginError');
  if(!allLoaded()){ errEl.textContent = 'ক্লাউড ডেটা লোড হচ্ছে, একটু অপেক্ষা করুন।'; return; }
  if(!needsSetup()){ errEl.textContent = 'সেটআপ আগেই হয়ে গেছে — উপরের ইমেইল/ফোন ও পাসওয়ার্ড দিয়ে ঢুকুন।'; refreshLoginMode(); return; }
  if(loginWait() > 0){ errEl.textContent = `${loginWait()} সেকেন্ড পরে আবার চেষ্টা করুন।`; return; }
  const pin = document.getElementById('loginPin').value.trim();
  if(!pin){ errEl.textContent = 'পুরোনো অ্যাডমিন পিন লিখুন।'; return; }
  if((CACHE.users.admin||{}).pin === pin){
    LOGIN_FAIL = {n:0, until:0}; saveSession('admin'); errEl.textContent = ''; document.getElementById('loginPin').value = ''; boot();
  } else loginFailed(errEl, 'ভুল পিন।');
}
function refreshLoginMode(){
  const box = document.getElementById('loginSetupBox'); if(!box) return;
  box.classList.toggle('hidden', !(allLoaded() && needsSetup()));
}
function handleLogout(){
  localStorage.removeItem('AM_session');
  boot();
}

/* ---------------- Nav config ---------------- */
const NAV_ITEMS = [
  {key:'dashboard', label:'ড্যাশবোর্ড', icon:'🏠', roles:['admin','manager']},
  {key:'products', label:'পণ্য তালিকা', icon:'📦', roles:['admin','manager']},
  {key:'orders', label:'অর্ডার ও সেলস', icon:'🛍️', roles:['admin','manager']},
  {key:'leaflet', label:'অফার লিফলেট', icon:'📣', roles:['admin','manager']},
  {key:'catalog', label:'পণ্য ক্যাটালগ', icon:'📖', roles:['admin','manager']},
  {key:'productsales', label:'পণ্য বিক্রয় রিপোর্ট', icon:'📈', roles:['admin','manager']},
  {key:'purchases', label:'ক্রয় খাতা', icon:'🛒', roles:['admin','manager']},
  {key:'expenses', label:'খরচ খাতা', icon:'💸', roles:['admin','manager']},
  {key:'dues', label:'বকেয়া হিসাব', icon:'📒', roles:['admin','manager']},
  {key:'shareholders', label:'শেয়ারহোল্ডার ও কেনাকাটা', icon:'🤝', roles:['admin']},
  {key:'returns', label:'রিটার্ন ও সমন্বয়', icon:'🔄', roles:['admin','manager']},
  {key:'discounts', label:'ছাড় ও বাড়তি রেজিস্টার', icon:'🏷️', roles:['admin','manager']},
  {key:'inventory', label:'ইনভেন্টরি রিপোর্ট', icon:'📋', roles:['admin','manager']},
  {key:'profitloss', label:'লাভ-ক্ষতি', icon:'📊', roles:['admin']},
  {key:'closing', label:'মাস ক্লোজিং ও লক', icon:'🔒', roles:['admin']},
  {key:'stockcheck', label:'স্টক মূল্য যাচাই', icon:'🧮', roles:['admin']},
  {key:'invoice', label:'ইনভয়েস', icon:'🧾', roles:['admin','manager']},
  {key:'settings', label:'সেটিংস', icon:'⚙️', roles:['admin']}
];

let currentPage = 'dashboard';

function toggleSidebar(){
  const open = document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('show', open);
}

function renderNav(){
  const session = getSession();
  const nav = document.getElementById('sideNav');
  const items = NAV_ITEMS.filter(i => i.roles.includes(session.role));
  nav.innerHTML = items.map(i => `
    <button class="nav-item ${currentPage===i.key?'active':''}" onclick="go('${i.key}')">
      <span>${i.label}</span><span>${i.icon}</span>
    </button>`).join('');

  { const ml = document.getElementById('manualLink'); if(ml) ml.classList.toggle('hidden', session.role!=='admin'); }   // নির্দেশিকা শুধু অ্যাডমিনের জন্য
  const u = (CACHE.users||{})[session.role] || {};
  document.getElementById('sessionInfo').textContent = 'লগইন: ' + ROLE_BN[session.role] + (u.name ? ' (' + u.name + ')' : '') + ' · ☁️ লাইভ';
}

function go(page){
  const session = getSession();
  if(session.role==='admin' && allLoaded() && needsSetup()){ renderSetup(); return; }
  const allowed = NAV_ITEMS.find(i=>i.key===page);
  if(allowed && !allowed.roles.includes(session.role)) page = NAV_ITEMS.find(i=>i.roles.includes(session.role)).key;
  currentPage = page;
  FLASH = null;
  window.scrollTo(0,0);
  renderNav();
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
  const titles = Object.fromEntries(NAV_ITEMS.map(i=>[i.key,i.label]));
  document.getElementById('pageTitle').textContent = titles[page] || '';
  { const eb = document.getElementById('exportBtns'); if(eb) eb.classList.remove('hidden'); }
  const renderers = {
    dashboard: renderDashboard, products: renderProducts, orders: renderOrders,
    purchases: renderPurchases, expenses: renderExpenses, dues: renderDues, returns: renderReturns, discounts: renderDiscounts, inventory: renderInventory, shareholders: renderShareholders, profitloss: renderProfitLoss, closing: renderClosing, stockcheck: renderStockCheck, leaflet: renderLeaflet, catalog: renderCatalog, productsales: renderProductSales,
    invoice: renderInvoice, settings: renderSettings,
      weborders: () => renderWebOrders(), webshop: () => renderWebShop()
  };
  (renderers[page] || renderDashboard)();
}

/* ---------------- Boot ---------------- */
function boot(){
  let session = getSession();
  if(session && allLoaded() && !sessionValid(session)){ localStorage.removeItem('AM_session'); session = null; }
  if(session){
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    go(NAV_ITEMS.find(i=>i.roles.includes(session.role)).key);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appShell').classList.add('hidden');
    refreshLoginMode();
    if(!allLoaded()){
      document.getElementById('loginFormWrap').classList.add('hidden');
      document.getElementById('loginStatus').textContent = '☁️ ক্লাউড ডেটাবেজের সাথে সংযোগ করা হচ্ছে...';
    } else {
      document.getElementById('loginStatus').textContent = '';
    }
  }
}
document.addEventListener('DOMContentLoaded', () => { initFirebase(); boot(); });

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* installability is a bonus, never block the app on it */ });
  });
}

/* ============================================================
   MONTHLY ACCOUNTS — মাসভিত্তিক হিসাব, জের (carry-forward) ও লক
   সব হিসাব তারিখযুক্ত এন্ট্রি থেকে বের হয়, তাই আগের মাসে কিছু যোগ/সংশোধন করলে
   পরের মাসগুলোর শুরুর জের নিজে থেকেই ঠিক হয়ে যায়। লক করা মাসের হিসাব "স্ন্যাপশট" হিসেবে স্থির থাকে।
   ============================================================ */
const BN_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
/* ---- হিসাবের "মাস" = ১৬ তারিখ থেকে পরের মাসের ১৫ তারিখ ----
   যেমন ১৬ অক্টোবর – ১৫ নভেম্বর = "অক্টোবর"। মাসের চাবি (key) এখনো "YYYY-MM" (শুরুর মাসের নামে), তাই
   ডেটাবেজে রাখা কোনো তারিখ বদলাতে হয় না — তারিখ দেখে মাস নিজে থেকেই হিসাব হয়। */
const PERIOD_START_DAY = 16;
const BN_MONTHS_SHORT = ['জানু','ফেব্রু','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টে','অক্টো','নভে','ডিসে'];
function bnNum(n){ return String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]); }
function monthLabel(m){ const p = String(m).split('-'); return (BN_MONTHS[Number(p[1])-1] || p[1]) + ' ' + p[0]; }
function mOf(d){
  if(!(typeof d==='string' && /^\d{4}-\d{2}/.test(d))) return '';
  if(d.length < 10) return d.slice(0,7);                       // শুধু বছর-মাস থাকলে যেমন আছে
  return Number(d.slice(8,10)) >= PERIOD_START_DAY ? d.slice(0,7) : addMonths(d.slice(0,7), -1);
}
function curMonth(){ return mOf(todayStr()); }
function addMonths(m, n){
  const p = m.split('-'); const d = new Date(Date.UTC(Number(p[0]), Number(p[1])-1+n, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0');
}
function monthStart(m){ return m + '-' + String(PERIOD_START_DAY).padStart(2,'0'); }                       // মাসের প্রথম দিন (১৬)
function monthEnd(m){ return addMonths(m, 1) + '-' + String(PERIOD_START_DAY-1).padStart(2,'0'); }        // মাসের শেষ দিন (পরের মাসের ১৫)
function monthRangeText(m){
  const a = Number(String(m).split('-')[1]), b = Number(String(addMonths(m,1)).split('-')[1]);
  return `${bnNum(PERIOD_START_DAY)} ${BN_MONTHS_SHORT[a-1]} – ${bnNum(PERIOD_START_DAY-1)} ${BN_MONTHS_SHORT[b-1]}`;
}
function fmtDT(iso){ try{ return new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Dhaka', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}); }catch(e){ return ''; } }
const r2 = n => Math.round(Number(n||0)*100)/100;
function closingRec(m){ return (CACHE.closings||[]).find(c=>c.month===m); }
function isMonthLocked(m){ const c = closingRec(m); return !!(c && c.locked); }
function isDateLocked(d){ const m = mOf(d); return !!m && isMonthLocked(m); }
function guardDates(dates, what){
  for(const d of dates){
    if(d && isDateLocked(d)){
      alert(`🔒 ${monthLabel(mOf(d))} মাসের হিসাব লক করা আছে — ${what} করা যাবে না।\n\nবিশেষ প্রয়োজনে অ্যাডমিন "মাস ক্লোজিং ও লক" পেইজ থেকে লক খুলে কাজ করে আবার লক করতে পারবেন।`);
      return false;
    }
  }
  return true;
}
function guardDate(d, what){ return guardDates([d], what); }
// যে মাসগুলোতে কোনো এন্ট্রি আছে (+ চলমান মাস + লক করা মাস), পুরোনো থেকে নতুন
function monthsList(){
  const set = new Set([curMonth()]);
  [CACHE.orders, CACHE.purchases, CACHE.expenses, CACHE.returns, CACHE.contributions, CACHE.investments].forEach(a => (a||[]).forEach(x => { const m = mOf(x.date); if(m) set.add(m); }));
  (CACHE.closings||[]).forEach(c => set.add(c.month));
  return Array.from(set).sort();
}
function moveIndex(){
  const idx = {}, ordMap = {}, retMap = {};
  CACHE.orders.forEach(o => ordMap[o.id] = o);
  const slot = (pid, m) => { const a = idx[pid] || (idx[pid] = {}); return a[m] || (a[m] = {P:0,S:0,R:0,A:0}); };
  CACHE.purchases.forEach(pu => { const m = mOf(pu.date); if(m && pu.productId) slot(pu.productId, m).P += Number(pu.qty||0); });
  CACHE.returns.forEach(r => {
    const o = ordMap[r.orderId];
    const restocked = (r.restocked!==undefined) ? !!r.restocked : !!(o && o.status==='Delivered');
    if(!restocked) return;
    const m = mOf(r.date); if(m) slot(r.productId, m).R += Number(r.qty||0);
    const rm = retMap[r.orderId] || (retMap[r.orderId] = {});
    rm[r.productId] = (rm[r.productId]||0) + Number(r.qty||0);
  });
  CACHE.orders.forEach(o => {
    if(o.status!=='Delivered') return;
    const m = mOf(o.date); if(!m) return;
    const rm = Object.assign({}, retMap[o.id] || {});
    orderItems(o).forEach(it => { const extra = rm[it.productId] || 0; delete rm[it.productId]; slot(it.productId, m).S += Number(it.qty||0) + extra; });
    Object.keys(rm).forEach(pid => { slot(pid, m).S += rm[pid]; });
  });
  CACHE.products.forEach(p => (p.adj||[]).forEach(a => { const m = mOf(a.d); if(m) slot(p.id, m).A += Number(a.q||0); }));
  return idx;
}
function stockRowFor(p, m, idx){
  const mv = idx[p.id] || {};
  const after = {P:0,S:0,R:0,A:0};
  Object.keys(mv).forEach(k => { if(k > m){ after.P+=mv[k].P; after.S+=mv[k].S; after.R+=mv[k].R; after.A+=mv[k].A; } });
  const cur = mv[m] || {P:0,S:0,R:0,A:0};
  const close = r3(Number(p.stock||0) - (after.P - after.S + after.R + after.A));
  const open = r3(close - (cur.P - cur.S + cur.R + cur.A));
  return {open, P:r3(cur.P), S:r3(cur.S), R:r3(cur.R), A:r3(cur.A), close, cost:Number(p.cost||0)};
}
// row = [id, name, unit, open, purchased, sold, returned, adjust, close, cost, hidden]
function liveFigures(m, idx){
  idx = idx || moveIndex();
  const products = CACHE.products;
  const ords = CACHE.orders.filter(o => o.status==='Delivered' && mOf(o.date)===m);
  const revenue = ords.reduce((t,o) => t + Number(o.total||0), 0);
  const cogs = ords.reduce((t,o) => t + orderItems(o).reduce((t2,it) => { const p = products.find(x=>x.id===it.productId); return t2 + (p ? Number(p.cost||0) : 0) * Number(it.qty||0); }, 0), 0);
  const expenses = CACHE.expenses.filter(e => e.kind!=='income' && mOf(e.date)===m).reduce((t,e) => t + Number(e.amount||0), 0);
  const otherIncome = CACHE.expenses.filter(e => e.kind==='income' && mOf(e.date)===m).reduce((t,e) => t + Number(e.amount||0), 0);
  const rows = []; let openVal = 0, closeVal = 0;
  products.forEach(p => {
    const r = stockRowFor(p, m, idx);
    openVal += r.open * r.cost; closeVal += r.close * r.cost;
    if(r.open || r.P || r.S || r.R || r.A || r.close || !p.hidden) rows.push([p.id, p.name, p.unit||'কেজি', r.open, r.P, r.S, r.R, r.A, r.close, r.cost, p.hidden?1:0]);
  });
  const custDueNew = CACHE.orders.filter(o => o.status!=='Cancelled' && mOf(o.date)===m).reduce((t,o) => t + orderDue(o), 0);
  const supDueNew = CACHE.purchases.filter(pu => mOf(pu.date)===m).reduce((t,pu) => t + purchaseDue(pu), 0);
  const cap = CACHE.shareholders.map(sh => {
    const after = CACHE.contributions.filter(c => c.shareholderId===sh.id && mOf(c.date) > m).reduce((t,c) => t + Number(c.amount||0), 0);
    return [sh.id, sh.name, Math.max(0, r2(Number(sh.totalInvested||0) - after))];
  });
  return {revenue:r2(revenue), cogs:r2(cogs), expenses:r2(expenses), otherIncome:r2(otherIncome), rows, openVal:r2(openVal), closeVal:r2(closeVal),
          custDueNew:r2(custDueNew), supDueNew:r2(supDueNew), cap, pct:CACHE.settings.dividendPercent};
}
function monthData(m, idx){
  const c = closingRec(m);
  let d;
  if(c && c.locked && c.snap){ d = {...c.snap, locked:true, lockedAt:c.lockedAt}; }
  else { d = liveFigures(m, idx); d.locked = false; }
  d.month = m;
  d.gross = r2(d.revenue - d.cogs);
  d.net = r2(d.gross + d.otherIncome - d.expenses);
  d.pool = 0;
  d.retained = d.net;   // শেয়ারহোল্ডার বণ্টন নেই — পুরো নিট লাভই জের হিসেবে যায়
  return d;
}
function carryForward(m, idx){
  let t = 0;
  monthsList().filter(x => x < m).forEach(x => { t += monthData(x, idx).retained; });
  return r2(t);
}
function monthOptionsHtml(selected, includeAll){
  const cur = curMonth();
  return (includeAll ? `<option value="all" ${selected==='all'?'selected':''}>সব মাস</option>` : '') +
    monthsList().slice().reverse().map(m => `<option value="${m}" ${m===selected?'selected':''}>${monthLabel(m)} (${monthRangeText(m)})${isMonthLocked(m)?' 🔒':''}${m===cur?' · চলমান':''}</option>`).join('');
}
function monthStatusHtml(m){
  const cur = curMonth();
  if(isMonthLocked(m)){ const c = closingRec(m); return `<div class="flash warn" style="margin-bottom:14px;">🔒 <b>${monthLabel(m)}</b> (${monthRangeText(m)}) মাসের হিসাব লক করা আছে (${fmtDT(c.lockedAt)}) — এই পেইজের সংখ্যাগুলো স্থির, কোনো পরিবর্তন হবে না।</div>`; }
  if(m === cur) return `<div class="flash" style="margin-bottom:14px;">📅 <b>${monthLabel(m)}</b> (${monthRangeText(m)}) — চলমান মাস। হিসাব প্রতিদিনের এন্ট্রি অনুযায়ী বদলাচ্ছে। আগের মাসের জের নিজে থেকেই যোগ হয়েছে।</div>`;
  if(m < cur) return `<div class="flash" style="margin-bottom:14px;">🔓 <b>${monthLabel(m)}</b> (${monthRangeText(m)}) — এই মাস এখনো লক হয়নি। হিসাব মিলিয়ে দেখে ${isAdmin()?'"মাস ক্লোজিং ও লক" পেইজ থেকে':'অ্যাডমিনকে বলে'} লক করুন।</div>`;
  return '';
}
let VIEW_MONTH = curMonth();
function onViewMonth(sel){ VIEW_MONTH = sel.value; (currentPage==='profitloss' ? renderProfitLoss : renderInventory)(); }
function viewMonthReport(m, page){ VIEW_MONTH = m; go(page); }

function snapshotOf(m){ const f = liveFigures(m); return f; }
function lockMonth(m){
  if(!isAdmin()){ alert('মাস লক করা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  if(m >= curMonth()){ alert('চলমান মাস শেষ হওয়ার পরই সেই মাস লক করা যাবে।'); return; }
  const earlier = monthsList().filter(x => x < m && !isMonthLocked(x));
  if(earlier.length){ alert(`আগে ${monthLabel(earlier[0])} মাস লক করুন — মাস লক করতে হয় ক্রমানুসারে (পুরোনো থেকে নতুন)।`); return; }
  const f = monthData(m);
  if(!confirm(`${monthLabel(m)} (${monthRangeText(m)}) মাসের হিসাব ক্লোজ ও লক করবেন?\n\nবিক্রয়: ${money(f.revenue)}\nনিট লাভ: ${money(f.net)}\nমাস শেষের স্টকের মূল্য: ${money(f.closeVal)}\n\nলক করলে এই মাসের তারিখে কোনো অর্ডার/ক্রয়/খরচ/আয় যোগ, সংশোধন বা মোছা যাবে না। মাস শেষের স্টক ও নিট প্রফিট পরের মাসে জের হিসেবে যোগ হবে।`)) return;
  const now = new Date().toISOString();
  const old = closingRec(m) || {};
  const list = (CACHE.closings||[]).filter(c => c.month !== m);
  list.push({month:m, locked:true, lockedAt:now, lockedBy:'admin', snap:snapshotOf(m), log:(old.log||[]).concat([{t:now, a:'lock'}])});
  saveCollection('closings', list);
  setFlash('closing', `✅ ${monthLabel(m)} মাসের হিসাব ক্লোজ ও লক হয়েছে। মাস শেষের স্টক ও জমা পরের মাসে জের হিসেবে যোগ হয়ে গেছে।`, []);
  renderClosing(); toTop();
}
async function unlockMonth(m){
  if(!isAdmin()){ alert('লক খোলা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const later = (CACHE.closings||[]).filter(c => c.locked && c.month > m).map(c => c.month).sort();
  let msg = `🔓 ${monthLabel(m)} মাসের লক খুলবেন?\n\nলক খুলে যা যোগ/সংশোধন করার করুন, তারপর অবশ্যই আবার লক করবেন।`;
  if(later.length) msg += `\n\n⚠️ এই মাসের পরিবর্তন পরের মাসগুলোর শুরুর জের বদলে দেয়, তাই এর পরের লক করা মাসগুলোও (${later.map(monthLabel).join(', ')}) খুলে যাবে। কাজ শেষে পুরোনো থেকে নতুন ক্রমে আবার লক করতে হবে।`;
  if(!confirm(msg)) return;
  if(!(await confirmAdminPassword('লক খুলতে নিজের অ্যাডমিন পাসওয়ার্ড দিন।'))) return;
  const why = prompt('লক খোলার কারণ লিখুন (ঐচ্ছিক):') || '';
  const now = new Date().toISOString(), tgt = [m].concat(later);
  const list = (CACHE.closings||[]).map(c => tgt.includes(c.month)
    ? {month:c.month, locked:false, lockedAt:c.lockedAt, lockedBy:c.lockedBy, unlockedAt:now, log:(c.log||[]).concat([{t:now, a:'unlock', why: c.month===m ? why : 'আগের মাস খোলার কারণে'}])}
    : c);
  saveCollection('closings', list);
  setFlash('closing', `🔓 ${tgt.map(monthLabel).join(', ')} খোলা হয়েছে। প্রয়োজনীয় কাজ শেষে আবার লক করুন।`, [], true);
  renderClosing(); toTop();
}
function closingBanner(){
  if(!isAdmin()) return '';
  const open = monthsList().filter(m => m < curMonth() && !isMonthLocked(m));
  if(!open.length) return '';
  return `<div class="alert-strip" style="background:#FCEBD5;border-color:#F0D3A0;color:#8A5A16;">🔒 <b>${monthLabel(open[0])}</b>${open.length>1?` সহ ${open.length}টি আগের মাস`:' মাস'} এখনো ক্লোজ ও লক করা হয়নি। <a href="#" onclick="go('closing');return false;" style="color:inherit;font-weight:700;">মাস ক্লোজিং ও লক পেইজে যান</a></div>`;
}
function renderClosing(){
  const cur = curMonth(), ml = monthsList(), idx = moveIndex();
  const cd = monthData(cur, idx);
  const oldCust = CACHE.orders.filter(o => o.status!=='Cancelled' && mOf(o.date) < cur).reduce((t,o) => t + orderDue(o), 0);
  const oldSup = CACHE.purchases.filter(pu => mOf(pu.date) < cur).reduce((t,pu) => t + purchaseDue(pu), 0);
  const rows = ml.slice().reverse().map(m => {
    const d = monthData(m, idx);
    const earlier = ml.filter(x => x < m && !isMonthLocked(x));
    let action;
    if(d.locked) action = `<button class="btn btn-outline btn-sm" onclick="unlockMonth('${m}')">🔓 লক খুলুন</button>`;
    else if(m >= cur) action = `<span class="muted-cell">${m===cur?'চলমান মাস':'ভবিষ্যতের মাস'}</span>`;
    else if(earlier.length) action = `<span class="muted-cell">আগে ${monthLabel(earlier[0])} লক করুন</span>`;
    else action = `<button class="btn btn-primary btn-sm" onclick="lockMonth('${m}')">🔒 ক্লোজ ও লক করুন</button>`;
    return `<tr>
      <td><b>${monthLabel(m)}</b><br><span class="muted-cell" style="font-size:11.5px;">${monthRangeText(m)}</span></td>
      <td class="cell-center">${d.locked ? '<span class="badge badge-locked">🔒 লক</span>' : '<span class="badge badge-open">খোলা</span>'}</td>
      <td class="cell-num">${money(d.revenue)}</td>
      <td class="cell-num">${money(d.net)}</td>
      <td class="cell-num">${money(d.closeVal)}</td>
      <td class="cell-center">${action}</td>
      <td class="cell-center"><button class="icon-btn" title="ইনভেন্টরি রিপোর্ট" onclick="viewMonthReport('${m}','inventory')">📋</button><button class="icon-btn" title="লাভ-ক্ষতি" onclick="viewMonthReport('${m}','profitloss')">📊</button></td>
    </tr>`;
  }).join('');
  const logs = [];
  (CACHE.closings||[]).forEach(c => (c.log||[]).forEach(l => logs.push({...l, month:c.month})));
  logs.sort((a,b) => a.t < b.t ? 1 : -1);
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('closing')}
    <div class="panel">
      <h3>চলমান মাস (${monthLabel(cur)} · ${monthRangeText(cur)}) — আগের মাস থেকে যা জের হিসেবে এসেছে</h3>
      <table>
        <tr><td>মাসের শুরুর স্টকের মূল্য (ক্রয়মূল্যে)</td><td class="cell-num">${money(cd.openVal)}</td></tr>
        <tr><td>আগের মাসগুলোর জমা নিট লাভ (জের)</td><td class="cell-num">${money(carryForward(cur, idx))}</td></tr>
        <tr><td>আগের মাসগুলোর কাস্টমার বকেয়া (এখনো বাকি)</td><td class="cell-num">${money(oldCust)}</td></tr>
        <tr><td>আগের মাসগুলোর সরবরাহকারী বকেয়া (এখনো বাকি)</td><td class="cell-num">${money(oldSup)}</td></tr>
      </table>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">এগুলো নিজে থেকেই নতুন মাসে যোগ হয়। আগের মাসে পরে কোনো ক্রয়/খরচ/অর্ডার (পুরোনো তারিখে) যোগ করলে এই জের নিজে থেকেই ঠিক হয়ে যাবে।</p>
    </div>
    <div class="panel">
      <h3>মাসভিত্তিক ক্লোজিং</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">এখানে প্রতিটি মাস ১৬ তারিখ থেকে পরের মাসের ১৫ তারিখ পর্যন্ত (যেমন ১৬ অক্টোবর – ১৫ নভেম্বর = অক্টোবর)। মাস শেষ হলে হিসাব মিলিয়ে "ক্লোজ ও লক করুন" চাপুন। লক করা মাসের তারিখে কোনো অর্ডার, ক্রয়, খরচ/আয় যোগ, সংশোধন বা মোছা যায় না। লক ক্রমানুসারে (পুরোনো থেকে নতুন) করতে হয়।</p>
      <div class="table-wrap"><table><thead><tr>
        <th>মাস</th><th>অবস্থা</th><th>বিক্রয়</th><th>নিট লাভ</th><th>মাস শেষের স্টক মূল্য</th><th>একশন</th><th>রিপোর্ট</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="panel">
      <h3>লক/আনলক ইতিহাস</h3>
      <div class="table-wrap"><table><thead><tr><th>সময়</th><th>মাস</th><th>কাজ</th><th>কারণ</th></tr></thead><tbody>
        ${logs.slice(0,20).map(l => `<tr><td>${fmtDT(l.t)}</td><td>${monthLabel(l.month)}</td><td>${l.a==='lock'?'🔒 লক':'🔓 আনলক'}</td><td>${esc(l.why||'')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">এখনো কোনো মাস লক করা হয়নি</td></tr>'}
      </tbody></table></div>
    </div>`;
}

/* ============================================================
   AVERAGE COST — পণ্যের ক্রয়মূল্য = সেই পণ্যের সব ক্রয় ভাউচারের (মোট খরচ ÷ মোট পরিমাণ)
   প্রতিটি ক্রয় এন্ট্রি/সংশোধন/মোছা/এক্সেল আপলোডে নিজে থেকে হিসাব হয়, তাই ভাউচারের সাথে সফটওয়্যারের দাম মিলে যায়।
   ============================================================ */
function avgCostOf(purchases, pid){
  let q = 0, c = 0;
  purchases.forEach(pu => { if(pu.productId===pid && Number(pu.qty)>0){ q += Number(pu.qty); c += Number(pu.totalCost||0); } });
  return (q>0 && c>0) ? c/q : null;   // পূর্ণ নির্ভুলতা — ছোট দশমিক জমে পার্থক্য হয় না
}
function applyAvgCosts(products, purchases, ids){
  (ids||[]).forEach(pid => {
    if(!pid) return;
    const i = products.findIndex(p => p.id===pid); if(i<0) return;
    const a = avgCostOf(purchases, pid);
    if(a!==null) products[i] = {...products[i], cost: a};
  });
}
function avgCostPlan(){
  const list = [];
  CACHE.products.forEach(p => {
    const a = avgCostOf(CACHE.purchases, p.id);
    if(a!==null && Math.abs(a - Number(p.cost||0)) > 1e-7) list.push({p, oldCost:Number(p.cost||0), newCost:a});
  });
  const valBefore = CACHE.products.reduce((t,p) => t + Math.max(0,Number(p.stock||0))*Number(p.cost||0), 0);
  const map = {}; list.forEach(x => { map[x.p.id] = x.newCost; });
  const valAfter = CACHE.products.reduce((t,p) => t + Math.max(0,Number(p.stock||0))*(map[p.id]!==undefined ? map[p.id] : Number(p.cost||0)), 0);
  return {list, valBefore:r2(valBefore), valAfter:r2(valAfter)};
}
function applyAvgCostsAll(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  const plan = avgCostPlan();
  if(!plan.list.length){ alert('সব পণ্যের ক্রয়মূল্য আগেই ভাউচার গড়ের সাথে মিলে আছে।'); return; }
  if(!confirm(`${plan.list.length}টি পণ্যের ক্রয়মূল্য ক্রয় খাতার ভাউচার গড় অনুযায়ী বদলাবে।\\n\\nমোট স্টক মূল্য: ${money(plan.valBefore)} → ${money(plan.valAfter)}\\n\\nনোট: যেসব পণ্যের ক্রয় এন্ট্রি নেই সেগুলো অপরিবর্তিত থাকবে। লক করা মাসের হিসাব বদলাবে না; লক না করা মাসের লাভ নতুন ক্রয়মূল্যে আবার হিসাব হবে। এগিয়ে যাবেন?`)) return;
  const products = CACHE.products.map(p => ({...p}));
  applyAvgCosts(products, CACHE.purchases, plan.list.map(x => x.p.id));
  if(saveCollection('products', products)){ alert(`✅ ${plan.list.length}টি পণ্যের ক্রয়মূল্য ঠিক হয়েছে।`); renderStockCheck(); }
}

/* ============================================================
   OFFER LEAFLET — অফার লিফলেট (ক্যানভাসে আঁকা; JPG / PDF / WhatsApp শেয়ার)
   ছবি আলাদা ডকুমেন্টে (img__<পণ্য আইডি>) থাকে, পণ্যের মূল ডেটায় শুধু hasImg চিহ্ন।
   ============================================================ */
const LF_W = 1080, LF_H = 1527, LF_COLS = 3, LF_CELLS = 12;
const LF_FONT = '"Noto Sans Bengali","Nirmala UI","Segoe UI",FreeSans,sans-serif';
let LF = null, LF_IMGS = {}, LF_TIMER = null, LF_TOK = 0, LF_LOGO = null;
const bnN = n => Number(n||0).toLocaleString('bn-BD', {maximumFractionDigits:2});
const bnTaka = n => '৳' + bnN(n);

function lfProd(id){ return CACHE.products.find(p => p.id===id); }
function lfBase(p){ return packPrice(p, 'retail'); }
function lfUnitLabel(p){ const u = p.unit || 'কেজি', n = Number(p.priceBasis)||1; if(n!==1) return `${bnN(n)} ${u}`; return /[0-9০-৯]/.test(u) ? u : 'প্রতি ' + u; }
function lfPriceInfo(it, p){
  const base = lfBase(p), v = Number(it.val)||0;
  let now = base, old = null, badge = null;
  if(it.type==='newprice' && v>0){ now = v; old = base; if(base>v) badge = {t:'৳'+bnN(base-v), s:'ছাড়!'}; }
  else if(it.type==='amount' && v>0){ now = Math.max(0, base-v); old = base; badge = {t:'৳'+bnN(v), s:'ছাড়!'}; }
  else if(it.type==='percent' && v>0){ now = Math.round(base*(1-v/100)); old = base; badge = {t:bnN(v)+'%', s:'ছাড়!'}; }
  else if(it.type==='bogo'){ now = base*(Number(it.buyQty)||1); }
  return {base, now, old, badge};
}
const LF_GRIDS = {12:{cols:3,rows:4}, 16:{cols:4,rows:4}, 20:{cols:4,rows:5}};
function lfGrid(){ return LF_GRIDS[Number(LF && LF.perPage)] || LF_GRIDS[12]; }
function lfLayout(items){
  const g = lfGrid(), per = g.cols*g.rows, list = items.filter(it => lfProd(it.pid)), pages = [];
  for(let i=0;i<list.length;i+=per) pages.push(list.slice(i,i+per).map((item,k) => ({item, row:Math.floor(k/g.cols), col:k%g.cols})));
  return pages;
}
/* ---- ছবি ---- */
function lfLoadImage(src){ return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
async function lfGetImg(pid){
  const p = lfProd(pid); if(!p || !p.hasImg) return null;
  const c = LF_IMGS[pid]; if(c && c.v===p.imgV) return c.img;
  try{
    const snap = await docRef('img__'+pid).get(); if(!snap.exists) return null;
    const img = await lfLoadImage(snap.data().data); LF_IMGS[pid] = {v:p.imgV, img}; return img;
  }catch(e){ return null; }
}
async function lfProcessFile(file){
  const url = URL.createObjectURL(file); const img = await lfLoadImage(url); URL.revokeObjectURL(url);
  if(!img) throw new Error('ছবি পড়া যায়নি');
  const sc = Math.min(1, 1200/Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1,Math.round(img.naturalWidth*sc)), h = Math.max(1,Math.round(img.naturalHeight*sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', {willReadFrequently:true}); cx.drawImage(img,0,0,w,h);
  const d = cx.getImageData(0,0,w,h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i = (y*w+x)*4; if(d[i+3] < 20) continue;
    if(d[i]>248 && d[i+1]>248 && d[i+2]>248) continue;
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
  }
  if(x1<0){ x0=0; y0=0; x1=w-1; y1=h-1; }
  const pad = Math.round(Math.max(x1-x0, y1-y0)*0.04);
  x0 = Math.max(0,x0-pad); y0 = Math.max(0,y0-pad); x1 = Math.min(w-1,x1+pad); y1 = Math.min(h-1,y1+pad);
  const cw = x1-x0+1, ch = y1-y0+1, s2 = Math.min(1, 640/Math.max(cw,ch));
  const out = document.createElement('canvas'); out.width = Math.max(1,Math.round(cw*s2)); out.height = Math.max(1,Math.round(ch*s2));
  out.getContext('2d').drawImage(cv, x0,y0,cw,ch, 0,0,out.width,out.height);
  let data = out.toDataURL('image/webp', 0.88);
  if(!data.startsWith('data:image/webp')) data = out.toDataURL('image/png');
  if(data.length > 700000){
    const o2 = document.createElement('canvas'); o2.width = out.width; o2.height = out.height;
    const x2 = o2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0,0,o2.width,o2.height); x2.drawImage(out,0,0);
    data = o2.toDataURL('image/jpeg', 0.85);
  }
  return data;
}
async function lfUploadImage(pid, input){
  const file = input.files[0]; input.value = ''; if(!file) return;
  try{
    const data = await lfProcessFile(file), v = Date.now();
    docRef('img__'+pid).set({data, v}).catch(e => saveFailed('ছবি', e));
    const products = CACHE.products.map(p => p.id===pid ? {...p, hasImg:true, imgV:v} : p);
    if(!saveCollection('products', products)) return;
    LF_IMGS[pid] = {v, img: await lfLoadImage(data)};
    lfRenderItems(); lfPreviewSoon();
  }catch(e){ alert('ছবি সংরক্ষণ হয়নি: ' + (e.message||e)); }
}
/* ---- আঁকা ---- */
/* ===== QR কোড (সেটিংস থেকে নিয়ন্ত্রিত) ===== */
let QR_IMG = null, QR_SRC_LOADED = null;
function qrSrc(){ return CACHE.settings.qrImg || 'qr.png'; }
function qrOn(place){ return !!QR_IMG && ((CACHE.settings.qrPlaces || {})[place] !== false); }
async function qrPrep(){ const src = qrSrc(); if(QR_SRC_LOADED === src && QR_IMG) return; QR_IMG = await lfLoadImage(src); QR_SRC_LOADED = QR_IMG ? src : null; }
function qrDraw(c, x, y, size, pad){
  pad = pad || 7; c.save(); c.shadowColor = 'rgba(0,0,0,.18)'; c.shadowBlur = 8; lfRR(c, x, y, size, size, 12); c.fillStyle = '#fff'; c.fill(); c.restore();
  c.imageSmoothingEnabled = false; c.drawImage(QR_IMG, x+pad, y+pad, size-2*pad, size-2*pad); c.imageSmoothingEnabled = true;
}
function qrHeadHtml(){
  const on = (CACHE.settings.qrPlaces || {}).invoice !== false, cap = (CACHE.settings.qrCaption ?? 'স্ক্যান করুন');
  if(!on) return '<div class="qr-spacer"></div>';
  return `<div class="qr-box"><img class="qr" src="${esc(qrSrc())}" alt="QR">${cap ? `<span>${esc(cap)}</span>` : ''}</div>`;
}
function qrCompress(file){
  return new Promise(res => { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => {
    const m = Math.min(1, 420/Math.max(im.width, im.height)), cv = document.createElement('canvas'); cv.width = Math.round(im.width*m); cv.height = Math.round(im.height*m);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,cv.width,cv.height); x.drawImage(im, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/png')); };
    im.onerror = () => res(null); im.src = fr.result; }; fr.onerror = () => res(null); fr.readAsDataURL(file); });
}
async function qrUpload(input){
  const f = input.files[0]; if(!f) return; const d = await qrCompress(f); if(!d){ alert('ছবিটি পড়া যায়নি'); return; }
  saveSettings({...CACHE.settings, qrImg:d}); await qrPrep(); renderSettings();
}
function qrReset(){ const st = {...CACHE.settings}; delete st.qrImg; saveSettings(st); renderSettings(); }
function qrTogglePlace(p, on){ const st = {...CACHE.settings}; st.qrPlaces = {...(st.qrPlaces||{}), [p]:!!on}; saveSettings(st); }
function qrSaveCaption(){ saveSettings({...CACHE.settings, qrCaption:document.getElementById('s_qrcap').value.trim()}); alert('সংরক্ষিত হয়েছে'); }
function qrPanelHtml(){
  const pl = CACHE.settings.qrPlaces || {}, chk = p => pl[p] === false ? '' : 'checked';
  const row = (p, t) => `<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;margin:6px 0;"><input type="checkbox" ${chk(p)} onchange="qrTogglePlace('${p}',this.checked)"> ${t}</label>`;
  return `<div class="panel"><h3>QR কোড</h3>
    <p style="font-size:12.5px;color:var(--text-muted);">ওয়েবসাইট/অর্ডার লিংকের QR ছবি দিন, তারপর কোথায় কোথায় দেখাবে বেছে নিন।</p>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;"><img src="${esc(qrSrc())}" alt="QR" style="width:96px;height:96px;border:1px solid var(--border);border-radius:8px;background:#fff;object-fit:contain;image-rendering:pixelated;">
      <div><input type="file" accept="image/*" onchange="qrUpload(this)"><div style="margin-top:6px;"><button class="btn btn-outline btn-sm" onclick="qrReset()">ডিফল্ট QR-এ ফিরুন</button></div></div></div>
    <h4 style="margin:12px 0 4px;">যেখানে দেখাবে</h4>
    ${row('leaflet','অফার লিফলেটের ফুটার (মাঝখানে)')}${row('catalog','পণ্য ক্যাটালগের ফুটার (মাঝখানে)')}${row('cover','ক্যাটালগের কভার পাতা')}${row('invoice','ইনভয়েসের হেডার (ডানে) — প্রিন্ট, PDF ও ছবিতে')}
    <div class="form-field"><label>ইনভয়েসে QR-এর নিচের লেখা</label><input id="s_qrcap" value="${esc(CACHE.settings.qrCaption ?? 'স্ক্যান করুন')}"></div>
    <button class="btn btn-primary btn-sm" onclick="qrSaveCaption()">লেখা সংরক্ষণ</button></div>`;
}
/* টেবিলের হেডার ও সংখ্যার কলাম একই দিকে (ডানে) মেলানো */
function alignTables(root){
  (root||document).querySelectorAll('table').forEach(t => {
    const hr = t.tHead && t.tHead.rows[0]; if(!hr) return; const ths = Array.from(hr.cells); if(ths.some(h => h.colSpan > 1)) return;
    const rows = Array.from(t.tBodies).flatMap(b => Array.from(b.rows)).filter(r => r.cells.length === ths.length && !Array.from(r.cells).some(c => c.colSpan > 1));
    ths.forEach((th,i) => {
      let n = 0, ok = rows.length > 0;
      for(const r of rows){ const td = r.cells[i], isN = /(^|\s)(cell-num|sp-num)(\s|$)/.test(td.className); if(isN) n++; else if(td.textContent.trim() !== '' && td.textContent.trim() !== '—') { ok = false; break; } }
      th.classList.toggle('th-num', ok && n > 0);
    });
  });
}
(function(){ let q = 0; const run = () => { q = 0; alignTables(document.body); };
  document.addEventListener('DOMContentLoaded', () => { new MutationObserver(() => { if(!q) q = requestAnimationFrame(run); }).observe(document.body, {childList:true, subtree:true}); });
})();
function lfRR(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function lfF(wt, size){ return `${wt} ${size}px ${LF_FONT}`; }
function lfWrap(c, text, maxW, maxLines){
  const words = String(text||'').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for(const w of words){ const t = cur ? cur+' '+w : w; if(!cur || c.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = w; } }
  if(cur) lines.push(cur);
  if(lines.length > maxLines){
    let last = lines.slice(maxLines-1).join(' '); const out = lines.slice(0, maxLines-1);
    while(c.measureText(last+'…').width > maxW && last.length > 1) last = last.slice(0,-1);
    out.push(last+'…'); return out;
  }
  return lines;
}
function lfFit(c, text, maxW, size, min, wt){ let s = size; c.font = lfF(wt, s); while(s > min && c.measureText(text).width > maxW){ s -= 2; c.font = lfF(wt, s); } return s; }
function lfContain(c, img, x, y, w, h){
  const r = Math.min(w/img.naturalWidth, h/img.naturalHeight), dw = img.naturalWidth*r, dh = img.naturalHeight*r;
  c.drawImage(img, x+(w-dw)/2, y+(h-dh)/2, dw, dh);
}
function lfBadge(c, cx, cy, r, top, bottom, fill, color){
  c.save(); c.translate(cx,cy); c.rotate(8*Math.PI/180);
  c.shadowColor = 'rgba(0,0,0,.22)'; c.shadowBlur = 8; c.shadowOffsetY = 3;
  c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.fillStyle = fill; c.fill();
  c.shadowColor = 'transparent'; c.lineWidth = 4; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  lfFit(c, top, r*1.55, 34, 20, 800); c.fillText(top, 0, bottom ? -2 : 10);
  if(bottom){ c.font = lfF(800, 20); c.fillText(bottom, 0, 24); }
  c.restore();
}
function lfGlow(c, x, y, w, h){
  const g = c.createRadialGradient(x+w/2, y+h/2, 8, x+w/2, y+h/2, Math.max(w,h)*0.62);
  g.addColorStop(0, 'rgba(31,120,200,.16)'); g.addColorStop(1, 'rgba(31,120,200,0)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
}
function lfNoImg(c, name, x, y, w, h){
  lfRR(c, x+w*0.2, y+h*0.12, w*0.6, h*0.76, 14); c.fillStyle = '#EEF3F8'; c.fill();
  c.fillStyle = '#9AAEC4'; c.font = lfF(600, 20); c.textAlign = 'center'; c.fillText('ছবি নেই', x+w/2, y+h/2+6);
}
function lfPill(c, text, x, y, size, bg, fg){
  c.font = lfF(700, size); const tw = c.measureText(text).width, h = size+12, w = tw+22;
  lfRR(c, x, y, w, h, h/2); c.fillStyle = bg; c.fill(); c.fillStyle = fg; c.textAlign = 'left'; c.fillText(text, x+11, y+h-8); return w;
}
function lfBadge2(c, cx, cy, r, top, big){
  c.save(); c.translate(cx,cy); c.rotate(-6*Math.PI/180);
  c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 9; c.shadowOffsetY = 3;
  c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.fillStyle = '#E5392B'; c.fill();
  c.shadowColor = 'transparent'; c.lineWidth = Math.max(3, r*0.07); c.strokeStyle = '#fff'; c.stroke();
  c.beginPath(); c.arc(0,0,r*0.86,0,Math.PI*2); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#fff'; lfFit(c, top, r*1.5, Math.round(r*0.4), 12, 700); c.fillText(top, 0, -r*0.14);
  c.fillStyle = '#FFE066'; lfFit(c, big, r*1.55, Math.round(r*0.7), 16, 800); c.fillText(big, 0, r*0.52);
  c.restore();
}
function lfBogoImages(c, imgs, p, fp, zx, zy, zw, zh){
  const a = imgs[p.id], b = imgs[fp.id];
  if(fp.id===p.id){
    const bw = zw*0.66, bh = zh*0.9;
    if(a){ c.save(); c.globalAlpha = 0.95; lfContain(c, a, zx+zw*0.30, zy+zh*0.04, bw*0.92, bh*0.92); c.restore(); lfContain(c, a, zx+zw*0.04, zy+zh*0.08, bw, bh); }
    else lfNoImg(c, p.name, zx, zy, zw, zh);
  } else {
    if(b) lfContain(c, b, zx+zw*0.47, zy+zh*0.16, zw*0.50, zh*0.80); else lfNoImg(c, fp.name, zx+zw*0.47, zy+zh*0.16, zw*0.5, zh*0.8);
    if(a) lfContain(c, a, zx+zw*0.01, zy+zh*0.04, zw*0.52, zh*0.92); else lfNoImg(c, p.name, zx, zy, zw*0.52, zh);
  }
}
function lfCard(c, cell, x, y, w, h, s, imgs){
  const it = cell.item, p = lfProd(it.pid), bogo = it.type==='bogo', pi = lfPriceInfo(it, p);
  const fp = (bogo && lfProd(it.freePid)) || p, diff = bogo && fp.id!==p.id;
  const bq = Number(it.buyQty)||1, fq = Number(it.freeQty)||1;
  c.save(); c.shadowColor = 'rgba(18,38,63,.12)'; c.shadowBlur = 12*s; c.shadowOffsetY = 4*s;
  lfRR(c, x, y, w, h, 22*s); c.fillStyle = '#fff'; c.fill(); c.restore();
  const zx = x+8*s, zy = y+8*s, zw = w-16*s, zh = Math.round(h*0.54);
  lfGlow(c, zx, zy, zw, zh);
  if(bogo) lfBogoImages(c, imgs, p, fp, zx, zy, zw, zh);
  else { const im = imgs[it.pid]; if(im) lfContain(c, im, zx+8*s, zy+4*s, zw-16*s, zh-6*s); else lfNoImg(c, p.name, zx, zy, zw, zh); }
  c.textBaseline = 'alphabetic';
  lfPill(c, lfUnitLabel(p), x+10*s, zy+zh-(17*s+12)-2, Math.max(12, Math.round(17*s)), 'rgba(238,243,248,.95)', '#4D6079');
  if(bogo){ const r = Math.max(34, Math.round(56*s)); lfBadge2(c, x+w-r-6*s, zy+zh-r*0.55, r, `${bnN(bq)}টি কিনলে`, `${bnN(fq)}টি ফ্রি`); }
  else if(pi.badge){ const r = Math.max(28, Math.round(42*s)); lfBadge(c, x+w-r-8*s, zy+zh-r*0.62, r, pi.badge.t, pi.badge.s, '#E5392B', '#fff'); }
  const nf = Math.max(14, Math.round(24*s)), lh = Math.round(28*s), ny = zy+zh+Math.round(26*s);
  c.fillStyle = '#12263F'; c.font = lfF(700, nf); c.textAlign = 'left';
  if(diff){
    lfWrap(c, p.name, w-24*s, 1).forEach(ln => c.fillText(ln, x+12*s, ny));
    c.fillStyle = '#0E8A55'; c.font = lfF(700, Math.max(13, Math.round(21*s)));
    lfWrap(c, `সাথে ফ্রি: ${fp.name}`, w-24*s, 1).forEach(ln => c.fillText(ln, x+12*s, ny+lh));
  } else lfWrap(c, p.name, w-24*s, 2).forEach((ln,i) => c.fillText(ln, x+12*s, ny+i*lh));
  const pf = Math.max(22, Math.round(42*s)), py = y+h-Math.round(14*s);
  c.font = lfF(800, pf); c.fillStyle = '#17539F'; c.fillText(bnTaka(pi.now), x+12*s, py);
  const nw = c.measureText(bnTaka(pi.now)).width;
  if(pi.old){ c.font = lfF(600, Math.max(14, Math.round(23*s))); c.fillStyle = '#7B8CA3'; const ot = bnTaka(pi.old); c.fillText(ot, x+12*s+nw+10*s, py-2); const ow = c.measureText(ot).width; c.fillRect(x+12*s+nw+8*s, py-Math.round(9*s)-2, ow+4, 2.5); }
  else if(bogo){ c.font = lfF(600, Math.max(13, Math.round(20*s))); c.fillStyle = '#6B7C93'; c.fillText(`${bnN(bq)}টির দাম`, x+12*s+nw+10*s, py-2); }
}
function lfV(k){
  const st = CACHE.settings, d = {tagline:st.tagline, footerNote:'ফ্রি হোম ডেলিভারি', footerSub:st.website, phone:st.phone, address:st.businessAddress, disclaimer:'অফার সীমিত সময়ের জন্য, স্টক থাকা সাপেক্ষে'};
  return (LF[k]!==undefined && LF[k]!==null) ? String(LF[k]) : String(d[k]||'');
}
async function lfDrawPage(canvas, cells, pageNo, pageCount, imgs){
  await qrPrep();
  const c = canvas.getContext('2d'); canvas.width = LF_W; canvas.height = LF_H;
  const W = LF_W, H = LF_H, g0 = lfGrid();
  c.fillStyle = '#EAF2FA'; c.fillRect(0,0,W,H);
  let g = c.createLinearGradient(0,0,W,200); g.addColorStop(0,'#17539F'); g.addColorStop(.55,'#1F78C8'); g.addColorStop(1,'#2DB57A');
  c.fillStyle = g; c.fillRect(0,0,W,196);
  c.fillStyle = 'rgba(255,255,255,.10)'; c.beginPath(); c.arc(W-70, -10, 170, 0, Math.PI*2); c.fill();
  if(!LF_LOGO) LF_LOGO = await lfLoadImage('logo.jpg');
  c.save(); c.beginPath(); c.arc(114, 98, 70, 0, Math.PI*2); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.clip();
  if(LF_LOGO) c.drawImage(LF_LOGO, 44, 28, 140, 140); c.restore();
  c.beginPath(); c.arc(114, 98, 70, 0, Math.PI*2); c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const title = (LF.title||'').trim() || 'অফার', tx = 214, tw = W - tx - 36;
  lfFit(c, title, tw, 82, 46, 800); c.fillText(title, tx, 104);
  const tag = lfV('tagline').trim(); if(tag){ c.font = lfF(600, 28); c.fillStyle = 'rgba(255,255,255,.95)'; c.fillText(tag, tx, 150); }
  if((LF.dateText||'').trim()){ const dt = LF.dateText.trim(); c.font = lfF(800, 24); const dw = c.measureText(dt).width + 40; lfRR(c, W-30-dw, 150, dw, 40, 20); c.fillStyle = '#FFC83D'; c.fill(); c.fillStyle = '#12263F'; c.fillText(dt, W-30-dw+20, 178); }
  // cards
  const gx = 30, gy = 214, gapX = 16, gapY = 14, gridH = (H-130-34) - gy;
  const colW = Math.floor((W-60-gapX*(g0.cols-1))/g0.cols), rowH = Math.floor((gridH-gapY*(g0.rows-1))/g0.rows);
  const sc = Math.max(0.6, Math.min(colW/329, rowH/276, 1));
  cells.forEach(cell => lfCard(c, cell, gx+cell.col*(colW+gapX), gy+cell.row*(rowH+gapY), colW, rowH, sc, imgs));
  // footer
  const dis = lfV('disclaimer').trim();
  if(dis || pageCount>1){ c.fillStyle = '#6B7C93'; c.font = lfF(500, 18); c.textAlign = 'center'; c.fillText((dis||'') + (pageCount>1 ? `${dis?'  ·  ':''}পাতা ${bnN(pageNo)}/${bnN(pageCount)}` : ''), W/2, H-142); }
  g = c.createLinearGradient(0,H-130,W,H); g.addColorStop(0,'#17539F'); g.addColorStop(.6,'#1B8A8F'); g.addColorStop(1,'#2DB57A');
  c.fillStyle = g; c.fillRect(0,H-130,W,130);
  c.textAlign = 'left'; c.fillStyle = '#fff';
  const qrL = qrOn('leaflet'), sw = qrL ? 400 : 470;
  if(qrL) qrDraw(c, W/2-57, H-122, 114);
  const note = lfV('footerNote').trim(); if(note){ lfFit(c, note, sw, 40, 26, 800); c.fillText(note, 40, H-70); }
  const sub = lfV('footerSub').trim(); if(sub){ c.font = lfF(600, 24); c.fillText(sub, 40, H-30); }
  c.textAlign = 'right';
  const ph = lfV('phone').trim(); if(ph){ lfFit(c, ph, qrL?400:460, 36, 24, 800); c.fillText(ph, W-40, H-76); }
  c.font = lfF(500, 21); lfWrap(c, lfV('address'), sw, 2).forEach((ln,i) => c.fillText(ln, W-40, H-44+i*24));
  c.textAlign = 'left';
}
async function lfCanvases(){
  try{ await Promise.all([document.fonts.load(lfF(800,40), 'অআকখগ'), document.fonts.load(lfF(600,24), 'অআকখগ'), document.fonts.load(lfF(700,24), 'অআকখগ')]); }catch(e){}
  const pages = lfLayout(LF.items); const pids = new Set();
  pages.forEach(pg => pg.forEach(cell => { pids.add(cell.item.pid); if(cell.item.type==='bogo') pids.add(cell.item.freePid || cell.item.pid); }));
  const imgs = {}; await Promise.all([...pids].map(async id => { imgs[id] = await lfGetImg(id); }));
  const out = [];
  for(let i=0;i<pages.length;i++){ const cv = document.createElement('canvas'); await lfDrawPage(cv, pages[i], i+1, pages.length, imgs); out.push(cv); }
  return out;
}
function lfPreviewSoon(){ clearTimeout(LF_TIMER); LF_TIMER = setTimeout(lfRenderPreview, 250); }
async function lfRenderPreview(){
  const box = document.getElementById('lfPreview'); if(!box || !LF) return;
  const tok = ++LF_TOK;
  if(!LF.items.length){ box.innerHTML = '<p class="muted-cell">পণ্য যোগ করলে এখানে লিফলেটের প্রিভিউ আসবে।</p>'; return; }
  const cans = await lfCanvases(); if(tok !== LF_TOK) return;
  box.innerHTML = ''; cans.forEach((cv,i) => { cv.style.cssText = 'width:100%;max-width:560px;display:block;margin:0 auto 14px;border-radius:12px;box-shadow:0 4px 18px rgba(18,38,63,.18);'; box.appendChild(cv); });
}
/* ---- এক্সপোর্ট ---- */
function lfFileBase(){ return ((LF.title||'লিফলেট').trim() || 'লিফলেট').replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,'-'); }
function lfBlob(cv){ return new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92)); }
function lfSaveBlob(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function lfDownloadJpg(){
  if(!LF.items.length){ alert('আগে পণ্য যোগ করুন'); return; }
  const cans = await lfCanvases();
  for(let i=0;i<cans.length;i++){ lfSaveBlob(await lfBlob(cans[i]), `${lfFileBase()}${cans.length>1?'-পাতা'+(i+1):''}.jpg`); await new Promise(r => setTimeout(r, 450)); }
}
function lfBuildPdf(jpegs, sizes){
  const enc = new TextEncoder(), parts = [], off = []; let pos = 0;
  const push = x => { const b = typeof x==='string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const N = jpegs.length, PW = 595.28, PH = 841.89;
  push('%PDF-1.4\n');
  off[1] = pos; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  off[2] = pos; push(`2 0 obj\n<< /Type /Pages /Kids [${jpegs.map((_,i)=>`${3+3*i} 0 R`).join(' ')}] /Count ${N} >>\nendobj\n`);
  jpegs.forEach((jb,i) => {
    const pg = 3+3*i, ct = 4+3*i, im = 5+3*i, content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    off[pg] = pos; push(`${pg} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);
    off[ct] = pos; push(`${ct} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    off[im] = pos; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${sizes[i][0]} /Height ${sizes[i][1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jb.length} >>\nstream\n`); push(jb); push('\nendstream\nendobj\n');
  });
  const total = 2+3*N, xref = pos;
  push(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
  for(let n=1;n<=total;n++) push(`${String(off[n]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, {type:'application/pdf'});
}
async function lfDownloadPdf(){
  if(!LF.items.length){ alert('আগে পণ্য যোগ করুন'); return; }
  const cans = await lfCanvases(), jp = [], sz = [];
  for(const cv of cans){ jp.push(new Uint8Array(await (await lfBlob(cv)).arrayBuffer())); sz.push([cv.width, cv.height]); }
  lfSaveBlob(lfBuildPdf(jp, sz), lfFileBase() + '.pdf');
}
async function lfShare(){
  if(!LF.items.length){ alert('আগে পণ্য যোগ করুন'); return; }
  const cans = await lfCanvases(), files = [];
  for(let i=0;i<cans.length;i++) files.push(new File([await lfBlob(cans[i])], `${lfFileBase()}${cans.length>1?'-'+(i+1):''}.jpg`, {type:'image/jpeg'}));
  try{
    if(navigator.canShare && navigator.canShare({files})){ await navigator.share({files, title: LF.title||'অফার'}); return; }
  }catch(e){ if(e && e.name==='AbortError') return; }
  for(const f of files){ lfSaveBlob(f, f.name); await new Promise(r => setTimeout(r, 450)); }
  alert('এই ব্রাউজার থেকে সরাসরি শেয়ার হচ্ছে না — ছবি ডাউনলোড হয়েছে। এখন WhatsApp খুলে ছবিটা সংযুক্ত করে পাঠান।');
  window.open('https://wa.me/?text=' + encodeURIComponent((LF.title||'অফার') + ((CACHE.settings.website||'') ? '\n' + CACHE.settings.website : '')), '_blank');
}
/* ---- পেইজ ---- */
function renderLeaflet(){
  const list = CACHE.leaflets.slice().reverse();
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>অফার লিফলেট</h3><button class="btn btn-accent btn-sm" onclick="lfNew()">+ নতুন লিফলেট</button></div>
      <p style="font-size:12.5px;color:var(--text-muted);">পণ্য বাছাই করুন, অফার দিন — লিফলেট নিজে থেকে ডিজাইন হবে। JPG/PDF নামান বা সরাসরি WhatsApp-এ পাঠান। প্রতি পাতায় ১২, ১৬ বা ২০টি পণ্য বেছে নিতে পারবেন; "কিনলে ফ্রি" অফার একই ছবির ঘরের ভেতরেই দেখায়।</p>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>নাম</th><th>পণ্য</th><th>সর্বশেষ</th><th></th></tr></thead><tbody>${list.map(l => `<tr><td>${esc(l.title)}</td><td class="cell-num">${l.items.length}টি</td><td>${esc((l.updatedAt||'').slice(0,10))}</td><td class="cell-center"><button class="btn btn-outline btn-sm" onclick="lfOpen('${l.id}')">খুলুন</button> <button class="icon-btn" title="কপি" onclick="lfCopy('${l.id}')">📄</button> <button class="icon-btn danger" title="মুছুন" onclick="lfDelete('${l.id}')">🗑️</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-cell">এখনো কোনো লিফলেট সংরক্ষণ করা হয়নি।</p>'}
    </div>
    <div id="lfEditor"></div>`;
  if(LF) lfRenderEditor();
}
function lfNew(){ const st = CACHE.settings; LF = {id:'', title:'সাপ্তাহিক অফার', dateText:'', perPage:12, tagline:st.tagline||'', footerNote:'ফ্রি হোম ডেলিভারি', footerSub:st.website||'', phone:st.phone||'', address:st.businessAddress||'', disclaimer:'অফার সীমিত সময়ের জন্য, স্টক থাকা সাপেক্ষে', items:[]}; renderLeaflet(); document.getElementById('lfEditor').scrollIntoView({behavior:'smooth'}); }
function lfOpen(id){ const l = CACHE.leaflets.find(x => x.id===id); if(!l) return; LF = JSON.parse(JSON.stringify(l)); renderLeaflet(); document.getElementById('lfEditor').scrollIntoView({behavior:'smooth'}); }
function lfCopy(id){ const l = CACHE.leaflets.find(x => x.id===id); if(!l) return; const c = JSON.parse(JSON.stringify(l)); c.id = ''; c.title += ' (কপি)'; LF = c; renderLeaflet(); document.getElementById('lfEditor').scrollIntoView({behavior:'smooth'}); }
function lfDelete(id){ if(!confirm('এই লিফলেটটি মুছবেন?')) return; if(LF && LF.id===id) LF = null; saveCollection('leaflets', CACHE.leaflets.filter(x => x.id!==id)); renderLeaflet(); }
function lfClose(){ LF = null; renderLeaflet(); }
function lfSave(){
  if(!LF.title.trim()){ alert('লিফলেটের হেডলাইন লিখুন'); return; }
  if(!LF.items.length){ alert('অন্তত একটি পণ্য যোগ করুন'); return; }
  const arr = CACHE.leaflets.slice(), now = new Date().toISOString();
  if(LF.id){ const i = arr.findIndex(x => x.id===LF.id); if(i>-1) arr[i] = {...LF, updatedAt: now}; else arr.push({...LF, updatedAt: now}); }
  else { LF.id = genId('LF-', arr); arr.push({...LF, updatedAt: now}); }
  if(saveCollection('leaflets', arr)){ alert('✅ লিফলেট সংরক্ষিত হয়েছে'); renderLeaflet(); }
}
function lfField(k, label, ph){
  return `<div class="form-field"><label>${label}</label><input value="${esc(lfV(k))}" placeholder="${esc(ph||'')}" oninput="LF['${k}']=this.value;lfPreviewSoon()"></div>`;
}
function lfFromSettings(){
  const st = CACHE.settings; LF.tagline = st.tagline||''; LF.footerSub = st.website||''; LF.phone = st.phone||''; LF.address = st.businessAddress||'';
  lfRenderEditor();
}
function lfSetPer(v){ LF.perPage = Number(v)||12; lfRenderItems(); lfPreviewSoon(); }
function lfRenderEditor(){
  const box = document.getElementById('lfEditor'), per = Number(LF.perPage)||12;
  box.innerHTML = `
    <div class="panel" style="border:2px solid var(--teal);">
      <div class="panel-head"><h3>${LF.id ? 'লিফলেট সম্পাদনা — ' + LF.id : 'নতুন লিফলেট'}</h3><button class="btn btn-outline btn-sm" onclick="lfClose()">✕ বন্ধ</button></div>
      <h4 style="margin:6px 0;">হেডার (উপরের অংশ)</h4>
      <div class="form-grid">
        ${lfField('title','হেডলাইন (লোগোর পাশে বড় লেখা)')}
        ${lfField('tagline','ট্যাগলাইন (হেডলাইনের নিচে)')}
        <div class="form-field"><label>অফারের মেয়াদ/তারিখ (ঐচ্ছিক)</label><input value="${esc(LF.dateText||'')}" placeholder="যেমন: ০৩ – ০৯ অক্টোবর" oninput="LF.dateText=this.value;lfPreviewSoon()"></div>
      </div>
      <h4 style="margin:12px 0 6px;">ফুটার (নিচের অংশ)</h4>
      <div class="form-grid">
        ${lfField('footerNote','বাঁ পাশের বড় লেখা')}
        ${lfField('footerSub','বাঁ পাশের ছোট লেখা (ওয়েবসাইট ইত্যাদি)')}
        ${lfField('phone','ফোন নম্বর')}
        ${lfField('address','ঠিকানা')}
        ${lfField('disclaimer','নিচের ছোট নোট')}
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="lfFromSettings()">⟲ ট্যাগলাইন, ফোন, ওয়েবসাইট ও ঠিকানা সেটিংস থেকে আনুন</button>
      <div class="form-field" style="margin-top:12px;max-width:260px;"><label>প্রতি পাতায় পণ্য</label>
        <select onchange="lfSetPer(this.value)" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
          <option value="12" ${per===12?'selected':''}>১২টি (বড় ছবি)</option><option value="16" ${per===16?'selected':''}>১৬টি</option><option value="20" ${per===20?'selected':''}>২০টি (সবচেয়ে বেশি)</option></select></div>
      <div class="form-field" style="margin-top:12px;"><label>পণ্য যোগ করুন (নাম লিখে বাছুন)</label>
        <input id="lf_add" list="lf_dl" autocomplete="off" placeholder="পণ্যের নাম লিখুন..." oninput="lfAddByName(this)">
        <datalist id="lf_dl">${CACHE.products.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div id="lfItems"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;">
        <button class="btn btn-primary btn-sm" onclick="lfSave()">💾 সংরক্ষণ</button>
        <button class="btn btn-accent btn-sm" onclick="lfShare()">📤 WhatsApp-এ শেয়ার</button>
        <button class="btn btn-outline btn-sm" onclick="lfDownloadJpg()">🖼️ JPG ডাউনলোড</button>
        <button class="btn btn-outline btn-sm" onclick="lfDownloadPdf()">📄 PDF ডাউনলোড</button>
      </div>
      <div id="lfPreview"></div>
    </div>`;
  lfRenderItems(); lfPreviewSoon();
}
function lfAddByName(inp){
  const v = inp.value.trim().toLowerCase(); if(!v) return;
  const p = CACHE.products.find(x => String(x.name).trim().toLowerCase()===v); if(!p) return;
  LF.items.push({pid:p.id, type:'none', val:0, buyQty:1, freePid:'', freeQty:1}); inp.value = '';
  lfRenderItems(); lfPreviewSoon();
}
function lfImgBlock(pid){
  const p = lfProd(pid); if(!p) return '';
  return `<span class="muted-cell" style="font-size:12px;">${esc(p.name)}: ${p.hasImg ? '✅ ছবি আছে' : '⚠️ ছবি নেই'}</span> <label class="btn btn-outline btn-sm" style="cursor:pointer;">📷 ${p.hasImg?'বদলান':'ছবি দিন'}<input type="file" accept="image/*" class="hidden" onchange="lfUploadImage('${pid}',this)"></label>`;
}
function lfRenderItems(){
  const box = document.getElementById('lfItems'); if(!box) return;
  const pages = lfLayout(LF.items).length;
  const opt = (v,l,cur) => `<option value="${v}" ${cur===v?'selected':''}>${l}</option>`;
  box.innerHTML = `<p style="font-size:13px;margin:6px 0;">মোট <b>${LF.items.length}</b>টি পণ্য · <b>${pages}</b> পাতা (প্রতি পাতায় ${Number(LF.perPage)||12}টি)</p>` + LF.items.map((it,i) => {
    const p = lfProd(it.pid); if(!p) return '';
    const fp = lfProd(it.freePid);
    let extra = '';
    if(it.type==='newprice') extra = `<input type="number" step="any" placeholder="নতুন দাম ৳" value="${it.val||''}" oninput="lfSetNum(${i},'val',this.value)" style="width:120px;">`;
    if(it.type==='amount') extra = `<input type="number" step="any" placeholder="ছাড় ৳" value="${it.val||''}" oninput="lfSetNum(${i},'val',this.value)" style="width:110px;">`;
    if(it.type==='percent') extra = `<input type="number" step="any" placeholder="ছাড় %" value="${it.val||''}" oninput="lfSetNum(${i},'val',this.value)" style="width:100px;">`;
    if(it.type==='bogo') extra = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;width:100%;margin-top:6px;">
        <input type="number" min="1" value="${it.buyQty||1}" oninput="lfSetNum(${i},'buyQty',this.value)" style="width:64px;"> <span style="font-size:13px;">টি কিনলে</span>
        <input type="number" min="1" value="${it.freeQty||1}" oninput="lfSetNum(${i},'freeQty',this.value)" style="width:64px;"> <span style="font-size:13px;">টি ফ্রি — ফ্রি পণ্য একই ছবির ঘরেই দেখাবে:</span>
        <input list="lf_dl" value="${esc(fp?fp.name:'')}" placeholder="ফ্রি পণ্য (ফাঁকা = একই পণ্য)" onchange="lfSetFree(${i},this)" style="flex:1;min-width:160px;"></div>`;
    const priceTxt = it.type==='bogo' ? `${money(lfBase(p)*(Number(it.buyQty)||1))}` : money(lfPriceInfo(it,p).now);
    return `<div class="lf-row" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--bg);">
      <div style="display:flex;gap:6px;align-items:center;justify-content:space-between;"><b style="font-size:14px;">${i+1}. ${esc(p.name)}</b>
        <span><button class="icon-btn" onclick="lfMove(${i},-1)">↑</button><button class="icon-btn" onclick="lfMove(${i},1)">↓</button><button class="icon-btn danger" onclick="lfRemove(${i})">✕</button></span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">
        <select onchange="lfSetType(${i},this.value)" style="padding:7px;border:1px solid var(--border);border-radius:7px;background:#fff;">
          ${opt('none','শুধু দাম',it.type)}${opt('newprice','নতুন দাম (পুরোনো কাটা)',it.type)}${opt('amount','টাকা ছাড়',it.type)}${opt('percent','% ছাড়',it.type)}${opt('bogo','কিনলে ফ্রি (জোড়া)',it.type)}</select>
        ${extra.startsWith('<input') ? extra : ''}<span class="muted-cell" style="font-size:12.5px;">দেখাবে: <b>${priceTxt}</b> (${esc(lfUnitLabel(p))})</span></div>
      ${it.type==='bogo' ? extra : ''}
      <div style="margin-top:6px;">${lfImgBlock(p.id)}${it.type==='bogo' && fp && fp.id!==p.id ? '<br>'+lfImgBlock(fp.id) : ''}</div>
    </div>`;
  }).join('');
}
function lfSetType(i, v){ LF.items[i].type = v; lfRenderItems(); lfPreviewSoon(); }
function lfSetNum(i, k, v){ LF.items[i][k] = Number(v)||0; lfPreviewSoon(); const priceEl = null; }
function lfSetFree(i, inp){
  const v = inp.value.trim().toLowerCase();
  if(!v){ LF.items[i].freePid = ''; } else { const p = CACHE.products.find(x => String(x.name).trim().toLowerCase()===v); if(!p){ alert('এই নামে কোনো পণ্য নেই'); inp.value = ''; return; } LF.items[i].freePid = p.id; }
  lfRenderItems(); lfPreviewSoon();
}
function lfMove(i, d){ const j = i+d; if(j<0 || j>=LF.items.length) return; const t = LF.items[i]; LF.items[i] = LF.items[j]; LF.items[j] = t; lfRenderItems(); lfPreviewSoon(); }
function lfRemove(i){ LF.items.splice(i,1); lfRenderItems(); lfPreviewSoon(); }

/* ============================================================
   EXPORT — প্রতিটি ট্যাবে Excel ও PDF ডাউনলোড (পেইজে যা দেখছেন তা-ই; ভূমিকা অনুযায়ী যে কলাম দেখেন শুধু সেগুলোই)
   ============================================================ */
const EX_SKIP_HEADS = ['একশন','রিপোর্ট',''];
function exClean(s){ return String(s==null?'':s).replace(/[ \t\u00a0]+/g,' ').replace(/ ?\n ?/g,'\n').trim(); }
function exCellText(td){
  const oS = [...td.querySelectorAll('select')], oI = [...td.querySelectorAll('input,textarea')];
  const c = td.cloneNode(true);
  c.querySelectorAll('select').forEach((x,i) => { const o = oS[i], opt = o && o.options[o.selectedIndex]; x.replaceWith(document.createTextNode(opt ? opt.text : '')); });
  c.querySelectorAll('input,textarea').forEach((x,i) => { const o = oI[i]; x.replaceWith(document.createTextNode(o ? o.value : '')); });
  c.querySelectorAll('button,script,style').forEach(b => b.remove());
  c.querySelectorAll('br').forEach(b => b.replaceWith(document.createTextNode('\n')));
  return exClean(c.textContent);
}
function exNow(){ return new Date().toLocaleString('en-GB',{timeZone:'Asia/Dhaka', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}); }
function exModel(){
  const root = document.getElementById('pageContent'); if(!root) return null;
  const tEl = document.getElementById('pageTitle'), title = (tEl && tEl.textContent.trim()) || 'রিপোর্ট';
  const m = {title, when: exNow(), summary: [], tables: []};
  const box = document.getElementById('invoiceBox');
  if(box){
    box.querySelectorAll('.invoice-meta > div').forEach((d,i) => {
      const lines = exClean(d.innerHTML.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')).split('\n').filter(Boolean);
      if(i===0) lines.forEach(l => { const k = l.split(':'); m.summary.push([k[0].trim(), k.slice(1).join(':').trim()]); });
      else m.summary.push(['কাস্টমার', lines.join(', ')]);
    });
  }
  root.querySelectorAll('.stat-card').forEach(cd => {
    const l = cd.querySelector('.label'), v = cd.querySelector('.value'); if(!l || !v) return;
    const sub = cd.querySelector('.sub');
    m.summary.push([exClean(l.textContent), exClean(v.textContent) + (sub ? ' (' + exClean(sub.textContent) + ')' : '')]);
  });
  root.querySelectorAll('.invoice-total-row').forEach(r => { const sp = r.querySelectorAll('span'); if(sp.length>=2) m.summary.push([exClean(sp[0].textContent), exClean(sp[1].textContent)]); });
  root.querySelectorAll('table').forEach(t => {
    if(t.offsetParent===null) return;
    const rows = [...t.rows]; if(!rows.length) return;
    const hr = (t.tHead && t.tHead.rows.length) ? t.tHead.rows[0] : null;
    const head = hr ? [...hr.cells].map(exCellText) : null, body = [];
    rows.forEach(r => { if(r===hr) return; const cells = [...r.cells]; if(cells.length===1 && cells[0].colSpan>1) return; body.push(cells.map(exCellText)); });
    if(!body.length) return;
    const nc = Math.max(head ? head.length : 0, ...body.map(r => r.length)), keep = [];
    for(let ci=0; ci<nc; ci++){
      const hd = head ? (head[ci]||'').trim() : null;
      if((head && EX_SKIP_HEADS.includes(hd)) || body.every(r => !(r[ci]||'').trim())) continue;
      keep.push(ci);
    }
    if(!keep.length) return;
    const panel = t.closest('.panel'), h3 = panel && panel.querySelector('h3');
    m.tables.push({name: exClean(h3 ? h3.textContent : title), head: head ? keep.map(ci => head[ci]||'') : null, rows: body.map(r => keep.map(ci => r[ci]||''))});
  });
  if(currentPage==='leaflet' && typeof LF!=='undefined' && LF && LF.items.length){
    const tl = {none:'শুধু দাম', newprice:'নতুন দাম', amount:'টাকা ছাড়', percent:'% ছাড়', bogo:'কিনলে ফ্রি'};
    m.tables.push({name:'লিফলেটের পণ্য — ' + (LF.title||''), head:['ক্রম','পণ্য','অফারের ধরন','দেখানো দাম (৳)'], rows: LF.items.filter(it => lfProd(it.pid)).map((it,i) => { const p = lfProd(it.pid); return [String(i+1), p.name, tl[it.type]||'', String(lfPriceInfo(it,p).now)]; })});
  }
  if(currentPage==='catalog' && typeof CAT!=='undefined' && CAT){
    const rows = []; catGroups().forEach(g => g.items.forEach(p => rows.push([g.name, p.name, lfUnitLabel(p), CAT.showPrice ? String(packListPrice(p, CAT.priceList)) : '', Number(p.stock)>0 ? 'আছে' : 'নেই'])));
    if(rows.length) m.tables.push({name:'ক্যাটালগের পণ্য তালিকা', head:['ক্যাটাগরি','পণ্য','একক','দাম (৳)','স্টক'], rows});
  }
  return (m.summary.length || m.tables.length) ? m : null;
}
function exFileName(m){ return ('Avera-Mart-' + m.title + '-' + todayStr()).replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,'-'); }
function exVal(t){
  const s = String(t==null?'':t).trim(); if(s==='') return '';
  const money = /^[+−\-]?\s*৳\s*[−\-]?[\d,]+(\.\d+)?$/.test(s) || /^[−\-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s);
  const plain = /^[−\-]?(0|[1-9]\d{0,8})(\.\d+)?$/.test(s);
  if(money || plain){
    const neg = /^[−\-]/.test(s) || /৳\s*[−\-]/.test(s), n = Number(s.replace(/[−\-+৳,\s]/g,''));
    if(!isNaN(n)) return neg ? -n : n;
  }
  return s;
}
function exportExcel(){
  const m = exModel();
  if(!m){ alert('এই পেইজে Excel-এ নামানোর মতো তালিকা বা তথ্য নেই।'); return; }
  if(typeof XLSX==='undefined'){ alert('Excel লাইব্রেরি লোড হয়নি — ইন্টারনেট চেক করে পেইজ রিফ্রেশ করুন।'); return; }
  const wb = XLSX.utils.book_new(), used = new Set();
  const uniq = n => { const b = (String(n).replace(/[\[\]:*?\/\\]/g,' ').trim().slice(0,26) || 'Sheet'); let x = b, i = 2; while(used.has(x.toLowerCase())) x = b + ' ' + (i++); used.add(x.toLowerCase()); return x; };
  const widths = aoa => { const w = []; aoa.forEach(r => r.forEach((v,i) => { const l = Math.min(48, String(v).split('\n').reduce((a,b) => Math.max(a,b.length), 0) + 2); w[i] = Math.max(w[i]||8, l); })); return w.map(x => ({wch:x})); };
  if(m.summary.length){
    const aoa = [['Avera Mart — ' + m.title], [m.when], []].concat(m.summary.map(r => [r[0], exVal(r[1])]));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths(aoa); XLSX.utils.book_append_sheet(wb, ws, uniq('সারসংক্ষেপ'));
  }
  m.tables.forEach(t => {
    const aoa = []; if(t.head) aoa.push(t.head);
    t.rows.forEach(r => aoa.push(r.map(exVal)));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths(aoa); XLSX.utils.book_append_sheet(wb, ws, uniq(t.name));
  });
  XLSX.writeFile(wb, exFileName(m) + '.xlsx');
}
function exBuildPdf(jpegs, dims){
  const enc = new TextEncoder(), parts = [], off = []; let pos = 0;
  const push = x => { const b = typeof x==='string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const N = jpegs.length;
  push('%PDF-1.4\n');
  off[1] = pos; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  off[2] = pos; push(`2 0 obj\n<< /Type /Pages /Kids [${jpegs.map((_,i)=>`${3+3*i} 0 R`).join(' ')}] /Count ${N} >>\nendobj\n`);
  jpegs.forEach((jb,i) => {
    const [wPx,hPx,wPt,hPt] = dims[i], pg = 3+3*i, ct = 4+3*i, im = 5+3*i, content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
    off[pg] = pos; push(`${pg} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);
    off[ct] = pos; push(`${ct} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    off[im] = pos; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jb.length} >>\nstream\n`); push(jb); push('\nendstream\nendobj\n');
  });
  const total = 2+3*N, xref = pos;
  push(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
  for(let n=1;n<=total;n++) push(`${String(off[n]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, {type:'application/pdf'});
}
async function exRenderPdf(m){
  try{ await Promise.all([document.fonts.load(lfF(700,20),'অআকখগ'), document.fonts.load(lfF(500,20),'অআকখগ')]); }catch(e){}
  const tables = (m.summary.length ? [{name:'সারসংক্ষেপ', head:null, rows:m.summary}] : []).concat(m.tables);
  const maxCols = Math.max(0, ...tables.map(t => t.head ? t.head.length : ((t.rows[0]||[]).length)));
  const land = maxCols > 6, PW = land ? 1684 : 1190, PH = land ? 1190 : 1684, MX = 44, TOP = 130, BOT = 64, FS = 19, LH = 26, PAD = 9;
  const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; const c = cv.getContext('2d');
  const FR = lfF(500, FS), FB = lfF(700, FS), availW = PW - 2*MX;
  const wrapText = (txt, maxW, font) => {
    c.font = font; const lines = [];
    String(txt).split('\n').forEach(par => {
      let cur = '';
      par.split(' ').forEach(w => {
        const t = cur ? cur + ' ' + w : w;
        if(!cur || c.measureText(t).width <= maxW){ cur = t; return; }
        lines.push(cur); cur = w;
      });
      while(c.measureText(cur).width > maxW && cur.length > 1){ let k = cur.length; while(k>1 && c.measureText(cur.slice(0,k)).width > maxW) k--; lines.push(cur.slice(0,k)); cur = cur.slice(k); }
      lines.push(cur);
    });
    return lines.slice(0, 8);
  };
  const num = t => /^[+−\-]?\s*৳?\s*[\d,]+(\.\d+)?\s*%?$/.test(String(t).trim());
  const pages = [[]]; let y = TOP;
  const push = cmd => pages[pages.length-1].push(cmd);
  const newPage = () => { pages.push([]); y = TOP; };
  tables.forEach(t => {
    const nc = t.head ? t.head.length : t.rows[0].length;
    const mw = Array(nc).fill(0);
    if(t.head){ c.font = FB; t.head.forEach((h,i) => { mw[i] = Math.max(mw[i], Math.max(...String(h).split('\n').map(l => c.measureText(l).width))); }); }
    c.font = FR; t.rows.slice(0, 300).forEach(r => r.forEach((v,i) => { const w = Math.max(...String(v).split('\n').map(l => c.measureText(l).width)); if(w > mw[i]) mw[i] = w; }));
    let cw = mw.map(w => Math.min(w, 430) + PAD*2); const sum = cw.reduce((a,b) => a+b, 0), sc = Math.min(availW/sum, 1.3);
    cw = cw.map(w => Math.max(64, Math.floor(w*sc)));
    let tot = cw.reduce((a,b) => a+b, 0); if(tot > availW){ const f = availW/tot; cw = cw.map(w => Math.max(40, Math.floor(w*f))); }
    const headCells = t.head ? t.head.map((h,i) => wrapText(h, cw[i]-PAD*2, FB)) : null;
    const headH = headCells ? Math.max(...headCells.map(l => l.length))*LH + 14 : 0;
    const rowsL = t.rows.map(r => r.map((v,i) => wrapText(v, cw[i]-PAD*2, FR)));
    const firstH = rowsL.length ? Math.max(...rowsL[0].map(l => l.length))*LH + 14 : 0;
    if(y + 44 + headH + firstH > PH - BOT) newPage();
    push({k:'title', y, text:t.name}); y += 44;
    const drawHead = () => { if(headCells){ push({k:'head', y, h:headH, cw, cells:headCells}); y += headH; } };
    drawHead();
    rowsL.forEach((cells, ri) => {
      const rh = Math.max(...cells.map(l => l.length))*LH + 14;
      if(y + rh > PH - BOT){ newPage(); push({k:'title', y, text:t.name + ' (চলমান)'}); y += 44; drawHead(); }
      push({k:'row', y, h:rh, cw, cells, alt: ri%2===1, raw:t.rows[ri]}); y += rh;
    });
    y += 26;
  });
  if(!pages[pages.length-1].length && pages.length>1) pages.pop();
  const logo = await lfLoadImage('logo.jpg'), tag = (CACHE.settings.tagline||'').trim(), jpegs = [], dims = [];
  const wPt = land ? 841.89 : 595.28, hPt = land ? 595.28 : 841.89;
  for(let p=0; p<pages.length; p++){
    c.fillStyle = '#fff'; c.fillRect(0,0,PW,PH);
    const g = c.createLinearGradient(0,0,PW,0); g.addColorStop(0,'#17539F'); g.addColorStop(.6,'#1F78C8'); g.addColorStop(1,'#2DB57A');
    c.fillStyle = g; c.fillRect(0,0,PW,96);
    c.save(); c.beginPath(); c.arc(MX+34, 48, 34, 0, Math.PI*2); c.fillStyle = '#fff'; c.fill(); c.clip(); if(logo) c.drawImage(logo, MX, 14, 68, 68); c.restore();
    c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = lfF(800, 34); c.fillText('Avera Mart', MX+86, 46);
    if(tag){ c.font = lfF(500, 17); c.fillText(tag, MX+86, 74); }
    c.textAlign = 'right'; c.font = lfF(800, 30); c.fillText(m.title, PW-MX, 46); c.font = lfF(500, 17); c.fillText(m.when, PW-MX, 74); c.textAlign = 'left';
    pages[p].forEach(cmd => {
      if(cmd.k==='title'){ c.fillStyle = '#12263F'; c.font = lfF(800, 24); c.fillText(cmd.text, MX, cmd.y+24); c.fillStyle = '#C9D6E4'; c.fillRect(MX, cmd.y+32, availW, 2); return; }
      let x = MX;
      if(cmd.k==='head'){
        c.fillStyle = '#17539F'; c.fillRect(MX, cmd.y, cmd.cw.reduce((a,b)=>a+b,0), cmd.h);
        cmd.cells.forEach((lines,i) => { c.fillStyle = '#fff'; c.font = FB; lines.forEach((ln,li) => c.fillText(ln, x+PAD, cmd.y+LH*(li+1)-2+5)); x += cmd.cw[i]; });
        return;
      }
      const tw = cmd.cw.reduce((a,b)=>a+b,0);
      if(cmd.alt){ c.fillStyle = '#F2F6FB'; c.fillRect(MX, cmd.y, tw, cmd.h); }
      c.fillStyle = '#DDE5EE'; c.fillRect(MX, cmd.y+cmd.h-1, tw, 1);
      cmd.cells.forEach((lines,i) => {
        c.font = FR; c.fillStyle = '#12263F'; const right = num(cmd.raw[i]);
        lines.forEach((ln,li) => { c.textAlign = right ? 'right' : 'left'; c.fillText(ln, right ? x+cmd.cw[i]-PAD : x+PAD, cmd.y+LH*(li+1)-2+5); });
        c.textAlign = 'left'; x += cmd.cw[i];
      });
    });
    c.fillStyle = '#C9D6E4'; c.fillRect(MX, PH-46, availW, 1);
    c.fillStyle = '#6B7C93'; c.font = lfF(500, 16); c.textAlign = 'center'; c.fillText(`Avera Mart · পাতা ${bnN(p+1)}/${bnN(pages.length)}`, PW/2, PH-20); c.textAlign = 'left';
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
    jpegs.push(new Uint8Array(await blob.arrayBuffer())); dims.push([PW, PH, wPt, hPt]);
  }
  return exBuildPdf(jpegs, dims);
}
async function exportPdf(){
  const m = exModel();
  if(!m){ alert('এই পেইজে PDF-এ নামানোর মতো তালিকা বা তথ্য নেই।'); return; }
  const btn = document.querySelector('#exportBtns button:nth-child(2)'), old = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.innerHTML = '⏳'; }
  try{ const blob = await exRenderPdf(m); lfSaveBlob(blob, exFileName(m) + '.pdf'); }
  catch(e){ alert('PDF তৈরি হয়নি: ' + (e.message||e)); }
  finally{ if(btn){ btn.disabled = false; btn.innerHTML = old; } }
}

/* ============================================================
   PRODUCT CATALOG — পণ্য ক্যাটালগ (কভার, সূচিপত্র, ক্যাটাগরি ধরে পাতা; PDF / JPG / WhatsApp)
   নাম, একক, দাম, ক্যাটাগরি পণ্য তালিকা থেকে; ছবি লিফলেটের মতোই আলাদা ডকুমেন্টে। ক্রয়মূল্য কখনো যায় না।
   ============================================================ */
let CAT = null, CAT_PREV = 0, CAT_TIMER = null, CAT_TOK = 0;
const CAT_IMG = new Map(), CAT_TOC_ROWS = 24;
function bnYear(y){ return Number(y).toLocaleString('bn-BD', {useGrouping:false}); }
function catDefaults(){
  const st = CACHE.settings, cm = todayStr().split('-');   // ক্যাটালগের তারিখ ক্যালেন্ডার মাসেই
  return {title:'পণ্য ক্যাটালগ', dateText: `${BN_MONTHS[Number(cm[1])-1]} ${bnYear(cm[0])}`, perPage:12, showPrice:true, priceList:'retail', hideZero:true, excludeHidden:true, cover:true, toc:true, cats:{}, catOrder:[],
    tagline: st.tagline||'', footerNote:'ফ্রি হোম ডেলিভারি', footerSub: st.website||'', phone: st.phone||'', address: st.businessAddress||'', disclaimer:'দাম পরিবর্তনযোগ্য, স্টক থাকা সাপেক্ষে'};
}
function catLoad(){
  if(CAT) return;
  CAT = catDefaults();
  try{ const raw = JSON.parse(localStorage.getItem('AM_catalog_opts')||'null'); if(raw && typeof raw==='object') CAT = {...CAT, ...raw}; }catch(e){}
  if(!PRICE_LISTS[CAT.priceList]) CAT.priceList = 'retail';
}
function catSave(){ try{ localStorage.setItem('AM_catalog_opts', JSON.stringify(CAT)); }catch(e){} }
function catVal(k){ return String(CAT[k]==null ? '' : CAT[k]); }
function catGroups(){
  const map = {};
  CACHE.products.forEach(p => {
    if(CAT.excludeHidden && p.hidden) return;
    if(CAT.hideZero && !(Number(p.stock)>0)) return;
    const c = p.category || 'অন্যান্য'; if(CAT.cats[c]===false) return;
    (map[c] = map[c] || []).push(p);
  });
  const names = Object.keys(map);
  catSortNames(names);
  return names.map(n => ({name:n, items: map[n].slice().sort((a,b) => String(a.name).localeCompare(String(b.name),'bn'))}));
}
function catSortNames(names){
  const mine = CAT.catOrder || [], order = CACHE.settings.productCategories || [];
  return names.sort((a,b) => {
    const ma = mine.indexOf(a), mb = mine.indexOf(b);
    if(ma>-1 && mb>-1) return ma-mb; if(ma>-1) return -1; if(mb>-1) return 1;
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if(ia>-1 && ib>-1) return ia-ib; if(ia>-1) return -1; if(ib>-1) return 1;
    return a.localeCompare(b,'bn');
  });
}
function catMoveCat(i, d){
  const names = catSortNames(Object.keys(catAllCats())), j = i+d; if(j<0 || j>=names.length) return;
  [names[i], names[j]] = [names[j], names[i]]; CAT.catOrder = names; catSave(); renderCatalog();
}
function catResetOrder(){ CAT.catOrder = []; catSave(); renderCatalog(); }
function catAllCats(){
  const cnt = {}; CACHE.products.forEach(p => { if(CAT.excludeHidden && p.hidden) return; if(CAT.hideZero && !(Number(p.stock)>0)) return; const c = p.category||'অন্যান্য'; cnt[c] = (cnt[c]||0)+1; });
  return cnt;
}
function catGeom(){
  const g = LF_GRIDS[Number(CAT.perPage)] || LF_GRIDS[12];
  const gx = 30, gy = 214, gapX = 16, gapY = 14, hh = 58, gridH = (LF_H-130-34)-gy;
  const colW = Math.floor((LF_W-60-gapX*(g.cols-1))/g.cols), rowH = Math.floor((gridH-hh-gapY*g.rows)/g.rows);
  const sc = Math.max(0.6, Math.min(colW/329, rowH/276, 1));
  return {g, gx, gy, gapX, gapY, hh, gridH, colW, rowH, sc};
}
function catPlan(){
  const groups = catGroups(), G = catGeom(), g = G.g, catPages = [];
  let cur = null, y = 0;
  const newPage = () => { cur = {type:'cat', blocks:[]}; y = 0; catPages.push(cur); };
  // ক্যাটাগরি শেষ হলে একই পাতায় নিচে পরের ক্যাটাগরির শিরোনাম-ব্যান্ড ও পণ্য শুরু হয়; জায়গা না থাকলে পরের পাতায় চলে
  groups.forEach(gr => {
    for(let i=0;i<gr.items.length;i+=g.cols){
      let head = (i===0);
      if(!cur){ newPage(); head = true; }
      let need = (head ? G.hh+G.gapY : 0) + G.rowH + G.gapY;
      if(y + need > G.gridH + G.gapY){ newPage(); head = true; need = G.hh+G.gapY + G.rowH+G.gapY; }
      if(head){ cur.blocks.push({kind:'head', name:gr.name, cont:i>0, count:gr.items.length}); y += G.hh+G.gapY; }
      cur.blocks.push({kind:'row', items:gr.items.slice(i, i+g.cols)}); y += G.rowH+G.gapY;
    }
  });
  const pages = [], tocN = (CAT.toc && groups.length) ? Math.ceil(groups.length/CAT_TOC_ROWS) : 0;
  if(CAT.cover) pages.push({type:'cover'});
  for(let k=0;k<tocN;k++) pages.push({type:'toc', k});
  catPages.forEach(p => pages.push(p));
  const starts = {}; pages.forEach((p,i) => { p.no = i+1; if(p.type==='cat') p.blocks.forEach(bl => { if(bl.kind==='head' && !bl.cont && !(bl.name in starts)) starts[bl.name] = i+1; }); });
  const total = groups.reduce((t,gr) => t + gr.items.length, 0);
  return {pages, groups, starts, g, total};
}
async function catImg(pid){
  const p = lfProd(pid); if(!p || !p.hasImg) return null;
  const key = pid + ':' + p.imgV; if(CAT_IMG.has(key)) return CAT_IMG.get(key);
  try{
    const snap = await docRef('img__'+pid).get(); if(!snap.exists) return null;
    const img = await lfLoadImage(snap.data().data);
    CAT_IMG.set(key, img); if(CAT_IMG.size > 40) CAT_IMG.delete(CAT_IMG.keys().next().value);
    return img;
  }catch(e){ return null; }
}
function catChrome(c, pill, no, total){
  const W = LF_W, H = LF_H;
  c.fillStyle = '#EAF2FA'; c.fillRect(0,0,W,H);
  let g = c.createLinearGradient(0,0,W,200); g.addColorStop(0,'#17539F'); g.addColorStop(.55,'#1F78C8'); g.addColorStop(1,'#2DB57A');
  c.fillStyle = g; c.fillRect(0,0,W,196);
  c.fillStyle = 'rgba(255,255,255,.10)'; c.beginPath(); c.arc(W-70, -10, 170, 0, Math.PI*2); c.fill();
  c.save(); c.beginPath(); c.arc(114, 98, 70, 0, Math.PI*2); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.clip();
  if(LF_LOGO) c.drawImage(LF_LOGO, 44, 28, 140, 140); c.restore();
  c.beginPath(); c.arc(114, 98, 70, 0, Math.PI*2); c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const title = catVal('title').trim() || 'পণ্য ক্যাটালগ';
  lfFit(c, title, W-214-36, 78, 44, 800); c.fillText(title, 214, 100);
  const tag = catVal('tagline').trim(); if(tag){ c.font = lfF(600, 28); c.fillStyle = 'rgba(255,255,255,.95)'; c.fillText(tag, 214, 146); }
  if(pill){ c.font = lfF(800, 26); let t = pill, tw = c.measureText(t).width; while(tw > 520 && t.length > 4){ t = t.slice(0,-1); tw = c.measureText(t+'…').width; } if(t!==pill) t += '…'; const dw = c.measureText(t).width + 44; lfRR(c, W-30-dw, 148, dw, 42, 21); c.fillStyle = '#FFC83D'; c.fill(); c.fillStyle = '#12263F'; c.fillText(t, W-30-dw+22, 178); }
  const dis = catVal('disclaimer').trim();
  c.fillStyle = '#6B7C93'; c.font = lfF(500, 18); c.textAlign = 'center';
  c.fillText((dis||'') + `${dis?'  ·  ':''}পাতা ${bnN(no)}/${bnN(total)}`, W/2, H-142);
  g = c.createLinearGradient(0,H-130,W,H); g.addColorStop(0,'#17539F'); g.addColorStop(.6,'#1B8A8F'); g.addColorStop(1,'#2DB57A');
  c.fillStyle = g; c.fillRect(0,H-130,W,130);
  c.textAlign = 'left'; c.fillStyle = '#fff';
  const qrC = qrOn('catalog'), sw = qrC ? 400 : 470;
  if(qrC) qrDraw(c, W/2-57, H-122, 114);
  const note = catVal('footerNote').trim(); if(note){ lfFit(c, note, sw, 40, 26, 800); c.fillText(note, 40, H-70); }
  const sub = catVal('footerSub').trim(); if(sub){ c.font = lfF(600, 24); c.fillText(sub, 40, H-30); }
  c.textAlign = 'right';
  const ph = catVal('phone').trim(); if(ph){ lfFit(c, ph, qrC?400:460, 36, 24, 800); c.fillText(ph, W-40, H-76); }
  c.font = lfF(500, 21); lfWrap(c, catVal('address'), sw, 2).forEach((ln,i) => c.fillText(ln, W-40, H-44+i*24));
  c.textAlign = 'left';
}
function catCard(c, p, x, y, w, h, s, img){
  c.save(); c.shadowColor = 'rgba(18,38,63,.12)'; c.shadowBlur = 12*s; c.shadowOffsetY = 4*s;
  lfRR(c, x, y, w, h, 22*s); c.fillStyle = '#fff'; c.fill(); c.restore();
  const zx = x+8*s, zy = y+8*s, zw = w-16*s, zh = Math.round(h*0.56);
  lfGlow(c, zx, zy, zw, zh);
  c.save();
  if(img) lfContain(c, img, zx+8*s, zy+4*s, zw-16*s, zh-6*s); else lfNoImg(c, p.name, zx, zy, zw, zh);
  c.restore(); c.textBaseline = 'alphabetic';
  lfPill(c, lfUnitLabel(p), x+10*s, zy+zh-(17*s+12)-2, Math.max(12, Math.round(17*s)), 'rgba(238,243,248,.95)', '#4D6079');
  const nf = Math.max(14, Math.round(24*s)), lh = Math.round(28*s), ny = zy+zh+Math.round(28*s);
  c.fillStyle = '#12263F'; c.font = lfF(700, nf); c.textAlign = 'left';
  lfWrap(c, p.name, w-24*s, 2).forEach((ln,i) => c.fillText(ln, x+12*s, ny+i*lh));
  if(CAT.showPrice){ c.font = lfF(800, Math.max(22, Math.round(42*s))); c.fillStyle = '#17539F'; c.fillText(bnTaka(packListPrice(p, CAT.priceList)), x+12*s, y+h-Math.round(14*s)); }
}
async function catDrawPage(canvas, pg, plan){
  await qrPrep();
  const c = canvas.getContext('2d'); canvas.width = LF_W; canvas.height = LF_H;
  const W = LF_W, H = LF_H, total = plan.pages.length;
  if(!LF_LOGO) LF_LOGO = await lfLoadImage('logo.jpg');
  if(pg.type==='cover'){
    let g = c.createLinearGradient(0,0,W,H); g.addColorStop(0,'#17539F'); g.addColorStop(.5,'#1F78C8'); g.addColorStop(1,'#2DB57A');
    c.fillStyle = g; c.fillRect(0,0,W,H);
    c.fillStyle = 'rgba(255,255,255,.08)'; [[900,200,320],[120,1250,380],[980,1180,200]].forEach(a => { c.beginPath(); c.arc(a[0],a[1],a[2],0,Math.PI*2); c.fill(); });
    c.save(); c.beginPath(); c.arc(W/2, 440, 170, 0, Math.PI*2); c.fillStyle = '#fff'; c.fill(); c.clip(); if(LF_LOGO) c.drawImage(LF_LOGO, W/2-165, 275, 330, 330); c.restore();
    c.beginPath(); c.arc(W/2, 440, 170, 0, Math.PI*2); c.lineWidth = 10; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
    const title = catVal('title').trim() || 'পণ্য ক্যাটালগ'; lfFit(c, title, 940, 118, 60, 800); c.fillText(title, W/2, 790);
    const tag = catVal('tagline').trim(); if(tag){ c.font = lfF(600, 38); c.fillStyle = 'rgba(255,255,255,.95)'; c.fillText(tag, W/2, 860); }
    const dt = catVal('dateText').trim(); if(dt){ c.font = lfF(800, 34); const dw = c.measureText(dt).width + 70; lfRR(c, W/2-dw/2, 910, dw, 66, 33); c.fillStyle = '#FFC83D'; c.fill(); c.fillStyle = '#12263F'; c.fillText(dt, W/2, 955); }
    c.fillStyle = 'rgba(255,255,255,.92)'; c.font = lfF(600, 30); c.fillText(`${bnN(plan.total)}টি পণ্য · ${bnN(plan.groups.length)}টি ক্যাটাগরি`, W/2, 1050);
    lfRR(c, 90, 1180, W-180, 250, 28); c.fillStyle = 'rgba(255,255,255,.16)'; c.fill();
    c.fillStyle = '#fff'; let yy = 1245;
    const qrV = qrOn('cover'), cx = qrV ? 420 : W/2, tw = qrV ? 620 : W-260;
    if(qrV) qrDraw(c, 770, 1210, 190, 10);
    const note = catVal('footerNote').trim(); if(note){ lfFit(c, note, tw, 40, 26, 800); c.fillText(note, cx, yy); yy += 52; }
    const ph = catVal('phone').trim(); if(ph){ lfFit(c, ph, tw, 38, 26, 800); c.fillText(ph, cx, yy); yy += 46; }
    c.font = lfF(500, 24); lfWrap(c, catVal('address'), tw, 2).forEach(ln => { c.fillText(ln, cx, yy); yy += 32; });
    const sub = catVal('footerSub').trim(); if(sub){ c.font = lfF(700, 26); c.fillText(sub, cx, yy+4); }
    c.textAlign = 'left'; return;
  }
  catChrome(c, pg.type==='toc' ? 'সূচিপত্র' : 'পণ্য তালিকা', pg.no, total);
  if(pg.type==='toc'){
    const rows = plan.groups.slice(pg.k*CAT_TOC_ROWS, (pg.k+1)*CAT_TOC_ROWS);
    const roomy = rows.length <= 12, step = roomy ? 78 : 46, fs = roomy ? 36 : 30;
    rows.forEach((gr,i) => {
      const y = 276 + i*step;
      c.textAlign = 'left'; c.font = lfF(700, fs); c.fillStyle = '#12263F'; c.fillText(gr.name, 70, y);
      const nw = c.measureText(gr.name).width; c.font = lfF(500, fs-8); c.fillStyle = '#6B7C93'; c.fillText(`(${bnN(gr.items.length)}টি পণ্য)`, 70+nw+14, y);
      c.textAlign = 'right'; c.font = lfF(800, fs); c.fillStyle = '#17539F'; c.fillText(`পাতা ${bnN(plan.starts[gr.name])}`, W-70, y);
      c.fillStyle = '#D5E0EC'; c.fillRect(70, y+(roomy?20:12), W-140, 1.5);
    });
    c.textAlign = 'left'; return;
  }
  const G = catGeom(), g = G.g;
  const all = []; pg.blocks.forEach(bl => { if(bl.kind==='row') bl.items.forEach(p => all.push(p)); });
  const imgs = {}; await Promise.all(all.map(async p => { imgs[p.id] = await catImg(p.id); }));
  let y = G.gy;
  pg.blocks.forEach(bl => {
    if(bl.kind==='head'){
      const gg = c.createLinearGradient(G.gx, 0, LF_W-G.gx, 0); gg.addColorStop(0,'#17539F'); gg.addColorStop(1,'#2DB57A');
      lfRR(c, G.gx, y, LF_W-2*G.gx, G.hh, 16); c.fillStyle = gg; c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      const label = bl.cont ? `${bl.name} (চলমান)` : bl.name;
      lfFit(c, label, LF_W-2*G.gx-250, 40, 26, 800); c.fillText(label, G.gx+22, y+G.hh/2+13);
      c.textAlign = 'right'; c.font = lfF(600, 24); c.fillStyle = 'rgba(255,255,255,.92)'; c.fillText(`${bnN(bl.count)}টি পণ্য`, LF_W-G.gx-22, y+G.hh/2+9); c.textAlign = 'left';
      y += G.hh + G.gapY;
    } else {
      bl.items.forEach((p,k) => catCard(c, p, G.gx+k*(G.colW+G.gapX), y, G.colW, G.rowH, G.sc, imgs[p.id]));
      y += G.rowH + G.gapY;
    }
  });
}
async function catFonts(){ try{ await Promise.all([document.fonts.load(lfF(800,40),'অআকখগ'), document.fonts.load(lfF(600,24),'অআকখগ'), document.fonts.load(lfF(700,24),'অআকখগ')]); }catch(e){} if(!LF_LOGO) LF_LOGO = await lfLoadImage('logo.jpg'); }
async function catRenderAll(onProgress){
  await catFonts(); const plan = catPlan(), cv = document.createElement('canvas'), out = [];
  for(let i=0;i<plan.pages.length;i++){ await catDrawPage(cv, plan.pages[i], plan); out.push(await lfBlob(cv)); if(onProgress) onProgress(i+1, plan.pages.length); }
  return out;
}
function catBusy(msg){ const el = document.getElementById('catBusy'); if(el) el.textContent = msg || ''; }
function catFileBase(){ return (catVal('title').trim() || 'ক্যাটালগ').replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,'-'); }
async function catDownloadPdf(){
  const plan = catPlan(); if(!plan.pages.length){ alert('ক্যাটালগে কোনো পণ্য নেই — অপশন দেখুন'); return; }
  try{
    const blobs = await catRenderAll((i,n) => catBusy(`PDF তৈরি হচ্ছে… ${bnN(i)}/${bnN(n)}`)), jp = [], dims = [];
    for(const b of blobs){ jp.push(new Uint8Array(await b.arrayBuffer())); dims.push([LF_W, LF_H, 595.28, 841.89]); }
    lfSaveBlob(exBuildPdf(jp, dims), catFileBase() + '.pdf'); catBusy('✅ PDF তৈরি হয়েছে');
  }catch(e){ catBusy(''); alert('PDF তৈরি হয়নি: ' + (e.message||e)); }
}
async function catDownloadJpg(){
  const plan = catPlan(); if(!plan.pages.length){ alert('ক্যাটালগে কোনো পণ্য নেই — অপশন দেখুন'); return; }
  try{
    const blobs = await catRenderAll((i,n) => catBusy(`ছবি তৈরি হচ্ছে… ${bnN(i)}/${bnN(n)}`));
    for(let i=0;i<blobs.length;i++){ lfSaveBlob(blobs[i], `${catFileBase()}-পাতা${i+1}.jpg`); await new Promise(r => setTimeout(r, 450)); }
    catBusy('✅ ছবি নামানো হয়েছে');
  }catch(e){ catBusy(''); alert('ছবি তৈরি হয়নি: ' + (e.message||e)); }
}
async function catShare(){
  const plan = catPlan(); if(!plan.pages.length){ alert('ক্যাটালগে কোনো পণ্য নেই — অপশন দেখুন'); return; }
  try{
    const blobs = await catRenderAll((i,n) => catBusy(`তৈরি হচ্ছে… ${bnN(i)}/${bnN(n)}`)), jp = [], dims = [];
    for(const b of blobs){ jp.push(new Uint8Array(await b.arrayBuffer())); dims.push([LF_W, LF_H, 595.28, 841.89]); }
    const file = new File([exBuildPdf(jp, dims)], catFileBase() + '.pdf', {type:'application/pdf'}); catBusy('');
    if(navigator.canShare && navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file], title: catVal('title')}); return; }catch(e){ if(e && e.name==='AbortError') return; } }
    lfSaveBlob(file, file.name); alert('এই ব্রাউজার থেকে সরাসরি শেয়ার হচ্ছে না — PDF ডাউনলোড হয়েছে। WhatsApp-এ ফাইলটা সংযুক্ত করে পাঠান।');
  }catch(e){ catBusy(''); alert('শেয়ার করা যায়নি: ' + (e.message||e)); }
}
/* ---- একসাথে অনেক ছবি আপলোড ---- */
function catKey(s){ return String(s||'').normalize('NFC').toLowerCase().replace(/\.[a-z0-9]{2,5}$/i,'').replace(/[^\p{L}\p{M}\p{N}]+/gu,''); }
async function catBulkImages(input){
  const files = [...input.files]; input.value = ''; if(!files.length) return;
  const byKey = {}; CACHE.products.forEach(p => { byKey[catKey(p.name)] = p.id; byKey[catKey(p.id)] = p.id; });
  const products = CACHE.products.map(p => ({...p})), done = [], miss = []; let n = 0;
  for(const f of files){
    n++; const pid = byKey[catKey(f.name)];
    if(!pid){ miss.push(f.name); continue; }
    catBusy(`ছবি আপলোড হচ্ছে… ${bnN(n)}/${bnN(files.length)}`);
    try{
      const data = await lfProcessFile(f), v = Date.now() + n;
      docRef('img__'+pid).set({data, v}).catch(e => saveFailed('ছবি', e));
      const i = products.findIndex(p => p.id===pid); products[i] = {...products[i], hasImg:true, imgV:v}; done.push(pid);
    }catch(e){ miss.push(f.name + ' (পড়া যায়নি)'); }
  }
  if(done.length) saveCollection('products', products);
  catBusy(`✅ ${bnN(done.length)}টি ছবি বসেছে` + (miss.length ? ` · ${bnN(miss.length)}টি মেলেনি` : ''));
  if(miss.length) alert('এই ফাইলগুলোর নাম কোনো পণ্যের নামের সাথে মেলেনি:\n\n' + miss.slice(0,15).join('\n') + (miss.length>15 ? '\n...' : '') + '\n\nফাইলের নাম পণ্যের নামের মতো (বা পণ্য আইডি, যেমন P001) দিয়ে আবার চেষ্টা করুন।');
  catRefresh(true);
}
/* ---- পেইজ ---- */
function catSet(k, v){ CAT[k] = v; catSave(); catPrevSoon(); if(k==='hideZero' || k==='excludeHidden' || k==='perPage') catRefresh(false); }
function catToggleCat(name, on){ CAT.cats[name] = on; catSave(); catRefresh(false); catPrevSoon(); }
function catAllCatsSet(on){ const cnt = catAllCats(); Object.keys(cnt).forEach(n => { CAT.cats[n] = on; }); catSave(); renderCatalog(); }
function catFromSettings(){ const d = catDefaults(); ['tagline','footerSub','phone','address'].forEach(k => { CAT[k] = d[k]; }); catSave(); renderCatalog(); }
function catField(k, label, ph){ return `<div class="form-field"><label>${label}</label><input value="${esc(catVal(k))}" placeholder="${esc(ph||'')}" oninput="catSet('${k}',this.value)"></div>`; }
function catChk(k, label){ return `<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;"><input type="checkbox" ${CAT[k]?'checked':''} onchange="catSet('${k}',this.checked)"> ${label}</label>`; }
function catSummaryHtml(){
  const plan = catPlan(), all = []; plan.groups.forEach(g => g.items.forEach(p => all.push(p)));
  const noImg = all.filter(p => !p.hasImg);
  return `<p style="font-size:13px;margin:6px 0;">মোট <b>${plan.total}</b>টি পণ্য · <b>${plan.groups.length}</b>টি ক্যাটাগরি · <b>${plan.pages.length}</b> পাতা · ছবি আছে <b>${all.length-noImg.length}</b>টির, নেই <b>${noImg.length}</b>টির</p>` +
    (noImg.length ? `<details style="font-size:12.5px;margin-bottom:6px;"><summary style="cursor:pointer;color:var(--navy);">ছবি নেই এমন পণ্য দেখুন</summary><div style="margin-top:6px;color:var(--text-muted);">${noImg.slice(0,40).map(p => esc(p.name)).join('، ')}${noImg.length>40?' ...':''}</div></details>` : '');
}
function catRefresh(withPreview){
  const el = document.getElementById('catSummary'); if(el) el.innerHTML = catSummaryHtml();
  if(withPreview) catPrevSoon();
}
function renderCatalog(){
  catLoad();
  const cnt = catAllCats(), names = catSortNames(Object.keys(cnt)), per = Number(CAT.perPage)||12;
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>পণ্য ক্যাটালগ</h3></div>
      <p style="font-size:12.5px;color:var(--text-muted);">পণ্য তালিকা থেকে নিজে থেকে ক্যাটালগ বানায় — কভার, সূচিপত্র, তারপর ক্যাটাগরি ধরে পাতা। ক্রয়মূল্য কখনো যায় না। নিচে অপশন বেছে PDF, JPG বা WhatsApp-এ নিন।</p>
      <h4 style="margin:8px 0 4px;">শিরোনাম ও তথ্য</h4>
      <div class="form-grid">
        ${catField('title','ক্যাটালগের নাম')}${catField('dateText','তারিখ/মাস (কভারে)')}${catField('tagline','ট্যাগলাইন')}
      </div>
      <h4 style="margin:12px 0 4px;">কী কী থাকবে</h4>
      <div style="display:flex;flex-direction:column;gap:7px;">
        ${catChk('showPrice','পণ্যের দাম দেখান')}${catChk('hideZero','স্টক নেই এমন পণ্য বাদ দিন')}${catChk('excludeHidden','"লুকানো" পণ্য বাদ দিন')}${catChk('cover','কভার পাতা')}${catChk('toc','সূচিপত্র')}
      </div>
      <div class="form-field" style="margin-top:12px;max-width:260px;"><label>কোন মূল্য তালিকার দাম দেখাবে</label>
        <select onchange="catSet('priceList',this.value)" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${Object.keys(PRICE_LISTS).map(k => `<option value="${k}" ${(CAT.priceList||'retail')===k?'selected':''}>${PRICE_LISTS[k]}</option>`).join('')}</select></div>
      <div class="form-field" style="margin-top:12px;max-width:260px;"><label>প্রতি পাতায় পণ্য</label>
        <select onchange="catSet('perPage',Number(this.value))" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
          <option value="12" ${per===12?'selected':''}>১২টি (বড় ছবি)</option><option value="16" ${per===16?'selected':''}>১৬টি</option><option value="20" ${per===20?'selected':''}>২০টি (সবচেয়ে বেশি)</option></select></div>
      <h4 style="margin:12px 0 4px;">ক্যাটাগরি ও ক্রম <span style="font-weight:500;font-size:12px;">(<a href="#" onclick="catAllCatsSet(true);return false;">সব</a> · <a href="#" onclick="catAllCatsSet(false);return false;">কোনোটাই না</a> · <a href="#" onclick="catResetOrder();return false;">ক্রম রিসেট</a>)</span></h4>
      <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 6px;">▲ ▼ চেপে ক্যাটাগরির ক্রম ঠিক করুন — ক্যাটালগে উপরেরটা আগে আসবে (যেমন খাবারের পর সাবান-সোডা)।</p>
      <div style="display:flex;flex-direction:column;gap:5px;max-width:460px;">
        ${names.map((n,i) => `<div style="display:flex;gap:8px;align-items:center;font-size:13.5px;padding:4px 6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">
          <span style="width:22px;color:var(--text-muted);text-align:right;">${bnN(i+1)}.</span>
          <label style="flex:1;display:flex;gap:8px;align-items:center;min-width:0;"><input type="checkbox" ${CAT.cats[n]===false?'':'checked'} onchange="catToggleCat('${esc(n).replace(/'/g,"\\'")}',this.checked)"> <span>${esc(n)} <span class="muted-cell">(${cnt[n]})</span></span></label>
          <button class="btn btn-outline btn-sm" style="padding:2px 9px;" onclick="catMoveCat(${i},-1)" ${i===0?'disabled':''}>▲</button>
          <button class="btn btn-outline btn-sm" style="padding:2px 9px;" onclick="catMoveCat(${i},1)" ${i===names.length-1?'disabled':''}>▼</button>
        </div>`).join('') || '<span class="muted-cell">কোনো পণ্য নেই</span>'}
      </div>
      <h4 style="margin:14px 0 4px;">ফুটার (নিচের অংশ)</h4>
      <div class="form-grid">
        ${catField('footerNote','বাঁ পাশের বড় লেখা')}${catField('footerSub','বাঁ পাশের ছোট লেখা (ওয়েবসাইট)')}${catField('phone','ফোন নম্বর')}${catField('address','ঠিকানা')}${catField('disclaimer','নিচের ছোট নোট')}
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="catFromSettings()">⟲ ট্যাগলাইন, ফোন, ওয়েবসাইট ও ঠিকানা সেটিংস থেকে আনুন</button>
      <h4 style="margin:14px 0 4px;">পণ্যের ছবি</h4>
      <p style="font-size:12.5px;color:var(--text-muted);">একসাথে অনেক ছবি আপলোড করুন। ছবির ফাইলের নাম পণ্যের নামের মতো (বা পণ্য আইডি, যেমন P001) হলে ছবি নিজে থেকে ঠিক পণ্যে বসবে। লিফলেটে দেওয়া ছবিও এখানে কাজ করে।</p>
      <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block;">📷 অনেক ছবি আপলোড করুন<input type="file" accept="image/*" multiple class="hidden" onchange="catBulkImages(this)"></label>
      <div id="catSummary" style="margin-top:8px;">${catSummaryHtml()}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px;">
        <button class="btn btn-primary btn-sm" onclick="catDownloadPdf()">📄 PDF ডাউনলোড</button>
        <button class="btn btn-outline btn-sm" onclick="catDownloadJpg()">🖼️ JPG ডাউনলোড</button>
        <button class="btn btn-accent btn-sm" onclick="catShare()">📤 WhatsApp-এ শেয়ার (PDF)</button>
      </div>
      <p id="catBusy" style="font-size:13px;color:var(--navy);min-height:18px;"></p>
      <h4 style="margin:10px 0 4px;">প্রিভিউ</h4>
      <div id="catPager" style="display:flex;gap:10px;align-items:center;margin-bottom:8px;"></div>
      <div id="catPreview"></div>
    </div>`;
  CAT_PREV = 0; catPrevSoon();
}
function catPrevSoon(){ clearTimeout(CAT_TIMER); CAT_TIMER = setTimeout(catRenderPreview, 300); }
function catGo(d){ const n = catPlan().pages.length; CAT_PREV = Math.max(0, Math.min(n-1, CAT_PREV+d)); catRenderPreview(); }
async function catRenderPreview(){
  const box = document.getElementById('catPreview'), pager = document.getElementById('catPager'); if(!box) return;
  const tok = ++CAT_TOK, plan = catPlan();
  if(!plan.pages.length){ box.innerHTML = '<p class="muted-cell">কোনো পণ্য নেই — অপশন বদলে দেখুন।</p>'; pager.innerHTML = ''; return; }
  CAT_PREV = Math.max(0, Math.min(plan.pages.length-1, CAT_PREV));
  await catFonts(); const cv = document.createElement('canvas');
  await catDrawPage(cv, plan.pages[CAT_PREV], plan); if(tok !== CAT_TOK) return;
  cv.style.cssText = 'width:100%;max-width:560px;display:block;margin:0 auto;border-radius:12px;box-shadow:0 4px 18px rgba(18,38,63,.18);';
  box.innerHTML = ''; box.appendChild(cv);
  pager.innerHTML = `<button class="btn btn-outline btn-sm" onclick="catGo(-1)" ${CAT_PREV===0?'disabled':''}>◀</button><span style="font-size:13px;">পাতা <b>${CAT_PREV+1}</b> / ${plan.pages.length}</span><button class="btn btn-outline btn-sm" onclick="catGo(1)" ${CAT_PREV>=plan.pages.length-1?'disabled':''}>▶</button>`;
}

/* ============================================================
   STOCK VALUE CHECK — স্টক মূল্য যাচাই (ভাউচার/ক্রয় খাতার সাথে মিলিয়ে দেখার জন্য)
   ============================================================ */
let SC_Q = '', SC_VOUCHER = '';
function dataHealth(){
  const prods = CACHE.products, ids = new Set(prods.map(p => p.id));
  const orphanP = CACHE.purchases.filter(pu => !ids.has(pu.productId));
  const orphanO = CACHE.orders.filter(o => orderItems(o).some(it => !ids.has(it.productId)));
  const seen = {}, dup = []; prods.forEach(p => { if(seen[p.id]) dup.push(p); else seen[p.id] = 1; });
  const bad = prods.filter(p => ['stock','cost','retail','minStock'].some(k => p[k]!==undefined && (typeof p[k]!=='number' || !isFinite(p[k]))));
  return {orphanP, orphanO, dup, bad};
}
function dataHealthHtml(){
  const h = dataHealth(), n = h.orphanP.length + h.orphanO.length + h.dup.length + h.bad.length;
  if(!n) return '<div class="flash">✅ ডেটায় কোনো গরমিল পাওয়া যায়নি (মুছে ফেলা পণ্যের এন্ট্রি, একই আইডি, ভুল ধরনের সংখ্যা — কিছুই নেই)।</div>';
  const cost = r2(h.orphanP.reduce((t,pu) => t + Number(pu.totalCost||0), 0));
  return `<div class="panel"><h3>ডেটা গরমিল — ঠিক করুন</h3>
    <p style="font-size:12.5px;color:var(--text-muted);">Firebase থেকে সরাসরি পণ্য যোগ বা মুছলে এমন গরমিল হতে পারে। নিচেরগুলো ঠিক করলে হিসাব মিলবে।</p>
    ${h.orphanP.length ? `<div class="flash warn"><b>${h.orphanP.length}টি ক্রয় এন্ট্রির পণ্য নেই</b> (মোট ${money(cost)}) — পণ্য মুছে ফেলা হয়েছে কিন্তু ক্রয় এন্ট্রি রয়ে গেছে, তাই ক্রয় খাতার মোট বেশি দেখায়।<br><span style="font-size:12px;">${h.orphanP.slice(0,8).map(pu => esc(pu.id)+' ('+esc(pu.productName||pu.productId)+', '+money(pu.totalCost)+')').join('، ')}${h.orphanP.length>8?' ...':''}</span><br><button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="fixOrphanPurchases()">🗑️ এই ক্রয় এন্ট্রিগুলো মুছুন</button></div>` : ''}
    ${h.orphanO.length ? `<div class="flash warn"><b>${h.orphanO.length}টি অর্ডারে মুছে ফেলা পণ্য আছে:</b> ${h.orphanO.slice(0,10).map(o => esc(o.id)).join('، ')}${h.orphanO.length>10?' ...':''}<br><span style="font-size:12px;">এগুলো নিজে থেকে ঠিক করা যায় না — অর্ডারগুলো খুলে সংশোধন করুন।</span></div>` : ''}
    ${h.dup.length ? `<div class="flash warn"><b>${h.dup.length}টি পণ্যের আইডি অন্য পণ্যের সাথে এক:</b> ${h.dup.slice(0,8).map(p => esc(p.id)+' ('+esc(p.name)+')').join('، ')}<br><button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="fixDupIds()">🔧 পরেরগুলোকে নতুন আইডি দিন</button></div>` : ''}
    ${h.bad.length ? `<div class="flash warn"><b>${h.bad.length}টি পণ্যের স্টক/দাম সংখ্যা হিসেবে নেই (লেখা হিসেবে আছে):</b> ${h.bad.slice(0,8).map(p => esc(p.name)).join('، ')}${h.bad.length>8?' ...':''}<br><button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="fixBadNumbers()">🔧 সংখ্যা ঠিক করুন</button></div>` : ''}
  </div>`;
}
function fixOrphanPurchases(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  const ids = new Set(CACHE.products.map(p => p.id));
  const bad = CACHE.purchases.filter(pu => !ids.has(pu.productId)), del = bad.filter(pu => !isDateLocked(pu.date)), locked = bad.length - del.length;
  if(!del.length){ alert('এই ক্রয় এন্ট্রিগুলো লক করা মাসে আছে — আগে ক্লোজিং পেইজ থেকে মাসটি খুলুন।'); return; }
  if(!confirm(`${del.length}টি ক্রয় এন্ট্রি (মোট ${money(r2(del.reduce((t,pu)=>t+Number(pu.totalCost||0),0)))}) মুছবেন?\\n\\nএই পণ্যগুলো আগেই মুছে ফেলা হয়েছে, তাই স্টকে কোনো পরিবর্তন হবে না।${locked?`\\n(${locked}টি লক করা মাসে আছে, সেগুলো থাকবে)`:''}`)) return;
  const keep = CACHE.purchases.filter(pu => ids.has(pu.productId) || isDateLocked(pu.date));
  if(saveCollection('purchases', keep)){ alert('✅ মুছে ফেলা হয়েছে'); renderStockCheck(); }
}
function fixBadNumbers(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  const num = v => { const n = Number(String(v).replace(/[,\\s৳]/g,'')); return isFinite(n) ? n : 0; };
  const products = CACHE.products.map(p => { const q = {...p}; ['stock','cost','retail','minStock'].forEach(k => { if(q[k]!==undefined && (typeof q[k]!=='number' || !isFinite(q[k]))) q[k] = num(q[k]); }); return q; });
  if(saveCollection('products', products)){ alert('✅ সংখ্যা ঠিক হয়েছে'); renderStockCheck(); }
}
function fixDupIds(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  if(!confirm('একই আইডির পরের পণ্যগুলো নতুন আইডি পাবে (প্রথমটির আইডি অপরিবর্তিত থাকবে)। এগিয়ে যাবেন?')) return;
  const products = CACHE.products.map(p => ({...p})), seen = {};
  products.forEach((p,i) => { if(seen[p.id]){ p.id = genId('P', products); } seen[p.id] = 1; });
  if(saveCollection('products', products)){ alert('✅ আইডি ঠিক হয়েছে'); renderStockCheck(); }
}
function reconcileStock(pid){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  const d = stockCheckData(), list = pid==='ALL' ? d.mism : d.mism.filter(r => r.p.id===pid);
  if(!list.length){ alert('মেলানোর মতো কিছু নেই'); return; }
  if(!guardDate(todayStr(), 'সমন্বয়')) return;
  const val = r2(list.reduce((t,r) => t + r.U*r.cost, 0));
  if(!confirm(`${list.length}টি পণ্যের স্টক রেকর্ডের সাথে মেলানো হবে।\n\nস্টক যেমন আছে তেমনই থাকবে — শুধু "সমন্বয়" হিসেবে একটা রেকর্ড যোগ হবে (মোট ক্রয়মূল্য ${money(val)})। এটি বিক্রয় বা খরচ হিসেবে লাভ-ক্ষতিতে ধরা হবে না।\n\nএগিয়ে যাবেন?`)) return;
  const note = prompt('সমন্বয়ের কারণ লিখুন (ঐচ্ছিক) — যেমন: পরীক্ষার এন্ট্রি, নষ্ট/হারানো মাল', ''); if(note===null) return;
  const map = {}; list.forEach(r => { map[r.p.id] = r.U; });
  const products = CACHE.products.map(p => map[p.id]!==undefined ? {...p, adj:(p.adj||[]).concat([{d: todayStr(), q: r3(map[p.id]), n: (note||'').trim() || 'সমন্বয় (পার্থক্য মেলানো)'}])} : p);
  if(saveCollection('products', products)){ alert('✅ সমন্বয় রেকর্ড হয়েছে — স্টক অপরিবর্তিত আছে'); renderStockCheck(); }
}
/* ============================================================
   FULL REPORT — সম্পূর্ণ হিসাব রিপোর্ট (স্টক থেকে বিক্রয় পর্যন্ত সব একসাথে PDF / Excel)
   এটি পড়ার ও সংরক্ষণের রিপোর্ট; ডেটা ফেরত আনার ব্যাকআপ হলো উপরের ফাইল ব্যাকআপ (JSON)।
   ============================================================ */
let FR_MONTH = 'all', FR_LINES = true;
function fullReportModel(){
  const m = FR_MONTH, inR = d => m==='all' || mOf(d)===m, idx = moveIndex();
  const months = monthsList().filter(x => m==='all' || x===m), md = months.map(x => monthData(x, idx));
  const pn = id => { const p = CACHE.products.find(x => x.id===id); return p ? p.name : (id||'—'); };
  const orders = CACHE.orders.filter(o => inR(o.date)).slice().sort((a,b) => a.date < b.date ? -1 : 1);
  const purchases = CACHE.purchases.filter(p => inR(p.date)).slice().sort((a,b) => a.date < b.date ? -1 : 1);
  const exps = CACHE.expenses.filter(e => inR(e.date)).slice().sort((a,b) => a.date < b.date ? -1 : 1);
  const rets = CACHE.returns.filter(r => inR(r.date)), invs = CACHE.investments.filter(x => inR(x.date));
  const delivered = orders.filter(o => o.status==='Delivered');
  const st = stockTotals(), sales = r2(delivered.reduce((t,o) => t + Number(o.total||0), 0)), buy = r2(purchases.reduce((t,p) => t + Number(p.totalCost||0), 0));
  const expT = r2(exps.filter(e => e.kind!=='income').reduce((t,e) => t + Number(e.amount||0), 0)), incT = r2(exps.filter(e => e.kind==='income').reduce((t,e) => t + Number(e.amount||0), 0));
  const net = r2(md.reduce((t,d) => t + d.net, 0));
  const custDue = r2(CACHE.orders.filter(o => o.status!=='Cancelled').reduce((t,o) => t + orderDue(o), 0)), supDue = r2(CACHE.purchases.reduce((t,p) => t + purchaseDue(p), 0));
  const capital = invSum(() => true);
  const rangeLbl = m==='all' ? 'সব সময়' : monthLabel(m);
  const model = {title:'সম্পূর্ণ হিসাব রিপোর্ট', when: exNow(), summary:[], tables:[]};
  const S = (a,b) => model.summary.push([a,b]), T = (name, head, rows) => { if(rows.length) model.tables.push({name, head, rows}); };
  S('সময়কাল', rangeLbl); S('রিপোর্ট তৈরির সময়', exNow());
  S('মোট স্টক মূল্য (ক্রয়মূল্যে, এখন)', money(st.cost)); S('মোট স্টক মূল্য (বিক্রয়মূল্যে, এখন)', money(st.retail)); S('স্টকে আছে এমন পণ্য', String(st.count));
  S('মোট বিক্রয় (ডেলিভারড)', money(sales)); S('মোট ক্রয়', money(buy)); S('মোট খরচ', money(expT)); S('মোট আয় (কমিশন ইত্যাদি)', money(incT));
  S('নিট প্রফিট', money(net)); S('কাস্টমারের মোট বকেয়া (এখন)', money(custDue)); S('সরবরাহকারীর মোট বকেয়া (এখন)', money(supDue)); S('মোট মূলধন (বিনিয়োগ − উত্তোলন)', money(capital));
  T('মাসভিত্তিক হিসাব', ['মাস','বিক্রয়','ক্রয়মূল্য (COGS)','গ্রস প্রফিট','অন্য আয়','খরচ','নিট প্রফিট','মাস শেষের স্টক মূল্য','অবস্থা'],
    md.map(d => [monthLabel(d.month), money(d.revenue), money(d.cogs), money(d.gross), money(d.otherIncome), money(d.expenses), money(d.net), money(d.closeVal), d.locked ? 'লক' : 'খোলা']));
  T('পণ্য ও স্টক (এখনকার অবস্থা)', ['আইডি','পণ্য','ক্যাটাগরি','একক','স্টক','ক্রয়মূল্য','বিক্রয়মূল্য','স্টক মূল্য (ক্রয়)'],
    CACHE.products.map(p => [p.id, p.name, p.category||'', p.unit||'কেজি', String(r3(p.stock||0)), money(p.cost||0), money(p.retail||0), money(r2(Math.max(0,Number(p.stock||0))*Number(p.cost||0)))]));
  { const psd = Object.values(psData(m==='all' ? '0000-01-01' : monthStart(m), m==='all' ? '9999-12-31' : monthEnd(m))).sort((a,b) => b.qty-a.qty);
    T('পণ্যভিত্তিক বিক্রয় (ডেলিভারড)', ['পণ্য','ক্যাটাগরি','বিক্রিত পরিমাণ','অর্ডার','বিক্রয়','গ্রস লাভ'], psd.map(a => [a.name, a.cat, psQty(a), String(a.ords.size), money(r2(a.rev)), money(r2(a.rev-a.cogs))])); }
  T('বিক্রয় (অর্ডার)', ['তারিখ','অর্ডার','কাস্টমার','মোবাইল','মূল্য তালিকা','অবস্থা','মোট','পরিশোধিত','বকেয়া'],
    orders.map(o => [o.date, o.id, o.customerName||'', o.phone||'', PRICE_LISTS[o.priceList]||'খুচরা', o.status, money(o.total||0), money(o.paidAmount||0), money(orderDue(o))]));
  if(FR_LINES){
    const rows = []; orders.forEach(o => orderItems(o).forEach(it => { const p = CACHE.products.find(x => x.id===it.productId); rows.push([o.date, o.id, o.customerName||'', pn(it.productId), fmtItem(it, p), money(it.unitPrice), lineDisc(it)>0 ? money(lineDisc(it)) : '', lineSur(it)>0 ? money(lineSur(it)) : '', money(lineAmt(it))]); }));
    T('বিক্রয়ের পণ্যভিত্তিক লাইন', ['তারিখ','অর্ডার','কাস্টমার','পণ্য','পরিমাণ','একক মূল্য','ছাড়','বাড়তি','লাইন মোট'], rows);
  }
  T('ক্রয়', ['তারিখ','আইডি','ভাউচার নং','সরবরাহকারী','পণ্য','পরিমাণ','মোট খরচ','পেমেন্ট','পরিশোধিত','বকেয়া'],
    purchases.map(p => { const pr = CACHE.products.find(x => x.id===p.productId); return [p.date, p.id, p.voucherNo||'', p.supplier||'', p.productName||pn(p.productId), `${p.qty} ${pr?pr.unit||'কেজি':''}`, money(p.totalCost||0), p.paymentStatus==='Paid'?'পরিশোধিত':'বকেয়া', money(p.paidAmount||0), money(purchaseDue(p))]; }));
  T('খরচ ও আয়', ['তারিখ','আইডি','ধরন','ক্যাটাগরি','ভাউচার নং','পরিমাণ','মাধ্যম','অনুমোদনকারী / উৎস'],
    exps.map(e => [e.date, e.id, e.kind==='income' ? 'আয়' : 'খরচ', e.category||'', e.voucherNo||'', money(e.amount||0), e.method||'', e.approvedBy||'']));
  T('রিটার্ন', ['তারিখ','অর্ডার','কাস্টমার','পণ্য','পরিমাণ','ফেরত টাকা','কারণ'], rets.map(r => [r.date, r.orderId, r.customerName||'', pn(r.productId), String(r.qty), money(r.refundAmount||0), r.reason||'']));
  const cd = {}; CACHE.orders.filter(o => o.status!=='Cancelled' && orderDue(o)>0).forEach(o => { const k = (o.customerName||'—') + '|' + (o.phone||''); const a = cd[k] || (cd[k] = {name:o.customerName||'—', phone:o.phone||'', n:0, due:0}); a.n++; a.due += orderDue(o); });
  T('কাস্টমারের বকেয়া (এখনকার, সব সময়ের)', ['কাস্টমার','মোবাইল','অর্ডার সংখ্যা','মোট বকেয়া'], Object.values(cd).sort((a,b) => b.due-a.due).map(a => [a.name, a.phone, String(a.n), money(r2(a.due))]));
  const sd = {}; CACHE.purchases.filter(p => purchaseDue(p)>0).forEach(p => { const k = p.supplier||'—'; const a = sd[k] || (sd[k] = {name:k, n:0, due:0}); a.n++; a.due += purchaseDue(p); });
  T('সরবরাহকারীর বকেয়া (এখনকার, সব সময়ের)', ['সরবরাহকারী','ক্রয় সংখ্যা','মোট বকেয়া'], Object.values(sd).sort((a,b) => b.due-a.due).map(a => [a.name, String(a.n), money(r2(a.due))]));
  const dr = []; orders.filter(o => o.status!=='Cancelled').forEach(o => orderItems(o).forEach(it => { const dd = lineDisc(it), sx = lineSur(it); if(dd>0 || sx>0) dr.push([o.date, o.id, o.customerName||'', pn(it.productId), dd>0?money(dd):'', sx>0?money(sx):'']); }));
  T('ছাড় ও বাড়তি (পণ্যভিত্তিক)', ['তারিখ','অর্ডার','কাস্টমার','পণ্য','ছাড়','বাড়তি'], dr);
  T('বিনিয়োগ / উত্তোলন', ['তারিখ','আইডি','ধরন','পরিমাণ','নোট'], invs.map(x => [x.date, x.id, x.type==='out' ? 'উত্তোলন' : 'বিনিয়োগ', money(x.amount||0), x.note||'']));
  return model;
}
function frSetMonth(v){ FR_MONTH = v; }
function frSetLines(v){ FR_LINES = !!v; }
function frBusy(msg){ const el = document.getElementById('frBusy'); if(el) el.textContent = msg||''; }
async function fullReportPdf(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  try{ frBusy('PDF তৈরি হচ্ছে… একটু সময় লাগতে পারে'); await new Promise(r => setTimeout(r, 50));
    const m = fullReportModel(), blob = await exRenderPdf(m); lfSaveBlob(blob, 'Avera-Mart-সম্পূর্ণ-হিসাব-' + (FR_MONTH==='all'?'সব-সময়':FR_MONTH) + '-' + todayStr() + '.pdf'); frBusy('✅ PDF তৈরি হয়েছে');
  }catch(e){ frBusy(''); alert('PDF তৈরি হয়নি: ' + (e.message||e)); }
}
function fullReportExcel(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  if(typeof XLSX==='undefined'){ alert('Excel লাইব্রেরি লোড হয়নি — ইন্টারনেট চেক করে পেইজ রিফ্রেশ করুন।'); return; }
  const m = fullReportModel(), wb = XLSX.utils.book_new(), used = new Set();
  const uniq = n => { const b = (String(n).replace(/[\[\]:*?\/\\]/g,' ').trim().slice(0,26) || 'Sheet'); let x = b, i = 2; while(used.has(x.toLowerCase())) x = b + ' ' + (i++); used.add(x.toLowerCase()); return x; };
  const widths = aoa => { const w = []; aoa.forEach(r => r.forEach((v,i) => { const l = Math.min(48, String(v).split('\n').reduce((a,b) => Math.max(a,b.length), 0) + 2); w[i] = Math.max(w[i]||8, l); })); return w.map(x => ({wch:x})); };
  const sa = [['Avera Mart — ' + m.title], [m.when], []].concat(m.summary.map(r => [r[0], exVal(r[1])])), sw = XLSX.utils.aoa_to_sheet(sa); sw['!cols'] = widths(sa); XLSX.utils.book_append_sheet(wb, sw, uniq('সারসংক্ষেপ'));
  m.tables.forEach(t => { const aoa = [t.head].concat(t.rows.map(r => r.map(exVal))), ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths(aoa); XLSX.utils.book_append_sheet(wb, ws, uniq(t.name)); });
  XLSX.writeFile(wb, 'Avera-Mart-সম্পূর্ণ-হিসাব-' + (FR_MONTH==='all'?'সব-সময়':FR_MONTH) + '-' + todayStr() + '.xlsx');
}
function fullReportPanelHtml(){
  return `<div class="panel">
    <h3>📄 সম্পূর্ণ হিসাব রিপোর্ট (PDF / Excel)</h3>
    <p style="font-size:12.5px;color:var(--text-muted);">স্টক, পণ্য, বিক্রয়, ক্রয়, খরচ ও আয়, রিটার্ন, বকেয়া, ছাড় ও বাড়তি, বিনিয়োগ, মাসভিত্তিক লাভ-ক্ষতি — সব একসাথে এক ফাইলে। পড়া ও জমিয়ে রাখার জন্য। <b>ডেটা ফেরত আনার ব্যাকআপ হলো উপরের "ব্যাকআপ ডাউনলোড" (ফাইল)</b>; এই রিপোর্ট থেকে ডেটা ফেরত আনা যায় না, তাই দুটোই রাখুন।</p>
    <div class="form-field" style="max-width:300px;"><label>সময়কাল</label><select onchange="frSetMonth(this.value)" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${monthOptionsHtml(FR_MONTH, true)}</select></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;margin:10px 0;"><input type="checkbox" ${FR_LINES?'checked':''} onchange="frSetLines(this.checked)"> বিক্রয়ের পণ্যভিত্তিক লাইনসহ (ফাইল বড় হয়)</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" onclick="fullReportPdf()">📄 PDF ডাউনলোড</button><button class="btn btn-outline btn-sm" onclick="fullReportExcel()">📊 Excel ডাউনলোড</button></div>
    <p id="frBusy" style="font-size:13px;color:var(--navy);min-height:18px;margin-top:6px;"></p>
  </div>`;
}
/* ============================================================
   PRODUCT SALES REPORT — কোন মাসে/তারিখে কোন পণ্য কতটি বিক্রি (ডেলিভারড অর্ডার, রিটার্ন বাদে)
   ============================================================ */
let PS = null;
function psInit(){ if(PS) return; const cm = curMonth(); PS = {month:cm, from:monthStart(cm), to:todayStr(), custom:false, q:'', sort:'qty', zero:false, detail:''}; }
function psData(from, to){
  const prod = {};
  CACHE.orders.filter(o => o.status==='Delivered' && o.date>=from && o.date<=to).forEach(o => {
    orderItems(o).forEach(it => {
      const p = CACHE.products.find(x => x.id===it.productId);
      const a = prod[it.productId] || (prod[it.productId] = {id:it.productId, p, name:p ? p.name : '(মুছে ফেলা পণ্য)', cat:p ? (p.category||'') : '', qty:0, rev:0, disc:0, cogs:0, ords:new Set(), lines:[]});
      const q = Number(it.qty||0), amt = lineAmt(it);
      a.qty += q; a.rev += amt; a.disc += lineDisc(it); a.cogs += (p ? Number(p.cost||0) : 0)*q; a.ords.add(o.id);
      a.lines.push({date:o.date, order:o.id, customer:o.customerName||'', fmt:fmtItem(it,p), price:Number(it.unitPrice), disc:lineDisc(it), sur:lineSur(it), amt});
    });
  });
  return prod;
}
function psQty(a){ return a.p ? fmtStock(a.qty, a.p) : String(r3(a.qty)); }
function psSetMonth(v){
  PS.custom = false;
  if(v==='all'){ PS.month = 'all'; PS.from = '0000-01-01'; PS.to = '9999-12-31'; }
  else { PS.month = v; PS.from = monthStart(v); PS.to = (v===curMonth()) ? todayStr() : monthEnd(v); }
  PS.detail = ''; psSyncDates(); psRefresh();
}
function psSetDate(which, v){ if(!v) return; PS[which] = v; PS.custom = true; PS.detail = ''; const sel = document.getElementById('psMonthSel'); if(sel) sel.innerHTML = monthOptionsHtml('', true) + '<option value="custom" selected>নিজের তারিখ</option>'; psRefresh(); }
function psDv(v){ return (v==='0000-01-01' || v==='9999-12-31') ? '' : v; }
function psSyncDates(){ const f = document.getElementById('psFrom'), t = document.getElementById('psTo'); if(f) f.value = psDv(PS.from); if(t) t.value = psDv(PS.to); }
function psSetQ(v){ PS.q = v; psRefresh(); }
function psSetSort(v){ PS.sort = v; psRefresh(); }
function psSetZero(v){ PS.zero = !!v; psRefresh(); }
function psDetail(pid){ PS.detail = (PS.detail===pid) ? '' : pid; psRefresh(); if(PS.detail){ const el = document.getElementById('psDetailBox'); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); } }
function psMonthsMatrix(){
  const ms = monthsList().filter(x => x <= curMonth()).slice(-6), mat = {};
  CACHE.orders.filter(o => o.status==='Delivered' && ms.includes(mOf(o.date))).forEach(o => orderItems(o).forEach(it => { const a = mat[it.productId] || (mat[it.productId] = {}); const k = mOf(o.date); a[k] = (a[k]||0) + Number(it.qty||0); }));
  return {ms, mat};
}
function psRefresh(){
  const box = document.getElementById('psBody'); if(!box) return;
  const admin = isAdmin(), data = psData(PS.from, PS.to), q = String(PS.q||'').trim();
  let list = Object.values(data);
  if(PS.zero){ CACHE.products.forEach(p => { if(!data[p.id] && Number(p.stock)>0 && !p.hidden) list.push({id:p.id, p, name:p.name, cat:p.category||'', qty:0, rev:0, disc:0, cogs:0, ords:new Set(), lines:[]}); }); }
  if(q){ const toks = q.split(/\s+/).map(kk).filter(Boolean); list = list.filter(a => { const hay = kk(a.name) + '|' + kk(a.cat) + '|' + kk(a.id); return toks.every(t => hay.includes(t)); }); }
  const cmp = {qty:(a,b) => b.qty-a.qty, rev:(a,b) => b.rev-a.rev, name:(a,b) => String(a.name).localeCompare(String(b.name),'bn'), slow:(a,b) => a.qty-b.qty};
  list.sort(cmp[PS.sort] || cmp.qty);
  const totRev = r2(list.reduce((t,a) => t + a.rev, 0)), totCogs = r2(list.reduce((t,a) => t + a.cogs, 0)), sold = list.filter(a => a.qty>0).length;
  const ordSet = new Set(); list.forEach(a => a.ords.forEach(x => ordSet.add(x)));
  const label = PS.custom ? `${PS.from==='0000-01-01' ? 'শুরু' : PS.from} থেকে ${PS.to==='9999-12-31' ? 'এখন পর্যন্ত' : PS.to}` : (PS.month==='all' ? 'সব সময়' : (PS.month===curMonth() ? monthLabel(PS.month) + ' (আজ পর্যন্ত)' : monthLabel(PS.month) + ' (' + monthRangeText(PS.month) + ')'));
  const rows = list.map(a => `<tr>
    <td>${esc(a.name)}</td><td>${esc(a.cat)}</td><td class="cell-num"><b>${a.qty>0 ? psQty(a) : '—'}</b></td><td class="cell-num">${a.ords.size||'—'}</td>
    <td class="cell-num">${a.rev>0 ? money(r2(a.rev)) : '—'}</td>${admin ? `<td class="cell-num">${a.qty>0 ? money(r2(a.rev-a.cogs)) : '—'}</td>` : ''}
    <td class="cell-num">${a.p ? fmtStock(a.p.stock, a.p) : '—'}</td>
    <td class="cell-center">${a.lines.length ? `<button class="icon-btn" title="বিস্তারিত" onclick="psDetail('${a.id}')">🔍</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty-state">এই সময়ে কোনো বিক্রি নেই</td></tr>';
  const dt = PS.detail ? data[PS.detail] : null;
  const detailHtml = dt ? `<div class="panel" id="psDetailBox" style="border:2px solid var(--teal);"><div class="panel-head"><h3>${esc(dt.name)} — বিক্রির বিস্তারিত (${esc(label)})</h3><button class="btn btn-outline btn-sm" onclick="psDetail('${dt.id}')">✕ বন্ধ</button></div>
    <p style="font-size:13px;margin:0 0 8px;">মোট বিক্রি <b>${psQty(dt)}</b> · ${dt.ords.size}টি অর্ডার · বিক্রয় <b>${money(r2(dt.rev))}</b>${dt.disc>0 ? ' · ছাড় ' + money(r2(dt.disc)) : ''}</p>
    <div class="table-wrap"><table><thead><tr><th>তারিখ</th><th>অর্ডার</th><th>কাস্টমার</th><th>পরিমাণ</th><th>একক মূল্য</th><th>ছাড়</th><th>বাড়তি</th><th>মোট</th></tr></thead><tbody>
    ${dt.lines.slice().sort((x,y) => x.date<y.date?1:-1).map(l => `<tr><td>${l.date}</td><td>${l.order}</td><td>${esc(l.customer)}</td><td class="cell-num">${esc(String(l.fmt))}</td><td class="cell-num">${money(l.price)}</td><td class="cell-num">${l.disc>0?money(l.disc):'—'}</td><td class="cell-num">${l.sur>0?money(l.sur):'—'}</td><td class="cell-num"><b>${money(l.amt)}</b></td></tr>`).join('')}</tbody></table></div></div>` : '';
  const mm = psMonthsMatrix(), mrows = Object.keys(mm.mat).map(pid => ({pid, p:CACHE.products.find(x => x.id===pid), tot:mm.ms.reduce((t,k) => t + (mm.mat[pid][k]||0), 0)})).sort((a,b) => b.tot-a.tot).slice(0,60);
  const matrixHtml = (mrows.length && mm.ms.length>1) ? `<div class="panel"><h3>মাস অনুযায়ী বিক্রি — পণ্য ধরে (শেষ ${mm.ms.length} মাস)</h3>
    <div class="table-wrap"><table><thead><tr><th>পণ্য</th>${mm.ms.map(k => `<th>${monthLabel(k)}</th>`).join('')}<th>মোট</th></tr></thead><tbody>
    ${mrows.map(r => `<tr><td>${esc(r.p ? r.p.name : '(মুছে ফেলা পণ্য)')}</td>${mm.ms.map(k => { const v = mm.mat[r.pid][k]||0; return `<td class="cell-num">${v ? (r.p ? fmtStock(v, r.p) : r3(v)) : '—'}</td>`; }).join('')}<td class="cell-num"><b>${r.p ? fmtStock(r.tot, r.p) : r3(r.tot)}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="muted-cell" style="font-size:12px;margin-top:6px;">সবচেয়ে বেশি বিক্রি হওয়া ৬০টি পণ্য দেখানো হয়েছে।</p></div>` : '';
  box.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:12px;">
      <div class="stat-card"><div class="label">বিক্রি হওয়া পণ্য (${esc(label)})</div><div class="value">${sold}টি</div><div class="sub">${ordSet.size}টি অর্ডার</div></div>
      <div class="stat-card"><div class="label">মোট বিক্রয়</div><div class="value">${money(totRev)}</div>${admin ? `<div class="sub">গ্রস লাভ ${money(r2(totRev-totCogs))}</div>` : ''}</div>
    </div>
    <div class="panel"><h3>পণ্য ধরে বিক্রয় — ${esc(label)}</h3>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>ক্যাটাগরি</th><th>বিক্রিত পরিমাণ</th><th>অর্ডার</th><th>বিক্রয়</th>${admin?'<th>গ্রস লাভ</th>':''}<th>বর্তমান স্টক</th><th>বিস্তারিত</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">ডেলিভারড অর্ডার ধরা হয়েছে; রিটার্ন করা পরিমাণ বাদ। ${admin ? 'গ্রস লাভ = বিক্রয় − ক্রয়মূল্য (এখনকার ভাউচার গড়ে), খরচ ও কমিশনের আগে। ' : ''}"🔍" চাপলে কোন অর্ডারে কত বিক্রি হয়েছে দেখা যায়।</p></div>
    ${detailHtml}${matrixHtml}`;
}
function renderProductSales(){
  psInit();
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <h3>পণ্য বিক্রয় রিপোর্ট</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">কোন মাসে বা কোন তারিখ থেকে তারিখ পর্যন্ত কোন পণ্য কতটি বিক্রি হয়েছে — মাসের শেষে বা মাঝের যেকোনো দিন দেখুন।</p>
      <div class="form-grid">
        <div class="form-field"><label>মাস</label><select id="psMonthSel" onchange="psSetMonth(this.value)" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${monthOptionsHtml(PS.custom ? '' : PS.month, true)}${PS.custom ? '<option value="custom" selected>নিজের তারিখ</option>' : ''}</select></div>
        <div class="form-field"><label>তারিখ থেকে</label><input type="date" id="psFrom" value="${psDv(PS.from)}" onchange="psSetDate('from', this.value)"></div>
        <div class="form-field"><label>তারিখ পর্যন্ত</label><input type="date" id="psTo" value="${psDv(PS.to)}" onchange="psSetDate('to', this.value)"></div>
      </div>
      <div class="toolbar" style="margin-top:10px;">
        <input type="search" placeholder="🔍 পণ্য / ক্যাটাগরি দিয়ে খুঁজুন" value="${esc(PS.q)}" oninput="psSetQ(this.value)">
        <select onchange="psSetSort(this.value)"><option value="qty" ${PS.sort==='qty'?'selected':''}>বেশি বিক্রি আগে</option><option value="rev" ${PS.sort==='rev'?'selected':''}>বেশি টাকার বিক্রি আগে</option><option value="slow" ${PS.sort==='slow'?'selected':''}>কম বিক্রি আগে</option><option value="name" ${PS.sort==='name'?'selected':''}>নাম অনুযায়ী</option></select>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;"><input type="checkbox" ${PS.zero?'checked':''} onchange="psSetZero(this.checked)"> যে পণ্য বিক্রি হয়নি (কিন্তু স্টকে আছে) সেগুলোও দেখান</label>
    </div>
    <div id="psBody"></div>`;
  psRefresh();
}
function stockCheckData(){
  const lastBuy = {};
  CACHE.purchases.slice().sort((a,b)=> String(a.date).localeCompare(String(b.date))).forEach(pu => { if(pu.productId && Number(pu.qty)>0) lastBuy[pu.productId] = Number(pu.totalCost||0)/Number(pu.qty); });
  const rows = CACHE.products.map(p => {
    const st = Number(p.stock||0), cost = Number(p.cost||0), retail = Number(p.retail||0);
    return {p, st, cost, retail, vCost: st>0 ? st*cost : 0, vRetail: st>0 ? st*retail : 0, last: lastBuy[p.id]};
  });
  const A = {
    zeroCost: rows.filter(r => r.st>0 && !(r.cost>0)),
    zeroRetail: rows.filter(r => r.st>0 && !(r.retail>0)),
    negative: rows.filter(r => r.st<0),
    belowCost: rows.filter(r => r.st>0 && r.retail>0 && r.cost>0 && r.retail<r.cost),
    hiddenStock: rows.filter(r => r.st>0 && r.p.hidden),
    drift: rows.filter(r => { const av = avgCostOf(CACHE.purchases, r.p.id); return r.st>0 && av!==null && r.cost>0 && Math.abs(av-r.cost)/r.cost > 0.001; })
  };
  // ---- ক্রয় খাতা থেকে স্টক মূল্যে পৌঁছানোর ধাপ (bridge) ----
  const idx = moveIndex();
  const buyAgg = {};
  CACHE.purchases.forEach(pu => { if(!pu.productId) return; const a = buyAgg[pu.productId] || (buyAgg[pu.productId] = {q:0,c:0}); a.q += Number(pu.qty||0); a.c += Number(pu.totalCost||0); });
  const B = {A:0, sold:0, diff:0, logged:0, untracked:0, neg:0};
  const mism = [];
  rows.forEach(r => {
    const mv = idx[r.p.id] || {}; const T = {P:0,S:0,R:0,A:0};
    Object.keys(mv).forEach(m => { T.P+=mv[m].P; T.S+=mv[m].S; T.R+=mv[m].R; T.A+=mv[m].A; });
    const ba = buyAgg[r.p.id]; const avg = (ba && ba.q>0) ? ba.c/ba.q : r.cost;
    const tracked = T.P - T.S + T.R;
    const U = r.st - (tracked + T.A);
    B.A += ba ? ba.c : 0;
    B.sold += (T.S - T.R) * avg;
    B.diff += tracked * (r.cost - avg);
    B.logged += T.A * r.cost;
    B.untracked += U * r.cost;
    if(r.st < 0) B.neg += -r.st * r.cost;     // মাইনাস স্টক মোটে ধরা হয় না
    r.U = U; r.expected = r3(tracked + T.A); r.T = T;
    if(Math.abs(U) > 0.0005) mism.push(r);
  });
  { const ids0 = new Set(CACHE.products.map(p => p.id)); B.orphan = CACHE.purchases.filter(pu => !ids0.has(pu.productId)).reduce((t,pu) => t + Number(pu.totalCost||0), 0); }
  Object.keys(B).forEach(k => B[k] = r2(B[k]));
  return {rows, A, B, mism, totCost: r2(rows.reduce((t,r)=>t+r.vCost,0)), totRetail: r2(rows.reduce((t,r)=>t+r.vRetail,0)), count: rows.filter(r=>r.st>0).length,
          buyTotal: r2(CACHE.purchases.reduce((t,pu)=>t+Number(pu.totalCost||0),0))};
}
function scRowsHtml(d){
  const q = SC_Q.trim().toLowerCase();
  const list = d.rows.filter(r => r.st!==0 && (!q || String(r.p.name).toLowerCase().includes(q) || String(r.p.id).toLowerCase().includes(q))).sort((a,b)=>b.vCost-a.vCost);
  return list.map(r => `<tr style="${r.p.hidden?'opacity:.7;':''}">
    <td>${esc(r.p.name)}${r.p.hidden?' <span class="badge badge-hidden">লুকানো</span>':''}</td>
    <td class="cell-num">${fmtStock(r.st, r.p)}</td>
    <td class="cell-num">${money(r.cost)}</td>
    <td class="cell-num">${money(r2(r.vCost))}</td>
    <td class="cell-num">${money(r.retail)}</td>
    <td class="cell-num">${money(r2(r.vRetail))}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-state">কোনো পণ্য নেই</td></tr>';
}
function onScSearch(){ SC_Q = document.getElementById('scSearch').value; document.getElementById('scBody').innerHTML = scRowsHtml(stockCheckData()); }
function onScVoucher(){
  SC_VOUCHER = document.getElementById('scVoucher').value;
  const d = stockCheckData(), v = Number(SC_VOUCHER||0);
  document.getElementById('scDiff').innerHTML = v>0 ? (Math.abs(d.buyTotal - v) < 1
    ? `<span style="color:#167A54;">✅ ক্রয় খাতার মোট ${money(d.buyTotal)} — ভাউচারের সাথে মিলে গেছে।</span>`
    : `<span style="color:#B3261E;">⚠️ ক্রয় খাতার মোট ${money(d.buyTotal)}, ভাউচারের মোট ${money(v)} — পার্থক্য <b>${money(r2(Math.abs(d.buyTotal - v)))}</b> (${d.buyTotal>v?'ক্রয় খাতায় বেশি':'ক্রয় খাতায় কম'})। ক্রয় খাতার এন্ট্রিগুলো ভাউচারের সাথে একটা একটা মিলিয়ে দেখুন।</span>`) : '';
}
function anomalyBlock(title, list, hint){
  if(!list.length) return '';
  return `<div class="flash warn" style="margin-bottom:10px;"><b>${title} (${list.length}টি)</b><br>${list.slice(0,12).map(r=>esc(r.p.name)).join('، ')}${list.length>12?' ...':''}<br><span style="font-size:12px;">${hint}</span></div>`;
}
function renderStockCheck(){
  if(!isAdmin()){ go('dashboard'); return; }
  const d = stockCheckData(), A = d.A;
  const anomalies =
    anomalyBlock('ক্রয়মূল্য ০ বা ফাঁকা, কিন্তু স্টক আছে', A.zeroCost, 'এই পণ্যগুলোর স্টকের মূল্য ০ ধরা হচ্ছে — মোট ক্রয়মূল্যের হিসাব কম আসবে। পণ্য তালিকা থেকে ক্রয়মূল্য বসান।') +
    anomalyBlock('বিক্রয়মূল্য ০, কিন্তু স্টক আছে', A.zeroRetail, 'বিক্রয়মূল্যের হিসাব কম আসবে।') +
    anomalyBlock('ঋণাত্মক (মাইনাস) স্টক', A.negative, 'বিক্রি হয়েছে কিন্তু ক্রয় এন্ট্রি দেওয়া হয়নি — ক্রয় খাতায় এন্ট্রি দিন।') +
    anomalyBlock('বিক্রয়মূল্য ক্রয়মূল্যের চেয়ে কম', A.belowCost, 'দাম উল্টো বসে গেছে কিনা দেখুন।') +
    anomalyBlock('লুকানো অবস্থায় স্টক আছে', A.hiddenStock, 'এগুলোর মূল্য মোটের মধ্যে ধরা আছে, কিন্তু ইনভেন্টরি রিপোর্টের তালিকায় দেখা যায় না।') +
    anomalyBlock('পণ্যের ক্রয়মূল্য ভাউচারের গড় দামের সাথে মিলছে না', A.drift, 'ক্রয়মূল্য সাধারণত নিজে থেকেই ভাউচার গড় অনুযায়ী ঠিক থাকে; হাতে বদলালে বা পুরোনো এন্ট্রির পরে এমন হতে পারে। <button class="btn btn-primary btn-sm" style="margin-top:6px;" onclick="applyAvgCostsAll()">🔄 এখনই ভাউচার গড় অনুযায়ী ঠিক করুন</button>')
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="stat-card"><div class="label">মোট মজুত মালের মূল্য — ক্রয়মূল্যে</div><div class="value">${money(d.totCost)}</div><div class="sub">স্টকে আছে ${d.count}টি পণ্য</div></div>
      <div class="stat-card"><div class="label">মোট মজুত মালের মূল্য — বিক্রয়মূল্যে</div><div class="value">${money(d.totRetail)}</div><div class="sub">সম্ভাব্য লাভ: ${money(r2(d.totRetail - d.totCost))}</div></div>
    </div>
    <div class="panel">
      <h3>ভাউচারের সাথে মেলান</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">ড্যাশবোর্ডের স্টক মূল্য = প্রতিটা পণ্যের <b>বর্তমান স্টক × দাম</b>। ভাউচারের টাকা হলো <b>কেনার সময়ের মোট খরচ</b> — এর মধ্যে যা বিক্রি হয়ে গেছে তা ধরা নেই, তাই দুটো হুবহু এক হওয়ার কথা না। মেলাতে হলে: (১) ক্রয় খাতার মোট খরচ ভাউচারের মোটের সমান কিনা দেখুন, (২) নিচের তালিকায় ক্রয়মূল্যে স্টক মূল্য দেখুন (ক্রয়মূল্যের হিসাবই ভাউচারের সাথে তুলনীয়, বিক্রয়মূল্যের নয়)।</p>
      <div class="form-grid">
        <div class="form-field"><label>ভাউচারগুলোর মোট যোগফল (৳)</label><input id="scVoucher" type="number" placeholder="যেমন 203103" value="${esc(SC_VOUCHER)}" oninput="onScVoucher()"></div>
        <div class="form-field"><label>ক্রয় খাতার মোট খরচ (সব এন্ট্রি)</label><div class="stat-card" style="padding:10px 14px;"><div class="value" style="font-size:20px;">${money(d.buyTotal)}</div><div class="sub">${CACHE.purchases.length}টি এন্ট্রি</div></div></div>
      </div>
      <p id="scDiff" style="font-size:13.5px;margin-top:10px;"></p>
    </div>
    <div class="panel">
      <h3>ক্রয় খাতা থেকে স্টক মূল্য — ধাপে ধাপে হিসাব</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">ক্রয় খাতার মোট খরচ থেকে শুরু করে কোন কারণে কত টাকা বাড়ছে/কমছে, নিচে দেখুন। শেষ সংখ্যা ড্যাশবোর্ডের স্টক মূল্যের সমান।</p>
      <table>
        <tr><td>ক্রয় খাতার মোট খরচ (ভাউচারের টাকা)</td><td class="cell-num">${money(r2(d.B.A + d.B.orphan))}</td></tr>
        ${d.B.orphan>0 ? `<tr><td>− যেসব পণ্য মুছে ফেলা হয়েছে (ক্রয় এন্ট্রি আছে, পণ্য নেই)</td><td class="cell-num">− ${money(d.B.orphan)}</td></tr>` : ''}
        <tr><td>− যা বিক্রি হয়ে গেছে (ক্রয়দামে, রিটার্ন বাদে)</td><td class="cell-num">− ${money(d.B.sold)}</td></tr>
        <tr><td>± পণ্য তালিকার ক্রয়মূল্য আর ভাউচারের দামের পার্থক্য</td><td class="cell-num">${d.B.diff>=0?'+ ':'− '}${money(Math.abs(d.B.diff))}</td></tr>
        <tr><td>+ পণ্য তালিকা/এক্সেল থেকে হাতে বসানো স্টক (সমন্বয়, প্রারম্ভিক স্টক)</td><td class="cell-num">${d.B.logged>=0?'+ ':'− '}${money(Math.abs(d.B.logged))}</td></tr>
        <tr><td>+ <b>ক্রয় খাতায় এন্ট্রি ছাড়াই যে স্টক আছে</b> (আগে হাতে বসানো, রেকর্ড নেই)</td><td class="cell-num">${d.B.untracked>=0?'+ ':'− '}${money(Math.abs(d.B.untracked))}</td></tr>
        ${d.B.neg ? `<tr><td>+ মাইনাস স্টকের পণ্য মোটে ধরা হয় না</td><td class="cell-num">${money(d.B.neg)}</td></tr>` : ''}
      </table>
      <div class="invoice-total-row"><span>= মোট স্টক মূল্য (ক্রয়মূল্যে)</span><span>${money(d.totCost)}</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">যে লাইনে সবচেয়ে বড় সংখ্যা সেটাই পার্থক্যের মূল কারণ।</p>
    </div>
    ${dataHealthHtml()}
    ${(() => { const pl = avgCostPlan(); return pl.list.length ? `<div class="panel"><h3>ক্রয়মূল্য ভাউচারের সাথে মেলান</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">${pl.list.length}টি পণ্যের ক্রয়মূল্য ক্রয় খাতার ভাউচার গড়ের (মোট খরচ ÷ মোট পরিমাণ) সাথে মিলছে না। ঠিক করলে স্টক মূল্য <b>${money(pl.valBefore)}</b> থেকে <b>${money(pl.valAfter)}</b> হবে। এরপর থেকে প্রতিটি ক্রয় এন্ট্রিতে এই দাম নিজে থেকেই ঠিক হবে।</p>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>এখনকার ক্রয়মূল্য</th><th>ভাউচার গড়</th></tr></thead><tbody>${pl.list.slice(0,25).map(x=>`<tr><td>${esc(x.p.name)}</td><td class="cell-num">${money(x.oldCost)}</td><td class="cell-num"><b>${money(x.newCost)}</b></td></tr>`).join('')}</tbody></table></div>
      ${pl.list.length>25?`<p class="muted-cell">আরও ${pl.list.length-25}টি আছে</p>`:''}
      <button class="btn btn-primary" style="margin-top:10px;" onclick="applyAvgCostsAll()">🔄 সব পণ্যের ক্রয়মূল্য ভাউচার গড় অনুযায়ী ঠিক করুন</button></div>` : ''; })()}
    ${d.mism.length ? `<div class="panel"><h3>যেসব পণ্যের স্টক ক্রয়-বিক্রয়ের রেকর্ডের সাথে মিলছে না</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">"রেকর্ড অনুযায়ী" = ক্রয় − বিক্রয় + রিটার্ন + লগ করা সমন্বয়। "পার্থক্য" মানে এই পরিমাণ স্টক রেকর্ড ছাড়া আছে (পণ্য খোলার সময় বা এক্সেল/পণ্য তালিকা থেকে বসানো)। যদি ভাউচারে এই মাল কেনা হয়ে থাকে, তাহলে ক্রয় খাতায় এন্ট্রি দিন — অথবা স্টক ভুল থাকলে পণ্য তালিকায় সঠিক করুন।</p>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>বর্তমান স্টক</th><th>রেকর্ড অনুযায়ী</th><th>পার্থক্য</th><th>মূল্য (ক্রয়)</th><th>সমন্বয়</th></tr></thead><tbody>
      ${d.mism.slice().sort((a,b)=>Math.abs(b.U*b.cost)-Math.abs(a.U*a.cost)).slice(0,40).map(r=>`<tr><td>${esc(r.p.name)}</td><td class="cell-num">${fmtStock(r.st,r.p)}</td><td class="cell-num">${r.expected} ${esc(r.p.unit||'কেজি')}</td><td class="cell-num"><b>${r3(r.U)}</b></td><td class="cell-num">${money(r2(r.U*r.cost))}</td><td class="cell-center"><button class="btn btn-outline btn-sm" onclick="reconcileStock('${r.p.id}')">✅ মেলান</button></td></tr>`).join('')}
      </tbody></table></div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="reconcileStock('ALL')">✅ সব পার্থক্য সমন্বয় হিসেবে রেকর্ড করুন (স্টক যেমন আছে তেমনই থাকবে)</button>
      ${d.mism.length>40 ? `<p class="muted-cell">আরও ${d.mism.length-40}টি আছে (বড় পার্থক্যগুলো আগে দেখানো হয়েছে)।</p>` : ''}</div>` : ''}
    ${anomalies ? `<div class="panel"><h3>সম্ভাব্য সমস্যা</h3>${anomalies}</div>` : `<div class="flash">✅ স্টক বা দামের ডেটায় কোনো স্পষ্ট অসঙ্গতি পাওয়া যায়নি।</div>`}
    <div class="panel">
      <h3>পণ্যভিত্তিক স্টক মূল্য</h3>
      <div class="toolbar"><input type="search" id="scSearch" placeholder="🔍 পণ্যের নাম / আইডি" value="${esc(SC_Q)}" oninput="onScSearch()"></div>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>স্টক</th><th>ক্রয়মূল্য/একক</th><th>স্টক মূল্য (ক্রয়)</th><th>বিক্রয়মূল্য/একক</th><th>স্টক মূল্য (বিক্রয়)</th></tr></thead>
      <tbody id="scBody">${scRowsHtml(d)}</tbody></table></div>
    </div>`;
  onScVoucher();
}

/* ============================================================
   SERVER BACKUP — সার্ভারে আলাদা কপি (averamart_backups), ডেটা ব্যবহার, সাপ্তাহিক রিমাইন্ডার
   ============================================================ */
const BK = 'averamart_backups';
const BK_NAMES = ['products','orders','purchases','expenses','returns','shareholders','contributions','closings','leaflets','investments','settings','users'];
let BK_TRIED = false, BK_STATE = {ok:null, tag:'', err:''};
function bkStatusText(){
  if(BK_STATE.ok===true) return `✅ সর্বশেষ সার্ভার ব্যাকআপ: <b>${esc(BK_STATE.tag)}</b>`;
  if(BK_STATE.ok===false) return `⚠️ ব্যাকআপ লেখা যায়নি: ${esc(BK_STATE.err)} — Firebase rules আপডেট করুন (FIREBASE-RULES.txt দেখুন)।`;
  return 'আজকের ব্যাকআপ যাচাই হচ্ছে...';
}
function bkUpdateStatus(){ const el = document.getElementById('bkStatus'); if(el) el.innerHTML = bkStatusText(); }
async function runServerBackup(force){
  try{
    if(!db) return;
    if(!allLoaded()){ if(force) alert('ডেটা এখনো লোড হয়নি'); return; }
    if(Object.keys(SAFE_ALERT).length){ if(force) alert('ডেটা সন্দেহজনকভাবে কমে আছে — এই অবস্থায় ব্যাকআপ নেওয়া হচ্ছে না।'); return; }
    const day = todayStr(), col = db.collection(BK);
    const hhmm = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(':','');
    const tag = force ? `${day}T${hhmm}` : day;
    if(!force){
      const meta = await col.doc(tag+'__meta').get();
      if(meta.exists){ BK_STATE = {ok:true, tag, err:''}; bkUpdateStatus(); return; }
    }
    const month = day.slice(0,7);
    const had = await col.where('kind','==','meta').where('month','==',month).limit(1).get();
    const keep = had.empty;
    const counts = {};
    for(const name of BK_NAMES){
      const payload = (name==='settings'||name==='users') ? CACHE[name] : {items: CACHE[name]||[]};
      counts[name] = (name==='settings'||name==='users') ? 1 : (CACHE[name]||[]).length;
      await col.doc(`${tag}__${name}`).set({kind:'data', tag, day, src:name, json:JSON.stringify(payload), n:counts[name], keep, ts:firebase.firestore.FieldValue.serverTimestamp()});
    }
    await col.doc(tag+'__meta').set({kind:'meta', tag, day, month, counts, keep, ts:firebase.firestore.FieldValue.serverTimestamp()});
    BK_STATE = {ok:true, tag, err:''}; bkUpdateStatus();
    if(force) alert('✅ সার্ভার ব্যাকআপ নেওয়া হয়েছে: ' + tag);
    // ৬০ দিনের পুরোনো দৈনিক কপি মুছে ফেলা (মাসিক কপি থাকে)
    try{
      const old = await col.where('ts','<', new Date(Date.now()-60*864e5)).limit(300).get();
      old.forEach(d => { const x = d.data(); if(!x.keep) d.ref.delete().catch(()=>{}); });
    }catch(e){}
  }catch(e){
    BK_STATE = {ok:false, tag:'', err:(e && e.message) || String(e)}; bkUpdateStatus();
    if(force) alert('⚠️ ব্যাকআপ নেওয়া যায়নি: ' + BK_STATE.err);
  }
}
async function loadServerBackups(){
  const box = document.getElementById('bkList'); if(!box) return;
  box.innerHTML = 'লোড হচ্ছে...';
  try{
    const snap = await db.collection(BK).where('kind','==','meta').get();
    const list = []; snap.forEach(d => list.push(d.data()));
    list.sort((a,b) => String(b.tag).localeCompare(String(a.tag)));
    if(!list.length){ box.innerHTML = '<span class="muted-cell">এখনো কোনো সার্ভার ব্যাকআপ নেই</span>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>তারিখ</th><th>পণ্য</th><th>অর্ডার</th><th>ক্রয়</th><th>খরচ</th><th></th></tr></thead><tbody>${
      list.slice(0,60).map(m => `<tr><td>${esc(m.tag)}${m.keep?' 📌':''}</td><td class="cell-num">${(m.counts||{}).products||0}</td><td class="cell-num">${(m.counts||{}).orders||0}</td><td class="cell-num">${(m.counts||{}).purchases||0}</td><td class="cell-num">${(m.counts||{}).expenses||0}</td><td><button class="btn btn-outline btn-sm" onclick="restoreServerBackup('${esc(m.tag)}')">⏪ ফেরত আনুন</button></td></tr>`).join('')
    }</tbody></table></div><p class="muted-cell" style="font-size:12px;">📌 = মাসিক কপি (চিরকাল থাকে)</p>`;
  }catch(e){ box.innerHTML = '<span style="color:#B3261E;">তালিকা আনা যায়নি: ' + esc(e.message||e) + '</span>'; }
}
async function restoreServerBackup(tag){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন ফেরত আনতে পারবেন'); return; }
  try{
    const snap = await db.collection(BK).where('tag','==',tag).get();
    const data = {}; snap.forEach(d => { const x = d.data(); if(x.kind==='data') { try{ data[x.src] = JSON.parse(x.json); }catch(e){} } });
    const names = ['products','orders','purchases','expenses','returns','shareholders','contributions','closings'].filter(n => data[n] && Array.isArray(data[n].items));
    if(!names.length){ alert('এই ব্যাকআপে ডেটা পাওয়া যায়নি'); return; }
    const sum = names.map(n => `${n}: ${data[n].items.length}টি`).join('\n');
    if(!confirm(`${tag}-এর ব্যাকআপ থেকে ফেরত আনবেন?\n\n${sum}\n\nবর্তমান ডেটা এই ডেটা দিয়ে প্রতিস্থাপিত হবে (লগইন তথ্য ও পাসওয়ার্ড অপরিবর্তিত থাকবে)। আগে বর্তমান ডেটার একটা ফাইল ব্যাকআপ নিজে থেকে নামবে।`)) return;
    try{ downloadBackup(); }catch(e){}
    FORCE_SAVE = true;
    names.forEach(n => saveCollection(n, data[n].items));
    if(data.settings) saveSettings({...CACHE.settings, ...data.settings});
    setTimeout(() => { FORCE_SAVE = false; }, 30000);
    alert('✅ ফেরত আনা হয়েছে। সংখ্যাগুলো মিলিয়ে দেখুন।'); go('dashboard');
  }catch(e){ alert('ফেরত আনা যায়নি: ' + (e.message||e)); }
}
const USAGE_NAMES = {products:'পণ্য', orders:'অর্ডার', purchases:'ক্রয়', expenses:'খরচ/আয়', returns:'রিটার্ন', closings:'মাস ক্লোজিং', investments:'বিনিয়োগ', leaflets:'লিফলেট'};
function usageRows(){
  return Object.keys(USAGE_NAMES).map(n => { let b = 0; try{ b = new Blob([JSON.stringify(CACHE[n]||[])]).size; }catch(e){} return {n, label:USAGE_NAMES[n], kb: Math.round(b/1024), pct: Math.round(b/1048576*100), cnt:(CACHE[n]||[]).length}; });
}
function dataUsageHtml(){
  return `<div class="table-wrap"><table><thead><tr><th>তথ্য</th><th>সংখ্যা</th><th>আকার</th><th>সীমার %</th></tr></thead><tbody>${
    usageRows().map(r => `<tr><td>${r.label}</td><td class="cell-num">${r.cnt}</td><td class="cell-num">${r.kb} KB</td><td class="cell-num" style="${r.pct>=70?'color:#B3261E;font-weight:700;':''}">${r.pct}%</td></tr>`).join('')
  }</tbody></table></div>`;
}
function leafletShortcut(){
  if(!['admin','manager'].includes(getSession().role)) return '';
  return `<div class="alert-strip" style="background:#E7F6EE;border-color:#BFE4D0;color:#145C40;">📣 <b>অফার লিফলেট</b> — পণ্যের ছবি ও অফার দিয়ে WhatsApp-এর জন্য লিফলেট বানান। <a href="#" onclick="go('leaflet');return false;" style="color:#145C40;font-weight:700;">খুলুন</a></div>`;
}
function safetyBanners(){
  if(!isAdmin()) return '';
  let h = '';
  const last = Number(localStorage.getItem('AM_lastDownload')||0);
  const days = last ? Math.floor((Date.now()-last)/864e5) : 999;
  if(days >= 7) h += `<div class="alert-strip" style="background:#EEF1F6;border-color:#D5DCE8;color:var(--navy);">💾 ${last?days+' দিন':'অনেক দিন'} ধরে ব্যাকআপ ফাইল ডাউনলোড করা হয়নি। <a href="#" onclick="downloadBackup();go('dashboard');return false;" style="color:var(--navy);font-weight:700;">এখনই ডাউনলোড করুন</a></div>`;
  if(BK_STATE.ok===false) h += `<div class="alert-strip" style="background:#FDE8E8;border-color:#F4B8B4;color:#B3261E;">☁️ সার্ভার ব্যাকআপ চলছে না (${esc(BK_STATE.err)}) — FIREBASE-RULES.txt অনুযায়ী Firebase rules আপডেট করুন।</div>`;
  const big = usageRows().filter(r => r.pct >= 70);
  if(big.length) h += `<div class="alert-strip" style="background:#FDE8E8;border-color:#F4B8B4;color:#B3261E;">📦 ডেটা সীমার কাছাকাছি: ${big.map(r=>r.label+' '+r.pct+'%').join(', ')} — সেটিংস → ডেটা ব্যবহার দেখুন, ডেভেলপারকে জানান।</div>`;
  return h;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(){
  const session = getSession();
  const products = CACHE.products;
  const orders = CACHE.orders;
  const expenses = CACHE.expenses;
  const month = curMonth(), monthTxt = monthLabel(month) + ' · ' + monthRangeText(month);
  const monthOrders = orders.filter(o => o.date && mOf(o.date)===month && o.status==='Delivered');
  const totalSalesMonth = monthOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const monthExpenses = expenses.filter(e=>e.kind!=='income' && e.date && mOf(e.date)===month).reduce((s,e)=>s+Number(e.amount||0),0);
  const monthIncome = expenses.filter(e=>e.kind==='income' && e.date && mOf(e.date)===month).reduce((s,e)=>s+Number(e.amount||0),0);
  const cogs = monthOrders.reduce((s,o)=> s + orderItems(o).reduce((s2,it)=>{ const p=products.find(p=>p.id===it.productId); return s2 + (p?p.cost:0)*Number(it.qty||0); },0), 0);
  const netProfit = totalSalesMonth - cogs - monthExpenses + monthIncome;
  const lowStock = products.filter(p=>!p.hidden && Number(p.stock) <= Number(p.minStock));
  const pending = orders.filter(o=>o.status==='Pending' || o.status==='Processing');
  const st = stockTotals();
  const stockCard = session.role==='admin'
    ? `<div class="stat-card clickable" onclick="go('stockcheck')"><div class="label">মোট মজুত মালের মূল্য (ক্রয়মূল্যে)</div><div class="value">${money(st.cost)}</div><div class="sub">বিক্রয়মূল্যে: ${money(st.retail)} · স্টকে আছে ${st.count}টি পণ্য</div></div>`
    : `<div class="stat-card clickable" onclick="go('inventory')"><div class="label">মোট মজুত মালের মূল্য (বিক্রয়মূল্যে)</div><div class="value">${money(st.retail)}</div><div class="sub">স্টকে আছে ${st.count}টি পণ্য · এটি বিক্রয়মূল্যের হিসাব, ক্রয়ের ভাউচারের (ক্রয়মূল্য) সাথে মিলবে না</div></div>`;
  const hiddenCount = products.filter(p=>p.hidden).length;

  let cards = `
    <div class="stat-card accent"><div class="label">এই মাসের বিক্রয় (ডেলিভারড)</div><div class="value">${money(totalSalesMonth)}</div><div class="sub">${monthTxt}</div></div>
    <div class="stat-card warn"><div class="label">এই মাসের খরচ</div><div class="value">${money(monthExpenses)}</div><div class="sub">${monthTxt}</div></div>
    <div class="stat-card ${lowStock.length?'danger':''}"><div class="label">কম স্টকের পণ্য</div><div class="value">${lowStock.length} টি</div></div>
    <div class="stat-card"><div class="label">পেন্ডিং/প্রসেসিং অর্ডার</div><div class="value">${pending.length} টি</div></div>
  `;
  cards = stockCard + cards;
  if(session.role==='admin'){
    cards = `<div class="stat-card"><div class="label">এই মাসের নিট লাভ</div><div class="value">${money(netProfit)}</div><div class="sub">${monthTxt}</div></div>` + cards;
  }

  let html = closingBanner() + safetyBanners() + leafletShortcut() + `<div class="grid grid-4">${cards}</div>`;

  if(lowStock.length){
    html += `<div class="alert-strip">⚠️ কম স্টকে থাকা পণ্য: ${lowStock.map(p=>esc(p.name)).join('، ')}</div>`;
  }

  if(hiddenCount){
    html += `<div class="alert-strip" style="background:#EEF1F6;border-color:#D5DCE8;color:var(--navy);">ℹ️ ${hiddenCount}টি পণ্য "লুকানো" অবস্থায় আছে — এগুলো অর্ডার সার্চ ও ইনভেন্টরি রিপোর্টে দেখা যায় না। <a href="#" onclick="showHiddenProducts();return false;" style="color:var(--navy);font-weight:700;">লুকানো পণ্যগুলো দেখুন</a></div>`;
  }

  html += `<div class="panel">
    <div class="panel-head"><h3>সাম্প্রতিক অর্ডার</h3></div>
    <div class="table-wrap"><table><thead><tr>
      <th>অর্ডার আইডি</th><th>তারিখ</th><th>কাস্টমার</th><th>মোট মূল্য</th><th>স্ট্যাটাস</th>
    </tr></thead><tbody>
    ${orders.slice(-6).reverse().map(o=>`
      <tr><td>${o.id}</td><td>${o.date}</td><td>${esc(o.customerName)}</td><td class="cell-num">${money(o.total)}</td>
      <td class="cell-center"><span class="badge ${STATUS_BADGE[o.status]}">${STATUS_BN[o.status]}</span></td></tr>
    `).join('') || `<tr><td colspan="5" class="empty-state">কোনো অর্ডার নেই</td></tr>`}
    </tbody></table></div>
  </div>`;

  document.getElementById('pageContent').innerHTML = html;
}

/* ============================================================
   PRODUCTS
   ============================================================ */
let PROD_Q = '', PROD_FILTER = 'all', PROD_COUNT = 0;
function showHiddenProducts(){ PROD_Q=''; PROD_FILTER='hidden'; go('products'); }
function productRowsHtml(){
  const admin = isAdmin();
  const q = PROD_Q.trim().toLowerCase();
  const list = CACHE.products.filter(p=>{
    if(q && !(String(p.name).toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q) || String(p.category||'').toLowerCase().includes(q))) return false;
    if(PROD_FILTER==='active') return !p.hidden;
    if(PROD_FILTER==='hidden') return !!p.hidden;
    if(PROD_FILTER==='low') return !p.hidden && Number(p.stock)<=Number(p.minStock);
    if(PROD_FILTER==='zero') return Number(p.stock)<=0;
    return true;
  });
  PROD_COUNT = list.length;
  return list.map(p => `
    <tr class="${hlClass('products',p.id)}" style="${p.hidden?'opacity:.7;':''}">
      <td>${p.id}</td>
      <td>${esc(p.name)}${p.hidden ? ' <span class="badge badge-hidden">লুকানো</span><br><span class="muted-cell" style="font-size:11.5px;">অর্ডার সার্চ/ইনভেন্টরিতে আসবে না — ক্রয় এন্ট্রি দিলে চালু হবে</span>' : ''}${p.priceTiers ? `<br><span class="muted-cell">${esc(p.priceTiers)}</span>` : ''}${qtyDiscText(p) ? `<br><span class="muted-cell" style="font-size:11.5px;">${esc(qtyDiscText(p))}</span>` : ''}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.unit||'কেজি')}</td>
      ${admin ? `<td class="cell-num">${money(packPrice(p,'cost'))}${fmtBasis(p)?`<br><span class="muted-cell" style="font-size:11.5px;">/ ${fmtBasis(p)}</span>`:''}</td>` : ''}
      <td class="cell-num">${money(packPrice(p,'retail'))}${fmtBasis(p)?`<br><span class="muted-cell" style="font-size:11.5px;">/ ${fmtBasis(p)}</span>`:`<br><span class="muted-cell" style="font-size:11.5px;">/ ১ ${esc(p.unit||'কেজি')}</span>`}</td>
      <td class="cell-num">${Number(p.corporate)>0 ? money(packListPrice(p,'corporate')) : '<span class="muted-cell">—</span>'}</td>
      <td>${fmtStock(p.stock, p)} ${Number(p.stock)<=Number(p.minStock) && !p.hidden ? '<span class="badge badge-low">লো স্টক</span>' : ''}</td>
      <td class="cell-center">
        <button class="icon-btn" title="${p.hidden?'আবার চালু করুন':'লুকিয়ে রাখুন'}" onclick="toggleProductHidden('${p.id}')">${p.hidden?'🙈':'👁️'}</button>
        <button class="icon-btn" onclick="openProductForm('${p.id}')">✏️</button>
        ${admin ? `<button class="icon-btn danger" onclick="deleteProduct('${p.id}')">🗑️</button>` : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="${admin?9:8}" class="empty-state">${CACHE.products.length ? 'এই ফিল্টারে কোনো পণ্য নেই' : 'কোনো পণ্য যোগ করা হয়নি'}</td></tr>`;
}
function onProductFilter(){
  PROD_Q = document.getElementById('prodSearch').value;
  PROD_FILTER = document.getElementById('prodFilter').value;
  document.getElementById('prodBody').innerHTML = productRowsHtml();
  document.getElementById('prodCount').textContent = `দেখাচ্ছে ${PROD_COUNT}টি / মোট ${CACHE.products.length}টি পণ্য`;
}
function renderProducts(){
  const isAdmin = getSession().role==='admin';
  const rowsHtml = productRowsHtml();
  const f = (v,l)=>`<option value="${v}" ${PROD_FILTER===v?'selected':''}>${l}</option>`;
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('products')}
    <div class="panel">
      <div class="panel-head">
        <h3>পণ্য তালিকা</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isAdmin ? `
            <button class="btn btn-outline btn-sm" onclick="exportProductsExcel()">⬇️ বর্তমান পণ্য এক্সেলে নামান</button>
            <button class="btn btn-outline btn-sm" onclick="downloadProductDemoExcel()">📥 ডেমো এক্সেল ফাইল</button>
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('excelFileInput').click()">📤 এক্সেল থেকে আপলোড</button>
            <input type="file" id="excelFileInput" accept=".xlsx,.xls" class="hidden" onchange="handleExcelUpload(event)">
          ` : ''}
          <button class="btn btn-accent btn-sm" onclick="openProductForm()">+ নতুন পণ্য</button>
        </div>
      </div>
      ${isAdmin ? `<p style="font-size:12px;color:var(--text-muted);margin:-4px 0 14px;">"বর্তমান পণ্য এক্সেলে নামান" দিয়ে ফাইল নামিয়ে দাম/স্টক ইত্যাদি বদলান, তারপর "এক্সেল থেকে আপলোড" দিন — আইডি (না থাকলে নাম) মিললে পুরোনো পণ্য আপডেট হবে, না মিললে নতুন পণ্য যোগ হবে। কোনো ঘর ফাঁকা থাকলে সেই তথ্য অপরিবর্তিত থাকবে।</p>` : ''}
      <div class="toolbar">
        <input type="search" id="prodSearch" placeholder="🔍 পণ্যের নাম / আইডি / ক্যাটাগরি দিয়ে খুঁজুন" value="${esc(PROD_Q)}" oninput="onProductFilter()">
        <select id="prodFilter" onchange="onProductFilter()">
          ${f('all','সব পণ্য')}${f('active','শুধু চালু')}${f('hidden','শুধু লুকানো')}${f('low','কম স্টক')}${f('zero','স্টক শূন্য/নেই')}
        </select>
        <span class="muted-cell" id="prodCount">দেখাচ্ছে ${PROD_COUNT}টি / মোট ${CACHE.products.length}টি পণ্য</span>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>পণ্যের নাম</th><th>ক্যাটাগরি</th><th>একক</th>
        ${isAdmin?'<th>ক্রয়মূল্য (কত পরিমাণে)</th>':''}
        <th>বিক্রয়মূল্য (কত পরিমাণে)</th><th>কর্পোরেট মূল্য</th><th>স্টক</th><th>একশন</th>
      </tr></thead><tbody id="prodBody">${rowsHtml}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
  scrollToHl();
}

const XL = {id:'আইডি', name:'পণ্যের নাম', cat:'ক্যাটাগরি', unit:'একক (কেজি/গ্রাম/লিটার/পিস)', cost:'ক্রয়মূল্য', retail:'বিক্রয়মূল্য', stock:'স্টক', min:'ন্যূনতম স্টক সতর্কতা', active:'সক্রিয় (হ্যাঁ/না)'};
XL.corporate = 'কর্পোরেট মূল্য';
const XL_COLS = [XL.id, XL.name, XL.cat, XL.unit, XL.cost, XL.retail, XL.corporate, XL.stock, XL.min, XL.active];
function writeProductSheet(rows, filename){
  const ws = XLSX.utils.aoa_to_sheet([XL_COLS, ...rows]);
  ws['!cols'] = [{wch:8},{wch:28},{wch:16},{wch:22},{wch:12},{wch:12},{wch:14},{wch:10},{wch:16},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'পণ্য তালিকা');
  XLSX.writeFile(wb, filename);
}
function downloadProductDemoExcel(){
  writeProductSheet([['','মিনিকেট চাল','খাদ্যশস্য','কেজি',68,78,72,200,20,'হ্যাঁ']], 'avera-mart-product-demo.xlsx');
}
function exportProductsExcel(){
  const rows = CACHE.products.map(p => [p.id, p.name, p.category, p.unit||'কেজি', p.cost, p.retail, p.corporate||'', p.stock, p.minStock, p.hidden?'না':'হ্যাঁ']);
  writeProductSheet(rows, `avera-mart-products-${todayStr()}.xlsx`);
}
function cellVal(row, key){ const v = row[key]; return (v===undefined || v===null || String(v).trim()==='') ? null : v; }
function handleExcelUpload(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
      const products = CACHE.products.slice();
      const settings = {...CACHE.settings};
      const newCategories = [];
      const findExisting = (id, name) => {
        if(id){ const i = products.findIndex(p=>p.id===id); if(i>-1) return i; }
        if(name){ return products.findIndex(p=>p.name.trim().toLowerCase()===name.toLowerCase()); }
        return -1;
      };
      const planned = rows.map(row => {
        const id = String(cellVal(row, XL.id) ?? '').trim();
        const name = String(cellVal(row, XL.name) ?? '').trim();
        return {row, id, name, idx: findExisting(id, name)};
      });
      const stockInUpdates = planned.some(x => x.idx>-1 && cellVal(x.row, XL.stock)!==null);
      const updateStock = stockInUpdates ? confirm('ফাইলে থাকা পণ্যগুলোর স্টকের সংখ্যাও কি আপডেট করতে চান?\n\nOK = স্টকসহ সব আপডেট\nCancel = শুধু দাম/নাম/ক্যাটাগরি ইত্যাদি আপডেট, স্টক অপরিবর্তিত\n\n(সতর্কতা: ফাইল ডাউনলোডের পর নতুন বিক্রি/ক্রয় হয়ে থাকলে স্টক পুরোনো হয়ে যেতে পারে)') : false;
      let added = 0, updated = 0, skipped = 0;
      const addedIds = [], addedNames = [];
      const isNo = v => ['না','no','n','0','false','hidden'].includes(String(v).trim().toLowerCase());

      planned.forEach(({row, id, name, idx}) => {
        const cat = cellVal(row, XL.cat);
        if(cat && !settings.productCategories.includes(String(cat).trim()) && !newCategories.includes(String(cat).trim())) newCategories.push(String(cat).trim());
        const unit = cellVal(row, XL.unit) ?? cellVal(row, 'একক');
        const cost = cellVal(row, XL.cost), retail = cellVal(row, XL.retail) ?? cellVal(row, 'খুচরা মূল্য');
        const stock = cellVal(row, XL.stock), min = cellVal(row, XL.min), active = cellVal(row, XL.active);
        const cor = cellVal(row, XL.corporate);
        if(idx>-1){
          const old = products[idx], ch = {};
          if(name) ch.name = name;
          if(cat) ch.category = String(cat).trim();
          if(unit) ch.unit = String(unit).trim();
          if(cost!==null) ch.cost = Number(cost);
          if(retail!==null) ch.retail = Number(retail);
          if(cor!==null) ch.corporate = Number(cor)||0;
          if(min!==null) ch.minStock = Number(min);
          if(updateStock && stock!==null){ ch.stock = Number(stock); if(r3(ch.stock)!==r3(old.stock)) ch.adj = (old.adj||[]).concat([{d: todayStr(), q: r3(ch.stock - Number(old.stock||0))}]); }
          if(active!==null) ch.hidden = isNo(active);
          products[idx] = {...old, ...ch};
          updated++;
        } else if(name){
          const newId = genId('P', products);
          addedIds.push(newId); addedNames.push(name);
          products.push({
            id: newId, name,
            category: cat ? String(cat).trim() : 'অন্যান্য',
            unit: unit ? String(unit).trim() : 'কেজি',
            cost: Number(cost||0), retail: Number(retail||0), corporate: Number(cor||0),
            stock: Number(stock||0), minStock: Number(min ?? 5),
            hidden: active!==null ? isNo(active) : false,
            createdAt: todayStr(),
            adj: Number(stock||0)>0 ? [{d: todayStr(), q: r3(Number(stock)), n:'প্রারম্ভিক স্টক'}] : []
          });
          added++;
        } else { skipped++; }
      });

      if(added===0 && updated===0){ alert('ফাইলে কোনো বৈধ পণ্যের সারি পাওয়া যায়নি। কলামের নাম ঠিক আছে কিনা যাচাই করুন (ডেমো বা এক্সপোর্ট করা ফাইলের ফরম্যাট অনুযায়ী)।'); event.target.value=''; return; }
      if(newCategories.length){ settings.productCategories = [...settings.productCategories, ...newCategories]; }
      saveCollection('products', products);
      if(newCategories.length) saveSettings(settings);
      PROD_Q = ''; PROD_FILTER = 'all';
      setFlash('products', `✅ এক্সেল আপলোড সম্পন্ন — ${updated}টি পণ্য আপডেট এবং ${added}টি নতুন পণ্য যোগ হয়েছে।${skipped?` (${skipped}টি সারি বাদ গেছে)`:''}${addedNames.length ? `<br>নতুন পণ্য (তালিকার নিচে, হলুদ দাগে): ${addedNames.slice(0,12).map(esc).join('، ')}${addedNames.length>12?' ...':''}` : ''}`, addedIds);
      renderProducts();
      if(!addedIds.length) toTop();
    }catch(err){
      alert('ফাইলটি পড়া যায়নি। এটা ঠিক .xlsx ফরম্যাটের ফাইল কিনা এবং কলাম কাঠামো ঠিক আছে কিনা যাচাই করুন।');
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}
function toggleProductHidden(id){
  FLASH = null;
  const products = CACHE.products.map(p => p.id===id ? {...p, hidden: !p.hidden} : p);
  saveCollection('products', products);
  renderProducts();
}

function updatePriceHint(){
  const unit = document.getElementById('f_unit').value || 'কেজি';
  const n = Number(document.getElementById('f_basis').value)||1;
  const bl = n===1 ? `প্রতি ১ ${unit}` : `${r3(n)} ${unit}-এর জন্য`;
  document.querySelectorAll('.basis-lbl').forEach(e=>e.textContent = bl);
  const rEl = document.getElementById('f_retail'), cEl = document.getElementById('f_cost');
  const r = Number(rEl.value||0)/n, c = cEl ? Number(cEl.value||0)/n : null;
  document.getElementById('f_pricehint').innerHTML = `📌 বিক্রয়মূল্য: <b>${money(Number(rEl.value||0))} / ${n===1?'১':r3(n)} ${esc(unit)}</b>`
    + (n!==1 ? ` → প্রতি ১ ${esc(unit)} <b>${money(r)}</b>` : '')
    + (c!==null ? `<br>ক্রয়মূল্য: <b>${money(Number(cEl.value||0))} / ${n===1?'১':r3(n)} ${esc(unit)}</b>`+(n!==1?` → প্রতি ১ ${esc(unit)} <b>${money(c)}</b>`:'') : '');
}
function openProductForm(id){
  const products = CACHE.products;
  const p = id ? products.find(x=>x.id===id) : null;
  const isAdmin = getSession().role==='admin';
  const html = `
    <div class="panel">
      <h3>${p?'পণ্য সম্পাদনা':'নতুন পণ্য যোগ করুন'}</h3>
      <div class="form-grid">
        <div class="form-field"><label>পণ্যের নাম</label><input id="f_name" value="${p?esc(p.name):''}"></div>
        <div class="form-field"><label>ক্যাটাগরি</label>
          <select id="f_cat">
            ${CACHE.settings.productCategories.map(c=>`<option ${p&&p.category===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>পরিমাণ/একক — মসলা, চাল, ডাল ইত্যাদির জন্য "কেজি" দিন, ডাল/চালের মতো পণ্যে "কেজি" রাখুন</label>
          <select id="f_unit">
            ${UNIT_OPTIONS.map(u=>`<option ${(p&&p.unit===u)||(!p&&u==='কেজি')?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>নিচের দাম কত পরিমাণের জন্য? (যেমন ১ কেজি, ৫ কেজি, ১ প্যাকেট)</label>
          <input id="f_basis" type="number" step="any" min="0" value="${p?(Number(p.priceBasis)||1):1}" oninput="updatePriceHint()">
          <span class="muted-cell" style="font-size:11.5px;">১ কেজির দাম হলে ১ রাখুন। ৫ কেজির দাম হলে ৫ লিখুন — তখন ক্রয়মূল্য ও বিক্রয়মূল্য ৫ কেজির দাম বসাবেন, সিস্টেম নিজে প্রতি একক হিসাব করে নেবে।</span>
        </div>
        ${isAdmin?`<div class="form-field"><label>ক্রয়মূল্য (৳) — <span class="basis-lbl"></span></label><input id="f_cost" type="number" step="any" value="${p?packPrice(p,'cost'):''}" oninput="updatePriceHint()"><span class="muted-cell" style="font-size:11.5px;">ক্রয় এন্ট্রি থাকলে এই দাম প্রতিবার ভাউচার গড় অনুযায়ী নিজে থেকে বদলায়।</span></div>`:''}
        <div class="form-field"><label>বিক্রয়মূল্য (৳) — <span class="basis-lbl"></span></label><input id="f_retail" type="number" step="any" value="${p?packPrice(p,'retail'):''}" oninput="updatePriceHint()"></div>
        <div class="form-field"><label>কর্পোরেট মূল্য (৳) — ঐচ্ছিক, <span class="basis-lbl"></span></label><input id="f_corporate" type="number" step="any" value="${p && Number(p.corporate)>0 ? packListPrice(p,'corporate') : ''}" placeholder="ফাঁকা = খুচরা দাম"></div>
        <div class="form-field" style="grid-column:1/-1;"><div id="f_pricehint" class="flash" style="margin:0;"></div></div>
        <div class="form-field" style="grid-column:1/-1;">
          <label>🏷️ পরিমাণ অনুযায়ী ছাড় (ঐচ্ছিক — সর্বোচ্চ ৩টি স্তর)</label>
          ${[0,1,2].map(i => { const t = qtyDiscTiers(p)[i] || {}; return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
            <span class="muted-cell">কমপক্ষে</span><input id="f_qd_min${i}" type="number" min="0" step="any" value="${t.min||''}" placeholder="পরিমাণ" style="width:90px;">
            <span class="muted-cell">(পণ্যের এককে) নিলে</span>
            <select id="f_qd_type${i}" style="padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--bg);"><option value="amt" ${t.type==='amt'||!t.type?'selected':''}>মোট ৳ ছাড়</option><option value="unit" ${t.type==='unit'?'selected':''}>প্রতি একক ৳ ছাড়</option><option value="pct" ${t.type==='pct'?'selected':''}>% ছাড়</option></select>
            <input id="f_qd_val${i}" type="number" min="0" step="any" value="${t.val||''}" placeholder="ছাড়" style="width:90px;"></div>`; }).join('')}
          <span class="muted-cell" style="font-size:11.5px;">যেমন: চাল — ২৫ কেজি, মোট ৳ ছাড়, ৫০। অর্ডারে ওই পরিমাণ দিলে ছাড় নিজে থেকে বসবে (ইনভয়েসে "ছাড়" হিসেবে দেখাবে)। ফাঁকা রাখলে কোনো স্তর থাকবে না।</span>
        </div>
        <div class="form-field"><label>বর্তমান স্টক (এককে)</label><input id="f_stock" type="number" value="${p?p.stock:0}"></div>
        <div class="form-field"><label>ন্যূনতম স্টক সতর্কতা</label><input id="f_min" type="number" value="${p?p.minStock:5}"></div>
        <div class="form-field"><label>বিক্রির জন্য চালু?</label>
          <label style="display:flex;gap:8px;align-items:center;font-weight:400;"><input id="f_active" type="checkbox" ${p&&p.hidden?'':'checked'}> চালু (অর্ডারে দেখাবে)</label>
          <span class="muted-cell" style="font-size:11.5px;">এখনো কেনা হয়নি এমন পণ্যের টিক তুলে দিন — অর্ডারের সার্চে, লো-স্টক সতর্কতায় ও ইনভেন্টরি রিপোর্টে আসবে না। ক্রয় এন্ট্রি দিলে নিজে থেকেই চালু হয়ে যাবে।</span>
        </div>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveProduct('${p?p.id:''}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="closeForm(renderProducts)">বাতিল</button>
      </div>
    </div>`;
  openForm(html);
  document.getElementById('f_unit').addEventListener('change', updatePriceHint);
  updatePriceHint();
}

function saveProduct(id){
  const products = CACHE.products.slice();
  const isAdmin = getSession().role==='admin';
  const name = document.getElementById('f_name').value.trim();
  if(!name){ alert('পণ্যের নাম দিন'); return; }
  const basis = Number(document.getElementById('f_basis').value);
  if(!(basis>0)){ alert('দাম কত পরিমাণের জন্য তা সঠিকভাবে দিন (যেমন ১ বা ৫)'); return; }
  const per = v => Math.round(v/basis*10000)/10000;
  const qd = []; const seen = new Set();
  for(let i=0;i<3;i++){
    const mn = Number(document.getElementById('f_qd_min'+i).value||0), vl = Number(document.getElementById('f_qd_val'+i).value||0), ty = document.getElementById('f_qd_type'+i).value;
    if(!mn && !vl) continue;
    if(!(mn>0) || !(vl>0)){ alert(`ছাড়ের স্তর ${i+1}: পরিমাণ ও ছাড় দুটোই দিন (অথবা দুটোই ফাঁকা রাখুন)।`); return; }
    if(ty==='pct' && vl>100){ alert(`ছাড়ের স্তর ${i+1}: শতাংশ ১০০-র বেশি হতে পারে না।`); return; }
    if(seen.has(mn)){ alert('দুটি স্তরে একই পরিমাণ দেওয়া যাবে না।'); return; }
    seen.add(mn); qd.push({min:mn, type:ty, val:vl});
  }
  qd.sort((a,b) => a.min-b.min);
  const data = {
    qtyDisc: qd,
    name,
    category: document.getElementById('f_cat').value,
    cost: (() => { const old0 = id ? products.find(p=>p.id===id) : null; if(!isAdmin) return old0 ? (old0.cost||0) : 0; const v = Number(document.getElementById('f_cost').value||0); if(old0 && (Number(old0.priceBasis)||1)===basis && Math.abs(v - packPrice(old0,'cost')) < 0.0051) return old0.cost; return per(v); })(),
    unit: document.getElementById('f_unit').value.trim() || 'কেজি',
    priceBasis: basis,
    packSize: parsePackUnit(document.getElementById('f_unit').value.trim()) ? 0 : (products.find(p=>p.id===id)?.packSize || 0),
    retail: per(Number(document.getElementById('f_retail').value||0)),
    corporate: (() => { const v = Number(document.getElementById('f_corporate').value||0); return v>0 ? per(v) : 0; })(),
    stock: Number(document.getElementById('f_stock').value||0),
    minStock: Number(document.getElementById('f_min').value||0),
    hidden: !document.getElementById('f_active').checked
  };
  if(id){
    const idx = products.findIndex(p=>p.id===id);
    const oldStock = Number(products[idx].stock||0);
    const adj = (products[idx].adj||[]).slice();
    if(r3(data.stock) !== r3(oldStock)) adj.push({d: todayStr(), q: r3(data.stock - oldStock)});
    products[idx] = {...products[idx], ...data, adj};
  } else {
    data.id = genId('P', products);
    data.createdAt = todayStr();
    if(Number(data.stock) > 0) data.adj = [{d: todayStr(), q: r3(data.stock), n:'প্রারম্ভিক স্টক'}];
    products.push(data);
  }
  saveCollection('products', products);
  const savedId = id || data.id;
  PROD_Q = ''; PROD_FILTER = 'all';
  if(id){
    setFlash('products', `✅ <b>${esc(name)}</b> (${savedId}) আপডেট হয়েছে — হলুদ দাগ দেওয়া সারিটি দেখুন।`, savedId);
  } else if(data.hidden){
    setFlash('products', `✅ নতুন পণ্য <b>${esc(name)}</b> (আইডি ${savedId}) পণ্য তালিকার <b>সবার নিচে</b> যোগ হয়েছে (হলুদ দাগ দেওয়া সারি)।<br>⚠️ পণ্যটি "লুকানো" অবস্থায় আছে, তাই অর্ডারের সার্চ, লো-স্টক সতর্কতা ও ইনভেন্টরি রিপোর্টে এখন দেখা যাবে না। এখনই চালু করতে চাইলে: <button class="btn btn-accent btn-sm" onclick="toggleProductHidden('${savedId}')">চালু করুন</button>`, savedId, true);
  } else {
    setFlash('products', `✅ নতুন পণ্য <b>${esc(name)}</b> (আইডি ${savedId}) পণ্য তালিকার <b>সবার নিচে</b> যোগ হয়েছে (হলুদ দাগ দেওয়া সারি)।<br>এটি এখন অর্ডারের সার্চ ও ইনভেন্টরি রিপোর্টেও দেখা যাবে।`, savedId);
  }
  renderProducts();
}
function deleteProduct(id){
  if(!confirm('এই পণ্যটি মুছে ফেলতে চান?')) return;
  saveCollection('products', CACHE.products.filter(p=>p.id!==id));
  renderProducts();
}

/* ============================================================
   ORDERS / SALES
   ============================================================ */
let ORD_MONTH = 'all';
function onOrderMonth(sel){ ORD_MONTH = sel.value; renderOrders(); }
function renderOrders(){
  const session = getSession();
  const orders = CACHE.orders.filter(o => ORD_MONTH==='all' || mOf(o.date)===ORD_MONTH);
  const products = CACHE.products;
  const isDelivery = false;   // ডেলিভারি ম্যান রোল তুলে দেওয়া হয়েছে
  const canSeeMoney = !isDelivery;

  function itemsSummary(o){
    const items = orderItems(o);
    const names = items.map(it => {
      const p = products.find(p=>p.id===it.productId);
      return `${esc(p?p.name:'—')} x${fmtItem(it,p)}`;
    });
    if(names.length<=2) return names.join(', ');
    return names.slice(0,2).join(', ') + ` +আরও ${names.length-2}টি`;
  }

  let rows = orders.slice().reverse().map(o => `
    <tr>
      <td>${o.id} ${editedBadge(o)}</td><td>${o.date}</td>
      <td>${esc(o.customerName)}${orderListBadge(o)}<br><span class="muted-cell">${esc(o.phone)}</span></td>
      <td>${itemsSummary(o)}</td>
      ${canSeeMoney ? `<td class="cell-num">${money(o.total)}</td>` : ''}
      <td class="cell-center">
        <select ${isDateLocked(o.date)?'disabled title="এই মাস লক করা"':''} onchange="updateOrderStatus('${o.id}', this.value)">
          ${['Pending','Processing','Delivered','Cancelled'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${STATUS_BN[s]}</option>`).join('')}
        </select>
      </td>
      ${canSeeMoney ? `<td class="cell-center"><span class="badge ${PAY_BADGE[o.paymentStatus]}">${PAY_BN[o.paymentStatus]}</span></td>` : ''}
      ${!isDelivery ? `<td class="cell-center"><button class="icon-btn" title="ইনভয়েস দেখুন" onclick="viewInvoice('${o.id}')">🧾</button>${isAdmin() && isDateLocked(o.date) ? '<span title="এই মাস লক করা">🔒</span>' : isAdmin() ? `<button class="icon-btn" title="সংশোধন" onclick="openOrderForm('${o.id}')">✏️</button><button class="icon-btn danger" title="মুছুন" onclick="deleteOrder('${o.id}')">🗑️</button>` : ''}</td>` : ''}
    </tr>`).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>অর্ডার ও সেলস</h3>
        ${!isDelivery ? `<button class="btn btn-accent btn-sm" onclick="openOrderForm()">+ নতুন অর্ডার</button>` : ''}
      </div>
      <div class="toolbar">
        <label style="font-size:13px;">মাস:</label>
        <select onchange="onOrderMonth(this)">${monthOptionsHtml(ORD_MONTH, true)}</select>
        <span class="muted-cell">${orders.length}টি অর্ডার</span>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>কাস্টমার</th><th>পণ্য</th>
        ${canSeeMoney?'<th>মোট মূল্য</th>':''}
        <th>স্ট্যাটাস</th>
        ${canSeeMoney?'<th>পেমেন্ট</th>':''}
        ${!isDelivery?'<th>একশন</th>':''}
      </tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty-state">কোনো অর্ডার নেই</td></tr>`}</tbody></table></div>
      ${session.role==='manager' ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px;">অর্ডার/ইনভয়েসে ভুল থাকলে সংশোধন বা মোছার ক্ষমতা শুধু অ্যাডমিনের — অ্যাডমিনকে জানান।</p>` : ''}
    </div>
    <div id="modalHolder"></div>
  `;
}

function updateOrderStatus(id, newStatus){
  const orders = CACHE.orders.slice();
  const products = CACHE.products.slice();
  const idx = orders.findIndex(o=>o.id===id);
  const order = {...orders[idx]};
  if(!guardDate(order.date, 'স্ট্যাটাস পরিবর্তন')){ renderOrders(); return; }
  const wasDelivered = order.status === 'Delivered';
  const willBeDelivered = newStatus === 'Delivered';

  if(wasDelivered !== willBeDelivered){
    const sign = willBeDelivered ? -1 : 1; // going TO delivered subtracts stock, coming FROM delivered restores it
    orderItems(order).forEach(it => {
      const pIdx = products.findIndex(p=>p.id===it.productId);
      if(pIdx>-1){ products[pIdx] = {...products[pIdx], stock: r3(Number(products[pIdx].stock) + sign*Number(it.qty))}; }
    });
  }
  order.status = newStatus;
  orders[idx] = order;
  saveCollection('products', products);
  saveCollection('orders', orders);
  renderOrders();
}

/* ---- Order form: multi-product cart with a searchable product picker ---- */
let ORDER_PL = 'retail';
/* ============================================================
   পরিমাণ অনুযায়ী ছাড় (স্তর) — পণ্যে সর্বোচ্চ ৩টি: "কমপক্ষে X এককে → ছাড়"
   ধরন: amt = মোট বিলে ৳ ছাড় · unit = প্রতি একক ৳ ছাড় · pct = % ছাড়। পরিমাণ পণ্যের নিজের এককে (যেমন কেজি)।
   অর্ডারে সবচেয়ে বড় যে স্তরে পৌঁছেছে শুধু সেটাই নিজে থেকে "এই পণ্যে ছাড়" ঘরে বসে; হাতে বদলালে আর বদলায় না।
   ============================================================ */
function qtyDiscTiers(p){
  if(!p || !Array.isArray(p.qtyDisc)) return [];
  return p.qtyDisc.map(t => ({min:Number(t.min), type:['amt','unit','pct'].includes(t.type) ? t.type : 'amt', val:Number(t.val)}))
    .filter(t => t.min>0 && t.val>0).sort((a,b) => a.min-b.min).slice(0,3);
}
function qtyDiscPick(p, qty){ let best = null; qtyDiscTiers(p).forEach(t => { if(Number(qty)+1e-9 >= t.min) best = t; }); return best; }
function qtyDiscLabel(t, p){
  const unit = (p && p.unit) || 'কেজি';
  return `${r3(t.min)} ${unit}+ → ${t.type==='pct' ? t.val+'%' : '৳'+r3(t.val)} ছাড়${t.type==='unit' ? ' (প্রতি '+unit+')' : ''}`;
}
function qtyDiscText(p){ const ts = qtyDiscTiers(p); return ts.length ? '🏷️ ' + ts.map(t => qtyDiscLabel(t, p)).join(' · ') : ''; }
function applyAutoDisc(it){
  if(it.discManual) return;
  const p = CACHE.products.find(x => x.id===it.productId), t = qtyDiscPick(p, it.qty);
  if(!t){ if(it.discAuto){ it.discType = 'amt'; it.discVal = 0; it.discAuto = false; } return; }
  if(t.type==='pct'){ it.discType = 'pct'; it.discVal = t.val; }
  else { it.discType = 'amt'; it.discVal = t.type==='unit' ? Math.round(t.val*Number(it.qty)*100)/100 : t.val; }
  it.discAuto = true;
}
function resetAutoDisc(productId){
  const it = ORDER_CART.find(x => x.productId===productId); if(!it) return;
  it.discManual = false; applyAutoDisc(it); renderCart();
}
function qtyDiscHint(it, p){
  const ts = qtyDiscTiers(p); if(!ts.length) return '';
  const cur = qtyDiscPick(p, it.qty);
  if(it.discManual) return cur ? `<br><button class="btn btn-outline btn-sm" style="margin-top:4px;font-size:11px;padding:2px 8px;" onclick="resetAutoDisc('${it.productId}')">↺ স্তরের ছাড় বসান (${esc(qtyDiscLabel(cur, p))})</button>` : '';
  if(cur) return `<br><span style="font-size:11px;color:#0E7448;">স্তরের ছাড়: ${esc(qtyDiscLabel(cur, p))}</span>`;
  const nx = ts[0]; return `<br><span style="font-size:11px;color:var(--text-muted);">${r3(nx.min - Number(it.qty))} ${esc(p.unit||'কেজি')} আরও নিলে ${nx.type==='pct' ? nx.val+'%' : '৳'+r3(nx.val)} ছাড়</span>`;
}
let ORDER_CART = [];   // [{productId, qty, unitPrice, standardPrice}]

let ORDER_FROM = 'orders', ORDER_EDIT_ID = '';
function cancelOrderForm(){
  if(ORDER_FROM==='invoice' && ORDER_EDIT_ID){ renderInvoice(ORDER_EDIT_ID); } else { renderOrders(); }
  toTop();
}
function viewInvoice(id){ INVOICE_PRESELECT = id; go('invoice'); }
function openOrderForm(id, from){
  if(id && !isAdmin()){ alert('অর্ডার/ইনভয়েস সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  if(id){ const eo = CACHE.orders.find(o=>o.id===id); if(eo && !guardDate(eo.date, 'সংশোধন')) return; }
  ORDER_FROM = from || 'orders'; ORDER_EDIT_ID = id || '';
  const orders = CACHE.orders;
  const o = id ? orders.find(x=>x.id===id) : null;
  ORDER_PL = (o && PRICE_LISTS[o.priceList]) ? o.priceList : 'retail';
  ORDER_CART = o ? orderItems(o).map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    const m = unitOptions(p).find(o=>o.label===it.du);
    return {...it, mode: m ? m.key : 'base', pl: PRICE_LISTS[it.pl] ? it.pl : ORDER_PL, discManual:true};   // সংরক্ষিত ছাড় যেমন আছে তেমনই থাকবে
  }) : [];

  const html = `
    <div class="panel">
      <h3>${o?`ইনভয়েস/অর্ডার সংশোধন — ${o.id}`:'নতুন অর্ডার'}</h3>
      ${o ? `<p style="font-size:12.5px;color:var(--text-muted);margin-top:-2px;">নাম, ঠিকানা, পণ্য, পরিমাণ, দাম, ডেলিভারি চার্জ, ছাড়, পেমেন্ট — যা ভুল হয়েছে সেটা বদলে "সংরক্ষণ করুন" চাপুন।${o.status==='Delivered' ? ' অর্ডারটি ডেলিভারড হওয়ায় পণ্যের পরিমাণ বদলালে স্টক নিজে থেকেই ঠিক হয়ে যাবে।' : ''}</p>` : ''}
      <div class="form-grid">
        ${dateField('o_date', o?o.date:'')}
        <div class="form-field"><label>কাস্টমার নাম</label><input id="o_name" value="${o?esc(o.customerName):''}"></div>
        <div class="form-field"><label>মোবাইল নম্বর</label><input id="o_phone" value="${o?esc(o.phone):''}"></div>
        <div class="form-field"><label>শেয়ারহোল্ডার ক্রেতা (ঐচ্ছিক — শুধু ট্র্যাকিংয়ের জন্য)</label><select id="o_sh" onchange="onOrderShareholder(this.value)" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);"><option value="">— সাধারণ ক্রেতা —</option>${CACHE.shareholders.map(sh=>`<option value="${esc(sh.id)}" ${o&&o.shareholderId===sh.id?'selected':''}>${esc(sh.name)}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>ডেলিভারি ঠিকানা</label><input id="o_addr" value="${o?esc(o.address):''}"></div>
        <div class="form-field"><label>সব পণ্যের মূল্য তালিকা (প্রতিটি পণ্যের আলাদাও বাছা যায়)</label><select id="o_pl" onchange="onPriceListChange(this.value)" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${Object.keys(PRICE_LISTS).map(k => `<option value="${k}" ${ORDER_PL===k?'selected':''}>${PRICE_LISTS[k]}</option>`).join('')}</select></div>
        <div class="form-field"><label>ডেলিভারি চার্জ (৳)</label><input id="o_delivery" type="number" value="${o?o.deliveryCharge:0}" oninput="renderCart()"></div>
        <div class="form-field"><label>ছাড় / ডিসকাউন্ট (৳)</label><input id="o_discount" type="number" value="${o?(o.discount||0):0}" oninput="renderCart()"></div>
        <div class="form-field"><label>অর্ডার সোর্স</label>
          <select id="o_source">
            ${['Online App','Website','Offline Counter'].map(s=>`<option ${o&&o.source===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>পেমেন্ট স্ট্যাটাস</label>
          <select id="o_pay" onchange="onPaymentStatusChange()">
            ${['Paid','Due','Partial'].map(s=>`<option value="${s}" ${o&&o.paymentStatus===s?'selected':''}>${PAY_BN[s]}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>পরিশোধের পরিমাণ (৳)</label><input id="o_paid" type="number" value="${o?(o.paidAmount!=null?o.paidAmount:(o.paymentStatus==='Paid'?o.total:0)):0}"></div>
        <div class="form-field"><label>পেমেন্টের ধরন</label>
          <select id="o_paymethod" onchange="onPayMethodChange()">
            ${PAY_METHODS.map(m=>`<option value="${m.value}" ${(o&&o.paymentMethod===m.value) || (!o&&m.value==='Cash')?'selected':''}>${m.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-field span-2 ${(o&&o.paymentMethod&&o.paymentMethod!=='Cash')?'':'hidden'}" id="o_txnref_wrap">
          <label>ট্রানজেকশন আইডি / অ্যাকাউন্ট নম্বর</label>
          <input id="o_txnref" value="${o?esc(o.transactionRef||''):''}">
        </div>
      </div>

      <div style="margin-top:18px;">
        <label style="font-size:12.5px;color:var(--text-muted);display:block;margin-bottom:5px;">পণ্য খুঁজুন ও যোগ করুন</label>
        <input id="o_search" type="text" placeholder="পণ্যের নাম লিখুন..." oninput="renderProductSearch(this.value)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
        <div id="searchResults" class="search-results"></div>
      </div>

      <div id="cartHolder" style="margin-top:14px;"></div>

      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveOrder('${o?o.id:''}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="cancelOrderForm()">বাতিল</button>
      </div>
    </div>`;
  openForm(html);
  renderCart();
  custSuggestInit();
}

function renderProductSearch(query){
  const box = document.getElementById('searchResults');
  const q = query.trim().toLowerCase();
  if(!q){ box.innerHTML=''; box.classList.remove('open'); return; }
  const matches = prodMatches(query, 10, false);
  if(!matches.length){
    box.innerHTML = `<div class="search-empty">কোনো পণ্য পাওয়া যায়নি</div>`;
    box.classList.add('open');
    return;
  }
  box.innerHTML = matches.map(p => `
    <div class="search-result-item" onclick="addToCart('${p.id}')" style="flex-direction:column;align-items:flex-start;gap:2px;">
      <div style="display:flex;justify-content:space-between;width:100%;">
        <span>${esc(p.name)}</span>
        <span class="muted-cell">স্টক: ${fmtStock(p.stock, p)} · ${money(unitListPrice(p, ORDER_PL))}/${esc(p.unit||'কেজি')}</span>
      </div>
      ${p.priceTiers ? `<span class="muted-cell" style="font-size:11.5px;">${esc(p.priceTiers)}</span>` : ''}
      ${qtyDiscText(p) ? `<span class="muted-cell" style="font-size:11.5px;">${esc(qtyDiscText(p))}</span>` : ''}
    </div>`).join('');
  box.classList.add('open');
}

function addToCart(productId){
  const p = CACHE.products.find(x=>x.id===productId);
  if(!p) return;
  const existing = ORDER_CART.find(it=>it.productId===productId);
  if(existing){ existing.qty = Number(existing.qty) + 1; applyAutoDisc(existing); }
  else { const lp = unitListPrice(p, ORDER_PL); ORDER_CART.push({productId, qty:1, unitPrice: lp, standardPrice: lp, pl: ORDER_PL, discType:'amt', discVal:0, surType:'amt', surVal:0}); applyAutoDisc(ORDER_CART[ORDER_CART.length-1]); }
  document.getElementById('o_search').value = '';
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchResults').classList.remove('open');
  renderCart();
}
function updateCartQty(productId, qty){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it){
    const v = Number(qty)||0;
    const o = optByKey(CACHE.products.find(x=>x.id===productId), it.mode);
    it.qty = Math.max(0.001, v/o.factor) || 1;
    applyAutoDisc(it);
  }
  renderCart();
}
function setCartUnitMode(productId, mode){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it){ it.mode = mode; }
  renderCart();
}
function removeFromCart(productId){
  ORDER_CART = ORDER_CART.filter(it=>it.productId!==productId);
  renderCart();
}

function cartTotal(){
  const deliveryCharge = Number(document.getElementById('o_delivery')?.value || 0);
  const discount = Number(document.getElementById('o_discount')?.value || 0);
  const subtotal = ORDER_CART.reduce((s,it)=>s+lineAmt(it),0);
  return Math.max(0, subtotal + deliveryCharge - discount);
}
function onPaymentStatusChange(){
  const status = document.getElementById('o_pay').value;
  const paidField = document.getElementById('o_paid');
  if(status==='Paid') paidField.value = cartTotal();
  else if(status==='Due') paidField.value = 0;
  // 'Partial' — leave whatever the user already typed, they fill it manually
}
function onPayMethodChange(){
  const method = document.getElementById('o_paymethod').value;
  document.getElementById('o_txnref_wrap').classList.toggle('hidden', method==='Cash');
}
function updateCartDisc(productId, key, val){
  const it = ORDER_CART.find(x=>x.productId===productId); if(!it) return;
  it.discManual = true; it.discAuto = false;   // হাতে বদলালে আর নিজে থেকে বদলাবে না
  if(key==='type'){ it.discType = val==='pct' ? 'pct' : 'amt'; }
  else { it.discType = it.discType || 'amt'; it.discVal = Math.max(0, Number(val)||0); }
  renderCart();
}
function onPriceListChange(v){
  const old = ORDER_PL;
  if(ORDER_CART.length && !confirm('কার্টের সব পণ্যের দাম "' + PRICE_LISTS[v] + '" মূল্য তালিকা অনুযায়ী বদলাবে (প্রতিটি পণ্যের আলাদা বাছাই মুছে যাবে; ছাড় অপরিবর্তিত থাকবে)। এগিয়ে যাবেন?')){ const el = document.getElementById('o_pl'); if(el) el.value = old; return; }
  ORDER_PL = v;
  ORDER_CART.forEach(it => { const p = CACHE.products.find(x => x.id===it.productId); if(!p) return; const lp = unitListPrice(p, v); it.unitPrice = lp; it.standardPrice = lp; it.pl = v; });
  renderCart();
}
function updateCartPL(productId, v){
  const it = ORDER_CART.find(x => x.productId===productId); if(!it) return;
  const p = CACHE.products.find(x => x.id===productId); if(!p) return;
  const lp = unitListPrice(p, v); it.pl = v; it.unitPrice = lp; it.standardPrice = lp; renderCart();
}
function orderLists(o){ const set = new Set(orderItems(o).map(it => (it.pl && PRICE_LISTS[it.pl]) ? it.pl : ((o.priceList && PRICE_LISTS[o.priceList]) ? o.priceList : 'retail'))); return [...set]; }
function orderListBadge(o){
  const shb = o.shareholderId ? ' <span class="badge" style="background:#E3F4EA;color:#1B6B3A;">🤝 শেয়ারহোল্ডার</span>' : '';
  const ls = orderLists(o); if(ls.length===1 && ls[0]==='retail') return shb;
  const t = ls.length>1 ? 'মিশ্র তালিকা' : PRICE_LISTS[ls[0]];
  return shb + ' <span class="badge" style="background:#E9E4FA;color:#4B2FA8;">' + t + '</span>';
}
function onOrderShareholder(id){
  const sh = CACHE.shareholders.find(x => x.id === id), nm = document.getElementById('o_name');
  if(sh && nm && !nm.value.trim()) nm.value = sh.name;
}
function updateCartSur(productId, key, val){
  const it = ORDER_CART.find(x=>x.productId===productId); if(!it) return;
  if(key==='type'){ it.surType = val==='pct' ? 'pct' : 'amt'; }
  else { it.surType = it.surType || 'amt'; it.surVal = Math.max(0, Number(val)||0); }
  renderCart();
}
function updateCartPrice(productId, price){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it) it.unitPrice = Math.max(0, Number(price)||0);
  renderCart();
}
function renderCart(){
  const holder = document.getElementById('cartHolder');
  if(!holder) return;
  const deliveryCharge = Number(document.getElementById('o_delivery')?.value || 0);
  const discount = Number(document.getElementById('o_discount')?.value || 0);
  if(!ORDER_CART.length){
    holder.innerHTML = `<div class="empty-state" style="padding:16px;">এখনো কোনো পণ্য যোগ করা হয়নি — উপরে সার্চ করে পণ্য যোগ করুন</div>`;
    return;
  }
  let subtotal = 0;
  const rows = ORDER_CART.map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    const lineTotal = lineAmt(it);
    subtotal += lineTotal;
    return `
      <tr>
        <td>${esc(p?p.name:'—')}</td>
        <td class="cell-center"><input type="number" min="0.001" step="any" value="${r3(it.qty*optByKey(p,it.mode).factor)}" style="width:75px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartQty('${it.productId}', this.value)">
          ${unitSelectHtml(p, it.mode||'base', `onchange="setCartUnitMode('${it.productId}', this.value)"`)}</td>
        <td class="cell-center"><select onchange="updateCartPL('${it.productId}', this.value)" style="padding:4px;border:1px solid var(--border);border-radius:6px;background:#fff;font-size:12px;margin-bottom:4px;">${Object.keys(PRICE_LISTS).map(k => `<option value="${k}" ${(it.pl||ORDER_PL)===k?'selected':''}>${PRICE_LISTS[k]}</option>`).join('')}</select><br><input type="number" min="0" value="${it.unitPrice}" style="width:80px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartPrice('${it.productId}', this.value)">${(it.standardPrice!=null && Number(it.unitPrice)<Number(it.standardPrice)) ? '<br><span style="font-size:11px;color:#B3261E;">দাম কমানো — ইনভয়েসে ছাড় দেখাবে না। "ছাড়" ঘর ব্যবহার করুন।</span>' : ''}</td>
        <td class="cell-center"><input type="number" min="0" step="any" value="${it.discVal||''}" placeholder="০" style="width:70px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartDisc('${it.productId}','val',this.value)">
          <select onchange="updateCartDisc('${it.productId}','type',this.value)" style="padding:5px;border:1px solid var(--border);border-radius:6px;background:#fff;"><option value="amt" ${it.discType!=='pct'?'selected':''}>৳</option><option value="pct" ${it.discType==='pct'?'selected':''}>%</option></select>${qtyDiscHint(it, p)}</td>
        <td class="cell-center"><input type="number" min="0" step="any" value="${it.surVal||''}" placeholder="০" style="width:70px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartSur('${it.productId}','val',this.value)">
          <select onchange="updateCartSur('${it.productId}','type',this.value)" style="padding:5px;border:1px solid var(--border);border-radius:6px;background:#fff;"><option value="amt" ${it.surType!=='pct'?'selected':''}>৳</option><option value="pct" ${it.surType==='pct'?'selected':''}>%</option></select></td>
        <td class="cell-num">${money(lineTotal)}${lineDisc(it)>0 ? `<br><span style="font-size:11.5px;color:#0E7448;">মূল ${money(lineGross(it))} − ছাড় ${money(lineDisc(it))}</span>` : ''}${lineSur(it)>0 ? `<br><span style="font-size:11.5px;color:#9A5B00;">+ বাড়তি ${money(lineSur(it))}</span>` : ''}<br><span class="muted-cell">${r3(it.qty*optByKey(p,it.mode).factor)} ${esc(optByKey(p,it.mode).label)} = ${r3(it.qty)}টি ${esc(p?.unit||'কেজি')} × ${money(it.unitPrice)}</span></td>
        <td class="cell-center"><button class="icon-btn danger" onclick="removeFromCart('${it.productId}')">🗑️</button></td>
      </tr>`;
  }).join('');
  holder.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>একক মূল্য</th><th>এই পণ্যে ছাড়</th><th>বাড়তি</th><th>লাইন টোটাল</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <table style="margin-top:8px;">
      <tr><td>সাবটোটাল</td><td class="cell-num">${money(subtotal)}</td></tr>
      <tr><td>ডেলিভারি চার্জ</td><td class="cell-num">+ ${money(deliveryCharge)}</td></tr>
      ${discount>0 ? `<tr><td>ছাড় / ডিসকাউন্ট</td><td class="cell-num">− ${money(discount)}</td></tr>` : ''}
    </table>
    <div class="invoice-total-row" style="margin-top:6px;"><span>সর্বমোট</span><span>${money(Math.max(0,subtotal+deliveryCharge-discount))}</span></div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">কোনো পণ্যে ছাড় দিতে লাইনের "এই পণ্যে ছাড়" ঘরে টাকা (৳) বা শতাংশ (%) লিখুন — ইনভয়েসে কোন পণ্যে কত ছাড় দিয়েছেন কাস্টমার তা দেখতে পাবেন। একক মূল্য কমাবেন না। পুরো বিলের উপর ছাড় উপরের "ছাড় / ডিসকাউন্ট" ঘরে দিন। হিসাব মেলাতে কোনো পণ্যে বাড়তি টাকা নিলে "বাড়তি" ঘরে লিখুন — ইনভয়েসে আলাদা দেখাবে।</p>
  `;
}

function saveOrder(id){
  const orders = CACHE.orders.slice();
  const deliveryCharge = Number(document.getElementById('o_delivery').value||0);
  const discount = Number(document.getElementById('o_discount').value||0);
  const subtotal = ORDER_CART.reduce((s,it)=>s+lineAmt(it),0);
  const data = {
    date: pickedDate('o_date'),
    customerName: document.getElementById('o_name').value.trim(),
    phone: document.getElementById('o_phone').value.trim(),
    shareholderId: (document.getElementById('o_sh')||{}).value || '',
    address: document.getElementById('o_addr').value.trim(),
    items: ORDER_CART.map(it=>{
      const p = CACHE.products.find(x=>x.id===it.productId);
      const o = optByKey(p, it.mode);
      return {productId:it.productId, qty:Number(it.qty), unitPrice:Number(it.unitPrice), standardPrice:Number(it.standardPrice!=null?it.standardPrice:it.unitPrice),
        lineDiscount: lineDisc(it), discType: it.discType==='pct'?'pct':'amt', discVal: Number(it.discVal)||0,
        lineSurcharge: lineSur(it), surType: it.surType==='pct'?'pct':'amt', surVal: Number(it.surVal)||0, pl: it.pl || ORDER_PL,
        dq: r3(Number(it.qty)*o.factor), du: o.label};
    }),
    discount,
    priceList: ORDER_PL,
    total: Math.max(0, subtotal + deliveryCharge - discount),
    deliveryCharge,
    source: document.getElementById('o_source').value,
    paymentStatus: document.getElementById('o_pay').value,
    paidAmount: Number(document.getElementById('o_paid').value||0),
    paymentMethod: document.getElementById('o_paymethod').value,
    transactionRef: document.getElementById('o_paymethod').value!=='Cash' ? document.getElementById('o_txnref').value.trim() : ''
  };
  if(!data.customerName){ alert('কাস্টমারের নাম দিন'); return; }
  if(!data.items.length){ alert('অন্তত একটি পণ্য যোগ করুন'); return; }
  if(!guardDates([data.date, id ? (orders.find(o=>o.id===id)||{}).date : ''], id ? 'সংশোধন' : 'এন্ট্রি')) return;
  if(ORD_MONTH!=='all') ORD_MONTH = mOf(data.date) || ORD_MONTH;
  if(data.paymentStatus==='Paid') data.paidAmount = Math.max(data.paidAmount, data.total);
  else if(data.paymentStatus==='Due') data.paidAmount = 0;
  if(id){
    const idx = orders.findIndex(o=>o.id===id);
    // drop legacy single-item fields so the order fully switches to the items[] shape
    const prev = {...orders[idx]};
    if(prev.status==='Delivered'){
      // ডেলিভারড অর্ডার সংশোধন: পুরোনো পরিমাণ স্টকে ফেরত, নতুন পরিমাণ স্টক থেকে বাদ
      const products = CACHE.products.map(p=>({...p}));
      adjustStock(products, orderItems(prev), +1);
      adjustStock(products, data.items, -1);
      saveCollection('products', products);
    }
    delete prev.productId; delete prev.qty; delete prev.unitPrice;
    orders[idx] = stampEdit({...prev, ...data});
  } else {
    data.id = genId('ORD-', orders);
    data.status = 'Pending';
    orders.push(data);
  }
  saveCollection('orders', orders);
  if(id && ORDER_FROM==='invoice'){ renderInvoice(id); } else { renderOrders(); }
  toTop();
}
function deleteOrder(id){
  if(!isAdmin()){ alert('অর্ডার মোছা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const o = CACHE.orders.find(x=>x.id===id); if(!o) return;
  if(!guardDate(o.date, 'মুছে ফেলা')) return;
  const delivered = o.status==='Delivered';
  if(!confirm(`এই অর্ডারটি (${id}) মুছে ফেলতে চান?${delivered ? '\n\nঅর্ডারটি ডেলিভারড ছিল — মুছলে এর পণ্যগুলো স্টকে ফেরত যাবে।' : ''}`)) return;
  if(delivered){
    const products = CACHE.products.map(p=>({...p}));
    adjustStock(products, orderItems(o), +1);
    saveCollection('products', products);
  }
  saveCollection('orders', CACHE.orders.filter(x=>x.id!==id));
  renderOrders();
}

/* ============================================================
   PURCHASES
   ============================================================ */
let PU_EDIT_ID = '';
let PU_Q = '', PU_PAY = 'all', PU_MONTH = curMonth();
function purchaseRowsHtml(){
  const admin = isAdmin();
  const products = CACHE.products;
  const q = PU_Q.trim().toLowerCase();
  const purchases = CACHE.purchases.filter(pu=>{
    if(PU_MONTH!=='all' && mOf(pu.date)!==PU_MONTH) return false;
    if(PU_PAY==='Paid' && pu.paymentStatus!=='Paid') return false;
    if(PU_PAY==='Due' && pu.paymentStatus==='Paid') return false;
    if(!q) return true;
    const prod = products.find(p=>p.id===pu.productId);
    return [pu.id, pu.supplier, pu.voucherNo, pu.productName, prod&&prod.name, pu.date].some(v=>String(v||'').toLowerCase().includes(q));
  });
  let rows = purchases.slice().reverse().map(pu => {
    const freeQty = Number(pu.freeQty||0);
    const avgUnitCost = pu.qty>0 ? pu.totalCost/pu.qty : 0;
    const prod = products.find(p=>p.id===pu.productId);
    const unit = esc(prod?.unit || 'কেজি');
    return `
    <tr class="${hlClass('purchases',pu.id)}">
      <td>${pu.id} ${editedBadge(pu)}</td><td>${pu.date}</td><td>${pu.voucherNo?esc(pu.voucherNo):'<span class="muted-cell">—</span>'}</td><td>${esc(pu.supplier)}</td>
      <td>${esc(prod?prod.name:(pu.productName||'—'))}</td>
      <td class="cell-num">${pu.qty} ${unit}${freeQty>0 ? ` <span class="badge" style="background:#DCF3E7;color:#167A54;">${freeQty} ফ্রি</span>` : ''}</td>
      <td class="cell-num">${money(pu.totalCost)}</td>
      <td class="cell-num muted-cell">${money(avgUnitCost)}/${unit}</td>
      <td class="cell-center"><span class="badge ${pu.paymentStatus==='Paid'?'badge-paid':'badge-due'}">${pu.paymentStatus==='Paid'?'পরিশোধিত':'বকেয়া'}</span></td>
      <td class="cell-center">${admin && isDateLocked(pu.date) ? '<span title="এই মাস লক করা">🔒</span>' : admin ? `<button class="icon-btn" title="ভুল সংশোধন করুন" onclick="openPurchaseForm('${pu.id}')">✏️</button><button class="icon-btn danger" title="মুছুন" onclick="deletePurchase('${pu.id}')">🗑️</button>` : '<span class="muted-cell">—</span>'}</td>
    </tr>`;
  }).join('');
  return rows || `<tr><td colspan="10" class="empty-state">${CACHE.purchases.length ? 'কিছু পাওয়া যায়নি' : 'কোনো ক্রয় এন্ট্রি নেই'}</td></tr>`;
}
function onPurchaseSearch(){
  PU_Q = document.getElementById('puSearch').value;
  PU_PAY = document.getElementById('puPay').value;
  PU_MONTH = document.getElementById('puMonth').value;
  document.getElementById('puBody').innerHTML = purchaseRowsHtml();
}
function renderPurchases(){
  const admin = isAdmin();
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('purchases')}
    <div class="panel">
      <div class="panel-head"><h3>ক্রয় খাতা (সোর্সিং)</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="downloadPurchaseTemplate()">📥 ক্রয় আপলোডের ফরম্যাট</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('puExcelInput').click()">📤 এক্সেল থেকে ক্রয় আপলোড</button>
          <input type="file" id="puExcelInput" accept=".xlsx,.xls" class="hidden" onchange="handlePurchaseExcel(event)">
          <button class="btn btn-accent btn-sm" onclick="openPurchaseForm()">+ নতুন ক্রয়</button>
        </div>
      </div>
      <div class="toolbar">
        <select id="puMonth" onchange="onPurchaseSearch()">${monthOptionsHtml(PU_MONTH, true)}</select>
        <input type="search" id="puSearch" placeholder="🔍 পণ্য / সরবরাহকারী / আইডি / তারিখ দিয়ে খুঁজুন" value="${esc(PU_Q)}" oninput="onPurchaseSearch()">
        <select id="puPay" onchange="onPurchaseSearch()">
          <option value="all" ${PU_PAY==='all'?'selected':''}>সব পেমেন্ট</option>
          <option value="Paid" ${PU_PAY==='Paid'?'selected':''}>পরিশোধিত</option>
          <option value="Due" ${PU_PAY==='Due'?'selected':''}>বকেয়া</option>
        </select>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>ভাউচার নং</th><th>সরবরাহকারী</th><th>পণ্য</th><th>পরিমাণ</th><th>মোট খরচ</th><th>গড় খরচ/একক</th><th>পেমেন্ট</th><th>একশন</th>
      </tr></thead><tbody id="puBody">${purchaseRowsHtml()}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">ফ্রি আইটেম এলে মোট পরিমাণের মধ্যেই সেটা ধরে "গড় খরচ/একক" স্বয়ংক্রিয়ভাবে হিসাব হয় — আলাদা কিছু করতে হয় না।${admin ? ' ভুল এন্ট্রি ✏️ বাটনে সংশোধন করুন — স্টক নিজে থেকেই সমন্বয় হবে।' : ' ভুল এন্ট্রি সংশোধন বা মোছা শুধু অ্যাডমিন করতে পারবেন — অ্যাডমিনকে জানান।'}</p>
    </div>
    <div id="modalHolder"></div>
  `;
  scrollToHl();
}
/* ============================================================
   PURCHASE EXCEL IMPORT — ক্রয় ভাউচার এক্সেল থেকে একসাথে আপলোড
   ============================================================ */
let PU_IMPORT = null;
const BN_DIG = '০১২৩৪৫৬৭৮৯';
function bnToEn(v){ return String(v).replace(/[০-৯]/g, d => BN_DIG.indexOf(d)); }
function toNum(v){
  if(v===null || v===undefined || String(v).trim()==='') return null;
  if(typeof v==='number') return v;
  const n = Number(bnToEn(v).replace(/[,\s৳]/g,''));
  return isNaN(n) ? NaN : n;
}
function validYMD(y,m,d){ const dt = new Date(Date.UTC(y,m-1,d)); return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d; }
function parseXlDate(v){
  if(v===null || v===undefined || String(v).trim()==='') return '';
  let y,m,d;
  if(typeof v==='number'){ const dt = new Date(Date.UTC(1899,11,30) + Math.round(v)*864e5); y = dt.getUTCFullYear(); m = dt.getUTCMonth()+1; d = dt.getUTCDate(); }
  else {
    const s = bnToEn(v).trim(); let t;
    if((t = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))){ y=+t[1]; m=+t[2]; d=+t[3]; }
    else if((t = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))){ d=+t[1]; m=+t[2]; y=+t[3]; }
    else return '';
  }
  if(!validYMD(y,m,d)) return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function normHeader(h){ return String(h||'').split('(')[0].replace(/\s+/g,' ').trim(); }
function normName(n){ return String(n||'').replace(/\s+/g,' ').trim().toLowerCase(); }
function planPurchaseImport(rawRows){
  const rows = []; const newNames = {};
  const prodByName = {}, prodById = {};
  CACHE.products.forEach(p => { prodByName[normName(p.name)] = p; prodById[String(p.id).toLowerCase()] = p; });
  const existingKeys = new Set(CACHE.purchases.map(pu => [pu.date, String(pu.voucherNo||'').trim().toLowerCase(), pu.productId, r3(pu.qty), r2(pu.totalCost)].join('|')));
  rawRows.forEach((raw, i) => {
    const r = {}; Object.keys(raw).forEach(k => { r[normHeader(k)] = raw[k]; });
    const blank = Object.keys(r).every(k => String(r[k]??'').trim()==='');
    if(blank) return;
    const o = {n: i+2, err:'', dup:false};
    o.date = parseXlDate(r['তারিখ']);
    o.voucher = String(r['ভাউচার নং']??'').trim();
    o.supplier = String(r['সরবরাহকারী']??'').trim();
    o.name = String(r['পণ্যের নাম']??'').trim();
    const pid = String(r['আইডি']??'').trim().toLowerCase();
    o.qty = toNum(r['পরিমাণ']); o.free = toNum(r['এর মধ্যে ফ্রি পরিমাণ']) || 0; o.cost = toNum(r['মোট খরচ']);
    const pay = String(r['পেমেন্ট']??'').trim();
    o.status = /বকেয়া|due|outstanding/i.test(pay) ? 'Outstanding' : 'Paid';
    const paid = toNum(r['পরিশোধিত টাকা']); o.paidIn = paid;
    o.cat = String(r['ক্যাটাগরি']??'').trim(); o.unit = String(r['একক']??'').trim(); o.retail = toNum(r['বিক্রয়মূল্য']);
    const errs = [];
    if(!o.date) errs.push('তারিখ ভুল/ফাঁকা (YYYY-MM-DD লিখুন)');
    else if(isDateLocked(o.date)) errs.push(monthLabel(mOf(o.date)) + ' মাস লক করা');
    if(!o.supplier) errs.push('সরবরাহকারী ফাঁকা');
    let prod = (pid && prodById[pid]) || prodByName[normName(o.name)] || null;
    if(!prod && !o.name) errs.push('পণ্যের নাম ফাঁকা');
    if(o.qty===null || isNaN(o.qty) || !(o.qty>0)) errs.push('পরিমাণ ভুল');
    if(isNaN(o.free) || o.free<0 || o.free>(o.qty||0)) errs.push('ফ্রি পরিমাণ ভুল');
    if(o.cost===null || isNaN(o.cost) || o.cost<0) errs.push('মোট খরচ ভুল');
    if(o.retail!==null && isNaN(o.retail)) errs.push('বিক্রয়মূল্য ভুল');
    o.err = errs.join(', ');
    if(prod){ o.pid = prod.id; o.name = prod.name; } else if(!o.err){ o.isNew = true; newNames[normName(o.name)] = o.name; }
    if(!o.err && o.pid){
      const key = [o.date, o.voucher.toLowerCase(), o.pid, r3(o.qty), r2(o.cost)].join('|');
      if(existingKeys.has(key)) o.dup = true;
    }
    rows.push(o);
  });
  return {rows, newNames: Object.values(newNames)};
}
function downloadPurchaseTemplate(){
  if(typeof XLSX==='undefined'){ alert('এক্সেল লাইব্রেরি লোড হয়নি — ইন্টারনেট চেক করে পেইজ রিফ্রেশ করুন'); return; }
  const head = ['তারিখ (YYYY-MM-DD)','ভাউচার নং','সরবরাহকারী','পণ্যের নাম','পরিমাণ','এর মধ্যে ফ্রি পরিমাণ','মোট খরচ (৳)','পেমেন্ট (পরিশোধিত/বকেয়া)','পরিশোধিত টাকা (বকেয়া হলে)','ক্যাটাগরি (শুধু নতুন পণ্যের জন্য)','একক (শুধু নতুন পণ্যের জন্য)','বিক্রয়মূল্য (শুধু নতুন পণ্যের জন্য)'];
  const ex = CACHE.products.slice(0,2);
  const rows = [head,
    [todayStr(),'V-1001','নমুনা সরবরাহকারী', ex[0]?ex[0].name:'চিনিগুড়া (পোলাও)', 50, 0, 10500, 'পরিশোধিত', '', '', '', ''],
    [todayStr(),'V-1001','নমুনা সরবরাহকারী', ex[1]?ex[1].name:'মসুর ডাল (দেশি)', 25, 1, 3200, 'বকেয়া', 1000, '', '', '']];
  const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = head.map(() => ({wch:24}));
  const help = [['নির্দেশনা'],
    ['১. প্রতিটি সারি = একটি ভাউচারের একটি পণ্য। একই ভাউচারে ৫টি পণ্য থাকলে ৫টি সারি, ভাউচার নং সবগুলোয় একই।'],
    ['২. "পণ্যের নাম" পণ্য তালিকার নামের সাথে হুবহু মিলতে হবে (পাশের "পণ্যের তালিকা" শিটের নাম কপি করুন)। না মিললে নতুন পণ্য হিসেবে যোগ হবে।'],
    ['৩. "পরিমাণ" পণ্যের একক অনুযায়ী (যেমন কেজি পণ্যে কেজি, ৫০০ গ্রামের প্যাকেট পণ্যে প্যাকেট সংখ্যা)। ফ্রি আইটেমসহ মোট পরিমাণ লিখুন।'],
    ['৪. "মোট খরচ" = ওই সারির পণ্যের জন্য আসলে যত টাকা দিয়েছেন।'],
    ['৫. "পেমেন্ট": পরিশোধিত অথবা বকেয়া। ফাঁকা থাকলে পরিশোধিত ধরা হবে।'],
    ['৬. শেষ তিনটি ঘর (ক্যাটাগরি, একক, বিক্রয়মূল্য) শুধু নতুন পণ্যের জন্য — আগের পণ্যের জন্য ফাঁকা রাখুন।'],
    ['৭. একই ফাইল ভুলে দ্বিতীয়বার আপলোড করলে আগের এন্ট্রিগুলো "ডুপ্লিকেট" ধরে বাদ যাবে — স্টক দ্বিগুণ হবে না।']];
  const wh = XLSX.utils.aoa_to_sheet(help); wh['!cols'] = [{wch:120}];
  const wp = XLSX.utils.aoa_to_sheet([['আইডি','পণ্যের নাম','একক']].concat(CACHE.products.map(p => [p.id, p.name, p.unit||'কেজি']))); wp['!cols'] = [{wch:10},{wch:40},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ক্রয় ভাউচার'); XLSX.utils.book_append_sheet(wb, wh, 'নির্দেশনা'); XLSX.utils.book_append_sheet(wb, wp, 'পণ্যের তালিকা');
  XLSX.writeFile(wb, 'ক্রয়-আপলোড-ফরম্যাট.xlsx');
}
function handlePurchaseExcel(event){
  const file = event.target.files[0]; event.target.value = '';
  if(!file) return;
  if(typeof XLSX==='undefined'){ alert('এক্সেল লাইব্রেরি লোড হয়নি — ইন্টারনেট চেক করে পেইজ রিফ্রেশ করুন'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, {defval:''});
      if(!raw.length){ alert('ফাইলে কোনো সারি পাওয়া যায়নি'); return; }
      showPurchaseImportPreview(planPurchaseImport(raw));
    }catch(err){ alert('ফাইলটি পড়া যায়নি: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}
function showPurchaseImportPreview(plan){
  PU_IMPORT = plan;
  const ok = plan.rows.filter(r => !r.err && !r.dup), bad = plan.rows.filter(r => r.err), dup = plan.rows.filter(r => r.dup);
  const total = r2(ok.reduce((t,r) => t + r.cost, 0));
  openForm(`
    <div class="panel">
      <h3>📤 ক্রয় আপলোড — যাচাই</h3>
      <div class="flash ${bad.length?'warn':''}" style="margin-bottom:12px;">
        মোট সারি: <b>${plan.rows.length}</b> · আপলোড হবে: <b>${ok.length}</b> (মোট ${money(total)}) · ত্রুটি: <b>${bad.length}</b> · ডুপ্লিকেট (আগেই আছে, বাদ): <b>${dup.length}</b>
      </div>
      ${plan.newNames.length ? `<div class="flash warn" style="margin-bottom:12px;">🆕 <b>${plan.newNames.length}টি নতুন পণ্য</b> তৈরি হবে — বানান ঠিক আছে তো? (ভুল বানানে নতুন পণ্য হয়ে যায়)<br>${plan.newNames.slice(0,30).map(esc).join('، ')}${plan.newNames.length>30?' ...':''}</div>` : ''}
      ${bad.length ? `<div class="table-wrap"><table><thead><tr><th>সারি</th><th>পণ্য</th><th>সমস্যা</th></tr></thead><tbody>${bad.slice(0,50).map(r => `<tr><td>${r.n}</td><td>${esc(r.name)}</td><td style="color:#B3261E;">${esc(r.err)}</td></tr>`).join('')}</tbody></table></div>${bad.length>50?`<p class="muted-cell">আরও ${bad.length-50}টি ত্রুটি আছে</p>`:''}<p style="font-size:12.5px;color:var(--text-muted);">ত্রুটির সারিগুলো আপলোড হবে না। ফাইল ঠিক করে আবার আপলোড করতে পারেন — যেগুলো এখন আপলোড হবে সেগুলো তখন ডুপ্লিকেট ধরে বাদ যাবে।</p>` : ''}
      <p style="font-size:12.5px;color:var(--text-muted);margin:12px 0;">আপলোডের পর প্রতিটি পণ্যের ক্রয়মূল্য নিজে থেকে সব ক্রয় ভাউচারের গড় অনুযায়ী ঠিক হয়ে যাবে।</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" ${ok.length?'':'disabled'} onclick="confirmPurchaseImport()">✅ ${ok.length}টি ক্রয় এন্ট্রি আপলোড করুন (স্টকে যোগ হবে)</button>
        <button class="btn btn-outline" onclick="PU_IMPORT=null;closeForm(renderPurchases)">বাতিল</button>
      </div>
    </div>`);
}
function confirmPurchaseImport(){
  const plan = PU_IMPORT; if(!plan) return;
  const ok = plan.rows.filter(r => !r.err && !r.dup);
  if(!ok.length){ alert('আপলোডের মতো কোনো সঠিক সারি নেই'); return; }
  if(!guardDates(ok.map(r => r.date), 'আপলোড')) return;
  const products = CACHE.products.map(p => ({...p}));
  const purchases = CACHE.purchases.slice();
  const agg = {}, createdIds = [], newPurchaseIds = [];
  const byName = {}; products.forEach((p,i) => { byName[normName(p.name)] = i; });
  const cats = CACHE.settings.productCategories.slice(); let catsChanged = false;
  ok.forEach(r => {
    let pi = r.pid ? products.findIndex(p => p.id===r.pid) : (byName[normName(r.name)] ?? -1);
    let isNew = false;
    if(pi < 0){
      const np = {id: genId('P', products), name: r.name, category: r.cat || 'অন্যান্য', unit: r.unit || 'কেজি', cost: 0, retail: (r.retail>0 ? r.retail : 0), stock: 0, minStock: 5, hidden: false, createdAt: todayStr()};
      products.push(np); pi = products.length-1; byName[normName(r.name)] = pi; createdIds.push(np.id); isNew = true;
      if(np.category && !cats.includes(np.category)){ cats.push(np.category); catsChanged = true; }
    }
    const p = products[pi];
    products[pi] = {...p, hidden:false, stock: r3(Number(p.stock||0) + r.qty)};
    const a = agg[p.id] || (agg[p.id] = {q:0, c:0, isNew: createdIds.includes(p.id)}); a.q += r.qty; a.c += r.cost;
    const paid = r.status==='Paid' ? Math.max(r.paidIn||0, r.cost) : Math.min(r.paidIn||0, r.cost);
    const id = genId('PO-', purchases); newPurchaseIds.push(id);
    purchases.push({id, date: r.date, supplier: r.supplier, voucherNo: r.voucher, productId: p.id, productName: p.name, qty: r.qty, freeQty: r.free||0, totalCost: r.cost, paymentStatus: r.status, paidAmount: paid});
  });
  applyAvgCosts(products, purchases, Object.keys(agg));   // সব ক্রয়ের গড় অনুযায়ী ক্রয়মূল্য
  const okP = saveCollection('products', products);
  const okQ = okP && saveCollection('purchases', purchases);
  if(!okQ){ return; }
  if(catsChanged) saveSettings({...CACHE.settings, productCategories: cats});
  PU_IMPORT = null; PU_Q = ''; PU_PAY = 'all'; PU_MONTH = 'all';
  setFlash('purchases', `✅ এক্সেল থেকে ${ok.length}টি ক্রয় এন্ট্রি আপলোড হয়েছে${createdIds.length?` এবং ${createdIds.length}টি নতুন পণ্য তৈরি হয়েছে`:''} — স্টক যোগ হয়েছে ও ক্রয়মূল্য ভাউচার গড় অনুযায়ী ঠিক হয়েছে (হলুদ দাগের সারিগুলো)।${createdIds.length?'<br>⚠️ নতুন পণ্যের বিক্রয়মূল্য ০ থাকলে পণ্য তালিকা থেকে দাম বসিয়ে দিন।':''}`, newPurchaseIds);
  renderPurchases(); toTop();
}

function openPurchaseForm(id){
  if(id && !isAdmin()){ alert('ক্রয় এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const pu = id ? CACHE.purchases.find(x=>x.id===id) : null;
  if(pu && !guardDate(pu.date, 'সংশোধন')) return;
  const products = CACHE.products;
  const hasProd = !!(pu && products.some(p=>p.id===pu.productId));
  PU_EDIT_ID = id || '';
  const cats = CACHE.settings.productCategories;
  openForm(`
    <div class="panel">
      <h3>${pu ? `ক্রয় এন্ট্রি সংশোধন — ${pu.id}` : 'নতুন ক্রয় এন্ট্রি'}</h3>
      ${pu ? `<p style="font-size:12.5px;color:var(--text-muted);margin-top:-2px;">সংশোধন করলে স্টক নিজে থেকেই ঠিক হয়ে যাবে — পুরোনো পরিমাণ স্টক থেকে বাদ গিয়ে নতুন পরিমাণ যোগ হবে।</p>` : ''}
      <div class="form-grid">
        ${dateField('pu_date', pu?pu.date:'')}
        <div class="form-field"><label>সরবরাহকারী/মিল/চাতাল নাম</label><input id="pu_supplier" value="${pu?esc(pu.supplier):''}"></div>
        <div class="form-field"><label>ভাউচার নম্বর (ঐচ্ছিক)</label><input id="pu_voucher" placeholder="যেমন: V-1024" value="${pu?esc(pu.voucherNo||''):''}"></div>
        <div class="form-field"><label>পণ্য — তালিকা থেকে বাছাই করুন</label>
          <select id="pu_product" onchange="onPurchaseProductPick()">
            <option value="">— তালিকা থেকে বাছাই করুন —</option>
            ${products.map(p=>`<option value="${p.id}" ${hasProd&&pu.productId===p.id?'selected':''}>${esc(p.name)} (একক: ${esc(p.unit||'কেজি')})${p.hidden?' — লুকানো':''}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>অথবা পণ্যের নাম লিখুন</label>
          <input id="pu_pname" autocomplete="off" placeholder="নাম লিখুন (তালিকার পণ্য হলে সেটিই ধরা হবে)" value="${(pu && !hasProd) ? esc(pu.productName||'') : ''}" oninput="onPurchaseNameType()">
          <span id="pu_matchhint" class="muted-cell" style="font-size:12px;"></span>
        </div>
      </div>

      <div id="pu_newprod" class="panel hidden" style="background:var(--bg);margin:14px 0;">
        <h3 style="font-size:15px;">🆕 নতুন পণ্যের তথ্য</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">এই নামে তালিকায় কোনো পণ্য নেই, তাই সংরক্ষণ করলে এটি নতুন পণ্য হিসেবে পণ্য তালিকায় যোগ হবে। নিচের ঘরগুলো পূরণ করুন।</p>
        <div class="form-grid">
          <div class="form-field"><label>ক্যাটাগরি</label>
            <select id="pu_newcat">${cats.map(c=>`<option ${c==='অন্যান্য'?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="form-field"><label>একক (এই এককেই নিচের পরিমাণ লিখবেন)</label>
            <select id="pu_newunit" onchange="refreshPurchaseUnit()">${UNIT_OPTIONS.map(u=>`<option ${u==='কেজি'?'selected':''}>${u}</option>`).join('')}</select></div>
          <div class="form-field"><label>বিক্রয়মূল্য (৳) — প্রতি এককে (পরে বদলানো যাবে)</label><input id="pu_newretail" type="number" value="0"></div>
        </div>
      </div>

      <div class="panel" style="background:var(--bg);margin:14px 0;">
        <h3 style="font-size:15px;">বস্তা/প্যাকেট থেকে মোট পরিমাণ হিসাব করুন (ঐচ্ছিক)</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">১০ বস্তা কিনলেন, প্রতি বস্তায় ৫০ কেজি করে হলে — নিচের দুটো ঘর পূরণ করুন, "মোট পরিমাণ" নিজে থেকেই হিসাব হয়ে যাবে।</p>
        <div class="form-grid">
          <div class="form-field"><label>কয়টি বস্তা/প্যাকেট</label><input id="pu_bags" type="number" placeholder="যেমন ১০" oninput="calcPurchaseQty()"></div>
          <div class="form-field"><label>প্রতি বস্তায়/প্যাকেটে কত (একক)</label><input id="pu_perbag" type="number" placeholder="যেমন ৫০" oninput="calcPurchaseQty()"></div>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-field"><label>মোট পরিমাণ (ফ্রি আইটেমসহ)</label>
          <div style="display:flex;gap:6px;"><input id="pu_qty" type="number" step="any" value="${pu?pu.qty:1}" style="flex:1;"><select id="pu_qunit" style="width:90px;"></select></div></div>
        <div class="form-field"><label>এর মধ্যে ফ্রি পরিমাণ (ঐচ্ছিক)</label><input id="pu_freeqty" type="number" step="any" value="${pu?(pu.freeQty||0):0}"></div>
        <div class="form-field"><label>মোট খরচ — যত টাকা আসলে দিয়েছেন (৳)</label><input id="pu_cost" type="number" value="${pu?pu.totalCost:0}"></div>
        <div class="form-field"><label>পেমেন্ট স্ট্যাটাস</label>
          <select id="pu_pay" onchange="onPurchasePayChange()"><option value="Paid" ${!pu||pu.paymentStatus==='Paid'?'selected':''}>পরিশোধিত</option><option value="Outstanding" ${pu&&pu.paymentStatus!=='Paid'?'selected':''}>বকেয়া</option></select>
        </div>
        <div class="form-field"><label>পরিশোধের পরিমাণ (৳)</label><input id="pu_paid" type="number" value="${pu?(pu.paidAmount!=null?pu.paidAmount:(pu.paymentStatus==='Paid'?pu.totalCost:0)):0}"></div>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">ফ্রি পেলে মোট পরিমাণে ফ্রিসহ লিখুন, আর "মোট খরচে" শুধু যত টাকা দিয়েছেন তা লিখুন।${pu ? ' (সংশোধনের সময় পরিমাণ পণ্যের মূল এককে দেখানো হচ্ছে।)' : ''}</p>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="savePurchase()">${pu ? 'সংশোধন সংরক্ষণ করুন (স্টক সমন্বয় হবে)' : 'সংরক্ষণ করুন (স্টকে যোগ হবে)'}</button>
        <button class="btn btn-outline" onclick="closeForm(renderPurchases)">বাতিল</button>
      </div>
    </div>`);
  refreshPurchaseUnit();
  purchaseSuggestInit();
}
// ফর্মে এখন কোন পণ্য বোঝানো হয়েছে: তালিকা থেকে বাছাই, নাকি লেখা নাম (বিদ্যমান/নতুন)
function purchaseTargetProduct(){
  const typed = ((document.getElementById('pu_pname')||{}).value||'').trim();
  if(typed){
    const m = CACHE.products.find(p=>String(p.name).trim().toLowerCase()===typed.toLowerCase());
    return m ? {prod:m, isNew:false, name:typed} : {prod:null, isNew:true, name:typed};
  }
  const pid = (document.getElementById('pu_product')||{}).value;
  return {prod: CACHE.products.find(x=>x.id===pid) || null, isNew:false, name:''};
}
function onPurchaseProductPick(){ document.getElementById('pu_pname').value=''; refreshPurchaseUnit(); }
function onPurchaseNameType(){ if(document.getElementById('pu_pname').value.trim()) document.getElementById('pu_product').value=''; refreshPurchaseUnit(); }
function refreshPurchaseUnit(){
  const sel = document.getElementById('pu_qunit');
  if(!sel) return;
  const t = purchaseTargetProduct();
  const keep = sel.value;
  const hint = document.getElementById('pu_matchhint');
  const np = document.getElementById('pu_newprod');
  if(t.isNew){
    np.classList.remove('hidden');
    sel.innerHTML = `<option value="base">${esc(document.getElementById('pu_newunit').value)}</option>`;
    hint.textContent = '🆕 এই নামে কোনো পণ্য নেই — সংরক্ষণ করলে নতুন পণ্য হিসেবে যোগ হবে।';
  } else {
    np.classList.add('hidden');
    sel.innerHTML = unitOptions(t.prod).map(o=>`<option value="${o.key}">${esc(o.label)}</option>`).join('');
    if(Array.from(sel.options).some(o=>o.value===keep)) sel.value = keep;
    hint.textContent = (t.name && t.prod) ? `✔ তালিকার পণ্য "${t.prod.name}" পাওয়া গেছে — এতেই স্টক যোগ হবে।` : '';
  }
}
function calcPurchaseQty(){
  const bags = Number(document.getElementById('pu_bags').value||0);
  const perBag = Number(document.getElementById('pu_perbag').value||0);
  if(bags>0 && perBag>0){ document.getElementById('pu_qty').value = bags*perBag; }
}
function onPurchasePayChange(){
  const status = document.getElementById('pu_pay').value;
  const paidField = document.getElementById('pu_paid');
  if(status==='Paid') paidField.value = document.getElementById('pu_cost').value || 0;
  else paidField.value = 0;
}
function savePurchase(){
  const id = PU_EDIT_ID;
  if(id && !isAdmin()){ alert('ক্রয় এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const purchases = CACHE.purchases.slice();
  const products = CACHE.products.map(p=>({...p}));
  const supplier = document.getElementById('pu_supplier').value.trim();
  const t = purchaseTargetProduct();
  if(!t.prod && !t.isNew){ alert('তালিকা থেকে পণ্য বাছাই করুন অথবা পণ্যের নাম লিখুন'); return; }
  if(!supplier){ alert('সরবরাহকারীর নাম দিন'); return; }
  const div = t.isNew ? 1 : optByKey(t.prod, document.getElementById('pu_qunit').value).factor;
  const qty = r3(Number(document.getElementById('pu_qty').value||0)/div);
  const freeQty = r3(Number(document.getElementById('pu_freeqty').value||0)/div);
  if(qty<=0){ alert('পরিমাণ সঠিকভাবে দিন'); return; }
  if(freeQty>qty){ alert('ফ্রি পরিমাণ মোট পরিমাণের চেয়ে বেশি হতে পারে না'); return; }
  if(!guardDates([pickedDate('pu_date'), id ? (purchases.find(x=>x.id===id)||{}).date : ''], id ? 'সংশোধন' : 'এন্ট্রি')) return;
  const totalCost = Number(document.getElementById('pu_cost').value||0);
  const status = document.getElementById('pu_pay').value;
  let paid = Number(document.getElementById('pu_paid').value||0);
  if(status==='Paid') paid = Math.max(paid, totalCost);

  // সংশোধন হলে আগের এন্ট্রির পরিমাণ আগে স্টক থেকে বাদ
  let old = null;
  if(id){
    old = purchases.find(x=>x.id===id);
    const oi = products.findIndex(p=>p.id===old.productId);
    if(oi>-1) products[oi] = {...products[oi], stock: r3(Number(products[oi].stock) - Number(old.qty||0))};
  }
  // নতুন নাম হলে পণ্য তৈরি
  let created = null, prod = t.prod;
  if(t.isNew){
    created = {
      id: genId('P', products), name: t.name,
      category: document.getElementById('pu_newcat').value,
      unit: document.getElementById('pu_newunit').value,
      cost: Math.round(totalCost/qty*100)/100,
      retail: Number(document.getElementById('pu_newretail').value||0),
      stock: 0, minStock: 5, hidden: false
    };
    products.push(created); prod = created;
  }
  const pi = products.findIndex(p=>p.id===prod.id);
  products[pi] = {...products[pi], hidden:false, stock: r3(Number(products[pi].stock) + qty)};
  const data = {
    date: pickedDate('pu_date'), supplier, voucherNo: (document.getElementById('pu_voucher')||{value:''}).value.trim(), productId: prod.id, productName: products[pi].name, qty, freeQty,
    totalCost, paymentStatus: status, paidAmount: paid
  };
  let savedId = id;
  if(id){
    const idx = purchases.findIndex(x=>x.id===id);
    purchases[idx] = stampEdit({...purchases[idx], ...data});
  } else {
    data.id = genId('PO-', purchases); savedId = data.id;
    purchases.push(data);
  }
  applyAvgCosts(products, purchases, [prod.id, old && old.productId]);   // ক্রয়মূল্য = ভাউচার গড়
  saveCollection('products', products);
  saveCollection('purchases', purchases);
  PU_Q = ''; PU_PAY = 'all'; if(PU_MONTH!=='all') PU_MONTH = mOf(data.date) || PU_MONTH;
  if(created){
    setFlash('purchases', `✅ ক্রয় সংরক্ষিত। <b>${esc(created.name)}</b> নতুন পণ্য হিসেবে পণ্য তালিকায় যোগ হয়েছে (আইডি ${created.id}), স্টক ${fmtStock(products[pi].stock, products[pi])}। ক্রয়মূল্য প্রতি এককে ${money(created.cost)} ধরা হয়েছে।${created.retail>0 ? '' : '<br>⚠️ বিক্রয়মূল্য এখনো ৳0 — <a href="#" onclick="go(\'products\');return false;">পণ্য তালিকা</a> থেকে দাম বসিয়ে দিন।'}`, savedId, !(created.retail>0));
  } else if(id){
    setFlash('purchases', `✅ ক্রয় এন্ট্রি ${id} সংশোধিত হয়েছে — ${esc(products[pi].name)}-এর স্টক এখন ${fmtStock(products[pi].stock, products[pi])}।`, savedId);
  } else {
    setFlash('purchases', `✅ ক্রয় সংরক্ষিত — ${esc(products[pi].name)}-এর স্টক এখন ${fmtStock(products[pi].stock, products[pi])}।`, savedId);
  }
  renderPurchases();
  toTop();
}
function deletePurchase(id){
  if(!isAdmin()){ alert('ক্রয় এন্ট্রি মোছা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const pu = CACHE.purchases.find(x=>x.id===id); if(!pu) return;
  if(!guardDate(pu.date, 'মুছে ফেলা')) return;
  if(!confirm(`এই ক্রয় এন্ট্রিটি (${id}) মুছে ফেলতে চান?\n\nএই এন্ট্রির ${pu.qty} পরিমাণ স্টক থেকে বাদ যাবে।`)) return;
  const products = CACHE.products.map(p=>({...p}));
  adjustStock(products, [{productId: pu.productId, qty: pu.qty}], -1);
  const restPurchases = CACHE.purchases.filter(p=>p.id!==id);
  applyAvgCosts(products, restPurchases, [pu.productId]);
  saveCollection('products', products);
  saveCollection('purchases', restPurchases);
  renderPurchases();
}

/* ============================================================
   EXPENSES  (ভাউচার নম্বরসহ — আয় ও খরচ দুই ক্ষেত্রেই)
   ============================================================ */
const INCOME_CATEGORIES = ['কোম্পানি কমিশন','রিবেট/ক্যাশব্যাক','অন্যান্য আয়'];
let EXP_EDIT_ID = '', EXP_KIND = '', EXP_Q = '', EXP_MONTH = curMonth();
function expenseRowsHtml(){
  const admin = isAdmin();
  const q = EXP_Q.trim().toLowerCase();
  const list = CACHE.expenses.slice().reverse().filter(e=>{
    if(EXP_MONTH!=='all' && mOf(e.date)!==EXP_MONTH) return false;
    if(!q) return true;
    return [e.id, e.voucherNo, e.category, e.approvedBy, e.date].some(v=>String(v||'').toLowerCase().includes(q));
  });
  return list.map(e => {
    const inc = e.kind==='income';
    return `
    <tr class="${hlClass('expenses',e.id)}">
      <td>${e.id} ${editedBadge(e)}</td><td>${e.date}</td>
      <td>${inc?'<span class="badge badge-paid">আয়</span> ':''}${esc(e.category)}</td>
      <td>${e.voucherNo ? esc(e.voucherNo) : '<span class="muted-cell">—</span>'}</td>
      <td class="cell-num" style="${inc?'color:#167A54;':''}">${inc?'+ ':''}${money(e.amount)}</td><td>${esc(e.method)}</td><td>${esc(e.approvedBy)}</td>
      <td class="cell-center">${admin && isDateLocked(e.date) ? '<span title="এই মাস লক করা">🔒</span>' : admin ? `<button class="icon-btn" title="সংশোধন" onclick="openExpenseForm('','${e.id}')">✏️</button><button class="icon-btn danger" title="মুছুন" onclick="deleteExpense('${e.id}')">🗑️</button>` : '<span class="muted-cell">—</span>'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="empty-state">${CACHE.expenses.length ? 'কিছু পাওয়া যায়নি' : 'কোনো এন্ট্রি যোগ করা হয়নি'}</td></tr>`;
}
function expenseTotalsHtml(){
  const list = CACHE.expenses.filter(e => EXP_MONTH==='all' || mOf(e.date)===EXP_MONTH);
  const exp = list.filter(e=>e.kind!=='income').reduce((t,e)=>t+Number(e.amount||0),0);
  const inc = list.filter(e=>e.kind==='income').reduce((t,e)=>t+Number(e.amount||0),0);
  return `মোট খরচ: <b>${money(exp)}</b> · মোট আয় (কমিশন ইত্যাদি): <b>${money(inc)}</b>`;
}
function onExpenseSearch(){
  EXP_Q = document.getElementById('expSearch').value;
  EXP_MONTH = document.getElementById('expMonth').value;
  document.getElementById('expBody').innerHTML = expenseRowsHtml();
  document.getElementById('expTotals').innerHTML = expenseTotalsHtml();
}
function renderExpenses(){
  const admin = isAdmin();
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('expenses')}
    <div class="panel">
      <div class="panel-head"><h3>খরচ ও আয় খাতা</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="openExpenseForm('income')">+ কমিশন / অন্যান্য আয়</button>
          <button class="btn btn-accent btn-sm" onclick="openExpenseForm()">+ নতুন খরচ</button>
        </div>
      </div>
      <div class="toolbar">
        <select id="expMonth" onchange="onExpenseSearch()">${monthOptionsHtml(EXP_MONTH, true)}</select>
        <input type="search" id="expSearch" placeholder="🔍 ভাউচার নম্বর / ক্যাটাগরি / আইডি দিয়ে খুঁজুন" value="${esc(EXP_Q)}" oninput="onExpenseSearch()">
      </div>
      <p id="expTotals" style="font-size:13px;margin:0 0 10px;">${expenseTotalsHtml()}</p>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>ক্যাটাগরি</th><th>ভাউচার নং</th><th>পরিমাণ</th><th>মাধ্যম</th><th>অনুমোদনকারী / উৎস</th><th>একশন</th>
      </tr></thead><tbody id="expBody">${expenseRowsHtml()}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">কোম্পানির কাছ থেকে পাওয়া কমিশন "আয়" হিসেবে যোগ হয় এবং লাভ-ক্ষতির হিসাবে নিট লাভে যোগ হয়ে যায়। কমিশন যে ভাউচারে উল্লেখ আছে তার নম্বর "ভাউচার নং" ঘরে লিখে রাখুন।${admin ? '' : ' ভুল এন্ট্রি সংশোধন বা মোছা শুধু অ্যাডমিন করতে পারবেন।'}</p>
    </div>
    <div id="modalHolder"></div>
  `;
  scrollToHl();
}
function openExpenseForm(kind, id){
  if(id && !isAdmin()){ alert('এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const e = id ? CACHE.expenses.find(x=>x.id===id) : null;
  if(e && !guardDate(e.date, 'সংশোধন')) return;
  const inc = e ? e.kind==='income' : kind==='income';
  EXP_EDIT_ID = id || ''; EXP_KIND = inc ? 'income' : '';
  let cats = inc ? INCOME_CATEGORIES : CACHE.settings.expenseCategories;
  if(e && e.category && !cats.includes(e.category)) cats = [...cats, e.category];
  const methods = ['Cash','bKash','Bank'];
  if(e && e.method && !methods.includes(e.method)) methods.push(e.method);
  openForm(`
    <div class="panel">
      <h3>${e ? (inc?'আয় এন্ট্রি সংশোধন':'খরচ এন্ট্রি সংশোধন')+' — '+e.id : (inc?'কমিশন / আয় এন্ট্রি':'নতুন খরচ এন্ট্রি')}</h3>
      <div class="form-grid">
        ${dateField('e_date', e?e.date:'')}
        <div class="form-field"><label>ক্যাটাগরি</label>
          <select id="e_cat">${cats.map(c=>`<option ${e&&e.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>${inc?'ভাউচার নম্বর — যে ভাউচারে এই কমিশন/আয় উল্লেখ আছে':'ভাউচার নম্বর (ঐচ্ছিক)'}</label>
          <input id="e_voucher" placeholder="যেমন: V-1024" value="${e?esc(e.voucherNo||''):''}"></div>
        <div class="form-field"><label>পরিমাণ (৳)</label><input id="e_amount" type="number" value="${e?e.amount:0}"></div>
        <div class="form-field"><label>${inc?'টাকা পাওয়ার মাধ্যম':'পেমেন্ট মাধ্যম'}</label>
          <select id="e_method">${methods.map(m=>`<option ${e&&e.method===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>${inc?'কোম্পানির নাম / বিবরণ':'অনুমোদনকারী'}</label><input id="e_approved" value="${e?esc(e.approvedBy||''):''}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveExpense()">${e?'সংশোধন সংরক্ষণ করুন':'সংরক্ষণ করুন'}</button>
        <button class="btn btn-outline" onclick="closeForm(renderExpenses)">বাতিল</button>
      </div>
    </div>`);
}
function saveExpense(){
  const id = EXP_EDIT_ID;
  if(id && !isAdmin()){ alert('এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const inc = EXP_KIND==='income';
  const amount = Number(document.getElementById('e_amount').value||0);
  const voucherNo = document.getElementById('e_voucher').value.trim();
  if(!(amount>0)){ alert('পরিমাণ সঠিকভাবে দিন'); return; }
  if(inc && !voucherNo && !confirm('ভাউচার নম্বর দেওয়া হয়নি। তবুও সংরক্ষণ করবেন?')) return;
  if(!guardDates([pickedDate('e_date'), id ? (CACHE.expenses.find(x=>x.id===id)||{}).date : ''], id ? 'সংশোধন' : 'এন্ট্রি')) return;
  const expenses = CACHE.expenses.slice();
  const data = {
    date: pickedDate('e_date'),
    category: document.getElementById('e_cat').value,
    voucherNo,
    amount,
    method: document.getElementById('e_method').value,
    approvedBy: document.getElementById('e_approved').value.trim()
  };
  let savedId = id;
  if(id){
    const idx = expenses.findIndex(x=>x.id===id);
    expenses[idx] = stampEdit({...expenses[idx], ...data});
  } else {
    data.id = genId('EXP-', expenses); savedId = data.id;
    if(inc) data.kind = 'income';
    expenses.push(data);
  }
  saveCollection('expenses', expenses);
  EXP_Q = ''; if(EXP_MONTH!=='all') EXP_MONTH = mOf(data.date) || EXP_MONTH;
  setFlash('expenses', `✅ ${inc?'আয়':'খরচ'} এন্ট্রি ${id?'সংশোধিত হয়েছে':'সংরক্ষিত হয়েছে'}${voucherNo?` — ভাউচার নং ${esc(voucherNo)}`:''}।`, savedId);
  renderExpenses();
  toTop();
}
function deleteExpense(id){
  if(!isAdmin()){ alert('এন্ট্রি মোছা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const exr = CACHE.expenses.find(x=>x.id===id);
  if(exr && !guardDate(exr.date, 'মুছে ফেলা')) return;
  if(!confirm('এই এন্ট্রিটি মুছে ফেলতে চান?')) return;
  saveCollection('expenses', CACHE.expenses.filter(e=>e.id!==id));
  renderExpenses();
}

/* ============================================================
   DUES — who owes us, and who we owe (admin + manager)
   ============================================================ */
function renderDues(){
  const orders = CACHE.orders.filter(o=>o.status!=='Cancelled');
  const purchases = CACHE.purchases;

  // group unpaid/partial orders by customer (phone if given, else name)
  const custMap = {};
  orders.forEach(o=>{
    const due = orderDue(o);
    if(due<=0) return;
    const key = (o.phone && o.phone.trim()) || o.customerName;
    if(!custMap[key]) custMap[key] = {name:o.customerName, phone:o.phone, due:0, orders:[]};
    custMap[key].due += due;
    custMap[key].orders.push(o.id);
  });
  const custRows = Object.values(custMap).sort((a,b)=>b.due-a.due);
  const totalCustDue = custRows.reduce((s,c)=>s+c.due,0);

  // group outstanding purchases by supplier
  const supMap = {};
  purchases.forEach(pu=>{
    const due = purchaseDue(pu);
    if(due<=0) return;
    if(!supMap[pu.supplier]) supMap[pu.supplier] = {name:pu.supplier, due:0, purchases:[]};
    supMap[pu.supplier].due += due;
    supMap[pu.supplier].purchases.push(pu.id);
  });
  const supRows = Object.values(supMap).sort((a,b)=>b.due-a.due);
  const totalSupDue = supRows.reduce((s,c)=>s+c.due,0);

  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2">
      <div class="stat-card danger"><div class="label">মোট কাস্টমার বকেয়া (আমরা পাব)</div><div class="value">${money(totalCustDue)}</div></div>
      <div class="stat-card warn"><div class="label">মোট সরবরাহকারী বকেয়া (আমরা দেব)</div><div class="value">${money(totalSupDue)}</div></div>
    </div>

    <div class="panel">
      <h3>কাস্টমার বকেয়া — কে কত টাকা দেবে</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>কাস্টমার</th><th>মোবাইল</th><th>বকেয়া অর্ডার</th><th>মোট বকেয়া</th>
      </tr></thead><tbody>
        ${custRows.map(c=>`
          <tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.orders.join(', ')}</td><td class="cell-num">${money(c.due)}</td></tr>
        `).join('') || `<tr><td colspan="4" class="empty-state">কোনো কাস্টমারের বকেয়া নেই 🎉</td></tr>`}
      </tbody></table></div>
    </div>

    <div class="panel">
      <h3>সরবরাহকারী বকেয়া — কাকে কত টাকা দিতে হবে</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>সরবরাহকারী</th><th>বকেয়া ক্রয় এন্ট্রি</th><th>মোট বকেয়া</th>
      </tr></thead><tbody>
        ${supRows.map(s=>`
          <tr><td>${esc(s.name)}</td><td>${s.purchases.join(', ')}</td><td class="cell-num">${money(s.due)}</td></tr>
        `).join('') || `<tr><td colspan="3" class="empty-state">কোনো সরবরাহকারীর বকেয়া নেই 🎉</td></tr>`}
      </tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">হিসাব অর্ডার/ক্রয় এন্ট্রির "পরিশোধের পরিমাণ" ফিল্ড থেকে বের করা হয় — কোনো অর্ডার/ক্রয় এডিট করে পেমেন্ট আপডেট করলে এই তালিকাও নিজে থেকেই হালনাগাদ হয়ে যাবে।</p>
    </div>
  `;
}

/* ============================================================
   RETURNS & ADJUSTMENTS — customer returns a product after the
   invoice was made. Every entry is logged (never a silent edit)
   so there's always an audit trail of what changed and why.
   ============================================================ */
function renderReturns(){
  const orders = CACHE.orders.filter(o=>o.status!=='Cancelled');
  const options = orders.slice().reverse().map(o=>`<option value="${o.id}">${o.id} — ${esc(o.customerName)} (${o.date})</option>`).join('');

  const historyRows = CACHE.returns.slice().reverse().map(r=>{
    const p = CACHE.products.find(x=>x.id===r.productId);
    return `<tr>
      <td>${r.date}</td><td>${r.orderId}</td><td>${esc(r.customerName)}</td><td>${esc(p?p.name:'—')}</td>
      <td class="cell-num">${(r.dq!=null&&r.du) ? r.dq+' '+r.du : fmtQty(r.qty, CACHE.products.find(x=>x.id===r.productId))}</td><td class="cell-num">${money(r.refundAmount)}</td><td>${esc(r.reason||'—')}</td>
    </tr>`;
  }).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <h3>নতুন রিটার্ন / সমন্বয় এন্ট্রি</h3>
      <p style="font-size:13px;color:var(--text-muted);">কাস্টমার কোনো পণ্য ফেরত দিতে চাইলে এখান থেকে এন্ট্রি করুন — অর্ডারের মোট বিল ও স্টক নিজে থেকেই হালনাগাদ হয়ে যাবে, এবং প্রতিটা এন্ট্রি নিচের হিস্ট্রিতে স্থায়ীভাবে জমা থাকবে (কেউ ডিলিট করতে পারবে না) — এতে কে কখন কী পরিমাণ ফেরত নিয়েছে তার পূর্ণ প্রমাণ থাকে।</p>
      <div class="form-field" style="max-width:420px;">
        <label>অর্ডার নির্বাচন করুন</label>
        <select id="ret_order" onchange="loadReturnOrder()">
          <option value="">— অর্ডার বাছাই করুন —</option>${options}
        </select>
      </div>
      <div id="returnFormHolder" style="margin-top:14px;"></div>
    </div>
    <div class="panel">
      <h3>রিটার্ন হিস্ট্রি</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>তারিখ</th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>পরিমাণ</th><th>ফেরত টাকা</th><th>কারণ</th>
      </tr></thead><tbody>${historyRows || `<tr><td colspan="7" class="empty-state">কোনো রিটার্ন এন্ট্রি নেই</td></tr>`}</tbody></table></div>
    </div>
  `;
}

function loadReturnOrder(){
  const id = document.getElementById('ret_order').value;
  const holder = document.getElementById('returnFormHolder');
  if(!id){ holder.innerHTML=''; return; }
  const o = CACHE.orders.find(x=>x.id===id);
  const items = orderItems(o);
  if(!items.length){ holder.innerHTML = `<div class="empty-state">এই অর্ডারে কোনো পণ্য নেই</div>`; return; }
  const rows = items.map((it,idx)=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    return `<tr>
      <td>${esc(p?p.name:'—')}</td>
      <td class="cell-center">${fmtItem(it,p)}</td>
      <td class="cell-num">${money(it.unitPrice)}</td>
      <td class="cell-center"><input type="number" min="0" step="any" value="0" id="ret_qty_${idx}" style="width:80px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;">
        ${unitSelectHtml(p, (unitOptions(p).find(o=>o.label===it.du)||{key:'base'}).key, `id="ret_unit_${idx}"`)}</td>
    </tr>`;
  }).join('');
  holder.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>পণ্য</th><th>অর্ডারকৃত পরিমাণ</th><th>একক মূল্য</th><th>কত ফেরত নেবেন</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="margin-top:12px;max-width:240px;">${dateField('ret_date')}</div>
    <div class="form-field" style="margin-top:12px;">
      <label>কারণ (ঐচ্ছিক)</label>
      <textarea id="ret_reason" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);"></textarea>
    </div>
    <button class="btn btn-primary" style="margin-top:12px;" onclick="submitReturn('${o.id}')">রিটার্ন সম্পন্ন করুন</button>
  `;
}

function submitReturn(orderId){
  const orders = CACHE.orders.slice();
  const products = CACHE.products.slice();
  const returns = CACHE.returns.slice();
  const idx = orders.findIndex(o=>o.id===orderId);
  const order = {...orders[idx]};
  const items = orderItems(order).map(it=>({...it}));
  const reason = document.getElementById('ret_reason').value.trim();
  if(!guardDates([order.date, pickedDate('ret_date')], 'রিটার্ন')) return;
  let anyReturned = false, overLimit = false;
  const newEntries = [];

  items.forEach((it, i)=>{
    const field = document.getElementById(`ret_qty_${i}`);
    const pRet = products.find(x=>x.id===it.productId);
    const unitSel = document.getElementById(`ret_unit_${i}`);
    const oRet = optByKey(pRet, unitSel ? unitSel.value : 'base');
    const typed = field ? Number(field.value||0) : 0;
    const retQty = r3(typed/oRet.factor);
    if(retQty > Number(it.qty) + 0.0005){ overLimit = true; return; }
    if(retQty>0){
      anyReturned = true;
      const netUnit = Number(it.qty)>0 ? lineAmt(it)/Number(it.qty) : Number(it.unitPrice);
      const refundAmount = retQty * netUnit;
      newEntries.push({
        id: genId('RET-', returns.concat(newEntries)),
        date: pickedDate('ret_date'), orderId: order.id, customerName: order.customerName,
        productId: it.productId, qty: retQty, refundAmount: Math.round(refundAmount*100)/100, reason,
        dq: r3(typed), du: oRet.label, restocked: order.status==='Delivered'
      });
      const oldQ = Number(it.qty), oldDisc = lineDisc(it), oldSur = lineSur(it);
      it.qty = r3(oldQ - retQty);
      it.lineDiscount = oldQ>0 ? Math.round(oldDisc*(it.qty/oldQ)*100)/100 : 0; it.discType = 'amt'; it.discVal = it.lineDiscount;
      it.lineSurcharge = oldQ>0 ? Math.round(oldSur*(it.qty/oldQ)*100)/100 : 0; it.surType = 'amt'; it.surVal = it.lineSurcharge;
      syncDisp(it, products.find(x=>x.id===it.productId));
      if(order.status==='Delivered'){
        const pIdx = products.findIndex(p=>p.id===it.productId);
        if(pIdx>-1){ products[pIdx] = {...products[pIdx], stock: r3(Number(products[pIdx].stock)+retQty)}; }
      }
    }
  });

  if(overLimit){ alert('ফেরত নেওয়ার পরিমাণ অর্ডারের পরিমাণের চেয়ে বেশি হতে পারে না।'); return; }
  if(!anyReturned){ alert('অন্তত একটি পণ্যের রিটার্ন পরিমাণ দিন'); return; }

  const remainingItems = items.filter(it=>Number(it.qty)>0);
  order.items = remainingItems;
  order.total = remainingItems.reduce((s,it)=>s+lineAmt(it),0) + Number(order.deliveryCharge||0);
  delete order.productId; delete order.qty; delete order.unitPrice;

  orders[idx] = order;
  saveCollection('products', products);
  saveCollection('orders', orders);
  saveCollection('returns', returns.concat(newEntries));

  const paidSoFar = (order.paidAmount!=null) ? Number(order.paidAmount) : 0;
  if(paidSoFar > order.total){
    alert(`রিটার্ন সম্পন্ন হয়েছে। নতুন মোট বিল ৳${order.total}, কিন্তু কাস্টমার আগেই ৳${paidSoFar} পরিশোধ করেছেন — অতিরিক্ত ৳${paidSoFar-order.total} নগদ ফেরত দিতে হবে, অথবা পরবর্তী অর্ডারে সমন্বয় করুন।`);
  } else {
    alert('রিটার্ন সফলভাবে সম্পন্ন হয়েছে — অর্ডারের মোট বিল ও স্টক হালনাগাদ হয়েছে।');
  }
  renderReturns();
}

/* ============================================================
   DISCOUNT REGISTER — every order line sold below the product's
   standard price at the time of sale, so nothing gets buried.
   ============================================================ */
let DISC_MONTH = 'all';
function onDiscMonth(sel){ DISC_MONTH = sel.value; renderDiscounts(); }
function renderDiscounts(){
  const orders = CACHE.orders.filter(o => o.status!=='Cancelled' && (DISC_MONTH==='all' || mOf(o.date)===DISC_MONTH));
  const products = CACHE.products, rows = [], byProd = {};
  let orderLevel = 0;
  orders.forEach(o => {
    orderLevel += Number(o.discount||0);
    orderItems(o).forEach(it => {
      const std = Number(it.standardPrice!=null ? it.standardPrice : it.unitPrice), actual = Number(it.unitPrice);
      const priceDisc = std > actual ? (std-actual)*Number(it.qty) : 0, ld = lineDisc(it), sx = lineSur(it), total = priceDisc + ld;
      if(total > 0 || sx > 0){
        const p = products.find(x => x.id===it.productId), name = p ? p.name : '—';
        rows.push({date:o.date, orderId:o.id, customerName:o.customerName, productName:name, qty:fmtItem(it,p), std, ld, priceDisc, sx, total});
        const a = byProd[it.productId] || (byProd[it.productId] = {name, count:0, total:0, sur:0}); a.count++; a.total += total; a.sur += sx;
      }
    });
  });
  rows.sort((a,b) => (a.date<b.date?1:-1));
  const lineTotal = rows.reduce((t,r) => t + r.total, 0), surTotal = rows.reduce((t,r) => t + r.sx, 0);
  const prodRows = Object.values(byProd).sort((a,b) => (b.total+b.sur)-(a.total+a.sur));
  document.getElementById('pageContent').innerHTML = `
    <div class="toolbar"><label style="font-size:13px;font-weight:700;">মাস:</label><select onchange="onDiscMonth(this)">${monthOptionsHtml(DISC_MONTH, true)}</select></div>
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="stat-card warn"><div class="label">পণ্যভিত্তিক মোট ছাড়</div><div class="value">${money(r2(lineTotal))}</div></div>
      <div class="stat-card"><div class="label">পণ্যভিত্তিক মোট বাড়তি নেওয়া</div><div class="value">${money(r2(surTotal))}</div></div>
      <div class="stat-card"><div class="label">পুরো বিলের উপর ছাড় (অর্ডার-স্তরে)</div><div class="value">${money(r2(orderLevel))}</div></div>
    </div>
    <div class="panel">
      <h3>কোন পণ্যে কত ছাড় ও বাড়তি</h3>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>কতবার</th><th>মোট ছাড়</th><th>মোট বাড়তি</th></tr></thead><tbody>
        ${prodRows.map(r => `<tr><td>${esc(r.name)}</td><td class="cell-num">${r.count}</td><td class="cell-num">${r.total>0?'<b>'+money(r2(r.total))+'</b>':'—'}</td><td class="cell-num">${r.sur>0?'<b>'+money(r2(r.sur))+'</b>':'—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">এখনো কোনো পণ্যে ছাড় বা বাড়তি নেই</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="panel">
      <h3>বিস্তারিত (অর্ডার ধরে)</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">কার্টের "এই পণ্যে ছাড়" ও "বাড়তি" ঘরের টাকা ইনভয়েসে কাস্টমারকে আলাদা দেখানো হয়। একক মূল্য সরাসরি কমালেও এখানে "দাম কমানো" হিসেবে ধরা পড়ে, কিন্তু ইনভয়েসে ছাড় হিসেবে দেখায় না। মূল্য তালিকা (পাইকারি/কর্পোরেট) ছাড় নয়, তাই এখানে আসে না।</p>
      <div class="table-wrap"><table><thead><tr>
        <th>তারিখ</th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>পরিমাণ</th><th>নির্ধারিত মূল্য</th><th>পণ্যে ছাড়</th><th>দাম কমানো</th><th>বাড়তি</th>
      </tr></thead><tbody>
        ${rows.map(r => `<tr><td>${r.date}</td><td>${r.orderId}</td><td>${esc(r.customerName)}</td><td>${esc(r.productName)}</td>
          <td class="cell-num">${esc(String(r.qty))}</td><td class="cell-num">${money(r.std)}</td><td class="cell-num">${r.ld>0?money(r.ld):'—'}</td><td class="cell-num">${r.priceDisc>0?money(r2(r.priceDisc)):'—'}</td><td class="cell-num">${r.sx>0?'<b>+ '+money(r2(r.sx))+'</b>':'—'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">এখনো কোনো পণ্যে ছাড় বা বাড়তি নেই</td></tr>'}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   INVENTORY REPORT — this month's opening/purchased/sold/returned/
   closing stock per product, for month-end stock reconciliation.
   ============================================================ */
let INV_SHOW_HIDDEN = false;
function toggleInvHidden(chk){ INV_SHOW_HIDDEN = !!chk.checked; renderInventory(); }
function renderInventory(){
  if(!monthsList().includes(VIEW_MONTH)) VIEW_MONTH = curMonth();
  const month = VIEW_MONTH, d = monthData(month);
  const session = getSession();
  const canSeeValue = session.role==='admin';
  const isCur = month===curMonth();
  const rows = d.rows.filter(r => INV_SHOW_HIDDEN || !r[10]);
  const hiddenTotal = d.rows.filter(r => r[10]).length;
  document.getElementById('pageContent').innerHTML = `
    <div class="toolbar"><label style="font-size:13px;font-weight:700;">মাস:</label>
      <select onchange="onViewMonth(this)">${monthOptionsHtml(month, false)}</select></div>
    ${monthStatusHtml(month)}
    ${canSeeValue ? `<div class="grid grid-2" style="margin-bottom:16px;">
      <div class="stat-card"><div class="label">মাসের শুরুর স্টকের মূল্য (জের, ক্রয়মূল্যে)</div><div class="value">${money(d.openVal)}</div></div>
      <div class="stat-card"><div class="label">${isCur?'বর্তমান':'মাস শেষের'} স্টকের মূল্য (ক্রয়মূল্যে)</div><div class="value">${money(d.closeVal)}</div></div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-head" style="flex-wrap:wrap;gap:8px;">
        <h3>মাসিক ইনভেন্টরি রিপোর্ট — ${monthLabel(month)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${(isCur || canSeeValue) ? `<button class="btn btn-accent btn-sm" onclick="printStockReport(false)">🖨️ স্টক রিপোর্ট প্রিন্ট (সব পণ্য)</button>
          <button class="btn btn-outline btn-sm" onclick="printStockReport(true)">🖨️ শুধু স্টকে আছে এমন পণ্য</button>` : ''}
        </div>
      </div>
      <p style="font-size:12.5px;color:var(--text-muted);">মাসের শুরুর স্টক = আগের মাসের শেষ স্টক (জের)। আগের মাসে পুরোনো তারিখে কোনো ক্রয়/বিক্রয় যোগ বা সংশোধন করলে পরের মাসের শুরুর স্টক নিজে থেকেই ঠিক হয়ে যায়। "সমন্বয়" = পণ্য তালিকা থেকে হাতে স্টক বদলানো/প্রারম্ভিক স্টক।</p>
      <div class="toolbar">
        <span class="muted-cell">রিপোর্টে দেখাচ্ছে ${rows.length}টি পণ্য${hiddenTotal && !INV_SHOW_HIDDEN ? ` · <b>${hiddenTotal}টি লুকানো পণ্য</b> বাদ` : ''}</span>
        ${hiddenTotal ? `<label style="display:flex;gap:6px;align-items:center;font-size:13px;"><input type="checkbox" ${INV_SHOW_HIDDEN?'checked':''} onchange="toggleInvHidden(this)"> লুকানো পণ্যও দেখান</label>` : ''}
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>পণ্য</th><th>মাসের শুরুর স্টক</th><th>+ক্রয়</th><th>−বিক্রয়</th><th>+রিটার্ন</th><th>±সমন্বয়</th><th>=${isCur?'বর্তমান':'শেষ'} স্টক</th>
        ${canSeeValue?'<th>স্টক মূল্য</th>':''}
      </tr></thead><tbody>
        ${rows.map(r=>`
          <tr>
            <td>${esc(r[1])}${r[10] ? ' <span class="badge badge-hidden">লুকানো</span>' : ''}</td>
            <td class="cell-num">${r[3]} ${esc(r[2])}</td>
            <td class="cell-num">${r[4]}</td>
            <td class="cell-num">${r[5]}</td>
            <td class="cell-num">${r[6]}</td>
            <td class="cell-num">${r[7]}</td>
            <td class="cell-num"><b>${r[8]} ${esc(r[2])}</b></td>
            ${canSeeValue?`<td class="cell-num">${money(r2(r[8]*r[9]))}</td>`:''}
          </tr>`).join('') || `<tr><td colspan="8" class="empty-state">কোনো পণ্য নেই</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   SHAREHOLDERS — capital-weighted monthly dividend split.
   Each shareholder's invested balance grows as they contribute;
   the dividend pool is split in proportion to that balance.
   ============================================================ */
let SH_Q = '';
function shareholderTablesHtml(){
  const shareholders = CACHE.shareholders;
  const totalInvested = shareholders.reduce((s,sh)=>s+Number(sh.totalInvested||0),0);
  const q = SH_Q.trim().toLowerCase();
  const rows = shareholders.filter(sh=>!q || String(sh.name).toLowerCase().includes(q) || String(sh.id).toLowerCase().includes(q)).map(sh=>{
    const pct = totalInvested>0 ? (Number(sh.totalInvested)/totalInvested*100) : 0;
    return `<tr>
      <td>${esc(sh.name)}</td>
      <td class="cell-num">${money(sh.totalInvested)}</td>
      <td class="cell-num">${pct.toFixed(1)}%</td>
      <td class="cell-center">
        <button class="btn btn-outline btn-sm" onclick="openContributionForm('${sh.id}')">+ জমা যোগ করুন</button>
        <button class="icon-btn danger" onclick="deleteShareholder('${sh.id}')">🗑️</button>
      </td>
    </tr>`;
  }).join('');
  let contribs = CACHE.contributions.slice().reverse().filter(c=>{
    if(!q) return true;
    const sh = shareholders.find(s=>s.id===c.shareholderId);
    return String((sh&&sh.name)||'').toLowerCase().includes(q) || String(c.date||'').includes(q);
  });
  if(!q) contribs = contribs.slice(0,20);
  const contribRows = contribs.map(c=>{
    const sh = shareholders.find(s=>s.id===c.shareholderId);
    return `<tr><td>${c.date}</td><td>${esc(sh?sh.name:'—')}</td><td class="cell-num">${money(c.amount)}</td></tr>`;
  }).join('');
  return {
    rows: rows || `<tr><td colspan="4" class="empty-state">${shareholders.length?'কিছু পাওয়া যায়নি':'কোনো শেয়ারহোল্ডার যোগ করা হয়নি'}</td></tr>`,
    contribRows: contribRows || `<tr><td colspan="3" class="empty-state">${q?'কিছু পাওয়া যায়নি':'কোনো জমা এন্ট্রি নেই'}</td></tr>`
  };
}
function onShareholderSearch(){
  SH_Q = document.getElementById('shSearch').value;
  const t = shareholderTablesHtml();
  document.getElementById('shBody').innerHTML = t.rows;
  document.getElementById('shContribBody').innerHTML = t.contribRows;
  document.getElementById('shContribTitle').textContent = SH_Q.trim() ? 'জমার হিস্ট্রি (সার্চ ফলাফল)' : 'সাম্প্রতিক জমার হিস্ট্রি';
}
let SH_BUY_MONTH = 'all';
function onShBuyMonth(sel){ SH_BUY_MONTH = sel.value; renderShareholders(); }
function shareholderBuyHtml(){
  const shs = CACHE.shareholders, inM = o => SH_BUY_MONTH==='all' || mOf(o.date)===SH_BUY_MONTH;
  const valid = CACHE.orders.filter(o => o.status!=='Cancelled' && inM(o));
  const mine = valid.filter(o => o.shareholderId && shs.some(s => s.id===o.shareholderId));
  const stat = shs.map(sh => {
    const os = mine.filter(o => o.shareholderId===sh.id);
    return {sh, n:os.length, total:os.reduce((t,o)=>t+Number(o.total||0),0), due:os.reduce((t,o)=>t+orderDue(o),0), last:os.reduce((d,o)=>o.date>d?o.date:d,'')};
  }).sort((a,b) => b.total-a.total || a.sh.name.localeCompare(b.sh.name,'bn'));
  const buyers = stat.filter(x => x.n>0).length, grand = mine.reduce((t,o)=>t+Number(o.total||0),0);
  const unlinked = CACHE.orders.filter(o => !o.shareholderId && shs.some(s => String(s.name).trim().toLowerCase()===String(o.customerName||'').trim().toLowerCase())).length;
  const rows = stat.map(x => `<tr${x.n?'':' style="opacity:.65;"'}><td>${esc(x.sh.name)}</td><td class="cell-num">${x.n}</td><td class="cell-num">${money(x.total)}</td><td class="cell-num">${x.due>0?money(x.due):'—'}</td><td class="cell-num">${x.last||'কেনেননি'}</td></tr>`).join('');
  const list = mine.slice().reverse().slice(0,40).map(o => { const sh = shs.find(s=>s.id===o.shareholderId);
    return `<tr><td>${o.id}</td><td>${o.date}</td><td>${esc(sh?sh.name:'—')}</td><td class="cell-num">${money(o.total)}</td><td class="cell-center">${STATUS_BN[o.status]||''}</td><td class="cell-center"><span class="badge ${PAY_BADGE[o.paymentStatus]}">${PAY_BN[o.paymentStatus]||''}</span></td><td class="cell-center"><button class="icon-btn" onclick="viewInvoice('${o.id}')">🧾</button></td></tr>`; }).join('');
  return `<div class="panel">
    <div class="panel-head"><h3>🤝 শেয়ারহোল্ডারদের কেনাকাটা (ট্র্যাকিং)</h3>
      <select onchange="onShBuyMonth(this)" style="padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${monthOptionsHtml(SH_BUY_MONTH, true)}</select></div>
    <div class="flash" style="margin-bottom:12px;">এই সময়ে <b>${buyers}/${shs.length}</b> জন শেয়ারহোল্ডার কিনেছেন · মোট <b>${mine.length}</b>টি অর্ডার · মোট <b>${money(grand)}</b> (বাতিল অর্ডার ধরা হয়নি)</div>
    ${unlinked ? `<div class="flash warn" style="margin-bottom:12px;">${unlinked}টি অর্ডারে ক্রেতার নাম কোনো শেয়ারহোল্ডারের নামের সাথে হুবহু মিলছে, কিন্তু অর্ডারে শেয়ারহোল্ডার বাছা নেই। <button class="btn btn-outline btn-sm" onclick="linkOldShareholderOrders()">🔗 মিলিয়ে দিন</button></div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>শেয়ারহোল্ডার</th><th>অর্ডার</th><th>মোট কেনা</th><th>বাকি</th><th>শেষ কেনা</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty-state">কোনো শেয়ারহোল্ডার নেই</td></tr>'}</tbody></table></div>
    <h4 style="margin:16px 0 6px;">শেয়ারহোল্ডারদের অর্ডার${mine.length>40?' (সাম্প্রতিক ৪০টি)':''}</h4>
    <div class="table-wrap"><table><thead><tr><th>অর্ডার</th><th>তারিখ</th><th>শেয়ারহোল্ডার</th><th>মোট</th><th>অবস্থা</th><th>পেমেন্ট</th><th></th></tr></thead><tbody>${list || '<tr><td colspan="7" class="empty-state">এই সময়ে শেয়ারহোল্ডারের কোনো অর্ডার নেই — অর্ডার ফর্মে "শেয়ারহোল্ডার ক্রেতা" বেছে দিন</td></tr>'}</tbody></table></div>
  </div>`;
}
function linkOldShareholderOrders(){
  if(!isAdmin()) return;
  const shs = CACHE.shareholders, key = x => String(x||'').trim().toLowerCase(); let n = 0;
  const orders = CACHE.orders.map(o => { if(o.shareholderId) return o; const sh = shs.find(s => key(s.name)===key(o.customerName)); if(sh){ n++; return {...o, shareholderId:sh.id}; } return o; });
  if(!n){ alert('মেলানোর মতো অর্ডার নেই।'); return; }
  if(!confirm(n + 'টি পুরোনো অর্ডারে নাম মিলিয়ে শেয়ারহোল্ডার বসানো হবে (টাকার হিসাব বদলাবে না)। এগোবেন?')) return;
  saveCollection('orders', orders); renderShareholders();
}
function renderShareholders(){
  const t = shareholderTablesHtml();
  document.getElementById('pageContent').innerHTML = `
    ${shareholderBuyHtml()}
    <div class="panel">
      <div class="panel-head"><h3>শেয়ারহোল্ডার তালিকা ও বিনিয়োগ</h3>
        <button class="btn btn-accent btn-sm" onclick="openShareholderForm()">+ নতুন শেয়ারহোল্ডার</button>
      </div>
      <div class="toolbar">
        <input type="search" id="shSearch" placeholder="🔍 শেয়ারহোল্ডারের নাম দিয়ে খুঁজুন" value="${esc(SH_Q)}" oninput="onShareholderSearch()">
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>নাম</th><th>মোট বিনিয়োগ</th><th>শেয়ারের হার</th><th>একশন</th>
      </tr></thead><tbody id="shBody">${t.rows}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">"লাভ-ক্ষতি" পেইজে মোট শেয়ারহোল্ডার লভ্যাংশ এই অনুপাত অনুযায়ীই প্রতিটা শেয়ারহোল্ডারের মধ্যে ভাগ হয়ে দেখানো হবে।</p>
    </div>
    <div class="panel">
      <h3 id="shContribTitle">${SH_Q.trim() ? 'জমার হিস্ট্রি (সার্চ ফলাফল)' : 'সাম্প্রতিক জমার হিস্ট্রি'}</h3>
      <div class="table-wrap"><table><thead><tr><th>তারিখ</th><th>শেয়ারহোল্ডার</th><th>জমার পরিমাণ</th></tr></thead>
        <tbody id="shContribBody">${t.contribRows}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
}
function openShareholderForm(){
  openForm(`
    <div class="panel">
      <h3>নতুন শেয়ারহোল্ডার যোগ করুন</h3>
      <div class="form-grid">
        <div class="form-field"><label>নাম</label><input id="sh_name"></div>
        <div class="form-field"><label>শুরুর বিনিয়োগ (৳)</label><input id="sh_initial" type="number" value="0"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveShareholder()">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="closeForm(renderShareholders)">বাতিল</button>
      </div>
    </div>`);
}
function saveShareholder(){
  const name = document.getElementById('sh_name').value.trim();
  if(!name){ alert('নাম দিন'); return; }
  const shareholders = CACHE.shareholders.slice();
  const initial = Number(document.getElementById('sh_initial').value||0);
  shareholders.push({ id: genId('SH-', shareholders), name, totalInvested: initial });
  saveCollection('shareholders', shareholders);
  renderShareholders(); toTop();
}
function deleteShareholder(id){
  const lockedC = CACHE.contributions.find(c => c.shareholderId===id && isDateLocked(c.date));
  if(lockedC){ alert(`🔒 এই শেয়ারহোল্ডারের জমা এন্ট্রি ${monthLabel(mOf(lockedC.date))} মাসে আছে, যা লক করা — মোছা যাবে না।`); return; }
  if(!confirm('এই শেয়ারহোল্ডারকে মুছে ফেলতে চান?')) return;
  saveCollection('shareholders', CACHE.shareholders.filter(s=>s.id!==id));
  renderShareholders();
}
function openContributionForm(shareholderId){
  const sh = CACHE.shareholders.find(s=>s.id===shareholderId);
  openForm(`
    <div class="panel">
      <h3>${esc(sh.name)} — নতুন শেয়ার ক্রয়/জমা যোগ করুন</h3>
      <div style="max-width:240px;margin-bottom:10px;">${dateField('c_date')}</div>
      <div class="form-field" style="max-width:220px;"><label>পরিমাণ (৳)</label><input id="c_amount" type="number" value="1000"></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('c_amount').value=1000">৳১,০০০</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('c_amount').value=2000">৳২,০০০</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('c_amount').value=5000">৳৫,০০০</button>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveContribution('${shareholderId}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="closeForm(renderShareholders)">বাতিল</button>
      </div>
    </div>`);
}
function saveContribution(shareholderId){
  const amount = Number(document.getElementById('c_amount').value||0);
  if(amount<=0){ alert('সঠিক পরিমাণ দিন'); return; }
  if(!guardDate(pickedDate('c_date'), 'জমা এন্ট্রি')) return;
  const shareholders = CACHE.shareholders.slice();
  const idx = shareholders.findIndex(s=>s.id===shareholderId);
  shareholders[idx] = {...shareholders[idx], totalInvested: Number(shareholders[idx].totalInvested||0)+amount};
  const contributions = CACHE.contributions.slice();
  contributions.push({ id: genId('CON-', contributions), date: pickedDate('c_date'), shareholderId, amount });
  saveCollection('shareholders', shareholders);
  saveCollection('contributions', contributions);
  renderShareholders(); toTop();
}

/* ============================================================
   PROFIT & LOSS (admin only)
   ============================================================ */
/* ============================================================
   INVESTMENT & RETURN — মূলধন ও রিটার্ন (লাভ-ক্ষতি পেইজে)
   হাতে লেখা বিনিয়োগ + স্টক/বকেয়া থেকে "আটকে থাকা টাকা" — দুই হিসাব পাশাপাশি
   ============================================================ */
let INV_EDIT = '';
function invSigned(x){ return (x.type==='out' ? -1 : 1) * Number(x.amount||0); }
function invSum(pred){ return r2(CACHE.investments.filter(pred).reduce((t,x) => t + invSigned(x), 0)); }
function invIn(pred){ return r2(CACHE.investments.filter(x => x.type!=='out' && pred(x)).reduce((t,x) => t + Number(x.amount||0), 0)); }
function invOut(pred){ return r2(CACHE.investments.filter(x => x.type==='out' && pred(x)).reduce((t,x) => t + Number(x.amount||0), 0)); }
function invPct(a, b){ return b>0 ? (a/b*100).toFixed(2) + '%' : '—'; }
function investPanelHtml(m, d, carryEnd){
  const before = invSum(x => mOf(x.date) < m), thisIn = invIn(x => mOf(x.date)===m), thisOut = invOut(x => mOf(x.date)===m), capital = r2(before + thisIn - thisOut);
  const custDue = r2(CACHE.orders.filter(o => o.status==='Delivered' && mOf(o.date) <= m).reduce((t,o) => t + orderDue(o), 0));
  const supDue = r2(CACHE.purchases.filter(pu => mOf(pu.date) <= m).reduce((t,pu) => t + purchaseDue(pu), 0));
  const stuck = r2(d.closeVal + custDue - supDue);
  const buy = r2(CACHE.purchases.filter(pu => mOf(pu.date)===m).reduce((t,pu) => t + Number(pu.totalCost||0), 0));
  const entries = CACHE.investments.filter(x => mOf(x.date)===m).slice().sort((a,b) => a.date < b.date ? 1 : -1);
  const locked = isMonthLocked(m), ed = INV_EDIT ? CACHE.investments.find(x => x.id===INV_EDIT) : null;
  const defDate = ed ? ed.date : (m===curMonth() ? '' : monthStart(m));
  const neg = v => v>=0 ? '' : 'color:#B3261E;';
  return `
    <div class="panel">
      <h3>মূলধন ও রিটার্ন — ${monthLabel(m)}</h3>
      <div class="grid grid-2" style="margin-bottom:12px;">
        <div class="stat-card"><div class="label">এই মাসের রিটার্ন (হাতে লেখা মূলধনে)</div><div class="value" style="${neg(d.net)}">${invPct(d.net, capital)}</div><div class="sub">নিট প্রফিট ${money(d.net)} ÷ মূলধন ${money(capital)}</div></div>
        <div class="stat-card"><div class="label">এই মাসের রিটার্ন (আটকে থাকা টাকায়)</div><div class="value" style="${neg(d.net)}">${invPct(d.net, stuck)}</div><div class="sub">নিট প্রফিট ${money(d.net)} ÷ আটকে থাকা ${money(stuck)}</div></div>
      </div>
      <h4 style="margin:10px 0 4px;">ক) হাতে লেখা বিনিয়োগ অনুযায়ী</h4>
      <table>
        <tr><td>আগের মাস পর্যন্ত নিট মূলধন (বিনিয়োগ − উত্তোলন, জের)</td><td class="cell-num" style="${neg(before)}">${money(before)}</td></tr>
        <tr><td>+ এই মাসের নতুন বিনিয়োগ</td><td class="cell-num">${money(thisIn)}</td></tr>
        <tr><td>− এই মাসের উত্তোলন</td><td class="cell-num">${money(thisOut)}</td></tr>
        <tr><td><b>মোট মূলধন (মাস শেষে)</b></td><td class="cell-num" style="${neg(capital)}"><b>${money(capital)}</b></td></tr>
        <tr><td>এই মাসের নিট প্রফিট</td><td class="cell-num" style="${neg(d.net)}">${money(d.net)}</td></tr>
        <tr><td>মোট জমা নিট প্রফিট (মাস শেষ পর্যন্ত)</td><td class="cell-num" style="${neg(carryEnd)}">${money(carryEnd)}</td></tr>
        <tr><td><b>মোট রিটার্ন (জমা প্রফিট ÷ মোট মূলধন)</b></td><td class="cell-num"><b>${invPct(carryEnd, capital)}</b></td></tr>
      </table>
      <h4 style="margin:14px 0 4px;">খ) আটকে থাকা টাকা অনুযায়ী (আনুমানিক — ক্যাশ ধরা নেই)</h4>
      <table>
        <tr><td>এই মাসের মোট ক্রয় (ভাউচার ধরে)</td><td class="cell-num">${money(buy)}</td></tr>
        <tr><td>মাস শেষের স্টক মূল্য (ক্রয়মূল্যে)</td><td class="cell-num">${money(d.closeVal)}</td></tr>
        <tr><td>+ কাস্টমারের বকেয়া (এখনকার, এই মাস পর্যন্ত ডেলিভারড অর্ডারের)</td><td class="cell-num">${money(custDue)}</td></tr>
        <tr><td>− সরবরাহকারীর বকেয়া (এখনকার, এই মাস পর্যন্ত ক্রয়ের)</td><td class="cell-num">− ${money(supDue)}</td></tr>
      </table>
      <div class="invoice-total-row"><span>ব্যবসায় আটকে থাকা টাকা</span><span>${money(stuck)}</span></div>
      <h4 style="margin:16px 0 6px;">বিনিয়োগ / উত্তোলন এন্ট্রি — ${monthLabel(m)}</h4>
      ${locked ? '<div class="flash warn">🔒 এই মাস লক করা — এন্ট্রি যোগ বা বদলানো যাবে না।</div>' : `
      <div class="form-grid">
        <div class="form-field"><label>ধরন</label><select id="inv_type" style="padding:9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);"><option value="in" ${!ed||ed.type!=='out'?'selected':''}>বিনিয়োগ (ব্যবসায় টাকা ঢাললাম)</option><option value="out" ${ed&&ed.type==='out'?'selected':''}>উত্তোলন (ব্যবসা থেকে টাকা তুললাম)</option></select></div>
        ${dateField('inv_date', defDate)}
        <div class="form-field"><label>পরিমাণ (৳)</label><input id="inv_amount" type="number" step="any" value="${ed?ed.amount:''}" placeholder="যেমন: 50000"></div>
        <div class="form-field"><label>নোট (ঐচ্ছিক)</label><input id="inv_note" value="${ed?esc(ed.note||''):''}" placeholder="যেমন: নিজের সঞ্চয় থেকে"></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="saveInvestment()">${ed?'সংশোধন সংরক্ষণ':'+ যোগ করুন'}</button>
        ${ed ? '<button class="btn btn-outline btn-sm" onclick="INV_EDIT=\'\';renderProfitLoss()">বাতিল</button>' : ''}
      </div>`}
      <div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>তারিখ</th><th>ধরন</th><th>পরিমাণ</th><th>নোট</th><th>একশন</th></tr></thead><tbody>
        ${entries.map(x => `<tr><td>${x.date}</td><td>${x.type==='out'?'উত্তোলন':'বিনিয়োগ'}</td><td class="cell-num" style="${x.type==='out'?'color:#B3261E;':'color:#167A54;'}">${x.type==='out'?'− ':'+ '}${money(x.amount)}</td><td>${esc(x.note||'')}</td><td class="cell-center">${isDateLocked(x.date) ? '🔒' : `<button class="icon-btn" onclick="editInvestment('${x.id}')">✏️</button><button class="icon-btn danger" onclick="deleteInvestment('${x.id}')">🗑️</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">এই মাসে কোনো বিনিয়োগ বা উত্তোলন লেখা হয়নি</td></tr>'}
      </tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">"ক" অংশের মূলধন = আপনার হাতে লেখা বিনিয়োগের যোগফল − উত্তোলন। মাল কেনা বিনিয়োগ নয়, তাই ক্রয় খাতার টাকা এখানে যোগ করবেন না। "খ" অংশ স্টক ও বকেয়া থেকে আনুমানিক — সফটওয়্যার ক্যাশ বা ব্যাংকের টাকা ট্র্যাক করে না।</p>
    </div>`;
}
function saveInvestment(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন লিখতে পারবেন'); return; }
  const amount = Number(document.getElementById('inv_amount').value||0);
  if(!(amount>0)){ alert('পরিমাণ সঠিকভাবে দিন'); return; }
  const type = (document.getElementById('inv_type')||{}).value==='out' ? 'out' : 'in';
  const date = pickedDate('inv_date'), note = document.getElementById('inv_note').value.trim();
  const old = INV_EDIT ? CACHE.investments.find(x => x.id===INV_EDIT) : null;
  if(!guardDates([date, old && old.date], old ? 'সংশোধন' : 'এন্ট্রি')) return;
  const arr = CACHE.investments.slice();
  if(old){ const i = arr.findIndex(x => x.id===old.id); arr[i] = stampEdit({...old, date, amount, note, type}); }
  else arr.push({id: genId('INV-', arr), date, amount, note, type});
  if(saveCollection('investments', arr)){ INV_EDIT = ''; VIEW_MONTH = mOf(date) || VIEW_MONTH; renderProfitLoss(); }
}
function editInvestment(id){ const x = CACHE.investments.find(v => v.id===id); if(!x || !guardDate(x.date, 'সংশোধন')) return; INV_EDIT = id; renderProfitLoss(); }
function deleteInvestment(id){
  const x = CACHE.investments.find(v => v.id===id); if(!x) return;
  if(!isAdmin()){ alert('শুধু অ্যাডমিন মুছতে পারবেন'); return; }
  if(!guardDate(x.date, 'মুছে ফেলা')) return;
  if(!confirm('এই বিনিয়োগ এন্ট্রিটি মুছবেন?')) return;
  saveCollection('investments', CACHE.investments.filter(v => v.id!==id)); renderProfitLoss();
}

function priceListPanelHtml(m){
  const g = {};
  CACHE.orders.filter(o => o.status==='Delivered' && mOf(o.date)===m).forEach(o => {
    orderItems(o).forEach(it => {
      const k = (it.pl && PRICE_LISTS[it.pl]) ? it.pl : ((o.priceList && PRICE_LISTS[o.priceList]) ? o.priceList : 'retail');
      const a = g[k] || (g[k] = {ords:new Set(), rev:0, cogs:0}); const p = CACHE.products.find(x => x.id===it.productId);
      a.ords.add(o.id); a.rev += lineAmt(it); a.cogs += (p ? Number(p.cost||0) : 0) * Number(it.qty||0);
    });
  });
  const keys = Object.keys(PRICE_LISTS).filter(k => g[k]); if(!keys.length) return '';
  const tot = keys.reduce((t,k) => ({n:t.n+g[k].ords.size, rev:t.rev+g[k].rev, cogs:t.cogs+g[k].cogs}), {n:0,rev:0,cogs:0});
  const row = (name, n, a) => `<tr><td>${name}</td><td class="cell-num">${n}</td><td class="cell-num">${money(r2(a.rev))}</td><td class="cell-num">${money(r2(a.cogs))}</td><td class="cell-num"><b>${money(r2(a.rev-a.cogs))}</b></td><td class="cell-num">${a.rev>0 ? ((a.rev-a.cogs)/a.rev*100).toFixed(1)+'%' : '—'}</td></tr>`;
  return `<div class="panel"><h3>মূল্য তালিকা অনুযায়ী বিক্রয় ও লাভ (পণ্য ধরে) — ${monthLabel(m)}</h3>
    <div class="table-wrap"><table><thead><tr><th>তালিকা</th><th>অর্ডার</th><th>বিক্রয়</th><th>ক্রয়মূল্য</th><th>গ্রস লাভ</th><th>মার্জিন</th></tr></thead><tbody>
    ${keys.map(k => row(PRICE_LISTS[k], g[k].ords.size, g[k])).join('')}${keys.length>1 ? row('<b>মোট</b>', tot.n, tot) : ''}</tbody></table></div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">প্রতিটি পণ্যের লাইন তার নিজের তালিকায় ধরা হয়েছে (ডেলিভারি চার্জ ও পুরো বিলের ছাড় বাদে)। একটা অর্ডারে একাধিক তালিকা থাকলে অর্ডারটি প্রতি তালিকায় গোনা হয়। ক্রয়মূল্য এখনকার ভাউচার গড়ে।</p></div>`;
}
function renderProfitLoss(){
  if(!monthsList().includes(VIEW_MONTH)) VIEW_MONTH = curMonth();
  const m = VIEW_MONTH, idx = moveIndex(), d = monthData(m, idx);
  const carry = carryForward(m, idx), carryEnd = r2(carry + d.net);
  document.getElementById('pageContent').innerHTML = `
    <div class="toolbar"><label style="font-size:13px;font-weight:700;">মাস:</label>
      <select onchange="onViewMonth(this)">${monthOptionsHtml(m, false)}</select></div>
    ${monthStatusHtml(m)}
    <div class="panel">
      <h3>আয়-ব্যয় বিবরণী — ${monthLabel(m)}</h3>
      <table>
        <tr><td>মোট বিক্রয় (ডেলিভারড অর্ডার)</td><td class="cell-num">${money(d.revenue)}</td></tr>
        <tr><td>বিক্রিত পণ্যের ক্রয়মূল্য (COGS)</td><td class="cell-num">${money(d.cogs)}</td></tr>
        <tr><td><b>গ্রস প্রফিট</b></td><td class="cell-num"><b>${money(d.gross)}</b></td></tr>
        <tr><td>কমিশন / অন্যান্য আয়</td><td class="cell-num">+ ${money(d.otherIncome)}</td></tr>
        <tr><td>মোট পরিচালন খরচ</td><td class="cell-num">− ${money(d.expenses)}</td></tr>
      </table>
      <div class="invoice-total-row"><span>নিট প্রফিট</span><span>${money(d.net)}</span></div>
    </div>
    <div class="panel">
      <h3>জের ও মাস শেষের অবস্থা</h3>
      <table>
        <tr><td>মাসের শুরুর স্টকের মূল্য (আগের মাস থেকে জের)</td><td class="cell-num">${money(d.openVal)}</td></tr>
        <tr><td>মাস শেষের স্টকের মূল্য</td><td class="cell-num">${money(d.closeVal)}</td></tr>
        <tr><td>আগের মাসগুলোর জমা নিট প্রফিট (জের)</td><td class="cell-num">${money(carry)}</td></tr>
        <tr><td>+ এই মাসের নিট প্রফিট</td><td class="cell-num">${money(d.net)}</td></tr>
        <tr><td>এই মাসে নতুন কাস্টমার বকেয়া</td><td class="cell-num">${money(d.custDueNew)}</td></tr>
        <tr><td>এই মাসে নতুন সরবরাহকারী বকেয়া</td><td class="cell-num">${money(d.supDueNew)}</td></tr>
      </table>
      <div class="invoice-total-row"><span>মাস শেষে মোট জমা নিট প্রফিট (পরের মাসে যাবে)</span><span>${money(carryEnd)}</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">জের পরের মাসে নিজে থেকেই যোগ হয়। আগের মাসে পুরোনো তারিখে কোনো এন্ট্রি দিলে পরের মাসের জের নিজে থেকেই ঠিক হয়ে যায়।</p>
    </div>
    ${priceListPanelHtml(m)}
    ${investPanelHtml(m, d, carryEnd)}
  `;
}

/* ============================================================
   INVOICE
   ============================================================ */
let INVOICE_PRESELECT = null, INV_MONTH = 'all';
function onInvMonth(sel){ INV_MONTH = sel.value; renderInvoice((document.getElementById('inv_order')||{}).value || ''); }
function renderInvoice(preId){
  const sel = (typeof preId==='string' && preId) ? preId : (INVOICE_PRESELECT || '');
  INVOICE_PRESELECT = null;
  const selOrder = sel ? CACHE.orders.find(o => o.id===sel) : null;
  if(selOrder && INV_MONTH!=='all') INV_MONTH = mOf(selOrder.date) || INV_MONTH;   // বাছাই করা অর্ডারের মাসেই দেখাবে
  if(INV_MONTH!=='all' && !monthsList().includes(INV_MONTH)) INV_MONTH = 'all';
  // মাস অনুযায়ী সাজানো: নতুন মাস আগে, প্রতি মাসে নতুন তারিখ আগে
  const list = CACHE.orders.filter(o => INV_MONTH==='all' || mOf(o.date)===INV_MONTH)
    .slice().sort((a,b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)));
  const opt = o => `<option value="${o.id}" ${o.id===sel?'selected':''}>${o.id} — ${esc(o.customerName)} (${o.date})</option>`;
  const groups = {};
  list.forEach(o => { const m = mOf(o.date) || '—'; (groups[m] = groups[m] || []).push(o); });
  const options = Object.keys(groups).sort().reverse().map(m =>
    `<optgroup label="${m==='—' ? 'তারিখ নেই' : monthLabel(m) + ' (' + monthRangeText(m) + ') — ' + groups[m].length + 'টি'}">${groups[m].map(opt).join('')}</optgroup>`).join('');
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <h3>ইনভয়েস তৈরি করুন</h3>
      <div class="form-field" style="max-width:420px;margin-bottom:12px;">
        <label>মাস</label>
        <select onchange="onInvMonth(this)">${monthOptionsHtml(INV_MONTH, true)}</select>
      </div>
      <div class="form-field" style="max-width:420px;">
        <label>অর্ডার নির্বাচন করুন</label>
        <select id="inv_order" onchange="drawInvoice()">
          <option value="">— অর্ডার বাছাই করুন —</option>${options}
        </select>
      </div>
    </div>
    <div id="modalHolder"></div>
    <div id="invoiceHolder"></div>
  `;
  if(sel) drawInvoice();
}
function editInvoice(id){ openOrderForm(id, 'invoice'); }
function drawInvoice(){
  const id = document.getElementById('inv_order').value;
  const holder = document.getElementById('invoiceHolder');
  if(!id){ holder.innerHTML=''; return; }
  const o = CACHE.orders.find(x=>x.id===id);
  const items = orderItems(o);
  const itemRows = items.map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    return `<tr>
      <td>${esc(p?p.name:'—')}</td>
      <td class="cell-num">${fmtItem(it, p)}</td><td class="cell-num">${money(it.unitPrice)}${p?.unit?`/${esc(p.unit)}`:''}</td><td class="cell-num">${lineDisc(it)>0 ? `− ${money(lineDisc(it))}${it.discType==='pct'?`<br><span class="muted-cell" style="font-size:10.5px;">(${it.discVal}%)</span>`:''}` : '<span class="muted-cell">—</span>'}</td>${items.some(x=>lineSur(x)>0) ? '<td class="cell-num">'+(lineSur(it)>0 ? '+ '+money(lineSur(it)) : '<span class="muted-cell">—</span>')+'</td>' : ''}<td class="cell-num">${money(lineAmt(it))}</td>
    </tr>`;
  }).join('');

  const invHtml = `
    <div class="invoice-box" id="invoiceBox">
      <div class="invoice-head">
        <img src="logo.jpg" alt="logo">
        <div class="inv-mid">
          <h3>Avera Mart</h3>
          <p class="tagline">${esc(CACHE.settings.tagline||'')}</p>
          <p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">${esc(CACHE.settings.businessAddress)}${CACHE.settings.phone?' · '+esc(CACHE.settings.phone):''}</p>
        </div>
        ${qrHeadHtml()}
      </div>
      <div class="invoice-meta">
        <div>ইনভয়েস: ${o.id}<br>তারিখ: ${o.date}</div>
        <div style="text-align:left">${esc(o.customerName)}<br>${esc(o.phone)}<br>${esc(o.address)}</div>
      </div>
      <table>
        <thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>একক মূল্য</th><th>ছাড়</th>${items.some(x=>lineSur(x)>0)?'<th>বাড়তি</th>':''}<th>মোট</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table style="margin-top:8px;">
        <tr><td>ডেলিভারি চার্জ</td><td class="cell-num">${money(o.deliveryCharge)}</td></tr>
        ${o.discount>0 ? `<tr><td>ছাড় / ডিসকাউন্ট</td><td class="cell-num">− ${money(o.discount)}</td></tr>` : ''}
      </table>
      <div class="invoice-total-row"><span>সর্বমোট</span><span>${money(o.total)}</span></div>
      ${(() => { const sv = items.reduce((t,it)=>t+lineDisc(it),0) + Number(o.discount||0); return sv>0 ? `<p style="font-size:12.5px;color:#0E7448;font-weight:700;margin-top:8px;">💚 এই কেনাকাটায় আপনার মোট সাশ্রয়: ${money(sv)}</p>` : ''; })()}
      <p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;">পেমেন্ট স্ট্যাটাস: ${PAY_BN[o.paymentStatus]||o.paymentStatus} — পরিশোধিত ${money(o.paidAmount!=null?o.paidAmount:(o.paymentStatus==='Paid'?o.total:0))}${orderDue(o)>0 ? `, বকেয়া ${money(orderDue(o))}` : ''}</p>
      ${o.paymentMethod ? `<p style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">পেমেন্টের ধরন: ${esc((PAY_METHODS.find(m=>m.value===o.paymentMethod)||{}).label || o.paymentMethod)}${o.transactionRef ? ` — ট্রানজেকশন আইডি/অ্যাকাউন্ট: ${esc(o.transactionRef)}` : ''}</p>` : ''}
      <div class="invoice-sign">
        <div><span class="sign-line"></span>ক্রেতার স্বাক্ষর</div>
        <div><span class="sign-line"></span>বিক্রেতার স্বাক্ষর</div>
      </div>
    </div>
    <div class="invoice-actions">
      ${isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="editInvoice('${o.id}')">✏️ ইনভয়েস সংশোধন করুন</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="printInvoice(false)">🖨️ সাধারণ প্রিন্ট</button>
      <button class="btn btn-outline btn-sm" onclick="printInvoice(true)">🧾 থার্মাল প্রিন্ট</button>
      <button class="btn btn-accent btn-sm" onclick="shareWhatsapp('${o.id}')">📲 হোয়াটসঅ্যাপে শেয়ার</button>
      <button class="btn btn-accent btn-sm" onclick="shareInvoiceImage()">🖼️ ছবি হিসেবে শেয়ার/ডাউনলোড</button>
    </div>
    <p id="imgShareStatus" style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px;"></p>
    ${isAdmin() ? '' : `<p style="text-align:center;font-size:12px;color:var(--text-muted);">ইনভয়েসে ভুল থাকলে অ্যাডমিনকে জানান — সংশোধন শুধু অ্যাডমিন করতে পারেন।</p>`}
  `;
  holder.innerHTML = invHtml;
}
function printWhenReady(){
  const imgs = Array.from(document.querySelectorAll('#printArea img'));
  const waits = imgs.map(im => (im.complete && im.naturalWidth) ? Promise.resolve() : new Promise(r => { im.onload = r; im.onerror = r; }));
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  Promise.race([Promise.all([...waits, fontsReady]), new Promise(r => setTimeout(r, 3000))]).then(() => window.print());
}
function printInvoice(thermal){
  const box = document.getElementById('invoiceBox').outerHTML;
  document.getElementById('printArea').innerHTML = box;
  document.body.classList.toggle('thermal', !!thermal);
  printWhenReady();
}
function shareInvoiceImage(){
  const statusEl = document.getElementById('imgShareStatus');
  const box = document.getElementById('invoiceBox');
  if(typeof html2canvas === 'undefined'){
    statusEl.textContent = 'ছবি তৈরির লাইব্রেরি লোড হয়নি — ইন্টারনেট সংযোগ যাচাই করে পেইজ রিফ্রেশ করুন।';
    return;
  }
  statusEl.textContent = 'ছবি তৈরি হচ্ছে...';
  html2canvas(box, { scale: 2, backgroundColor: '#ffffff' }).then(canvas => {
    canvas.toBlob(async (blob) => {
      if(!blob){ statusEl.textContent = 'ছবি তৈরি করা যায়নি।'; return; }
      const fileName = `avera-mart-invoice-${document.getElementById('inv_order').value}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      if(navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: 'Avera Mart Invoice' });
          statusEl.textContent = '';
          return;
        }catch(err){ /* user cancelled or share failed — fall back to download below */ }
      }
      // Desktop or unsupported browser — just download the JPG so it can be attached anywhere manually
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      statusEl.textContent = 'ছবি ডাউনলোড হয়েছে — এখন যেকোনো অ্যাপ (WhatsApp, SMS, ইমেইল ইত্যাদি) দিয়ে সংযুক্ত করে পাঠাতে পারবেন।';
    }, 'image/jpeg', 0.95);
  });
}
function shareWhatsapp(orderId){
  const o = CACHE.orders.find(x=>x.id===orderId);
  const items = orderItems(o);
  const lines = items.map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    { const d0 = lineDisc(it), sx = lineSur(it), base = `${p?p.name:''} — ${fmtItem(it, p)}`; return (d0>0||sx>0) ? `${base} = ৳${lineGross(it)}${d0>0?` − ছাড় ৳${d0}`:''}${sx>0?` + বাড়তি ৳${sx}`:''} = ৳${lineAmt(it)}` : `${base} = ৳${lineAmt(it)}`; }
  }).join('\n');
  const text = `Avera Mart ইনভয়েস ${o.id}\nকাস্টমার: ${o.customerName}\n${lines}\nসর্বমোট: ৳${o.total}\nধন্যবাদ ${CACHE.settings.tagline||''} — Avera Mart থেকে কেনাকাটার জন্য।`;
  const phone = (o.phone||'').replace(/\D/g,'');
  const url = 'https://wa.me/' + (phone?phone:'') + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
}

/* ============================================================
   USERS — অ্যাডমিন ও ম্যানেজার: লগইন তথ্য, পাসওয়ার্ড বদল ও রিসেট
   ============================================================ */
function askPassword(title, note){
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(10,20,35,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML = `<div class="panel" style="max-width:380px;width:100%;margin:0;"><h3>${esc(title)}</h3>${note ? `<p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">${esc(note)}</p>` : ''}<div class="form-field"><label>পাসওয়ার্ড</label><input type="password" id="apInput" autocomplete="current-password"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;"><button class="btn btn-outline btn-sm" id="apNo">বাতিল</button><button class="btn btn-primary btn-sm" id="apYes">নিশ্চিত করুন</button></div></div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('#apInput');
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('#apNo').onclick = () => done(null);
    ov.querySelector('#apYes').onclick = () => done(inp.value);
    inp.addEventListener('keydown', e => { if(e.key==='Enter') done(inp.value); if(e.key==='Escape') done(null); });
    setTimeout(() => inp.focus(), 50);
  });
}
async function confirmAdminPassword(note){
  if(!isAdmin()) return false;
  const p = await askPassword('অ্যাডমিন পাসওয়ার্ড দিন', note);
  if(p===null) return false;
  let ok = false;
  try{ ok = await checkPass(CACHE.users.admin, p); }catch(e){ alert(e.message || e); return false; }
  if(!ok) alert('ভুল পাসওয়ার্ড — কিছু বদলানো হয়নি।');
  return ok;
}
function genPassword(){
  const ch = 'abcdefghjkmnpqrstuvwxyz23456789', a = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(a, x => ch[x % ch.length]).join('');
}
function fillRandomPass(id){ const el = document.getElementById(id); if(el){ el.value = genPassword(); el.type = 'text'; } }
function userIdTaken(role, id){
  const other = role==='admin' ? 'manager' : 'admin', u = CACHE.users[other];
  return hasCreds(u) && normLoginId(u.loginId)===id;
}
function readIdField(elId){
  const id = normLoginId((document.getElementById(elId)||{}).value);
  if(!validLoginId(id)){ alert('সঠিক ইমেইল (যেমন name@gmail.com) অথবা ১১ সংখ্যার মোবাইল নম্বর (০১XXXXXXXXX) লিখুন।'); return null; }
  return id;
}

/* প্রথমবার সেটআপ: অ্যাডমিন (এবং চাইলে ম্যানেজার) এর ইমেইল/ফোন ও পাসওয়ার্ড */
function renderSetup(){
  currentPage = '__setup';
  document.getElementById('pageTitle').textContent = 'প্রথমবার সেটআপ';
  const eb = document.getElementById('exportBtns'); if(eb) eb.classList.add('hidden');
  document.getElementById('sideNav').innerHTML = '';
  document.getElementById('sessionInfo').textContent = 'লগইন: অ্যাডমিন (সেটআপ বাকি)';
  const f = (id, label, type, ph) => `<div class="form-field"><label>${label}</label><input id="${id}" type="${type||'text'}" placeholder="${ph||''}" autocomplete="off"></div>`;
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <h3>🔐 নতুন লগইন চালু করুন</h3>
      <p style="font-size:13.5px;">এখন থেকে পিনের বদলে <b>ইমেইল বা মোবাইল নম্বর + পাসওয়ার্ড</b> দিয়ে লগইন হবে। ব্যবহারকারী দুইজন: অ্যাডমিন ও ম্যানেজার। আপনার কোনো ডেটা (পণ্য, অর্ডার, ক্রয়, খরচ ইত্যাদি) এতে বদলাবে না।</p>
      <h4>👤 অ্যাডমিন (আপনি)</h4>
      <div class="form-grid">
        ${f('su_a_name','নাম (ঐচ্ছিক)','text','যেমন: নায়েম')}
        ${f('su_a_id','ইমেইল অথবা মোবাইল নম্বর','text','name@gmail.com অথবা 01XXXXXXXXX')}
        ${f('su_a_p1','পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)','password')}
        ${f('su_a_p2','পাসওয়ার্ড আবার লিখুন','password')}
      </div>
      <h4 style="margin-top:18px;">🧑‍💼 ম্যানেজার <span class="muted-cell" style="font-weight:400;">(ঐচ্ছিক — এখন না দিলে পরে সেটিংস থেকে দিতে পারবেন)</span></h4>
      <div class="form-grid">
        ${f('su_m_name','নাম (ঐচ্ছিক)','text')}
        ${f('su_m_id','ইমেইল অথবা মোবাইল নম্বর','text','name@gmail.com অথবা 01XXXXXXXXX')}
        <div class="form-field"><label>পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)</label><div style="display:flex;gap:6px;"><input id="su_m_p1" type="password" autocomplete="off" style="flex:1;"><button class="btn btn-outline btn-sm" type="button" onclick="fillRandomPass('su_m_p1')" title="র‍্যান্ডম পাসওয়ার্ড বানান">🎲</button></div></div>
      </div>
      <p class="error-text" id="setupMsg"></p>
      <button class="btn btn-primary" id="setupBtn" onclick="saveSetup()">✅ সংরক্ষণ করে শুরু করুন</button>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">পাসওয়ার্ড ভুলে গেলে অ্যাডমিন সেটিংস থেকে ম্যানেজারের পাসওয়ার্ড রিসেট করতে পারবেন। অ্যাডমিন নিজে ভুলে গেলে ম্যানুয়ালের "অ্যাডমিনের পাসওয়ার্ড ভুলে গেলে" অংশ দেখুন।</p>
    </div>`;
}
async function saveSetup(){
  const msg = document.getElementById('setupMsg'), btn = document.getElementById('setupBtn'), g = id => (document.getElementById(id)||{value:''}).value;
  msg.textContent = '';
  if(!needsSetup()){ go('dashboard'); return; }
  const aId = normLoginId(g('su_a_id')), p1 = g('su_a_p1'), p2 = g('su_a_p2');
  if(!validLoginId(aId)){ msg.textContent = 'অ্যাডমিনের সঠিক ইমেইল বা ১১ সংখ্যার মোবাইল নম্বর (০১XXXXXXXXX) লিখুন।'; return; }
  if(p1.length < 6){ msg.textContent = 'অ্যাডমিনের পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'; return; }
  if(p1 !== p2){ msg.textContent = 'অ্যাডমিনের দুটি পাসওয়ার্ড মিলছে না।'; return; }
  const mIdRaw = g('su_m_id').trim(), mPass = g('su_m_p1');
  let mId = '';
  if(mIdRaw || mPass){
    mId = normLoginId(mIdRaw);
    if(!validLoginId(mId)){ msg.textContent = 'ম্যানেজারের সঠিক ইমেইল বা ১১ সংখ্যার মোবাইল নম্বর লিখুন (অথবা ম্যানেজারের ঘরগুলো ফাঁকা রাখুন)।'; return; }
    if(mPass.length < 6){ msg.textContent = 'ম্যানেজারের পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'; return; }
    if(mId === aId){ msg.textContent = 'অ্যাডমিন ও ম্যানেজারের ইমেইল/ফোন আলাদা হতে হবে।'; return; }
  }
  btn.disabled = true; msg.style.color = 'var(--text-muted)'; msg.textContent = 'সংরক্ষণ হচ্ছে...';
  try{
    const users = {...CACHE.users};
    users.admin = {...(users.admin||{}), name:g('su_a_name').trim(), loginId:aId, ...(await makeCred(p1)), v:1, credAt:new Date().toISOString()};
    if(mId) users.manager = {...(users.manager||{}), name:g('su_m_name').trim(), loginId:mId, ...(await makeCred(mPass)), v:1, credAt:new Date().toISOString()};
    saveUsers(users);
    saveSession('admin');
    msg.style.color = ''; msg.textContent = '';
    alert('✅ নতুন লগইন চালু হয়েছে।\n\nএখন থেকে ইমেইল/ফোন ও পাসওয়ার্ড দিয়ে ঢুকবেন।' + (mId ? '' : '\nম্যানেজারের লগইন পরে সেটিংস → "ব্যবহারকারী ও পাসওয়ার্ড" থেকে দিন।'));
    go('dashboard');
  }catch(e){ msg.style.color = ''; msg.textContent = e.message || String(e); }
  finally{ btn.disabled = false; }
}

/* সেটিংসের "ব্যবহারকারী ও পাসওয়ার্ড" অংশ (শুধু অ্যাডমিন) */
function usersPanelHtml(){
  const a = CACHE.users.admin || {}, m = CACHE.users.manager || {};
  const mBadge = hasCreds(m) ? '<span class="badge badge-open">লগইন চালু</span>' : '<span class="badge badge-pending">লগইন তথ্য দেওয়া হয়নি</span>';
  return `
    <div class="panel" id="usersPanel">
      <h3>ব্যবহারকারী ও পাসওয়ার্ড</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">মোট দুইজন ব্যবহারকারী: অ্যাডমিন ও ম্যানেজার। ইমেইল অথবা ১১ সংখ্যার মোবাইল নম্বর (০১XXXXXXXXX) + পাসওয়ার্ড দিয়ে লগইন হয়।</p>
      <h4>👤 অ্যাডমিন (আপনি)</h4>
      <div class="form-grid">
        <div class="form-field"><label>নাম</label><input id="u_a_name" value="${esc(a.name||'')}"></div>
        <div class="form-field"><label>ইমেইল / মোবাইল নম্বর</label><input id="u_a_id" value="${esc(a.loginId||'')}"></div>
        <div class="form-field"><label>বর্তমান পাসওয়ার্ড (বদলাতে হলে বাধ্যতামূলক)</label><input id="u_a_cur" type="password" autocomplete="current-password"></div>
        <div class="form-field"><label>নতুন পাসওয়ার্ড (বদলাতে চাইলে; কমপক্ষে ৬ অক্ষর)</label><input id="u_a_new" type="password" autocomplete="new-password"></div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="saveAdminSelf()">💾 অ্যাডমিনের তথ্য সংরক্ষণ</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:18px 0;">
      <h4>🧑‍💼 ম্যানেজার ${mBadge}</h4>
      <div class="form-grid">
        <div class="form-field"><label>নাম</label><input id="u_m_name" value="${esc(m.name||'')}"></div>
        <div class="form-field"><label>ইমেইল / মোবাইল নম্বর</label><input id="u_m_id" value="${esc(m.loginId||'')}"></div>
        <div class="form-field span-2"><label>${hasCreds(m) ? '🔑 পাসওয়ার্ড রিসেট — নতুন পাসওয়ার্ড (বদলাতে না চাইলে ফাঁকা রাখুন)' : 'পাসওয়ার্ড দিন (কমপক্ষে ৬ অক্ষর)'}</label>
          <div style="display:flex;gap:6px;"><input id="u_m_new" type="password" autocomplete="new-password" style="flex:1;"><button class="btn btn-outline btn-sm" type="button" onclick="fillRandomPass('u_m_new')" title="র‍্যান্ডম পাসওয়ার্ড বানান">🎲 র‍্যান্ডম</button></div></div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="saveManager()">💾 ম্যানেজারের তথ্য সংরক্ষণ / পাসওয়ার্ড রিসেট</button>
      <div class="flash warn" style="margin-top:16px;font-size:13px;">
        <b>ম্যানেজার পাসওয়ার্ড ভুলে গেলে — অ্যাডমিন যেভাবে রিসেট করবেন:</b>
        <ol style="margin:6px 0 0;padding-left:20px;">
          <li>অ্যাডমিন হিসেবে লগইন করে <b>সেটিংস → ব্যবহারকারী ও পাসওয়ার্ড</b> খুলুন।</li>
          <li>ম্যানেজারের অংশে "নতুন পাসওয়ার্ড" ঘরে নতুন একটি পাসওয়ার্ড লিখুন (অথবা 🎲 চেপে বানিয়ে নিন)।</li>
          <li>"ম্যানেজারের তথ্য সংরক্ষণ / পাসওয়ার্ড রিসেট" চাপুন, নিজের অ্যাডমিন পাসওয়ার্ড দিয়ে নিশ্চিত করুন।</li>
          <li>নতুন পাসওয়ার্ডটি ম্যানেজারকে জানান। ম্যানেজারের পুরোনো পাসওয়ার্ড ও সব ডিভাইসের লগইন সাথে সাথে বন্ধ হয়ে যাবে; সে নতুন পাসওয়ার্ড দিয়ে ঢুকবে (চাইলে সাইডবারের "🔑 পাসওয়ার্ড বদলান" থেকে নিজের পছন্দেরটা দিতে পারবে)।</li>
        </ol>
      </div>
    </div>`;
}
async function saveAdminSelf(){
  const g = id => (document.getElementById(id)||{value:''}).value;
  const id = readIdField('u_a_id'); if(id===null) return;
  if(userIdTaken('admin', id)){ alert('এই ইমেইল/ফোন ম্যানেজারের জন্য আছে — আলাদা দিন।'); return; }
  const cur = g('u_a_cur'), np = g('u_a_new');
  if(!cur){ alert('তথ্য বদলাতে বর্তমান পাসওয়ার্ড লিখুন।'); return; }
  if(np && np.length < 6){ alert('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return; }
  try{
    if(!(await checkPass(CACHE.users.admin, cur))){ alert('বর্তমান পাসওয়ার্ড ভুল — কিছু বদলানো হয়নি।'); return; }
    const patch = {name:g('u_a_name').trim(), loginId:id};
    if(np){ Object.assign(patch, await makeCred(np), {v:Number(CACHE.users.admin.v||1)+1, credAt:new Date().toISOString()}); }
    patchUser('admin', patch);
    if(np) saveSession('admin');   // নিজের লগইন চালু থাকবে, অন্য ডিভাইসের পুরোনো লগইন বন্ধ হবে
    alert(np ? '✅ অ্যাডমিনের তথ্য ও পাসওয়ার্ড বদলানো হয়েছে।' : '✅ অ্যাডমিনের তথ্য সংরক্ষিত হয়েছে।');
    renderSettings(); renderNav();
  }catch(e){ alert(e.message || e); }
}
async function saveManager(){
  const g = id => (document.getElementById(id)||{value:''}).value;
  const m = CACHE.users.manager || {};
  const id = readIdField('u_m_id'); if(id===null) return;
  if(userIdTaken('manager', id)){ alert('এই ইমেইল/ফোন অ্যাডমিনের জন্য আছে — আলাদা দিন।'); return; }
  const np = g('u_m_new');
  if(!hasCreds(m) && !np){ alert('ম্যানেজারের জন্য পাসওয়ার্ড দিন (কমপক্ষে ৬ অক্ষর)।'); return; }
  if(np && np.length < 6){ alert('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return; }
  const idChanged = hasCreds(m) && normLoginId(m.loginId) !== id;
  if(!(await confirmAdminPassword(np ? 'ম্যানেজারের পাসওয়ার্ড রিসেট করতে নিজের অ্যাডমিন পাসওয়ার্ড দিন।' : 'ম্যানেজারের তথ্য বদলাতে নিজের অ্যাডমিন পাসওয়ার্ড দিন।'))) return;
  try{
    const patch = {name:g('u_m_name').trim(), loginId:id};
    if(np) Object.assign(patch, await makeCred(np), {v:(hasCreds(m) ? Number(m.v||1)+1 : 1), credAt:new Date().toISOString()});
    else if(idChanged) patch.v = Number(m.v||1)+1;   // ইমেইল/ফোন বদলালে পুরোনো লগইন বন্ধ
    patchUser('manager', patch);
    alert(np ? `✅ ম্যানেজারের পাসওয়ার্ড রিসেট হয়েছে।\n\nনতুন পাসওয়ার্ড: ${np}\nলগইন: ${id}\n\nএটি ম্যানেজারকে জানান। তার আগের সব লগইন বন্ধ হয়ে গেছে।` : '✅ ম্যানেজারের তথ্য সংরক্ষিত হয়েছে।');
    renderSettings();
  }catch(e){ alert(e.message || e); }
}
/* নিজের পাসওয়ার্ড বদল (অ্যাডমিন ও ম্যানেজার দুজনেই — সাইডবারের বাটন থেকে) */
function openChangePassword(){
  const s = getSession(); if(!s) return;
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
      const u = CACHE.users[s.role];
      if(!(await checkPass(u, o))){ err.textContent = 'বর্তমান পাসওয়ার্ড ভুল।'; q('cp_yes').disabled = false; return; }
      patchUser(s.role, {...(await makeCred(n)), v:Number(u.v||1)+1, credAt:new Date().toISOString()});
      saveSession(s.role);
      ov.remove(); alert('✅ পাসওয়ার্ড বদলানো হয়েছে। অন্য ডিভাইসে পুরোনো পাসওয়ার্ডের লগইন বন্ধ হয়ে যাবে।');
    }catch(e){ err.textContent = e.message || String(e); q('cp_yes').disabled = false; }
  };
  setTimeout(() => q('cp_old').focus(), 50);
}

/* ============================================================
   SETTINGS (admin only)
   ============================================================ */
function renderSettings(){
  const settings = CACHE.settings;
  const users = CACHE.users;

  function categoryChips(list, removeFn){
    return list.map(c => `
      <span class="badge" style="background:#EEF1F6;color:var(--navy);display:inline-flex;align-items:center;gap:6px;margin:3px;">
        ${esc(c)} <button class="icon-btn danger" style="padding:0;font-size:12px;" onclick="${removeFn}('${esc(c).replace(/'/g,"\\'")}')">✕</button>
      </span>`).join('') || `<span class="muted-cell">কোনো ক্যাটাগরি নেই</span>`;
  }

  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2">
      <div class="panel">
        <h3>প্রতিষ্ঠানের তথ্য</h3>
        <p style="font-size:12.5px;color:var(--text-muted);">ইনভয়েস ও অফার লিফলেটে এই তথ্য দেখানো হয়।</p>
        <div class="form-field"><label>ট্যাগলাইন</label><input id="s_tagline" value="${esc(settings.tagline||'')}"></div>
        <div class="form-field"><label>ফোন নম্বর</label><input id="s_phone" value="${esc(settings.phone||'')}" placeholder="যেমন: ০১৭XX-XXXXXX"></div>
        <div class="form-field"><label>ওয়েবসাইট</label><input id="s_web" value="${esc(settings.website||'')}" placeholder="যেমন: www.averamart.com"></div>
        <div class="form-field">
          <label>ঠিকানা</label>
          <textarea id="s_address" rows="2" style="padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${esc(settings.businessAddress)}</textarea>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="saveBusinessAddress()">সংরক্ষণ করুন</button>
      </div>
      ${qrPanelHtml()}
      ${fullReportPanelHtml()}
      <div class="panel">
        <h3>সার্ভার ব্যাকআপ (স্বয়ংক্রিয়)</h3>
        <p style="font-size:12.5px;color:var(--text-muted);">প্রতিদিন একবার সব ডেটার কপি সার্ভারের আলাদা জায়গায় জমা হয়। ৬০ দিনের দৈনিক কপি এবং প্রতি মাসের একটি কপি চিরকাল থাকে।</p>
        <p id="bkStatus" style="font-size:13px;">${bkStatusText()}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="runServerBackup(true)">☁️ এখনই ব্যাকআপ নিন</button>
          <button class="btn btn-outline btn-sm" onclick="loadServerBackups()">📂 ব্যাকআপ তালিকা / ফেরত আনুন</button>
        </div>
        <div id="bkList" style="margin-top:10px;"></div>
        <h3 style="margin-top:18px;">ডেটা ব্যবহার (প্রতিটি তথ্যের সীমা ১ MB)</h3>
        ${dataUsageHtml()}
      </div>
      ${usersPanelHtml()}
      <div class="panel">
        <h3>পণ্যের ক্যাটাগরি ম্যানেজ করুন</h3>
        <div style="margin-bottom:10px;">${categoryChips(settings.productCategories, 'removeProductCategory')}</div>
        <div style="display:flex;gap:8px;">
          <input id="s_new_pcat" placeholder="নতুন ক্যাটাগরির নাম" style="flex:1;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
          <button class="btn btn-accent btn-sm" onclick="addProductCategory()">+ যোগ করুন</button>
        </div>
      </div>
      <div class="panel">
        <h3>খরচের ক্যাটাগরি ম্যানেজ করুন</h3>
        <div style="margin-bottom:10px;">${categoryChips(settings.expenseCategories, 'removeExpenseCategory')}</div>
        <div style="display:flex;gap:8px;">
          <input id="s_new_ecat" placeholder="নতুন ক্যাটাগরির নাম" style="flex:1;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
          <button class="btn btn-accent btn-sm" onclick="addExpenseCategory()">+ যোগ করুন</button>
        </div>
      </div>
      <div class="panel">
        <h3>ডেটা ব্যাকআপ</h3>
        <p style="font-size:13px;color:var(--text-muted);">সব পণ্য, অর্ডার, ক্রয়, খরচ, বকেয়া ও রিটার্ন তথ্যের একটা কপি আপনার ফোন/কম্পিউটারে ডাউনলোড করে রাখুন — সপ্তাহে অন্তত একবার করার অভ্যাস রাখা ভালো।</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="downloadBackup()">📥 ব্যাকআপ ডাউনলোড করুন</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('restoreFileInput').click()">📤 ব্যাকআপ থেকে ডেটা ফিরিয়ে আনুন</button>
          <input type="file" id="restoreFileInput" accept=".json,application/json" class="hidden" onchange="restoreBackup(event)">
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">রিস্টোর করলে বর্তমান সব ডেটা ব্যাকআপ ফাইলের ডেটা দিয়ে প্রতিস্থাপিত হবে (লগইন তথ্য ও পাসওয়ার্ড অপরিবর্তিত থাকবে)। রিস্টোরের আগে বর্তমান ডেটার একটা ব্যাকআপ নিজে থেকেই ডাউনলোড হয়ে যাবে।</p>
      </div>
    </div>
  `;
}
function downloadBackup(){
  const backup = {
    exportedAt: new Date().toISOString(),
    products: CACHE.products, orders: CACHE.orders, purchases: CACHE.purchases,
    expenses: CACHE.expenses, returns: CACHE.returns, shareholders: CACHE.shareholders,
    contributions: CACHE.contributions, closings: CACHE.closings, investments: CACHE.investments, leaflets: CACHE.leaflets, settings: CACHE.settings
  };
  try{ localStorage.setItem('AM_lastDownload', String(Date.now())); }catch(e){}
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `averamart-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function saveBusinessAddress(){
  const settings = {...CACHE.settings};
  settings.businessAddress = document.getElementById('s_address').value.trim();
  const g = id => (document.getElementById(id)||{value:null}).value;
  if(g('s_tagline')!==null) settings.tagline = g('s_tagline').trim();
  if(g('s_phone')!==null) settings.phone = g('s_phone').trim();
  if(g('s_web')!==null) settings.website = g('s_web').trim();
  saveSettings(settings);
  alert('সংরক্ষিত হয়েছে');
}
function saveDividend(){
  const settings = {...CACHE.settings};
  settings.dividendPercent = Number(document.getElementById('s_dividend').value||0);
  saveSettings(settings);
  alert('সংরক্ষিত হয়েছে');
}
function addProductCategory(){
  const input = document.getElementById('s_new_pcat');
  const name = input.value.trim();
  if(!name) return;
  const settings = {...CACHE.settings};
  if(settings.productCategories.includes(name)){ alert('এই ক্যাটাগরি আগে থেকেই আছে'); return; }
  settings.productCategories = [...settings.productCategories, name];
  saveSettings(settings);
  renderSettings();
}
function removeProductCategory(name){
  if(!confirm(`"${name}" ক্যাটাগরিটি মুছে ফেলতে চান?`)) return;
  const settings = {...CACHE.settings};
  settings.productCategories = settings.productCategories.filter(c=>c!==name);
  saveSettings(settings);
  renderSettings();
}
function addExpenseCategory(){
  const input = document.getElementById('s_new_ecat');
  const name = input.value.trim();
  if(!name) return;
  const settings = {...CACHE.settings};
  if(settings.expenseCategories.includes(name)){ alert('এই ক্যাটাগরি আগে থেকেই আছে'); return; }
  settings.expenseCategories = [...settings.expenseCategories, name];
  saveSettings(settings);
  renderSettings();
}
function removeExpenseCategory(name){
  if(!confirm(`"${name}" ক্যাটাগরিটি মুছে ফেলতে চান?`)) return;
  const settings = {...CACHE.settings};
  settings.expenseCategories = settings.expenseCategories.filter(c=>c!==name);
  saveSettings(settings);
  renderSettings();
}


/* ============================================================
   STOCK REPORT PRINT (for physical month-end stock counting)
   ============================================================ */
function printStockReport(onlyInStock){
  const isAdmin = getSession().role==='admin';
  const priceOf = p => Number(isAdmin ? p.cost : p.retail) || 0;   // manager never sees cost price
  const priceLabel = isAdmin ? 'ক্রয়মূল্য' : 'বিক্রয়মূল্য';
  const histMonth = (currentPage==='inventory' && VIEW_MONTH!==curMonth()) ? VIEW_MONTH : null;
  let srcProducts = CACHE.products;
  if(histMonth){
    srcProducts = monthData(histMonth).rows.filter(r=>!r[10]).map(r=>{ const lp = CACHE.products.find(x=>x.id===r[0]) || {};
      return {id:r[0], name:r[1], unit:r[2], stock:r[8], cost:r[9], retail:lp.retail||0, category:lp.category||'অন্যান্য', hidden:false}; });
  }
  const list = srcProducts.filter(p => !p.hidden && (!onlyInStock || Number(p.stock) > 0))
    .slice().sort((a,b) => String(a.category).localeCompare(String(b.category),'bn') || String(a.name).localeCompare(String(b.name),'bn'));
  if(!list.length){ alert('প্রিন্ট করার মতো কোনো পণ্য নেই।'); return; }
  let body = '', lastCat = null, n = 0, grand = 0, catSum = 0;
  const flushCat = () => { if(lastCat!==null) body += `<tr class="sp-sub"><td colspan="5" style="text-align:right;">${esc(lastCat||'অন্যান্য')} — উপমোট</td><td class="sp-num">${money(catSum)}</td><td></td><td></td></tr>`; catSum = 0; };
  list.forEach(p => {
    if(p.category !== lastCat){ flushCat(); lastCat = p.category; body += `<tr class="sp-cat"><td colspan="8">${esc(p.category||'অন্যান্য')}</td></tr>`; }
    n++;
    const value = Math.round(Number(p.stock||0) * priceOf(p) * 100) / 100;
    grand += value; catSum += value;
    body += `<tr><td>${n}</td><td>${esc(p.name)}</td><td>${esc(p.unit||'কেজি')}</td><td class="sp-num">${money(priceOf(p))}</td><td class="sp-num">${fmtStock(p.stock, p)}</td><td class="sp-num">${money(value)}</td><td class="sp-blank"></td><td class="sp-blank"></td></tr>`;
  });
  flushCat();
  const d = new Date();
  const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  document.getElementById('printArea').innerHTML = `
    <div class="stock-print">
      <div class="sp-head">
        <img src="logo.jpg" alt="">
        <div><h3>Avera Mart — স্টক রিপোর্ট</h3>
        <div>${esc(CACHE.settings.businessAddress||'')}</div>
        <div>${histMonth ? 'মাস শেষের স্টক: '+monthLabel(histMonth) : 'তারিখ: '+dateStr} · ${onlyInStock?'শুধু স্টকে থাকা পণ্য':'সব চালু পণ্য'} · মোট ${list.length}টি পণ্য</div></div>
      </div>
      <table>
        <thead><tr><th>ক্র.</th><th>পণ্যের নাম</th><th>একক</th><th>${priceLabel}/একক</th><th>স্টক</th><th>মোট টাকা</th><th>ফিজিক্যাল গণনা</th><th>পার্থক্য</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr class="sp-total"><td colspan="5" style="text-align:right;">সর্বমোট স্টকের মূল্য (${priceLabel}ে)</td><td class="sp-num">${money(grand)}</td><td colspan="2"></td></tr></tfoot>
      </table>
      <div class="sp-sign"><span>গণনাকারী: ____________</span><span>যাচাইকারী: ____________</span><span>অনুমোদন: ____________</span></div>
    </div>`;
  document.body.classList.remove('thermal');
  printWhenReady();
}

/* ============================================================
   RESTORE FROM BACKUP (.json made by downloadBackup)
   ============================================================ */
function restoreBackup(event){ FORCE_SAVE = true; setTimeout(()=>{ FORCE_SAVE = false; }, 90000); return restoreBackup_(event); }
function restoreBackup_(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const data = JSON.parse(e.target.result);
      const labels = {products:'পণ্য', orders:'অর্ডার', purchases:'ক্রয়', expenses:'খরচ/আয়', returns:'রিটার্ন', shareholders:'শেয়ারহোল্ডার', contributions:'জমা', closings:'মাস ক্লোজিং', investments:'বিনিয়োগ', leaflets:'লিফলেট'};
      const keys = Object.keys(labels).filter(k => Array.isArray(data[k]));
      if(!keys.length) throw new Error('not a backup');
      const summary = keys.map(k => `${labels[k]}: ${data[k].length}টি`).join(', ');
      if(!confirm(`ব্যাকআপ ফাইলে আছে — ${summary}\n\nবর্তমান সব ডেটা এই ফাইলের ডেটা দিয়ে প্রতিস্থাপিত হবে। এগিয়ে যাবেন?\n(এখনকার ডেটার একটা ব্যাকআপ আগে নিজে থেকেই ডাউনলোড হবে)`)){ event.target.value=''; return; }
      downloadBackup();
      keys.forEach(k => saveCollection(k, data[k]));
      if(data.settings && typeof data.settings === 'object') saveSettings({...CACHE.settings, ...data.settings});
      renderSettings();
      alert('✅ ডেটা সফলভাবে ফিরিয়ে আনা হয়েছে।');
    }catch(err){
      alert('এটা সঠিক ব্যাকআপ ফাইল নয়। "ব্যাকআপ ডাউনলোড করুন" বাটন থেকে নামানো .json ফাইল সিলেক্ট করুন।');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}


/* ============================================================
   INSTALL AS APP (PWA)
   ============================================================ */
let DEFERRED_INSTALL = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
function setInstallButtons(show){
  ['installBtnLogin','installBtnSide'].forEach(id => { const b = document.getElementById(id); if(b) b.classList.toggle('hidden', !show); });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  DEFERRED_INSTALL = e;
  if(!isStandalone()) setInstallButtons(true);
});
window.addEventListener('appinstalled', () => { DEFERRED_INSTALL = null; setInstallButtons(false); });
async function installApp(){
  if(!DEFERRED_INSTALL){ alert('ব্রাউজারের মেনু (⋮) থেকে "Install app" বা "Add to Home screen" বেছে নিন।'); return; }
  DEFERRED_INSTALL.prompt();
  await DEFERRED_INSTALL.userChoice;
  DEFERRED_INSTALL = null;
  setInstallButtons(false);
}
document.addEventListener('DOMContentLoaded', () => {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isIOS && !isStandalone()){ const h = document.getElementById('iosHint'); if(h) h.classList.remove('hidden'); }
});


/* ============================================================
   APP VERSION / LAST UPDATED
   ============================================================ */
const APP_VERSION = '৫.১০';
const APP_UPDATED_FALLBACK = '2026-10-30T18:00:00+06:00';   // নতুন সংস্করণ বানালে এই তারিখ বদলান (সার্ভার Last-Modified না দিলে এটাই দেখায়, শুধু তারিখ)
function fmtUpdated(d){
  try{
    return new Intl.DateTimeFormat('bn-BD', {timeZone:'Asia/Dhaka', day:'numeric', month:'long', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true}).format(d);
  }catch(e){ return d.toLocaleString(); }
}
async function showAppVersion(){
  let when = new Date(APP_UPDATED_FALLBACK), exact = false;
  try{
    const res = await fetch('app.js', {method:'HEAD', cache:'no-store'});
    const lm = res.headers.get('Last-Modified');
    if(lm && !isNaN(new Date(lm))){ when = new Date(lm); exact = true; }   // real publish time of the deployed file
  }catch(e){ /* offline: show the built-in date */ }
  const dateOnly = d => { try{ return new Intl.DateTimeFormat('bn-BD', {timeZone:'Asia/Dhaka', day:'numeric', month:'long', year:'numeric'}).format(d); }catch(e){ return d.toLocaleDateString(); } };
  const text = `সংস্করণ ${APP_VERSION} · সর্বশেষ আপডেট: ${exact ? fmtUpdated(when) : dateOnly(when)}`;
  ['appVersionLogin','appVersionSide'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = text; });
}
async function forceRefreshApp(){
  if(!confirm('অ্যাপের সর্বশেষ সংস্করণ লোড করা হবে। চালিয়ে যাবেন?')) return;
  try{
    if('serviceWorker' in navigator){ const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); }
    if(window.caches){ const keys = await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); }
  }catch(e){}
  location.replace(location.pathname + '?v=' + Date.now());   // নতুন ঠিকানা — ব্রাউজারের জমানো কপি এড়িয়ে সরাসরি নতুন ফাইল আনে
}
document.addEventListener('DOMContentLoaded', showAppVersion);

/* ============================================================
   মোবাইল তালিকা: প্রতিটি তথ্য-সারি ছোট স্ক্রিনে কার্ড হয় (কলামের নাম data-label হিসেবে বসে)
   ============================================================ */
let RT_T = 0;
function rtApply(){
  const root = document.getElementById('pageContent'); if(!root) return;
  root.querySelectorAll('table').forEach(t => {
    if(t.closest('#invoiceBox,.no-rt')) return;
    const th = t.tHead; if(!th || !th.rows.length) return;
    const heads = [...th.rows[0].cells].map(c => c.textContent.replace(/\s+/g,' ').trim());
    t.classList.add('rt');
    [...t.tBodies].forEach(tb => [...tb.rows].forEach(r => [...r.cells].forEach((td,i) => {
      if(td.colSpan>1){ td.classList.add('rt-span'); return; }
      const h = heads[i] || ''; if(td.getAttribute('data-label')!==h) td.setAttribute('data-label', h);
    })));
  });
}
(function(){
  const root = document.getElementById('pageContent'); if(!root || typeof MutationObserver==='undefined') return;
  new MutationObserver(() => { cancelAnimationFrame(RT_T); RT_T = requestAnimationFrame(rtApply); }).observe(root, {childList:true, subtree:true});
  rtApply();
})();

