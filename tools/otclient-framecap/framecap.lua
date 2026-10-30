-- The default "max" framerate slows the local model on the same GPU from 46 to 9 tokens/s; any real
-- limit up to 60 FPS keeps full speed (measured in DOCS/iterations/0012). client_options applies its
-- saved value during startup, so the cap is set a moment later.
TibiaAIFrameCap = {}

local MAX_FPS = 60

function TibiaAIFrameCap.init()
  scheduleEvent(function()
    g_app.setMaxFps(MAX_FPS)
    g_logger.info("[TibiaAI] framerate limit " .. MAX_FPS)
  end, 3000)
end
