#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { aggregate, selectStage, simulate } from "./runner.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_SNAPSHOT = resolve(PROJECT_ROOT, "data", "snapshot.json");

function usage() {
  return `Usage:
  node src/cli.mjs run <scenario.json> [options]
  node src/cli.mjs batch <scenario.json> [options]
  node src/cli.mjs compare <scenarios.json> [options]
  node src/cli.mjs cats [options]
  node src/cli.mjs waves [options]

Options:
  --snapshot <path>    Battle snapshot (default: data/snapshot.json)
  --stage-id <id>      Override the stage selected by the scenario
  --team-slots <n>     Override team slots (11 includes a borrowed endless cat)
  --seed <n>           Seed for "run" (default: 1)
  --seed-start <n>     First seed for batch/compare (default: 1)
  --runs <n>           Number of seeds for batch/compare (default: 30)
  --jobs <n>           Worker count (default: min(runs, CPUs))
  --events             Include combat event log for "run"
  --trace              Include exact 0.02s action timeline for "run"
  --tier <tier>        Filter the "cats" command by tier
  --format <name>      json, markdown, or table (default: json, or by .md output)
  --output <path>      Also write the result to a file
  --summary-only       Omit individual runs from batch/compare JSON
`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  const booleans = new Set(["events", "trace", "summary-only", "help"]);
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (token === "-h" || token === "--help") {
      options.help = true;
    } else if (token.startsWith("--")) {
      const key = token.slice(2);
      if (booleans.has(key)) options[key] = true;
      else {
        const value = rest[++index];
        if (value == null) throw new Error(`${token} needs a value`);
        options[key] = value;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, options };
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeResult(path, content) {
  if (!path) return;
  await writeFile(resolve(path), content + (content.endsWith("\n") ? "" : "\n"), "utf8");
}

function formatDuration(seconds) {
  const value = Number(seconds);
  const minutes = Math.floor(value / 60);
  const remainder = (value - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${remainder}`;
}

function tableForAggregate(name, aggregateResult) {
  const full = aggregateResult.results.timeup ?? 0;
  return [
    `Scenario: ${name}`,
    `Runs: ${aggregateResult.runs}`,
    `Full duration: ${full}/${aggregateResult.runs} (${(100 * full / aggregateResult.runs).toFixed(2)}%)`,
    `Mean: ${aggregateResult.mean.toFixed(2)}s (${formatDuration(aggregateResult.mean)})`,
    `Min/P10/Median/P90/Max: ${aggregateResult.min.toFixed(2)} / ${aggregateResult.p10.toFixed(2)} / ${aggregateResult.median.toFixed(2)} / ${aggregateResult.p90.toFixed(2)} / ${aggregateResult.max.toFixed(2)}s`,
    aggregateResult.fortressDamage
      ? `Fortress damage Mean/Min/P10/Median/P90/Max: ${aggregateResult.fortressDamage.mean.toFixed(2)} / ${aggregateResult.fortressDamage.min} / ${aggregateResult.fortressDamage.p10.toFixed(2)} / ${aggregateResult.fortressDamage.median.toFixed(2)} / ${aggregateResult.fortressDamage.p90.toFixed(2)} / ${aggregateResult.fortressDamage.max}`
      : "Fortress damage: unavailable",
    `Fortress damage mean for full-duration runs: ${aggregateResult.fullDurationFortressDamage?.mean.toFixed(2) ?? "unavailable"}`,
    `Boss damage Mean/Min/P10/Median/P90/Max: ${aggregateResult.bossDamage.mean.toFixed(2)} / ${aggregateResult.bossDamage.min} / ${aggregateResult.bossDamage.p10.toFixed(2)} / ${aggregateResult.bossDamage.median.toFixed(2)} / ${aggregateResult.bossDamage.p90.toFixed(2)} / ${aggregateResult.bossDamage.max}`,
    `Results: ${Object.entries(aggregateResult.results).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    `Rounds: ${Object.entries(aggregateResult.rounds).map(([key, value]) => `R${key}=${value}`).join(", ")}`,
  ].join("\n");
}

function markdownForAggregate(name, result) {
  const full = result.results.timeup ?? 0;
  const damageRow = (label, stats) => stats
    ? `| ${label} | ${stats.mean.toFixed(2)} | ${stats.min} | ${stats.p10.toFixed(2)} | ${stats.median.toFixed(2)} | ${stats.p90.toFixed(2)} | ${stats.max} |`
    : `| ${label} | unavailable | — | — | — | — | — |`;
  return [
    `### ${name}`,
    "",
    "| Runs | Full duration | Mean | Min | P10 | Median | P90 | Max |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| ${result.runs} | ${full}/${result.runs} (${(100 * full / result.runs).toFixed(2)}%) | ${result.mean.toFixed(2)}s | ${result.min.toFixed(2)}s | ${result.p10.toFixed(2)}s | ${result.median.toFixed(2)}s | ${result.p90.toFixed(2)}s | ${result.max.toFixed(2)}s |`,
    "",
    "| Damage | Mean | Min | P10 | Median | P90 | Max |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    damageRow("Fortress", result.fortressDamage),
    damageRow("Fortress (full duration only)", result.fullDurationFortressDamage),
    damageRow("Boss", result.bossDamage),
    "",
    `Results: ${Object.entries(result.results).map(([key, value]) => `${key}=${value}`).join(", ")}. Rounds: ${Object.entries(result.rounds).map(([key, value]) => `R${key}=${value}`).join(", ")}.`,
  ].join("\n");
}

function chunkSeeds(seeds, workers) {
  const chunks = Array.from({ length: workers }, () => []);
  seeds.forEach((seed, index) => chunks[index % workers].push(seed));
  return chunks.filter((chunk) => chunk.length);
}

function runWorkerChunk(snapshot, scenario, seeds, stageId, stage, items, teamSlots, maxTime) {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { snapshot, scenario, seeds, stageId, stage, items, teamSlots, maxTime },
    });
    worker.once("message", (message) => {
      worker.terminate();
      if (message.error) reject(new Error(message.error));
      else resolvePromise(message.runs);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`simulation worker exited with ${code}`));
    });
  });
}

