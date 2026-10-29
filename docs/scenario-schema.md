# Scenario schema and CLI

## Files

- `data/snapshot.json`: captured catalog, current endless stage, and non-sensitive capture metadata.
- `examples/endless-current.json`: one scenario object.
- `examples/endless-compare.json`: an array of scenario objects for `compare`.

## Scenario fields

```json
{
  "name": "candidate-name",
  "stageId": 9101,
  "stage": null,
  "team": [
    { "id": "c2", "level": 40 },
    { "id": "s4", "level": 17 }
  ],
  "items": [],
  "policy": {
    "walletTarget": 8,
    "economyFirst": true,
    "openers": ["c2"],
    "deploySequence": ["s4", "c2", "s1"],
    "targetCounts": { "s4": 7, "s1": 6, "c2": 1 },
    "priority": ["s4", "s1", "c2"],
    "fallbackAfter": 775,
    "fallbackPriority": ["c6", "c2", "c1"],
    "autoCannon": false,
    "automatic": true,
    "actionGap": 0.25,
    "observationDelay": 0.1,
    "actions": []
  },
  "maxTime": 900
}
```

- `stageId`: id from the captured catalog. Omit it to use `.stage` (the captured endless stage, currently 9101).
- `stage`: optional inline stage object. When present it takes precedence over `stageId`; use this for event stages that are not part of the captured catalog.
- `team`: at most the catalog's `team_size`, normally 10. Each entry is a unique cat id plus a level. Repeated copies on the field come from repeatedly deploying one slot.
- `items`: any of `start_coins`, `fast_coins`, `strong_base`, `cannon_ready`, `rally`.
- `maxTime`: stop the simulation early. The reported `duration` never exceeds this value. Use `null` or omit it for the stage time limit.
- `seed` and `seedStart`: optional defaults for a single run and a batch.
- `runs`: optional default run count when `--runs` is absent.

## Automatic policy

The action loop runs before each 0.02-second battle step and performs at most one world action per step.

- `actionGap`: minimum simulated seconds between successful world actions (default `0`). Use `0.25` to match the browser executor's 250 ms real-time action throttle. With the 0.02-second step the effective interval becomes the next step at or after the gap (0.26 seconds for `0.25`).
- `observationDelay`: seconds by which the controller's view of the battle lags the live engine (default `0`). Use `0.1` to model the browser executor's roughly 10 Hz React snapshot: money, wallet level/cost, cannon charge, slot cooldowns, field counts, and result are read from the state captured that long ago. Actions still apply to the live engine. This is an observation limit, not a battle-step limit; the engine itself remains fixed at 0.02 seconds.
- `openers`: cat ids deployed once before the economy phase. Deployment can fail if money or cooldown is insufficient and is retried later.
- `deploySequence`: optional ordered cat-id list deployed after the wallet target is reached. Repeated ids are allowed. The next entry is strict: if it is unaffordable, cooling down, or unavailable, the policy waits for that exact cat and does not fall through to `priority` or `fallbackPriority` until the sequence is complete.
- `autoCannon`: with a deploy sequence, a charged cannon may still fire while the policy is waiting for the next fixed unit; the cannon does not spend money or advance the sequence.
- `walletTarget`: wallet level from 1 to 8. While below it, the policy first satisfies unfilled openers, then buys the next wallet level when affordable.
- `economyFirst`: when true, the policy waits for the wallet target before spending on the normal lineup. This does not stop scheduled actions.
- `targetCounts`: desired number of living copies per cat id. Zero or absent means no permanent target.
- `priority`: order used to deploy cats that are below their target count. A cat whose slot is on cooldown does not block the next priority.
- `fallbackAfter`: battle time in seconds after which unused field slots can be filled by replacement units.
- `fallbackPriority`: order used for replacement units. They are deployed only when no target cat can currently be deployed or when targets are already full.
- `autoCannon`: fire the paw cannon whenever it is charged.
- `automatic`: set false to use only `actions`.

## Scheduled actions

`actions` overrides the automatic choice at the listed time and is useful for exact deployment timing tests:

```json
[
  { "at": 0, "type": "deploy", "id": "c2" },
  { "at": 4, "type": "wallet" },
  { "at": 30, "type": "cannon" },
  { "at": 41.5, "type": "deploy", "id": "s2" }
]
```

Supported types are `deploy`, `wallet`, `cannon`, and `wait`. Failed actions remain consumed; they are not retried unless a later action repeats them.

## Commands

```bash
node src/cli.mjs run scenario.json --seed 7 --events
node src/cli.mjs run scenario.json --seed 7 --trace --output trace.json
node src/cli.mjs batch scenario.json --seed-start 1 --runs 100 --jobs 8
node src/cli.mjs compare scenarios.json --runs 50 --jobs 8 --output result.md
node src/cli.mjs cats --tier S
node src/cli.mjs waves --stage-id 9101 --output /tmp/waves.json
```

`--trace` adds `actionLog` to a single-run JSON result. Each entry uses the original `0.02`-second tick converted to seconds.

Copying that array into `policy.actions` with `automatic: false` reproduces the run under the same source, snapshot, seed, `actionGap`, and `observationDelay`. When `observationDelay` is non-zero, an action's logged time is the live engine time; the corresponding view time is earlier by the delay, so a replay scheduled from the log needs that offset (the world-boss and endless replay files use `at = liveAt - 0.1`). A tiny clock tolerance prevents decimal `at` values from slipping one frame.

`--format` accepts `json`, `table`, or `markdown`. An `.md` output path selects Markdown automatically. `--summary-only` removes per-run objects from batch/compare JSON.

## Output

A single run reports:

- `result`: `lost`, `timeup`, `won`, or `limit` when `maxTime` is reached first.
- `duration`: simulated battle seconds.
- `round`: `min(30, floor(duration / 30) + 1)` for the endless display convention.
- `towerHp`, `towerMaxHp`, `enemyBaseHp`, `money`, `walletLevel`, `field`, and `fieldCount`.
- `bossDamage`: direct damage dealt to the stage's declared boss. On a timed boss stage that cannot be defeated in one attempt, this is the primary score metric.
- `stats`: deployments, mouse kills, cat losses, and rage triggers.
- `telemetry`: damage, kills, healing, deployment counts, deaths, maximum simultaneous copies, and first deployment/death times by cat id.
- `deaths`: individual cat loss timestamps and positions.
- `events`: only with `--events`; useful for precise hit/heal/freeze/rage timing.
- `actionLog`: only with `--trace`; every deploy, wallet, and cannon action with its battle-clock time.

Batch output adds duration and boss-damage mean, minimum, P10, median, P90, maximum, plus result counts and round counts. Compare uses one shared seed range for every candidate.

## Validation limits

- The snapshot captures current numeric data, not entitlement, expiry, feeding progress, inventory, or the saved team.
- Battle items are modeled as battle effects only; their can cost and inventory are not enforced.
- The simulator does not enforce UI key, network, or human reaction constraints. Automatic replacement is therefore optimistic.
- A seed controls the client RNG sequence. It reproduces this simulator's rolls, not an unobserved server roll.
