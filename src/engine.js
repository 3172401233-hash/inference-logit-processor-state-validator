import { createRequestRng } from './prng.js';
import { generateLogits, sampleFromLogits } from './logits.js';
import { runProcessorChain, checkStopCondition } from './processors.js';
import { StateStore } from './state.js';

// 动态批处理引擎：同一批次内调度多个请求，
// 每个请求拥有独立的 processor 参数与可变状态。
export class BatchEngine {
  constructor({ vocabSize = 32, seed = 42 } = {}) {
    this.vocabSize = vocabSize;
    this.seed = seed;
    this.store = new StateStore();
    this.rngs = new Map();
  }

  #rngFor(requestId) {
    if (!this.rngs.has(requestId)) {
      this.rngs.set(requestId, createRequestRng(this.seed, requestId));
    }
    return this.rngs.get(requestId);
  }

  #dropRng(requestId) {
    this.rngs.delete(requestId);
  }

  run(scenario) {
    const tokenResults = [];
    const cancellations = [];
    const branchEvents = [];
    const finished = [];

    for (const request of scenario.requests) {
      this.store.create(request.id, request.params, request.history ?? []);
    }

    const cancelsAt = groupByStep(scenario.cancels ?? []);
    const branchesAt = groupByStep(scenario.branches ?? []);

    for (let step = 0; step < scenario.steps; step += 1) {
      for (const cancel of cancelsAt.get(step) ?? []) {
        if (this.store.release(cancel.id)) {
          this.#dropRng(cancel.id);
          cancellations.push({ step, requestId: cancel.id });
        }
      }

      for (const branch of branchesAt.get(step) ?? []) {
        const parent = this.store.get(branch.from);
        if (!parent) {
          continue;
        }
        const child = this.store.branch(branch.from, branch.id);
        branchEvents.push({
          step,
          from: branch.from,
          id: branch.id,
          copiedHistoryLength: child.history.length,
          historyIsCopy: child.history !== parent.history,
        });
      }

      for (const requestId of this.store.activeIds()) {
        const state = this.store.require(requestId);
        const rawLogits = generateLogits(this.vocabSize, step, this.seed);
        const { logits, trace } = runProcessorChain(
          rawLogits,
          state.params,
          state.history,
        );
        const token = sampleFromLogits(logits, this.#rngFor(requestId));
        state.append(token);

        const stopReason = checkStopCondition(state, token);
        tokenResults.push({
          step,
          requestId,
          token,
          processors: trace,
          stopped: stopReason !== null,
          stopReason,
        });

        if (stopReason !== null) {
          this.store.release(requestId);
          this.#dropRng(requestId);
          finished.push({ step, requestId, stopReason });
        }
      }
    }

    // 批次结束时释放所有仍活跃的请求，验证不存在残留引用。
    for (const requestId of this.store.activeIds()) {
      this.store.release(requestId);
      this.#dropRng(requestId);
    }

    const audit = this.store.audit();
    return {
      config: { vocabSize: this.vocabSize, seed: this.seed, steps: scenario.steps },
      tokens: tokenResults,
      cancellations,
      branches: branchEvents,
      finished,
      stateReuseErrors: audit.stateReuseErrors,
      residualReferences: audit.residualReferences,
    };
  }
}

function groupByStep(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.atStep)) {
      grouped.set(event.atStep, []);
    }
    grouped.get(event.atStep).push(event);
  }
  return grouped;
}
