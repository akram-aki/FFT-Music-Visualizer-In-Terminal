const sqlite3 = require("sqlite3").verbose();

// Create or open a database file
const db = new sqlite3.Database("fingerprint.db");

db.serialize(() => {
  // Enable foreign keys (recommended)
  db.run(`PRAGMA foreign_keys = ON;`, (err) => {
    if (err) console.error("PRAGMA error:", err.message);
  });

  db.run(`CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    artist TEXT,
    album TEXT
  );`, (err) => {
    if (err) console.error("songs table error:", err.message);
    else console.log("songs table created or already exists.");
  });

  db.run(`CREATE TABLE IF NOT EXISTS subfingerprints (
    hash INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    offset INTEGER NOT NULL,
    PRIMARY KEY (hash, song_id, offset),
    FOREIGN KEY(song_id) REFERENCES songs(id)
  );`, (err) => {
    if (err) console.error("subfingerprints table error:", err.message);
    else console.log("subfingerprints table created or already exists.");
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_subfingerprints_hash ON subfingerprints(hash);`, (err) => {
    if (err) console.error("index error:", err.message);
    else console.log("index created or already exists.");
  });
});

db.close();
