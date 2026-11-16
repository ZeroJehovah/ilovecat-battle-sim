# Scenario schema and CLI

## Files

- `data/snapshot.json`: captured catalog, current endless stage, and non-sensitive capture metadata. The 2026-11-16 export updates the catalog and heatwave endless season; its 40 fixed campaign stages retain their 2026-11-13 capture. `captureCoverage` records these separate dates.
- `examples/endless-current.json`: one scenario object.
- `examples/endless-compare.json`: an array of scenario objects for `compare`.

## Scenario fields

```json
{
  "name": "candidate-name",
  "stageId": 9101,
  "stage": null,
  "teamSlots": null,
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
    "autoCannon": true,
    "autoCannonAfter": 600,
    "autoCannonMinTargets": 1,
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
- `team`: each entry is a unique cat id plus a level. Repeated copies on the field come from repeatedly deploying one slot.
- `teamSlots`: optional team slot cap. It defaults to the catalog's `team_size` (currently 10). For current endless stage `9101`, set it to `11` to model the borrowed house-cat slot added on 2026-11-12. The extra slot is an explicit offline assumption; the snapshot does not capture lender availability or entitlement, and the simulator rejects an 11-slot campaign team.
- `items`: any of `start_coins`, `fast_coins`, `strong_base`, `cannon_ready`, `rally`, plus upgrade tokens `cannon_lv:N` and `base_lv:N` where `N` is 0–10. `cannon_lv` increases cannon damage by 20 and reduces charge time by 0.5 seconds per level; `base_lv` increases base cat-tower health by 15% of the level-0 value per level.
- `maxTime`: stop the simulation early. The reported `duration` never exceeds this value. Use `null` or omit it for the stage time limit.
- `seed` and `seedStart`: optional defaults for a single run and a batch.
- `runs`: optional default run count when `--runs` is absent.

## Current release rules

The engine always advances in fixed `0.02`-second steps. The 2026-11-13 snapshot and mechanics include:

- dodge before damage for both cats and mice, followed by armor reduction;
- full-moon mice restoring 1% of maximum HP per second;
- cat-tower level `N` multiplying base HP by `1 + 0.15 × N`;
- paw cannon level `N` dealing `150 + 20 × N` damage and charging in `30 - 0.5 × N` seconds;
- Desert Traveler burn ticks, Gear Artificer turrets, and the released chapter 3–4 traits, summons and stage twists described in `../docs/战斗机制与实现依据.md`;
- the optional 11th endless slot through `teamSlots: 11`.

## Automatic policy

The action loop runs before each 0.02-second battle step and performs at most one world action per step.

- `actionGap`: minimum simulated seconds between successful world actions (default `0`). Use `0.25` to match the browser executor's 250 ms real-time action throttle. With the 0.02-second step the effective interval becomes the next step at or after the gap (0.26 seconds for `0.25`).
- `observationDelay`: seconds by which the controller's view of the battle lags the live engine (default `0`). Use `0.1` to model the browser executor's roughly 10 Hz React snapshot: money, wallet level/cost, cannon charge, cannon targets, slot cooldowns, field counts, and result are read from the state captured that long ago. Actions still apply to the live engine. This is an observation limit, not a battle-step limit; the engine itself remains fixed at 0.02 seconds.
- `openers`: cat ids deployed once before the economy phase. Deployment can fail if money or cooldown is insufficient and is retried later.
- `deploySequence`: optional ordered cat-id list deployed after the wallet target is reached. Repeated ids are allowed. The next entry is strict: if it is unaffordable, cooling down, or unavailable, the policy waits for that exact cat and does not fall through to `priority` or `fallbackPriority` until the sequence is complete.
- `autoCannon`: enables automatic cannon decisions. A charged cannon may still fire while the policy is waiting for the next fixed unit; it does not spend money or advance the sequence.
- `autoCannonAfter`: earliest battle time in seconds for an automatic cannon shot (default `0`). This can keep a cannon charged through low-value early waves and fire it only in the late game.
- `autoCannonMinTargets`: minimum number of living mice to the right of the cannon line (`x > 455`) before firing (default `0`). The browser executor also accepts `autoCannonFallbackAfter`; if it cannot read live unit positions, it uses that time as a safe late fallback instead of leaving the cannon disabled.
- `walletTarget`: wallet level from 1 to 8. While below it, the policy first satisfies unfilled openers, then buys the next wallet level when affordable.
- `economyFirst`: when true, the policy waits for the wallet target before spending on the normal lineup. This does not stop scheduled actions.
- `targetCounts`: desired number of living copies per cat id. Zero or absent means no permanent target.
- `priority`: order used to deploy cats that are below their target count. A cat whose slot is on cooldown does not block the next priority.
- `fallbackAfter`: battle time in seconds after which unused field slots can be filled by replacement units.
- `fallbackPriority`: order used for replacement units. They are deployed only when no target cat can currently be deployed or when targets are already full.
- `automatic`: set false to use only `actions`.
- `deployIntervals`: optional map from cat id to a non-negative minimum number of seconds between successful deployments. For example `{ "s1": 40.22, "a5": 20.12 }` can deliberately stagger a formation. It only delays deployments; native game cooldowns, money and the field cap still apply. Intervals use the observed clock and all cat ids must belong to `team`. Scheduled deployments follow this gate too.

Deployment checks with an observation delay use the observed money, field cap and cooldown before asking the live engine to deploy. The live engine also checks that the action is still possible. A cooldown that has just expired, or income that has just arrived, is unavailable until it appears in the delayed view. Scheduled actions follow the same observation checks. This fixes the earlier automatic deployment path that could act on live money and cooldown ahead of the configured view.

## Policy phases

`policy.phases` is an optional array of time-based overrides. Each `at` is a finite, non-negative battle-clock time, strictly increasing. A phase applies as soon as its time appears in the controller's observed view, independently of the action throttle. Skipping across several phases applies all of them in order. Every battle starts from the original policy and phase index zero.

```json
{
  "phases": [
    { "at": 43, "walletTarget": 5 },
    {
      "at": 735,
      "targetCounts": { "s1": 16, "s2": 2 },
      "priority": ["s1", "s2"],
      "fallbackAfter": 735,
      "fallbackPriority": ["c2", "c3", "c6"]
    }
  ]
}
```

Allowed overrides are `walletTarget`, `economyFirst`, `automatic`, `targetCounts`, `priority`, `fallbackAfter`, `fallbackPriority`, `autoCannon`, `autoCannonAfter`, `autoCannonMinTargets`, the browser's `autoCannonFallbackAfter`, and `deployIntervals`. Other fields are rejected. Arrays, `targetCounts`, and `deployIntervals` replace the previous values completely; omitted fields retain their previous values. A cat omitted from a new target map has no permanent target, and a cat omitted from a new interval map has no added interval. Existing units remain on the field. Interval changes measure from the previous successful deployment; they do not reset its timestamp. The opening sequence, scheduled action cursor, action gap and observation delay continue unchanged. Every cat referenced in any future phase must belong to `team`, and browser preparation and live validation cover all future references.

Executable phase or interval strategies use `format: "ilovecat-battle-strategy", version: 2` and require userscript `0.9.0-SNAPSHOT` or later. The new executor also accepts version 1 without either feature. Older executors reject version 2, preventing a strategy from silently running without its timing controls. Offline scenario files do not require an executable format/version field. Neither feature changes combat attributes, game cooldowns or the fixed 0.02-second battle step.

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
node src/cli.mjs run scenario.json --seed 7 --team-slots 11
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
- `teamSlots`, `towerHp`, `towerMaxHp`, `enemyBaseHp`, `enemyBaseMaxHp`, `money`, `walletLevel`, `field`, and `fieldCount`.
- `fortressDamage`: net enemy fortress HP loss, `max(0, enemyBaseMaxHp - enemyBaseHp)`, using the reported rounded remaining HP. Shields and undefeated guards can block effective loss; attempted hit amounts and overkill are not counted as additional fortress damage.
- `bossDamage`: direct damage dealt to the stage's declared boss. On a timed boss stage that cannot be defeated in one attempt, this is the primary score metric.
- `stats`: deployments, mouse kills, cat losses, and rage triggers.
- `telemetry`: damage, kills, healing, deployment counts, deaths, maximum simultaneous copies, and first deployment/death times by cat id.
- `deaths`: individual cat loss timestamps and positions.
- `events`: only with `--events`; useful for precise hit/heal/freeze/rage timing.
- `actionLog`: only with `--trace`; every deploy, wallet, and cannon action with its battle-clock time.

Batch output adds duration, fortress-damage and boss-damage mean, minimum, P10, median, P90, maximum, plus result counts and round counts. `fullDurationFortressDamage` contains the same damage statistics and `runs` for the subset with `result: "timeup"`; it is `null` when no run reaches the time limit. Table and Markdown output show the full-duration fraction explicitly. A shorter `maxTime` result (`limit`) is not a full-duration success. Compare uses one shared seed range for every candidate.

Endless comparisons report both survival (full-duration fraction and duration distribution) and fortress damage, with survival taking priority. Report the all-run mean first; the full-duration-only mean is conditional and must not replace it. Boss-unit damage is a separate metric and is not enemy fortress damage. No combined scoring formula is assumed.

When aggregating legacy samples without `fortressDamage`, the two fortress-statistic fields are omitted rather than filled with zero. Mixing known and unknown fortress damage is rejected. Legacy fortress loss can be reconstructed only when the original stage's starting HP is known.

## Validation limits

- The snapshot captures current numeric data, not entitlement, expiry, feeding progress, inventory, or the saved team.
- A `teamSlots: 11` run models a borrowed house cat only when the caller explicitly declares it. This does not prove that a lender or offer exists in the live game.
- Battle items are modeled as battle effects only; their can cost and inventory are not enforced.
- Current regression coverage targets the 40 public campaign stages and stage 9101. Chapter 10 and catalog-only later mice are not yet validated against released stages.
- The simulator does not enforce UI key, network, or human reaction constraints. Automatic replacement is therefore optimistic.
- A seed controls the client RNG sequence. It reproduces this simulator's rolls, not an unobserved server roll.
