#!/usr/bin/env bash
# x_harness one-liner installer
#
# Usage (远程，推荐):
#   curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh | bash
#
# 带参数：
#   ... | bash -s -- --dir ~/x_harness --no-alias --reset-runtime
#
# 参数：
#   --dir <path>        源码目录（默认 ~/.x_harness-src）
#   --runtime <path>    运行时目录（默认 ~/.x_harness），仅用于检测，installer 默认不动
#   --branch <name>     分支（默认 main）
#   --no-alias          不写 alias 到 shell rc
#   --reset-runtime     备份并清空运行时目录（应急用，会保留 .bak.<时间戳>）
#
# 行为：
#   1. 检查 git / node>=20 / pnpm（缺啥提示装啥；pnpm 自动用 corepack 启用）
#   2. 探测运行时目录（session 数 / territory / 体积），默认不动
#   3. 区分模式：
#      - new install：$INSTALL_DIR 不存在 → git clone
#      - upgrade：$INSTALL_DIR 已是 git 仓库 → 记下旧 HEAD → rm -rf → re-clone
#                 .env 自动备份/恢复，结束展示 old→new commit 和 diff stat
#   4. pnpm install + typecheck
#   5. 默认追加 `alias x='...'` 到 shell rc（除非 --no-alias）

# 已知陷阱：macOS 自带 /bin/bash 是 3.2.57，对 `set -u` 严格模式 + 某些参数展开
# 不友好。这里用 `set -eo pipefail`（不带 -u），并对可能未初始化的变量统一
# 用 `${var:-}` 防御。
set -eo pipefail

# ── defaults ─────────────────────────────────────────────────────────────
REPO_URL="${X_HARNESS_REPO:-https://github.com/xiangxiuhui/x-harness.git}"
INSTALL_DIR="${X_HARNESS_DIR:-$HOME/.x_harness-src}"
RUNTIME_DIR="${X_HARNESS_HOME:-$HOME/.x_harness}"
ADD_ALIAS=1
BRANCH="${X_HARNESS_BRANCH:-main}"
RESET_RUNTIME=0

# ── flags ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)            INSTALL_DIR="$2"; shift 2 ;;
    --runtime)        RUNTIME_DIR="$2"; shift 2 ;;
    --branch)         BRANCH="$2"; shift 2 ;;
    --no-alias)       ADD_ALIAS=0; shift ;;
    --reset-runtime)  RESET_RUNTIME=1; shift ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30
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

# ── runtime data detection ──────────────────────────────────────────────
# ~/.x_harness 是运行时数据目录（session JSONL / territory.yaml / skills /
# .env 可能也在这里以后）。它的内容是用户的劳动成果，installer 绝不能默认动它。
step "检查运行时数据 $RUNTIME_DIR"

if [[ -d "$RUNTIME_DIR" ]]; then
  RT_SESSIONS=0
  if [[ -d "$RUNTIME_DIR/memory" ]]; then
    RT_SESSIONS=$(find "$RUNTIME_DIR/memory" -maxdepth 1 -name 'sess-*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
  fi
  RT_SIZE=$(du -sh "$RUNTIME_DIR" 2>/dev/null | awk '{print $1}')
  RT_TERRITORY="无"
  [[ -f "$RUNTIME_DIR/territory.yaml" ]] && RT_TERRITORY="有（territory.yaml）"
  ok "运行时已存在：${RT_SESSIONS} 个 session、territory ${RT_TERRITORY}、占用 ${RT_SIZE}"

  if [[ "${RESET_RUNTIME:-0}" -eq 1 ]]; then
    warn "--reset-runtime 已传入：运行时目录将被备份后清空"
    BACKUP_DIR="$RUNTIME_DIR.bak.$(date +%Y%m%d-%H%M%S)"
    mv "$RUNTIME_DIR" "$BACKUP_DIR"
    ok "已搬到 $BACKUP_DIR（可手动恢复 / 删除）"
  else
    ok "installer 不会动它（如需重置：加 --reset-runtime）"
  fi
else
  ok "运行时目录尚未生成（首次 \`x chat\` 会自动创建）"
fi

# ── new install vs. upgrade ──────────────────────────────────────────────
# 显式区分两条路径：
#   - new:     $INSTALL_DIR 不存在 → 直接 clone
#   - upgrade: $INSTALL_DIR 已是 git 仓库 → 记下旧 HEAD，rm -rf 重 clone，
#              展示 old→new commit + 改了几个文件
MODE=""
OLD_HEAD=""
OLD_HEAD_FULL=""

if [[ -d "$INSTALL_DIR/.git" ]]; then
  MODE="upgrade"
  OLD_HEAD="$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  OLD_HEAD_FULL="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo)"
  step "升级源码 → $INSTALL_DIR  (旧版 $OLD_HEAD)"
