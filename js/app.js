import { loadDataFile, saveTrainingDay, testConnection } from './github.js';
import {
  BODY_PARTS,
  MACRO_KEYS,
  MACRO_META,
  barPercent,
  computeWindowStats,
  deltaText,
  dietDot,
  evaluateDay,
  formatHeading,
  formatNum,
  formatShortDate,
  hkToday,
  macroBadgeLabel,
  monthCells,
  monthTitle,
  shiftMonth,
  statusLabel,
  toggleBodyPart,
  toggleTrained,
  weightChartModel,
  WEEKDAYS,
  weightSeries,
} from './logic.js';

const STORAGE_KEY = 'zizi-tracker-settings';
const DATA_CACHE = 'zizi-v1';
const DEFAULT_OWNER = 'kuichingcheung';
const DEFAULT_REPO = 'Zizi-daily-tracker';
const ROUTES = ['today', 'history', 'stats', 'settings'];

const state = {
  route: 'today',
  month: hkToday().slice(0, 7),
  selectedDate: null,
  diet: null,
  training: null,
  weighins: null,
  drafts: {},
  loading: true,
  error: '',
  savingDate: null,
};

const main = document.getElementById('main');
const toastEl = document.getElementById('toast');
let toastTimer = 0;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      token: typeof parsed.token === 'string' ? parsed.token : '',
      owner: typeof parsed.owner === 'string' && parsed.owner.trim() ? parsed.owner.trim() : DEFAULT_OWNER,
      repo: typeof parsed.repo === 'string' && parsed.repo.trim() ? parsed.repo.trim() : DEFAULT_REPO,
    };
  } catch {
    return { token: '', owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function rememberJson(name, data) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    const url = new URL(`data/${name}`, window.location.href);
    await cache.put(url.pathname, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch {
    /* cache can be unavailable in private mode */
  }
}

function toast(message, kind = 'ok') {
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function saveErrorMessage(err) {
  if (err?.code === 'NO_TOKEN') return '未設定 GitHub token，請去設定';
  if (err?.code === 'BAD_DATE') return '日期格式唔正確';
  if (err?.status === 401) return 'Token 無效，請去設定檢查';
  if (err?.status === 403) return 'Token 冇權限改檔，請檢查 Contents 讀寫';
  if (err?.status === 404) return '搵唔到 data/training.json';
  if (err?.status === 409 || err?.status === 422) return '資料有人同時改緊，請再試一次';
  return `儲存失敗：${err?.message || '未知錯誤'}`;
}

function dietDay(date) {
  return state.diet?.days?.find((day) => day.date === date) || null;
}

function savedTraining(date) {
  const found = state.training?.days?.find((day) => day.date === date);
  if (!found) return { date, trained: false, parts: [], note: '' };
  return {
    date: found.date,
    trained: Boolean(found.trained),
    parts: [...(found.parts || [])],
    note: found.note || '',
  };
}

function currentDraft(date) {
  const draft = state.drafts[date];
  if (!draft) return savedTraining(date);
  return { ...draft, parts: [...(draft.parts || [])] };
}

function rememberNote(date) {
  const field = document.querySelector(`textarea[data-note][data-date="${date}"]`);
  if (!field) return;
  const draft = currentDraft(date);
  state.drafts[date] = { ...draft, parts: [...draft.parts], note: field.value };
}

function readRoute() {
  const raw = (location.hash || '#today').replace(/^#/, '');
  const [route, extra] = raw.split('/');
  if (!ROUTES.includes(route)) return { route: 'today', selectedDate: null };
  const selectedDate = route === 'history' && /^\d{4}-\d{2}-\d{2}$/.test(extra || '') ? extra : null;
  return { route, selectedDate };
}

function applyRoute() {
  const next = readRoute();
  state.route = next.route;
  state.selectedDate = next.selectedDate;
  if (next.selectedDate) state.month = next.selectedDate.slice(0, 7);
}

function go(hash) {
  const next = `#${hash}`;
  if (location.hash === next) {
    applyRoute();
    render();
    return;
  }
  location.hash = next;
}

function badge(kind, label, large = false) {
  return `<span class="badge ${kind}${large ? ' lg' : ''}">${label}</span>`;
}

function pageHead(title, subtitle) {
  return `<header class="page-head"><p class="brand">Zizi</p><h1>${title}</h1><p class="sub">${subtitle}</p></header>`;
}

function renderDiet(day) {
  if (!day) {
    return `<section class="card diet-card"><h2 class="empty-title">呢日未有飲食紀錄</h2><p class="hint">教練未更新。</p></section>`;
  }
  const evaluation = evaluateDay(day);
  const macros = MACRO_KEYS.map((key) => {
    const item = evaluation.macros[key];
    const meta = MACRO_META[key];
    const judgedFail = evaluation.status !== 'progress' && !item.pass;
    const deltaClass = evaluation.status === 'progress' ? 'pending' : (item.pass ? 'ok' : 'bad');
    return `<li class="macro${judgedFail ? ' is-fail' : ''}" data-macro="${key}">
      <div class="macro-top">
        <span class="macro-label">${meta.label}</span>
        ${badge(evaluation.status === 'progress' ? 'progress' : (item.pass ? 'pass' : 'fail'), macroBadgeLabel(evaluation, key))}
      </div>
      <div class="macro-nums">
        <span class="intake">${formatNum(item.intake)}</span>
        <span class="delta ${deltaClass}">${deltaText(item.delta)}</span>
      </div>
      <div class="macro-target">/ ${formatNum(item.target)} ${meta.unit}</div>
      <div class="bar" role="meter" aria-label="${meta.label}" aria-valuemin="0" aria-valuemax="${esc(item.target)}" aria-valuenow="${esc(item.intake)}">
        <span style="width:${barPercent(item.intake, item.target)}%"></span>
      </div>
    </li>`;
  }).join('');

  const note = String(day.note || '').trim()
    ? `<blockquote class="coach-note">${esc(day.note)}</blockquote>`
    : '';
  const meals = Array.isArray(day.meals) && day.meals.length
    ? day.meals.map((meal) => `<details class="meal">
        <summary>
          <span class="meal-time">${esc(meal.time || '')}</span>
          <span class="meal-name">${esc(meal.name || '')}</span>
          <span class="meal-kcal">${formatNum(meal.kcal)} kcal</span>
        </summary>
        <p class="meal-items">${esc(meal.items || '')}</p>
        <p class="meal-macros">蛋白質 ${formatNum(meal.protein)} · 碳水 ${formatNum(meal.carbs)} · 脂肪 ${formatNum(meal.fat)}</p>
      </details>`).join('')
    : '<p class="hint">未有餐單</p>';

  return `<section class="card diet-card">
    <div class="card-head">
      <h2>飲食</h2>
      ${badge(evaluation.status, statusLabel(evaluation.status), true)}
    </div>
    <ul class="macros">${macros}</ul>
    ${note}
    <h3>餐單</h3>
    ${meals}
  </section>`;
}

function renderTraining(date) {
  const draft = currentDraft(date);
  const today = hkToday();
  const saving = state.savingDate === date;
  const chips = BODY_PARTS.map((part) => {
    const on = draft.parts.includes(part);
    return `<button type="button" class="chip" data-part="${part}" data-date="${date}" aria-pressed="${on ? 'true' : 'false'}">${part}</button>`;
  }).join('');
  return `<section class="card train-card" data-training-form data-date="${date}">
    <div class="card-head"><h2>訓練</h2></div>
    <button type="button" class="train-row" data-trained data-date="${date}" aria-pressed="${draft.trained ? 'true' : 'false'}">
      <span>${date === today ? '今日有冇操' : '當日有冇操'}</span>
      <span class="switch" aria-hidden="true"></span>
    </button>
    <div class="chips">${chips}</div>
    <label class="field">備註
      <textarea data-note data-date="${date}" maxlength="200" placeholder="可加一句，例如推日">${esc(draft.note)}</textarea>
    </label>
    <button type="button" class="save" data-save data-date="${date}" ${saving ? 'disabled' : ''}>${saving ? '儲存緊…' : '儲存'}</button>
    <p class="hint">飲食由教練更新。訓練要撳儲存，先會寫入 GitHub。</p>
  </section>`;
}

function renderToday() {
  const date = hkToday();
  const day = dietDay(date);
  const subtitle = day
    ? formatHeading(date)
    : `${formatHeading(date)} · 未有飲食紀錄`;
  return `${pageHead('今日', subtitle)}<div class="stack">${renderDiet(day)}${renderTraining(date)}</div>`;
}

function renderHistory() {
  const cells = monthCells(state.month);
  const today = hkToday();
  const weeks = WEEKDAYS.map((day) => `<span>${day}</span>`).join('');
  const days = cells.map((date) => {
    if (!date) return '<span></span>';
    const record = dietDay(date);
    const dot = dietDot(record);
    const trained = Boolean(state.training?.days?.some((item) => item.date === date && item.trained));
    const selected = state.selectedDate === date ? ' is-selected' : '';
    const isToday = date === today ? ' is-today' : '';
    return `<button type="button" class="day${selected}${isToday}" data-day="${date}" aria-label="${formatHeading(date)}">
      <span class="num">${Number(date.slice(-2))}</span>
      <span class="dots"><span class="dot ${dot}"></span>${trained ? '<span class="dot trained"></span>' : ''}</span>
    </button>`;
  }).join('');

  const detail = state.selectedDate
    ? `<div id="day-detail">
        <div class="detail-head">
          <h2>${formatHeading(state.selectedDate)}</h2>
          <button type="button" class="mini" data-close-day>關閉</button>
        </div>
        <div class="stack">${renderDiet(dietDay(state.selectedDate))}${renderTraining(state.selectedDate)}</div>
      </div>`
    : '';

  return `${pageHead('紀錄', '撳一日睇飲食同補返訓練')}
    <div class="stack">
      <section class="card">
        <div class="month-bar">
          <button type="button" class="icon-btn" data-month="-1" aria-label="上個月">‹</button>
          <h2>${monthTitle(state.month)}</h2>
          <button type="button" class="icon-btn" data-month="1" aria-label="下個月">›</button>
        </div>
        <div class="dow">${weeks}</div>
        <div class="calendar">${days}</div>
        <div class="legend">
          <span><span class="dot pass"></span>達標</span>
          <span><span class="dot fail"></span>未達標</span>
          <span><span class="dot progress"></span>進行中</span>
          <span><span class="dot none"></span>未有紀錄</span>
          <span><span class="dot trained"></span>有操</span>
        </div>
      </section>
      ${detail}
    </div>`;
}

function hitClass(hits, total) {
  if (!total) return '';
  if (hits === total) return 'good';
  if (hits === 0) return 'bad';
  return 'mid';
}

function formatPartCounts(counts) {
  const bits = BODY_PARTS.filter((part) => counts[part]).map((part) => `${part} ${counts[part]}`);
  return bits.length ? bits.join(' · ') : '未有部位紀錄';
}

function renderWindow(windowDays) {
  const stats = computeWindowStats(state.diet?.days || [], state.training?.days || [], hkToday(), windowDays);
  const rows = MACRO_KEYS.map((key) => {
    const meta = MACRO_META[key];
    const avg = stats.completeCount
      ? `${formatNum(stats.avgIntake[key])} / ${formatNum(stats.avgTarget[key])} ${meta.unit}`
      : '—';
    return `<div class="stat-row">
      <strong>${meta.label}</strong>
      <span class="hit ${hitClass(stats.hits[key], stats.completeCount)}">${stats.hits[key]}/${stats.completeCount}</span>
      <span class="avg">${avg}</span>
    </div>`;
  }).join('');
  const progress = stats.progressCount ? ` · 進行中 ${stats.progressCount} 日` : '';
  return `<section class="card stat-block">
    <div class="card-head">
      <h2>近 ${windowDays} 日</h2>
      <span class="range">${formatShortDate(stats.start)} – ${formatShortDate(stats.end)}</span>
    </div>
    <p class="hint">完成 ${stats.completeCount} 日${progress}。達標日數只計已完成，右邊係平均攝取 / 平均目標。</p>
    ${stats.completeCount ? '' : '<p class="empty-copy">呢段時間未有完成嘅飲食紀錄。</p>'}
    ${rows}
    <div class="stat-row">
      <strong>全日</strong>
      <span class="hit ${hitClass(stats.hits.overall, stats.completeCount)}">${stats.hits.overall}/${stats.completeCount}</span>
      <span class="avg">至少三項達標</span>
    </div>
    <div class="train-line">
      <strong>操咗 ${stats.trainingCount} 日</strong>
      <span class="hint">${formatPartCounts(stats.partCounts)}</span>
    </div>
  </section>`;
}

function renderWeight() {
  const entries = state.weighins?.entries || [];
  const series = weightSeries(entries);
  const latest = series.at(-1);
  const model = weightChartModel(entries, 320, 156);
  let chart = '<p class="hint">未有體重紀錄</p>';
  if (model.points.length) {
    const points = model.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const dots = model.points.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5"></circle>`).join('');
    const labels = model.points.map((point) => `<text x="${point.x.toFixed(1)}" y="${Math.max(12, point.y - 10).toFixed(1)}" text-anchor="middle">${formatNum(point.weight)}</text>`).join('');
    const dates = model.points.map((point) => {
      const [, month, day] = point.date.split('-');
      return `<text class="axis" x="${point.x.toFixed(1)}" y="${model.height - 6}" text-anchor="middle">${Number(month)}/${Number(day)}</text>`;
    }).join('');
    const midY = (model.top + (model.height - model.bottom)) / 2;
    chart = `<svg class="chart" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="體重走勢">
      <line class="grid" x1="${model.left}" y1="${midY}" x2="${model.width - model.right}" y2="${midY}"></line>
      <polyline points="${points}"></polyline>
      ${dots}
      ${labels}
      ${dates}
    </svg>`;
  }
  let change = '';
  if (series.length >= 2) {
    const diff = series.at(-1).weight - series[0].weight;
    const signed = diff > 0 ? `+${formatNum(diff)}` : formatNum(diff);
    change = `<p class="hint">較 ${formatShortDate(series[0].date)} ${signed} kg</p>`;
  }
  const list = series.map((entry) => {
    const bits = [`${formatNum(entry.weight)} kg`];
    if (entry.smm != null && entry.smm !== '') bits.push(`骨骼肌 ${formatNum(entry.smm)}`);
    if (entry.bodyFat != null && entry.bodyFat !== '') bits.push(`體脂 ${formatNum(entry.bodyFat)}%`);
    const note = String(entry.note || '').trim()
      ? `<p class="note">${esc(entry.note)}</p>`
      : '';
    return `<li><div class="row"><span>${formatShortDate(entry.date)}</span><span>${bits.join(' · ')}</span></div>${note}</li>`;
  }).join('');
  return `<section class="card">
    <div class="card-head">
      <h2>體重</h2>
      <span class="weight-now">${latest ? `${formatNum(latest.weight)} kg` : '—'}</span>
    </div>
    ${chart}
    ${change}
    <ul class="weighins">${list}</ul>
  </section>`;
}

function renderStats() {
  return `${pageHead('統計', '近 7 日、近 30 日同體重走勢')}<div class="stack">${renderWindow(7)}${renderWindow(30)}${renderWeight()}</div>`;
}

function renderSettings() {
  const settings = loadSettings();
  return `${pageHead('設定', 'Token 只留喺呢部機')}
    <section class="card">
      <h2>GitHub 連線</h2>
      <p class="hint">用 fine-grained token，只俾呢個 repo 嘅 Contents 讀寫。Token 存喺 localStorage，唔會寫入 repo。</p>
      <label class="field">Fine-grained token
        <span class="token-row">
          <input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" value="${esc(settings.token)}">
          <button type="button" class="mini" data-toggle-token>顯示</button>
        </span>
      </label>
      <label class="field">Repo 擁有者
        <input id="owner" type="text" autocapitalize="off" spellcheck="false" value="${esc(settings.owner)}">
      </label>
      <label class="field">Repo 名稱
        <input id="repo" type="text" autocapitalize="off" spellcheck="false" value="${esc(settings.repo)}">
      </label>
      <div class="actions">
        <button type="button" class="save" data-test-connection>測試連線</button>
        <button type="button" class="ghost" data-save-settings>儲存設定</button>
        <button type="button" class="text-btn" data-clear-token>清除 token</button>
      </div>
    </section>`;
}

function render() {
  applyRoute();
  const titles = { today: '今日', history: '紀錄', stats: '統計', settings: '設定' };
  document.title = `${titles[state.route] || 'Zizi'} · Zizi`;
  document.querySelectorAll('[data-nav]').forEach((button) => {
    if (button.dataset.nav === state.route) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  if (state.loading && !state.diet) {
    main.innerHTML = '<p class="loading">載入中…</p>';
    return;
  }
  if (state.error && !state.diet) {
    main.innerHTML = `<p class="empty-title">${esc(state.error)}</p><button type="button" class="save" data-retry>再試一次</button>`;
    return;
  }

  if (state.route === 'today') main.innerHTML = renderToday();
  else if (state.route === 'history') main.innerHTML = renderHistory();
  else if (state.route === 'stats') main.innerHTML = renderStats();
  else main.innerHTML = renderSettings();

  if (!state.selectedDate) state.lastScrolled = null;
  else if (state.route === 'history' && state.selectedDate !== state.lastScrolled) {
    state.lastScrolled = state.selectedDate;
    document.getElementById('day-detail')?.scrollIntoView({ block: 'start' });
  }
}

async function loadAll() {
  if (!state.diet) {
    state.loading = true;
    state.error = '';
    render();
  }
  try {
    const settings = loadSettings();
    const [diet, training, weighins] = await Promise.all([
      loadDataFile('diet.json', settings),
      loadDataFile('training.json', settings),
      loadDataFile('weighins.json', settings),
    ]);
    state.diet = diet;
    state.training = training;
    state.weighins = weighins;
    state.error = '';
    rememberJson('diet.json', diet);
    rememberJson('training.json', training);
    rememberJson('weighins.json', weighins);
  } catch {
    if (!state.diet) state.error = '讀取唔到數據，請檢查網絡再試';
    else toast('更新數據失敗，暫時顯示上次讀到嘅紀錄', 'err');
  } finally {
    state.loading = false;
    render();
  }
}

function settingsFromForm() {
  const current = loadSettings();
  const token = document.getElementById('token');
  const owner = document.getElementById('owner');
  const repo = document.getElementById('repo');
  const settings = {
    token: token ? token.value.trim() : current.token,
    owner: owner && owner.value.trim() ? owner.value.trim() : DEFAULT_OWNER,
    repo: repo && repo.value.trim() ? repo.value.trim() : DEFAULT_REPO,
  };
  saveSettings(settings);
  return settings;
}

async function onSave(date) {
  if (state.savingDate) return;
  rememberNote(date);
  const settings = loadSettings();
  if (!settings.token) {
    toast('未設定 GitHub token，請去設定', 'err');
    return;
  }
  const draft = currentDraft(date);
  state.savingDate = date;
  render();
  try {
    const result = await saveTrainingDay({
      owner: settings.owner,
      repo: settings.repo,
      token: settings.token,
      entry: draft,
    });
    state.training = result.data;
    delete state.drafts[date];
    rememberJson('training.json', result.data);
    toast(result.unchanged ? '呢日紀錄冇改動' : '已儲存訓練紀錄');
  } catch (err) {
    toast(saveErrorMessage(err), 'err');
  } finally {
    state.savingDate = null;
    render();
  }
}

async function onTestConnection(button) {
  const settings = settingsFromForm();
  if (!settings.token) {
    toast('請先貼上 token', 'err');
    return;
  }
  button.disabled = true;
  button.textContent = '測試緊…';
  const result = await testConnection(settings);
  if (result.ok) {
    toast('連線成功');
    await loadAll();
  } else {
    toast(result.message, 'err');
    button.disabled = false;
    button.textContent = '測試連線';
  }
}

document.body.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    go(nav.dataset.nav);
    return;
  }
  const retry = event.target.closest('[data-retry]');
  if (retry) {
    loadAll();
    return;
  }
  const monthBtn = event.target.closest('[data-month]');
  if (monthBtn) {
    state.month = shiftMonth(state.month, Number(monthBtn.dataset.month));
    state.selectedDate = null;
    if (location.hash.startsWith('#history/')) location.hash = 'history';
    else render();
    return;
  }
  const dayBtn = event.target.closest('[data-day]');
  if (dayBtn) {
    go(`history/${dayBtn.dataset.day}`);
    return;
  }
  if (event.target.closest('[data-close-day]')) {
    go('history');
    return;
  }
  const partBtn = event.target.closest('[data-part]');
  if (partBtn) {
    const date = partBtn.dataset.date;
    rememberNote(date);
    state.drafts[date] = toggleBodyPart(currentDraft(date), partBtn.dataset.part);
    render();
    return;
  }
  const trainedBtn = event.target.closest('[data-trained]');
  if (trainedBtn) {
    const date = trainedBtn.dataset.date;
    rememberNote(date);
    state.drafts[date] = toggleTrained(currentDraft(date));
    render();
    return;
  }
  const saveBtn = event.target.closest('[data-save]');
  if (saveBtn) {
    onSave(saveBtn.dataset.date);
    return;
  }
  if (event.target.closest('[data-save-settings]')) {
    settingsFromForm();
    toast('已儲存設定');
    return;
  }
  const testBtn = event.target.closest('[data-test-connection]');
  if (testBtn) {
    onTestConnection(testBtn);
    return;
  }
  const toggle = event.target.closest('[data-toggle-token]');
  if (toggle) {
    const input = document.getElementById('token');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隱藏' : '顯示';
    return;
  }
  if (event.target.closest('[data-clear-token]')) {
    const settings = loadSettings();
    settings.token = '';
    saveSettings(settings);
    render();
    toast('已清除 token');
  }
});

document.body.addEventListener('input', (event) => {
  const note = event.target.closest('[data-note]');
  if (!note) return;
  const date = note.dataset.date;
  const draft = currentDraft(date);
  state.drafts[date] = { ...draft, parts: [...draft.parts], note: note.value };
});

window.addEventListener('hashchange', () => {
  render();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

applyRoute();
loadAll();
