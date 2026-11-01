#!/usr/bin/env bash
# Builds a private Lua 5.2 toolchain (Lua, LuaRocks, busted, luacheck) in the
# gitignored mod/.lua/ directory. Nothing is installed system-wide. CI runs the
# same script, so the versions below are the single pin for both.
#
# Usage: mod/setup-lua.sh           (from anywhere)
# Then:  mod/.lua/bin/busted        (from mod/)
set -euo pipefail

LUA_VERSION=5.2.4
LUAROCKS_VERSION=3.8.0
HERERO_VERSION=0.25.1
BUSTED_VERSION=2.2.0-1
LUACHECK_VERSION=1.2.0-1

cd "$(dirname "$0")"

if [ -x .lua/bin/busted ] && [ -x .lua/bin/luacheck ]; then
  echo "mod/.lua is already set up (delete it to rebuild)"
  exit 0
fi

rm -rf .lua .hererocks-venv
python3 -m venv .hererocks-venv
.hererocks-venv/bin/pip install --quiet "hererocks==${HERERO_VERSION}"
.hererocks-venv/bin/hererocks .lua -l "${LUA_VERSION}" -r "${LUAROCKS_VERSION}" --no-readline
.lua/bin/luarocks install busted "${BUSTED_VERSION}"
.lua/bin/luarocks install luacheck "${LUACHECK_VERSION}"
rm -rf .hererocks-venv
.lua/bin/lua -v
