'use strict';

const PROXY = 'https://tax-401-proxy.legstrong77.workers.dev';
const PAY_TYPE = '401 一般稅額計算－專營應稅營業人使用';
const MAX_SLIP = 30000;      // 3 萬以下才能在超商繳
const SPLIT_CAP = 29999;     // 自動拆的每張上限
const STORE_KEY = 'tax401.companies';
const PERIODS = ['1~2', '3~4', '5~6', '7~8', '9~10', '11~12'];

const $ = (s) => document.querySelector(s);
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s ?? '').replace(/\s+/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 公司設定（存在瀏覽器） ================= */
let companies = loadCompanies();

function loadCompanies() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveCompanies() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(companies)); } catch { /* 無痕模式存不了就算了 */ }
}

function missingFields(c) {
  const m = [];
  if (!c.name || !c.owner || !c.address) m.push('名稱/負責人/地址');
  if (!/^\d{4}$/.test(c.dstCd || '')) m.push('稽徵單位');
  if (!/^\d{7}$/.test(c.taxCode || '')) m.push('稅籍編號');
  if (!c.hsnCd) m.push('縣市');
  return m;
}
const safeShort = (s) => String(s).replace(/[\\/:*?"<>|]/g, '').trim();

function renderCompanyList() {
  const box = $('#coList');
  if (!companies.length) {
    box.innerHTML = `<div class="empty">還沒有公司。直接在第 2 步上傳有對照表的 Excel 會自動建立；<br>或按右上角「＋ 新增公司」輸入統編，或從別台電腦「匯出設定」再到這裡「匯入設定」。</div>`;
  } else {
    box.innerHTML = companies.map((c, i) => `
      <div class="co-row">
        <b>${esc(c.short)}</b>
        <span>${esc(c.name || '')}</span>
        <span class="meta">統編 ${esc(c.ban)}　${missingFields(c).length
          ? `<span style="color:var(--warn)">還缺${esc(missingFields(c).join('、'))}（匯入 Excel 會自動帶入）</span>`
          : `稽徵 ${esc(c.dstCd)} ${esc(c.dstLabel || '')}　稅籍 ${esc(c.taxCode)}`}</span>
        <span class="acts">
          <button class="small" type="button" data-edit="${i}">編輯</button>
          <button class="small danger" type="button" data-del="${i}">刪除</button>
        </span>
      </div>`).join('');
  }
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(Number(b.dataset.edit))));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const c = companies[Number(b.dataset.del)];
    if (!confirm(`刪除「${c.short}」的設定？`)) return;
    companies.splice(Number(b.dataset.del), 1);
    saveCompanies();
    renderAll();
  }));
}

/* ---------- 新增 / 編輯公司 ---------- */
let editingIndex = -1;
let hsnList = null;

// etax 停機時回的是一張「網站維護中」網頁，抓出維護時間給使用者看
function etaxDownMessage(text) {
  if (!/維護|Maintenance|503\.html/i.test(text)) return null;
  const plain = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const when = plain.match(/本網站於[^。]*?(?=，|。)/);
  return '財政部 etax 網站維護中' + (when ? `（${when[0]}）` : '') + '，請等維護結束再試';
}

async function api(path) {
  const r = await fetch(PROXY + path);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(etaxDownMessage(text) || `中繼站回應不是資料（HTTP ${r.status}）`);
  }
}

async function ensureHsn() {
  if (hsnList) return hsnList;
  hsnList = await api('/hsn');
  const sel = $('#f_hsn');
  sel.innerHTML = '<option value="">請選擇</option>' + hsnList.map((h) => `<option value="${h.hsnCd}">${h.hsnCd} - ${esc(h.hsnNm)}</option>`).join('');
  return hsnList;
}

async function loadDst(hsnCd, selected) {
  const sel = $('#f_dst');
  if (!hsnCd) { sel.innerHTML = ''; return; }
  sel.innerHTML = '<option>載入中…</option>';
  const list = await api('/dst?hsn=' + hsnCd);
  sel.innerHTML = '<option value="">請選擇</option>' + list.map((d) =>
    `<option value="${d.dstCd}" data-label="${esc(d.dstNm + (d.dstArea ? '[' + d.dstArea + ']' : ''))}">${d.dstCd} - ${esc(d.dstNm)}${d.dstArea ? '[' + esc(d.dstArea) + ']' : ''}</option>`).join('');
  if (selected) sel.value = selected;
}

function dlgMsg(html, cls = 'hint') {
  const m = $('#dlgMsg');
  m.className = cls;
  m.innerHTML = html;
}

