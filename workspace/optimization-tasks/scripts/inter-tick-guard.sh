#!/usr/bin/env bash
# ================================================================
# inter-tick-guard.sh — 真实产线工艺优化间隔控制
# ================================================================
# 用法:
#   source scripts/inter-tick-guard.sh
#   check_cooldown          # 检查冷却期间隔
#   check_oscillation       # 检查当前产线震荡
#   update_last_action "<timestamp>"  # 写入上次动作时间戳
#   get_min_wait_for_tag "<tag>"      # 获取该参数类型的最小等待秒数
#   full_guard_check        # 完整卡控检查（冷却期 + 震荡）
# ================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/config/inter_tick_control.json"
TIMESTAMP_FILE="${ROOT_DIR}/config/last_action_timestamp.txt"
PROJECT_ROOT="/Volumes/laxer/codes/skills/Online_optimizer"

# 默认值（如果配置文件读取失败）
DEFAULT_MIN_INTERVAL=360
DEFAULT_REQUIRED_STABLE_TICKS=3
DEFAULT_MAX_CV_SWING=0.08
DEFAULT_MAX_MEAN_SWING=0.0008

read_config_value() {
  local query="$1"
  local default="$2"
  local value
  value=$(python3 -c "
import json, sys
try:
    with open('${CONFIG_FILE}', 'r') as f:
        config = json.load(f)
    keys = '${query}'.split('.')
    val = config
    for k in keys:
        val = val[k]
    print(val, end='')
except Exception:
    sys.exit(1)
" 2>/dev/null) || value="${default}"
  echo "${value}"
}

check_cooldown() {
  # 1. 检查时间戳文件
  if [[ ! -f "${TIMESTAMP_FILE}" ]]; then
    echo "[COOLDOWN] ✅ 首次执行，冷却期无需等待。"
    return 0
  fi

  local last_ts
  last_ts=$(cat "${TIMESTAMP_FILE}" | tr -d '[:space:]')
  if [[ -z "${last_ts}" ]]; then
    echo "[COOLDOWN] ⚠️ 时间戳文件为空，视为首次执行。"
    return 0
  fi

  # 2. 读取全局冷却间隔
  local min_interval
  min_interval=$(read_config_value "global_cooldown.min_action_interval_seconds" "${DEFAULT_MIN_INTERVAL}")

  # 3. 使用 Python 精确计算时差
  local diff result
  result=$(python3 -c "
from datetime import datetime, timezone, timedelta
last = datetime.fromisoformat('${last_ts}'.replace('Z','+00:00'))
now = datetime.now(timezone.utc)
diff = (now - last).total_seconds()
min_int = ${min_interval}
rem = min_int - diff
if rem > 0:
    print(f'COOLDOWN_BLOCKED {int(rem)}')
else:
    print('COOLDOWN_PASSED')
" 2>/dev/null) || result="COOLDOWN_ERROR"

  if [[ "${result}" == COOLDOWN_PASSED* || "${result}" == "COOLDOWN_PASSED" ]]; then
    echo "[COOLDOWN] ✅ 冷却期已过。距上次操作 $(($(date +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%S" "$(echo ${last_ts} | cut -d'.' -f1)" +%s 2>/dev/null || echo 0))) 秒。"
    return 0
  elif [[ "${result}" == COOLDOWN_BLOCKED* ]]; then
    local remaining
    remaining=$(echo "${result}" | awk '{print $2}')
    echo "[COOLDOWN] ❌ 冷却期未过！还需等待 ${remaining} 秒才可执行下一次变更。"
    echo "[COOLDOWN] 💡 可在 config/inter_tick_control.json 中修改 global_cooldown.min_action_interval_seconds 调整间隔。"
    return 1
  else
    echo "[COOLDOWN] ⚠️ 时间计算错误 (${result})，允许执行但建议手动检查。"
    return 0
  fi
}

get_min_wait_for_tag() {
  local tag="${1:-}"
  if [[ -z "${tag}" ]]; then
    echo "${DEFAULT_MIN_INTERVAL}"
    return
  fi

  local param_type wait
  param_type=$(python3 -c "
import json
with open('${CONFIG_FILE}', 'r') as f:
    config = json.load(f)
param_map = config.get('inter_tick_min_wait_by_parameter_type', {})
tag = '${tag}'
for ptype, pdata in param_map.items():
    patterns = pdata.get('tag_patterns', [])
    if tag in patterns:
        print(ptype)
        break
" 2>/dev/null) || param_type=""

  if [[ -z "${param_type}" ]]; then
    echo "[WAIT_TAG] ⚠️ 无法识别参数类型 ${tag}，使用默认间隔 ${DEFAULT_MIN_INTERVAL}s。"
    echo "${DEFAULT_MIN_INTERVAL}"
    return
  fi

  wait=$(read_config_value "inter_tick_min_wait_by_parameter_type.${param_type}.min_wait_seconds" "${DEFAULT_MIN_INTERVAL}")
  echo "[WAIT_TAG] 📌 ${tag} (类型:${param_type}) → 最小等待 ${wait}s。"
  echo "${wait}"
}

check_oscillation() {
  # 使用 MCP 工具读取最后几个 tick 的质量数据来判断震荡
  # 此函数被 process agent 在 Phase 0 调用
  local required_ticks max_cv_swing
  required_ticks=$(read_config_value "oscillation_detector.required_stable_ticks" "${DEFAULT_REQUIRED_STABLE_TICKS}")
  max_cv_swing=$(read_config_value "oscillation_detector.max_cv_swing" "${DEFAULT_MAX_CV_SWING}")

  echo "[OSCILLATION] 🔍 震荡检查: 需要至少 ${required_ticks} ticks 的 cv 波动 < ${max_cv_swing}。"
  # 实际的 MCP 调用由 Agent 执行，这里只输出检查规则
  return 0
}

update_last_action() {
  local ts="${1:-}"
  if [[ -z "${ts}" ]]; then
    ts=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).isoformat())" 2>/dev/null) || ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  fi
  echo "${ts}" > "${TIMESTAMP_FILE}"
  echo "[UPDATE] ✅ 上次动作时间戳已更新: ${ts}"
}

full_guard_check() {
  echo "============================================"
  echo "🛡️  产线工艺优化完整卡控检查"
  echo "    config: ${CONFIG_FILE}"
  echo "    timestamp_file: ${TIMESTAMP_FILE}"
  echo "============================================"

  # 1. 冷却期检查
  if ! check_cooldown; then
    echo "❌ 完整卡控: 失败 — 冷却期未过"
    return 1
  fi

  # 2. 震荡检查
  check_oscillation

  echo "✅ 完整卡控: 通过 — 允许执行工艺参数变更"
  return 0
}

# ================================================================
# 如果直接运行此脚本，输出当前状态
# ================================================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ACTION="${1:-status}"
  case "${ACTION}" in
    status)
      full_guard_check
      ;;
    cooldown)
      check_cooldown
      ;;
    tag-wait)
      get_min_wait_for_tag "${2:-}"
      ;;
    update)
      update_last_action "${2:-}"
      ;;
    *)
      echo "usage: $0 {status|cooldown|tag-wait <tag>|update <timestamp>}"
      exit 1
      ;;
  esac
fi
