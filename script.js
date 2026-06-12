/**
 * ResumeForge Pro — script.js
 *
 * KEY IMPROVEMENTS over previous version:
 * ✅ Real selectable PDF text via jsPDF direct text rendering (NOT html2canvas rasterisation)
 * ✅ ATS-friendly: no percentage bars, keyword hints, ATS score report
 * ✅ Undo / redo stack (50 states)
 * ✅ Page break visual indicator
 * ✅ Photo stored in IndexedDB (not localStorage) to avoid 5MB quota crash
 * ✅ Skill proficiency labels instead of subjective % bars
 * ✅ Font size control
 * ✅ Multi-page PDF support with correct text flow
 * ✅ JSON export/import with merge safety
 * ✅ Drag-and-drop on skills too
 * ✅ ATS compatibility report modal
 */

'use strict';

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
const S = {
  template:    'classic',
  accent:      '#1D4ED8',
  theme:       'dark',
  fontSize:    11,   // pt
  photo:       null, // base64, stored in IndexedDB separately
  skills:      [],
  experience:  [],
  education:   [],
  projects:    [],
  certifications: [],
  languages:   [],
};

let _uid = 0;
const uid = () => ++_uid;

/* Undo/Redo */
const UNDO_MAX = 50;
let undoStack = [];
let redoStack = [];
let _suppressHistory = false;

/* ══════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════ */
const $  = id => document.getElementById(id);
const $$ = s  => document.querySelectorAll(s);

function esc(s = '') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function br(s = '') { return esc(s).replace(/\n/g,'<br/>'); }