async function openEditor(index) {
  editingIndex = index;
  const c = index >= 0 ? companies[index] : {};
  $('#dlgTitle').textContent = index >= 0 ? `編輯「${c.short}」` : '新增公司';
  $('#f_ban').value = c.ban || '';
  $('#f_name').value = c.name || '';
  $('#f_short').value = c.short || '';
  $('#f_owner').value = c.owner || '';
  $('#f_addr').value = c.address || '';
  $('#f_phone').value = c.phone || '';
  $('#f_tax').value = c.taxCode || '';
  dlgMsg('輸入統編按「查詢」會自動帶出名稱、負責人、地址。<b>稽徵單位請對照申報書確認</b>，查詢帶出的不一定對。');
  $('#dlg').showModal();
  try {
    await ensureHsn();
    $('#f_hsn').value = c.hsnCd || '';
    await loadDst(c.hsnCd, c.dstCd);
  } catch (e) {
    dlgMsg('連不上中繼站：' + esc(e.message), 'status bad');
  }
}

$('#addCo').addEventListener('click', () => openEditor(-1));
$('#dlgCancel').addEventListener('click', () => $('#dlg').close());
$('#f_hsn').addEventListener('change', () => loadDst($('#f_hsn').value).catch((e) => dlgMsg(esc(e.message), 'status bad')));

$('#lookup').addEventListener('click', async () => {
  const ban = $('#f_ban').value.trim();
  if (!/^\d{8}$/.test(ban)) { dlgMsg('統編要 8 碼數字', 'status bad'); return; }
  dlgMsg('查詢中…');
  try {
    const d = await api('/info?ban=' + ban);
    if (d.isBusiness !== 'Y' || !d.content?.length) { dlgMsg('etax 查不到這個統編的營業登記', 'status bad'); return; }
    const info = d.content[0];
    $('#f_name').value = info.banNm || '';
    $('#f_owner').value = info.respNm || '';
    $('#f_addr').value = info.banAddr || '';
    if (!$('#f_short').value) {
      $('#f_short').value = (info.banNm || '').replace(/(股份)?有限公司|企業社|實業社|商行|工作室|行號/g, '') || info.banNm;
    }
    const hsns = await ensureHsn();
    const hsn = hsns.find((h) => h.hsnNm === info.banAddrHsnNm);
    if (hsn) {
      $('#f_hsn').value = hsn.hsnCd;
      await loadDst(hsn.hsnCd, d.dstTownCd);
    }
    dlgMsg(`✓ 已帶入「${esc(info.banNm)}」（${esc(info.busiStatusMk || '')}）。稽徵單位預設 ${esc(d.dstTownCd || '?')}，<b>請對照申報書確認</b>，再填稅籍編號。`, 'status ok');
  } catch (e) {
    dlgMsg('查詢失敗：' + esc(e.message), 'status bad');
  }
});

// 「D70 1234567」「D701234567」「1234567」都收，存成 7 碼
function normalizeTaxCode(s) {
  const t = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = t.match(/^(?:[A-Z]\d{2})?(\d{7})$/);
  return m ? m[1] : null;
}

$('#coForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const dstOpt = $('#f_dst').selectedOptions[0];
  const c = {
    ban: $('#f_ban').value.trim(),
    name: $('#f_name').value.trim(),
    short: safeShort($('#f_short').value),
    owner: $('#f_owner').value.trim(),
    address: $('#f_addr').value.trim(),
    phone: $('#f_phone').value.trim(),
    hsnCd: $('#f_hsn').value,
    dstCd: $('#f_dst').value,
    dstLabel: dstOpt?.dataset.label || '',
    taxCode: normalizeTaxCode($('#f_tax').value)
  };
  const missing = [];
  if (!/^\d{8}$/.test(c.ban)) missing.push('統編');
  if (!c.name) missing.push('營業人名稱');
  if (!c.short) missing.push('簡稱');
  if (!c.owner) missing.push('負責人');
  if (!c.address) missing.push('營業地址');
  if (!c.hsnCd) missing.push('縣市');
  if (!/^\d{4}$/.test(c.dstCd)) missing.push('稽徵單位');
  if (!c.taxCode) missing.push('稅籍編號(7 碼數字)');
  if (missing.length) { dlgMsg('還缺：' + missing.join('、'), 'status bad'); return; }
  const dupIdx = companies.findIndex((x, i) => i !== editingIndex && (x.ban === c.ban || x.short === c.short));
  if (dupIdx >= 0) { dlgMsg(`已經有同統編或同簡稱的公司「${esc(companies[dupIdx].short)}」`, 'status bad'); return; }
  if (editingIndex >= 0) companies[editingIndex] = c; else companies.push(c);
  saveCompanies();
  $('#dlg').close();
  renderAll();
});

/* ---------- 匯出 / 匯入設定 ---------- */
$('#exportCo').addEventListener('click', () => {
  if (!companies.length) { alert('還沒有公司可以匯出'); return; }
  downloadBlob(new Blob([JSON.stringify({ version: 1, companies }, null, 2)], { type: 'application/json' }), '401繳款書-公司設定.json');
});
$('#importCoBtn').addEventListener('click', () => $('#importCoFile').click());
/* ---------- 設定連結：公司設定放在網址 # 後面，點開就載入（# 後面不會送到任何伺服器） ---------- */
const toB64Url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const CO_FIELDS = ['ban', 'short', 'name', 'owner', 'address', 'phone', 'hsnCd', 'dstCd', 'dstLabel', 'taxPrefix', 'taxCode'];

