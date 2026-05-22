# brain.providers

## Owns

The LLM provider abstraction: the `LLMProvider` protocol, the OpenAI adapter (GPT-4.1 via `langchain-openai`), the Gemini adapter (Gemini 2.5 Flash via `langchain-google-genai`), the default + fallback router (LangChain `with_fallbacks` inside `call_llm` per ARCHITECTURE.md §3 / LLM-05), and the `tenacity` retry policy for transient errors.

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 5: `LLMProvider` protocol, `OpenAIProvider`, `GeminiProvider`, `build_router(default, fallback)`, tenacity-wrapped `ainvoke`, token-usage extraction for the response envelope.

## Do NOT

- import AsyncOpenAI or google.genai outside this package (lint enforced in Phase 5).
- Hand-roll fallback chains in `brain.graph` — keep the router behind a single function call so Langfuse traces nest cleanly (ARCHITECTURE.md §3).
- Install the `langchain` meta-package (STACK.md §10). Use only `langchain-core` + `langchain-openai` + `langchain-google-genai`.
