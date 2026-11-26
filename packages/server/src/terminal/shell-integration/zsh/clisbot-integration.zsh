if [[ -n "${_CLISBOT_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _CLISBOT_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _CLISBOT_ZSH_COMMAND_ACTIVE=0

function _clisbot_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _clisbot_precmd() {
  local command_status=$?
  if [[ "$_CLISBOT_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _clisbot_osc633 "D;${command_status}"
    _CLISBOT_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _clisbot_osc633 "A"
}

function _clisbot_preexec() {
  _CLISBOT_ZSH_COMMAND_ACTIVE=1
  _clisbot_osc633 "B"
  _clisbot_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _clisbot_precmd
add-zsh-hook preexec _clisbot_preexec
