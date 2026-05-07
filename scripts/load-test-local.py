#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_ENDPOINTS = [
    ("GET", "/health", False),
    ("GET", "/api/v1/settings/public-profile", False),
    ("GET", "/api/v1/auth/me", True),
    ("GET", "/api/v1/requests?page=1&per_page=10", True),
    ("GET", "/api/v1/messages/counters", True),
    ("GET", "/api/v1/dashboard/stats", True),
]


@dataclass
class Result:
    method: str
    path: str
    status: int
    elapsed_ms: float
    error: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a lightweight local HTTP load test for FMS.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL.")
    parser.add_argument("--email", default="admin@qib.internal-bank.qa", help="Login email.")
    parser.add_argument("--password", default="Admin@12345", help="Login password.")
    parser.add_argument("--concurrency", type=int, default=10, help="Number of parallel workers.")
    parser.add_argument("--requests", type=int, default=300, help="Total requests to execute.")
    parser.add_argument("--timeout", type=float, default=10, help="Request timeout in seconds.")
    return parser.parse_args()


def request_json(url: str, method: str = "GET", token: str | None = None, body: dict | None = None, timeout: float = 10) -> tuple[int, bytes]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=data, method=method, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


def login(base_url: str, email: str, password: str, timeout: float) -> str | None:
    try:
        status, body = request_json(f"{base_url}/api/v1/auth/login", "POST", body={"email": email, "password": password}, timeout=timeout)
    except Exception as exc:
        print(f"Login failed: {exc}")
        return None
    if status >= 400:
        print(f"Login failed with HTTP {status}")
        return None
    payload = json.loads(body.decode("utf-8"))
    return payload.get("access_token")


def hit(base_url: str, endpoint: tuple[str, str, bool], token: str | None, timeout: float) -> Result:
    method, path, needs_auth = endpoint
    started = time.perf_counter()
    try:
        status, _ = request_json(f"{base_url}{path}", method, token=token if needs_auth else None, timeout=timeout)
        return Result(method, path, status, (time.perf_counter() - started) * 1000)
    except HTTPError as exc:
        return Result(method, path, exc.code, (time.perf_counter() - started) * 1000, str(exc))
    except URLError as exc:
        return Result(method, path, 0, (time.perf_counter() - started) * 1000, str(exc.reason))
    except Exception as exc:
        return Result(method, path, 0, (time.perf_counter() - started) * 1000, str(exc))


def percentile(values: list[float], percent: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((percent / 100) * (len(ordered) - 1))))
    return ordered[index]


def main() -> None:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    token = login(base_url, args.email, args.password, args.timeout)
    endpoints = DEFAULT_ENDPOINTS if token else [item for item in DEFAULT_ENDPOINTS if not item[2]]

    started = time.perf_counter()
    results: list[Result] = []
    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        futures = [pool.submit(hit, base_url, endpoints[index % len(endpoints)], token, args.timeout) for index in range(args.requests)]
        for future in as_completed(futures):
            results.append(future.result())
    elapsed = time.perf_counter() - started

    durations = [item.elapsed_ms for item in results]
    errors = [item for item in results if item.status == 0 or item.status >= 400]
    print("FMS local load test")
    print(f"Base URL: {base_url}")
    print(f"Requests: {len(results)}")
    print(f"Concurrency: {args.concurrency}")
    print(f"Elapsed: {elapsed:.2f}s")
    print(f"Throughput: {len(results) / elapsed:.2f} req/s")
    print(f"Errors: {len(errors)} ({(len(errors) / max(1, len(results))) * 100:.2f}%)")
    print(f"Latency avg: {statistics.mean(durations):.2f} ms")
    print(f"Latency p50: {percentile(durations, 50):.2f} ms")
    print(f"Latency p95: {percentile(durations, 95):.2f} ms")
    print(f"Latency p99: {percentile(durations, 99):.2f} ms")
    print("\nBy endpoint:")
    for method, path, _ in DEFAULT_ENDPOINTS:
        subset = [item for item in results if item.method == method and item.path == path]
        if not subset:
            continue
        subset_durations = [item.elapsed_ms for item in subset]
        subset_errors = [item for item in subset if item.status == 0 or item.status >= 400]
        print(
            f"- {method} {path}: count={len(subset)} errors={len(subset_errors)} "
            f"avg={statistics.mean(subset_durations):.2f}ms p95={percentile(subset_durations, 95):.2f}ms"
        )
    if errors[:5]:
        print("\nSample errors:")
        for item in errors[:5]:
            print(f"- {item.method} {item.path}: status={item.status} error={item.error}")


if __name__ == "__main__":
    main()
