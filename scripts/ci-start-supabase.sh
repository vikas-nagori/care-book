#!/usr/bin/env bash
# Starts the local Supabase stack on a CI e2e runner (.github/workflows/test.yml). CI only: it uses
# sudo and destroys sockets, so never run it on a workstation.
#
# Why the port handling: Supabase publishes kong 54321, db 54322 and mailpit 54324, all inside
# Linux's ephemeral range (32768-60999). Any outbound connection can get one of them as its source
# port, and Docker then fails to publish it with "failed to bind host port 0.0.0.0:54322/tcp:
# address already in use". A failing job (2026-11-24, admin-mobile 1/6) showed the holder:
#   ESTAB [::ffff:10.1.0.182]:54322 -> 20.85.130.105:443  users:(("Runner.Worker",pid=2764,...))
# i.e. the runner's own HTTPS connection, opened during "Set up job" before any step could reserve
# the block, and kept open all job, so a plain stop-and-retry hit the same socket again.
# The workflow's first step reserves 54320-54329 (net.ipv4.ip_local_reserved_ports), so nothing
# opened afterwards can take them; this script destroys any socket that took one earlier. Its owner
# sees a reset and reconnects, and the reservation keeps the new connection out of the block.
set -uo pipefail

PORTS='( sport >= :54320 and sport <= :54329 )'
EXCLUDE='studio,imgproxy,edge-runtime,realtime,storage-api,postgres-meta,logflare,vector,supavisor'

# Every non-TIME-WAIT TCP socket with a local port in the block (TIME-WAIT does not block a bind).
held() { sudo ss -tanpH exclude time-wait "$PORTS"; }

release_ports() {
  local sockets
  sockets=$(held)
  [ -z "$sockets" ] && return 0
  echo "::warning::Supabase ports held before start; destroying these sockets:"
  echo "$sockets"
  sudo ss -K exclude time-wait "$PORTS" >/dev/null || true
  for _ in $(seq 1 30); do
    if [ -z "$(held)" ]; then
      echo 'Supabase ports released.'
      return 0
    fi
    sleep 1
  done
  echo '::warning::Supabase ports still held after 30 s:'
  held
}

diagnose() {
  echo '--- listening TCP sockets'
  sudo ss -ltnpH || true
  echo '--- every TCP socket on 54320-54329'
  sudo ss -tanpH "$PORTS" || true
  echo '--- docker-proxy processes'
  pgrep -a docker-proxy || true
  echo '--- containers'
  docker ps -a || true
  echo '--- networks'
  docker network ls || true
}

start() { npx supabase start -x "$EXCLUDE"; }

release_ports
start && exit 0

echo '::warning::supabase start failed; diagnosing, cleaning up and retrying once'
diagnose
npx supabase stop --no-backup || true
# Whatever the failed start left behind: the runner is fresh, so every supabase_* object is ours.
docker ps -aq --filter name=supabase_ | xargs -r docker rm -f
docker network ls -q --filter name=supabase_ | xargs -r docker network rm
release_ports
start
