import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client, createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import os from "os";

import { Index, Vector, IndexOptions } from "./";

describe("@libsql/vector", () => {
  let vectorIndex: Index;
  let client: Client;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test_db_${Date.now()}_${Math.random().toString(36).substring(7)}.sqlite`,
    );
    client = createClient({ url: `file:${dbPath}` });
  });

  afterEach(() => {
    client.close();
    fs.unlinkSync(dbPath);
  });

  it("should create table and index", async () => {
    const options: IndexOptions = {
      tableName: "test_table",
      dimensions: 3,
      columns: [
        { name: "title", type: "TEXT" },
        { name: "year", type: "INTEGER" },
      ],
      debug: true,
    };

    vectorIndex = new Index(client, options);
    await vectorIndex.initialize();

    await vectorIndex.initialize();

    const tableResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'",
    );
    expect(tableResult.rows.length).toBe(1);

    const indexResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_test_table_embedding'",
    );
    expect(indexResult.rows.length).toBe(1);
  });

  it("should upsert vectors and query them correctly without a filter", async () => {
    const options: IndexOptions = {
      tableName: "test_table",
      dimensions: 3,
      columns: [
        { name: "title", type: "TEXT" },
        { name: "year", type: "INTEGER" },
      ],
      debug: true,
    };

    vectorIndex = new Index(client, options);
    await vectorIndex.initialize();

    const vectors: Vector[] = [
      { id: "1", vector: [0.1, 0.2, 0.3], title: "Test 1", year: 2021 },
      { id: "2", vector: [0.4, 0.5, 0.6], title: "Test 2", year: 2022 },
      { id: "3", vector: [0.7, 0.8, 0.9], title: "Test 3", year: 2023 },
    ];

    await vectorIndex.upsert(vectors);

    const queryVector = [0.2, 0.3, 0.4];
    const result = await vectorIndex.query(queryVector, {
      topK: 3,
      includeVectors: true,
    });

    expect(result.length).toBe(3);

    const resultIds = result.map((r) => r.id);
    expect(resultIds).toContain("1");
    expect(resultIds).toContain("2");
    expect(resultIds).toContain("3");

    // Check if vectors are correctly associated with their metadata
    result.forEach((r) => {
      const originalVector = vectors.find((v) => v.id === r.id);
      expect(r.title).toBe(originalVector?.title);
      expect(r.year).toBe(originalVector?.year);
      expect(r.vector).toEqual(originalVector?.vector);
    });

    // Check if scores are present and within expected range
    result.forEach((r) => {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    });
  });

  it("should upsert multiple vectors at once", async () => {
    const options: IndexOptions = {
      tableName: "test_table",
      dimensions: 3,
      columns: [
        { name: "title", type: "TEXT" },
        { name: "year", type: "INTEGER" },
        { name: "plot_summary", type: "TEXT" },
        { name: "genres", type: "TEXT" },
      ],
      debug: true,
    };

    vectorIndex = new Index(client, options);
    await vectorIndex.initialize();

    const vectors: Vector[] = [
      {
        id: "1",
        vector: [0.1, 0.2, 0.3],
        title: "Test 1",
        year: 2021,
        plot_summary: "This is a test movie 1",
        genres: "Action,Drama",
      },
      {
        id: "2",
        vector: [0.4, 0.5, 0.6],
        title: "Test 2",
        year: 2022,
        plot_summary: "This is a test movie 2",
        genres: "Comedy,Romance",
      },
      {
        id: "3",
        vector: [0.7, 0.8, 0.9],
        title: "Test 3",
        year: 2023,
        plot_summary: "This is a test movie 3",
        genres: "Sci-Fi,Thriller",
      },
    ];

    await vectorIndex.upsert(vectors);

    // Query to verify all vectors were inserted
    const result = await client.execute(`SELECT * FROM test_table`);

    expect(result.rows.length).toBe(3);

    // Verify each vector's data
    vectors.forEach((vec, index) => {
      const row = result.rows[index];
      expect(row.id).toBe(vec.id);
      expect(row.title).toBe(vec.title);
      expect(row.year).toBe(vec.year);
      expect(row.plot_summary).toBe(vec.plot_summary);
      expect(row.genres).toBe(vec.genres);
      // Note: We can't directly compare the embedding as it's stored as a binary blob
      // But we can check if it's not null
      expect(row.embedding).not.toBeNull();
    });

    // Test querying to ensure vectors are searchable
    const queryVector = [0.2, 0.3, 0.4];
    const queryResult = await vectorIndex.query(queryVector, { topK: 3 });

    expect(queryResult.length).toBe(3);
    expect(queryResult.map((r) => r.id)).toEqual(
      expect.arrayContaining(["1", "2", "3"]),
    );
  });

  it("should query vectors with a filter correctly", async () => {
    const options: IndexOptions = {
      tableName: "test_table_filter",
      dimensions: 3,
      columns: [
        { name: "title", type: "TEXT" },
        { name: "year", type: "INTEGER" },
      ],
      debug: true,
    };

    const vectorIndex = new Index(client, options);
    await vectorIndex.initialize();

    const vectors: Vector[] = [
      { id: "1", vector: [0.1, 0.2, 0.3], title: "Test 1", year: 2021 },
      { id: "2", vector: [0.4, 0.5, 0.6], title: "Test 2", year: 2022 },
      { id: "3", vector: [0.7, 0.8, 0.9], title: "Test 3", year: 2023 },
    ];

    await vectorIndex.upsert(vectors);

    const queryVector = [0.2, 0.3, 0.4];
    const result = await vectorIndex.query(queryVector, {
      topK: 2,
      filter: "year > 2021",
    });

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("2");
    expect(result[0].year).toBe(2022);
    expect(result[1].id).toBe("3");
    expect(result[1].year).toBe(2023);
  });

  it("should use the default table name when not specified", async () => {
    const optionsWithoutTableName: IndexOptions = {
      dimensions: 3,
      columns: [{ name: "test", type: "TEXT" }],
      debug: true,
    };

    const indexWithDefaultTable = new Index(client, optionsWithoutTableName);
    await indexWithDefaultTable.initialize();

    const sql =
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vector_index'";
    const result = await client.execute(sql);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe("vector_index");
  });
});
