# Runtime Benchmark Tests

## Purpose

These test cases define the shared workloads for later Bun, Go, and Rust comparisons.

They are not implementation-specific and should remain the common benchmark ground truth.

## Test Case 1: Single-Agent Baseline

### Preconditions

- one implementation of the runtime is available

### Steps

1. start one agent session
2. send a fixed sequence of prompts
3. record startup latency, prompt latency, peak memory, and error rate

### Expected Results

- measurements are captured with the same workload and metric names across implementations
- the benchmark output is reproducible enough to compare runs

## Test Case 2: Concurrent-Agent Soak

### Preconditions

- the benchmark harness can create multiple agents

### Steps

1. start a fixed number of concurrent agent sessions
2. run a sustained prompt workload for a fixed duration
3. record throughput, latency percentiles, memory, and crash or restart counts

### Expected Results

- every implementation is measured under the same concurrency and duration
- failure conditions are recorded explicitly instead of being hidden in logs
