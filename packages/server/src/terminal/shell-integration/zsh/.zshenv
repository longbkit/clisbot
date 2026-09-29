typeset -g CLISBOT_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${CLISBOT_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${CLISBOT_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${CLISBOT_SHELL_INTEGRATION_DIR}/clisbot-integration.zsh"
