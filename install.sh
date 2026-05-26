#!/usr/bin/env bash
# AIQA installer — Linux & macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash

set -e

REPO="https://github.com/mutukulamahesh/aiqa-mvp.git"
INSTALL_DIR="$HOME/.aiqa-runner"
MIN_NODE=18

print()  { printf '\033[1;34m[aiqa]\033[0m %s\n' "$1"; }
ok()     { printf '\033[1;32m[aiqa]\033[0m %s\n' "$1"; }
warn()   { printf '\033[1;33m[aiqa]\033[0m %s\n' "$1"; }
die()    { printf '\033[1;31m[aiqa]\033[0m %s\n' "$1" >&2; exit 1; }

# ── OS check ──────────────────────────────────────────────────────────────────

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) die "Unsupported OS: $(uname -s). Use Docker on Windows: https://github.com/mutukulamahesh/aiqa-mvp#docker" ;;
esac

# ── git check ─────────────────────────────────────────────────────────────────

command -v git >/dev/null 2>&1 || die "git is not installed. Install git and re-run."

# ── Node.js check / install ───────────────────────────────────────────────────

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  ver=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  [ "$ver" -ge "$MIN_NODE" ] 2>/dev/null
}

if node_ok; then
  ok "Node.js $(node --version) detected"
else
  warn "Node.js $MIN_NODE+ not found — installing via nvm"

  if [ ! -f "$HOME/.nvm/nvm.sh" ]; then
    print "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi

  # nvm is a bash function — must be sourced, not executed as a binary
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"

  nvm install $MIN_NODE --silent
  nvm use $MIN_NODE --silent
  nvm alias default $MIN_NODE >/dev/null 2>&1 || true
  ok "Node.js $(node --version) installed"
fi

# ── npm check ─────────────────────────────────────────────────────────────────

command -v npm >/dev/null 2>&1 || die "npm not found. Install Node.js $MIN_NODE+ from https://nodejs.org"

# ── Clone / update AIQA ───────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  print "Updating existing AIQA installation..."
  # Reliable update for shallow clones — works even after remote force-push
  git -C "$INSTALL_DIR" fetch origin --depth 1 --quiet
  git -C "$INSTALL_DIR" reset --hard origin/HEAD --quiet
else
  print "Installing AIQA to $INSTALL_DIR ..."
  git clone --depth 1 --quiet "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
print "Installing dependencies..."
npm ci --silent --omit=dev

# ── Install Playwright browsers ───────────────────────────────────────────────

print "Installing Playwright browsers..."
npx playwright install chromium --with-deps --quiet 2>/dev/null || \
  npx playwright install chromium 2>/dev/null || \
  warn "Playwright browser install failed — run 'npx playwright install chromium' manually"

# ── Link CLI globally ─────────────────────────────────────────────────────────

print "Linking aiqa CLI..."
npm link --silent 2>/dev/null || {
  warn "npm link failed (may need sudo). Trying with prefix..."
  npm config set prefix "$HOME/.npm-global"
  export PATH="$HOME/.npm-global/bin:$PATH"
  npm link --silent
}

# ── Verify ────────────────────────────────────────────────────────────────────

if command -v aiqa >/dev/null 2>&1; then
  ok "AIQA installed successfully!"
  printf '\n'
  printf '  Run a test:    aiqa run tests/example.yaml\n'
  printf '  Run all tests: aiqa run-all tests/ --headless\n'
  printf '  Get help:      aiqa --help\n'
  printf '\n'
  warn "If 'aiqa' is not found, add this to your shell profile:"
  printf '  export PATH="$HOME/.npm-global/bin:$PATH"\n'
else
  warn "Shell reload required. Run:"
  printf '  source ~/.bashrc   # bash\n'
  printf '  source ~/.zshrc    # zsh\n'
  printf '\nThen: aiqa --help\n'
fi
