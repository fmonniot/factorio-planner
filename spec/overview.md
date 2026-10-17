# Factorio Planner — Project Overview

## Goal

A web-based production planner for Factorio, built first for the **Nullius** overhaul mod. Given a set of desired output rates, it computes the full production chain: every recipe, intermediate product, raw resource, machine count, and power draw required to satisfy those goals — including cycles and multi-output recipes.

The UI is a flat production table: the user sets goals for a block, adds recipes as rows (optionally grouped into collapsible sub-factories), and reads the solved rates, machine counts and imports directly in the table and the summary panes above it. See [ui.md](ui.md).

## Scope

**Factorio 2.0, Nullius first.** The app is data-driven and not hardcoded to any mod. Two datasets are bundled and selectable: **Nullius** (the primary, tested dataset — e2e tests use it) and **Seablock** (bundled, best-effort). Any other mod set can be loaded by uploading a `game-data.json` produced by `scripts/build-game-data.js`.

## Non-Goals

- Factorio 1.1 support — target is 2.0 only
- Belt/logistics network layout or spatial planning
- Multiplayer or shared editing sessions
- Map-level infrastructure (power grids, train networks)
- Mining/extraction modelling — raw resources are reported as sinks (e.g. "iron-ore: 180/min"), not as machines to configure

## Design Principles

- **Client-side only.** No backend. The solver runs in the browser; plans are stored in localStorage, and an uploaded custom game-data file is stored in IndexedDB. Plans can be exported as JSON.
- **Data-agnostic.** The app works off a game data JSON bundle. Nothing is loaded until the user picks a dataset (bundled Nullius or Seablock, or an uploaded file); the choice is remembered for later visits.
- **Solver-first.** The LP solver is the core of the app. The UI is built to expose and override its outputs, not to replace it with manual calculations.
- **Progressive complexity.** Basic use (add item, see machine count) should require zero configuration. Advanced use (modules, beacons, alternate recipes, byproduct routing) should be accessible but not mandatory.
