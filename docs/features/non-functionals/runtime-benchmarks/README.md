# Runtime Benchmarks

## Purpose

Use this folder for the performance and stability comparison track across Bun, Go, and Rust implementations.

## Why This Exists

The project goal explicitly treats the implementation language as an experiment.

That comparison should be grounded by shared scenarios and test definitions, not hand-wavy impressions.

## Scope

- benchmark workloads
- soak-test workloads
- metric definitions
- acceptance thresholds for comparative runs

## Workflow

- track area state in `docs/features/feature-tables.md`
- track executable work in `docs/tasks/features/runtime-benchmarks`
- keep the ground-truth scenarios in `docs/tests/features/runtime-benchmarks`
