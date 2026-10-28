export const STEP = 0.02;
export const MAX_FIELD_CATS = 20;
export const WALLET_MAX_LEVEL = 8;

const ABILITY_TIMER_START = { heal: 3, timewarp: 4 };
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

/** Exact gameplay loop derived from the current browser battle engine.
 * Rendering, particles and UI state are intentionally omitted.
 */
export class BattleEngine {
  constructor({ catalog, stage, team, seed = 1, items = [], onEvent = null }) {
    if (!catalog || !Array.isArray(catalog.cats) || !Array.isArray(catalog.mice)) {
      throw new Error("catalog.cats and catalog.mice are required");
    }
    if (!stage || !Array.isArray(stage.waves)) {
      throw new Error("stage.waves is required");
    }
    if (!Array.isArray(team) || team.length === 0) {
      throw new Error("team must contain at least one cat");
    }
    const teamSize = catalog.rules?.team_size ?? 10;
    if (team.length > teamSize) throw new Error(`team has more than ${teamSize} slots`);

    this.catalog = catalog;
    this.stage = stage;
    this.team = team;
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
    this.cannonCharge = this.items.has("cannon_ready") ? 30 : 0;
    this.cashRate = this.items.has("fast_coins") ? 1.3 : 1;
    this.attackBoost = this.items.has("rally") ? 1.15 : 1;
    this.catBaseMax = round((catalog.rules.cat_base_hp ?? 3000) * (this.items.has("strong_base") ? 1.5 : 1));
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
    if (this.cannonCharge < 30 || this.result !== "playing") return false;
    this.cannonCharge = 0;
    this.actions.push({ tick: this.tickCount, type: "cannon" });
    this.emit("cannon", { time: this.time });
    for (const unit of this.units) {
      if (unit.side === "mouse" && !unit.dead && unit.x > 455) {
        this.damage(unit, 150, null, "cannon");
        this.shove(unit, 90, 18);
      }
    }
    return true;
  }

