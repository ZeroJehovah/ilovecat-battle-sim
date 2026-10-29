import { BattleEngine, STEP } from "./engine.mjs";

function unique(values) {
  return [...new Set(values)];
}

function normalizeTeam(catalog, team) {
  if (!Array.isArray(team) || team.length === 0) throw new Error("team must be an array");
  const levelCap = catalog.rules?.max_level ?? 100;
  const normalized = team.map((entry, index) => {
    const id = typeof entry === "string" ? entry : entry?.id;
    const level = Number(typeof entry === "string" ? 1 : (entry?.level ?? 1));
    if (!id) throw new Error(`team[${index}] has no cat id`);
    if (!Number.isInteger(level) || level < 1 || level > levelCap) {
      throw new Error(`team[${index}] level must be an integer from 1 to ${levelCap}`);
    }
    return { id, level };
  });
  const duplicateIds = normalized
    .map((entry) => entry.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`team contains duplicate cat slots: ${[...new Set(duplicateIds)].join(", ")}`);
  }
  return normalized;
}

export function selectStage(snapshot, stageId = null) {
  const id = stageId == null ? snapshot.stage?.id : Number(stageId);
  if (snapshot.stage && Number(snapshot.stage.id) === id) return snapshot.stage;
  const found = snapshot.catalog?.stages?.find((stage) => Number(stage.id) === id);
  if (!found) throw new Error(`stage ${id} is not present in the snapshot`);
  return found;
}

export class AutoPolicy {
  constructor(team, options = {}) {
    this.team = team;
    this.targetCounts = options.targetCounts ?? Object.fromEntries(team.map((entry) => [entry.id, 1]));
    this.priority = options.priority ?? team.map((entry) => entry.id);
    this.openers = options.openers ?? [];
    this.opened = new Set();
    this.deploySequence = options.deploySequence ?? [];
    this.sequenceIndex = 0;
    this.walletTarget = Math.min(8, Math.max(1, Number(options.walletTarget ?? 8)));
    this.economyFirst = options.economyFirst !== false;
    this.fallbackAfter = Number(options.fallbackAfter ?? Number.POSITIVE_INFINITY);
    this.fallbackPriority = options.fallbackPriority ?? [];
    this.autoCannon = Boolean(options.autoCannon);
    this.automatic = options.automatic !== false;
    this.actions = [...(options.actions ?? [])].sort((a, b) => Number(a.at) - Number(b.at));
    this.nextAction = 0;
    this.actionGap = Number(options.actionGap ?? 0);
    if (!Number.isFinite(this.actionGap) || this.actionGap < 0) {
      throw new Error("actionGap must be a non-negative number of seconds");
    }
    this.observationDelay = Number(options.observationDelay ?? 0);
    if (!Number.isFinite(this.observationDelay) || this.observationDelay < 0) {
      throw new Error("observationDelay must be a non-negative number of seconds");
    }
    this.nextActAt = 0;

    if (!Array.isArray(this.deploySequence) || this.deploySequence.some((id) => typeof id !== "string")) {
      throw new Error("deploySequence must be an array of cat ids");
    }

    const teamIds = new Set(team.map((entry) => entry.id));
    const referenced = [
      ...Object.keys(this.targetCounts),
      ...this.priority,
      ...this.openers,
      ...this.deploySequence,
      ...this.fallbackPriority,
      ...this.actions.map((action) => action.id).filter(Boolean),
    ];
    const missing = unique(referenced.filter((id) => !teamIds.has(id)));
    if (missing.length) throw new Error(`policy references cats outside the team: ${missing.join(", ")}`);
    for (const [id, count] of Object.entries(this.targetCounts)) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`targetCounts.${id} must be a non-negative integer`);
      }
    }
  }

  slotFor(engine, id) {
    return engine.team.findIndex((entry) => entry.id === id);
  }

  deployId(engine, id) {
    const slot = this.slotFor(engine, id);
    return slot >= 0 && engine.deploy(slot);
  }

  applyScheduled(engine) {
    while (this.nextAction < this.actions.length && Number(this.actions[this.nextAction].at) <= engine.time + 1e-9) {
      const action = this.actions[this.nextAction++];
      if (action.type === "deploy") {
        this.deployId(engine, action.id);
      } else if (action.type === "wallet") {
        engine.upgradeWallet();
      } else if (action.type === "cannon") {
        engine.fireCannon();
      } else if (action.type === "wait") {
        continue;
      } else {
        throw new Error(`unknown scheduled action type: ${action.type}`);
      }
      return true;
    }
    return false;
  }

  act(engine) {
    if (engine.result !== "playing") return false;
    if (this.applyScheduled(engine)) return true;
    if (!this.automatic) return false;

    if (engine.walletLevel < this.walletTarget) {
      for (const id of this.openers) {
        if (this.opened.has(id)) continue;
        if (this.deployId(engine, id)) {
          this.opened.add(id);
          return true;
        }
      }
      if (engine.money >= engine.walletCost && engine.upgradeWallet()) return true;
      if (this.economyFirst) {
        if (this.autoCannon && engine.cannonCharge >= 30) return engine.fireCannon();
        return false;
      }
    }

    const counts = engine.catsOnField();
    if (engine.walletLevel >= this.walletTarget || !this.economyFirst) {
      if (this.sequenceIndex < this.deploySequence.length) {
        const id = this.deploySequence[this.sequenceIndex];
        if (this.deployId(engine, id)) {
          this.sequenceIndex++;
          return true;
        }
        if (this.autoCannon && engine.cannonCharge >= 30) return engine.fireCannon();
        return false;
      }
    }
    for (const id of this.priority) {
      const target = this.targetCounts[id] ?? 0;
      if ((counts[id] ?? 0) < target) {
        if (this.deployId(engine, id)) return true;
      }
    }

    if (engine.time >= this.fallbackAfter) {
      for (const id of this.fallbackPriority) {
        if (this.deployId(engine, id)) return true;
      }
    }

    if (this.autoCannon && engine.cannonCharge >= 30) return engine.fireCannon();
    return false;
  }
}

