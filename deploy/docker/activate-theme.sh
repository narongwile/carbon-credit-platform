#!/usr/bin/env bash
# Activates the ThermExpertise theme once WordPress is installed.
# Runs via the official wordpress image init hook. Safe to re-run (idempotent).
set -euo pipefail

# wp-cli is not in the base image; install on demand if absent.
if ! command -v wp >/dev/null 2>&1; then
  curl -fsSL -o /usr/local/bin/wp \
    https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar || exit 0
  chmod +x /usr/local/bin/wp
fi

cd /var/www/html

# Only act when core is already installed (skips on very first request).
if wp core is-installed --allow-root 2>/dev/null; then
  current="$(wp theme list --status=active --field=name --allow-root 2>/dev/null || true)"
  if [ "$current" != "thermexpertise" ]; then
    wp theme activate thermexpertise --allow-root || true
  fi
fi
