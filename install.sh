#!/usr/bin/env bash
# x_harness one-liner installer
#
# Usage (远程，推荐):
#   curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh | bash
#
# 带参数：
#   ... | bash -s -- --home ~/x_harness --no-alias --reset
#
# 参数：
#   --home <path>       x_harness 总目录（默认 ~/.x_harness）
#                       源码放在 <home>/src，运行时数据直接在 <home> 下
#   --branch <name>     分支（默认 main）
#   --no-alias          不写 alias 到 shell rc
#   --reset             备份并清空整个 <home>（应急，会保留 .bak.<时间戳>）
#
# 行为：
#   1. 检查 git / node>=20 / pnpm（pnpm 自动用 corepack 启用）
#   2. 探测旧布局 (~/.x_harness-src) → 自动迁移到新布局
#   3. 显式区分两条路径：
#      - new install：<home>/src 不存在 → git clone
#      - upgrade：<home>/src 已是 git 仓库 → 记下旧 HEAD，rm -rf 重 clone
#                 .env 备份/恢复，结束展示 old→new commit 和 diff stat
#   4. pnpm install + typecheck
#   5. 写 <home>/VERSION（commit + 时间）
#   6. 默认追加 `alias x='...'` 到 shell rc（除非 --no-alias）

# macOS 自带 /bin/bash 3.2.57 在 `set -u` 下对未初始化变量行为不一致。
# 这里只开 -e + pipefail，并对潜在 unset 变量用 ${var:-} 防御。
set -eo pipefail

# ── defaults ─────────────────────────────────────────────────────────────
REPO_URL="${X_HARNESS_REPO:-https://github.com/xiangxiuhui/x-harness.git}"
X_HOME="${X_HARNESS_HOME:-$HOME/.x_harness}"
BRANCH="${X_HARNESS_BRANCH:-main}"
ADD_ALIAS=1
RESET=0

# ── flags ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)       X_HOME="$2"; shift 2 ;;
    --branch)     BRANCH="$2"; shift 2 ;;
    --no-alias)   ADD_ALIAS=0; shift ;;
    --reset)      RESET=1; shift ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -25
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

SRC_DIR="$X_HOME/src"

# ── colors ───────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; CYAN=$'\033[36m'; RESET_C=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET_C=""
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET_C" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET_C" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$RESET_C" "$*" >&2; exit 1; }
step() { printf '\n%s▶ %s%s\n' "$BOLD" "$*" "$RESET_C"; }

# ── banner ───────────────────────────────────────────────────────────────
cat <<EOF

  ╭─────────────────────────────────────────╮
  │     x_harness installer (alpha)         │
  │     AI Operating System harness         │
  ╰─────────────────────────────────────────╯

  ${DIM}所有数据都在：$X_HOME
    └── src/        源码（installer 管）
    └── memory/     session JSONL（你的劳动成果）
    └── territory.yaml, skills/, ... （运行时）${RESET_C}

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
  command -v pnpm >/dev/null 2>&1 || die "pnpm 装不上，请手动安装：npm i -g pnpm"
fi
ok "pnpm $(pnpm -v)"
ok "git $(git --version | awk '{print $3}')"

# ── 旧布局迁移（~/.x_harness-src → ~/.x_harness/src）─────────────────────
LEGACY_SRC="$HOME/.x_harness-src"
if [[ -d "$LEGACY_SRC/.git" && ! -e "$SRC_DIR" ]]; then
  step "迁移旧布局：$LEGACY_SRC → $SRC_DIR"
  mkdir -p "$X_HOME"
  mv "$LEGACY_SRC" "$SRC_DIR"
  ok "已搬迁（旧目录已消失，alias 稍后会自动更新）"
elif [[ -d "$LEGACY_SRC/.git" && -e "$SRC_DIR" ]]; then
  warn "检测到旧布局 $LEGACY_SRC，但新位置 $SRC_DIR 已存在；旧的已被忽略"
  warn "  如不再需要：rm -rf $LEGACY_SRC"
