# aiqa-runner

Python wrapper for the [AIQA Enterprise AI QA Platform](https://github.com/mutukulamahesh/aiqa-mvp).

Your tests are written in plain YAML. This package gives Python teams a familiar `pip install` + `aiqa` command without touching Node.js directly.

## Install

```bash
pip install aiqa-runner
```

Then install the AIQA CLI (one-time):

```bash
curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash
```

## Usage

```bash
aiqa run tests/login.yaml
aiqa run-all tests/ --headless
aiqa --help
```

All arguments are forwarded directly to the AIQA Node CLI. Every command documented at [github.com/mutukulamahesh/aiqa-mvp](https://github.com/mutukulamahesh/aiqa-mvp) works identically.

## How it works

`aiqa-runner` is a thin wrapper — it locates the AIQA Node CLI and delegates all calls to it. No AIQA logic is re-implemented in Python.

Resolution order:
1. `aiqa` binary in `$PATH` (npm link or global install)
2. `~/.aiqa-runner/bin/aiqa.js` (shell installer default location)
3. Clear error with install instructions if neither is found

## Requirements

- Python 3.8+
- Node.js 18+ (installed by the shell installer above)

## License

Apache 2.0
