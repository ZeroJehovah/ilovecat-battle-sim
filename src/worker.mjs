import { parentPort, workerData } from "node:worker_threads";
import { simulate } from "./runner.mjs";

const { snapshot, scenario, seeds, stageId, items, maxTime } = workerData;
const runs = [];
try {
  for (const seed of seeds) {
    runs.push(
      simulate({
        snapshot,
        team: scenario.team,
        policy: scenario.policy ?? {},
        stageId,
        items,
        seed,
        maxTime,
      }),
    );
  }
  parentPort.postMessage({ runs });
} catch (error) {
  parentPort.postMessage({ error: error?.stack || String(error) });
}
