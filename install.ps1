# AIQA installer — Windows PowerShell
# Usage: iwr https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.ps1 | iex
# To run the downloaded file directly: Set-ExecutionPolicy -Scope Process Bypass

$ErrorActionPreference = "Stop"

$REPO        = "https://github.com/mutukulamahesh/aiqa-mvp.git"
$INSTALL_DIR = "$env:USERPROFILE\.aiqa-runner"
$MIN_NODE    = 18

function Print($msg) { Write-Host "[aiqa] $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[aiqa] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[aiqa] $msg" -ForegroundColor Yellow }
function Die($msg)   { Write-Host "[aiqa] $msg" -ForegroundColor Red; exit 1 }

# ── git check ─────────────────────────────────────────────────────────────────

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die "git is not installed. Install Git for Windows from https://git-scm.com then re-run."
}

# ── Node.js check / install ───────────────────────────────────────────────────

function Test-Node {
  try {
    $ver = (node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>$null)
    return ([int]$ver -ge $MIN_NODE)
  } catch { return $false }
}

if (Test-Node) {
  Ok "Node.js $(node --version) detected"
} else {
  Warn "Node.js $MIN_NODE+ not found — installing via winget"
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (-not (Test-Node)) {
      Die "Node.js install failed. Install manually from https://nodejs.org then re-run this script."
    }
    Ok "Node.js $(node --version) installed"
  } else {
    Die "winget not available. Install Node.js $MIN_NODE+ from https://nodejs.org then re-run this script."
  }
}

# ── Clone / update AIQA ───────────────────────────────────────────────────────

if (Test-Path "$INSTALL_DIR\.git") {
  Print "Updating existing AIQA installation..."
  git -C $INSTALL_DIR fetch origin --depth 1 --quiet
  git -C $INSTALL_DIR reset --hard origin/HEAD --quiet
} else {
  Print "Installing AIQA to $INSTALL_DIR ..."
  git clone --depth 1 --quiet $REPO $INSTALL_DIR
}

# Use Push-Location so the user's working directory is restored after install
Push-Location $INSTALL_DIR

try {
  Print "Installing dependencies..."
  npm ci --silent --omit=dev

  # ── Install Playwright browsers ─────────────────────────────────────────────

  Print "Installing Playwright browsers..."
  try {
    npx playwright install chromium --with-deps 2>$null
  } catch {
    Warn "Playwright browser install failed — run 'npx playwright install chromium' manually"
  }

  # ── Link CLI globally ───────────────────────────────────────────────────────

  Print "Linking aiqa CLI..."
  try {
    npm link --silent
  } catch {
    Warn "npm link failed. You may need to run this script as Administrator, or add $INSTALL_DIR\node_modules\.bin to your PATH manually."
  }

  # ── Verify ──────────────────────────────────────────────────────────────────

  if (Get-Command aiqa -ErrorAction SilentlyContinue) {
    Ok "AIQA installed successfully!"
    Write-Host ""
    Write-Host "  Run a test:    aiqa run tests\example.yaml"
    Write-Host "  Run all tests: aiqa run-all tests\ --headless"
    Write-Host "  Get help:      aiqa --help"
  } else {
    Warn "Restart your terminal then run: aiqa --help"
  }

} finally {
  Pop-Location
}