$('#copyLink').addEventListener('click', async () => {
  const list = companies.filter((c) => !missingFields(c).length);
  if (!list.length) { alert('還沒有資料完整的公司可以分享'); return; }
  const link = location.origin + location.pathname + '#setup=' + toB64Url(JSON.stringify(list));
  try {
    await navigator.clipboard.writeText(link);
    alert(`已複製 ${list.length} 家公司的設定連結。\n在別台電腦打開這個連結，公司就設定好了。\n（連結裡有公司資料，只傳給自己人）`);
  } catch {
    prompt('複製這個設定連結：', link);
  }
});

function loadSetupFromHash() {
  const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const list = JSON.parse(fromB64Url(m[1]));
    const loaded = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const c = Object.fromEntries(CO_FIELDS.map((k) => [k, String(raw?.[k] ?? '').trim()]));
      c.short = safeShort(c.short);
      if (!/^\d{8}$/.test(c.ban) || !c.short || missingFields(c).length) continue;
      const i = companies.findIndex((x) => x.ban === c.ban);
      if (i >= 0) companies[i] = c; else companies.push(c);
      loaded.push(c.short);
    }
    saveCompanies();
    $('#coMsg').innerHTML = `<div class="status ok" style="margin-bottom:10px">✓ 已載入預設公司：${loaded.map(esc).join('、')}</div>`;
  } catch {
    $('#coMsg').innerHTML = '<div class="status bad" style="margin-bottom:10px">設定連結不完整，請重新複製一次</div>';
  }
}
window.addEventListener('hashchange', () => { loadSetupFromHash(); renderAll(); });

$('#importCoFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const list = Array.isArray(d) ? d : d.companies;
    let added = 0, updated = 0;
    for (const c of list || []) {
      if (!/^\d{8}$/.test(c.ban) || !c.short || !c.taxCode || !c.dstCd) continue;
      const i = companies.findIndex((x) => x.ban === c.ban);
      if (i >= 0) { companies[i] = c; updated++; } else { companies.push(c); added++; }
    }
    saveCompanies();
    renderAll();
    alert(`匯入完成：新增 ${added} 家、更新 ${updated} 家`);
  } catch (err) {
    alert('讀不懂這個設定檔：' + err.message);
  }
});

/* ================= Excel ================= */
function cellNumber(cell) {
  if (!cell) return null;
  if (cell.t === 'n') return cell.v;
  if (cell.t === 's') {
    const t = cell.v.replace(/[,\s元]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return null;
}

// 從公司名那格往下讀：數字收集起來，遇到公式或文字就停
function readColumn(ws, range, r0, c) {
  const nums = [];
  for (let r = r0 + 1; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell || cell.v === '' || cell.v == null) continue;
    if (cell.f) break;
    const n = cellNumber(cell);
    if (n == null) break;
    nums.push(Math.round(n));
  }
  return nums;
}

function interpret(nums) {
  const [first, ...rest] = nums;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  if (rest.some((n) => n < 0)) return { total: Math.abs(first), slips: rest.filter((n) => n < 0).map((n) => -n) };
  if (rest.length && sum(rest) === first) return { total: first, slips: rest };
  if (!rest.length) return { total: first, slips: [] };
  if (nums.every((n) => n > 0 && n <= MAX_SLIP)) return { total: sum(nums), slips: nums };
  return { total: first, slips: rest };
}

function matchCompany(text) {
  const t = norm(text);
  if (!t || t.length > 20) return null;
  return companies.find((c) => t === norm(c.short) || t === norm(c.name)) ||
    companies.find((c) => t.includes(norm(c.short)) && t.length <= norm(c.short).length + 4) || null;
}

// 對照表：公司名底下依序是 稽徵單位代碼（4 碼）、稅籍編號（例 D70 1234567）、統編（8 碼，可省略）
function readRef(ws, r, c) {
  const at = (dr) => String(ws[XLSX.utils.encode_cell({ r: r + dr, c })]?.v ?? '').trim();
  const dstCd = at(1);
  const m = at(2).toUpperCase().replace(/\s+/g, '').match(/^([A-Z])(\d{2})(\d{7})$/);
  if (!/^\d{4}$/.test(dstCd) || !m) return null;
  const ban = at(3).replace(/\s+/g, '');
  return { dstCd, hsnCd: m[1], taxPrefix: m[1] + m[2], taxCode: m[3], ...(/^\d{8}$/.test(ban) ? { ban } : {}) };
}

function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true });
  const best = {};
  const refs = {};      // 已設定的公司：統編 → 對照表資料
  const newCos = {};    // 還沒設定、但對照表有統編的公司：名稱 → 對照表資料
  const needBan = {};   // 還沒設定、對照表缺統編的公司：名稱 → 對照表資料
  const unknown = new Set();
  wb.SheetNames.forEach((sheetName, si) => {
    const ws = wb.Sheets[sheetName];
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell || cell.t !== 's') continue;
        const co = matchCompany(cell.v);
        const ref = readRef(ws, r, c);
        if (ref && co && !refs[co.ban]) refs[co.ban] = ref;
        if (ref && !co && norm(cell.v).length <= 10) (ref.ban ? newCos : needBan)[norm(cell.v)] = ref;
        const nums = readColumn(ws, range, r, c);
        if (!nums.length) continue;
        const { total, slips } = interpret(nums);
        if (!co) {
          // 底下有拆單金額、但名字對不到任何公司 → 提醒使用者
          if (slips.length && norm(cell.v).length <= 10) unknown.add(norm(cell.v));
          continue;
        }
        const sumOk = slips.length > 0 && slips.reduce((a, b) => a + b, 0) === total;
        const score = (slips.length ? 2 : 0) + (sumOk ? 2 : 0) + (total >= 1000 ? 1 : 0) - si * 0.01;
        if (!best[co.ban] || score > best[co.ban].score) {
          best[co.ban] = { ban: co.ban, total, slips, sumOk, source: `${sheetName}!${addr}`, score };
        }
      }
    }
  });
  return { found: Object.values(best), refs, newCos, needBan, unknown: [...unknown] };
}