fi

# ── 整体重置（应急）─────────────────────────────────────────────────────
if [[ "${RESET:-0}" -eq 1 && -d "$X_HOME" ]]; then
  BACKUP="$X_HOME.bak.$(date +%Y%m%d-%H%M%S)"
  warn "--reset 已传入：整个 $X_HOME 将被备份到 $BACKUP"
  mv "$X_HOME" "$BACKUP"
  ok "已备份"
fi

# ── runtime data detection（src 之外的内容）──────────────────────────────
step "检查 $X_HOME"
if [[ -d "$X_HOME" ]]; then
  RT_SESSIONS=0
  if [[ -d "$X_HOME/memory" ]]; then
    RT_SESSIONS=$(find "$X_HOME/memory" -maxdepth 1 -name 'sess-*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
  fi
  # 算 src 之外的总占用
  RT_SIZE=$(du -sh "$X_HOME" 2>/dev/null | awk '{print $1}')
  RT_TERRITORY="无"
  [[ -f "$X_HOME/territory.yaml" ]] && RT_TERRITORY="有"
  ok "运行时：${RT_SESSIONS} 个 session、territory ${RT_TERRITORY}、整体 ${RT_SIZE}"
else
  mkdir -p "$X_HOME"
  ok "首次安装：已创建 $X_HOME"
fi

# ── new vs upgrade ───────────────────────────────────────────────────────
MODE=""
OLD_HEAD=""
OLD_HEAD_FULL=""

if [[ -d "$SRC_DIR/.git" ]]; then
  MODE="upgrade"
  OLD_HEAD="$(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  OLD_HEAD_FULL="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || echo)"
  step "升级源码 → $SRC_DIR  (旧版 $OLD_HEAD)"
elif [[ -e "$SRC_DIR" ]]; then
  die "$SRC_DIR 已存在但不是 git 仓库；移走再试，或用 --home 换个总目录"
else
  MODE="new"
  step "拉取源码 → $SRC_DIR"
fi

ENV_BACKUP=""
if [[ "$MODE" == "upgrade" && -f "$SRC_DIR/.env" ]]; then
  ENV_BACKUP="$(mktemp -t x_harness_env.XXXXXX)"
  cp "$SRC_DIR/.env" "$ENV_BACKUP"
  ok "已备份 .env"
fi

if [[ "$MODE" == "upgrade" ]]; then
  rm -rf "$SRC_DIR"
fi

git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$SRC_DIR"

if [[ -n "${ENV_BACKUP:-}" && -f "$ENV_BACKUP" ]]; then
  mv "$ENV_BACKUP" "$SRC_DIR/.env"
  ok "已恢复 .env"
fi

NEW_HEAD="$(git -C "$SRC_DIR" rev-parse --short HEAD)"

if [[ "$MODE" == "upgrade" ]]; then
  if [[ -n "$OLD_HEAD_FULL" && "$OLD_HEAD_FULL" == "$(git -C "$SRC_DIR" rev-parse HEAD)" ]]; then
    ok "已经是最新：$NEW_HEAD（无变化）"
  else
    ok "升级完成：$OLD_HEAD → $NEW_HEAD"
    if [[ -n "$OLD_HEAD_FULL" ]] && git -C "$SRC_DIR" cat-file -e "${OLD_HEAD_FULL}^{commit}" 2>/dev/null; then
      DIFF_STAT="$(git -C "$SRC_DIR" diff --shortstat "$OLD_HEAD_FULL" HEAD 2>/dev/null || echo)"
      [[ -n "$DIFF_STAT" ]] && say "  变更：$DIFF_STAT"
    fi
  fi
else
  ok "新装完成：$NEW_HEAD"
fi

# ── install deps ─────────────────────────────────────────────────────────
step "pnpm install"
cd "$SRC_DIR"
pnpm install --silent
ok "依赖装好"

