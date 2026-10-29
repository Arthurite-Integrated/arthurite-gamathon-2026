#!/usr/bin/env bash
#
# Installs everything the workshop needs on macOS or Linux, then installs the project.
#
#   Run from the project folder:   bash setup/setup-mac-linux.sh
#
#   Options:
#     --check           only report what is installed, change nothing
#     -y, --yes         do not ask before installing
#     --skip-project    do not run npm install / tests for backend and frontend
#     -h, --help        show this help
#
# Safe to run again: anything already installed is skipped.
# Installs: Node.js 22, Git, AWS CLI v2, Google Chrome (macOS), then the project's npm packages.
# It cannot sign you in to AWS or install Kiro; it tells you how at the end.

set -u

ASSUME_YES=0
CHECK_ONLY=0
SKIP_PROJECT=0

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --check) CHECK_ONLY=1 ;;
    --skip-project) SKIP_PROJECT=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg"; usage; exit 2 ;;
  esac
done

if [ -t 1 ]; then G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; B=$'\033[1m'; N=$'\033[0m'; else G=; Y=; R=; B=; N=; fi
ok()      { printf "  %s[OK]%s      %s\n" "$G" "$N" "$*"; }
doing()   { printf "  %s[INSTALL]%s %s\n" "$B" "$N" "$*"; }
warn()    { printf "  %s[TODO]%s    %s\n" "$Y" "$N" "$*"; PROBLEMS=$((PROBLEMS + 1)); }
fail()    { printf "  %s[FAILED]%s  %s\n" "$R" "$N" "$*"; PROBLEMS=$((PROBLEMS + 1)); }
heading() { printf "\n%s%s%s\n" "$B" "$*" "$N"; }
PROBLEMS=0

has() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  local answer
  if [ -r /dev/tty ]; then
    read -r -p "  $1 [y/N] " answer </dev/tty
  else
    return 1
  fi
  case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# Where this script lives -> project root is one level up
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM=mac ;;
  Linux)  PLATFORM=linux ;;
  *) echo "This script supports macOS and Linux. On Windows use setup/setup-windows.ps1."; exit 2 ;;
esac

node_major() { if has node; then node -v | sed -E 's/^v([0-9]+).*/\1/'; else echo 0; fi; }

# ---------------------------------------------------------------------------
# Helpers per platform
# ---------------------------------------------------------------------------

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if has sudo; then SUDO="sudo"; fi
fi

PKG=""
detect_linux_pkg() {
  if has apt-get; then PKG=apt
  elif has dnf; then PKG=dnf
  elif has yum; then PKG=yum
  elif has pacman; then PKG=pacman
  fi
}

linux_install() {
  # usage: linux_install git curl unzip
  if [ -z "$PKG" ]; then fail "No supported package manager found (apt, dnf, yum, pacman). Install manually: $*"; return 1; fi
  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then fail "Need root or sudo to install: $*"; return 1; fi
  case "$PKG" in
    apt)    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq "$@" ;;
    dnf)    $SUDO dnf install -y -q "$@" ;;
    yum)    $SUDO yum install -y -q "$@" ;;
    pacman) $SUDO pacman -S --noconfirm --needed "$@" ;;
  esac
}

ensure_brew() {
  if has brew; then return 0; fi
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then eval "$("$b" shellenv)"; return 0; fi
  done
  warn "Homebrew is not installed."
  if [ "$CHECK_ONLY" -eq 1 ]; then return 1; fi
  if confirm "Install Homebrew now (from https://brew.sh)?"; then
    doing "Homebrew (this can take a few minutes and may ask for your Mac password)"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || { fail "Homebrew install failed"; return 1; }
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      if [ -x "$b" ]; then eval "$("$b" shellenv)"; return 0; fi
    done
  fi
  return 1
}

[ "$PLATFORM" = linux ] && detect_linux_pkg

heading "Checking your computer ($OS)"

# ---------------------------------------------------------------------------
# Git, curl, unzip
# ---------------------------------------------------------------------------

