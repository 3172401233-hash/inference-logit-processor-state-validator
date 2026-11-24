// 模拟的 logit 生成器：确定性伪 logits，全部为模拟数据，不来自任何真实模型。
export function generateLogits(vocabSize, step, seed) {
  const logits = new Array(vocabSize);
  for (let token = 0; token < vocabSize; token += 1) {
    const phase = (step + 1) * (token + 1) * 12.9898 + seed * 0.0137;
    logits[token] = Math.sin(phase) * 4 + Math.cos(phase * 0.5) * 2;
  }
  return logits;
}

export function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

export function sampleFromLogits(logits, rng) {
  const probs = softmax(logits);
  const roll = rng();
  let cumulative = 0;
  for (let token = 0; token < probs.length; token += 1) {
    cumulative += probs[token];
    if (roll < cumulative) {
      return token;
    }
  }
  return probs.length - 1;
}