# ── typecheck ────────────────────────────────────────────────────────────
step "typecheck 自检"
if pnpm typecheck >/dev/null 2>&1; then
  ok "typecheck 通过"
else
  warn "typecheck 失败（不阻塞，可之后跑 pnpm typecheck 查详情）"
fi

# ── .env ─────────────────────────────────────────────────────────────────
if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  ok "已生成 .env（仍需填 DEEPSEEK_API_KEY）"
else
  ok ".env 已存在或无模板"
fi

# ── VERSION 文件 ─────────────────────────────────────────────────────────
cat > "$X_HOME/VERSION" <<VEOF
commit: $NEW_HEAD
branch: $BRANCH
installed_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
installer_mode: $MODE
VEOF
ok "已写 $X_HOME/VERSION"

# ── shell function (not alias) ───────────────────────────────────────────
# 为什么是 function 不是 alias：
# alias x='(cd ... && pnpm -s x)' 展开后是 `(cd ... && pnpm -s x) version` —
# zsh 见到 subshell 括号后接位置参数会 parse error。function 用 "$@" 干净。
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
  if [[ -z "${RC:-}" && "$(uname -s)" == "Darwin" ]]; then
    RC="$HOME/.zshrc"
    SHELL_NAME="zsh"
  fi

  MARK="# >>> x_harness >>>"
  END_MARK="# <<< x_harness <<<"

  # 期望的 block 内容（多行，function 形态）
  # 关键：先 `unalias x`，防止旧 alias（用户老 rc 里的 / oh-my-zsh 的 extract 插件）
  # 在 zsh parse 阶段抢先替换 → "parse error near 'version'"。
  if [[ "$SHELL_NAME" == "fish" ]]; then
    BLOCK_BODY="# Always clear any pre-existing 'x' to avoid alias conflicts
functions -e x 2>/dev/null
function x
    pushd \"$SRC_DIR\" >/dev/null
    pnpm -s x \$argv
    set -l rc \$status
    popd >/dev/null
    return \$rc
end"
  else
    # zsh / bash 通用 function
    BLOCK_BODY="# Always unalias 'x' first: oh-my-zsh's extract plugin and stale aliases
