"""Unified LLM client — supports any provider via LiteLLM.

Configure via the AGENT_MODEL environment variable:
    claude-sonnet-4-6                  → Anthropic
    gpt-4o-mini                        → OpenAI
    gemini/gemini-2.5-flash            → Google Gemini
    ollama/llama3.2                    → Local Ollama
    ollama_chat/qwen2.5:14b            → Local Ollama (chat-format)
    openrouter/anthropic/claude-3.5    → OpenRouter
    azure/<deployment-name>            → Azure OpenAI

Per-provider auth is read from standard env vars:
    ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
    OLLAMA_API_BASE (default http://localhost:11434), etc.
"""
from __future__ import annotations

import json
import logging
import os
import warnings
from typing import Any

# Quiet litellm's pre-load and proxy warnings — they're noise for our use case
warnings.filterwarnings("ignore")
logging.getLogger("LiteLLM").setLevel(logging.ERROR)

import litellm  # noqa: E402

litellm.suppress_debug_info = True

DEFAULT_MODEL = os.environ.get("AGENT_MODEL", "claude-sonnet-4-6")


def current_model() -> str:
    return os.environ.get("AGENT_MODEL", DEFAULT_MODEL)


def provider_of(model: str) -> str:
    """Best-effort provider name from model string."""
    if model.startswith("claude") or model.startswith("anthropic/"):
        return "anthropic"
    if model.startswith("gpt") or model.startswith("openai/") or model.startswith("o1") or model.startswith("o3"):
        return "openai"
    if model.startswith("gemini") or model.startswith("vertex_ai/"):
        return "gemini"
    if model.startswith("ollama"):
        return "ollama"
    if model.startswith("openrouter/"):
        return "openrouter"
    if model.startswith("azure/"):
        return "azure"
    return "unknown"


def required_env_for(model: str) -> str | None:
    """Return the env var name needed for the given model, or None if not required."""
    p = provider_of(model)
    return {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
        "gemini": "GEMINI_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "azure": "AZURE_API_KEY",
        "ollama": None,  # no key needed for local Ollama
    }.get(p)


def call_tool(
    system: str,
    user: str,
    tool: dict[str, Any],
    *,
    model: str | None = None,
    max_tokens: int = 2048,
) -> dict[str, Any]:
    """
    Force the model to invoke the given function-style tool and return its arguments dict.

    `tool` must be in OpenAI function-spec format:
        {
            "name": "...",
            "description": "...",
            "parameters": { JSON Schema object },
        }

    Tool calling is normalised by LiteLLM across Anthropic / OpenAI / Gemini / Ollama, etc.
    """
    chosen_model = model or current_model()

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    tools_payload = [{"type": "function", "function": tool}]

    kwargs: dict[str, Any] = {
        "model": chosen_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "tools": tools_payload,
    }

    # Ollama's tool support varies by underlying model — force-choice can break it.
    # For everyone else we force the specific tool to guarantee structured output.
    if provider_of(chosen_model) != "ollama":
        kwargs["tool_choice"] = {"type": "function", "function": {"name": tool["name"]}}

    try:
        response = litellm.completion(**kwargs)
    except Exception as e:
        raise RuntimeError(f"LLM call failed (model={chosen_model}): {e}") from e

    msg = response.choices[0].message
    tool_calls = getattr(msg, "tool_calls", None) or []

    if tool_calls:
        first = tool_calls[0]
        args_str = first.function.arguments
        try:
            return json.loads(args_str) if isinstance(args_str, str) else dict(args_str)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Tool args were not valid JSON: {args_str!r}") from e

    # Fallback: some local models emit JSON in `content` instead of a structured tool call.
    raw = (msg.content or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    if raw.startswith("{"):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

    raise RuntimeError(
        f"Model {chosen_model} did not call tool '{tool['name']}' "
        f"and content was not parseable JSON. Got: {raw[:200]!r}"
    )
