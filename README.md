# inference-logit-processor-state-validator
验证 logit processor 链、批量状态和分支复用

> **注意：本项目中所有 logits、采样分数与 token 序列均为模拟数据**，
> 由确定性伪随机数生成器（`src/prng.js`）与正弦/余弦伪 logits 生成器
> （`src/logits.js`）产生，不来自任何真实模型，仅用于验证状态管理逻辑。

## 背景

动态批处理中，每个请求有不同的 temperature、重复惩罚和停止条件。
若状态缓存按模型全局共享，一个请求的可变 token 历史会污染批内其他请求。
本项目在 Node.js 24.16.0 上验证 logit processor 链的按请求独立状态：

- 每个请求拥有独立的 `RequestState`（参数 + token 历史），按 `requestId` 隔离存取；
- 同一请求的多分支通过深拷贝复制历史，而不是共享可变数组；
- 取消或结束的请求立即释放状态，批次结束后审计残留引用。

## 运行

```bash
node --test                          # 运行全部测试
node src/cli.js scenarios/demo.json  # 运行演示场景并输出 JSON 报告
```

## 输入（scenario JSON）

- `vocabSize` / `seed` / `steps`：模拟词表大小、随机种子、批处理步数；
- `requests[]`：`id`、`params`（`temperature`、`repetitionPenalty`、`stopTokens`、`maxTokens`）、`history`（已有 token 历史）；
- `branches[]`：`{ atStep, from, id }`，在指定步从某请求分叉；
- `cancels[]`：`{ atStep, id }`，在指定步取消某请求。

## 输出（JSON 报告）

- `tokens[]`：每个 token 的处理器链逐项结果（temperature 缩放前后 top logit、
  重复惩罚作用的 token 列表）、采样结果与停止原因；
- `branches[]`：分支事件，含复制的历史长度与 `historyIsCopy`（确认为拷贝而非共享）；
- `cancellations[]` / `finished[]`：取消与正常结束事件；
- `stateReuseErrors[]`：状态复用错误（多个请求共享同一可变历史数组）；
- `residualReferences[]`：残留引用（已释放状态仍留在仓库中）。

正确实现下 `stateReuseErrors` 与 `residualReferences` 均为空数组；
`StateStore.audit()` 可主动检测这两类污染。

## 测试覆盖

- 不同 temperature 的缩放行为与批内参数隔离；
- 重复惩罚只作用于本请求的 token 历史（含负 logit 乘法分支）；
- 多分支复制历史后独立演化，父请求不受影响；
- 批内取消后状态立即释放、不再产生 token、无残留引用；
- 停止条件（stop token / maxTokens）触发后结束并释放；
- 相同种子与场景下结果完全可复现。
