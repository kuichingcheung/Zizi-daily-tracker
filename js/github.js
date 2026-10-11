/**
 * GitHub Contents API helpers. Training writes go to data/training.json on main.
 * Pass fetchImpl in tests; the browser build uses global fetch.
 */

import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  mergeTrainingDay,
  stringifyTraining,
  trainingContentEqual,
} from './logic.js';

const API = 'https://api.github.com';
const TRAINING_PATH = 'data/training.json';

export function authHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zizi-daily-tracker',
  };
}

function contentsUrl(owner, repo, path, ref) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  params.set('t', String(Date.now()));
  return `${base}?${params.toString()}`;
}

async function readError(res) {
  try {
    const body = await res.json();
    return body.message || '';
  } catch {
    return '';
  }
}

export async function fetchRepoJson({
  owner,
  repo,
  path,
  token,
  ref = 'main',
  fetchImpl = fetch,
}) {
  const res = await fetchImpl(contentsUrl(owner, repo, path, ref), {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = new Error((await readError(res)) || `GET ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const text = decodeBase64Utf8(body.content || '');
  return { sha: body.sha, data: JSON.parse(text), text };
}

/**
 * Merge one training day and PUT data/training.json.
 * On 409/422, refetch and retry the write once.
 * Skips the PUT when the merged document matches what's already on the branch.
 */
export async function saveTrainingDay({
  owner,
  repo,
  token,
  entry,
  branch = 'main',
  fetchImpl = fetch,
}) {
  if (!token) {
    const err = new Error('NO_TOKEN');
    err.code = 'NO_TOKEN';
    throw err;
  }
  if (!entry?.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    const err = new Error('日期格式唔正確');
    err.code = 'BAD_DATE';
    throw err;
  }

  async function getCurrent() {
    return fetchRepoJson({
      owner,
      repo,
      path: TRAINING_PATH,
      token,
      ref: branch,
      fetchImpl,
    });
  }

  async function put(sha, data) {
    const content = encodeBase64Utf8(stringifyTraining(data));
    return fetchImpl(contentsUrl(owner, repo, TRAINING_PATH).split('?')[0], {
      method: 'PUT',
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `更新訓練紀錄 ${entry.date}`,
        content,
        sha,
        branch,
      }),
    });
  }

  let current = await getCurrent();
  let merged = mergeTrainingDay(current.data, entry);
  if (trainingContentEqual(current.data, merged)) {
    return { data: merged, unchanged: true };
  }

  let res = await put(current.sha, merged);
  if (res.status === 409 || res.status === 422) {
    current = await getCurrent();
    merged = mergeTrainingDay(current.data, entry);
    if (trainingContentEqual(current.data, merged)) {
      return { data: merged, unchanged: true };
    }
    res = await put(current.sha, merged);
  }

  if (!res.ok) {
    const err = new Error((await readError(res)) || `PUT ${res.status}`);
    err.status = res.status;
    throw err;
  }

  let result = null;
  try {
    result = await res.json();
  } catch {
    result = null;
  }
  return { data: merged, unchanged: false, result };
}

export async function testConnection({ owner, repo, token, fetchImpl = fetch }) {
  if (!token) return { ok: false, message: '請先貼上 token' };
  if (!owner || !repo) return { ok: false, message: '請填 repo 擁有者同名稱' };
  try {
    const res = await fetchImpl(contentsUrl(owner, repo, TRAINING_PATH, 'main'), {
      headers: authHeaders(token),
      cache: 'no-store',
    });
    if (res.ok) return { ok: true, message: '連線成功' };
    if (res.status === 401) return { ok: false, message: 'Token 唔正確或者已過期' };
    if (res.status === 403) return { ok: false, message: '權限不足，請確認 token 有 Contents 讀寫' };
    if (res.status === 404) return { ok: false, message: '搵唔到 repo 或者 data/training.json' };
    return { ok: false, message: `連線失敗（${res.status}）` };
  } catch {
    return { ok: false, message: '連線失敗，請檢查網絡' };
  }
}

export async function loadDataFile(name, settings, fetchImpl = fetch) {
  const token = settings?.token?.trim();
  const owner = settings?.owner?.trim();
  const repo = settings?.repo?.trim();

  if (token && owner && repo) {
    try {
      const { data } = await fetchRepoJson({
        owner,
        repo,
        path: `data/${name}`,
        token,
        fetchImpl,
      });
      return data;
    } catch {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/data/${name}?t=${Date.now()}`;
        const res = await fetchImpl(rawUrl, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (res.ok) return await res.json();
      } catch {
        /* fall through to the Pages copy */
      }
    }
  }

  const res = await fetchImpl(`data/${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) {
    const err = new Error(`讀取 ${name} 失敗`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