// 用 Excel 對照表補稽徵單位／稅籍編號；缺名稱、負責人、地址就用統編向 etax 查
async function completeCompanies(refs, bans) {
  const notes = [];
  for (const co of companies) {
    const ref = refs[co.ban];
    if (!ref && !bans.includes(co.ban)) continue;
    if (ref) {
      if (ref.ban && ref.ban !== co.ban) notes.push(`${co.short}：Excel 對照表的統編 ${ref.ban} 跟設定的 ${co.ban} 不同，以設定為準`);
      if (co.dstCd && co.taxCode && (co.dstCd !== ref.dstCd || co.taxCode !== ref.taxCode)) {
        notes.push(`${co.short} 的稽徵單位／稅籍編號依 Excel 對照表更新為 ${ref.dstCd}／${ref.taxPrefix} ${ref.taxCode}`);
      }
      if (co.dstCd !== ref.dstCd) co.dstLabel = '';
      const { ban, ...rest } = ref;
      Object.assign(co, rest);
    }
    if (!co.name || !co.owner || !co.address) {
      try {
        const d = await api('/info?ban=' + co.ban);
        const info = d.content?.[0];
        if (d.isBusiness === 'Y' && info) {
          co.name = info.banNm;
          co.owner = info.respNm;
          co.address = info.banAddr;
        } else {
          notes.push(`etax 查不到 ${co.short}（統編 ${co.ban}）的營業登記`);
        }
      } catch (e) {
        notes.push(/維護中/.test(e.message) ? `${e.message}。公司資料查不到，維護結束後再拖一次 Excel 就好` : `${co.short} 公司資料查詢失敗：${e.message}`);
      }
    }
    if (co.hsnCd && /^\d{4}$/.test(co.dstCd || '') && !co.dstLabel) {
      try {
        const d = (await api('/dst?hsn=' + co.hsnCd)).find((x) => x.dstCd === co.dstCd);
        if (d) co.dstLabel = d.dstNm + (d.dstArea ? `[${d.dstArea}]` : '');
      } catch { /* 只是顯示用 */ }
    }
  }
  saveCompanies();
  return [...new Set(notes)];
}

// 檔名有「07-08」「115」之類就順便設定所屬年月
function applyPeriodFromName(name) {
  let changed = false;
  // 用前瞻逐位置找，「115-07-08」才不會先吃掉「15-07」
  for (const m of name.matchAll(/(?=(?<!\d)(\d{1,2})\s*[-~～_]\s*(\d{1,2})(?!\d))/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a % 2 === 1 && b === a + 1 && b <= 12) {
      $('#period').value = `${a}~${b}`;
      changed = true;
      break;
    }
  }
  const y = name.match(/(?:^|\D)(1[0-4]\d)(?:\D|$)/);
  if (y) { $('#year').value = y[1]; changed = true; }
  if (changed) updatePeriodHint();
  return changed;
}