function captureObservation(engine) {
  return {
    time: engine.time,
    money: Math.floor(engine.money),
    walletLevel: engine.walletLevel,
    walletCost: engine.walletCost,
    cannonCharge: engine.cannonCharge,
    catCount: engine.catCount,
    cooldowns: engine.slotCooldowns.slice(),
    onField: engine.catsOnField(),
    result: engine.result,
  };
}

class ObservedEngine {
  constructor(engine, state) {
    this.engine = engine;
    this.state = state;
    this.team = engine.team;
  }

  get time() { return this.state.time; }
  get money() { return this.state.money; }
  get walletLevel() { return this.state.walletLevel; }
  get walletCost() { return this.state.walletCost; }
  get cannonCharge() { return this.state.cannonCharge; }
  get catCount() { return this.state.catCount; }
  get slotCooldowns() { return this.state.cooldowns; }
  get result() { return this.state.result; }

  catsOnField() {
    return { ...this.state.onField };
  }

  deploy(slot) { return this.engine.deploy(slot); }
  upgradeWallet() { return this.engine.upgradeWallet(); }
  fireCannon() { return this.engine.fireCannon(); }
}

export function simulate({
  snapshot,
  team,
  stageId = null,
  stage = null,
  seed = 1,
  items = [],
  policy = {},
  maxTime = null,
  recordEvents = false,
  recordActions = false,
}) {
  if (!snapshot?.catalog) throw new Error("snapshot.catalog is required");
  const normalizedTeam = normalizeTeam(snapshot.catalog, team);
  const selectedStage = stage ?? selectStage(snapshot, stageId);
  const events = [];
  const engine = new BattleEngine({
    catalog: snapshot.catalog,
    stage: selectedStage,
    team: normalizedTeam,
    seed,
    items,
    onEvent: recordEvents ? (type, payload) => events.push({ type, ...payload }) : null,
  });
  const controller = new AutoPolicy(normalizedTeam, policy);
  const hardStop = maxTime == null ? selectedStage.time_limit ?? 1200 : Number(maxTime);
  const delaySteps = Math.max(0, Math.round(controller.observationDelay / STEP));
  const observations = [];

  while (engine.result === "playing" && engine.time < hardStop) {
    let view = engine;
    if (delaySteps > 0) {
      observations.push(captureObservation(engine));
      while (observations.length > delaySteps + 1) observations.shift();
      view = new ObservedEngine(engine, observations[0]);
    }
    if (engine.time + 1e-9 >= controller.nextActAt) {
      if (controller.act(view)) controller.nextActAt = engine.time + controller.actionGap;
    }
    engine.step();
  }

  const duration = Math.min(engine.time, hardStop);
  return {
    seed: Number(seed),
    stage: {
      id: selectedStage.id,
      name: selectedStage.name,
      modifier: selectedStage.modifier,
      timeLimit: selectedStage.time_limit,
    },
    result: engine.result === "playing" ? "limit" : engine.result,
    duration,
    round: Math.min(30, Math.floor(duration / 30) + 1),
    towerHp: Math.max(0, Math.round(engine.catBaseHp)),
    towerMaxHp: engine.catBaseMax,
    enemyBaseHp: Math.max(0, Math.round(engine.mouseBaseHp)),
    bossDamage: Math.round(engine.bossDamage),
    money: Math.floor(engine.money),
    walletLevel: engine.walletLevel,
    field: engine.catsOnField(),
    fieldCount: engine.catCount,
    stats: { ...engine.stats },
    telemetry: engine.telemetry,
    deaths: engine.deaths,
    actions: engine.actions.length,
    actionLog: recordActions
      ? engine.actions.map(({ tick, ...action }) => ({
          at: Number((tick * STEP).toFixed(2)),
          ...action,
        }))
      : undefined,
    events: recordEvents ? events : undefined,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function aggregate(runs) {
  if (!runs.length) throw new Error("no simulation runs to aggregate");
  const durations = runs.map((run) => run.duration).sort((a, b) => a - b);
  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const results = {};
  const rounds = {};
  for (const run of runs) {
    results[run.result] = (results[run.result] ?? 0) + 1;
    rounds[run.round] = (rounds[run.round] ?? 0) + 1;
  }
  const bossDamages = runs.map((run) => run.bossDamage ?? 0).sort((a, b) => a - b);
  const bossMean = bossDamages.reduce((sum, value) => sum + value, 0) / bossDamages.length;
  return {
    runs: runs.length,
    mean,
    min: durations[0],
    p10: percentile(durations, 0.1),
    median: percentile(durations, 0.5),
    p90: percentile(durations, 0.9),
    max: durations[durations.length - 1],
    bossDamage: {
      mean: bossMean,
      min: bossDamages[0],
      p10: percentile(bossDamages, 0.1),
      median: percentile(bossDamages, 0.5),
      p90: percentile(bossDamages, 0.9),
      max: bossDamages[bossDamages.length - 1],
    },
    results,
    rounds,
  };
}