# from earlier sessions would otherwise win alias-substitution at parse time
# and break 'x version' with 'parse error near version'.
unalias x 2>/dev/null || true
x() {
  ( cd \"$SRC_DIR\" && pnpm -s x \"\$@\" )
}"
  fi

  if [[ -n "${RC:-}" ]]; then
    mkdir -p "$(dirname "$RC")"
    touch "$RC"

    # 如果存在旧 x_harness block（不论里面是什么），整段删掉重写。
    # 这样以前装过 alias 形式的（broken）会自动升级到 function 形式。
    if grep -qF "$MARK" "$RC"; then
      cp "$RC" "$RC.x_harness-backup"
      awk -v mark="$MARK" -v end="$END_MARK" '
        $0==mark { skip=1; next }
        $0==end  { skip=0; next }
        !skip
      ' "$RC.x_harness-backup" > "$RC"
      ok "已移除旧 x_harness 块（备份在 $RC.x_harness-backup）"
    fi

    {
      echo ""
      echo "$MARK"
      echo "$BLOCK_BODY"
      echo "$END_MARK"
    } >> "$RC"
    ok "已写入 $RC"
  else
    warn "未识别的 shell ($SHELL_NAME)，请手动加 function："
    printf '%s\n' "$BLOCK_BODY"
  fi

  # 同时写一个独立 activation 文件，避免用户的 ~/.zshrc 有奇怪报错时
  # source 整个 rc 失败。这个文件只包含 unalias + function 定义。
  ACTIVATE="$X_HOME/activate.sh"
  cat > "$ACTIVATE" <<ACT
# x_harness shell activation (sh/bash/zsh)
# Source this OR your shell rc to make the \`x\` command available.
unalias x 2>/dev/null || true
x() {
  ( cd "$SRC_DIR" && pnpm -s x "\$@" )
}
ACT
  ok "已生成 $ACTIVATE（任何 sh/bash/zsh 都能 \`source\` 它）"

  # 清理旧的 ~/.x_harness-src 残留
  if [[ -e "$HOME/.x_harness-src" && ! -L "$HOME/.x_harness-src" ]]; then
    warn "检测到旧目录 ~/.x_harness-src 仍存在（已不再使用，可手动删除）"
  fi
fi

# ── .env health check ────────────────────────────────────────────────────
ENV_OK=0
ENV_STATUS_MSG=""
if [[ -f "$SRC_DIR/.env" ]]; then
  # 提取 DEEPSEEK_API_KEY（去 export 前缀、去引号）
  KEY_VAL="$(awk -F= '
    /^[[:space:]]*(export[[:space:]]+)?DEEPSEEK_API_KEY[[:space:]]*=/ {
      sub(/^[^=]*=[[:space:]]*/, "")
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
  ' "$SRC_DIR/.env" 2>/dev/null)"

  if [[ -z "${KEY_VAL:-}" || "$KEY_VAL" == "your-key-here" || "$KEY_VAL" == "sk-..." || "$KEY_VAL" == "<your-key>" || "$KEY_VAL" == "sk-your-key-here" || "$KEY_VAL" == *"your-key"* || "$KEY_VAL" == *"YOUR_KEY"* ]]; then
    ENV_OK=0
    ENV_STATUS_MSG="DEEPSEEK_API_KEY 还没填（编辑 $SRC_DIR/.env）"
  else
    ENV_OK=1
    # 显示 key 的脱敏形式
    KEY_PREFIX="${KEY_VAL:0:6}"
    ENV_STATUS_MSG="DEEPSEEK_API_KEY 已配置（${KEY_PREFIX}***）"
  fi
else
  ENV_STATUS_MSG=".env 不存在"
fi
step "配置检查"
if [[ "$ENV_OK" -eq 1 ]]; then
  ok "$ENV_STATUS_MSG"
else
  warn "$ENV_STATUS_MSG"
fi

# ── done ─────────────────────────────────────────────────────────────────
printf '\n%s%s✅ 完成。%s\n\n' "$GREEN" "$BOLD" "$RESET_C"

printf '%s下一步：%s\n' "$BOLD" "$RESET_C"
STEP=1
if [[ "$ENV_OK" -ne 1 ]]; then
  printf '  %d. %s填 API key%s：%sedit %s/.env%s（DEEPSEEK_API_KEY=sk-...）\n' \
    "$STEP" "$CYAN" "$RESET_C" "$DIM" "$SRC_DIR" "$RESET_C"
  STEP=$((STEP + 1))
fi
printf '  %d. %s让 `x` 生效%s（脚本无法影响父 shell，三选一）：\n' "$STEP" "$CYAN" "$RESET_C"
printf '       %ssource %s%s                    # 最快\n' "$BOLD" "$ACTIVATE" "$RESET_C"
printf '       %ssource %s%s                  # 或：source 你的 rc\n' "$BOLD" "${RC:-~/.zshrc}" "$RESET_C"
printf '       %sexec %s%s                       # 或：原地重开 shell\n' "$BOLD" "${SHELL:-zsh}" "$RESET_C"
STEP=$((STEP + 1))
printf '  %d. %s开始用%s：%sx version%s / %sx chat%s / %sx web%s\n' \
  "$STEP" "$CYAN" "$RESET_C" "$BOLD" "$RESET_C" "$BOLD" "$RESET_C" "$BOLD" "$RESET_C"
printf '\n'
printf '%s总目录：%s（删它就是彻底卸载）\n' "$DIM" "$X_HOME"
printf '文档：%s/docs/user-guide.md\n' "$SRC_DIR"
printf '重装/升级：curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh | bash%s\n\n' "$RESET_C"
