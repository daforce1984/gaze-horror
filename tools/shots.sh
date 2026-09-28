#!/bin/bash
# usage: tools/shots.sh out.png "js statements using g (=__game)" [wait]
C="timeout 40 uv run -q --with websocket-client /mnt/d/_AI_GENERATED/______2026/horror/tools/cdp.py"
$C eval "(()=>{const g=__game; $2; return 1})()" >/dev/null
sleep ${3:-2}
$C shot "$1" >/dev/null
