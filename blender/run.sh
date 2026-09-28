#!/bin/bash
# usage: ./run.sh all --preview [--nobake]
B="/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$B" -b --factory-startup --python 'D:\_AI_GENERATED\______2026\horror\blender\build.py' -- "$@" 2>&1 | grep -vE "^Fra:|Saved:|^ *Time|DeprecationWarning|use_nodes = True"
