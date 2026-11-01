-- The one prototype this mod adds: the icon of its button in the top left corner
-- (scripts/gui.lua puts the button in the button flow of the base game's mod-gui,
-- the frame all mods share). The window it opens is scripts/gui.lua's. The name is
-- the one of gui.SPRITE.
data:extend({
  {
    type = "sprite",
    name = "fp-viewer-button",
    filename = "__factorio-planner-viewer__/graphics/button-x56.png",
    size = 56,
    flags = { "gui-icon" },
  },
})
