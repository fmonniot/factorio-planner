# Solver Chain Specifications

Each file in this directory documents a production chain used as an integration
test fixture for the solver.  They are generated from the real Nullius game data
and committed so reviewers can inspect the chain without running the game.

## Methodology

1. **Trace** the dependency graph with the helper script:

   ```sh
   node scripts/trace-recipe-chain.js data/samples/nullius/game-data.json \
        <itemId>:<rate/min> \
        --md spec/solver-chains/<name>.md \
        > src/solver/__fixtures__/<name>.fixture.json
   ```

   The script performs a depth-first traversal from each goal item, following the
   *default producer* (the recipe whose id matches the item id, or the first
   recipe that produces the item).  Shared nodes are expanded once; subsequent
   references show a back-link.  Cycles (e.g. boxing ↔ unboxing) are detected
   via a call-stack set and recorded as leaves.

2. **Review** the generated `.md` file.  Check that:
   - the chosen default recipes make sense for the chain you want to test,
   - any surprising shared/cycle nodes are intentional, and
   - the raw-input list matches expectations.

   If a different recipe should be the default producer for a given item, edit
   the fixture JSON (`nodes[*].recipeId`) and update the markdown manually.

3. **Commit** both files together.  The `.fixture.json` is consumed by
   `src/solver/index.integration.test.ts`; the `.md` is documentation only.

## Files

| Chain | Nodes | Raw inputs | Notes |
|-------|------:|-----------|-------|
| [automation-science-pack.md](./automation-science-pack.md) | 4 | iron-ore, copper-ore | Assembler chain; ores are cycle targets, treated as external raw inputs |
| [chemical-science-pack.md](./chemical-science-pack.md) | 13 | coal | Oil processing, plastic, advanced circuits, engine units |
| [logistic-science-pack.md](./logistic-science-pack.md) | 10 | iron-ore | Motors, inserters, belts; iron ore is cycle target, treated as external |

## Adding a new chain

```sh
# 1. Trace the chain
node scripts/trace-recipe-chain.js data/samples/nullius/game-data.json \
     my-item:60 \
     --md spec/solver-chains/my-item.md \
     > src/solver/__fixtures__/my-item.fixture.json

# 2. Review spec/solver-chains/my-item.md — edit fixture JSON if needed

# 3. Add a describe() block in src/solver/index.integration.test.ts
#    following the same pattern as the existing chains

# 4. Commit both files
```

## Notes on Nullius specifics

* **Boxing cycle** — In Nullius, boxing and unboxing (`nullius-box-<ore>` /
  `nullius-unbox-<ore>`) are a throughput optimisation mechanism; they do not
  change where ore comes from.  The box→unbox→ore→box loop creates a circular
  dependency in the recipe graph that makes the linear system underdetermined.
  The tracer detects this cycle and excludes the boxing recipe; the unboxing
  recipe (and the ore item it produces) are retained so the solver can still
  account for the ore consumption.  The ore itself is treated as a raw external
  input, which is correct: it is mined, not crafted.

* **Many machine types** — Nullius uses custom machines (`nullius-chemical-plant-3`,
  `nullius-crusher-3`, etc.) that are referenced via `defaultMachines` in the
  game data.  The solver uses defaults when no `machineId` override is given.

* **Byproducts** — Many Nullius recipes have multiple outputs.  The solver feeds
  all byproducts back by default (policy `feed-back`).  Individual fixture nodes
  can set `byproductPolicy` to override this.