async function runBatch(snapshot, scenario, { seeds, jobs, stageId, stage, items, teamSlots, maxTime }) {
  const workers = Math.max(1, Math.min(Number(jobs || cpus().length), seeds.length));
  const chunks = chunkSeeds(seeds, workers);
  const grouped = await Promise.all(
    chunks.map((chunk) => runWorkerChunk(snapshot, scenario, chunk, stageId, stage, items, teamSlots, maxTime)),
  );
  const runs = grouped.flat().sort((a, b) => a.seed - b.seed);
  return { aggregate: aggregate(runs), runs };
}

function seedRange(start, count) {
  return Array.from({ length: count }, (_, index) => start + index);
}

function commonScenarioContext(scenario, options) {
  return {
    stageId: options["stage-id"] ?? scenario.stageId ?? null,
    stage: scenario.stage ?? null,
    items: scenario.items ?? [],
    teamSlots: options["team-slots"] ?? scenario.teamSlots ?? null,
    maxTime: scenario.maxTime ?? null,
  };
}

async function commandRun(snapshot, scenario, options) {
  const context = commonScenarioContext(scenario, options);
  const result = simulate({
    snapshot,
    team: scenario.team,
    policy: scenario.policy ?? {},
    seed: Number(options.seed ?? scenario.seed ?? 1),
    recordEvents: Boolean(options.events),
    recordActions: Boolean(options.trace),
    ...context,
  });
  const payload = { name: scenario.name ?? "scenario", ...result };
  const format = options.format ?? (options.output?.endsWith(".md") ? "markdown" : "json");
  if (format === "json") return JSON.stringify(payload, null, 2);
  if (format === "markdown") {
    return [
      `### ${payload.name}`,
      "",
      "| Seed | Result | Time | Round | Tower HP | Fortress Damage | Boss Damage | Field | Deployed | Kills | Wallet |",
      "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      `| ${payload.seed} | ${payload.result} | ${payload.duration.toFixed(2)}s | ${payload.round} | ${payload.towerHp}/${payload.towerMaxHp} | ${payload.fortressDamage} | ${payload.bossDamage} | ${payload.fieldCount} | ${payload.stats.deployed} | ${payload.stats.beaten} | ${payload.walletLevel} |`,
      "",
      `Full duration: ${payload.result === "timeup" ? "1/1 (100.00%)" : "0/1 (0.00%)"}.`,
    ].join("\n");
  }
  return tableForAggregate(payload.name, aggregate([payload]));
}

