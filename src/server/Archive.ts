import { GameID, ID } from "@openfront/engine-api/Schemas";
import { replacer } from "@openfront/shared/SharedUtil";
import {
  GameRecord,
  GameRecordSchema,
  PartialGameRecord,
} from "@openfront/shared/WireSchemas";
import { promises as fs } from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import z from "zod";
import { registeredSite } from "./ClusterCheckin";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "Archive" });

export async function archive(gameRecord: GameRecord) {
  try {
    const parsed = GameRecordSchema.safeParse(gameRecord);
    if (!parsed.success) {
      log.error(`invalid game record: ${z.prettifyError(parsed.error)}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
    if (ServerEnv.standalone()) {
      await archiveLocally(gameRecord);
      return;
    }
    const url = `${ServerEnv.jwtIssuer()}/game/${gameRecord.info.gameID}`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(gameRecord, replacer),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (!response.ok) {
      log.error(`error archiving game record: ${response.statusText}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
  } catch (error) {
    log.error(`error archiving game record: ${error}`, {
      gameID: gameRecord.info.gameID,
    });
    return;
  }
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    if (!ID.safeParse(gameId).success) {
      log.error(`invalid game ID: ${gameId}`);
      return null;
    }
    if (ServerEnv.standalone()) return readLocalGameRecord(gameId);
    const url = `${ServerEnv.jwtIssuer()}/game/${gameId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    const record = await response.json();
    if (!response.ok) {
      log.error(`error reading game record: ${response.statusText}`, {
        gameID: gameId,
      });
      return null;
    }
    return GameRecordSchema.parse(record);
  } catch (error) {
    log.error(`error reading game record: ${error}`, {
      gameID: gameId,
    });
    return null;
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: ServerEnv.gitCommit(),
    subdomain: ServerEnv.subdomain(),
    domain: ServerEnv.domain(),
    site: registeredSite(),
  };
}

// ---- GalloFront standalone archive: <ARCHIVE_DIR>/<gameID>.json.gz ----
function archivePath(gameId: string): string {
  return path.join(ServerEnv.archiveDir(), `${gameId}.json.gz`);
}

async function archiveLocally(gameRecord: GameRecord): Promise<void> {
  const dir = ServerEnv.archiveDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = archivePath(gameRecord.info.gameID) + ".tmp";
  await fs.writeFile(tmp, gzipSync(JSON.stringify(gameRecord, replacer)));
  await fs.rename(tmp, archivePath(gameRecord.info.gameID));
  log.info(`archived game locally`, { gameID: gameRecord.info.gameID });
}

export async function readLocalGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  if (!ID.safeParse(gameId).success) return null;
  try {
    const buf = await fs.readFile(archivePath(gameId));
    return GameRecordSchema.parse(JSON.parse(gunzipSync(buf).toString("utf8")));
  } catch {
    return null;
  }
}
