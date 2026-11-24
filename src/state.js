// 按请求独立的状态与状态仓库。
// 关键不变量：
// 1. 状态按 requestId 隔离，绝不按模型全局共享；
// 2. 分支（branch）必须深拷贝 token 历史，而不是共享同一个可变数组；
// 3. 取消或结束的请求必须释放状态，仓库中不得残留引用。

export class RequestState {
  constructor(id, params, history = [], meta = {}) {
    this.id = id;
    this.params = { ...params };
    this.history = [...history];
    this.promptLength = this.history.length;
    this.parentId = meta.parentId ?? null;
    this.released = false;
  }

  branch(newId) {
    if (this.released) {
      throw new Error(`无法从已释放的状态 ${this.id} 创建分支`);
    }
    return new RequestState(newId, this.params, this.history, {
      parentId: this.id,
    });
  }

  append(token) {
    if (this.released) {
      throw new Error(`状态 ${this.id} 已释放，禁止继续写入`);
    }
    this.history.push(token);
  }

  release() {
    this.released = true;
    this.history.length = 0;
  }
}

export class StateStore {
  #states = new Map();

  create(id, params, history = []) {
    if (this.#states.has(id)) {
      throw new Error(`请求 ${id} 的状态已存在，禁止覆盖`);
    }
    const state = new RequestState(id, params, history);
    this.#states.set(id, state);
    return state;
  }

  branch(fromId, newId) {
    const parent = this.require(fromId);
    const child = parent.branch(newId);
    if (this.#states.has(newId)) {
      throw new Error(`请求 ${newId} 的状态已存在，禁止覆盖`);
    }
    this.#states.set(newId, child);
    return child;
  }

  get(id) {
    return this.#states.get(id) ?? null;
  }

  require(id) {
    const state = this.get(id);
    if (!state) {
      throw new Error(`请求 ${id} 的状态不存在（可能已取消或结束）`);
    }
    return state;
  }

  // 取消/结束时释放状态并从仓库移除，避免残留引用污染后续批次。
  release(id) {
    const state = this.#states.get(id);
    if (!state) {
      return false;
    }
    state.release();
    this.#states.delete(id);
    return true;
  }

  activeIds() {
    return [...this.#states.keys()];
  }

  // 审计：检测状态复用错误（多个状态共享同一可变历史数组）
  // 与残留引用（已释放的状态仍留在仓库中）。
  audit() {
    const stateReuseErrors = [];
    const residualReferences = [];

    const seenHistories = new Map();
    for (const [id, state] of this.#states) {
      const owner = seenHistories.get(state.history);
      if (owner) {
        stateReuseErrors.push(
          `状态复用错误：请求 ${id} 与请求 ${owner} 共享同一个可变历史数组`,
        );
      } else {
        seenHistories.set(state.history, id);
      }
      if (state.released) {
        residualReferences.push(`残留引用：已释放的请求 ${id} 仍存在于状态仓库`);
      }
    }

    return { stateReuseErrors, residualReferences };
  }
}
