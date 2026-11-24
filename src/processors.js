// Logit processor 链：temperature、重复惩罚、停止条件。
// 处理器本身无状态；所有可变状态（token 历史）都存放在按请求独立的 RequestState 中。

export function applyTemperature(logits, temperature) {
  if (!(temperature > 0)) {
    throw new RangeError(`temperature 必须为正数，收到 ${temperature}`);
  }
  const before = [...logits];
  const scaled = logits.map((value) => value / temperature);
  return {
    logits: scaled,
    trace: {
      name: 'temperature',
      temperature,
      topLogitBefore: Math.max(...before),
      topLogitAfter: Math.max(...scaled),
    },
  };
}

export function applyRepetitionPenalty(logits, history, repetitionPenalty) {
  if (!(repetitionPenalty > 0)) {
    throw new RangeError(`repetitionPenalty 必须为正数，收到 ${repetitionPenalty}`);
  }
  const penalizedTokens = [...new Set(history)];
  const adjusted = [...logits];
  if (repetitionPenalty !== 1) {
    for (const token of penalizedTokens) {
      if (token < 0 || token >= adjusted.length) {
        continue;
      }
      adjusted[token] =
        adjusted[token] > 0
          ? adjusted[token] / repetitionPenalty
          : adjusted[token] * repetitionPenalty;
    }
  }
  return {
    logits: adjusted,
    trace: {
      name: 'repetitionPenalty',
      repetitionPenalty,
      historySize: history.length,
      penalizedTokens,
      penalizedCount: penalizedTokens.length,
    },
  };
}

// 按顺序执行处理器链，返回最终 logits 与每个处理器的逐项结果。
export function runProcessorChain(logits, params, history) {
  const trace = [];
  let current = [...logits];

  const temperatureResult = applyTemperature(current, params.temperature ?? 1);
  current = temperatureResult.logits;
  trace.push(temperatureResult.trace);

  const penaltyResult = applyRepetitionPenalty(
    current,
    history,
    params.repetitionPenalty ?? 1,
  );
  current = penaltyResult.logits;
  trace.push(penaltyResult.trace);

  return { logits: current, trace };
}

export function checkStopCondition(state, token) {
  const stopTokens = state.params.stopTokens ?? [];
  if (stopTokens.includes(token)) {
    return `hit stop token ${token}`;
  }
  const maxTokens = state.params.maxTokens ?? Infinity;
  if (state.history.length - state.promptLength >= maxTokens) {
    return `reached maxTokens ${maxTokens}`;
  }
  return null;
}
