# Notes

> :info: This is a non-structured list of notes I took while working on this project.


- Selecting module should show real name, not id. IDs aren't really readable. May bring the localization question to the table.
    - Same for machines

- Adding an item is seemingly not correlated to the goal we created.
    - It is, in a way. The goal will drive the target rate. What's less intuitive is that creating a goal doesn't prompt for the initial recipe choice.

- Beacon UI isn't super clear. How do I add multiple type of beacon for example? Same issue of UI reset as modules. Also can't set up different kind of module per slot. Probably a lot easier to show one drop down per module slot.
    - Also need to add some logic to correctly apply module restriction. Doubts prod modules can go into nullius beacons.
        - Double check in game before launching clode on that.


- Alright, now we have the same issue as with helmod. Needs to see if we can add constraints that force the solver to pick a certain rate for certain product and work around it. That does mean it will be able to work with things like "I'll need to x amount of y as raw inputs to complete the calculation" rather than scaling other sources for said item.
    - Maybe learn more about solvers in general. Probably a solved problem (tadum tss) but I know nothing of this area of Mathematics

- nullius-saline-electrolysis still not using english locale

- UI should not use the Goals/Nodes side panel. Instead goals should be set in the top bar (edit in the main outputs). Nodes are already mostly configurable with the node cards. Only need to have a plus button somewhere (suggest where) and a close button on each card.

- Should the warning UI be divided into warning and errors? The former are suggestions and the latter block the plan from resolving

- Tree View

Isn't a tree, it's just a list of card. Is that the UI you intended or you forgot to implement something here?

- Redo the UI using helmod/factory planner as a reference
    - https://mods.factorio.com/mod/helmod
    - https://mods.factorio.com/mod/factoryplanner


- Icon export:
    - Needs to understand what multiple icon mean (stack? Alternatives).
    - For sure needs to handle the RBG tint.

    "name": "nullius-hydrogen-chloride",
      "icons": 
      [
        {
          "icon": "__angelsrefininggraphics__/graphics/icons/angels-gas/gas-item-base.png",
          "icon_size": 596,
          "scale": 0.0536912751677852373433097454835660755634307861328125,
          "tint": 
          {
            "r": 0.25,
            "g": 0.25,
            "b": 0.25,
            "a": 0.7
          }
        },
        
        {
          "icon": "__angelsrefininggraphics__/graphics/icons/angels-gas/gas-item-top.png",
          "icon_size": 596,
          "scale": 0.0536912751677852373433097454835660755634307861328125,
          "tint": 
          {
            "r": 0.125490196078431370807493294705636799335479736328125,
            "g": 0.8784313725490196844702950329519808292388916015625,
            "b": 0.125490196078431370807493294705636799335479736328125,
            "a": 1
          }
        },
        
        {
          "icon": "__angelsrefininggraphics__/graphics/icons/angels-gas/gas-item-mid.png",
          "icon_size": 596,
          "scale": 0.0536912751677852373433097454835660755634307861328125,
          "tint": 
          {
            "r": 0.125490196078431370807493294705636799335479736328125,
            "g": 0.8784313725490196844702950329519808292388916015625,
            "b": 0.125490196078431370807493294705636799335479736328125,
            "a": 1
          }
        },
        
        {
          "icon": "__angelsrefininggraphics__/graphics/icons/angels-gas/gas-item-bot.png",
          "icon_size": 596,
          "scale": 0.0536912751677852373433097454835660755634307861328125,
          "tint": 
          {
            "r": 0.94117647058823532546512069529853761196136474609375,
            "g": 0.94117647058823532546512069529853761196136474609375,
            "b": 0.94117647058823532546512069529853761196136474609375,
            "a": 1
          }
        },
        
        {
          "icon": "__angelspetrochemgraphics__/graphics/icons/molecules/hydrogen-chloride.png",
          "icon_size": 72,
          "shift": 
          [
            -10,
            -10
          ],
          "scale": 0.15
        }
      ]