  makeUnit(side, data, x, stats, traits = []) {
    const isMouse = side === "mouse";
    const unit = {
      uid: this.nextUid++,
      side,
      id: data.id,
      name: data.name,
      tier: data.tier,
      x,
      hp: stats.hp,
      maxHp: stats.hp,
      atk: stats.atk,
      range: this.stage.modifier === "fog" ? Math.min(data.range, 250) : data.range,
      speed: data.speed,
      interval: data.interval,
      ability: data.ability,
      abilityValue: data.ability_value,
      armor: isMouse ? (data.armor ?? 0) : 0,
      dodge: isMouse ? (data.dodge ?? 0) : 0,
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
      rage: traits.includes("rage"),
      frostproof: traits.includes("frostproof"),
      rageMeter: 0,
      rageImmune: 0,
      dash: 0,
      slowed: 0,
      slowFactor: 1,
      abilityTimer:
        ABILITY_TIMER_START[data.ability] ?? (data.ability === "summon" ? data.ability_value : 0),
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
    if (mouse.tier === "A" || mouse.tier === "S") {
      this.emit("boss", { id: mouse.id, tier: mouse.tier, time: this.time });
    }
  }

  enemiesInFront(unit, range) {
    const direction = unit.side === "cat" ? -1 : 1;
    return this.units
      .filter(
        (other) =>
          other.side !== unit.side &&
          !other.dead &&
          (other.x - unit.x) * direction >= -8 &&
          Math.abs(other.x - unit.x) <= range,
      )
      .sort((a, b) => Math.abs(a.x - unit.x) - Math.abs(b.x - unit.x));
  }

  baseDistance(unit) {
    return unit.side === "cat" ? unit.x - 95 : 905 - unit.x;
  }

  damage(target, rawDamage, source = null, cause = "attack") {
    if (!target || target.dead) return false;
    if (target.dodge > 0 && this.random() < target.dodge) {
      this.emit("miss", { id: target.id, time: this.time });
      return false;
    }
    const amount = Math.max(1, round(rawDamage * (1 - target.armor)));
    if (target.side === "mouse" && target.id === this.stage.boss) {
      this.bossDamage += Math.min(amount, target.hp);
    }
    const oldRatio = target.hp / target.maxHp;
    target.hp -= amount;
    if (source?.side === "cat") bump(this.telemetry.damageByCat, source.id, amount);
    this.emit("hit", { side: target.side, id: target.id, amount, cause, time: this.time });

    if (target.hp <= 0) {
      target.dead = 0.7;
      target.hp = 0;
      if (target.side === "mouse") {
        this.money = Math.min(this.maxMoney, this.money + target.money);
        this.defeated.add(target.id);
        this.stats.beaten++;
        if (source?.side === "cat") bump(this.telemetry.killsByCat, source.id);
      } else {
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
    if (!unit || unit.dead || unit.knockbacks === 0) return false;
    const direction = unit.side === "cat" ? 1 : -1;
    unit.knockback = 0.55;
    unit.knockbackFrom = unit.x;
    unit.knockbackTo = Math.max(95, Math.min(905, unit.x + direction * distance));
    unit.windup = 0;
    return true;
  }

  shove(unit, distance, height) {
    if (unit.side === "mouse" && unit.rageImmune > 0) return false;
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
      if (direct && unit.frostproof) duration *= 0.3;
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
    const targets = this.enemiesInFront(unit, unit.range);
    const primary = targets[0];
    const critical = unit.ability === "crit" && this.random() < unit.abilityValue;
    const damage = unit.atk * (critical ? 2.5 : 1);

    if (!primary) {
      if (this.baseDistance(unit) <= unit.range) {
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
          if (target.side !== unit.side && !target.dead && Math.abs(target.x - center) <= radius) {
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
          if (target.side !== unit.side && !target.dead && target !== primary && behind > 0 && behind <= 160) {
            this.damage(target, damage * unit.abilityValue, unit, "pierce-secondary");
          }
        }
        break;
      case "freeze":
        for (const target of this.units) {
          if (target.side !== unit.side && !target.dead && Math.abs(target.x - primary.x) <= 70) {
            this.damage(target, damage, unit, "freeze");
            this.control(target, target.tier === "S" ? unit.abilityValue / 2 : unit.abilityValue, true);
          }
        }
        break;
      case "lightning":
        this.damage(primary, damage, unit, "lightning");
        for (const target of this.units) {
          if (target.side !== unit.side && !target.dead) {
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
    if (!["heal", "timewarp", "summon"].includes(unit.ability)) return;
    unit.abilityTimer -= delta;
    if (unit.abilityTimer > 0) return;
    if (unit.ability === "heal") {
      unit.abilityTimer = 3;
      this.emit("ability", { ability: "heal", side: unit.side, id: unit.id, time: this.time });
      for (const target of this.units) {
        if (target.side === unit.side && !target.dead && Math.abs(target.x - unit.x) <= 150 && target.hp < target.maxHp) {
          const before = target.hp;
          target.hp = Math.min(target.maxHp, target.hp + unit.abilityValue * (unit.atk / 15));
          if (unit.side === "cat") bump(this.telemetry.healingByCat, unit.id, target.hp - before);
        }
      }
      return;
    }
    if (unit.ability === "timewarp") {
      unit.abilityTimer = 10;
      this.emit("ability", { ability: "timewarp", side: unit.side, id: unit.id, time: this.time });
      for (const target of this.units) {
        if (target.side !== unit.side && !target.dead && Math.abs(target.x - unit.x) <= 500) {
          this.shove(target, unit.abilityValue, 30);
          this.control(target, 1.5, false);
        }
      }
      return;
    }
    unit.abilityTimer = unit.abilityValue;
    this.emit("ability", { ability: "summon", side: unit.side, id: unit.id, time: this.time });
    const groupMouse = this.mouseById.get("m7");
    if (groupMouse) {
      for (let index = 0; index < 3; index++) this.spawnMouse(groupMouse, unit.x + 10 + 12 * index);
    }
  }

  step() {
    if (this.result !== "playing") return false;
    this.tickCount++;
    this.time += STEP;
    this.money = Math.min(this.maxMoney, this.money + (25 + 8 * (this.walletLevel - 1)) * this.cashRate * STEP);
    this.cannonCharge = Math.min(30, this.cannonCharge + STEP);
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

    for (const unit of this.units) {
      unit.hurt = Math.max(0, (unit.hurt ?? 0) - 0.08);
      if (unit.dead > 0) {
        unit.dead -= STEP;
        continue;
      }
      if (unit.rageImmune > 0) unit.rageImmune = Math.max(0, unit.rageImmune - STEP);
      if (this.stage.modifier === "moon" && unit.side === "mouse" && unit.hp < unit.maxHp) {
        unit.hp = Math.min(unit.maxHp, unit.hp + 0.01 * unit.maxHp * STEP);
      }
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
      unit.cooldown -= STEP;
      this.tickAbility(unit, STEP);

      if (unit.windup > 0) {
        unit.windup -= STEP;
        if (unit.windup <= 0) {
          this.hit(unit);
          unit.cooldown = unit.interval;
        }
        continue;
      }

      const target = this.enemiesInFront(unit, unit.range)[0];
      const canHitBase = !target && this.baseDistance(unit) <= unit.range;
      if (target || canHitBase) {
        if (unit.cooldown <= 0) unit.windup = 0.28;
        continue;
      }

      const speed = unit.speed * (unit.slowed > 0 ? unit.slowFactor : 1) * (unit.dash > 0 ? 1.5 : 1);
      unit.x += (unit.side === "cat" ? -1 : 1) * speed * STEP;
      unit.x = Math.max(95, Math.min(905, unit.x));
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

  snapshot() {
    return {
      time: this.time,
      money: Math.floor(this.money),
      maxMoney: this.maxMoney,
      walletLevel: this.walletLevel,
      walletCost: this.walletCost,
      cannon: Math.min(this.cannonCharge / 30, 1),
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
