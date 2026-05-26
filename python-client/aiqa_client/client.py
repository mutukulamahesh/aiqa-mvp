"""
AIQA Python client — calls the AIQA REST API (aiqa serve).
Zero runtime dependencies: uses only stdlib urllib + json.

Quick start:
    from aiqa_client import AiqaClient

    client = AiqaClient("http://localhost:7432", api_key="your-key")
    run    = client.run_all("tests/", headless=True, workers=2)
    result = client.wait_for_run(run.run_id, timeout=300)
    print("passed" if result.passed else f"failed: {result.summary}")
"""

import json
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .exceptions import AiqaError, AiqaTimeoutError
from .models import (
    HealthStatus, RunAccepted, RunAllRequest, RunMeta, RunRequest, RunSummary,
)


class AiqaClient:
    """
    Thin HTTP wrapper around the AIQA REST API.

    Args:
        base_url: URL where `aiqa serve` is listening (default: http://localhost:7432).
        api_key:  Value of AIQA_API_KEY on the server. Omit when the server runs
                  with AIQA_ALLOW_OPEN_MODE=true (local dev only).
        timeout:  Per-request HTTP timeout in seconds (default: 30).
    """

    def __init__(
        self,
        base_url: str = "http://localhost:7432",
        *,
        api_key: Optional[str] = None,
        timeout: int = 30,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout

    # ── Trigger endpoints ──────────────────────────────────────────────────────

    def run(self, request: RunRequest) -> RunAccepted:
        """Submit a single test file or inline YAML content."""
        body: Dict[str, Any] = {"env": request.env, "headless": request.headless}
        if request.content: body["content"] = request.content
        if request.file:    body["file"]    = request.file
        if request.tags:    body["tags"]    = request.tags
        if request.vars:    body["vars"]    = request.vars
        return RunAccepted(run_id=self._post("/api/run", body)["runId"])

    def run_file(self, file: str, *, env: str = "dev", headless: bool = True) -> RunAccepted:
        """Convenience: run a single YAML file by path."""
        return self.run(RunRequest(file=file, env=env, headless=headless))

    def run_all(
        self,
        test_dir: str = "tests",
        *,
        env: str = "dev",
        headless: bool = True,
        workers: int = 1,
        tags: Optional[List[str]] = None,
        vars: Optional[Dict[str, str]] = None,
    ) -> RunAccepted:
        """Submit a full test suite directory."""
        return RunAccepted(run_id=self._post("/api/run-all", {
            "dir": test_dir, "env": env, "headless": headless,
            "workers": workers,
            **({"tags": tags} if tags else {}),
            **({"vars": vars} if vars else {}),
        })["runId"])

    def orchestrate(self, url: str, *, env: str = "dev", headless: bool = True, **kwargs: Any) -> RunAccepted:
        """Submit a full explore → generate → run pipeline."""
        return RunAccepted(run_id=self._post("/api/orchestrate", {
            "url": url, "env": env, "headless": headless, **kwargs,
        })["runId"])

    def cancel(self, run_id: str) -> RunMeta:
        """Cancel a queued or running job."""
        data = self._post(f"/api/runs/{run_id}/cancel", {})
        return self._parse_run_meta(data)

    # ── Query endpoints ────────────────────────────────────────────────────────

    def health(self) -> HealthStatus:
        """Return server health (unauthenticated — no API key needed)."""
        data = self._get("/api/health", authenticated=False)
        return HealthStatus(
            status=data.get("status", "unknown"),
            version=data.get("version", "unknown"),
            uptime_ms=data.get("uptimeMs", 0),
            checks=data.get("checks", {}),
        )

    def get_run(self, run_id: str) -> RunMeta:
        """Fetch metadata for a single run."""
        return self._parse_run_meta(self._get(f"/api/runs/{run_id}"))

    def list_runs(self, limit: int = 20, type: Optional[str] = None) -> List[RunMeta]:
        """List recent runs."""
        params = f"?limit={limit}" + (f"&type={type}" if type else "")
        items = self._get(f"/api/runs{params}")
        return [self._parse_run_meta(r) for r in items]

    def get_results(self, run_id: str) -> Any:
        """Fetch raw test results JSON for a completed run."""
        return self._get(f"/api/runs/{run_id}/results")

    # ── Polling helper ─────────────────────────────────────────────────────────

    def wait_for_run(
        self,
        run_id: str,
        *,
        timeout: int = 300,
        poll_interval: float = 2.0,
        max_poll_interval: float = 10.0,
    ) -> RunMeta:
        """
        Poll until the run reaches a terminal state or timeout expires.

        Uses capped exponential back-off: starts at poll_interval, doubles each
        check, caps at max_poll_interval — balances responsiveness vs. server load.

        Raises:
            AiqaTimeoutError: if the run does not finish within timeout seconds.
            AiqaError:        if the server returns an error response while polling.
        """
        deadline = time.monotonic() + timeout
        interval = poll_interval
        while True:
            meta = self.get_run(run_id)
            if meta.finished:
                return meta
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AiqaTimeoutError(
                    f"Run {run_id} did not finish within {timeout}s (last status: {meta.status})",
                    status_code=0,
                )
            time.sleep(min(interval, remaining, max_poll_interval))
            interval = min(interval * 2, max_poll_interval)

    # ── Internal ───────────────────────────────────────────────────────────────

    def _headers(self, authenticated: bool = True) -> Dict[str, str]:
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if authenticated and self._api_key:
            h["Authorization"] = f"Bearer {self._api_key}"
        return h

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        url = self._base + path
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")
        return self._send(req)

    def _get(self, path: str, *, authenticated: bool = True) -> Any:
        url = self._base + path
        req = urllib.request.Request(url, headers=self._headers(authenticated), method="GET")
        return self._send(req)

    def _send(self, req: urllib.request.Request) -> Any:
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            try:
                msg = json.loads(body).get("error", body)
            except Exception:
                msg = body
            raise AiqaError(msg, status_code=e.code) from e
        except urllib.error.URLError as e:
            raise AiqaError(f"Cannot reach AIQA server at {self._base}: {e.reason}") from e

    @staticmethod
    def _parse_run_meta(data: Dict[str, Any]) -> RunMeta:
        raw_summary = data.get("summary")
        summary = RunSummary(
            passed=raw_summary["passed"],
            failed=raw_summary["failed"],
            total=raw_summary["total"],
        ) if raw_summary else None
        return RunMeta(
            run_id=data.get("runId", ""),
            type=data.get("type", ""),
            status=data.get("status", ""),
            summary=summary,
            completed_at=data.get("completedAt"),
            config=data.get("config"),
        )
