import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTemperature,
  applyRepetitionPenalty,
  runProcessorChain,
} from '../src/processors.js';

test('temperature 按 1/T 缩放 logits，且不同 temperature 结果不同', () => {
  const logits = [2, -1, 0.5];
  const hot = applyTemperature(logits, 0.5);
  const cold = applyTemperature(logits, 2.0);

  assert.deepEqual(hot.logits, [4, -2, 1]);
  assert.deepEqual(cold.logits, [1, -0.5, 0.25]);
  assert.notDeepEqual(hot.logits, cold.logits);
  assert.equal(hot.trace.name, 'temperature');
  assert.equal(hot.trace.topLogitBefore, 2);
  assert.equal(hot.trace.topLogitAfter, 4);
});

test('temperature 非法值直接抛错', () => {
  assert.throws(() => applyTemperature([1], 0), RangeError);
  assert.throws(() => applyTemperature([1], -1), RangeError);
});

test('重复惩罚只作用于该请求历史中出现过的 token', () => {
  const logits = [3, -2, 1, 4];
  const { logits: adjusted, trace } = applyRepetitionPenalty(logits, [0, 0, 2], 2);

  assert.equal(adjusted[0], 1.5);
  assert.equal(adjusted[2], 0.5);
  assert.equal(adjusted[1], -2);
  assert.equal(adjusted[3], 4);
  assert.deepEqual(trace.penalizedTokens, [0, 2]);
  assert.equal(trace.penalizedCount, 2);
});

test('重复惩罚对负 logit 采用乘法（HF 风格）', () => {
  const { logits: adjusted } = applyRepetitionPenalty([-2, 3], [0, 1], 2);
  assert.equal(adjusted[0], -4);
  assert.equal(adjusted[1], 1.5);
});

test('处理器链按 temperature -> repetitionPenalty 顺序执行并输出逐项结果', () => {
  const { logits, trace } = runProcessorChain(
    [2, 4],
    { temperature: 2, repetitionPenalty: 2 },
    [1],
  );

  assert.deepEqual(trace.map((entry) => entry.name), [
    'temperature',
    'repetitionPenalty',
  ]);
  assert.equal(logits[0], 1);
  assert.equal(logits[1], 1);
});

test('处理器链不修改传入的原始 logits 与历史', () => {
  const logits = [2, 4];
  const history = [1];
  runProcessorChain(logits, { temperature: 2, repetitionPenalty: 2 }, history);
  assert.deepEqual(logits, [2, 4]);
  assert.deepEqual(history, [1]);
});
