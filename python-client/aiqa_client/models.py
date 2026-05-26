from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any


@dataclass
class RunAccepted:
    run_id: str


@dataclass
class RunSummary:
    passed: int
    failed: int
    total:  int


@dataclass
class RunMeta:
    run_id:       str
    type:         str
    status:       str                    # queued | running | passed | failed | error | cancelled
    summary:      Optional[RunSummary]  = None
    completed_at: Optional[str]         = None
    config:       Optional[Dict[str, Any]] = None

    @property
    def passed(self) -> bool:
        return self.status == "passed"

    @property
    def finished(self) -> bool:
        return self.status in ("passed", "failed", "error", "cancelled")


@dataclass
class HealthStatus:
    status:    str                           # ok | degraded | error
    version:   str
    uptime_ms: int
    checks:    Dict[str, Dict[str, str]] = field(default_factory=dict)


@dataclass
class RunRequest:
    content:  Optional[str]               = None
    file:     Optional[str]               = None
    env:      str                         = "dev"
    headless: bool                        = True
    tags:     Optional[List[str]]         = None
    vars:     Optional[Dict[str, str]]    = None


@dataclass
class RunAllRequest:
    dir:      str                         = "tests"
    env:      str                         = "dev"
    headless: bool                        = True
    workers:  int                         = 1
    tags:     Optional[List[str]]         = None
    vars:     Optional[Dict[str, str]]    = None
