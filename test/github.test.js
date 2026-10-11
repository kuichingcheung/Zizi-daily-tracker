import assert from 'node:assert/strict';
import test from 'node:test';

import { saveTrainingDay, testConnection } from '../js/github.js';
import { decodeBase64Utf8, encodeBase64Utf8, stringifyTraining } from '../js/logic.js';

const INITIAL = {
  days: [
    { date: '2026-10-03', trained: true, parts: ['胸', '三頭'], note: '推日' },
  ],
};

function githubFile(data, sha) {
  const text = stringifyTraining(data);
  const encoded = encodeBase64Utf8(text).replace(/(.{60})/g, '$1\n');
  return {
    sha,
    content: encoded,
    encoding: 'base64',
  };
}

test('saveTrainingDay PUT merges the day and base64-encodes Chinese', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'PUT') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ commit: { sha: 'commit1' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => githubFile(INITIAL, 'sha-old'),
    };
  };

  const entry = {
    date: '2026-10-05',
    trained: true,
    parts: ['背', '二頭'],
    note: '拉日',
  };
  const result = await saveTrainingDay({
    owner: 'kuichingcheung',
    repo: 'Zizi-daily-tracker',
    token: 'ghp_test',
    entry,
    fetchImpl,
  });

  assert.equal(result.unchanged, false);
  assert.deepEqual(result.data.days.map((day) => day.date), ['2026-10-03', '2026-10-05']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ghp_test');
  assert.match(calls[0].url, /\/repos\/kuichingcheung\/Zizi-daily-tracker\/contents\/data\/training\.json/);
  assert.equal(calls[0].options.headers['User-Agent'], 'zizi-daily-tracker');

  const put = calls[1];
  assert.equal(put.options.method, 'PUT');
  const body = JSON.parse(put.options.body);
  assert.equal(body.sha, 'sha-old');
  assert.equal(body.branch, 'main');
  assert.equal(body.message, '更新訓練紀錄 2026-10-05');
  const decoded = decodeBase64Utf8(body.content);
  assert.match(decoded, /拉日/);
  assert.match(decoded, /二頭/);
  const written = JSON.parse(decoded);
  assert.equal(written.days[1].note, '拉日');
  assert.deepEqual(written.days[1].parts, ['背', '二頭']);
  assert.equal(written.days[0].note, '推日');
});

test('409 conflict refetches once and retries with the new sha', async () => {
  let gets = 0;
  let puts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'PUT') {
      puts += 1;
      const body = JSON.parse(options.body);
      if (body.sha === 'sha-old') {
        return { ok: false, status: 409, json: async () => ({ message: 'sha conflict' }) };
      }
      assert.equal(body.sha, 'sha-new');
      const decoded = JSON.parse(decodeBase64Utf8(body.content));
      assert.deepEqual(decoded.days.map((day) => day.date), ['2026-10-03', '2026-10-04', '2026-10-05']);
      return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-written' } }) };
    }
    gets += 1;
    if (gets === 1) {
      return { ok: true, status: 200, json: async () => githubFile(INITIAL, 'sha-old') };
    }
    return {
      ok: true,
      status: 200,
      json: async () => githubFile({
        days: [
          ...INITIAL.days,
          { date: '2026-10-04', trained: true, parts: ['帶氧'], note: '斜坡行 30 分鐘' },
        ],
      }, 'sha-new'),
    };
  };

  const result = await saveTrainingDay({
    owner: 'kuichingcheung',
    repo: 'Zizi-daily-tracker',
    token: 'token',
    entry: { date: '2026-10-05', trained: false, parts: ['休息'], note: '' },
    fetchImpl,
  });

  assert.equal(gets, 2);
  assert.equal(puts, 2);
  assert.equal(result.data.days[1].date, '2026-10-04');
  assert.deepEqual(result.data.days[2].parts, ['休息']);
  assert.equal(result.data.days[2].trained, false);
});

test('a second 422 still fails after the single retry', async () => {
  let gets = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'PUT') {
      return { ok: false, status: 422, json: async () => ({ message: 'still conflicting' }) };
    }
    gets += 1;
    return {
      ok: true,
      status: 200,
      json: async () => githubFile(INITIAL, gets === 1 ? 'sha-old' : 'sha-new'),
    };
  };

  await assert.rejects(
    () => saveTrainingDay({
      owner: 'o',
      repo: 'r',
      token: 't',
      entry: { date: '2026-10-06', trained: true, parts: ['肩'], note: '' },
      fetchImpl,
    }),
    (err) => err.status === 422 && /still conflicting/.test(err.message),
  );
  assert.equal(gets, 2);
});

test('missing token does not call the network', async () => {
  let called = false;
  await assert.rejects(
    () => saveTrainingDay({
      owner: 'o',
      repo: 'r',
      token: '',
      entry: { date: '2026-10-05', trained: true, parts: [], note: '' },
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
    }),
    (err) => err.code === 'NO_TOKEN',
  );
  assert.equal(called, false);
});

test('unchanged day skips the PUT', async () => {
  let puts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'PUT') {
      puts += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => githubFile(INITIAL, 'sha-old') };
  };
  const result = await saveTrainingDay({
    owner: 'o',
    repo: 'r',
    token: 't',
    entry: { date: '2026-10-03', trained: true, parts: ['三頭', '胸'], note: '推日' },
    fetchImpl,
  });
  assert.equal(result.unchanged, true);
  assert.equal(puts, 0);
});

test('testConnection reports an invalid token', async () => {
  const result = await testConnection({
    owner: 'kuichingcheung',
    repo: 'Zizi-daily-tracker',
    token: 'bad',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Token/);
});