async function importExcel(file) {
  const msg = $('#importMsg');
  try {
    msg.textContent = '讀取中…';
    const buf = await file.arrayBuffer();
    let parsed = parseWorkbook(buf);

    // 對照表裡有統編、但還沒設定的公司 → 自動建立，再讀一次
    const created = [];
    for (const [short, ref] of Object.entries(parsed.newCos)) {
      if (companies.some((c) => c.ban === ref.ban)) continue;
      companies.push({ short: safeShort(short), ban: ref.ban });
      created.push(short);
    }
    if (created.length) parsed = parseWorkbook(buf);

    // 對照表缺統編 → 當場請使用者輸入一次（記在這台電腦），再重新匯入
    const ask = Object.keys(parsed.needBan);
    if (ask.length) {
      msg.innerHTML = `<div class="status warn">Excel 對照表裡有「${ask.map(esc).join('」「')}」，但沒有統編。輸入一次，這台電腦之後就會記住：`
        + ask.map((n, i) => `<div class="row" style="margin:8px 0 0"><span>${esc(n)}</span><input type="text" inputmode="numeric" maxlength="8" placeholder="8 碼統編" data-ask="${i}" style="max-width:160px"></div>`).join('')
        + `<div style="margin-top:8px"><button type="button" id="askGo">繼續</button> <span class="hint">（或在 Excel 對照表稅籍編號下面加一行統編，就不用再輸入）</span></div></div>`;
      $('#askGo').addEventListener('click', () => {
        const bans = ask.map((_, i) => msg.querySelector(`[data-ask="${i}"]`).value.trim());
        if (bans.some((b) => !/^\d{8}$/.test(b))) { alert('統編要 8 碼數字'); return; }
        ask.forEach((n, i) => { if (!companies.some((c) => c.ban === bans[i])) companies.push({ short: safeShort(n), ban: bans[i] }); });
        saveCompanies();
        importExcel(file);
      });
      msg.querySelector('[data-ask="0"]').focus();
      return;
    }

    const { found, refs, unknown } = parsed;
    if (!found.length) {
      msg.innerHTML = companies.length
        ? `<span style="color:var(--bad)">✗ 在 ${esc(file.name)} 裡找不到任何公司欄位（欄位標題要寫公司簡稱：${companies.map((c) => esc(c.short)).join('、')}）</span>`
          + (unknown.length ? `<br><span class="hint">Excel 裡有這些名稱但還沒設定：${unknown.map(esc).join('、')}</span>` : '')
        : '<span style="color:var(--bad)">✗ 還沒有公司設定，Excel 對照表裡也沒有統編。請在第 1 步新增公司，或在 Excel 對照表的稅籍編號下面加一行統編。</span>';
      return;
    }
    const notes = await completeCompanies(refs, found.map((f) => f.ban));
    if (created.length) notes.unshift(`已從 Excel 對照表自動建立公司：${created.join('、')}`);
    renderCompanyList();
    renderCards();
    const periodSet = applyPeriodFromName(file.name);
    document.querySelectorAll('.card').forEach((el) => {
      const f = found.find((x) => x.ban === el.dataset.ban);
      el.querySelector('.use').checked = !!f;
      el.querySelector('.total').value = f ? f.total : '';
      el.querySelector('.amts').value = f ? f.slips.join('\n') : '';
    });
    const lines = found.map((f) => {
      const co = companies.find((c) => c.ban === f.ban);
      return `${esc(co.short)}：總額 ${f.total.toLocaleString()}，${f.slips.length} 張（${esc(f.source)}）`;
    });
    msg.innerHTML = `<span style="color:var(--ok)">✓ 已匯入 ${esc(file.name)}</span><br><span class="hint">${lines.join('<br>')}</span>`
      + (periodSet ? `<br><span class="hint">所屬年月已依檔名設為 ${esc($('#year').value)} 年 ${esc($('#period').value.replace('~', '～'))} 月</span>` : '')
      + notes.map((n) => `<br><span style="color:var(--warn)">${esc(n)}</span>`).join('')
      + (unknown.length ? `<br><span style="color:var(--warn)">Excel 裡的「${unknown.map(esc).join('」「')}」還沒設定成公司，所以沒帶入</span>` : '');
    refresh();
    // 金額都沒問題就直接開始（startGenerate 會先跳確認年月與張數）
    if (!$('#go').disabled) startGenerate();
  } catch (e) {
    msg.innerHTML = `<span style="color:var(--bad)">✗ 讀不懂這個檔案：${esc(e.message)}</span>`;
  }
}

const drop = $('#drop');
drop.addEventListener('click', () => $('#xlsFile').click());
$('#xlsFile').addEventListener('change', (e) => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files[0]) importExcel(e.dataTransfer.files[0]);
});

