#!/bin/bash
# Phase 4 QA sweep with auto server-restart (chrome tab is reused across restarts)
cd /home/z/my-project

restart() {
  pkill -f "next-server" 2>/dev/null; pkill -f "next dev" 2>/dev/null; sleep 2
  setsid nohup bun run dev > dev.log 2>&1 < /dev/null & disown
  sleep 12
  curl -s -o /dev/null --max-time 150 http://localhost:3000/
  sleep 2
  # precompile the heavy AI route + SDK while chrome is idle (avoid OOM during live test)
  curl -s --max-time 240 -X POST http://localhost:3000/api/ai/stream \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"warmup"}]}' >/dev/null 2>&1
  sleep 2
}

alive() { curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/; }

visit() { # $1=app-id  -> navigates the existing tab, retries once after restart
  local id="$1"
  for try in 1 2 3; do
    agent-browser open "http://localhost:3000/#/app/$id" >/dev/null 2>&1
    sleep 3
    if [ "$(alive)" = "200" ]; then
      echo "OK-VISIT $id"
      return 0
    fi
    echo "DIED on $id (try $try) — restarting"
    restart
    agent-browser reload >/dev/null 2>&1
    sleep 3
  done
  echo "FAILED $id after 3 tries"
  return 1
}

errs() { # prints non-empty errors, else CLEAN
  local e c
  e=$(agent-browser errors 2>&1 | rg -v "No (page )?errors|✗ No errors|^$" | head -3)
  c=$(agent-browser console 2>&1 | rg -i "error" | rg -v "Fast Refresh|HMR|React DevTools|Download the React" | head -3)
  if [ -n "$e$c" ]; then echo "ISSUES: $e | $c"; else echo "CLEAN"; fi
}
