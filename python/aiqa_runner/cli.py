"""
Entry point for the aiqa-runner Python wrapper.
Locates the AIQA Node CLI and delegates all arguments to it.
"""

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Known install location produced by install.sh
_CANDIDATE_SCRIPTS = [
    Path.home() / ".aiqa-runner" / "bin" / "aiqa.js",  # install.sh default
]

_MIN_NODE_MAJOR = 18


def _find_node() -> Optional[str]:
    return shutil.which("node")


def _find_aiqa_script() -> Optional[Path]:
    for candidate in _CANDIDATE_SCRIPTS:
        if candidate.exists():
            return candidate
    return None


def _node_version_ok(node: str) -> bool:
    try:
        out = subprocess.check_output(
            [node, "-e", "process.stdout.write(process.versions.node.split('.')[0])"],
            text=True,
        )
        return int(out.strip()) >= _MIN_NODE_MAJOR
    except Exception:
        return False


def main() -> None:
    # ── Prefer aiqa already in PATH (npm link or global install) ─────────────
    aiqa_bin = shutil.which("aiqa")
    if aiqa_bin:
        result = subprocess.run([aiqa_bin, *sys.argv[1:]])
        sys.exit(result.returncode)

    # ── Fall back to node + known script location ─────────────────────────────
    node = _find_node()
    if not node:
        _die_no_node()

    if not _node_version_ok(node):
        _die_old_node(node)

    script = _find_aiqa_script()
    if not script:
        _die_no_aiqa()

    result = subprocess.run([node, str(script), *sys.argv[1:]])
    sys.exit(result.returncode)


def _die_no_node() -> None:
    print(
        "[aiqa] Node.js not found.\n"
        "       Install Node.js 18+ from https://nodejs.org or run:\n"
        "         curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash",
        file=sys.stderr,
    )
    sys.exit(1)


def _die_old_node(node: str) -> None:
    print(
        f"[aiqa] Node.js at '{node}' is below the minimum required version ({_MIN_NODE_MAJOR}).\n"
        "       Install Node.js 18+ from https://nodejs.org",
        file=sys.stderr,
    )
    sys.exit(1)


def _die_no_aiqa() -> None:
    print(
        "[aiqa] AIQA CLI not found. Install it with:\n"
        "         # shell installer (Linux/macOS)\n"
        "         curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash\n"
        "\n"
        "         # Docker (no Node.js needed)\n"
        "         docker pull aiqa/aiqa",
        file=sys.stderr,
    )
    sys.exit(1)