$('#template').addEventListener('click', () => {
  const cos = companies.length ? companies : [{ short: '公司A' }, { short: '公司B' }];
  const rows = [['', ...cos.map((c) => c.short)], ['應繳總額', ...cos.map(() => null)]];
  for (let i = 1; i <= 8; i++) rows.push([`第 ${i} 張（填負數）`, ...cos.map(() => null)]);
  rows.push(['差額（要是 0）', ...cos.map(() => null)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  cos.forEach((_, i) => {
    const col = XLSX.utils.encode_col(i + 1);
    ws[`${col}11`] = { t: 'n', f: `SUM(${col}2:${col}10)` };
  });
  // 右邊的對照表：有了它，任何電腦上傳 Excel 就能自動建立公司，不用先設定
  const refCol = cos.length + 3;
  const put = (r, c, v) => { ws[XLSX.utils.encode_cell({ r, c })] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) }; };
  ['對照表', '稽徵單位', '稅籍編號', '統編'].forEach((label, i) => put(i + 1, refCol - 1, label));
  cos.forEach((c, i) => {
    put(1, refCol + i, c.short);
    if (c.dstCd) put(2, refCol + i, Number(c.dstCd));
    if (c.taxCode) put(3, refCol + i, `${c.taxPrefix || (c.hsnCd || '') + (c.dstCd || '').slice(0, 2)} ${c.taxCode}`);
    if (c.ban) put(4, refCol + i, c.ban);
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 10, c: refCol + cos.length - 1 } });
  ws['!cols'] = [{ wch: 16 }, ...cos.map(() => ({ wch: 12 })), { wch: 4 }, { wch: 10 }, ...cos.map(() => ({ wch: 14 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '稅金分攤');
  XLSX.writeFile(wb, '稅金分攤-範本.xlsx');
});

/* ================= 金額卡片 ================= */
function parseAmounts(text) {
  const nums = [], bad = [];
  for (const tok of text.split(/[\s、;；]+/)) {
    const t = tok.replace(/[,，元]/g, '').replace(/^-/, '');
    if (!t) continue;
    if (/^\d+$/.test(t) && Number(t) > 0) nums.push(Number(t)); else bad.push(tok);
  }
  return { nums, bad };
}

// 29999、29998… 往下拆
function splitDescending(total) {
  const out = [];
  let remaining = total, cand = SPLIT_CAP;
  while (remaining > cand) { out.push(cand); remaining -= cand; cand -= 1; }
  if (remaining > 0) out.push(remaining);
  return out;
}

// 盡量平均、每張不同金額、都 ≤ 29999
function splitEven(total) {
  for (let n = Math.ceil(total / SPLIT_CAP); n < 1000; n++) {
    const avg = Math.floor(total / n);
    const start = avg - Math.floor((n - 1) / 2);
    const out = Array.from({ length: n }, (_, i) => start + i);
    out[n - 1] += total - out.reduce((a, b) => a + b, 0);
    if (out.every((x) => x > 0 && x <= SPLIT_CAP) && new Set(out).size === n) return out.sort((a, b) => b - a);
  }
  return splitDescending(total);
}

function renderCards() {
  const box = $('#cards');
  const prev = {};
  box.querySelectorAll('.card').forEach((el) => {
    prev[el.dataset.ban] = {
      use: el.querySelector('.use').checked, total: el.querySelector('.total').value, amts: el.querySelector('.amts').value
    };
  });
  box.innerHTML = '';
  for (const co of companies) {
    const p = prev[co.ban] || { use: true, total: '', amts: '' };
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.ban = co.ban;
    el.innerHTML = `
      <div class="card-head">
        <label><input type="checkbox" class="use"> ${esc(co.short)} <small>${esc(co.ban)}</small></label>
        <span class="split-bar">
          <select class="mode" title="自動拆的方式"><option value="even">平均拆</option><option value="desc">29999 往下拆</option></select>
          <button type="button" class="small split">自動拆</button>
        </span>
      </div>
      <div class="row"><span>應繳總額</span><input type="text" class="total" inputmode="numeric" placeholder="例 120000"></div>
      <div class="row" style="align-items:flex-start"><span>每張金額<br>(一行一張)</span><textarea class="amts" placeholder="29900&#10;29800&#10;…"></textarea></div>
      <div class="chips"></div>
      <div class="status"></div>`;
    el.querySelector('.use').checked = p.use;
    el.querySelector('.total').value = p.total;
    el.querySelector('.amts').value = p.amts;
    box.appendChild(el);
    el.querySelector('.use').addEventListener('change', refresh);
    el.querySelector('.total').addEventListener('input', refresh);
    el.querySelector('.amts').addEventListener('input', refresh);
    el.querySelector('.split').addEventListener('click', () => {
      const total = Number(el.querySelector('.total').value.replace(/[,，\s元]/g, ''));
      if (!Number.isInteger(total) || total <= 0) { alert('先填應繳總額'); return; }
      const fn = el.querySelector('.mode').value === 'desc' ? splitDescending : splitEven;
      el.querySelector('.amts').value = fn(total).join('\n');
      el.querySelector('.use').checked = true;
      refresh();
    });
  }
}

function cardState(el) {
  const co = companies.find((c) => c.ban === el.dataset.ban);
  const use = el.querySelector('.use').checked;
  const totalRaw = el.querySelector('.total').value.replace(/[,，\s元]/g, '');
  const total = totalRaw ? Number(totalRaw) : null;
  const { nums, bad } = parseAmounts(el.querySelector('.amts').value);
  const sum = nums.reduce((a, b) => a + b, 0);
  const count = {};
  nums.forEach((n) => { count[n] = (count[n] || 0) + 1; });
  const dups = nums.filter((n) => count[n] > 1);
  const big = nums.filter((n) => n > MAX_SLIP);

  let level = 'ok', msg;
  const missing = missingFields(co);
  if (nums.length && missing.length) {
    level = 'bad'; msg = `公司資料還缺${missing.join('、')}：上傳有對照表的 Excel，或在第 1 步按「編輯」補上`;
  } else if (!nums.length) { level = 'warn'; msg = total ? '按「自動拆」或自己輸入每張金額' : '還沒有金額'; }
  else if (bad.length) { level = 'bad'; msg = `看不懂：${bad.join('、')}`; }
  else if (dups.length) { level = 'bad'; msg = `金額重複（${[...new Set(dups)].join('、')}），檔名會撞在一起`; }
  else if (total != null && (!Number.isFinite(total) || sum !== total)) {
    level = 'bad'; msg = `加總 ${sum.toLocaleString()} ≠ 總額 ${Number(total).toLocaleString()}（差 ${(sum - total).toLocaleString()}）`;
  } else {
    msg = `${nums.length} 張，合計 ${sum.toLocaleString()} 元` + (total != null ? '，跟總額對得上 ✓' : '');
    if (big.length) { level = 'warn'; msg += `；${big.join('、')} 超過 3 萬，超商不能繳（要到銀行）`; }
  }
  return { co, use, nums, dups, level, msg };
}

let running = false;
function refresh() {
  let totalSlips = 0, blocked = false;
  document.querySelectorAll('.card').forEach((el) => {
    const s = cardState(el);
    el.classList.toggle('off', !s.use);
    el.querySelector('.chips').innerHTML = s.nums.map((n) =>
      `<span class="chip ${s.dups.includes(n) ? 'dup' : n > MAX_SLIP ? 'big' : ''}">${n.toLocaleString()}</span>`).join('');
    const st = el.querySelector('.status');
    st.className = 'status ' + s.level;
    st.textContent = s.msg;
    if (s.use && s.nums.length) {
      totalSlips += s.nums.length;
      if (s.level === 'bad') blocked = true;
    }
  });
  const go = $('#go');
  go.disabled = running || blocked || totalSlips === 0;
  go.textContent = totalSlips ? `開始產生 ${totalSlips} 張繳款書` : '開始產生';
}

/* ================= 年期 ================= */
// 預設「最近一個已結束的雙月期」：9、10 月 → 7~8 月；1、2 月 → 去年 11~12 月
function defaultPeriod(d = new Date()) {
  let year = d.getFullYear() - 1911;
  const m = d.getMonth() + 1;
  let end = m % 2 === 0 ? m - 2 : m - 1;
  if (end <= 0) { end = 12; year -= 1; }
  return { year, period: `${end - 1}~${end}` };
}
function periodInfo() {
  const year = parseInt($('#year').value, 10);
  const period = $('#period').value;
  const [a, b] = period.split('~').map(Number);
  return { year, period, endMonth: pad2(b), label: `${year}年${pad2(a)}-${pad2(b)}月` };
}
function updatePeriodHint() {
  const { year, endMonth } = periodInfo();
  if (!year) return;
  // 繳納期限：期末的次月 15 日
  let y = year, m = Number(endMonth) + 1;
  if (m > 12) { m = 1; y += 1; }
  $('#periodHint').textContent = `繳納期限 ${y} 年 ${m} 月 15 日`;
}

/* ================= 產生 ================= */
let cancel = false;
let lastZip = null;

function buildPayload(co, year, endMonth, amount, confirmOverdue) {
  return {
    payTypeName: PAY_TYPE,
    uniformCode: co.ban,
    idf: 'nb',
    varYear: '',
    varMonth: '-1',
    varYear1: String(year),
    varMonth1: endMonth,
    withholdingUnitName: co.name,
    withholdingPeople: co.owner,
    withholdingAddress: co.address,
    withholdingPhone: co.phone || '',
    hsnCd: co.hsnCd,
    dstCd: co.dstCd,
    taxCode: co.taxCode,
    withholdingAmount: amount.toLocaleString('en-US'),
    covId19: 'N',
    isConfirm: confirmOverdue ? 'true' : '',
    toConfirm: ''
  };
}

// 回傳 { pdf: Blob } 或 { overdue: true } 或 { error: '訊息' }
async function requestSlip(payload) {
  const r = await fetch(PROXY + '/401', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const buf = await r.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 5));
  if (head.startsWith('%PDF')) return { pdf: new Blob([buf], { type: 'application/pdf' }) };
  const text = new TextDecoder().decode(buf);
  let j = null;
  try { j = JSON.parse(text); } catch {
    const down = etaxDownMessage(text);
    if (down) return { error: down, fatal: true };
  }
  const details = j?.error?.details || [];
  if (details.some((d) => String(d.objectName).startsWith('overDate'))) return { overdue: true };
  const msg = details.map((d) => d.message).filter(Boolean).join('；') || j?.error?.message || `HTTP ${r.status}`;
  return { error: msg };
}

function log(line) {
  const el = $('#log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

$('#go').addEventListener('click', () => startGenerate());

async function startGenerate() {
  if (running) return;
  const jobs = [];
  document.querySelectorAll('.card').forEach((el) => {
    const s = cardState(el);
    if (s.use && s.nums.length) s.nums.forEach((amt) => jobs.push({ co: s.co, amt }));
  });
  const { year, endMonth, label } = periodInfo();
  if (!year || year < 100) { alert('年度不對'); return; }
  const perCo = {};
  jobs.forEach((j) => { perCo[j.co.short] = (perCo[j.co.short] || 0) + 1; });
  if (!confirm(`要向 etax 產生「${label}」的 401 繳款書？\n\n`
    + Object.entries(perCo).map(([k, v]) => `${k}：${v} 張`).join('\n')
    + `\n共 ${jobs.length} 張\n\n（年月不對請按取消，到第 3 步改好再按「開始產生」）`)) return;

  running = true; cancel = false; refresh();
  $('#stop').classList.remove('hidden');
  $('#zipAgain').classList.add('hidden');
  $('#results').innerHTML = '';
  $('#log').textContent = '';
  $('#bar').style.width = '0';
  log(`所屬年月：${label}，共 ${jobs.length} 張`);

  const done = [], failed = [];
  let confirmOverdue = false;
  for (let i = 0; i < jobs.length; i++) {
    if (cancel) { log('■ 已停止'); break; }
    const { co, amt } = jobs[i];
    const name = `${amt} ${co.short}.pdf`;
    log(`[${i + 1}/${jobs.length}] ${co.short} ${amt.toLocaleString()} 元 …`);
    let res = null;
    for (let attempt = 1; attempt <= 2 && !res?.pdf; attempt++) {
      try {
        res = await requestSlip(buildPayload(co, year, endMonth, amt, confirmOverdue));
        if (res.overdue) {
          if (!confirmOverdue && confirm(`etax 提示：「${label}」已經超過繳納期限。\n繳款書仍可產生，但逾期繳納會加徵滯納金。要繼續產生嗎？`)) {
            confirmOverdue = true;
            log('  （已確認逾期，繼續）');
            res = await requestSlip(buildPayload(co, year, endMonth, amt, true));
          } else if (!confirmOverdue) {
            cancel = true;
            res = { error: '已逾期，未確認' };
          }
        }
      } catch (e) {
        res = { error: '連線失敗：' + e.message };
      }
      if (!res.pdf && !res.overdue && attempt === 1 && !cancel && /連線失敗|HTTP 5/.test(res.error || '')) {
        log('  ↻ 重試一次');
        await sleep(2000);
        res = null;
      } else break;
    }
    if (res?.pdf) {
      done.push({ name, blob: res.pdf });
      log(`  ✓ ${name}`);
    } else {
      failed.push({ name, error: res?.error || '未知錯誤' });
      log(`  ✗ ${name}：${res?.error}`);
      if (res?.fatal) { cancel = true; log('■ etax 無法使用，整批停止'); }
    }
    $('#bar').style.width = `${((i + 1) / jobs.length) * 100}%`;
    if (i < jobs.length - 1 && !cancel) await sleep(600);
  }

  running = false;
  $('#stop').classList.add('hidden');
  refresh();
  log(`══ 完成：成功 ${done.length} 張、失敗 ${failed.length} 張`);

  $('#results').innerHTML = done.map((d, i) =>
    `<div class="res">✓ <a href="#" data-i="${i}">${esc(d.name)}</a></div>`).join('')
    + failed.map((f) => `<div class="res fail">✗ ${esc(f.name)}：${esc(f.error)}</div>`).join('');
  $('#results').querySelectorAll('a[data-i]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const d = done[Number(a.dataset.i)];
    downloadBlob(d.blob, d.name);
  }));

  if (done.length) {
    const zip = new JSZip();
    done.forEach((d) => zip.file(d.name, d.blob));
    const blob = await zip.generateAsync({ type: 'blob' });
    lastZip = { blob, name: `${label}_401繳款書.zip` };
    downloadBlob(lastZip.blob, lastZip.name);
    $('#zipAgain').classList.remove('hidden');
  }
}

$('#stop').addEventListener('click', () => { cancel = true; log('（收到停止，這張做完就停）'); });
$('#zipAgain').addEventListener('click', () => lastZip && downloadBlob(lastZip.blob, lastZip.name));

/* ================= 啟動 ================= */
function renderAll() {
  renderCompanyList();
  renderCards();
  refresh();
}

(function init() {
  const sel = $('#period');
  PERIODS.forEach((p) => sel.add(new Option(p.replace('~', '～'), p)));
  const d = defaultPeriod();
  $('#year').value = d.year;
  sel.value = d.period;
  $('#year').addEventListener('input', updatePeriodHint);
  sel.addEventListener('change', updatePeriodHint);
  updatePeriodHint();
  loadSetupFromHash();
  renderAll();
})();
