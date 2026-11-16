import { BattleEngine, STEP, MAX_FIELD_CATS } from "./engine.mjs";

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

export function normalizeDeployIntervals(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("policy.deployIntervals must be an object");
  for (const [id, seconds] of Object.entries(value)) {
    if (!id || !Number.isFinite(seconds) || seconds < 0) throw new Error(`policy.deployIntervals.${id} must be non-negative`);
  }
  return { ...value };
}

export function normalizePolicyPhases(phases = []) {
  if (!Array.isArray(phases)) throw new Error("policy.phases must be an array");
  const allowed = new Set(["at", "walletTarget", "economyFirst", "automatic", "targetCounts", "priority",
    "fallbackAfter", "fallbackPriority", "autoCannon", "autoCannonAfter", "autoCannonMinTargets", "autoCannonFallbackAfter", "deployIntervals"]);
  let previous = -1;
  return phases.map((phase, index) => {
    const label = `policy.phases[${index}]`;
    if (!phase || typeof phase !== "object" || Array.isArray(phase)) throw new Error(`${label} must be an object`);
    for (const key of Object.keys(phase)) if (!allowed.has(key)) throw new Error(`${label}.${key} is unsupported`);
    if (!Number.isFinite(phase.at) || phase.at < 0 || phase.at <= previous) {
      throw new Error(`${label}.at must be non-negative and strictly increasing`);
    }
    previous = phase.at;
    const normalized = { ...phase };
    if ("deployIntervals" in phase) normalized.deployIntervals = normalizeDeployIntervals(phase.deployIntervals);
    for (const key of ["economyFirst", "automatic", "autoCannon"]) {
      if (key in phase && typeof phase[key] !== "boolean") throw new Error(`${label}.${key} must be a boolean`);
    }
    if ("walletTarget" in phase && (!Number.isInteger(phase.walletTarget) || phase.walletTarget < 1 || phase.walletTarget > 8)) {
      throw new Error(`${label}.walletTarget must be an integer from 1 to 8`);
    }
    for (const key of ["fallbackAfter", "autoCannonAfter", "autoCannonFallbackAfter"]) {
      if (key in phase && (!Number.isFinite(phase[key]) || phase[key] < 0)) throw new Error(`${label}.${key} must be non-negative`);
    }
    if ("autoCannonMinTargets" in phase && (!Number.isInteger(phase.autoCannonMinTargets) || phase.autoCannonMinTargets < 0)) {
      throw new Error(`${label}.autoCannonMinTargets must be a non-negative integer`);
    }
    for (const key of ["priority", "fallbackPriority"]) {
      if (!(key in phase)) continue;
      if (!Array.isArray(phase[key]) || phase[key].some((id) => typeof id !== "string" || !id)) {
        throw new Error(`${label}.${key} must be an array of cat ids`);
      }
      normalized[key] = [...new Set(phase[key])];
    }
    if ("targetCounts" in phase) {
      if (!phase.targetCounts || typeof phase.targetCounts !== "object" || Array.isArray(phase.targetCounts)) {
        throw new Error(`${label}.targetCounts must be an object`);
      }
      for (const [id, count] of Object.entries(phase.targetCounts)) {
        if (!id || !Number.isInteger(count) || count < 0) throw new Error(`${label}.targetCounts.${id} must be a non-negative integer`);
      }
      normalized.targetCounts = { ...phase.targetCounts };
    }
    return normalized;
  });
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
    this.autoCannonAfter = Number(options.autoCannonAfter ?? 0);
    this.autoCannonMinTargets = Number(options.autoCannonMinTargets ?? 0);
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
    if (!Number.isFinite(this.autoCannonAfter) || this.autoCannonAfter < 0) {
      throw new Error("autoCannonAfter must be a non-negative number of seconds");
    }
    if (!Number.isInteger(this.autoCannonMinTargets) || this.autoCannonMinTargets < 0) {
      throw new Error("autoCannonMinTargets must be a non-negative integer");
    }
    this.nextActAt = 0;
    this.phases = normalizePolicyPhases(options.phases);
    this.phaseIndex = 0;
    this.deployIntervals = normalizeDeployIntervals(options.deployIntervals);
    this.lastDeployAt = {};

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
      ...Object.keys(this.deployIntervals),
      ...this.phases.flatMap((phase) => [...Object.keys(phase.targetCounts ?? {}), ...Object.keys(phase.deployIntervals ?? {}),
        ...(phase.priority ?? []), ...(phase.fallbackPriority ?? [])]),
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
    const last = this.lastDeployAt[id], interval = this.deployIntervals[id] ?? 0;
    if (last != null && engine.time + 1e-9 < last + interval) return false;
    const slot = this.slotFor(engine, id);
    if (slot < 0 || !engine.deploy(slot)) return false;
    this.lastDeployAt[id] = engine.time;
    return true;
  }

  shouldFireCannon(engine) {
    return this.autoCannon &&
      engine.time >= this.autoCannonAfter &&
      engine.cannonCharge >= engine.cannonTime &&
      engine.cannonTargetCount >= this.autoCannonMinTargets;
  }

  applyPhases(engine) {
    while (this.phaseIndex < this.phases.length && this.phases[this.phaseIndex].at <= engine.time + 1e-9) {
      const { at, ...override } = this.phases[this.phaseIndex++];
      Object.assign(this, override);
    }
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
    this.applyPhases(engine);
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
        if (this.shouldFireCannon(engine)) return engine.fireCannon();
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
        if (this.shouldFireCannon(engine)) return engine.fireCannon();
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

    if (this.shouldFireCannon(engine)) return engine.fireCannon();
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
    cannonTime: engine.cannonTime,
    cannonTargetCount: engine.cannonTargetCount,
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
  get cannonTime() { return this.state.cannonTime; }
  get cannonTargetCount() { return this.state.cannonTargetCount; }
  get catCount() { return this.state.catCount; }
  get slotCooldowns() { return this.state.cooldowns; }
  get result() { return this.state.result; }

  catsOnField() {
    return { ...this.state.onField };
  }

  deploy(slot) {
    const cat = this.engine.catById.get(this.team[slot]?.id);
    if (!cat || this.result !== "playing" || this.catCount >= MAX_FIELD_CATS
      || this.slotCooldowns[slot] > 0 || this.money < cat.cost) return false;
    return this.engine.deploy(slot);
  }
  upgradeWallet() {
    if (this.result !== "playing" || this.walletLevel >= 8 || this.money < this.walletCost) return false;
    return this.engine.upgradeWallet();
  }
  fireCannon() {
    if (this.result !== "playing" || this.cannonCharge < this.cannonTime) return false;
    return this.engine.fireCannon();
  }
}

