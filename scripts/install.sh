#!/usr/bin/env bash
# KAGE installer — installs the desktop companion and the OpenCode plugin
# without requiring Node, Rust, or a checkout of this repository.
#
# Usage:
#   curl -fsSL <raw-url>/scripts/install.sh | bash
#   ./install.sh [--uninstall] [--deb] [--version vX.Y.Z]
#
# Environment overrides (used by tests):
#   KAGE_INSTALL_DEST   where the AppImage goes (default ~/.local/bin)
#   KAGE_REPO           GitHub repo (default Sanket758/KAGE)
#   KAGE_FAKE_HOME      redirect config writes (tests only)

set -euo pipefail

REPO="${KAGE_REPO:-Sanket758/KAGE}"
API_BASE="${KAGE_API_BASE:-https://api.github.com}"
VERSION_ARG="${2:-}"
DEST="${KAGE_INSTALL_DEST:-$HOME/.local/bin}"
CONFIG_HOME="${KAGE_FAKE_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}}"
PLUGIN_DIR="$CONFIG_HOME/opencode/plugins"
APPIMAGE_DEST="$DEST/KAGE.AppImage"
PLUGIN_DEST="$PLUGIN_DIR/kage.js"
# Older installers wrote a login autostart entry; KAGE no longer does.
# The first installer ignored XDG_CONFIG_HOME, so check both locations.
LEGACY_AUTOSTART="$CONFIG_HOME/autostart/kage.desktop"
OLD_INSTALLER_AUTOSTART="${KAGE_FAKE_HOME:-$HOME/.config}/autostart/kage.desktop"
OLD_APP_AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/kage.desktop"

log() { printf 'kage-install: %s\n' "$*"; }
die() { printf 'kage-install: ERROR: %s\n' "$*" >&2; exit 1; }

fetch() { # fetch <url> <outfile>
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "need curl or wget to download anything"
  fi
}

api_url() {
  if [ -n "$VERSION_ARG" ]; then
    printf '%s/repos/%s/releases/tags/%s' "$API_BASE" "$REPO" "$VERSION_ARG"
  else
    printf '%s/repos/%s/releases/latest' "$API_BASE" "$REPO"
  fi
}

asset_url() { # asset_url <substring> — find a release asset URL by name fragment
  local assets
  assets="$(fetch "$(api_url)" -)" || die "could not reach https://github.com/$REPO/releases"
  printf '%s\n' "$assets" | grep -o '"browser_download_url": *"[^"]*"' |
    sed 's/.*"\(http[^"]*\)"/\1/' | grep -F "$1" | head -n 1
}

check_system_libs() {
  local missing=0 lib
  for lib in libwebkit2gtk-4.1.so libgtk-3.so; do
    if ! (ldconfig -p 2>/dev/null | grep -q "$lib"); then
      log "missing system library: $lib"
      missing=1
    fi
  done
  if [ "$missing" -eq 1 ]; then
    log "on Debian/Ubuntu/Pop!_OS:  sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0"
    log "(required to run the companion; installation continues)"
  fi
}

uninstall() {
  rm -f "$APPIMAGE_DEST" "$PLUGIN_DEST"
  rmdir "$PLUGIN_DIR" 2>/dev/null || true
  rm -f "$LEGACY_AUTOSTART" "$OLD_INSTALLER_AUTOSTART" "$OLD_APP_AUTOSTART" 2>/dev/null || true
  log "removed companion, plugin, and any legacy autostart entry"
  exit 0
}

case "${1:-}" in
  --uninstall) uninstall ;;
esac

command -v uname >/dev/null 2>&1 || die "not a linux system"
[ "$(uname -s)" = "Linux" ] || die "this installer supports Linux only"
[ "$(uname -m)" = "x86_64" ] || log "warning: only x86_64 release artifacts are published today"

log "resolving latest release of $REPO"
APP_URL="$(asset_url .AppImage)" || APP_URL=""
PLUGIN_URL="$(asset_url kage.js)" || PLUGIN_URL=""
[ -n "$APP_URL" ] || die "no AppImage asset found in the release"
[ -n "$PLUGIN_URL" ] || die "no kage.js plugin asset found in the release"

mkdir -p "$DEST" "$PLUGIN_DIR"
log "downloading companion -> $APPIMAGE_DEST"
fetch "$APP_URL" "$APPIMAGE_DEST"
chmod +x "$APPIMAGE_DEST"

log "downloading opencode plugin -> $PLUGIN_DEST"
fetch "$PLUGIN_URL" "$PLUGIN_DEST"
chmod 600 "$PLUGIN_DEST" 2>/dev/null || true

rm -f "$LEGACY_AUTOSTART" "$OLD_INSTALLER_AUTOSTART" "$OLD_APP_AUTOSTART" 2>/dev/null || true

check_system_libs

log "done. next steps:"
log "  1. restart opencode (or run: opencode service restart) so the plugin loads"
log "  2. the plugin launches KAGE when a session starts — drag it by grabbing the sprite"
log "  3. on COSMIC: Settings -> Appearance -> Floating windows -> turn OFF"
log "     'Match system corners and apply shadows' or a card outline shows around it"
log "  uninstall any time: $0 --uninstall"
