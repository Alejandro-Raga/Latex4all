#!/usr/bin/env python3
"""
How well can a request's usage be told before it's sent? Replays Claude
Code's own transcripts (~/.claude/projects/*/*.jsonl), which record every
model call's tokens, and checks what the chat's usage indicators rely on.

    python3 scripts/usage-backtest.py

A "request" is a typed prompt and every model call until the next one.
Cost is weighed as Claude prices tokens: cache writes 1.25x, cache reads
0.1x, output 5x.

Findings that shaped the indicators (2026-10, 573 requests):
- The minimum a message reads (the chat so far, once) held in 99%: shown.
- A single request's cost could not be predicted: ~70-80% median error,
  ~40% within 2x, whatever the method; ranges wide enough to be right
  (7-10x) say little. So no per-message estimate is shown before sending;
  what a reply used is measured after it.
"""
import glob, json, os, statistics as st


def weighted(u):
    return (u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) * 1.25
            + u.get("cache_read_input_tokens", 0) * 0.1 + u.get("output_tokens", 0) * 5)


def context(u):
    return (u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
            + u.get("cache_read_input_tokens", 0))


def requests_of(path):
    reqs, cur, seen = [], None, set()
    for line in open(path, errors="ignore"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("isSidechain"):
            continue
        if e.get("type") == "user":
            c = e.get("message", {}).get("content")
            text = c if isinstance(c, str) else "".join(
                b.get("text", "") for b in (c or []) if isinstance(b, dict) and b.get("type") == "text")
            tool = isinstance(c, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c)
            if text.strip() and not tool and not text.startswith("<"):
                cur = {"text": text, "calls": []}
                reqs.append(cur)
        elif e.get("type") == "assistant" and cur is not None:
            m = e.get("message", {})
            if m.get("usage") and m.get("id") not in seen:
                seen.add(m.get("id"))
                cur["calls"].append(m["usage"])
    return [r for r in reqs if r["calls"]]


def q(xs, p):
    s = sorted(xs)
    return s[min(len(s) - 1, int(p * (len(s) - 1) + 0.5))]


floor_ok, n, ratios, errors = 0, 0, [], []
for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
    reqs = requests_of(path)
    for i in range(1, len(reqs)):
        r, prev = reqs[i], reqs[i - 1]
        actual = sum(weighted(u) for u in r["calls"])
        if actual <= 0:
            continue
        floor = context(prev["calls"][-1]) * 0.1 + len(r["text"]) / 4 * 1.25 + 1000
        n += 1
        floor_ok += actual >= floor * 0.95
        ratios.append(actual / floor)
        # The best simple predictor found: the median of the chat's last three.
        hist = [sum(weighted(u) for u in h["calls"]) for h in reqs[max(0, i - 3):i]]
        errors.append(st.median(hist) / actual)

if not n:
    raise SystemExit("No Claude Code transcripts found in ~/.claude/projects.")
print(f"{n} requests")
print(f"at least the minimum: {floor_ok / n * 100:.0f}%")
print(f"actual / minimum: median {q(ratios, .5):.1f}x, p25 {q(ratios, .25):.1f}x, p90 {q(ratios, .9):.1f}x")
print(f"best single-number prediction: median error {st.median([abs(r - 1) for r in errors]) * 100:.0f}%, "
      f"within 2x either way {sum(1 for r in errors if 0.5 <= r <= 2) / len(errors) * 100:.0f}%")