export function simulate({
  snapshot,
  team,
  stageId = null,
  stage = null,
  seed = 1,
  items = [],
  teamSlots = null,
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
    teamSlots,
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
    controller.applyPhases(view);
    if (engine.time + 1e-9 >= controller.nextActAt) {
      if (controller.act(view)) controller.nextActAt = engine.time + controller.actionGap;
    }
    engine.step();
  }

  const duration = Math.min(engine.time, hardStop);
  const enemyBaseHp = Math.max(0, Math.round(engine.mouseBaseHp));
  return {
    seed: Number(seed),
    stage: {
      id: selectedStage.id,
      name: selectedStage.name,
      modifier: selectedStage.modifier,
      timeLimit: selectedStage.time_limit,
    },
    result: engine.result === "playing" ? "limit" : engine.result,
    teamSlots: engine.teamSlots,
    duration,
    round: Math.min(30, Math.floor(duration / 30) + 1),
    towerHp: Math.max(0, Math.round(engine.catBaseHp)),
    towerMaxHp: engine.catBaseMax,
    enemyBaseHp,
    enemyBaseMaxHp: engine.mouseBaseMax,
    fortressDamage: Math.max(0, engine.mouseBaseMax - enemyBaseHp),
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

function damageDistribution(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
  };
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
  const knownFortressDamage = runs.filter((run) => run.fortressDamage !== undefined);
  if (knownFortressDamage.length && knownFortressDamage.length !== runs.length) {
    throw new Error("cannot aggregate mixed known and unknown fortress damage");
  }
  if (knownFortressDamage.some((run) => !Number.isFinite(run.fortressDamage) || run.fortressDamage < 0)) {
    throw new Error("fortressDamage must be a finite non-negative number");
  }
  const fullDurationRuns = runs.filter((run) => run.result === "timeup");
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
    ...(knownFortressDamage.length ? {
      fortressDamage: damageDistribution(runs.map((run) => run.fortressDamage)),
      fullDurationFortressDamage: fullDurationRuns.length ? {
        runs: fullDurationRuns.length,
        ...damageDistribution(fullDurationRuns.map((run) => run.fortressDamage)),
      } : null,
    } : {}),
    results,
    rounds,
  };
}
