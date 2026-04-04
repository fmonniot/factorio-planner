# Factorio Planner — Project Overview

## Goal

A web-based production planner for Factorio, targeting the **Nullius** overhaul mod. Given a set of desired output rates, it computes the full production chain: every recipe, intermediate product, raw resource, machine count, and power draw required to satisfy those goals — including cycles and multi-output recipes.

The UI follows helmod's general approach: a panel-based layout where users build up a list of production goals and inspect the resulting tree interactively.

## Scope

**v1 target: Nullius mod (Factorio 2.0).** The app is data-driven and not hardcoded to Nullius, but the only tested and supported dataset for the first release is the Nullius export. Vanilla and other mods are explicitly deferred.

## Non-Goals (v1)

- Vanilla Factorio or any mod other than Nullius
- Factorio 1.1 support — target is 2.0 only
- Belt/logistics network layout or spatial planning
- Multiplayer or shared editing sessions
- Map-level infrastructure (power grids, train networks)
- Mining/extraction modelling — raw resources are reported as sinks (e.g. "iron-ore: 180/min"), not as machines to configure

## Design Principles

- **Client-side only.** No backend. The solver runs in the browser; plans are stored in localStorage and shareable via URL.
- **Data-agnostic.** The app works off a game data JSON bundle. The Nullius bundle is the default; other mod sets can be imported.
- **Solver-first.** The matrix solver is the core of the app. The UI is built to expose and override its outputs, not to replace it with manual calculations.
- **Progressive complexity.** Basic use (add item, see machine count) should require zero configuration. Advanced use (modules, beacons, alternate recipes, byproduct routing) should be accessible but not mandatory.
