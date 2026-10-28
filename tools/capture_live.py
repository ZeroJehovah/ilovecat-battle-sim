#!/usr/bin/env python3
"""Capture the authenticated battle catalog and current endless stage.

The battle simulator never calls the game API itself. This helper only reads
the two public battle resources from an already-authenticated Camoufox tab and
writes a browser-independent JSON snapshot.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_BIDI_CLIENT = Path(
    "/home/coder/.codex/skills/camoufox-remote-control/scripts/bidi_client.py"
)
EXPRESSION = r"""(async () => {
  const uid = localStorage.getItem("uid");
  if (!uid) throw new Error("The selected tab has no logged-in uid");
  const headers = { "New-Api-User": uid };
  const load = async (path) => {
    const response = await fetch(path, { headers, credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw new Error(`${path}: HTTP ${response.status}: ${body.message || "request failed"}`);
    }
    return body.data;
  };
  const [catalog, endless] = await Promise.all([
    load("/api/cat/battle/catalog"),
    load("/api/cat/battle/endless"),
  ]);
  return {
    catalog,
    endlessStage: endless.stage,
    endlessMeta: {
      season: endless.season,
      ends: endless.ends,
    },
    pageUrl: location.href,
  };
})()"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture a read-only battle data snapshot from Camoufox"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "snapshot.json",
        help="Destination snapshot JSON",
    )
    parser.add_argument(
        "--bidi-client",
        type=Path,
        default=Path(os.environ.get("BIDI_CLIENT", DEFAULT_BIDI_CLIENT)),
    )
    parser.add_argument(
        "--host", default="api.ilovecat520.me", help="Tab URL substring to inspect"
    )
    parser.add_argument("--timeout", type=int, default=30)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.bidi_client.is_file():
        print(f"BiDi client not found: {args.bidi_client}", file=sys.stderr)
        return 2

    command = [
        sys.executable,
        str(args.bidi_client),
        "--timeout",
        str(args.timeout),
        "--host",
        args.host,
        "evaluate",
        EXPRESSION,
    ]
    completed = subprocess.run(
        command, check=False, capture_output=True, text=True, encoding="utf-8"
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip()
        print(f"Snapshot capture failed: {message}", file=sys.stderr)
        return completed.returncode

    try:
        live = json.loads(completed.stdout)
        catalog = live["catalog"]
        stage = live["endlessStage"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        print(f"Unexpected capture response: {error}", file=sys.stderr)
        return 1

    snapshot = {
        "schemaVersion": 1,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "source": live.get("pageUrl"),
        "catalog": catalog,
        "stage": stage,
        "endlessMeta": live.get("endlessMeta"),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + ".tmp")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(args.output)
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "capturedAt": snapshot["capturedAt"],
                "stageId": stage.get("id"),
                "cats": len(catalog.get("cats", [])),
                "mice": len(catalog.get("mice", [])),
                "waves": len(stage.get("waves", [])),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
