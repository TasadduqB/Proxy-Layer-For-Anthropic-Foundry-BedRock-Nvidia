#!/usr/bin/env bash
# Proxy-Max Bootstrap (Unix/macOS/Linux)
# First-run setup: detects admin, installs Node.js if needed, installs npm
# packages, auto-resolves paths, configures environment, and starts the proxy.
# Re-runnable — skips steps already satisfied.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# ---- Configuration ----
PROXY_HOME="${PROXY_MAX_HOME:-$HOME/.proxy-max}"
NODE_DIR="$PROXY_HOME/node"
NPM_PREFIX="$PROXY_HOME/npm-global"
PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"

mkdir -p "$PROXY_HOME" "$NPM_PREFIX"

# Prepend known paths
export PATH="$NPM_PREFIX/bin:$NODE_DIR/bin:/usr/local/bin:$PATH"

# ---- Helpers ----
step()  { printf "\n  \033[36m[*] %s\033[0m\n" "$1"; }
ok()    { printf "      \033[32m%s\033[0m\n" "$1"; }
warn()  { printf "      \033[33m%s\033[0m\n" "$1"; }
err()   { printf "      \033[31m%s\033[0m\n" "$1"; }

is_admin() {
  [ "$(id -u)" -eq 0 ]
}

# ---- Step 1: Detect privileges ----
echo ""
echo "  ============================================="
printf "  \033[35m     Proxy-Max Bootstrap\033[0m\n"
echo "  ============================================="

step "Checking privileges..."
if is_admin; then
  ok "Running as root/sudo"
  ADMIN=true
else
  warn "Running as standard user (portable install mode)"
  ADMIN=false
fi

# ---- Step 2: Install Node.js ----
step "Checking Node.js..."

ensure_node() {
  if command -v node &>/dev/null && command -v npm &>/dev/null; then
    ok "Node.js $(node --version) (npm $(npm --version)) found at $(command -v node)"
    return
  fi

  warn "Node.js not found. Installing..."

  # Try system package managers first
  if $ADMIN; then
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
      apt-get install -y nodejs 2>/dev/null && { ok "Node.js installed via apt"; return; }
    elif command -v dnf &>/dev/null; then
      dnf install -y nodejs npm 2>/dev/null && { ok "Node.js installed via dnf"; return; }
    elif command -v brew &>/dev/null; then
      brew install node 2>/dev/null && { ok "Node.js installed via brew"; return; }
    fi
  else
    if command -v brew &>/dev/null; then
      brew install node 2>/dev/null && { ok "Node.js installed via brew"; return; }
    fi
  fi

  # Portable fallback
  VER="v20.18.0"
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
  esac
  TARBALL="node-$VER-$OS-$ARCH.tar.xz"
  URL="https://nodejs.org/dist/$VER/$TARBALL"
  TMP="$PROXY_HOME/$TARBALL"

  printf "      Downloading portable Node.js %s (%s)...\n" "$VER" "$ARCH"
  curl -fsSL "$URL" -o "$TMP"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$TMP" -C "$NODE_DIR" --strip-components=1
  rm -f "$TMP"
  export PATH="$NODE_DIR/bin:$PATH"
  ok "Node.js $VER installed (portable) at $NODE_DIR"
}

ensure_node

# ---- Step 3: Install project dependencies ----
step "Installing project dependencies..."

if [ -f "$HERE/package.json" ]; then
  cd "$HERE"
  npm install --production 2>&1 | sed 's/^/      /' || {
    warn "Retrying with --force..."
    npm install --production --force 2>&1 | sed 's/^/      /'
  }
  ok "Dependencies installed"
else
  err "package.json not found at $HERE"
  exit 1
fi

# ---- Step 4: Install Claude Code CLI (optional) ----
step "Checking Claude Code CLI..."