if has git; then
  ok "Git $(git --version | awk '{print $3}')"
else
  if [ "$CHECK_ONLY" -eq 1 ]; then warn "Git is missing"; else
    doing "Git"
    if [ "$PLATFORM" = mac ]; then
      if ensure_brew; then brew install git || fail "Git install failed"; else fail "Cannot install Git without Homebrew. Run: xcode-select --install"; fi
    else
      linux_install git
    fi
    has git && ok "Git installed" || fail "Git is still missing"
  fi
fi

if [ "$PLATFORM" = linux ]; then
  for tool in curl unzip; do
    if has "$tool"; then ok "$tool"; else
      if [ "$CHECK_ONLY" -eq 1 ]; then warn "$tool is missing"; else doing "$tool"; linux_install "$tool"; has "$tool" || fail "$tool is still missing"; fi
    fi
  done
fi

# ---------------------------------------------------------------------------
# Node.js 22+
# ---------------------------------------------------------------------------

NODE_MAJOR="$(node_major)"
if [ "$NODE_MAJOR" -ge 22 ]; then
  ok "Node.js $(node -v) and npm $(npm -v 2>/dev/null)"
else
  if has node; then warn "Node.js $(node -v) is too old; version 22 or newer is needed"; else warn "Node.js is not installed"; fi
  if [ "$CHECK_ONLY" -eq 0 ]; then
    doing "Node.js 22"
    if [ "$PLATFORM" = mac ]; then
      if ensure_brew; then
        brew install node@22 && brew link --overwrite --force node@22
      fi
    else
      export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
      if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || fail "nvm install failed"
      fi
      # shellcheck disable=SC1091
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 22 && nvm alias default 22 >/dev/null
    fi
    NODE_MAJOR="$(node_major)"
    if [ "$NODE_MAJOR" -ge 22 ]; then ok "Node.js $(node -v) installed (open a NEW terminal later so it is on your PATH)"; else fail "Node.js 22 is still not available"; fi
  fi
fi

# ---------------------------------------------------------------------------
# AWS CLI v2
# ---------------------------------------------------------------------------

add_local_bin_to_path() {
  case ":$PATH:" in *":$HOME/.local/bin:"*) return ;; esac
  export PATH="$HOME/.local/bin:$PATH"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && ! grep -q '\.local/bin' "$rc"; then
      printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    fi
  done
}

aws_major() { has aws && aws --version 2>&1 | sed -E 's#^aws-cli/([0-9]+).*#\1#' || echo 0; }

if [ "$(aws_major)" -ge 2 ]; then
  ok "AWS CLI $(aws --version 2>&1 | awk '{print $1}')"
else
  if has aws; then warn "AWS CLI is version 1; version 2 is needed"; else warn "AWS CLI is not installed"; fi
  if [ "$CHECK_ONLY" -eq 0 ]; then
    doing "AWS CLI v2"
    if [ "$PLATFORM" = mac ]; then
      if ensure_brew; then brew install awscli || fail "AWS CLI install failed"; fi
    else
      case "$(uname -m)" in
        x86_64) ARCH=x86_64 ;;
        aarch64|arm64) ARCH=aarch64 ;;
        *) ARCH="" ;;
      esac
      if [ -z "$ARCH" ]; then
        fail "Unsupported CPU type $(uname -m). See https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
      elif has curl && has unzip; then
        TMP="$(mktemp -d)"
        if curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o "$TMP/awscliv2.zip" \
          && unzip -q "$TMP/awscliv2.zip" -d "$TMP" \
          && "$TMP/aws/install" -i "$HOME/.local/aws-cli" -b "$HOME/.local/bin" --update >/dev/null; then
          add_local_bin_to_path
        else
          fail "AWS CLI download or install failed"
        fi
        rm -rf "$TMP"
      fi
    fi
    if [ "$(aws_major)" -ge 2 ]; then ok "AWS CLI installed ($(aws --version 2>&1 | awk '{print $1}'))"; else fail "AWS CLI v2 is still not available"; fi
  fi
