-- Settings stage: the mod's runtime-global settings. No game API, no require
-- (the default port is a literal here; spec/settings_spec.lua checks that it
-- equals lib/constants.lua's DEFAULT_BRIDGE_PORT).
data:extend({
  {
    type = "int-setting",
    name = "fp-viewer-bridge-port",
    setting_type = "runtime-global",
    default_value = 34199,
    minimum_value = 1,
    maximum_value = 65535,
    order = "a",
  },
  {
    type = "bool-setting",
    name = "fp-viewer-debug",
    setting_type = "runtime-global",
    default_value = false,
    order = "b",
  },
})
