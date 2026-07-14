#!/usr/bin/env bash
#
# Deploy the iiq-devtools plugin to a local IdentityIQ docker container.
#
# Flow: [mvn package] -> docker cp zip -> iiq console (uninstall if present,
# install) -> verify with `plugin list` -> [restart container] -> ping the
# plugin REST API.
#
# A console install is not immediately visible to the running Tomcat (the
# console runs in its own JVM): the webapp picks it up when its plugin sync
# service polls the database, which can take several minutes. Pass --restart
# (or install through the UI, gear > Plugins) for immediate loading.
#
# Usage: ./deploy.sh [options]
#   -b, --build            run `mvn package` first
#   -r, --restart          restart the container after install (required for
#                          the running webapp to pick up a console install)
#   -c, --container NAME   target container (default: first one whose image
#                          matches iiq:*)
#   -z, --zip PATH         plugin zip (default: most recently built
#                          target/vscode-plugin-*-bin.zip)
#   -h, --help             this help
#
# Environment (for the final ping check):
#   IIQ_URL      default http://localhost:8080/identityiq
#   IIQ_USER     default spadmin
#   IIQ_PASSWORD default admin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PLUGIN_NAME="vscodePlugin"
IIQ_CONSOLE="/usr/local/tomcat/webapps/identityiq/WEB-INF/bin/iiq console"
IIQ_URL="${IIQ_URL:-http://localhost:8080/identityiq}"
IIQ_USER="${IIQ_USER:-spadmin}"
IIQ_PASSWORD="${IIQ_PASSWORD:-admin}"
PING_URL="$IIQ_URL/plugin/rest/iiq-devtools/system/ping"

BUILD=false
RESTART=false
CONTAINER=""
ZIP=""

usage() { sed -n '2,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--build) BUILD=true ;;
    -r|--restart) RESTART=true ;;
    -c|--container) CONTAINER="$2"; shift ;;
    -z|--zip) ZIP="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
fail() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

# Run iiq console commands (stdin) inside the container; print the console
# output with the log4j noise filtered out. The full output is kept in
# $CONSOLE_OUT for error reporting and grepping.
iiq_console() {
  CONSOLE_OUT="$(docker exec -i "$CONTAINER" $IIQ_CONSOLE 2>&1)" || {
    echo "$CONSOLE_OUT" >&2
    fail "iiq console failed"
  }
  echo "$CONSOLE_OUT" | grep -v -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T| (TRACE|DEBUG|INFO|WARN) ' || true
}

# --- Build ------------------------------------------------------------------

if $BUILD; then
  log "Building the plugin (mvn package)"
  (cd "$SCRIPT_DIR" && mvn -q package)
fi

if [[ -z "$ZIP" ]]; then
  ZIP="$(ls -t "$SCRIPT_DIR"/target/vscode-plugin-*-bin.zip 2>/dev/null | head -1)"
fi

[[ -n "$ZIP" && -f "$ZIP" ]] || fail "Plugin zip not found in target/ (build it with 'mvn package' or pass --build), or pass --zip PATH"

# --- Locate the container ----------------------------------------------------

if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$(docker ps --format '{{.Image}}\t{{.Names}}' | awk -F'\t' '$1 ~ /^iiq:/ {print $2; exit}')"
  [[ -n "$CONTAINER" ]] || fail "No running container with an iiq:* image (use --container)"
fi
log "Target container: $CONTAINER"

# --- Copy the zip -------------------------------------------------------------

ZIP_IN_CONTAINER="/tmp/$(basename "$ZIP")"
log "Copying $(basename "$ZIP") to $CONTAINER:$ZIP_IN_CONTAINER"
docker cp "$ZIP" "$CONTAINER:$ZIP_IN_CONTAINER"

# --- Uninstall (if present) + install -----------------------------------------

log "Checking installed plugins"
iiq_console <<< "plugin list" >/dev/null
COMMANDS=""
if grep -q "$PLUGIN_NAME" <<< "$CONSOLE_OUT"; then
  log "$PLUGIN_NAME is installed: it will be uninstalled first"
  COMMANDS="plugin uninstall $PLUGIN_NAME"$'\n'
fi
COMMANDS+="plugin install $ZIP_IN_CONTAINER"

log "Installing $PLUGIN_NAME"
iiq_console <<< "$COMMANDS"
grep -q "successfully installed $PLUGIN_NAME" <<< "$CONSOLE_OUT" \
  || fail "Install did not report success (see output above)"

log "Verifying with 'plugin list'"
iiq_console <<< "plugin list"
grep -E "$PLUGIN_NAME\s+.*Enabled" <<< "$CONSOLE_OUT" >/dev/null \
  || fail "$PLUGIN_NAME is not listed as Enabled"

# --- Restart (optional) --------------------------------------------------------

if $RESTART; then
  log "Restarting $CONTAINER"
  docker restart "$CONTAINER" >/dev/null
  log "Waiting for the plugin REST API (up to 5 min)"
  for _ in $(seq 1 60); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -u "$IIQ_USER:$IIQ_PASSWORD" "$PING_URL" || true)"
    [[ "$CODE" == "200" ]] && break
    sleep 5
  done
fi

# --- Ping ----------------------------------------------------------------------

log "Ping: $PING_URL"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -u "$IIQ_USER:$IIQ_PASSWORD" "$PING_URL" || true)"
case "$CODE" in
  200)
    curl -s -u "$IIQ_USER:$IIQ_PASSWORD" "$PING_URL"; echo
    log "Deployment successful"
    ;;
  404)
    fail "Plugin installed but the REST API answers 404: the running Tomcat has not loaded it yet. Wait a few minutes for the plugin sync service, or re-run with --restart."
    ;;
  401|403)
    fail "Plugin API answered $CODE: check IIQ_USER/IIQ_PASSWORD (and the iiqDevToolsAccess right)"
    ;;
  *)
    fail "Unexpected HTTP $CODE from $PING_URL (is IdentityIQ up at $IIQ_URL?)"
    ;;
esac
