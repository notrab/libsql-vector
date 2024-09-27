import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client, createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import os from "os";

import { Index, Vector, IndexOptions } from "./";

describe("@libsql/vector", () => {
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

  describe("initialize", () => {
    it("should create table and index", async () => {
      const options: IndexOptions = {
        tableName: "test_table",
        dimensions: 3,
        columns: [
          { name: "title", type: "TEXT" },
          { name: "year", type: "INTEGER" },
        ],
      };

      const vectorIndex = new Index(client, options);
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

    it("should use the default table name when not specified", async () => {
      const optionsWithoutTableName: IndexOptions = {
        dimensions: 3,
        columns: [{ name: "test", type: "TEXT" }],
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

  describe("upsert", () => {
    it("should upsert a single vector correctly", async () => {
      const options: IndexOptions = {
        tableName: "test_table",
        dimensions: 3,
        columns: [
          { name: "title", type: "TEXT" },
          { name: "year", type: "INTEGER" },
        ],
      };

      const vectorIndex = new Index(client, options);
      await vectorIndex.initialize();

      const vector: Vector = {
        id: "1",
        vector: [0.1, 0.2, 0.3],
        title: "Test 1",
        year: 2021,
      };

      await vectorIndex.upsert(vector);

      const result = await client.execute("SELECT * FROM test_table");
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].id).toBe("1");
      expect(result.rows[0].title).toBe("Test 1");
      expect(result.rows[0].year).toBe(2021);
      expect(result.rows[0].embedding).not.toBeNull();
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
      };

      const vectorIndex = new Index(client, options);
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

      const result = await client.execute(`SELECT * FROM test_table`);

      expect(result.rows.length).toBe(3);

      vectors.forEach((vec, index) => {
        const row = result.rows[index];
        expect(row.id).toBe(vec.id);
        expect(row.title).toBe(vec.title);
        expect(row.year).toBe(vec.year);
        expect(row.plot_summary).toBe(vec.plot_summary);
        expect(row.genres).toBe(vec.genres);
        expect(row.embedding).not.toBeNull();
      });
    });
  });

  describe("query", () => {
    let vectorIndex: Index;

    beforeEach(async () => {
      const options: IndexOptions = {
        tableName: "test_table",
        dimensions: 3,
        columns: [
          { name: "title", type: "TEXT" },
          { name: "year", type: "INTEGER" },
        ],
      };

      vectorIndex = new Index(client, options);
      await vectorIndex.initialize();

      const vectors: Vector[] = [
        { id: "1", vector: [0.1, 0.2, 0.3], title: "Test 1", year: 2021 },
        { id: "2", vector: [0.4, 0.5, 0.6], title: "Test 2", year: 2022 },
        { id: "3", vector: [0.7, 0.8, 0.9], title: "Test 3", year: 2023 },
      ];

      await vectorIndex.upsert(vectors);
    });

    it("should query vectors correctly without a filter", async () => {
      const queryVector = [0.2, 0.3, 0.4];
      const result = await vectorIndex.query(queryVector, {
        topK: 3,
        includeVectors: true,
      });

      expect(result.length).toBe(3);
      expect(result.map((r) => r.id)).toEqual(
        expect.arrayContaining(["1", "2", "3"]),
      );
      result.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.vector).toHaveLength(3);
      });
    });

    it("should query vectors with a filter correctly", async () => {
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

    it("should return correct metadata and scores", async () => {
      const queryVector = [0.2, 0.3, 0.4];
      const result = await vectorIndex.query(queryVector, {
        topK: 3,
        includeVectors: true,
      });

      expect(result.length).toBe(3);
      result.forEach((r) => {
        expect(r.id).toBeDefined();
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.title).toBeDefined();
        expect(r.year).toBeDefined();
        expect(r.vector).toHaveLength(3);
      });
    });
  });

  describe("list", () => {
    let vectorIndex: Index;

    beforeEach(async () => {
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

      // Insert 25 test vectors
      const vectors: Vector[] = Array.from({ length: 25 }, (_, i) => ({
        id: `${i + 1}`,
        vector: [Math.random(), Math.random(), Math.random()],
        title: `Test ${i + 1}`,
        year: 2000 + i,
      }));

      await vectorIndex.upsert(vectors);
    });

    it("should list vectors with default options", async () => {
      const result = await vectorIndex.list();
      expect(result.items.length).toBe(10);
      expect(result.nextCursor).not.toBeNull();
      expect(result.items[0].metadata).toBeDefined();
      expect(result.items[0].vector).toBeUndefined();
    });

    it("should list vectors with custom limit", async () => {
      const result = await vectorIndex.list({ limit: 5 });
      expect(result.items.length).toBe(5);
      expect(result.nextCursor).not.toBeNull();
    });

    it("should list vectors with cursor", async () => {
      const firstPage = await vectorIndex.list({ limit: 5 });
      const secondPage = await vectorIndex.list({
        cursor: firstPage.nextCursor,
        limit: 5,
      });
      expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
      expect(secondPage.items.length).toBe(5);
    });

    it("should include vectors when requested", async () => {
      const result = await vectorIndex.list({ includeVectors: true });
      expect(result.items[0].vector).toBeDefined();
      expect(result.items[0].vector).toHaveLength(3);
    });

    it("should not include metadata when not requested", async () => {
      const result = await vectorIndex.list({ includeMetadata: false });
      expect(result.items[0].metadata).toBeUndefined();
    });

    it("should return null nextCursor on last page", async () => {
      const result = await vectorIndex.list({ limit: 30 }); // More than total items
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("retrieve", () => {
    let vectorIndex: Index;

    beforeEach(async () => {
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

      // Insert test vectors
      const vectors: Vector[] = [
        { id: "1", vector: [0.1, 0.2, 0.3], title: "Test 1", year: 2021 },
        { id: "2", vector: [0.4, 0.5, 0.6], title: "Test 2", year: 2022 },
        { id: "3", vector: [0.7, 0.8, 0.9], title: "Test 3", year: 2023 },
      ];

      await vectorIndex.upsert(vectors);
    });

    it("should retrieve a single vector by ID", async () => {
      const result = await vectorIndex.retrieve("2");
      expect(result).toHaveProperty("id", "2");
      expect(result).toHaveProperty("vector");
      expect(result).toHaveProperty("metadata");
      expect(result.metadata).toHaveProperty("title", "Test 2");
      expect(result.metadata).toHaveProperty("year", 2022);
    });

    it("should retrieve multiple vectors by IDs", async () => {
      const result = await vectorIndex.retrieve(["1", "3"]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("id", "1");
      expect(result[1]).toHaveProperty("id", "3");
    });

    it("should retrieve a vector without the embedding when specified", async () => {
      const result = await vectorIndex.retrieve("2", { includeVector: false });
      expect(result).not.toHaveProperty("vector");
      expect(result).toHaveProperty("metadata");
    });

    it("should retrieve a vector without metadata when specified", async () => {
      const result = await vectorIndex.retrieve("2", {
        includeMetadata: false,
      });
      expect(result).toHaveProperty("vector");
      expect(result).not.toHaveProperty("metadata");
    });

    it("should return undefined for non-existent IDs", async () => {
      const result = await vectorIndex.retrieve("999");
      expect(result).toBeUndefined();
    });

    it("should handle mixed existing and non-existent IDs", async () => {
      const result = await vectorIndex.retrieve(["1", "999", "3"]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("id", "1");
      expect(result[1]).toHaveProperty("id", "3");
    });

    it("should handle empty result set", async () => {
      // Clear the table
      await client.execute(`DELETE FROM ${vectorIndex.tableName}`);

      const result = await vectorIndex.list();
      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();

      // Test with various options to ensure they're handled correctly
      const resultWithOptions = await vectorIndex.list({
        limit: 5,
        includeVectors: true,
        includeMetadata: false,
      });
      expect(resultWithOptions.items).toEqual([]);
      expect(resultWithOptions.nextCursor).toBeNull();
    });
  });
});
