# AI SDK v7 Opportunities

Status: advisory follow-up report, prepared during the AI SDK v7 compatibility migration on 2026-09-16. None of the opportunities below are implemented by this migration.

## Upgrade baseline

| Package | Previous | Requested | Resolved |
| --- | ---: | ---: | ---: |
| `ai` | `^6.0.208` | `^7.0.102` | `7.0.102` |
| `@ai-sdk/openai` | `^3.0.73` | `^4.0.67` | `4.0.67` |
| `ai-sdk-provider-claude-code` | `^3.5.0` | `^4.3.1` | `4.3.1` |
| `ai-sdk-provider-codex-cli` | `^1.2.2` | `^2.2.1` | `2.2.1` |
| `ollama-ai-provider-v2` | `^3.6.0` | `^4.0.1` | `4.0.1` |

The resolved graph uses AI SDK Provider V4 and provider-utils V5. The application already satisfies the v7 runtime baseline with Node 24, ESM, and Zod 4.

## Observed migration effects

The v7 codemod made the two expected production changes in the local AI stream adapter:

- `result.fullStream` became `result.stream`.
- `includeRawChunks: true` became `include: { rawChunks: true }`.

The corresponding unit fixtures now expose `stream`, and their call assertions check `include.rawChunks`. Abort propagation, tool-event capture, raw-output artifacts, and the existing provider security settings remain unchanged.

The codemod also proposed renaming an unrelated domain object's `system` field to `instructions`. That was a false positive and was reverted before dependency installation.

## Provider compatibility notes

- `@ai-sdk/openai` 4.x is the official Provider V4 implementation. The existing `createOpenAI` composition remains supported, including structured output through `generateText` or `streamText` with `Output`.
- `ai-sdk-provider-claude-code` 4.x implements Provider V4 and supports schema-backed `Output.object()`, `Output.array()`, and `Output.choice()`. Schema-less `Output.json()` is not supported. Session IDs and timing data are exposed through `finalStep.providerMetadata['claude-code']`. Workflow model serialization is explicitly deferred by the provider.
- `ai-sdk-provider-codex-cli` 2.x implements Provider V4. `createCodexCli` remains a backward-compatible alias for exec mode. Native JSON Schema output is available, but strict OpenAI schema rules reject optional fields and strip some format and pattern validators; the current report schema therefore needs a compatibility design before it can be sent directly.
- `ollama-ai-provider-v2` 4.x implements Provider V4 and retains `createOllama`. Reasoning support is available for compatible local models. Structured-output conformance should be verified per Ollama model and server version before using the full report schema.
- All local CLI providers remain server-only. Existing no-write/no-tool Claude settings, read-only/no-approval Codex settings, and configurable Ollama base URL should remain the default security posture.

## Prioritized opportunities

### 1. Generate validated data with `Output.object()`

AI SDK v7 makes structured output part of `generateText` and `streamText`. The strongest immediate fit is to pass a schema through `Output.object({ schema })` and consume the typed `output`, rather than extracting a JSON-looking substring from text and then performing a repair generation.

Candidate rollout order:

1. Start with the smaller source-summary and evaluation payloads used by the local AI HTTP pipeline. Their constrained shapes are easier to validate across all four providers.
2. Introduce an output-capability seam on the provider-neutral report-generation port so unsupported providers can keep the current text fallback.
3. Adapt `zGeneratedReportData` for provider schema constraints, then compare validity rate, repair-call rate, latency, and token use against the existing parser.
4. Remove the bounded repair pass only after provider-by-provider tests show equivalent or better behavior.

This should reduce ad-hoc JSON extraction and many repair calls while preserving the domain schema as the final validation authority. Codex CLI's required-field limitation and model-dependent Ollama behavior make a single unconditional switch unsafe.

### 2. Connect stable lifecycle callbacks and OpenTelemetry

AI SDK v7 exposes stable lifecycle callbacks including `onStart`, `onStepStart`, `onStepEnd`, `onChunk`, `onEnd`, and model/tool-specific events. These can replace custom observation code at the SDK boundary or feed the existing application event model without changing domain contracts.

The project already initializes OpenTelemetry in `src/composition/telemetry`. A follow-up can add `@ai-sdk/otel`, call `registerTelemetry(new OpenTelemetry(...))` once during server startup, and connect it to the existing tracer provider. Recommended guardrails:

- Assign low-cardinality operation names such as report generation, source summary, and evaluation.
- Correlate spans with the existing run ID through selected runtime context.
- Disable input/output recording for prompts or generated text that may contain private research data.
- Keep callback work fast; enqueue persistence or aggregation outside the generation path.

### 3. Persist v7 usage and performance metadata

