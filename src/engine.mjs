export const STEP = 0.02;
export const MAX_FIELD_CATS = 20;
export const WALLET_MAX_LEVEL = 8;
export const MAX_UPGRADE_LEVEL = 10;
export const MAX_TEAM_SLOTS = 11;

const ABILITY_TIMER_START = { gift: 3, heal: 3, heal_cleanse: 3, mark: 8, timewarp: 4 };
const PERIODIC_ABILITIES = new Set([
  "cleanse",
  "gift",
  "heal",
  "heal_cleanse",
  "mark",
  "pendulum",
  "summon",
  "thunder",
  "time_rewind",
  "timewarp",
  "turret",
]);
const INTRINSIC_MOUSE_TRAITS = new Map([
  ["m29", ["anchor"]],
  ["m30", ["warm"]],
  ["m32", ["armorbite"]],
  ["m33", ["armorbite"]],
  ["m35", ["ink"]],
  ["m36", ["deathfreeze"]],
  ["m38", ["leap"]],
  ["m39", ["charge"]],
  ["m40", ["frostproof"]],
  ["m42", ["flying"]],
  ["m44", ["flying", "bomber"]],
  ["m45", ["flying"]],
  ["m46", ["rewind"]],
  ["m49", ["poison"]],
  ["m50", ["split"]],
  ["m51", ["decoy"]],
  ["m53", ["commander"]],
]);
const MULTI_TARGET_ABILITIES = new Set([
  "area",
  "rocket",
  "launch",
  "pierce",
  "freeze",
  "lightning",
  "slow",
  "knockback",
  "ranged",
]);

