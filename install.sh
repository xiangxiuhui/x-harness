#!/usr/bin/env bash
# x_harness one-liner installer
#
# Usage (远程，推荐):
#   curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh | bash
#
# 或带参数（自定义安装目录、跳过 alias）：
#   curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh | bash -s -- --dir ~/x_harness --no-alias
#
# 行为：
#   1. 检查 git / node>=20 / pnpm（缺啥提示装啥）
#   2. clone 到 $INSTALL_DIR（默认 ~/.x_harness-src），已存在则 git pull
#   3. pnpm install + typecheck
#   4. 把 .env.example 复制成 .env（如果不存在）
#   5. 默认追加 `alias x='...'` 到当前 shell rc（除非 --no-alias）
#   6. 打印下一步操作

set -euo pipefail

# ── defaults ─────────────────────────────────────────────────────────────
REPO_URL="${X_HARNESS_REPO:-https://github.com/xiangxiuhui/x-harness.git}"
INSTALL_DIR="${X_HARNESS_DIR:-$HOME/.x_harness-src}"
ADD_ALIAS=1
BRANCH="${X_HARNESS_BRANCH:-main}"

# ── flags ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)       INSTALL_DIR="$2"; shift 2 ;;
    --branch)    BRANCH="$2"; shift 2 ;;
    --no-alias)  ADD_ALIAS=0; shift ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -25
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# ── colors ───────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
step() { printf '\n%s▶ %s%s\n' "$BOLD" "$*" "$RESET"; }

# ── banner ───────────────────────────────────────────────────────────────
cat <<'EOF'

  ╭─────────────────────────────────────────╮
  │     x_harness installer (alpha)         │
  │     AI Operating System harness         │
  ╰─────────────────────────────────────────╯

EOF

# ── prerequisites ────────────────────────────────────────────────────────
step "检查依赖"

need() { command -v "$1" >/dev/null 2>&1 || die "缺少 $1，请先安装：$2"; }

need git  "https://git-scm.com/downloads"
need node "https://nodejs.org/  (需要 >=20，推荐用 nvm)"

NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "node 版本 $NODE_MAJOR 太低，需要 >=20。建议用 nvm: nvm install 22 && nvm use 22"
fi
ok "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  warn "未检测到 pnpm，自动用 corepack 启用"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    die "pnpm 装不上，请手动安装：npm i -g pnpm"
  fi
fi
ok "pnpm $(pnpm -v)"
ok "git $(git --version | awk '{print $3}')"

# ── clone / update ───────────────────────────────────────────────────────
step "获取源码 → $INSTALL_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "目录已存在，执行 git pull"
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$BRANCH"
elif [[ -e "$INSTALL_DIR" ]]; then
  die "$INSTALL_DIR 已存在但不是 git 仓库；移走再试，或用 --dir 换个目录"
else
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
ok "源码就位：$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"

# ── install deps ─────────────────────────────────────────────────────────
step "pnpm install"
cd "$INSTALL_DIR"
pnpm install --silent
ok "依赖装好"

# ── typecheck（轻量自检） ────────────────────────────────────────────────
step "typecheck 自检"
if pnpm typecheck >/dev/null 2>&1; then
  ok "typecheck 通过"
else
  warn "typecheck 失败，但继续（请之后跑 pnpm typecheck 看详情）"
fi

# ── .env ─────────────────────────────────────────────────────────────────
if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  ok "已生成 .env（仍需填 DEEPSEEK_API_KEY）"
else
  ok ".env 已存在或无模板"
fi

# ── alias ────────────────────────────────────────────────────────────────
if [[ "$ADD_ALIAS" -eq 1 ]]; then
  step "配置 \`x\` 命令"
  SHELL_NAME="$(basename "${SHELL:-bash}")"
  RC=""
  case "$SHELL_NAME" in
    zsh)  RC="$HOME/.zshrc" ;;
    bash) [[ -f "$HOME/.bashrc" ]] && RC="$HOME/.bashrc" || RC="$HOME/.bash_profile" ;;
    fish) RC="$HOME/.config/fish/config.fish" ;;
    *)    RC="" ;;
  esac

  ALIAS_LINE="alias x='(cd \"$INSTALL_DIR\" && pnpm -s x)'"
  if [[ "$SHELL_NAME" == "fish" ]]; then
    ALIAS_LINE="alias x '(cd \"$INSTALL_DIR\" && pnpm -s x) ;'"
  fi
  MARK="# >>> x_harness >>>"
  END_MARK="# <<< x_harness <<<"

  if [[ -n "$RC" && -f "$RC" ]] && grep -qF "$MARK" "$RC"; then
    ok "alias 已经在 $RC 里，跳过"
  elif [[ -n "$RC" ]]; then
    mkdir -p "$(dirname "$RC")"
    {
      echo ""
      echo "$MARK"
      echo "$ALIAS_LINE"
      echo "$END_MARK"
    } >> "$RC"
    ok "已写入 $RC（重开 shell 或 \`source $RC\` 生效）"
  else
    warn "未识别的 shell ($SHELL_NAME)，请手动加 alias："
    printf '  %s\n' "$ALIAS_LINE"
  fi
fi

# ── done ─────────────────────────────────────────────────────────────────
cat <<EOF

${GREEN}${BOLD}✅ 安装完成。${RESET}

${BOLD}下一步：${RESET}
  1. ${CYAN}填 API key${RESET}：编辑 ${DIM}$INSTALL_DIR/.env${RESET}，填 DEEPSEEK_API_KEY
  2. ${CYAN}重开终端${RESET} 或 \`source\` 你的 shell rc 让 \`x\` 命令生效
  3. ${CYAN}开始用${RESET}：
       ${BOLD}x version${RESET}              # 自检
       ${BOLD}x chat${RESET}                  # 进入对话
       ${BOLD}x web${RESET}                   # 启动本地 Web UI

${DIM}文档：$INSTALL_DIR/docs/user-guide.md
更新：cd $INSTALL_DIR && git pull && pnpm install${RESET}

EOF
