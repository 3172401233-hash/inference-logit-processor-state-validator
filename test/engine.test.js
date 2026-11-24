import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchEngine } from '../src/engine.js';

function baseScenario(overrides = {}) {
  return {
    steps: 6,
    requests: [
      {
        id: 'req-low-temp',
        params: { temperature: 0.2, repetitionPenalty: 1.0, stopTokens: [99], maxTokens: 10 },
        history: [1, 2],
      },
      {
        id: 'req-high-temp',
        params: { temperature: 1.5, repetitionPenalty: 1.3, stopTokens: [99], maxTokens: 10 },
        history: [1, 2],
      },
    ],
    ...overrides,
  };

}

function tokensFor(report, requestId) {
  return report.tokens.filter((entry) => entry.requestId === requestId);
}

test('不同 temperature 的请求使用各自独立的参数与状态', () => {
  const report = new BatchEngine({ vocabSize: 16, seed: 5 }).run(baseScenario());

  const lowTemp = tokensFor(report, 'req-low-temp');
  const highTemp = tokensFor(report, 'req-high-temp');
  assert.ok(lowTemp.length > 0);
  assert.ok(highTemp.length > 0);

  for (const entry of lowTemp) {
    assert.equal(entry.processors[0].temperature, 0.2);
  }
  for (const entry of highTemp) {
    assert.equal(entry.processors[0].temperature, 1.5);
    assert.equal(entry.processors[1].repetitionPenalty, 1.3);
  }

  assert.deepEqual(report.stateReuseErrors, []);
  assert.deepEqual(report.residualReferences, []);
});

test('重复惩罚只使用本请求的 token 历史，不污染批内其他请求', () => {
  const scenario = baseScenario();
  scenario.requests[0].history = [4, 4, 4];
  scenario.requests[0].params.repetitionPenalty = 2;
  scenario.requests[1].history = [7];
  scenario.requests[1].params.repetitionPenalty = 2;

  const report = new BatchEngine({ vocabSize: 16, seed: 5 }).run(scenario);
  const firstStepA = tokensFor(report, 'req-low-temp')[0];
  const firstStepB = tokensFor(report, 'req-high-temp')[0];

  assert.deepEqual(firstStepA.processors[1].penalizedTokens, [4]);
  assert.deepEqual(firstStepB.processors[1].penalizedTokens, [7]);
  assert.deepEqual(report.stateReuseErrors, []);
});

test('多分支复制历史后独立演化，父请求不受影响', () => {
  const scenario = baseScenario({
    branches: [
      { atStep: 2, from: 'req-low-temp', id: 'req-low-temp-b1' },
      { atStep: 2, from: 'req-low-temp', id: 'req-low-temp-b2' },
    ],
  });
  const report = new BatchEngine({ vocabSize: 16, seed: 5 }).run(scenario);

  assert.equal(report.branches.length, 2);
  for (const branch of report.branches) {
    assert.equal(branch.historyIsCopy, true);
    assert.equal(branch.copiedHistoryLength, 4); // 2 个 prompt token + 2 个已生成 token
  }

  const parentTokens = tokensFor(report, 'req-low-temp').map((entry) => entry.token);
  const branchOne = tokensFor(report, 'req-low-temp-b1');
  const branchTwo = tokensFor(report, 'req-low-temp-b2');
  assert.ok(branchOne.length > 0);
  assert.ok(branchTwo.length > 0);
  assert.ok(branchOne.every((entry) => entry.step >= 2));

  // 分支后父请求仍按自己的节奏生成，步数不因分支而增加。
  assert.equal(parentTokens.length, 6);
  assert.deepEqual(report.stateReuseErrors, []);
  assert.deepEqual(report.residualReferences, []);
});

test('批内取消后状态立即释放，不再产生 token 且无残留引用', () => {
  const scenario = baseScenario({
    cancels: [{ atStep: 3, id: 'req-high-temp' }],
  });
  const engine = new BatchEngine({ vocabSize: 16, seed: 5 });
  const report = engine.run(scenario);

  assert.deepEqual(report.cancellations, [{ step: 3, requestId: 'req-high-temp' }]);

  const cancelledTokens = tokensFor(report, 'req-high-temp');
  assert.ok(cancelledTokens.every((entry) => entry.step < 3));
  assert.equal(cancelledTokens.length, 3);

  const survivorTokens = tokensFor(report, 'req-low-temp');
  assert.equal(survivorTokens.length, 6);

  assert.equal(engine.store.get('req-high-temp'), null);
  assert.deepEqual(report.stateReuseErrors, []);
  assert.deepEqual(report.residualReferences, []);
});

test('停止条件触发后请求结束并释放状态', () => {
  const scenario = baseScenario();
  scenario.requests[0].params.maxTokens = 2;

  const report = new BatchEngine({ vocabSize: 16, seed: 5 }).run(scenario);
  const entries = tokensFor(report, 'req-low-temp');

  assert.equal(entries.length, 2);
  assert.equal(entries.at(-1).stopped, true);
  assert.match(entries.at(-1).stopReason, /maxTokens 2/);
  assert.ok(
    report.finished.some(
      (entry) => entry.requestId === 'req-low-temp' && entry.stopReason.includes('maxTokens'),
    ),
  );
  assert.deepEqual(report.residualReferences, []);
});

test('相同种子与场景下结果完全可复现', () => {
  const scenario = baseScenario({
    branches: [{ atStep: 1, from: 'req-low-temp', id: 'req-low-temp-b1' }],
    cancels: [{ atStep: 4, id: 'req-high-temp' }],
  });
  const first = new BatchEngine({ vocabSize: 16, seed: 5 }).run(scenario);
  const second = new BatchEngine({ vocabSize: 16, seed: 5 }).run(scenario);
  assert.deepEqual(first, second);
});
