#!/bin/sh
# Greet someone by name. Used by the `greet` skill (see ../SKILL.md).
name="${1:-world}"
printf 'Hello, %s! Welcome to x_harness.\n' "$name"
