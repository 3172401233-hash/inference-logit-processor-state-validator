import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestState, StateStore } from '../src/state.js';

test('分支复制历史而不是共享可变数组', () => {
  const parent = new RequestState('req-a', { temperature: 1 }, [1, 2, 3]);
  const child = parent.branch('req-a-b1');

  assert.deepEqual(child.history, [1, 2, 3]);
  assert.notEqual(child.history, parent.history);
  assert.equal(child.parentId, 'req-a');

  child.append(9);
  assert.deepEqual(parent.history, [1, 2, 3]);
  assert.deepEqual(child.history, [1, 2, 3, 9]);
});

test('分支的 params 同样是副本，修改互不影响', () => {
  const parent = new RequestState('req-a', { temperature: 0.7 }, []);
  const child = parent.branch('req-a-b1');
  child.params.temperature = 1.5;
  assert.equal(parent.params.temperature, 0.7);
});

test('取消后状态被释放且从仓库移除，继续写入会抛错', () => {
  const store = new StateStore();
  const state = store.create('req-x', {}, [1]);
  assert.equal(store.release('req-x'), true);

  assert.equal(store.get('req-x'), null);
  assert.equal(state.released, true);
  assert.equal(state.history.length, 0);
  assert.throws(() => state.append(2), /已释放/);
  assert.throws(() => store.require('req-x'), /不存在/);
});

test('审计能发现共享可变历史的状态复用错误', () => {
  const store = new StateStore();
  const a = store.create('req-a', {}, [1, 2]);
  const b = store.create('req-b', {}, []);
  b.history = a.history; // 模拟全局共享缓存导致的污染

  const { stateReuseErrors } = store.audit();
  assert.equal(stateReuseErrors.length, 1);
  assert.match(stateReuseErrors[0], /req-b.*req-a.*共享/);
});

test('审计能发现已释放状态仍留在仓库中的残留引用', () => {
  const store = new StateStore();
  const state = store.create('req-a', {}, []);
  state.release(); // 模拟取消后未从仓库移除的泄漏

  const { residualReferences } = store.audit();
  assert.equal(residualReferences.length, 1);
  assert.match(residualReferences[0], /req-a/);
});