ensure_claude() {
  if command -v claude &>/dev/null; then
    ok "claude CLI found at $(command -v claude)"
    return
  fi
  warn "Claude Code CLI not found. Installing..."
  if $ADMIN; then
    npm install -g @anthropic-ai/claude-code 2>&1 | sed 's/^/      /' || true
    if command -v claude &>/dev/null; then ok "claude CLI installed globally"; return; fi
  fi
  # Non-admin: install to custom prefix
  npm install -g --prefix "$NPM_PREFIX" @anthropic-ai/claude-code 2>&1 | sed 's/^/      /' || true
  export PATH="$NPM_PREFIX/bin:$PATH"
  if command -v claude &>/dev/null; then
    ok "claude CLI installed at $NPM_PREFIX/bin"
  else
    warn "Could not install claude CLI (non-critical, proxy still works)"
  fi
}

ensure_claude

# ---- Step 5: Auto-configure paths & environment ----
step "Configuring environment..."

export PORT="$PORT"
export HOST="$HOST"
BASE_URL="http://${HOST}:${PORT}"
export ANTHROPIC_BASE_URL="$BASE_URL"
export ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-proxy-max}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$ANTHROPIC_AUTH_TOKEN}"

ok "ANTHROPIC_BASE_URL = $BASE_URL"
ok "PORT = $PORT | HOST = $HOST"
ok "Logs: $PROXY_HOME/server.log"

# ---- Step 6: Start proxy ----
step "Starting Proxy-Max..."

start_proxy() {
  local insecure="${1:-}"
  # Kill existing
  local pid
  pid=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    printf "      Stopping existing process (PID %s)...\n" "$pid"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi

  if [ -n "$insecure" ]; then
    export PROXY_INSECURE=1
  else
    unset PROXY_INSECURE 2>/dev/null || true
  fi

  nohup node "$HERE/src/server.js" > "$PROXY_HOME/server.log" 2> "$PROXY_HOME/server.err.log" &

  printf "      Waiting for proxy..."
  for i in $(seq 1 40); do
    sleep 0.25
    if curl -sf "$BASE_URL/api/health" >/dev/null 2>&1; then
      printf " \033[32mready!\033[0m\n"
      return 0
    fi
    printf "."
  done
  echo ""
  err "Proxy failed to start. Check $PROXY_HOME/server.err.log"
  return 1
}

# Check if already running
if curl -sf "$BASE_URL/api/health" >/dev/null 2>&1; then
  ok "Proxy already running at $BASE_URL"
else
  start_proxy || exit 1
fi

# ---- Step 7: Ready ----
echo ""
printf "  \033[32m=============================================\033[0m\n"
printf "       \033[1mProxy-Max is READY\033[0m\n"
printf "       %s\n" "$BASE_URL"
printf "  \033[32m=============================================\033[0m\n"
echo ""
echo "  What would you like to do?"
echo ""
echo "  [1] Open dashboard in browser"
echo "  [2] Launch claude (with proxy)"
echo "  [3] Restart proxy"
echo "  [4] Restart proxy with PROXY_INSECURE=1 (fix SSL errors)"
echo "  [5] Exit (proxy keeps running)"
echo ""

read -rp "  Enter choice (1-5): " choice

case "$choice" in
  1)
    if command -v xdg-open &>/dev/null; then xdg-open "$BASE_URL"
    elif command -v open &>/dev/null; then open "$BASE_URL"
    fi
    echo "  Opened $BASE_URL"
    ;;
  2)
    echo "  Starting claude..."
    claude --dangerously-skip-permissions
    ;;
  3)
    echo "  Restarting proxy..."
    start_proxy
    ;;
  4)
    echo "  Restarting proxy (insecure mode)..."
    start_proxy "1"
    echo "  Starting claude..."
    claude --dangerously-skip-permissions
    ;;
  5)
    echo "  Proxy is running at $BASE_URL. Goodbye."
    ;;
  *)
    echo "  Proxy running at $BASE_URL. Use 'claude' to start coding."
    ;;
esac
