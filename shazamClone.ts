import { getSamplesArr, getHash } from "./hashing";
import * as sqlite3 from "sqlite3";
import fs from "fs";

sqlite3.verbose();

interface Hash {
  hashTag: number[];
  time: number;
  song: string;
}

function isHash(obj: any): obj is Hash {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.hashTag) &&
    typeof obj.time === "number" &&
    typeof obj.song === "string"
  );
}

const DB_FILE = "fingerprint.db";
const HOP_SIZE = 159_840;

async function main() {
  // 1) Load your samples
  const arr = await getSamplesArr();

  // 2) Demultiplex left channel (stereo → mono)
  const samplesL: number[] = [];
  for (let i = 0; i < arr.samples.length; i += 2) {
    samplesL.push(arr.samples[i]);
  }
  // 3) Open & set up SQLite
  const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
      console.error("Failed to open DB:", err.message);
      process.exit(1);
    }
  });

  db.serialize(() => {
    // Begin transaction
    db.run("BEGIN TRANSACTION;");

    // Prepare INSERT once
    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO subfingerprints (hash, song_id, offset) VALUES (?, ?, ?);`,
    );

    // 4) Frame‐by‐frame hashing and insertion
    for (let i = 0; i + HOP_SIZE <= samplesL.length; i += HOP_SIZE) {
      const frame = samplesL.slice(i, i + HOP_SIZE);
      const frameHash = getHash(frame, arr.sampleRate);

      if (!isHash(frameHash)) continue;

      console.log("frame" + i + "inserting");
      // Each hashTag entry gets its own row
      frameHash.hashTag.forEach((hashValue, idx) => {
        // compute your offset (seconds or whatever unit your spec uses)
        const offset = ((idx + 1) * frameHash.time) / 32;
        insertStmt.run(hashValue, 1, offset, (err: Error) => {
          if (err) console.error("Insert error:", err.message);
        });
      });
    }

    // Finalize statement and commit
    insertStmt.finalize((err) => {
      if (err) console.error("Finalize error:", err.message);
      db.run("COMMIT;", (commitErr) => {
        if (commitErr) console.error("Commit error:", commitErr.message);
        else console.log("All hashes inserted and transaction committed.");
        // Close DB
        db.close((closeErr) => {
          if (closeErr) console.error("Close error:", closeErr.message);
        });
      });
    });
  });
}

// Kick off
main().catch((err) => console.error("Fatal error:", err));
