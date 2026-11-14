import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { aggregate, simulate } from "../src/runner.mjs";

const snapshot = JSON.parse(await readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"));
const stage = { id: 1, name: "Reporting fixture", base_hp: 1_000_000, scale: 1, time_limit: 30, waves: [] };
const scenario = {
  stage,
  team: [{ id: "c3", level: 10 }],
  items: [],
  policy: { automatic: false, actions: [{ at: 0, type: "deploy", id: "c3" }] },
};

test("fortress HP loss is distinct from boss damage and excludes shielded hits", () => {
  const run = simulate({ snapshot, ...scenario });
  assert.ok(run.fortressDamage > 0);
  assert.equal(run.enemyBaseMaxHp, stage.base_hp);
  assert.equal(run.fortressDamage, stage.base_hp - run.enemyBaseHp);
  assert.equal(run.bossDamage, 0);
  const shielded = simulate({ snapshot, ...scenario, stage: { ...stage, shield_seconds: 31 } });
  assert.equal(shielded.enemyBaseHp, stage.base_hp);
  assert.equal(shielded.fortressDamage, 0);
});

test("fortress damage excludes guard-blocked hits and overkill", () => {
  const guarded = simulate({
    snapshot, ...scenario, stage: { ...stage, base_hp: 100, guard: "m1" }, recordEvents: true,
  });
  assert.equal(guarded.enemyBaseHp, 15);
  assert.equal(guarded.fortressDamage, 85);
  const attempted = guarded.events.filter((event) => event.type === "base-hit" && event.side === "mouse")
    .reduce((sum, event) => sum + event.amount, 0);
  assert.ok(attempted > guarded.fortressDamage);
  const defeated = simulate({ snapshot, ...scenario, stage: { ...stage, base_hp: 10 } });
  assert.equal(defeated.result, "won");
  assert.equal(defeated.enemyBaseHp, 0);
  assert.equal(defeated.fortressDamage, 10);
});

test("aggregate separates all-run damage from full-duration damage", () => {
  const stats = aggregate([
    { duration: 30, round: 2, result: "timeup", fortressDamage: 100 },
    { duration: 15, round: 1, result: "lost", fortressDamage: 40 },
    { duration: 10, round: 1, result: "limit", fortressDamage: 10 },
  ]);
  assert.equal(stats.mean, 55 / 3);
  assert.equal(stats.fortressDamage.mean, 50);
  assert.equal(stats.fortressDamage.median, 40);
  assert.equal(stats.fullDurationFortressDamage.runs, 1);
  assert.equal(stats.fullDurationFortressDamage.mean, 100);
  const noFull = aggregate([{ duration: 10, round: 1, result: "limit", fortressDamage: 0 }]);
  assert.equal(noFull.fullDurationFortressDamage, null);
});

test("legacy unknown fortress damage stays unknown and cannot be mixed with known samples", () => {
  const legacy = { duration: 10, round: 1, result: "lost", enemyBaseHp: 123 };
  const stats = aggregate([legacy]);
  assert.equal(Object.hasOwn(stats, "fortressDamage"), false);
  assert.equal(Object.hasOwn(stats, "fullDurationFortressDamage"), false);
  assert.throws(() => aggregate([legacy, { ...legacy, fortressDamage: 0 }]), /known and unknown/);
  for (const damage of [null, -1, NaN, Infinity]) {
    assert.throws(() => aggregate([{ ...legacy, fortressDamage: damage }]), /finite non-negative/);
  }
});

test("CLI run, batch and compare expose fortress damage and full-duration statistics", async () => {
  const exec = promisify(execFile);
  const temporary = await mkdtemp(join(tmpdir(), "ilovecat-reporting-"));
  try {
    const path = join(temporary, "scenario.json"), comparisons = join(temporary, "compare.json");
    await writeFile(path, JSON.stringify(scenario));
    await writeFile(comparisons, JSON.stringify([scenario]));
    const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
    const run = JSON.parse((await exec(process.execPath, [cli, "run", path])).stdout);
    assert.ok(run.fortressDamage > 0);
    const table = (await exec(process.execPath, [cli, "batch", path, "--runs", "2", "--jobs", "1", "--format", "table"])).stdout;
    assert.match(table, /Full duration: 2\/2 \(100\.00%\)/);
    assert.match(table, /Fortress damage Mean\/Min\/P10/);
    assert.match(table, /Fortress damage mean for full-duration runs: \d/);
    const markdown = (await exec(process.execPath, [cli, "compare", comparisons, "--runs", "2", "--jobs", "1", "--format", "markdown"])).stdout;
    assert.match(markdown, /2\/2 \(100\.00%\)/);
    assert.match(markdown, /Fortress \(full duration only\)/);
    const single = (await exec(process.execPath, [cli, "run", path, "--format", "markdown"])).stdout;
    assert.match(single, /Fortress Damage \| Boss Damage/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
