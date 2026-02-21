/**
 * Create global post-function plugin for scale-to-zero wake-up
 *
 * Intercepts 502/503 responses (ALB has no healthy targets),
 * fires async HTTP call to wake-up Lambda, returns 503 with Retry-After.
 *
 * The WAKEUP_LAMBDA_URL is injected at build time via placeholder resolution.
 * Requires: KONG_UNTRUSTED_LUA_SANDBOX_REQUIRES=resty.http (for HTTP library)
 * See: docs/in-dev/phase-21-aws-service-discovery-fix.md (Phase 21.11d)
 */

import type { KongPlugin } from '@tsdevstack/cli/plugin';

export function createWakeupPostFunction(): KongPlugin {
  // Lua code for post-function header_filter phase
  // Note: ${WAKEUP_LAMBDA_URL} is resolved at Kong build time, not runtime
  const luaCode = `
local status = kong.response.get_status()
local method = kong.request.get_method()

-- Skip wake-up for OPTIONS requests (preflight) - let CORS plugin handle
if method == "OPTIONS" then
  return
end

if status == 502 or status == 503 then
  -- Fire-and-forget wake-up call
  ngx.timer.at(0, function()
    local ok, err = pcall(function()
      local http = require("resty.http")
      local httpc = http.new()
      -- URL and secret are baked in at build time (os.getenv not available in Kong sandbox)
      local lambda_url = "\${WAKEUP_LAMBDA_URL}"
      local wakeup_secret = "\${WAKEUP_SECRET}"
      if lambda_url == "" or lambda_url:find("^%$") then
        kong.log.err("WAKEUP_LAMBDA_URL not resolved at build time")
        return
      end
      if wakeup_secret == "" or wakeup_secret:find("^%$") then
        kong.log.err("WAKEUP_SECRET not resolved at build time")
        return
      end

      -- Strip trailing slash to avoid double-slash in URL
      lambda_url = lambda_url:gsub("/$", "")
      local host = lambda_url:gsub("https://", "")
      local url = lambda_url .. "/wake"

      kong.log.notice("Calling wake-up Lambda: ", url)

      local res, req_err = httpc:request_uri(url, {
        method = "POST",
        headers = {
          ["Host"] = host,
          ["Content-Type"] = "application/json",
          ["X-Wake-Secret"] = wakeup_secret
        },
        body = '{"action":"wake-all"}',
        ssl_verify = false
      })

      if req_err then
        kong.log.err("Wake-up Lambda call failed: ", req_err)
      elseif res then
        kong.log.notice("Wake-up Lambda response: ", res.status)
      end
    end)

    if not ok then
      kong.log.err("Wake-up error: ", err)
    end
  end)

  -- Get Origin header for CORS response
  local origin = kong.request.get_header("Origin") or "*"

  -- Return 503 to client with retry hint and CORS headers
  kong.response.exit(503,
    '{"error":"Service starting, please retry","retryAfter":30}',
    {
      ["Retry-After"] = "30",
      ["Content-Type"] = "application/json",
      ["Cache-Control"] = "no-cache, no-store",
      ["Access-Control-Allow-Origin"] = origin,
      ["Access-Control-Allow-Credentials"] = "true"
    }
  )
end
`;

  return {
    name: 'post-function',
    config: {
      header_filter: [luaCode.trim()],
    },
  };
}