elif [[ -e "$INSTALL_DIR" ]]; then
  die "$INSTALL_DIR 已存在但不是 git 仓库；移走再试，或用 --dir 换个目录"
else
  MODE="new"
  step "新装源码 → $INSTALL_DIR"
fi

ENV_BACKUP=""
if [[ "$MODE" == "upgrade" && -f "$INSTALL_DIR/.env" ]]; then
  ENV_BACKUP="$(mktemp -t x_harness_env.XXXXXX)"
  cp "$INSTALL_DIR/.env" "$ENV_BACKUP"
  ok "已备份 .env"
fi

if [[ "$MODE" == "upgrade" ]]; then
  rm -rf "$INSTALL_DIR"
fi

git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"

if [[ -n "${ENV_BACKUP:-}" && -f "$ENV_BACKUP" ]]; then
  mv "$ENV_BACKUP" "$INSTALL_DIR/.env"
  ok "已恢复 .env"
fi

NEW_HEAD="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"

if [[ "$MODE" == "upgrade" ]]; then
  if [[ -n "$OLD_HEAD_FULL" && "$OLD_HEAD_FULL" == "$(git -C "$INSTALL_DIR" rev-parse HEAD)" ]]; then
    ok "已经是最新：$NEW_HEAD（无变化）"
  else
    ok "升级完成：$OLD_HEAD → $NEW_HEAD"
    if [[ -n "$OLD_HEAD_FULL" ]] && git -C "$INSTALL_DIR" cat-file -e "${OLD_HEAD_FULL}^{commit}" 2>/dev/null; then
      DIFF_STAT="$(git -C "$INSTALL_DIR" diff --shortstat "$OLD_HEAD_FULL" HEAD 2>/dev/null || echo)"
      [[ -n "$DIFF_STAT" ]] && say "  变更：$DIFF_STAT"
    fi
  fi
else
  ok "新装完成：$NEW_HEAD"
fi

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
if [[ "${ADD_ALIAS:-0}" -eq 1 ]]; then
  step "配置 \`x\` 命令"
  SHELL_NAME="$(basename "${SHELL:-bash}")"
  RC=""
  case "$SHELL_NAME" in
    zsh)  RC="$HOME/.zshrc" ;;
    bash) if [[ -f "$HOME/.bashrc" ]]; then RC="$HOME/.bashrc"; else RC="$HOME/.bash_profile"; fi ;;
    fish) RC="$HOME/.config/fish/config.fish" ;;
    *)    RC="" ;;
  esac

  # macOS 默认未设 SHELL 时的兼容
  if [[ -z "${RC:-}" && "$(uname -s)" == "Darwin" ]]; then
    RC="$HOME/.zshrc"
    SHELL_NAME="zsh"
  fi

  ALIAS_LINE="alias x='(cd \"$INSTALL_DIR\" && pnpm -s x)'"
  if [[ "$SHELL_NAME" == "fish" ]]; then
    ALIAS_LINE="alias x '(cd \"$INSTALL_DIR\" && pnpm -s x) ;'"
  fi
  MARK="# >>> x_harness >>>"
  END_MARK="# <<< x_harness <<<"

  if [[ -n "${RC:-}" && -f "$RC" ]] && grep -qF "$MARK" "$RC"; then
    ok "alias 已经在 $RC 里，跳过"
  elif [[ -n "${RC:-}" ]]; then
    mkdir -p "$(dirname "$RC")"
    touch "$RC"
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
