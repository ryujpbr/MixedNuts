# Mixed Nuts Engine

This package contains the pure poker engine used by Mixed Nuts.

## Principles

- Server authoritative
- Variants are data-driven
- Engine functions are pure and deterministic
- Every action can be represented in the event log for replay

## Scope

Supported variants include NLH, PLO, PLO8, BigO, FLH and FLO8.

The engine contains card/deck handling, hand evaluation, betting, pot calculation, showdown, table state, hand state, and variant registration.