In v7, `result.usage` is accumulated across all steps; `totalUsage` is deprecated. `result.finalStep` (or `await result.finalStep` for streaming) provides final-step-only usage, warnings, finish reason, request/response metadata, provider metadata, and performance data.

The report-generation metadata can record a normalized subset:

- aggregate input, output, reasoning, cached-input, and total token counts from `usage`;
- per-step and final finish reasons and warnings;
- first-output, model-response, step, and effective throughput timings when available;
- provider metadata such as Claude/Codex session identifiers and provider-reported timings, after filtering sensitive fields;
- whether a structured-output validation or repair path was used.

This would make repair cost, local-versus-hosted performance, truncation, unsupported settings, and model regressions visible without exposing provider-specific data through app-facing ports.

### 4. Standardize reasoning and timeouts

The top-level `reasoning` option provides a provider-neutral control from `none` through `xhigh`, with `provider-default` preserving native behavior. OpenAI, Codex CLI, Claude Code, and compatible Ollama models can map this setting, although provider-specific settings take precedence and providers may coerce unsupported levels.

The structured `timeout` option can independently bound total time, each model step, first streamed content, gaps between streamed content, tool execution, and individual tools. A follow-up configuration object could map report pipeline policies to `totalMs`, `stepMs`, `firstChunkMs`, and `chunkMs` while continuing to forward the user's abort signal.

Use these as operational controls, not as a reason to persist or display hidden reasoning content. Record selected settings and warnings, but treat reasoning text and provider metadata as potentially sensitive.

### 5. Evaluate `rerank()` for evidence selection

`rerank()` could reorder collected source excerpts against a report topic or research question before synthesis. This may let the generator receive fewer, more relevant excerpts and improve citation density.

This is not available from the currently installed generation providers alone. It requires a reranking-capable provider/model such as Cohere, Amazon Bedrock, or Together.ai, plus evaluation data, cost controls, and a defined fallback. Treat it as a retrieval-quality experiment rather than part of the v7 migration.

### 6. Evaluate experimental batch APIs for large jobs

The experimental batch lifecycle (`experimental_startBatch`, `experimental_getBatchStatus`, `experimental_getBatchResults`, `experimental_cancelBatch`, and `experimental_listBatches`) could reduce cost or request pressure for large independent source-summary jobs.

Batch support is experimental and provider-specific. OpenAI supports text batches through its Responses API, while the currently installed Claude Code, Codex CLI, and Ollama community providers do not expose the first-party batch interface described by AI SDK. Adoption would require persistent batch references, idempotent request IDs, polling or workflow scheduling, partial-failure handling, and a synchronous fallback.

## Explicitly deferred or poor-fit APIs

- `ToolLoopAgent`: the current report flow is a deterministic application pipeline with explicit ports, bounded repair, and externally controlled tools. Converting it to an autonomous loop would alter control flow, observability, and failure semantics. Consider it only in a separate agent-design task.
- `WorkflowAgent`: durable pause/resume can be useful for long-running research, but it introduces `@ai-sdk/workflow`, serializable step state, tool approval semantics, and provider serialization requirements. Claude Code's provider currently defers workflow serialization, so the installed provider set cannot be treated uniformly.
- File uploads and generated files: there is no current report-pipeline requirement to pass files directly to models. Existing source ingestion and URL handling should remain authoritative until a separately scoped data-retention and media-security design exists.
- Provider-specific sessions: Claude Code and Codex app-server sessions may reduce repeated context setup, but they create lifecycle, retention, recovery, and cross-provider parity concerns. The deterministic pipeline should remain stateless at its application boundary unless a separate design demonstrates value.

## Suggested follow-up sequence

1. Add normalized usage, warning, finish-reason, and performance metadata.
2. Register `@ai-sdk/otel` with the existing telemetry composition, with prompt/output recording disabled by default.
3. Pilot `Output.object()` on one small source-summary schema across OpenAI, Claude Code, Codex CLI, and representative Ollama models.
4. Design a provider-capability/fallback contract before applying structured output to `zGeneratedReportData`.
5. Evaluate reranking and batch processing independently with explicit quality, latency, and cost targets.

## Official references

- [AI SDK 7 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)
- [Generating structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [Lifecycle callbacks](https://ai-sdk.dev/docs/ai-sdk-core/lifecycle-callbacks)
- [Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [Reasoning](https://ai-sdk.dev/docs/ai-sdk-core/reasoning)
- [Reranking](https://ai-sdk.dev/docs/ai-sdk-core/reranking)
- [Batch processing](https://ai-sdk.dev/docs/ai-sdk-core/batch)
- [Building agents](https://ai-sdk.dev/docs/agents/building-agents)
