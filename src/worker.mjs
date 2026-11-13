import { parentPort, workerData } from "node:worker_threads";
import { simulate } from "./runner.mjs";

const { snapshot, scenario, seeds, stageId, stage, items, teamSlots, maxTime } = workerData;
const runs = [];
try {
  for (const seed of seeds) {
    runs.push(
      simulate({
        snapshot,
        team: scenario.team,
        policy: scenario.policy ?? {},
        stageId,
        stage,
        items,
        teamSlots,
        seed,
        maxTime,
      }),
    );
  }
  parentPort.postMessage({ runs });
} catch (error) {
  parentPort.postMessage({ error: error?.stack || String(error) });
}