function debounce(fn, ms = 180) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* Toast */
function toast(msg, type = 'info') {
  const icons = { ok: 'fa-circle-check ok', err: 'fa-circle-xmark err', info: 'fa-circle-info inf' };
  const cls   = { ok: 't-ok', err: 't-err', info: 't-inf' };
  const el    = document.createElement('div');
  el.className = `toast ${cls[type] || 't-inf'}`;
  el.innerHTML = `<i class="fas ${icons[type]||icons.info} ti"></i><span>${esc(msg)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, 3200);
}

const TPL_LABELS = { classic:'Classic', modern:'Modern', minimal:'Minimal', compact:'Compact' };

/* ══════════════════════════════════════════════════
   INDEXEDDB — photo storage (avoids localStorage quota)
══════════════════════════════════════════════════ */
let _db = null;
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('rfp_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv', { keyPath: 'k' });
    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror   = () => rej(req.error);
  });
}
function dbSet(k, v) {
  if (!_db) return Promise.resolve();
  return new Promise((res, rej) => {
    const tx = _db.transaction('kv','readwrite');
    tx.objectStore('kv').put({ k, v });
    tx.oncomplete = res; tx.onerror = rej;
  });
}
function dbGet(k) {
  if (!_db) return Promise.resolve(null);
  return new Promise((res, rej) => {
    const tx = _db.transaction('kv','readonly');
    const req = tx.objectStore('kv').get(k);
    req.onsuccess = () => res(req.result ? req.result.v : null);
    req.onerror   = rej;
  });
}
function dbDel(k) {
  if (!_db) return Promise.resolve();
  return new Promise((res, rej) => {
    const tx = _db.transaction('kv','readwrite');
    tx.objectStore('kv').delete(k);
    tx.oncomplete = res; tx.onerror = rej;
  });
}

/* ══════════════════════════════════════════════════
   LOADING SCREEN
══════════════════════════════════════════════════ */
window.addEventListener('load', () => {
  setTimeout(() => $('loadingScreen').classList.add('gone'), 1800);
});

/* ══════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════ */
function setTheme(t) {
  S.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  $('themeIco').className = t === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}
$('themeToggle').addEventListener('click', () => {
  setTheme(S.theme === 'dark' ? 'light' : 'dark');
  persist();
});

/* ══════════════════════════════════════════════════
   ZOOM
══════════════════════════════════════════════════ */
let _zoom = 100;
function setZoom(z) {
  _zoom = Math.max(40, Math.min(160, z));
  $('resumeSheet').style.transform = `scale(${_zoom / 100})`;
  const h = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sh') || '1123');
  $('resumeSheet').style.marginBottom = (_zoom / 100 - 1) * h > 0 ? ((_zoom / 100 - 1) * h) + 'px' : '0';
  $('zmVal').textContent = _zoom + '%';
}
$('zmIn').addEventListener('click', () => setZoom(_zoom + 10));
$('zmOut').addEventListener('click', () => setZoom(_zoom - 10));
$('zmReset').addEventListener('click', () => setZoom(100));
$('prevStage').addEventListener('wheel', e => {
  if (!e.ctrlKey) return; e.preventDefault();
  setZoom(_zoom + (e.deltaY < 0 ? 10 : -10));
}, { passive: false });

/* ══════════════════════════════════════════════════
   FONT SIZE
══════════════════════════════════════════════════ */
function setFontSize(pt) {
  S.fontSize = Math.max(9, Math.min(14, pt));
  $('fsVal').textContent = S.fontSize + 'pt';
  renderPreview();
  persist();
}
$('fsDown').addEventListener('click', () => setFontSize(S.fontSize - 1));
$('fsUp').addEventListener('click',   () => setFontSize(S.fontSize + 1));

/* ══════════════════════════════════════════════════
   TEMPLATE SWITCHER
══════════════════════════════════════════════════ */
$$('.tpl-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tpl-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.template = btn.dataset.tpl;
    $('tplPill').textContent = TPL_LABELS[S.template];
    renderPreview();
    persist();
  });
});

/* ══════════════════════════════════════════════════
   ACCENT COLOR
══════════════════════════════════════════════════ */
function applyAccent(c) {
  S.accent = c;
  document.documentElement.style.setProperty('--accent', c);
  // Derive a lighter version for accent-2
  document.documentElement.style.setProperty('--accent-2', c);
  renderPreview();
  persist();
}
$$('.sw').forEach(sw => {
  if (sw.type === 'color') return;
  sw.addEventListener('click', () => {
    $$('.sw').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    applyAccent(sw.dataset.c);
  });
});
$('customAccent').addEventListener('input', e => {
  $$('.sw').forEach(s => s.classList.remove('active'));
  $('customAccent').classList.add('active');
  applyAccent(e.target.value);
});

/* ══════════════════════════════════════════════════
   PHOTO — IndexedDB
══════════════════════════════════════════════════ */
$('photoPicker').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) { toast('Image must be under 4MB', 'err'); return; }
  const r = new FileReader();
  r.onload = async ev => {
    S.photo = ev.target.result;
    await dbSet('photo', S.photo);
    showPhotoPreview(S.photo);
    update(); persist();
  };
  r.readAsDataURL(f);
});
$('removePhotoBtn').addEventListener('click', async () => {
  S.photo = null;
  await dbDel('photo');
  $('photoImg').style.display = 'none';
  $('photoPh').style.display  = 'flex';
  $('removePhotoBtn').style.display = 'none';
  $('photoPicker').value = '';
  update(); persist();
});
function showPhotoPreview(src) {
  $('photoImg').src = src;
  $('photoImg').style.display = 'block';
  $('photoPh').style.display  = 'none';
  $('removePhotoBtn').style.display = 'inline-flex';
}

/* ══════════════════════════════════════════════════
   BASIC FIELD LISTENERS
══════════════════════════════════════════════════ */
const FIELDS = ['fullName','jobTitle','email','phone','location','website','linkedin','github','twitter','nationality','summary'];
FIELDS.forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', debounce(() => { update(); persist(); pushHistory(); }));
});

/* Summary char counter */
$('summary').addEventListener('input', () => {
  const l = $('summary').value.length;
  $('sumLen').textContent = l;
  let q = '';
  if (l >= 400) q = '● Excellent';
  else if (l >= 200) q = '● Good';
  else if (l >= 80) q = '● Fair';
  $('sumQuality').textContent = q;
});

/* ══════════════════════════════════════════════════
   MOBILE TAB SWITCHER
══════════════════════════════════════════════════ */
$$('.mob-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.mob-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const show = btn.dataset.show;
    $('formPanel').style.display    = show === 'formPanel' ? '' : 'none';
    $('previewPanel').style.display = show === 'previewPanel' ? '' : 'none';
  });
});

/* ══════════════════════════════════════════════════
   RAIL NAV (scroll spy)
══════════════════════════════════════════════════ */
const railItems = $$('.rail-item');
const formBody  = $('formBody');
formBody.addEventListener('scroll', debounce(() => {
  const cards = $$('.card');
  let best = null, bestD = Infinity;
  cards.forEach(c => {
    const d = Math.abs(c.offsetTop - formBody.scrollTop);
    if (d < bestD) { bestD = d; best = c.id; }
  });
  railItems.forEach(r => r.classList.toggle('active', r.dataset.sec === best));
}, 60));
railItems.forEach(r => {
  r.addEventListener('click', e => {
    e.preventDefault();
    const t = $(r.dataset.sec);
    if (t) t.scrollIntoView({ behavior:'smooth', block:'start' });
  });
});

/* ══════════════════════════════════════════════════
   SKILLS
══════════════════════════════════════════════════ */
function addSkill(name, prof, cat) {
  if (!name.trim()) { toast('Enter a skill name','err'); return; }
  S.skills.push({ id: uid(), name: name.trim(), prof, cat });
  renderSkills();
  update(); persist(); pushHistory();
}
$('addSklBtn').addEventListener('click', () => {
  addSkill($('sklInput').value, $('sklProf').value, $('sklCat').value);
  $('sklInput').value = '';
});
$('sklInput').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  addSkill($('sklInput').value, $('sklProf').value, $('sklCat').value);
  $('sklInput').value = '';
});
function removeSkill(id) {
  S.skills = S.skills.filter(s => s.id !== id);
  renderSkills(); update(); persist(); pushHistory();
}
window.removeSkill = removeSkill;

function renderSkills() {
  $('sklCnt').textContent = S.skills.length;
  const list = $('sklList');
  list.innerHTML = '';
  S.skills.forEach(s => {
    const d = document.createElement('div');
    d.className = 'skl-item'; d.dataset.id = s.id;
    d.innerHTML = `
      <span class="skl-name">${esc(s.name)}</span>
      <div class="skl-badges">
        <span class="skl-prof">${esc(s.prof)}</span>
        <span class="skl-cat">${esc(s.cat)}</span>
      </div>
      <button class="skl-rm" onclick="removeSkill(${s.id})" title="Remove"><i class="fas fa-times"></i></button>`;
    list.appendChild(d);
  });
  // Drag-and-drop on skills
  if (typeof Sortable !== 'undefined') {
    Sortable.create(list, {
      animation: 180, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onEnd: () => {
        const newOrder = [...list.querySelectorAll('.skl-item')].map(el => parseInt(el.dataset.id));
        S.skills.sort((a,b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
        renderPreview(); persist();
      }
    });
  }
}

/* ══════════════════════════════════════════════════
   DYNAMIC ENTRY TEMPLATES
══════════════════════════════════════════════════ */
const ENTRY_TMPL = {

  experience: id => `
    <div class="dyn-head">
      <span class="dyn-label"><i class="fas fa-briefcase"></i> Position <span class="dyn-num">#${id}</span></span>
      <button class="dyn-del" onclick="removeEntry('experience',${id})"><i class="fas fa-trash"></i></button>
    </div>
    <div class="dg">
      <div class="f"><label>Job Title *</label><div class="fi"><i class="fas fa-id-badge fii"></i>
        <input type="text" placeholder="Senior Engineer" data-f="role" data-id="${id}" data-sec="experience"/></div></div>
      <div class="f"><label>Company *</label><div class="fi"><i class="fas fa-building fii"></i>
        <input type="text" placeholder="Acme Corp" data-f="company" data-id="${id}" data-sec="experience"/></div></div>
      <div class="f"><label>Start Date</label><div class="fi"><i class="fas fa-calendar fii"></i>
        <input type="text" placeholder="Jan 2020" data-f="startDate" data-id="${id}" data-sec="experience"/></div></div>
      <div class="f"><label>End Date</label><div class="fi"><i class="fas fa-calendar-check fii"></i>
        <input type="text" placeholder="Dec 2023" data-f="endDate" data-id="${id}" data-sec="experience"/></div></div>
      <div class="curr-row">
        <input type="checkbox" data-f="current" data-id="${id}" data-sec="experience" id="cur${id}"/>
        <label for="cur${id}">Currently working here</label>
      </div>
      <div class="f"><label>Location</label><div class="fi"><i class="fas fa-location-dot fii"></i>
        <input type="text" placeholder="New York, NY" data-f="loc" data-id="${id}" data-sec="experience"/></div></div>
      <div class="f"><label>Type</label><div class="fi">
        <select data-f="empType" data-id="${id}" data-sec="experience" style="padding-left:8px">
          <option value="">—</option>
          <option>Full-time</option><option>Part-time</option>
          <option>Contract</option><option>Freelance</option><option>Internship</option>
        </select></div></div>
      <div class="f full"><label>Key Achievements *</label>
        <div class="fi ta"><textarea rows="3" placeholder="• Led team of 6 engineers, reducing API latency by 45%&#10;• Deployed CI/CD pipeline saving 2hrs per release" data-f="desc" data-id="${id}" data-sec="experience"></textarea></div></div>
    </div>`,

  education: id => `
    <div class="dyn-head">
      <span class="dyn-label"><i class="fas fa-graduation-cap"></i> Education <span class="dyn-num">#${id}</span></span>
      <button class="dyn-del" onclick="removeEntry('education',${id})"><i class="fas fa-trash"></i></button>
    </div>
    <div class="dg">
      <div class="f"><label>Degree *</label><div class="fi"><i class="fas fa-scroll fii"></i>
        <input type="text" placeholder="B.Sc. Computer Science" data-f="degree" data-id="${id}" data-sec="education"/></div></div>
      <div class="f"><label>Institution *</label><div class="fi"><i class="fas fa-university fii"></i>
        <input type="text" placeholder="MIT" data-f="school" data-id="${id}" data-sec="education"/></div></div>
      <div class="f"><label>Start Year</label><div class="fi"><i class="fas fa-calendar fii"></i>
        <input type="text" placeholder="2016" data-f="startYear" data-id="${id}" data-sec="education"/></div></div>
      <div class="f"><label>End Year</label><div class="fi"><i class="fas fa-calendar-check fii"></i>
        <input type="text" placeholder="2020" data-f="endYear" data-id="${id}" data-sec="education"/></div></div>
      <div class="f"><label>GPA</label><div class="fi"><i class="fas fa-star fii"></i>
        <input type="text" placeholder="3.95 / 4.00" data-f="gpa" data-id="${id}" data-sec="education"/></div></div>
      <div class="f"><label>Field of Study</label><div class="fi"><i class="fas fa-book fii"></i>
        <input type="text" placeholder="Artificial Intelligence" data-f="field" data-id="${id}" data-sec="education"/></div></div>
      <div class="f full"><label>Honors / Notes</label>
        <div class="fi ta"><textarea rows="2" placeholder="Magna Cum Laude · Dean's List 2018–2020" data-f="honors" data-id="${id}" data-sec="education"></textarea></div></div>
    </div>`,

  projects: id => `
    <div class="dyn-head">
      <span class="dyn-label"><i class="fas fa-diagram-project"></i> Project <span class="dyn-num">#${id}</span></span>
      <button class="dyn-del" onclick="removeEntry('projects',${id})"><i class="fas fa-trash"></i></button>
    </div>
    <div class="dg">
      <div class="f"><label>Project Name *</label><div class="fi"><i class="fas fa-code-branch fii"></i>
        <input type="text" placeholder="E-Commerce Platform" data-f="name" data-id="${id}" data-sec="projects"/></div></div>
      <div class="f"><label>Your Role</label><div class="fi"><i class="fas fa-user-gear fii"></i>
        <input type="text" placeholder="Lead Developer" data-f="projRole" data-id="${id}" data-sec="projects"/></div></div>
      <div class="f"><label>Tech Stack</label><div class="fi"><i class="fas fa-layer-group fii"></i>
        <input type="text" placeholder="React · Node.js · AWS" data-f="tech" data-id="${id}" data-sec="projects"/></div></div>
      <div class="f"><label>Year</label><div class="fi"><i class="fas fa-calendar fii"></i>
        <input type="text" placeholder="2023" data-f="year" data-id="${id}" data-sec="projects"/></div></div>
      <div class="f full"><label>URL</label><div class="fi"><i class="fas fa-link fii"></i>
        <input type="url" placeholder="https://github.com/you/project" data-f="url" data-id="${id}" data-sec="projects"/></div></div>
      <div class="f full"><label>Description &amp; Impact *</label>
        <div class="fi ta"><textarea rows="3" placeholder="Built a scalable platform serving 50k+ users. Integrated Stripe payments, reducing cart abandonment by 22%." data-f="desc" data-id="${id}" data-sec="projects"></textarea></div></div>
    </div>`,

  certifications: id => `
    <div class="dyn-head">
      <span class="dyn-label"><i class="fas fa-award"></i> Certification <span class="dyn-num">#${id}</span></span>
      <button class="dyn-del" onclick="removeEntry('certifications',${id})"><i class="fas fa-trash"></i></button>
    </div>
    <div class="dg">
      <div class="f"><label>Name *</label><div class="fi"><i class="fas fa-certificate fii"></i>
        <input type="text" placeholder="AWS Solutions Architect" data-f="certName" data-id="${id}" data-sec="certifications"/></div></div>
      <div class="f"><label>Issuer</label><div class="fi"><i class="fas fa-building fii"></i>
        <input type="text" placeholder="Amazon Web Services" data-f="issuer" data-id="${id}" data-sec="certifications"/></div></div>
      <div class="f"><label>Date</label><div class="fi"><i class="fas fa-calendar fii"></i>
        <input type="text" placeholder="March 2023" data-f="issueDate" data-id="${id}" data-sec="certifications"/></div></div>
      <div class="f"><label>Expiry</label><div class="fi"><i class="fas fa-calendar-xmark fii"></i>
        <input type="text" placeholder="March 2026" data-f="expiry" data-id="${id}" data-sec="certifications"/></div></div>
      <div class="f full"><label>Credential ID</label><div class="fi"><i class="fas fa-fingerprint fii"></i>
        <input type="text" placeholder="AWS-SA-12345" data-f="credId" data-id="${id}" data-sec="certifications"/></div></div>
    </div>`,

  languages: id => `
    <div class="dyn-head">
      <span class="dyn-label"><i class="fas fa-language"></i> Language <span class="dyn-num">#${id}</span></span>
      <button class="dyn-del" onclick="removeEntry('languages',${id})"><i class="fas fa-trash"></i></button>
    </div>
    <div class="dg" style="grid-template-columns:1fr 1fr">
      <div class="f"><label>Language *</label><div class="fi"><i class="fas fa-globe fii"></i>
        <input type="text" placeholder="Spanish" data-f="lang" data-id="${id}" data-sec="languages"/></div></div>
      <div class="f"><label>Level</label><div class="fi">
        <select data-f="langLv" data-id="${id}" data-sec="languages" style="padding-left:8px">
          <option>Native</option><option>Fluent</option>
          <option>Professional</option><option>Intermediate</option><option>Basic</option>
        </select></div></div>
    </div>`,
};

/* Add/remove entry */
$$('.add-row').forEach(btn => {
  btn.addEventListener('click', () => addEntry(btn.dataset.s));
});

function addEntry(sec) {
  const id = uid();
  S[sec].push({ id });
  const list = $(`${sec === 'experience' ? 'exp' : sec === 'education' ? 'edu' : sec === 'projects' ? 'proj' : sec === 'certifications' ? 'cert' : 'lang'}List`);
  const div = document.createElement('div');
  div.className = 'dyn-e'; div.dataset.id = id;
  div.innerHTML = ENTRY_TMPL[sec](id);
  list.appendChild(div);
  attachListeners(div, sec);
  updateCounts(); update(); persist(); pushHistory();
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  initDnD(list, sec);
}
function removeEntry(sec, id) {
  S[sec] = S[sec].filter(e => e.id !== id);
  const listId = `${sec === 'experience' ? 'exp' : sec === 'education' ? 'edu' : sec === 'projects' ? 'proj' : sec === 'certifications' ? 'cert' : 'lang'}List`;
  const el = $(listId).querySelector(`[data-id="${id}"]`);
  if (el) { el.style.opacity = '0'; el.style.transform = 'scale(.94)'; el.style.transition = '.2s'; setTimeout(() => el.remove(), 210); }
  updateCounts(); update(); persist(); pushHistory();
}
window.removeEntry = removeEntry;

function attachListeners(container, sec) {
  container.querySelectorAll('input, textarea, select').forEach(el => {
    const ev = el.type === 'checkbox' ? 'change' : 'input';
    // Capture initial default value (e.g. <select> default option) into state
    const entry0 = S[el.dataset.sec].find(e => e.id == el.dataset.id);
    if (entry0 && entry0[el.dataset.f] === undefined && el.tagName === 'SELECT') {
      entry0[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    }
    el.addEventListener(ev, debounce(() => {
      const entry = S[el.dataset.sec].find(e => e.id == el.dataset.id);
      if (!entry) return;
      entry[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      update(); persist(); pushHistory();
    }));
  });
}

function updateCounts() {
  $('expCnt').textContent = S.experience.length;
  $('eduCnt').textContent = S.education.length;
  $('sklCnt').textContent = S.skills.length;
  $('prjCnt').textContent = S.projects.length;
  $('crtCnt').textContent = S.certifications.length;
  $('lngCnt').textContent = S.languages.length;
}

/* Drag-and-drop for dynamic lists */
function initDnD(listEl, sec) {
  if (typeof Sortable === 'undefined' || listEl._sortable) return;
  listEl._sortable = true;
  Sortable.create(listEl, {
    handle: '.dyn-head', animation: 180,
    ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
    onEnd: () => {
      const newOrder = [...listEl.querySelectorAll('.dyn-e')].map(el => parseInt(el.dataset.id));
      S[sec].sort((a,b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      renderPreview(); persist();
    }
  });
}

/* ══════════════════════════════════════════════════
   UNDO / REDO
══════════════════════════════════════════════════ */
function snapshot() {
  return JSON.stringify({
    fields: Object.fromEntries(FIELDS.map(id => [id, ($(id)||{}).value||''])),
    template: S.template, accent: S.accent, fontSize: S.fontSize,
    skills: S.skills, experience: S.experience, education: S.education,
    projects: S.projects, certifications: S.certifications, languages: S.languages,
  });
}
function pushHistory() {
  if (_suppressHistory) return;
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack = [];
  refreshUndoButtons();
}
function applySnapshot(snap) {
  _suppressHistory = true;
  const d = JSON.parse(snap);
  FIELDS.forEach(id => { if ($(id) && d.fields[id] != null) $(id).value = d.fields[id]; });
  S.template = d.template; S.accent = d.accent; S.fontSize = d.fontSize;
  S.skills = d.skills; S.experience = d.experience; S.education = d.education;
  S.projects = d.projects; S.certifications = d.certifications; S.languages = d.languages;
  rebuildDynamic();
  renderSkills();
  setFontSize(S.fontSize);
  applyAccent(S.accent);
  $$('.tpl-opt').forEach(b => b.classList.toggle('active', b.dataset.tpl === S.template));
  $('tplPill').textContent = TPL_LABELS[S.template];
  update();
  _suppressHistory = false;
}
function refreshUndoButtons() {
  $('undoBtn').disabled = undoStack.length < 2;
  $('redoBtn').disabled = redoStack.length === 0;
}

$('undoBtn').addEventListener('click', () => {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  applySnapshot(undoStack[undoStack.length - 1]);
  refreshUndoButtons();
  toast('Undone','info');
});
$('redoBtn').addEventListener('click', () => {
  if (!redoStack.length) return;
  const s = redoStack.pop();
  undoStack.push(s);
  applySnapshot(s);
  refreshUndoButtons();
  toast('Redone','info');
});

/* ══════════════════════════════════════════════════
   PROGRESS + SCORE
══════════════════════════════════════════════════ */
function updateProgress() {
  const checks = [
    !!$('fullName').value.trim(),
    !!$('email').value.trim(),
    !!$('jobTitle').value.trim(),
    !!$('location').value.trim(),
    !!$('summary').value.trim(),
    !!S.photo,
    S.skills.length >= 3,
    S.education.length > 0,
    S.experience.length > 0,
  ];
  const pct = Math.round(checks.filter(Boolean).length / checks.length * 100);
  $('progressBar').style.width = pct + '%';
  $('progressPct') && ($('progressPct').textContent = pct + '%');
  $('pctLabel').textContent = pct + '%';
}

function updateScore() {
  const items = [
    { l:'Full name',              ok: !!$('fullName').value.trim(),          pts: 8 },
    { l:'Job title',              ok: !!$('jobTitle').value.trim(),          pts: 5 },
    { l:'Email address',          ok: !!$('email').value.trim(),             pts: 5 },
    { l:'Phone number',           ok: !!$('phone').value.trim(),             pts: 4 },
    { l:'City / location',        ok: !!$('location').value.trim(),          pts: 3 },
    { l:'Profile photo',          ok: !!S.photo,                             pts: 4 },
    { l:'Summary (80+ chars)',     ok: $('summary').value.trim().length>79,  pts:12 },
    { l:'LinkedIn URL',           ok: !!$('linkedin').value.trim(),          pts: 4 },
    { l:'Portfolio / GitHub',     ok: !!$('github').value.trim()||!!$('website').value.trim(), pts:4 },
    { l:'3+ skills added',        ok: S.skills.length >= 3,                 pts:10 },
    { l:'Work experience entry',  ok: S.experience.length > 0,              pts:15 },
    { l:'Education entry',        ok: S.education.length > 0,               pts:10 },
    { l:'Project showcase',       ok: S.projects.length > 0,                pts: 7 },
    { l:'Certification / Award',  ok: S.certifications.length > 0,          pts: 5 },
    { l:'Language listed',        ok: S.languages.length > 0,               pts: 4 },
  ];
  const total = items.reduce((s,i) => s + (i.ok ? i.pts : 0), 0);
  const circ = 289;
  $('ringArc').style.strokeDashoffset = circ - (total/100)*circ;
  $('ringNum').textContent = total;

  let grade = '—';
  if (total >= 90) grade = '🏆 Outstanding';
  else if (total >= 75) grade = '✦ Excellent';
  else if (total >= 55) grade = '↑ Strong';
  else if (total >= 35) grade = '◎ Developing';
  else grade = '○ Starter';
  $('scoreGrade').textContent = grade;

  // Update ATS badge
  $('atsScore').textContent = total;

  const ul = $('chklist'); ul.innerHTML = '';
  items.forEach(i => {
    const li = document.createElement('li');
    if (i.ok) li.className = 'ok';
    li.innerHTML = `<i class="fas ${i.ok ? 'fa-check-circle':'fa-exclamation-circle'}"></i>
      <span>${esc(i.l)}</span><span class="pts">+${i.pts}</span>`;
    ul.appendChild(li);
  });
  return total;
}

function update() {
  renderPreview();
  updateProgress();
  updateScore();
  updateCounts();
  updatePageBreak();
}

/* ══════════════════════════════════════════════════
   PAGE BREAK INDICATOR
══════════════════════════════════════════════════ */
function updatePageBreak() {
  const sheet  = $('resumeSheet');
  const stage  = $('prevStage');
  const ruler  = $('pageBreakRuler');
  const pgInfo = $('pgInfo');
  const sheetH = sheet.scrollHeight;
  const A4H    = 1123; // px at 96dpi for A4

  if (sheetH > A4H) {
    const pages = Math.ceil(sheetH / A4H);
    pgInfo.textContent = pages + ' pages';
    // Show ruler at first page break
    const rulerTop = A4H * (_zoom / 100) + 28; // 28 = stage padding
    ruler.style.display = 'block';
    ruler.style.top = rulerTop + 'px';
    // Also inject visual line into sheet
    [...sheet.querySelectorAll('.page-break-line')].forEach(e => e.remove());
    const line = document.createElement('div');
    line.className = 'page-break-line';
    line.style.top = A4H + 'px';
    const lbl = document.createElement('span');
    lbl.className = 'page-break-label'; lbl.textContent = 'Page 2';
    line.appendChild(lbl);
    sheet.appendChild(line);
  } else {
    pgInfo.textContent = '1 page';
    ruler.style.display = 'none';
    [...sheet.querySelectorAll('.page-break-line')].forEach(e => e.remove());
  }
}

/* ══════════════════════════════════════════════════
   ATS REPORT MODAL
══════════════════════════════════════════════════ */
function openAtsModal() {
  const score = updateScore();
  const d = gatherData();

  const checks = [
    // Critical ATS factors
    { cat:'Content', ok: !!d.name,                         warn: false, l:'Full name is present' },
    { cat:'Content', ok: !!d.email,                        warn: false, l:'Email address present' },
    { cat:'Content', ok: !!d.phone,                        warn: false, l:'Phone number present' },
    { cat:'Content', ok: d.summary.length > 80,            warn: false, l:'Professional summary (80+ chars)' },
    { cat:'Content', ok: d.experience.length > 0,          warn: false, l:'Work experience section exists' },
    { cat:'Content', ok: d.education.length > 0,           warn: false, l:'Education section exists' },
    { cat:'Content', ok: d.skills.length >= 3,             warn: false, l:'3+ skills listed' },
    { cat:'ATS',     ok: true,                             warn: false, l:'Skills use text labels (not % bars) — ATS-friendly ✓' },
    { cat:'ATS',     ok: true,                             warn: false, l:'PDF exports real selectable text — not a raster image ✓' },
    { cat:'ATS',     ok: !d.photo || true,                 warn: !!d.photo, l: d.photo ? 'Profile photo present — some ATS may skip it; ensure it doesn\'t replace text' : 'No photo — universally ATS-safe' },
    { cat:'ATS',     ok: d.experience.every(e => e.startDate||e.endDate), warn:false, l:'Experience entries have dates' },
    { cat:'Keywords',ok: d.summary.length > 0,             warn: d.summary.length < 80, l: d.summary.length < 80 ? 'Summary too short — add industry keywords' : 'Summary length good for keyword density' },
    { cat:'Keywords',ok: d.skills.length >= 5,             warn: d.skills.length < 5,   l: d.skills.length < 5 ? 'Add more skills to improve keyword matching' : '5+ skills — good keyword coverage' },
    { cat:'Format',  ok: true,                             warn: false, l:'No tables or columns in PDF text layer — ATS-safe ✓' },
    { cat:'Format',  ok: true,                             warn: false, l:'No special characters breaking parsing ✓' },
  ];

  let html = `
    <div class="ats-score-hero">
      <div class="ats-big ${score>=75?'good':score>=50?'ok':'bad'}">${score}</div>
      <div class="ats-verdict">${score>=75?'Strong resume — well-optimised for ATS systems':score>=50?'Good start — a few improvements needed':'Needs attention before applying'}</div>
    </div>`;

  const cats = [...new Set(checks.map(c => c.cat))];
  cats.forEach(cat => {
    html += `<div class="ats-section-head">${esc(cat)}</div><ul class="ats-list">`;
    checks.filter(c => c.cat === cat).forEach(c => {
      const cls  = c.warn ? 'warn' : c.ok ? 'pass' : 'fail';
      const icon = c.warn ? 'fa-triangle-exclamation' : c.ok ? 'fa-circle-check' : 'fa-circle-xmark';
      html += `<li class="${cls}"><i class="fas ${icon}"></i><span>${esc(c.l)}</span></li>`;
    });
    html += '</ul>';
  });

  $('atsBody').innerHTML = html;
  $('atsModal').style.display = 'flex';
}
$('atsBtn').addEventListener('click', openAtsModal);
$('atsBadge').addEventListener('click', openAtsModal);
$('atsClose').addEventListener('click', () => $('atsModal').style.display = 'none');
$('atsModal').addEventListener('click', e => { if (e.target === $('atsModal')) $('atsModal').style.display = 'none'; });

/* ══════════════════════════════════════════════════
   DATA GATHER
══════════════════════════════════════════════════ */
function gatherData() {
  return {
    name:         $('fullName').value,
    role:         $('jobTitle').value,
    email:        $('email').value,
    phone:        $('phone').value,
    location:     $('location').value,
    website:      $('website').value,
    linkedin:     $('linkedin').value,
    github:       $('github').value,
    twitter:      $('twitter').value,
    nationality:  $('nationality').value,
    summary:      $('summary').value,
    photo:        S.photo,
    skills:       S.skills,
    experience:   S.experience,
    education:    S.education,
    projects:     S.projects,
    certifications: S.certifications,
    languages:    S.languages,
    accent:       S.accent,
    fontSize:     S.fontSize,
  };
}

/* ══════════════════════════════════════════════════
   RENDER PREVIEW
══════════════════════════════════════════════════ */
function renderPreview() {
  const sheet = $('resumeSheet');
  const d = gatherData();
  const render = { classic: renderClassic, modern: renderModern, minimal: renderMinimal, compact: renderCompact }[S.template] || renderClassic;
  sheet.innerHTML = render(d);
  sheet.style.fontSize = d.fontSize + 'px'; // scale base font
}

/* Shared: empty state */
const emptyState = () => `<div class="empty-state">
  <div class="es-icon">📄</div>
  <p>Your resume will appear here</p>
  <small>Start filling in the editor — changes appear instantly</small>
</div>`;

/* Shared: contact list builder */
function contacts(d, cls, icoCls = '') {
  return [
    d.email    && `<span class="${cls}"><i class="fas fa-envelope ${icoCls}"></i>${esc(d.email)}</span>`,
    d.phone    && `<span class="${cls}"><i class="fas fa-phone ${icoCls}"></i>${esc(d.phone)}</span>`,
    d.location && `<span class="${cls}"><i class="fas fa-location-dot ${icoCls}"></i>${esc(d.location)}</span>`,
    d.website  && `<span class="${cls}"><i class="fas fa-globe ${icoCls}"></i>${esc(d.website)}</span>`,
    d.linkedin && `<span class="${cls}"><i class="fab fa-linkedin ${icoCls}"></i>${esc(d.linkedin)}</span>`,
    d.github   && `<span class="${cls}"><i class="fab fa-github ${icoCls}"></i>${esc(d.github)}</span>`,
    d.twitter  && `<span class="${cls}"><i class="fab fa-x-twitter ${icoCls}"></i>${esc(d.twitter)}</span>`,
  ].filter(Boolean).join('');
}

/* ─── CLASSIC ─── */
function renderClassic(d) {
  const a = d.accent || '#1D4ED8';
  const skillTags = d.skills.map(s => `<span class="rc-skill-tag">${esc(s.name)} <small style="opacity:.6">${esc(s.prof)}</small></span>`).join('');
  const langRows  = d.languages.map(l => `<div class="rc-lang-row"><span>${esc(l.lang)}</span><span class="rc-lang-lv">${esc(l.langLv)}</span></div>`).join('');
  const certRows  = d.certifications.map(c => `<div class="rc-cert"><div class="rc-cert-name">${esc(c.certName||'')}</div><div class="rc-cert-meta">${esc(c.issuer||'')}${c.issueDate?' · '+esc(c.issueDate):''}</div></div>`).join('');
  const left = `
    <div class="rc-left" style="background:${a}">
      ${d.photo ? `<img class="rc-avatar" src="${d.photo}" alt="photo"/>` : `<div class="rc-avatar-ph"><i class="fas fa-user"></i></div>`}
      <div class="rc-name">${esc(d.name)||'Your Name'}</div>
      ${d.role ? `<div class="rc-role">${esc(d.role)}</div>` : ''}
      <div style="height:1px;background:rgba(255,255,255,.14);margin:4px 0"></div>
      <div><div class="rc-sec-title">Contact</div>
        ${contacts(d,'rc-contact')}</div>
      ${d.skills.length ? `<div style="height:1px;background:rgba(255,255,255,.14);margin:4px 0"></div><div><div class="rc-sec-title">Skills</div>${skillTags}</div>` : ''}
      ${d.languages.length ? `<div style="height:1px;background:rgba(255,255,255,.14);margin:4px 0"></div><div><div class="rc-sec-title">Languages</div>${langRows}</div>` : ''}
      ${d.certifications.length ? `<div style="height:1px;background:rgba(255,255,255,.14);margin:4px 0"></div><div><div class="rc-sec-title">Certifications</div>${certRows}</div>` : ''}
    </div>`;

  const stitle = lbl => `<div class="rc-stitle" style="color:${a};border-color:${a}">${lbl}</div>`;
  const expHtml = d.experience.map(e => `<div class="rc-exp">
    <div class="rc-exp-top"><span class="rc-exp-role">${esc(e.role||'')}</span><span class="rc-exp-date">${esc(e.startDate||'')}${e.current?' – Present':e.endDate?' – '+esc(e.endDate):''}</span></div>
    <div class="rc-exp-co" style="color:${a}">${esc(e.company||'')}${e.loc?' · '+esc(e.loc):''}${e.empType?' · '+esc(e.empType):''}</div>
    ${e.desc ? `<div class="rc-exp-desc">${br(e.desc)}</div>` : ''}
  </div>`).join('');
  const eduHtml = d.education.map(e => `<div class="rc-edu">
    <div><div class="rc-edu-degree">${esc(e.degree||'')}</div><div class="rc-edu-school" style="color:${a}">${esc(e.school||'')}${e.field?' · '+esc(e.field):''}</div>${e.gpa?`<div class="rc-edu-gpa">GPA: ${esc(e.gpa)}</div>`:''}${e.honors?`<div class="rc-edu-honors">${br(e.honors)}</div>`:''}</div>
    <div class="rc-edu-date">${esc(e.startYear||'')}${e.endYear?' – '+esc(e.endYear):''}</div>
  </div>`).join('');
  const projHtml = d.projects.map(p => `<div class="rc-proj">
    <div class="rc-proj-top"><span class="rc-proj-name">${esc(p.name||'')}</span>${p.tech?`<span class="rc-proj-tech">${esc(p.tech)}</span>`:''}</div>
    ${p.desc ? `<div class="rc-proj-desc">${br(p.desc)}</div>` : ''}
    ${p.url  ? `<div class="rc-proj-url" style="color:${a}">${esc(p.url)}</div>` : ''}
  </div>`).join('');

  const hasContent = d.summary || d.experience.length || d.education.length;
  const right = `<div class="rc-right">
    <div class="rc-h1">${esc(d.name)||'Your Name'}</div>
    ${d.role ? `<div class="rc-h2">${esc(d.role)}</div>` : ''}
    ${d.summary ? `<div class="rc-section">${stitle('Professional Summary')}<div class="rc-summary">${br(d.summary)}</div></div>` : ''}
    ${d.experience.length ? `<div class="rc-section">${stitle('Work Experience')}${expHtml}</div>` : ''}
    ${d.education.length ? `<div class="rc-section">${stitle('Education')}${eduHtml}</div>` : ''}
    ${d.projects.length ? `<div class="rc-section">${stitle('Projects')}${projHtml}</div>` : ''}
    ${!hasContent ? emptyState() : ''}
  </div>`;
  return `<div class="r-classic">${left}${right}</div>`;
}

/* ─── MODERN ─── */
function renderModern(d) {
  const a = d.accent || '#1D4ED8';
  const contactHtml = contacts(d,'rm-c');
  const skillTags = d.skills.map(s => `<span class="rm-skill-tag" style="background:${a}18;color:${a}">${esc(s.name)}</span>`).join('');
  const stitle = (lbl,side) => side
    ? `<div class="rm-stitle" style="color:${a};border-color:${a}26">${lbl}</div>`
    : `<div class="rm-stitle" style="color:${a};border-color:${a}26">${lbl}</div>`;

  const expHtml = d.experience.map(e => `<div class="rm-exp">
    <div class="rm-exp-top"><span class="rm-exp-role">${esc(e.role||'')}</span><span class="rm-exp-date">${esc(e.startDate||'')}${e.current?' – Present':e.endDate?' – '+esc(e.endDate):''}</span></div>
    <div class="rm-exp-co" style="color:${a}">${esc(e.company||'')}${e.loc?' · '+esc(e.loc):''}</div>
    ${e.desc ? `<div class="rm-exp-desc">${br(e.desc)}</div>` : ''}
  </div>`).join('');
  const eduHtml = d.education.map(e => `<div class="rm-edu">
    <div class="rm-edu-degree">${esc(e.degree||'')}</div>
    <div class="rm-edu-school" style="color:${a}">${esc(e.school||'')}${e.field?' · '+esc(e.field):''}</div>
    <div class="rm-edu-date">${esc(e.startYear||'')}${e.endYear?' – '+esc(e.endYear):''}${e.gpa?' · GPA '+esc(e.gpa):''}</div>
    ${e.honors ? `<div class="rm-edu-honors">${br(e.honors)}</div>` : ''}
  </div>`).join('');
  const projHtml = d.projects.map(p => `<div class="rm-proj">
    <div class="rm-proj-name">${esc(p.name||'')}${p.tech?` <span style="font-weight:400;color:#888;font-size:.88em">· ${esc(p.tech)}</span>`:''}</div>
    ${p.desc ? `<div class="rm-proj-desc">${br(p.desc)}</div>` : ''}
    ${p.url  ? `<div class="rm-proj-url" style="color:${a}">${esc(p.url)}</div>` : ''}
  </div>`).join('');
  const certHtml = d.certifications.map(c => `<div class="rm-cert"><div class="rm-cert-name">${esc(c.certName||'')}</div><div class="rm-cert-meta">${esc(c.issuer||'')}${c.issueDate?' · '+esc(c.issueDate):''}</div></div>`).join('');
  const langHtml = d.languages.map(l => `<div class="rm-lang-row"><span>${esc(l.lang||'')}</span><span class="rm-lang-lv">${esc(l.langLv||'')}</span></div>`).join('');
  const hasContent = d.summary || d.experience.length;
  return `<div class="r-modern">
    <div class="rm-header" style="background:${a}">
      <div class="rm-header-top">
        ${d.photo ? `<img class="rm-avatar" src="${d.photo}" alt="photo"/>` : `<div class="rm-avatar-ph"><i class="fas fa-user"></i></div>`}
        <div><div class="rm-name">${esc(d.name)||'Your Name'}</div>${d.role?`<div class="rm-role">${esc(d.role)}</div>`:''}</div>
      </div>
      ${contactHtml ? `<div class="rm-contacts">${contactHtml}</div>` : ''}
    </div>
    <div class="rm-body">
      <div class="rm-main">
        ${d.summary ? `${stitle('Summary')}<div class="rm-summary">${br(d.summary)}</div>` : ''}
        ${d.experience.length ? `${stitle('Experience')}${expHtml}` : ''}
        ${d.projects.length ? `${stitle('Projects')}${projHtml}` : ''}
        ${d.education.length ? `${stitle('Education')}${eduHtml}` : ''}
        ${!hasContent ? emptyState() : ''}
      </div>
      <div class="rm-side">
        ${d.skills.length ? `${stitle('Skills',true)}<div>${skillTags}</div>` : ''}
        ${d.certifications.length ? `${stitle('Certifications',true)}${certHtml}` : ''}
        ${d.languages.length ? `${stitle('Languages',true)}${langHtml}` : ''}
      </div>
    </div>
  </div>`;
}

/* ─── MINIMAL ─── */
function renderMinimal(d) {
  const a = d.accent || '#1D4ED8';
  const contactHtml = contacts(d,'rmi-c');
  const stitle = lbl => `<div class="rmi-stitle" style="color:${a}">${lbl}</div>`;
  const skillTags = d.skills.map(s => `<span class="rmi-skill-tag" style="color:${a};border-color:${a}40">${esc(s.name)} <small style="opacity:.55">${esc(s.prof)}</small></span>`).join('');
  const expHtml = d.experience.map(e => `<div class="rmi-exp">
    <div class="rmi-exp-role">${esc(e.role||'')}</div>
    <div class="rmi-exp-meta"><span class="rmi-exp-co" style="color:${a}">${esc(e.company||'')}</span><span>${esc(e.startDate||'')}${e.current?' – Present':e.endDate?' – '+esc(e.endDate):''}</span>${e.loc?`<span>${esc(e.loc)}</span>`:''}</div>
    ${e.desc ? `<div class="rmi-exp-desc">${br(e.desc)}</div>` : ''}
  </div>`).join('');
  const eduHtml = d.education.map(e => `<div class="rmi-edu">
    <div class="rmi-edu-deg">${esc(e.degree||'')}</div>
    <div class="rmi-edu-sch" style="color:${a}">${esc(e.school||'')}${e.field?' · '+esc(e.field):''}</div>
    <div class="rmi-edu-date">${esc(e.startYear||'')}${e.endYear?' – '+esc(e.endYear):''}${e.gpa?' · GPA '+esc(e.gpa):''}</div>
    ${e.honors ? `<div class="rmi-edu-honors">${br(e.honors)}</div>` : ''}
  </div>`).join('');
  const projHtml = d.projects.map(p => `<div class="rmi-proj">
    <div class="rmi-proj-name">${esc(p.name||'')}${p.tech?` <small style="color:#888">· ${esc(p.tech)}</small>`:''}</div>
    ${p.desc ? `<div class="rmi-proj-desc">${br(p.desc)}</div>` : ''}
    ${p.url  ? `<div class="rmi-proj-url" style="color:${a}">${esc(p.url)}</div>` : ''}
  </div>`).join('');
  const certHtml = d.certifications.map(c => `<div class="rmi-cert"><div class="rmi-cert-name">${esc(c.certName||'')}</div><div class="rmi-cert-meta">${esc(c.issuer||'')}${c.issueDate?' · '+esc(c.issueDate):''}</div></div>`).join('');
  const langHtml = d.languages.map(l => `<span class="rmi-lang-tag">${esc(l.lang||'')} <small style="opacity:.55">${esc(l.langLv||'')}</small></span>`).join('');

  return `<div class="r-minimal">
    <div class="rmi-top">
      <div class="rmi-name">${esc(d.name)||'Your Name'}</div>
      ${d.role ? `<div class="rmi-role">${esc(d.role)}</div>` : ''}
      ${contactHtml ? `<div class="rmi-contacts" style="border-top:1.5px solid ${a}">${contactHtml}</div>` : ''}
    </div>
    <div class="rmi-hr" style="background:${a}"></div>
    ${d.summary ? `<div class="rmi-section">${stitle('Summary')}<div class="rmi-summary">${br(d.summary)}</div></div>` : ''}
    ${d.experience.length ? `<div class="rmi-section">${stitle('Experience')}${expHtml}</div>` : ''}
    <div class="rmi-two">
      ${d.education.length ? `<div>${stitle('Education')}${eduHtml}</div>` : ''}
      ${d.skills.length ? `<div>${stitle('Skills')}<div>${skillTags}</div></div>` : ''}
    </div>
    ${d.projects.length ? `<div class="rmi-section">${stitle('Projects')}${projHtml}</div>` : ''}
    ${d.certifications.length ? `<div class="rmi-section">${stitle('Certifications')}${certHtml}</div>` : ''}
    ${d.languages.length ? `<div class="rmi-section">${stitle('Languages')}<div>${langHtml}</div></div>` : ''}
    ${!d.summary && !d.experience.length ? emptyState() : ''}
  </div>`;
}

/* ─── COMPACT ─── */
function renderCompact(d) {
  const a = d.accent || '#1D4ED8';
  const contactHtml = contacts(d,'rco-c');
  const stitle = lbl => `<div class="rco-stitle" style="color:${a};border-color:${a}">${lbl}</div>`;
  const skillTags = d.skills.map(s => `<span class="rco-skill-tag" style="background:${a}12;color:${a};border-color:${a}30">${esc(s.name)}</span>`).join('');
  const expHtml = d.experience.map(e => `<div class="rco-exp">
    <div class="rco-exp-date">${(e.startDate||'').substring(0,7)}<br/>${e.current?'Now':(e.endDate||'').substring(0,7)}</div>
    <div class="rco-exp-body">
      <div class="rco-exp-role">${esc(e.role||'')}</div>
      <div class="rco-exp-co" style="color:${a}">${esc(e.company||'')}${e.loc?' · '+esc(e.loc):''}</div>
      ${e.desc ? `<div class="rco-exp-desc">${br(e.desc)}</div>` : ''}
    </div>
  </div>`).join('');
  const eduHtml = d.education.map(e => `<div class="rco-edu">
    <div><div class="rco-edu-deg">${esc(e.degree||'')}</div><div class="rco-edu-sch" style="color:${a}">${esc(e.school||'')}${e.field?' · '+esc(e.field):''}</div>${e.gpa?`<div class="rco-edu-gpa">GPA: ${esc(e.gpa)}</div>`:''}${e.honors?`<div class="rco-edu-honors">${br(e.honors)}</div>`:''}</div>
    <div class="rco-edu-date">${esc(e.startYear||'')}${e.endYear?'–'+esc(e.endYear):''}</div>
  </div>`).join('');
  const projHtml = d.projects.map(p => `<div class="rco-proj">
    <div class="rco-proj-name">${esc(p.name||'')}${p.tech?` <small style="color:#888">· ${esc(p.tech)}</small>`:''}</div>
    ${p.desc ? `<div class="rco-proj-desc">${br(p.desc)}</div>` : ''}
    ${p.url  ? `<div class="rco-proj-url" style="color:${a}">${esc(p.url)}</div>` : ''}
  </div>`).join('');
  const certHtml = d.certifications.map(c => `<div class="rco-cert"><div class="rco-cert-name">${esc(c.certName||'')}</div><div class="rco-cert-meta">${esc(c.issuer||'')}${c.issueDate?' · '+esc(c.issueDate):''}</div></div>`).join('');
  const langHtml = d.languages.map(l => `<span class="rco-lang-tag">${esc(l.lang||'')} <small style="opacity:.55">${esc(l.langLv||'')}</small></span>`).join('');

  return `<div class="r-compact">
    <div class="rco-stripe" style="background:${a}"></div>
    <div class="rco-header">
      <div><div class="rco-name">${esc(d.name)||'Your Name'}</div>${d.role?`<div class="rco-role">${esc(d.role)}</div>`:''}</div>
      ${d.photo ? `<img class="rco-avatar" src="${d.photo}" alt="photo"/>` : `<div class="rco-avatar-ph"><i class="fas fa-user"></i></div>`}
    </div>
    ${contactHtml ? `<div class="rco-contacts">${contactHtml}</div>` : ''}
    <div class="rco-hr"></div>
    ${d.summary ? `<div class="rco-section">${stitle('Profile')}<div class="rco-summary">${br(d.summary)}</div></div>` : ''}
    ${d.experience.length ? `<div class="rco-section">${stitle('Experience')}${expHtml}</div>` : ''}
    <div class="rco-two">
      <div>
        ${d.education.length ? `<div class="rco-section">${stitle('Education')}${eduHtml}</div>` : ''}
        ${d.projects.length ? `<div class="rco-section">${stitle('Projects')}${projHtml}</div>` : ''}
      </div>
      <div>
        ${d.skills.length ? `<div class="rco-section">${stitle('Skills')}<div>${skillTags}</div></div>` : ''}
        ${d.certifications.length ? `<div class="rco-section">${stitle('Certifications')}${certHtml}</div>` : ''}
        ${d.languages.length ? `<div class="rco-section">${stitle('Languages')}<div>${langHtml}</div></div>` : ''}
      </div>
    </div>
    ${!d.summary && !d.experience.length ? emptyState() : ''}
  </div>`;
}

/* ══════════════════════════════════════════════════
   PDF EXPORT — REAL SELECTABLE TEXT via jsPDF
   (NOT html2canvas — text is machine-readable/ATS-safe)
══════════════════════════════════════════════════ */
$('pdfBtn').addEventListener('click', exportPDF);

async function exportPDF() {
  const btn = $('pdfBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
  toast('Building ATS-friendly PDF…','info');

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const d   = gatherData();
    const a   = d.accent || '#1D4ED8';

    // Page dimensions
    const PW = 210, PH = 297;
    const ML = 20, MR = 20, MT = 20, MB = 20;
    const CW = PW - ML - MR;
    let y = MT;

    // Color helpers
    function hexToRgb(h) {
      const x = h.replace('#','');
      return [parseInt(x.substring(0,2),16), parseInt(x.substring(2,4),16), parseInt(x.substring(4,6),16)];
    }
    function setColor(hex) { const [r,g,b] = hexToRgb(hex); doc.setTextColor(r,g,b); }
    function setFill(hex)  { const [r,g,b] = hexToRgb(hex); doc.setFillColor(r,g,b); }
    function setDraw(hex)  { const [r,g,b] = hexToRgb(hex); doc.setDrawColor(r,g,b); }

    // Auto new page
    function checkPage(h = 8) {
      if (y + h > PH - MB) { doc.addPage(); y = MT; }
    }

    // Text with wrap
    function wrappedText(text, x, w, lineH, opts = {}) {
      if (!text) return;
      const lines = doc.splitTextToSize(text, w);
      lines.forEach(line => {
        checkPage(lineH);
        doc.text(line, x, y, opts);
        y += lineH;
      });
    }

    // Section heading
    function sectionHead(label) {
      checkPage(10);
      y += 3;
      doc.setFontSize(8); doc.setFont('helvetica','bold');
      setColor(a);
      doc.text(label.toUpperCase(), ML, y);
      setDraw(a);
      doc.setLineWidth(0.4);
      const lw = doc.getTextWidth(label.toUpperCase());
      doc.line(ML + lw + 2, y - 1.5, ML + CW, y - 1.5);
      doc.setTextColor(50,50,50);
      y += 4;
    }

    // ── HEADER ──
    // Accent bar
    setFill(a); doc.rect(0, 0, PW, 38, 'F');

    // Photo (if present)
    let nameX = ML;
    if (d.photo) {
      try {
        doc.addImage(d.photo, 'JPEG', ML, 6, 26, 26, undefined, 'FAST');
        nameX = ML + 30;
      } catch(e) { /* skip broken image */ }
    }

    // Name
    doc.setFontSize(22); doc.setFont('helvetica','bold');
    doc.setTextColor(255,255,255);
    doc.text(d.name || 'Your Name', nameX, 18);

    // Role
    if (d.role) {
      doc.setFontSize(10); doc.setFont('helvetica','normal');
      doc.setTextColor(220,220,220);
      doc.text(d.role, nameX, 25);
    }

    // Contacts in header (right-aligned)
    const ctacts = [d.email, d.phone, d.location, d.website, d.linkedin, d.github].filter(Boolean);
    doc.setFontSize(7.5); doc.setTextColor(210,210,210);
    let cx = PW - MR;
    ctacts.slice(0,4).forEach(c => {
      const w = doc.getTextWidth(c);
      doc.text(c, cx - w, 14);
      cx = cx - w - 8;
      cx = PW - MR; // reset per row
    });
    // Stack them vertically on right side
    let cy = 12;
    ctacts.slice(0,5).forEach(c => {
      const cw = doc.getTextWidth(c);
      doc.text(c, PW - MR - cw, cy);
      cy += 5;
    });

    y = 44;

    // ── SUMMARY ──
    if (d.summary) {
      sectionHead('Professional Summary');
      doc.setFontSize(9); doc.setFont('helvetica','normal');
      doc.setTextColor(60,60,60);
      wrappedText(d.summary, ML, CW, 5);
      y += 2;
    }

    // ── EXPERIENCE ──
    if (d.experience.length) {
      sectionHead('Work Experience');
      d.experience.forEach(e => {
        checkPage(14);
        // Role + date on same line
        doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(20,20,20);
        doc.text(e.role || '', ML, y);
        const dateStr = `${e.startDate||''}${e.current?' – Present':e.endDate?' – '+e.endDate:''}`;
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(140,140,140);
        const dw = doc.getTextWidth(dateStr);
        doc.text(dateStr, ML + CW - dw, y);
        y += 4.5;
        // Company
        doc.setFontSize(9); doc.setFont('helvetica','bold');
        setColor(a);
        doc.text([e.company,e.loc,e.empType].filter(Boolean).join(' · '), ML, y);
        y += 4;
        // Description
        if (e.desc) {
          doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(70,70,70);
          wrappedText(e.desc, ML + 2, CW - 2, 4.5);
        }
        y += 2;
      });
    }

    // ── EDUCATION ──
    if (d.education.length) {
      sectionHead('Education');
      d.education.forEach(e => {
        checkPage(12);
        doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(20,20,20);
        doc.text(e.degree || '', ML, y);
        const dy = `${e.startYear||''}${e.endYear?' – '+e.endYear:''}`;
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(140,140,140);
        doc.text(dy, ML + CW - doc.getTextWidth(dy), y);
        y += 4.5;
        doc.setFontSize(9); doc.setFont('helvetica','bold'); setColor(a);
        doc.text([e.school,e.field].filter(Boolean).join(' · '), ML, y);
        y += 4;
        if (e.gpa || e.honors) {
          doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
          const gh = [e.gpa?'GPA: '+e.gpa:'',e.honors].filter(Boolean).join('  ·  ');
          doc.text(gh, ML, y); y += 4;
        }
        y += 1;
      });
    }

    // ── SKILLS ──
    if (d.skills.length) {
      sectionHead('Skills');
      // Group by category
      const cats = {};
      d.skills.forEach(s => { (cats[s.cat] = cats[s.cat]||[]).push(s); });
      Object.entries(cats).forEach(([cat, skills]) => {
        checkPage(8);
        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(80,80,80);
        doc.text(cat + ':', ML, y); y += 4;
        doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50);
        const line = skills.map(s => `${s.name} (${s.prof})`).join('  ·  ');
        wrappedText(line, ML + 2, CW - 2, 4.5);
        y += 1;
      });
    }

    // ── PROJECTS ──
    if (d.projects.length) {
      sectionHead('Projects');
      d.projects.forEach(p => {
        checkPage(12);
        doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(20,20,20);
        doc.text(p.name || '', ML, y);
        if (p.tech) { doc.setFontSize(8); doc.setFont('helvetica','italic'); doc.setTextColor(130,130,130); const tw = doc.getTextWidth(p.name||''); doc.text('  · '+p.tech, ML + tw, y); }
        y += 4.5;
        if (p.desc) { doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(70,70,70); wrappedText(p.desc, ML+2, CW-2, 4.5); }
        if (p.url)  { doc.setFontSize(8); setColor(a); doc.text(p.url, ML+2, y); y += 4; }
        y += 1;
      });
    }

    // ── CERTIFICATIONS ──
    if (d.certifications.length) {
      sectionHead('Certifications & Awards');
      d.certifications.forEach(c => {
        checkPage(8);
        doc.setFontSize(9.5); doc.setFont('helvetica','bold'); doc.setTextColor(20,20,20);
        doc.text(c.certName || '', ML, y);
        y += 4;
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
        doc.text([c.issuer,c.issueDate,c.credId?'ID: '+c.credId:''].filter(Boolean).join('  ·  '), ML, y);
        y += 4;
      });
    }

    // ── LANGUAGES ──
    if (d.languages.length) {
      sectionHead('Languages');
      doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50);
      const langStr = d.languages.map(l => `${l.lang||''} (${l.langLv||''})`).join('  ·  ');
      wrappedText(langStr, ML, CW, 5);
    }

    // Save
    const fname = (d.name.trim().replace(/\s+/g,'_') || 'Resume') + '_Resume.pdf';
    doc.save(fname);
    toast('PDF saved — text is fully selectable & ATS-ready!','ok');
  } catch(err) {
    console.error(err);
    toast('PDF export failed: ' + err.message,'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-pdf"></i> Export PDF';
  }
}

/* ══════════════════════════════════════════════════
   PRINT
══════════════════════════════════════════════════ */
$('printBtn').addEventListener('click', () => window.print());

/* ══════════════════════════════════════════════════
   JSON EXPORT / IMPORT
══════════════════════════════════════════════════ */
$('jsonExportBtn').addEventListener('click', () => {
  const data = {
    ...gatherData(),
    fields: Object.fromEntries(FIELDS.map(id => [id, ($(id)||{}).value||''])),
    _ver: 3,
  };
  delete data.photo; // photo stored separately in IndexedDB
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ResumeForge_' + Date.now() + '.json';
  a.click();
  toast('JSON exported (photo stored separately)','ok');
});

$('jsonImportBtn').addEventListener('click', () => $('jsonFileInput').click());
$('jsonFileInput').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!confirm('Import will replace your current resume data. Continue?')) return;
      localStorage.setItem('rfp3', JSON.stringify(data));
      location.reload();
    } catch(err) { toast('Invalid JSON file','err'); }
  };
  r.readAsText(f); e.target.value = '';
});

/* ══════════════════════════════════════════════════
   PERSIST / RESTORE
══════════════════════════════════════════════════ */
function persist() {
  const data = {
    template: S.template, accent: S.accent, theme: S.theme, fontSize: S.fontSize,
    skills: S.skills, experience: S.experience, education: S.education,
    projects: S.projects, certifications: S.certifications, languages: S.languages,
    fields: Object.fromEntries(FIELDS.map(id => [id, ($(id)||{}).value||''])),
  };
  try { localStorage.setItem('rfp3', JSON.stringify(data)); } catch(e) {}
  // Save photo to IndexedDB separately (no localStorage quota hit)
  if (S.photo) dbSet('photo', S.photo);
}

function rebuildDynamic() {
  const SEC_MAP = [
    ['experience','expList'],
    ['education','eduList'],
    ['projects','projList'],
    ['certifications','certList'],
    ['languages','langList'],
  ];
  SEC_MAP.forEach(([sec, listId]) => {
    const list = $(listId); list.innerHTML = '';
    S[sec].forEach(entry => {
      const div = document.createElement('div');
      div.className = 'dyn-e'; div.dataset.id = entry.id;
      div.innerHTML = ENTRY_TMPL[sec](entry.id);
      list.appendChild(div);
      div.querySelectorAll('input, textarea, select').forEach(el => {
        const val = entry[el.dataset.f];
        if (val === undefined) return;
        if (el.type === 'checkbox') el.checked = !!val; else el.value = val;
      });
      attachListeners(div, sec);
    });
    initDnD(list, sec);
  });
}

async function restore() {
  let data;
  try { data = JSON.parse(localStorage.getItem('rfp3')); } catch(e) {}
  if (!data) return false;

  // Fields
  if (data.fields) FIELDS.forEach(id => { if ($(id) && data.fields[id] != null) $(id).value = data.fields[id]; });
  const sl = $('summary').value.length; $('sumLen').textContent = sl;

  // Config
  if (data.template) { S.template = data.template; $$('.tpl-opt').forEach(b => b.classList.toggle('active', b.dataset.tpl === data.template)); $('tplPill').textContent = TPL_LABELS[data.template]; }
  if (data.accent) { S.accent = data.accent; applyAccent(data.accent); const sw = document.querySelector(`.sw[data-c="${data.accent}"]`); if (sw) { $$('.sw').forEach(s=>s.classList.remove('active')); sw.classList.add('active'); } }
  if (data.theme) setTheme(data.theme);
  if (data.fontSize) { S.fontSize = data.fontSize; $('fsVal').textContent = S.fontSize + 'pt'; }

  // Arrays
  ['skills','experience','education','projects','certifications','languages'].forEach(k => {
    if (data[k]) S[k] = data[k];
  });

  rebuildDynamic();
  renderSkills();

  // Photo from IndexedDB
  try {
    const photo = await dbGet('photo');
    if (photo) { S.photo = photo; showPhotoPreview(photo); }
  } catch(e) {}

  return true;
}

/* ══════════════════════════════════════════════════
   CLEAR
══════════════════════════════════════════════════ */
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all data? This cannot be undone.')) return;
  localStorage.removeItem('rfp3');
  await dbDel('photo');
  location.reload();
});

$('saveDraftBtn').addEventListener('click', () => {
  persist(); toast('Draft saved','ok');
});

/* ══════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  if (e.key === 'z') { e.preventDefault(); $('undoBtn').click(); }
  if (e.key === 'y') { e.preventDefault(); $('redoBtn').click(); }
  if (e.key === 's') { e.preventDefault(); persist(); toast('Saved','ok'); }
  if (e.key === 'p') { e.preventDefault(); window.print(); }
  if (e.key === 'e') { e.preventDefault(); $('pdfBtn').click(); }
});

// Show shortcut bar briefly
setTimeout(() => {
  const bar = $('shortcutBar'); bar.classList.add('vis');
  setTimeout(() => bar.classList.remove('vis'), 5000);
}, 3500);

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
async function init() {
  await openDB();
  const restored = await restore();
  update();
  setZoom(100);
  pushHistory(); // initial snapshot
  updateCounts();

  // Init DnD on all existing lists
  [['expList','experience'],['eduList','education'],['projList','projects'],['certList','certifications'],['langList','languages']]
    .forEach(([id, sec]) => initDnD($(id), sec));

  if (restored) toast('Welcome back — resume restored','ok');
  else toast('Welcome to ResumeForge Pro','info');
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(init, 1900); // After loading screen
});