export function createRng(seed) {
  let state = Number(seed) | 0;
  return () => {
    let value = Math.imul((state = (state + 0x6d2b79f5) | 0) ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function round(value) {
  return Math.round(value);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function emptyCounts() {
  return Object.create(null);
}

function bump(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function itemLevel(items, prefix) {
  for (const item of items) {
    if (!String(item).startsWith(prefix)) continue;
    const level = Number(String(item).slice(prefix.length));
    return Number.isFinite(level)
      ? Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.trunc(level)))
      : 0;
  }
  return 0;
}

/** Exact gameplay loop derived from the current browser battle engine.
 * Rendering, particles and UI state are intentionally omitted.
 */
export class BattleEngine {
  constructor({ catalog, stage, team, seed = 1, items = [], teamSlots = null, onEvent = null }) {
    if (!catalog || !Array.isArray(catalog.cats) || !Array.isArray(catalog.mice)) {
      throw new Error("catalog.cats and catalog.mice are required");
    }
    if (!stage || !Array.isArray(stage.waves)) {
      throw new Error("stage.waves is required");
    }
    if (!Array.isArray(team) || team.length === 0) {
      throw new Error("team must contain at least one cat");
    }
    const catalogTeamSize = catalog.rules?.team_size ?? 10;
    const teamSize = teamSlots == null ? catalogTeamSize : Number(teamSlots);
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > MAX_TEAM_SLOTS) {
      throw new Error(`teamSlots must be an integer from 1 to ${MAX_TEAM_SLOTS}`);
    }
    if (teamSize > catalogTeamSize + 1) {
      throw new Error("teamSlots may exceed the catalog limit by at most one borrowed slot");
    }
    if (teamSize > catalogTeamSize && Number(stage.id) !== 9101) {
      throw new Error("the borrowed extra team slot is only supported for endless stage 9101");
    }
    if (team.length > teamSize) throw new Error(`team has more than ${teamSize} slots`);

    this.catalog = catalog;
    this.stage = stage;
    this.team = team;
    this.teamSlots = teamSize;
    this.random = createRng(seed);
    this.onEvent = onEvent;
    this.items = new Set(items);
    this.catById = new Map(catalog.cats.map((cat) => [cat.id, cat]));
    this.mouseById = new Map(catalog.mice.map((mouse) => [mouse.id, mouse]));

    const invalidIds = team.map((entry) => entry.id).filter((id) => !this.catById.has(id));
    if (invalidIds.length) throw new Error(`unknown cats in team: ${invalidIds.join(", ")}`);

    this.time = 0;
    this.tickCount = 0;
    this.money = (catalog.rules.start_coins ?? 150) + (this.items.has("start_coins") ? 300 : 0);
    this.walletLevel = 1;
    const cannonLevel = itemLevel(items, "cannon_lv:");
    const towerLevel = itemLevel(items, "base_lv:");
    this.cannonTime = 30 - 0.5 * cannonLevel;
    this.cannonDamage = 150 + 20 * cannonLevel;
    this.cannonCharge = this.items.has("cannon_ready") ? this.cannonTime : 0;
    this.cashRate = this.items.has("fast_coins") ? 1.3 : 1;
    this.attackBoost = this.items.has("rally") ? 1.15 : 1;
    this.catBaseMax = round(
      (catalog.rules.cat_base_hp ?? 3000) *
        (this.items.has("strong_base") ? 1.5 : 1) *
        (1 + 0.15 * towerLevel),
    );
    this.catBaseHp = this.catBaseMax;
    this.mouseBaseMax = stage.base_hp;
    this.mouseBaseHp = this.mouseBaseMax;
    this.result = "playing";
    this.bossDamage = 0;
    this.units = [];
    this.spawns = [];
    this.triggers = [];
    this.nextUid = 1;
    this.slotCooldowns = team.map(() => 0);
    this.actions = [];
    this.defeated = new Set();
    this.wasShielded = true;
    this.guardSpawned = false;
    this.warmAuraTimer = 0;
    this.mirageCount = 0;
    this.caravanSent = false;
    this.treasureCount = 0;
    this.timeRewindPending = false;
    this.resonancePhase = 0;
    this.stats = { deployed: 0, beaten: 0, rageTriggers: 0, catsLost: 0 };
    this.telemetry = {
      damageByCat: emptyCounts(),
      killsByCat: emptyCounts(),
      healingByCat: emptyCounts(),
      deployedByCat: emptyCounts(),
      deathsByCat: emptyCounts(),
      maxOnField: emptyCounts(),
      firstDeployAt: emptyCounts(),
      firstDeathAt: emptyCounts(),
    };
    this.deaths = [];

    for (const wave of stage.waves) {
      const mouse = this.mouseById.get(wave.mouse);
      if (!mouse) continue;
      if ((wave.trigger ?? 0) > 0) {
        this.triggers.push({ wave, mouse, fired: false });
      } else {
        this.queueWave(wave, mouse, 0);
      }
    }
    this.spawns.sort((a, b) => a.at - b.at);
  }

  get timeLimit() {
    return this.stage.time_limit ?? 0;
  }

  get maxMoney() {
    return 600 + 400 * (this.walletLevel - 1);
  }

  get cannonTargetCount() {
    return this.units.filter((unit) => unit.side === "mouse" && !unit.dead && unit.x > 455).length;
  }

  get walletCost() {
    return this.walletLevel >= WALLET_MAX_LEVEL ? 0 : 150 * this.walletLevel;
  }

  get catCount() {
    return this.units.reduce(
      (count, unit) => count + (unit.side === "cat" && unit.dead <= 0 ? 1 : 0),
      0,
    );
  }

  get shielded() {
    return this.time < (this.stage.shield_seconds ?? 0);
  }

  queueWave(wave, mouse, offset) {
    const repeat = wave.repeat ?? 0;
    const every = wave.every ?? 0;
    for (let index = 0; index <= repeat; index++) {
      const at = offset + wave.at + index * every;
      const scale = wave.scale > 0 ? wave.scale : 1;
      const traits = wave.traits ?? [];
      for (let member = 0; member < wave.count; member++) {
        this.spawns.push({ at: at + member * wave.gap, mouse, scale, traits });
      }
    }
  }

  catsOnField() {
    const counts = emptyCounts();
    for (const unit of this.units) {
      if (unit.side === "cat" && unit.dead <= 0) bump(counts, unit.id);
    }
    return counts;
  }

  canDeploy(slot) {
    const entry = this.team[slot];
    const cat = entry && this.catById.get(entry.id);
    return Boolean(
      cat &&
        this.result === "playing" &&
        this.catCount < MAX_FIELD_CATS &&
        this.slotCooldowns[slot] <= 0 &&
        this.money >= cat.cost,
    );
  }

  deploy(slot) {
    if (!this.canDeploy(slot)) return false;
    const { id, level } = this.team[slot];
    const cat = this.catById.get(id);
    this.money -= cat.cost;
    this.slotCooldowns[slot] = cat.cooldown;
    const growth = 1 + (this.catalog.rules.level_growth ?? 0.1) * (level - 1);
    const unit = this.makeUnit("cat", cat, 895, {
      hp: round(cat.hp * growth),
      atk: round(cat.atk * growth * this.attackBoost),
    });
    this.units.push(unit);
    this.actions.push({ tick: this.tickCount, type: "deploy", slot, id, level });
    this.stats.deployed++;
    bump(this.telemetry.deployedByCat, id);
    const liveCount = this.catsOnField()[id] || 0;
    this.telemetry.maxOnField[id] = Math.max(this.telemetry.maxOnField[id] || 0, liveCount);
    if (!(id in this.telemetry.firstDeployAt)) this.telemetry.firstDeployAt[id] = this.time;
    this.emit("deploy", { id, tier: cat.tier, slot, time: this.time });
    return true;
  }

  upgradeWallet() {
    if (
      this.walletLevel >= WALLET_MAX_LEVEL ||
      this.money < this.walletCost ||
      this.result !== "playing"
    ) return false;
    this.money -= this.walletCost;
    this.walletLevel++;
    this.actions.push({ tick: this.tickCount, type: "wallet", level: this.walletLevel });
    this.emit("wallet", { level: this.walletLevel, time: this.time });
    return true;
  }

  fireCannon() {
    if (this.cannonCharge < this.cannonTime || this.result !== "playing") return false;
    this.cannonCharge = 0;
    this.actions.push({ tick: this.tickCount, type: "cannon" });
    this.emit("cannon", { time: this.time });
    for (const unit of this.units) {
      if (unit.side === "mouse" && !unit.dead && unit.x > 455) {
        this.damage(unit, this.cannonDamage, null, "cannon");
        this.shove(unit, 90, 18);
      }
    }
    return true;
  }

  makeUnit(side, data, x, stats, traits = []) {
    const isMouse = side === "mouse";
    const effectiveTraits = new Set([
      ...traits,
      ...(isMouse ? INTRINSIC_MOUSE_TRAITS.get(data.id) ?? [] : []),
    ]);
    const unit = {
      uid: this.nextUid++,
      side,
      id: data.id,
      name: data.name,
      tier: data.tier,
      kind: null,
      x,
      hp: stats.hp,
      maxHp: stats.hp,
      atk: stats.atk,
      range: this.stage.modifier === "fog" ? Math.min(data.range, 250) : data.range,
      speed: data.speed,
      interval: data.interval,
      ability: data.ability,
      abilityValue: data.ability_value,
      auraKind: side === "cat" ? data.aura_kind : undefined,
      auraRadius: side === "cat" ? data.aura_radius : undefined,
      summon: isMouse ? data.summon ?? "m7" : "",
      summonCount: isMouse ? data.summon_count ?? 3 : 0,
      revive: isMouse ? data.revive ?? 0 : 0,
      armor: data.armor ?? 0,
      dodge: data.dodge ?? 0,
      money: isMouse ? (data.money ?? 0) : 0,
      weight: isMouse ? (data.weight ?? 0) : 0,
      knockbacks: data.knockbacks,
      thresholdsLeft: data.knockbacks,
      cooldown: 0.2,
      windup: 0,
      knockback: 0,
      knockbackFrom: x,
      knockbackTo: x,
      frozen: 0,
      rage: effectiveTraits.has("rage"),
      frostproof: effectiveTraits.has("frostproof"),
      leap: effectiveTraits.has("leap"),
      chargeTicks: effectiveTraits.has("charge") ? 200 : 0,
      chargeFirstHit: effectiveTraits.has("charge"),
      flying: effectiveTraits.has("flying"),
      grounded: 0,
      landed: false,
      bomber: effectiveTraits.has("bomber"),
      bombRetreat: 0,
      warm: effectiveTraits.has("warm"),
      anchor: effectiveTraits.has("anchor"),
      armorbite: effectiveTraits.has("armorbite"),
      ink: effectiveTraits.has("ink"),
      deathfreeze: effectiveTraits.has("deathfreeze"),
      poison: effectiveTraits.has("poison"),
      poisonUntil: 0,
      rewind: effectiveTraits.has("rewind"),
      rewindNext: effectiveTraits.has("rewind") ? this.tickCount + 400 : 0,
      recentDamage: [],
      split: effectiveTraits.has("split"),
      splitDepth: 0,
      phantom: false,
      rageMeter: 0,
      rageImmune: 0,
      dash: 0,
      slowed: 0,
      slowFactor: 1,
      abilityTimer:
        ABILITY_TIMER_START[data.ability] ??
        (PERIODIC_ABILITIES.has(data.ability) ? data.ability_value : 0),
      expiresAt: 0,
      turret: null,
      burnUntil: 0,
      burnNextTick: 0,
      burnDamage: 0,
      timeHistory: null,
      dead: 0,
      spawnedAt: this.time,
      scale: stats.scale ?? 1,
    };
    return unit;
  }

  spawnMouse(mouse, x = null, scale = 1, traits = []) {
    const multiplier = this.stage.scale * scale;
    const startX = x ?? (mouse.ability === "tunnel" ? 95 + mouse.ability_value : 105);
    this.units.push(
      this.makeUnit(
        "mouse",
        mouse,
        startX,
        {
          hp: round(mouse.hp * multiplier),
          atk: round(mouse.atk * multiplier),
          scale: multiplier,
        },
        traits,
      ),
    );
    const spawned = this.units.at(-1);
    if (this.stage.twist === "mirage" && spawned && mouse.tier !== "S") {
      this.mirageCount++;
      if (this.mirageCount % 2 === 0) {
        spawned.phantom = true;
        spawned.hp = 1;
        spawned.maxHp = 1;
        spawned.money = 0;
        spawned.revive = 0;
      }
    }
    if (spawned && mouse.id === "m51") {
      for (const offset of [-12, 12]) this.spawnForestUnit(spawned, offset, true);
    }
    if (mouse.tier === "A" || mouse.tier === "S") {
      this.emit("boss", { id: mouse.id, tier: mouse.tier, time: this.time });
    }
  }

  spawnForestUnit(base, offset, phantom) {
    const hp = phantom ? 1 : Math.max(1, round(base.maxHp * 0.3));
    const atk = phantom ? 0 : round(base.atk * 0.3);
    const unit = this.makeUnit(
      "mouse",
      {
        id: base.id,
        name: base.name,
        tier: base.tier,
        hp,
        atk,
        range: base.range,
        speed: base.speed,
        interval: base.interval,
        ability: "none",
        ability_value: 0,
        money: 0,
        armor: phantom ? 0 : base.armor,
        dodge: phantom ? 0 : base.dodge,
        weight: phantom ? 0 : base.weight,
        knockbacks: phantom ? 0 : base.knockbacks,
      },
      Math.max(95, Math.min(905, base.x + offset)),
      { hp, atk },
    );
    unit.kind = phantom ? "decoy" : "split";
    unit.phantom = phantom;
    unit.splitDepth = phantom ? 0 : base.splitDepth + 1;
    unit.split = !phantom && unit.splitDepth < (this.stage.twist === "split_hell" ? 2 : 1);
    unit.rage = false;
    this.units.push(unit);
  }

  spawnTwistUnit(kind) {
    const caravan = kind === "caravan";
    const hp = caravan ? round(this.mouseBaseMax * 0.3) : round(800 * this.stage.scale);
    const unit = this.makeUnit(
      caravan ? "neutral" : "mouse",
      {
        id: kind,
        name: "",
        tier: "C",
        hp,
        atk: 0,
        range: 0,
        speed: caravan ? 20 : 45,
        interval: 0,
        ability: "none",
        ability_value: 0,
        money: caravan ? 0 : 300,
        armor: 0,
        dodge: 0,
        weight: 0,
        knockbacks: 0,
      },
      caravan ? 900 : 500,
      { hp, atk: 0 },
    );
    unit.kind = kind;
    unit.tier = "";
    this.units.push(unit);
  }

  eventActive(event, time = this.time) {
    if (event.kind === "eclipse" && time < (event.at ?? 0)) return false;
    const cycle = event.every ?? 0;
    let last = event.last ?? 0;
    if (last === 0 && (event.kind === "wind" || event.kind === "lightning")) last = 1;
    if (cycle === 0 && last === 0) return true;
    const elapsed = time - (event.at ?? 0);
    if (elapsed < 0) return false;
    const phase = cycle > 0 ? elapsed % cycle : elapsed;
    return phase + 1e-9 < last;
  }

  attackRange(unit, range) {
    let result = this.stage.modifier === "fog" ? Math.min(range, 250) : range;
    for (const event of this.stage.events ?? []) {
      if (event.kind !== "sandstorm" || !this.eventActive(event) || this.isLit(unit)) continue;
      result = Math.min(result, event.value ?? 200);
    }
    return result;
  }

  isLit(unit) {
    if (unit.side !== "cat") return false;
    return this.units.some(
      (other) =>
        other.side === "cat" &&
        !other.dead &&
        other.hp > 0 &&
        other.ability === "reveal" &&
        Math.abs(other.x - unit.x) <= other.abilityValue,
    );
  }

  canTarget(attacker, target) {
    if (target.kind === "caravan") {
      return attacker.side === "mouse" &&
        (!attacker.kind || attacker.kind === "split" || attacker.kind === "marshal_guard");
    }
    if (attacker.side === "neutral" || target.side === "neutral") return false;
    if (attacker.side === target.side) return false;
    if (attacker.side === "cat" && target.side === "mouse") {
      if (
        target.flying &&
        target.grounded <= 0 &&
        attacker.range < 100 &&
        !["area", "rocket", "lightning"].includes(attacker.ability) &&
        !this.isLit(attacker)
      ) return false;
      if (target.ink && Math.abs(target.x - attacker.x) > 200 && !this.isLit(attacker)) return false;
    }
    return true;
  }

  hasWarmAura(unit) {
    return this.units.some(
      (other) =>
        other.side === "mouse" &&
        !other.dead &&
        other.warm &&
        Math.abs(other.x - unit.x) <= 160,
    );
  }

  tickWarmAura(delta) {
    this.warmAuraTimer += delta;
    if (this.warmAuraTimer < 4) return;
    this.warmAuraTimer = 0;
    for (const unit of this.units) {
      if (unit.side === "mouse" && !unit.dead && unit.frozen > 0 && this.hasWarmAura(unit)) {
        unit.frozen = 0;
      }
    }
  }

  effectiveDodge(unit) {
    if (
      unit.side === "mouse" &&
      unit.ability === "eclipse_king" &&
      (this.stage.events ?? []).some((event) => event.kind === "eclipse" && this.eventActive(event))
    ) return Math.max(unit.dodge, 0.3);
    return unit.dodge;
  }

  effectiveAttack(unit) {
    if (unit.side === "cat") {
      let gift = 0;
      for (const other of this.units) {
        if (
          other.side === "cat" &&
          other.ability === "aura" &&
          other.auraKind === "rally" &&
          Math.abs(other.x - unit.x) <= (other.auraRadius ?? 0)
        ) gift = Math.max(gift, other.abilityValue);
      }
      if (unit.giftAtkUntil > this.tickCount) gift = Math.max(gift, 0.25);
      return unit.atk * (1 + gift);
    }
    if (
      unit.side === "mouse" &&
      unit.ability === "eclipse_king" &&
      (this.stage.events ?? []).some((event) => event.kind === "eclipse" && this.eventActive(event))
    ) return unit.atk * (unit.abilityValue || 1.5);
    return unit.atk;
  }

  deathFreeze(unit) {
    if (!unit.deathfreeze && !unit.armorbite) return;
    for (const other of this.units) {
      if (other.side === "cat" && !other.dead && Math.abs(other.x - unit.x) <= 120) {
        this.control(other, 1.5, true);
      }
    }
  }

  enemiesInFront(unit, range) {
    const direction = unit.side === "cat" ? -1 : 1;
    const attackRange = this.attackRange(unit, range);
    return this.units
      .filter(
        (other) =>
          other !== unit &&
          !other.dead &&
          this.canTarget(unit, other) &&
          (other.kind === "caravan" || (other.x - unit.x) * direction >= -8) &&
          Math.abs(other.x - unit.x) <= attackRange,
      )
      .sort((a, b) => {
        const caravanOrder = Number(b.kind === "caravan") - Number(a.kind === "caravan");
        return caravanOrder || Math.abs(a.x - unit.x) - Math.abs(b.x - unit.x);
      });
  }

  baseDistance(unit) {
    return unit.side === "cat" ? unit.x - 95 : 905 - unit.x;
  }

  damage(target, rawDamage, source = null, cause = "attack", ignoreDodge = false) {
    if (!target || target.dead) return false;
    if (target.side === "mouse" && target.markUntil > this.tickCount) {
      rawDamage *= 1 + (target.markValue ?? 0);
    }
    if (!ignoreDodge && this.effectiveDodge(target) > 0 && this.random() < this.effectiveDodge(target)) {
      this.emit("miss", { id: target.id, time: this.time });
      return false;
    }
    const armorBite = source?.side === "mouse" && source.armorbite && target.side === "cat"
      ? Math.min(400, target.maxHp * 0.04)
      : 0;
    const amount = Math.max(1, round(rawDamage * (1 - target.armor))) + armorBite;
    if (target.side === "mouse" && target.id === this.stage.boss) {
      this.bossDamage += Math.min(amount, target.hp);
    }
    if (target.rewind) {
      while (target.recentDamage.length && target.recentDamage[0].tick <= this.tickCount - 250) {
        target.recentDamage.shift();
      }
      const recorded = Math.min(amount, Math.max(0, target.hp));
      const last = target.recentDamage.at(-1);
      if (last?.tick === this.tickCount) last.amount += recorded;
      else target.recentDamage.push({ tick: this.tickCount, amount: recorded });
    }
    const oldRatio = target.hp / target.maxHp;
    target.hp -= amount;
    if (target.revive > 0 && target.hp < target.maxHp * 0.5) {
      target.hp = Math.min(target.maxHp, target.hp + target.maxHp * target.revive);
      target.revive = 0;
      this.emit("revive", { id: target.id, time: this.time });
    }
    if (target.ability === "land" && !target.landed && target.hp < target.maxHp * 0.5) {
      target.grounded = target.abilityValue;
      target.landed = true;
    }
    if (source?.side === "cat") bump(this.telemetry.damageByCat, source.id, amount);
    if (
      source?.side === "mouse" &&
      source.poison &&
      target.side === "cat" &&
      target.hp > 0
    ) target.poisonUntil = this.tickCount + 250;
    this.emit("hit", { side: target.side, id: target.id, amount, cause, time: this.time });

    if (target.hp <= 0) {
      target.dead = 0.7;
      target.hp = 0;
      if (target.side === "mouse") {
        this.money = Math.min(this.maxMoney, this.money + target.money);
        if (!target.kind) this.defeated.add(target.id);
        this.stats.beaten++;
        if (source?.side === "cat") bump(this.telemetry.killsByCat, source.id);
        this.deathFreeze(target);
        if (target.split) {
          this.spawnForestUnit(target, -12, false);
          this.spawnForestUnit(target, 12, false);
        }
      } else if (target.side === "cat" && target.kind !== "turret") {
        this.stats.catsLost++;
        bump(this.telemetry.deathsByCat, target.id);
        if (!(target.id in this.telemetry.firstDeathAt)) {
          this.telemetry.firstDeathAt[target.id] = this.time;
        }
        this.deaths.push({ id: target.id, time: this.time, x: target.x });
      }
      this.emit("death", { side: target.side, id: target.id, time: this.time });
      return true;
    }

    const newRatio = target.hp / target.maxHp;
    if (target.knockbacks > 0 && target.thresholdsLeft > 0) {
      const threshold = 1 - (target.knockbacks - target.thresholdsLeft + 1) / (target.knockbacks + 1);
      if (oldRatio > threshold && newRatio <= threshold) {
        target.thresholdsLeft--;
        this.push(target, 55, 14);
      }
    }
    return true;
  }

  push(unit, distance, height) {
    if (!unit || unit.dead || unit.knockbacks === 0 || unit.anchor) return false;
    if (unit.side === "mouse" && unit.chargeTicks > 0) {
      unit.chargeTicks = 0;
      unit.chargeFirstHit = false;
    }
    const direction = unit.side === "cat" ? 1 : -1;
    unit.knockback = 0.55;
    unit.knockbackFrom = unit.x;
    unit.knockbackTo = Math.max(95, Math.min(905, unit.x + direction * distance));
    unit.windup = 0;
    return true;
  }

  shove(unit, distance, height) {
    if (unit.side === "mouse" && (unit.rageImmune > 0 || unit.anchor)) return false;
    let applied = unit.side === "mouse" ? distance * Math.max(0, 1 - unit.weight / 10) : distance;
    if (unit.side === "mouse" && this.stage.modifier === "gravity") applied *= 0.5;
    if (!(applied > 0)) return false;
    this.push(unit, applied, height);
    if (unit.side === "mouse") this.addRage(unit, 10);
    return true;
  }

  control(unit, duration, direct) {
    if (unit.side === "mouse") {
      if (unit.rageImmune > 0) return false;
      if (direct && this.stage.modifier === "heatwave") duration *= 0.5;
      if (direct) {
        for (const event of this.stage.events ?? []) {
          if (event.kind === "heatwave" && this.eventActive(event)) {
            duration *= event.value ?? 0.5;
          }
        }
      }
      if (direct && unit.frostproof) duration *= 0.3;
      if (direct && this.hasWarmAura(unit)) duration *= 0.5;
    }
    unit.frozen = Math.max(unit.frozen, duration);
    if (unit.side === "mouse") this.addRage(unit, direct ? 12 * duration : 30);
    return true;
  }

  addRage(unit, amount) {
    if (!unit.rage || unit.rageImmune > 0) return false;
    unit.rageMeter += amount;
    if (unit.rageMeter < 100) return false;
    unit.rageMeter = 0;
    unit.rageImmune = 6;
    unit.frozen = 0;
    for (const other of this.units) {
      if (other.side === "cat" && !other.dead && Math.abs(other.x - unit.x) <= 120) {
        other.frozen = Math.max(other.frozen, 0.8);
      }
    }
    this.stats.rageTriggers++;
    this.emit("rage", { id: unit.id, time: this.time, x: unit.x });
    return true;
  }

  airWave() {
    for (const unit of this.units) {
      if (unit.side === "cat" && !unit.dead && unit.x < 500) this.push(unit, 500 - unit.x, 70);
    }
    this.emit("wave", { time: this.time });
  }

  guardedBaseHp(candidate) {
    const guard = this.stage.guard;
    if (!guard || this.defeated.has(guard)) return candidate;
    return Math.max(candidate, Math.min(this.mouseBaseHp, 0.15 * this.stage.base_hp));
  }

  hit(unit) {
    const range = this.attackRange(unit, unit.range);
    const targets = this.enemiesInFront(unit, range);
    const primary = targets[0];
    const critical = unit.ability === "crit" && this.random() < unit.abilityValue;
    let damage = this.effectiveAttack(unit) * (critical ? 2.5 : 1);
    if (unit.chargeFirstHit) {
      damage *= 2;
      unit.chargeFirstHit = false;
    }

    if (!primary) {
      if (this.baseDistance(unit) <= range) {
        if (unit.side === "cat") {
          if (!this.shielded) {
            this.mouseBaseHp = this.guardedBaseHp(this.mouseBaseHp - damage);
            this.emit("base-hit", { side: "mouse", amount: damage, time: this.time });
          }
        } else {
          this.catBaseHp -= damage;
          this.emit("base-hit", { side: "cat", amount: damage, time: this.time });
        }
      }
      return;
    }

    if (critical) this.emit("crit", { id: unit.id, time: this.time });
    if (MULTI_TARGET_ABILITIES.has(unit.ability)) {
      this.emit("ability", { ability: unit.ability, side: unit.side, id: unit.id, time: this.time });
    }

    switch (unit.ability) {
      case "area":
      case "rocket": {
        const ranged = unit.range >= 100;
        let radius = ranged ? 60 : unit.range;
        if (unit.ability === "rocket") radius = unit.abilityValue;
        const center = ranged
          ? primary.x
          : unit.x + (unit.side === "cat" ? -1 : 1) * unit.range / 2;
        for (const target of this.units) {
          if (target !== unit && !target.dead && this.canTarget(unit, target) && Math.abs(target.x - center) <= radius) {
            this.damage(target, damage, unit, unit.ability);
          }
        }
        break;
      }
      case "launch":
        for (const target of targets) {
          this.damage(target, damage, unit, "launch");
          this.shove(target, unit.abilityValue, 40);
        }
        break;
      case "pierce":
        this.damage(primary, damage, unit, "pierce");
        for (const target of this.units) {
          const behind = (target.x - primary.x) * (unit.side === "cat" ? -1 : 1);
          if (this.canTarget(unit, target) && !target.dead && target !== primary && behind > 0 && behind <= 160) {
            this.damage(target, damage * unit.abilityValue, unit, "pierce-secondary");
          }
        }
        break;
      case "freeze":
        for (const target of this.units) {
          if (!target.dead && this.canTarget(unit, target) && Math.abs(target.x - primary.x) <= 70) {
            this.damage(target, damage, unit, "freeze");
            this.control(target, target.tier === "S" ? unit.abilityValue / 2 : unit.abilityValue, true);
          }
        }
        break;
      case "lightning":
        this.damage(primary, damage, unit, "lightning");
        for (const target of this.units) {
          if (!target.dead && this.canTarget(unit, target)) {
            if (target !== primary) this.damage(target, damage * unit.abilityValue, unit, "lightning-secondary");
            this.shove(target, 25, 10);
          }
        }
        break;
      case "slow":
        this.damage(primary, damage, unit, "slow");
        primary.slowed = 2.5;
        primary.slowFactor = 1 - unit.abilityValue;
        break;
      case "burn":
        if (this.damage(primary, damage, unit, "burn") && !primary.dead) {
          primary.burnUntil = this.tickCount + 150;
          primary.burnNextTick = this.tickCount + 50;
          primary.burnDamage = 0.2 * this.effectiveAttack(unit);
        }
        break;
      case "knockback": {
        const areaTargets = unit.side === "mouse" && unit.range >= 60 ? targets : [primary];
        for (const target of areaTargets) this.damage(target, damage, unit, "knockback");
        if (this.random() < unit.abilityValue) {
          for (const target of areaTargets) this.shove(target, 70, 22);
        }
        break;
      }
      case "summon":
        for (const target of targets) this.damage(target, damage, unit, "summon");
        if (this.random() < 0.35) {
          for (const target of targets) this.push(target, 70, 22);
        }
        break;
      default:
        this.damage(primary, damage, unit, critical ? "crit" : "attack");
    }
  }

  tickAbility(unit, delta) {
    if (!PERIODIC_ABILITIES.has(unit.ability)) return;
    unit.abilityTimer -= delta;
    if (unit.abilityTimer > 0) return;
    if (unit.ability === "heal") {
      unit.abilityTimer = 3;
      this.emit("ability", { ability: "heal", side: unit.side, id: unit.id, time: this.time });
      for (const target of this.units) {
        if (
          target.side === unit.side &&
          !target.dead &&
          Math.abs(target.x - unit.x) <= 150 &&
          target.hp < target.maxHp
        ) {
          const before = target.hp;
          let healing = unit.abilityValue * (this.effectiveAttack(unit) / 15);
          if (target.side === "cat" && target.poisonUntil > this.tickCount) healing *= 0.4;
          target.hp = Math.min(target.maxHp, target.hp + healing);
          if (unit.side === "cat") bump(this.telemetry.healingByCat, unit.id, target.hp - before);
        }
      }
      return;
    }
    if (unit.ability === "heal_cleanse") {
      unit.abilityTimer = 3;
      this.emit("ability", { ability: "heal_cleanse", side: unit.side, id: unit.id, time: this.time });
      for (const target of this.units) {
        if (target.side !== unit.side || target.dead || Math.abs(target.x - unit.x) > 150) continue;
        target.poisonUntil = 0;
        if (target.hp <= 0 || target.hp >= target.maxHp) continue;
        const before = target.hp;
        target.hp = Math.min(
          target.maxHp,
          target.hp + unit.abilityValue * (this.effectiveAttack(unit) / 15),
        );
        if (unit.side === "cat") bump(this.telemetry.healingByCat, unit.id, target.hp - before);
      }
      return;
    }
    if (unit.ability === "timewarp") {
      unit.abilityTimer = 10;
      this.emit("ability", { ability: "timewarp", side: unit.side, id: unit.id, time: this.time });
      for (const target of this.units) {
        if (!target.dead && this.canTarget(unit, target) && Math.abs(target.x - unit.x) <= 500) {
          this.shove(target, unit.abilityValue, 30);
          this.control(target, 1.5, false);
        }
      }
      return;
    }
    if (unit.ability === "turret") {
      unit.abilityTimer = unit.abilityValue;
      if (unit.turret && !unit.turret.dead && unit.turret.hp > 0 && this.tickCount < unit.turret.expiresAt) {
        return;
      }
      const turret = this.makeUnit(
        "cat",
        {
          id: "turret",
          name: "",
          tier: "C",
          hp: 300,
          atk: round(unit.atk * 0.5),
          range: 200,
          speed: 0,
          interval: 1.5,
          ability: "none",
          ability_value: 0,
          armor: 0,
          dodge: 0,
          knockbacks: 0,
        },
        Math.min(905, unit.x + 60),
        { hp: 300, atk: round(unit.atk * 0.5) },
      );
      turret.kind = "turret";
      turret.expiresAt = this.tickCount + 750;
      unit.turret = turret;
      this.units.push(turret);
      this.emit("ability", { ability: "turret", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    if (unit.ability === "pendulum") {
      unit.abilityTimer = unit.abilityValue;
      for (const target of this.units) {
        if (target.side === "cat" && !target.dead && Math.abs(target.x - unit.x) <= unit.range) {
          this.shove(target, 40, 14);
        }
      }
      this.emit("ability", { ability: "pendulum", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    if (unit.ability === "time_rewind") {
      unit.abilityTimer = unit.abilityValue;
      this.timeRewindPending = true;
      this.emit("ability", { ability: "time_rewind", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    if (unit.ability === "thunder") {
      unit.abilityTimer = unit.abilityValue;
      for (const target of this.units) {
        if (target.side === "cat" && !target.dead && Math.abs(target.x - unit.x) <= 120) {
          this.damage(target, this.effectiveAttack(unit), unit, "thunder", true);
        }
      }
      this.emit("ability", { ability: "thunder", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    if (unit.ability === "cleanse") {
      unit.abilityTimer = unit.abilityValue;
      for (const target of this.units) {
        if (target.side === unit.side && !target.dead && Math.abs(target.x - unit.x) <= 150) {
          target.frozen = 0;
          target.slowed = 0;
          target.slowFactor = 1;
          target.poisonUntil = 0;
        }
      }
      this.emit("ability", { ability: "cleanse", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    if (unit.ability === "mark") {
      unit.abilityTimer = 8;
      const target = this.units
        .filter((other) => other.side === "mouse" && !other.dead && !other.kind)
        .sort((a, b) => b.hp - a.hp)[0];
      if (target) {
        target.markValue = Math.max(target.markValue ?? 0, unit.abilityValue);
        target.markUntil = this.tickCount + 300;
      }
      this.emit("ability", { ability: "mark", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    if (unit.ability === "gift") {
      unit.abilityTimer = 25;
      const gift = (unit.giftCount ?? 0) % 3;
      unit.giftCount = (unit.giftCount ?? 0) + 1;
      for (const target of this.units) {
        if (target.side !== unit.side || target.dead || Math.abs(target.x - unit.x) > 200) continue;
        if (gift === 0) target.giftAtkUntil = this.tickCount + 400;
        else if (gift === 1) target.giftSpeedUntil = this.tickCount + 400;
        else target.hp = Math.min(target.maxHp, target.hp + round(target.maxHp * 0.15));
      }
      this.emit("ability", { ability: "gift", side: unit.side, id: unit.id, time: this.time });
      return;
    }
    unit.abilityTimer = unit.abilityValue;
    this.emit("ability", { ability: "summon", side: unit.side, id: unit.id, time: this.time });
    const summoned = this.mouseById.get(unit.summon || "m7");
    if (!summoned) return;
    const count = unit.summonCount > 0 ? unit.summonCount : 3;
    for (let index = 0; index < count; index++) {
      this.spawnMouse(summoned, unit.x + 10 + 12 * index);
    }
  }

  step() {
    if (this.result !== "playing") return false;
    this.tickCount++;
    this.time += STEP;
    this.money = Math.min(this.maxMoney, this.money + (25 + 8 * (this.walletLevel - 1)) * this.cashRate * STEP);
    this.cannonCharge = Math.min(this.cannonTime, this.cannonCharge + STEP);
    for (let slot = 0; slot < this.slotCooldowns.length; slot++) {
      this.slotCooldowns[slot] = Math.max(0, this.slotCooldowns[slot] - STEP);
    }

    let queuedTrigger = false;
    for (const trigger of this.triggers) {
      if (trigger.fired) continue;
      if (100 * this.mouseBaseHp > trigger.wave.trigger * this.mouseBaseMax) continue;
      trigger.fired = true;
      queuedTrigger = true;
      this.airWave();
      this.queueWave(trigger.wave, trigger.mouse, this.time);
    }
    if (queuedTrigger) this.spawns.sort((a, b) => a.at - b.at);

    while (this.spawns.length && this.spawns[0].at <= this.time) {
      const spawn = this.spawns.shift();
      if (!spawn) continue;
      if (this.stage.guard && spawn.mouse.id === this.stage.guard) {
        if (this.guardSpawned) continue;
        this.guardSpawned = true;
      }
      this.spawnMouse(spawn.mouse, null, spawn.scale, spawn.traits);
    }

    if (
      this.stage.twist === "caravan" &&
      !this.caravanSent &&
      this.tickCount >= 1000
    ) {
      this.caravanSent = true;
      this.spawnTwistUnit("caravan");
    }
    if (
      this.stage.twist === "treasure_camel" &&
      this.tickCount >= (this.treasureCount + 1) * 3000
    ) {
      this.treasureCount++;
      this.spawnTwistUnit("treasure");
    }
    this.recordTimeHistory();
    this.tickWarmAura(STEP);

    for (const unit of this.units) {
      if (unit.dead <= 0 && unit.grounded > 0) {
        unit.grounded = Math.max(0, unit.grounded - STEP);
      }
      unit.hurt = Math.max(0, (unit.hurt ?? 0) - 0.08);
      if (unit.dead > 0) {
        unit.dead -= STEP;
        continue;
      }
      if (unit.kind === "turret" && this.tickCount >= unit.expiresAt) {
        unit.hp = 0;
        unit.dead = -1;
        continue;
      }
      if (unit.burnUntil > 0) {
        if (unit.burnNextTick <= unit.burnUntil && this.tickCount >= unit.burnNextTick) {
          this.damage(unit, unit.burnDamage, null, "burn-tick", true);
          unit.burnNextTick += 50;
        }
        if (this.tickCount >= unit.burnUntil) {
          unit.burnUntil = 0;
          unit.burnNextTick = 0;
        }
        if (unit.dead) continue;
      }
      this.tickRewind(unit);
      if (unit.kind === "caravan") {
        unit.x -= unit.speed * STEP;
        if (unit.x <= 80) {
          if (!this.shielded) {
            this.mouseBaseHp = this.guardedBaseHp(this.mouseBaseHp - 0.3 * this.mouseBaseMax);
            this.emit("caravan", { time: this.time, damage: 0.3 * this.mouseBaseMax });
          }
          unit.hp = 0;
          unit.dead = -1;
        }
        continue;
      }
      if (unit.kind === "treasure") {
        unit.x -= unit.speed * STEP;
        if (unit.x < 0) {
          unit.hp = 0;
          unit.dead = -1;
        }
        continue;
      }
      if (unit.rageImmune > 0) unit.rageImmune = Math.max(0, unit.rageImmune - STEP);
      if (this.stage.modifier === "moon" && unit.side === "mouse" && unit.hp < unit.maxHp) {
        unit.hp = Math.min(unit.maxHp, unit.hp + 0.01 * unit.maxHp * STEP);
      }
      const charging = unit.chargeTicks > 0;
      if (charging) unit.chargeTicks = Math.max(0, unit.chargeTicks - 1);
      if (unit.ability === "cleanse") this.tickAbility(unit, STEP);
      if (unit.knockback > 0) {
        unit.knockback -= STEP;
        const progress = 1 - Math.max(unit.knockback, 0) / 0.55;
        unit.x = unit.knockbackFrom + (unit.knockbackTo - unit.knockbackFrom) * progress;
        continue;
      }
      if (unit.frozen > 0) {
        unit.frozen -= STEP;
        if (unit.frozen <= 0 && unit.frostproof) unit.dash = 2;
        continue;
      }
      unit.slowed = Math.max(0, unit.slowed - STEP);
      unit.dash = Math.max(0, unit.dash - STEP);
      unit.cooldown -= STEP * this.attackClockFactor(unit);
      if (unit.ability !== "cleanse") this.tickAbility(unit, STEP);

      if (unit.windup > 0) {
        unit.windup -= STEP;
        if (unit.windup <= 0) {
          this.hit(unit);
          unit.cooldown = unit.interval;
        }
        continue;
      }

      let target = this.enemiesInFront(unit, unit.range)[0];
      if (unit.leap && target?.side === "cat" && unit.cooldown <= 0) {
        unit.x = Math.max(95, Math.min(865, target.x + 150));
        unit.leap = false;
        target = this.enemiesInFront(unit, unit.range)[0];
        continue;
      }
      const canHitBase = !target && this.baseDistance(unit) <= this.attackRange(unit, unit.range);
      if (target || canHitBase) {
        if (unit.cooldown <= 0) unit.windup = 0.28;
        continue;
      }

      if (unit.kind === "turret") continue;
      let speed = unit.speed * (unit.slowed > 0 ? unit.slowFactor : 1) * (unit.dash > 0 ? 1.5 : 1);
      if (charging) speed *= 2.5;
      unit.x += (unit.side === "cat" ? -1 : 1) * speed * STEP;
      unit.x = Math.max(95, Math.min(905, unit.x));
    }

    if (this.timeRewindPending) {
      this.rewindMice();
      this.timeRewindPending = false;
    }

    const before = this.units.length;
    this.units = this.units.filter((unit) => !(unit.hp <= 0 && unit.dead <= 0));
    if (this.units.length !== before) {
      const counts = this.catsOnField();
      for (const [id, count] of Object.entries(counts)) {
        this.telemetry.maxOnField[id] = Math.max(this.telemetry.maxOnField[id] || 0, count);
      }
    }

    if (this.mouseBaseHp <= 0) this.result = "won";
    else if (this.catBaseHp <= 0 || this.tickCount >= 60000) this.result = "lost";
    else if (this.timeLimit > 0 && this.time >= this.timeLimit) this.result = "timeup";
    return true;
  }

  attackClockFactor(unit) {
    if (unit.side !== "cat") return 1;
    let haste = 0;
    for (const other of this.units) {
      if (
        other.side === "cat" &&
        !other.dead &&
        other.ability === "aura" &&
        other.auraKind === "haste" &&
        Math.abs(other.x - unit.x) <= (other.auraRadius ?? 0)
      ) haste = Math.max(haste, other.abilityValue);
    }
    if (unit.giftSpeedUntil > this.tickCount) haste = Math.max(haste, 0.25);
    return 1 + haste;
  }

  tickRewind(unit) {
    if (!unit.rewind || unit.dead || unit.hp <= 0) return;
    while (unit.recentDamage.length && unit.recentDamage[0].tick <= this.tickCount - 250) {
      unit.recentDamage.shift();
    }
    if (this.tickCount < unit.rewindNext) return;
    unit.rewindNext += 400;
    const healing = 0.5 * unit.recentDamage.reduce((sum, entry) => sum + entry.amount, 0);
    const before = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + healing);
    if (unit.hp > before) this.emit("rewind", { id: unit.id, amount: unit.hp - before, time: this.time });
  }

  recordTimeHistory() {
    const needsHistory =
      this.units.some((unit) => unit.side === "mouse" && !unit.dead && unit.ability === "time_rewind") ||
      this.spawns.some((spawn) => spawn.mouse.ability === "time_rewind") ||
      this.triggers.some((trigger) => !trigger.fired && trigger.mouse.ability === "time_rewind");
    if (!needsHistory) return;
    for (const unit of this.units) {
      if (unit.side !== "mouse" || unit.dead || unit.hp <= 0) continue;
      unit.timeHistory ??= Array.from({ length: 151 }, () => ({ tick: 0, x: 0, hp: 0 }));
      unit.timeHistory[this.tickCount % 151] = {
        tick: this.tickCount,
        x: unit.x,
        hp: unit.hp,
      };
    }
  }

  rewindMice() {
    if (this.tickCount < 150) return;
    const targetTick = this.tickCount - 150;
    for (const unit of this.units) {
      if (unit.side !== "mouse" || unit.dead || unit.hp <= 0) continue;
      const snapshot = unit.timeHistory?.[targetTick % 151];
      if (!snapshot || snapshot.tick !== targetTick || snapshot.hp <= 0) continue;
      unit.x = Math.max(95, Math.min(905, snapshot.x));
      unit.hp = Math.min(unit.maxHp, snapshot.hp);
      unit.knockback = 0;
      unit.knockbackFrom = unit.x;
      unit.knockbackTo = unit.x;
    }
  }

  snapshot() {
    return {
      time: this.time,
      money: Math.floor(this.money),
      maxMoney: this.maxMoney,
      walletLevel: this.walletLevel,
      walletCost: this.walletCost,
      cannon: Math.min(this.cannonCharge / this.cannonTime, 1),
      cannonTargets: this.cannonTargetCount,
      catBaseHp: Math.max(0, round(this.catBaseHp)),
      catBaseMax: this.catBaseMax,
      mouseBaseHp: Math.max(0, round(this.mouseBaseHp)),
      mouseBaseMax: this.mouseBaseMax,
      result: this.result,
      cats: this.catCount,
      onField: this.catsOnField(),
      bossDamage: round(this.bossDamage),
      cooldowns: this.slotCooldowns.map((cooldown, slot) => {
        const cat = this.catById.get(this.team[slot].id);
        return cooldown > 0 ? cooldown / cat.cooldown : 0;
      }),
    };
  }

  emit(type, payload) {
    this.onEvent?.(type, payload);
  }
}
