"""
Unified LLM client for Sylor.
Wraps Anthropic Claude API with retry, JSON extraction, and streaming support.
Improved upon MiroFish's OpenAI-compatible client with:
- Native async support (vs sync in MiroFish)
- Anthropic-native API (not OpenAI compat shim)
- Robust JSON repair pipeline from MiroFish
- Streaming support for long generations
- Think-tag stripping from MiroFish
"""
import json
import re
import asyncio
from typing import Optional, Dict, Any, AsyncIterator
from dataclasses import dataclass

import anthropic
from app.config import settings


@dataclass
class LLMResponse:
    """Structured response from the LLM client."""
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    stop_reason: Optional[str] = None


class LLMClient:
    """
    Async Anthropic Claude client with retry logic, JSON extraction,
    and streaming support.
    """

    DEFAULT_MODEL = "claude-sonnet-4-6"
    MAX_RETRIES = 3
    RETRY_DELAY = 1.0

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.api_key = api_key or settings.anthropic_api_key
        self.model = model or self.DEFAULT_MODEL
        self._client: Optional[anthropic.AsyncAnthropic] = None

    @property
    def client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=self.api_key)
        return self._client

    async def chat(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """Send a chat completion request with retry."""
        for attempt in range(self.MAX_RETRIES):
            try:
                kwargs: Dict[str, Any] = {
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "messages": messages,
                    "temperature": temperature,
                }
                if system:
                    kwargs["system"] = system

                response = await self.client.messages.create(**kwargs)
                text = response.content[0].text

                # Strip think tags (from MiroFish pattern - some models include reasoning blocks)
                text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

                return LLMResponse(
                    text=text,
                    model=response.model,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    stop_reason=response.stop_reason,
                )

            except anthropic.RateLimitError:
                if attempt < self.MAX_RETRIES - 1:
                    delay = self.RETRY_DELAY * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise
            except anthropic.APIError as e:
                if attempt < self.MAX_RETRIES - 1 and e.status_code >= 500:
                    delay = self.RETRY_DELAY * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise

        raise RuntimeError("Max retries exceeded for LLM call")

    async def chat_json(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> Dict[str, Any]:
        """
        Chat and extract a JSON object from the response.
        Uses MiroFish's multi-stage JSON repair pipeline, improved for Anthropic.
        """
        if system:
            system = system + "\n\nYou MUST respond with ONLY valid JSON. No markdown fences, no explanation."
        else:
            system = "You MUST respond with ONLY valid JSON. No markdown fences, no explanation."

        response = await self.chat(
            messages=messages,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        return self._extract_json(response.text)

    async def stream(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """Stream text tokens from Claude."""
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
            "temperature": temperature,
        }
        if system:
            kwargs["system"] = system

        async with self.client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    async def stream_collect(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> str:
        """Stream and collect the full response text."""
        chunks = []
        async for chunk in self.stream(messages, system, temperature, max_tokens):
            chunks.append(chunk)
        return "".join(chunks)

    # ── JSON Extraction Pipeline (adapted from MiroFish + Sylor context.py) ──

    def _extract_json(self, text: str) -> Dict[str, Any]:
        """
        Robust JSON extraction with multi-stage repair.
        Combines best patterns from MiroFish and Sylor's context.py.
        """
        # Stage 1: Strip markdown code fences
        fenced = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
        if fenced:
            text = fenced.group(1).strip()

        # Stage 2: Isolate JSON object
        start = text.find("{")
        if start < 0:
            raise ValueError("No JSON object found in response")
        end = text.rfind("}") + 1
        if end <= start:
            # Truncated response - try repair
            raw = text[start:]
            return self._repair_and_parse(raw)

        raw = text[start:end]

        # Stage 3: Standard cleanups
        raw = re.sub(r'(?<!["\w])//[^\n]*', '', raw)  # line comments
        raw = re.sub(r',(\s*[}\]])', r'\1', raw)  # trailing commas

        # Fix control chars inside strings
        def fix_control_chars(m):
            s = m.group(0)
            s = s.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
            return s
        raw = re.sub(r'"(?:[^"\\]|\\.)*"', fix_control_chars, raw, flags=re.DOTALL)

        # Stage 4: Fast path
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # Stage 5: Truncation recovery (from MiroFish + Sylor)
        return self._repair_and_parse(raw)

    def _repair_and_parse(self, raw: str) -> Dict[str, Any]:
        """
        Multi-strategy JSON repair pipeline.
        Adapted from MiroFish's 7-strategy approach.
        """
        strategies = [
            self._repair_truncated,
            self._repair_bracket_balance,
            self._repair_regex_extract,
            self._repair_strip_control,
        ]

        for strategy in strategies:
            try:
                repaired = strategy(raw)
                repaired = re.sub(r',(\s*[}\]])', r'\1', repaired)
                return json.loads(repaired)
            except (json.JSONDecodeError, ValueError):
                continue

        raise ValueError(f"Could not parse JSON after all repair strategies. Input starts with: {raw[:200]}")

    def _repair_truncated(self, text: str) -> str:
        """Close truncated JSON by tracking structure (from Sylor context.py)."""
        s = text.rstrip()
        stack = []
        in_string = False
        escape_next = False

        for ch in s:
            if escape_next:
                escape_next = False
                continue
            if ch == '\\' and in_string:
                escape_next = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == '{':
                stack.append('o')
            elif ch == '[':
                stack.append('a')
            elif ch in ']}':
                if stack:
                    stack.pop()

        if in_string:
            s += '"'

        # Remove trailing incomplete items
        s = re.sub(r',\s*"[^"]*"?\s*:\s*[^,\}\]]*$', '', s)
        s = re.sub(r',\s*\{[^}]*$', '', s)
        s = re.sub(r',\s*"[^"]*$', '', s)
        s = re.sub(r',\s*$', '', s)

        for kind in reversed(stack):
            s += ']' if kind == 'a' else '}'

        return s

    def _repair_bracket_balance(self, text: str) -> str:
        """Balance brackets by counting opens/closes."""
        opens = text.count('{') - text.count('}')
        arr_opens = text.count('[') - text.count(']')

        result = text
        if arr_opens > 0:
            result += ']' * arr_opens
        if opens > 0:
            result += '}' * opens

        return result

    def _repair_regex_extract(self, text: str) -> str:
        """Try to extract the largest valid JSON object via regex."""
        # Find all potential JSON objects
        candidates = re.findall(r'\{[^{}]*\}', text)
        if candidates:
            # Return the longest one
            return max(candidates, key=len)
        return text

    def _repair_strip_control(self, text: str) -> str:
        """Strip control characters that break JSON parsing."""
        cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
        return self._repair_truncated(cleaned)


# Singleton instance
llm_client = LLMClient()