fi

# ---------------------------------------------------------------------------
# Chrome and Kiro (Chrome is used by the chrome-devtools MCP server)
# ---------------------------------------------------------------------------

CHROME_FOUND=0
if [ "$PLATFORM" = mac ]; then
  [ -d "/Applications/Google Chrome.app" ] && CHROME_FOUND=1
else
  for c in google-chrome google-chrome-stable chromium chromium-browser; do has "$c" && CHROME_FOUND=1; done
fi

if [ "$CHROME_FOUND" -eq 1 ]; then
  ok "Google Chrome"
else
  if [ "$PLATFORM" = mac ] && [ "$CHECK_ONLY" -eq 0 ] && ensure_brew; then
    doing "Google Chrome"
    brew install --cask google-chrome && ok "Google Chrome installed" || warn "Install Chrome from https://www.google.com/chrome"
  else
    warn "Google Chrome is missing. Install it from https://www.google.com/chrome (needed to test games with Kiro)"
  fi
fi

KIRO_FOUND=0
has kiro && KIRO_FOUND=1
[ -d "/Applications/Kiro.app" ] && KIRO_FOUND=1
if [ "$KIRO_FOUND" -eq 1 ]; then ok "Kiro"; else warn "Kiro is not installed. Download it from https://kiro.dev and sign in"; fi

# ---------------------------------------------------------------------------
# AWS sign-in status (we cannot do this part for you)
# ---------------------------------------------------------------------------

if has aws; then
  if aws sts get-caller-identity >/dev/null 2>&1; then
    ok "AWS sign-in works ($(aws sts get-caller-identity --query Account --output text 2>/dev/null))"
  else
    warn "Not signed in to AWS yet. Run: aws configure sso   (company account)   or: aws configure   (access keys)"
  fi
fi

# ---------------------------------------------------------------------------
# Project packages and self-test
# ---------------------------------------------------------------------------

if [ "$CHECK_ONLY" -eq 0 ] && [ "$SKIP_PROJECT" -eq 0 ]; then
  heading "Installing the project"
  if [ "$(node_major)" -lt 22 ]; then
    warn "Skipping project install because Node.js 22 is not available yet. Open a new terminal and run this script again."
  elif [ ! -f "$ROOT/backend/package.json" ] || [ ! -f "$ROOT/frontend/package.json" ]; then
    warn "Could not find backend/ and frontend/ next to this script ($ROOT). Run it from inside the project folder."
  else
    for part in backend frontend; do
      doing "$part packages (this takes a minute)"
      if [ -f "$ROOT/$part/package-lock.json" ]; then INSTALL="ci"; else INSTALL="install"; fi
      if (cd "$ROOT/$part" && npm "$INSTALL" --no-audit --no-fund --loglevel=error); then
        ok "$part packages installed"
      else
        fail "npm $INSTALL failed in $part"
      fi
    done
    for part in backend frontend; do
      if (cd "$ROOT/$part" && npm test --silent >/dev/null 2>&1); then ok "$part tests pass"; else fail "$part tests failed. Run: cd $part && npm test"; fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

heading "Summary"
if [ "$PROBLEMS" -eq 0 ]; then
  printf "  %sEverything is ready.%s\n" "$G" "$N"
else
  printf "  %s%d item(s) need attention (marked [TODO] or [FAILED] above).%s\n" "$Y" "$PROBLEMS" "$N"
fi

cat <<EOF

Next steps
  1. Open a NEW terminal window (so new tools are on your PATH).
  2. Try the game locally, no AWS needed:
       Terminal 1:  cd backend && npm run local:realtime
       Terminal 2:  cd frontend && npm run dev:local
     Then open http://localhost:5173/?as=alice and http://localhost:5173/?as=bob
  3. To deploy: sign in to AWS (aws configure sso), then
       cd backend && npx cdk bootstrap
  4. Open this folder in Kiro (File > Open Folder).
EOF

[ "$PROBLEMS" -eq 0 ]