async function commandBatch(snapshot, scenario, options) {
  const context = commonScenarioContext(scenario, options);
  const runs = Number(options.runs ?? scenario.runs ?? 30);
  const seeds = seedRange(Number(options["seed-start"] ?? scenario.seedStart ?? 1), runs);
  const result = await runBatch(snapshot, scenario, {
    seeds,
    jobs: options.jobs,
    ...context,
  });
  const name = scenario.name ?? "scenario";
  const payload = {
    name,
    seeds: { start: seeds[0], count: seeds.length },
    aggregate: result.aggregate,
    ...(options["summary-only"] ? {} : { runs: result.runs }),
  };
  const format = options.format ?? (options.output?.endsWith(".md") ? "markdown" : "json");
  if (format === "json") return JSON.stringify(payload, null, 2);
  if (format === "markdown") return markdownForAggregate(name, result.aggregate);
  return tableForAggregate(name, result.aggregate);
}

async function commandCompare(snapshot, scenarios, options) {
  if (!Array.isArray(scenarios)) throw new Error("compare requires a JSON array of scenarios");
  const runs = Number(options.runs ?? 30);
  const seedStart = Number(options["seed-start"] ?? 1);
  const seeds = seedRange(seedStart, runs);
  const results = [];
  for (const scenario of scenarios) {
    const context = commonScenarioContext(scenario, options);
    const result = await runBatch(snapshot, scenario, {
      seeds,
      jobs: options.jobs,
      ...context,
    });
    results.push({ name: scenario.name ?? "scenario", aggregate: result.aggregate });
  }
  const format = options.format ?? (options.output?.endsWith(".md") ? "markdown" : "json");
  if (format === "json") return JSON.stringify({ seeds, results }, null, 2);
  if (format === "markdown") return results.map((item) => markdownForAggregate(item.name, item.aggregate)).join("\n\n");
  return results.map((item) => tableForAggregate(item.name, item.aggregate)).join("\n\n");
}

function commandCats(snapshot, options) {
  const tier = options.tier?.toUpperCase();
  const cats = snapshot.catalog.cats
    .filter((cat) => !tier || cat.tier === tier)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      tier: cat.tier,
      attack: cat.atk,
      hp: cat.hp,
      range: cat.range,
      interval: cat.interval,
      cost: cat.cost,
      cooldown: cat.cooldown,
      ability: cat.ability,
      value: cat.ability_value,
    }));
  return JSON.stringify(cats, null, 2);
}

function commandWaves(snapshot, options) {
  const stage = selectStage(snapshot, options["stage-id"] ?? snapshot.stage?.id);
  const mice = new Map(snapshot.catalog.mice.map((mouse) => [mouse.id, mouse]));
  const rows = [];
  for (const wave of stage.waves) {
    const mouse = mice.get(wave.mouse);
    if (!mouse || wave.trigger) continue;
    const scale = (stage.scale ?? 1) * (wave.scale > 0 ? wave.scale : 1);
    rows.push({
      at: wave.at,
      round: Math.min(30, Math.floor(wave.at / 30) + 1),
      mouse: mouse.id,
      name: mouse.name,
      count: wave.count,
      scale,
      hpEach: Math.round(mouse.hp * scale),
      attackEach: Math.round(mouse.atk * scale),
      armor: mouse.armor,
      dodge: mouse.dodge,
      traits: wave.traits ?? [],
    });
  }
  return JSON.stringify({ stageId: stage.id, modifier: stage.modifier, waves: rows }, null, 2);
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));
  if (!command || options.help) {
    process.stdout.write(usage());
    return command ? 0 : 1;
  }
  const snapshot = await loadJson(resolve(options.snapshot ?? DEFAULT_SNAPSHOT));

  if (command === "cats") {
    const output = commandCats(snapshot, options);
    await writeResult(options.output, output);
    process.stdout.write(output + "\n");
    return 0;
  }
  if (command === "waves") {
    const output = commandWaves(snapshot, options);
    await writeResult(options.output, output);
    process.stdout.write(output + "\n");
    return 0;
  }

  if (!positional[0]) throw new Error(`${command} requires a JSON file`);
  const input = await loadJson(resolve(positional[0]));
  let output;
  if (command === "run") output = await commandRun(snapshot, input, options);
  else if (command === "batch") output = await commandBatch(snapshot, input, options);
  else if (command === "compare") output = await commandCompare(snapshot, input, options);
  else throw new Error(`unknown command: ${command}`);
  await writeResult(options.output, output);
  process.stdout.write(output + "\n");
  return 0;
}

main().catch((error) => {
  process.stderr.write(`simulate: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
