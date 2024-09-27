import { Client, ResultSet, Value, LibsqlError, InValue } from "@libsql/client";

export type ColumnDefinition = {
  name: string;
  type: string;
};

export interface Vector {
  id: string | number;
  vector: number[];
  [key: string]: Value | number[];
}

export interface QueryOptions {
  topK: number;
  includeVectors?: boolean;
  filter?: string;
}

export interface QueryResponse {
  id: string | number;
  score: number;
  vector?: number[];
  [key: string]: Value | number[] | undefined;
}

export interface IndexOptions {
  tableName?: string;
  dimensions: number;
  columns: ColumnDefinition[];
  debug?: boolean;
}

export interface ListOptions {
  cursor?: string;
  limit?: number;
  includeVectors?: boolean;
  includeMetadata?: boolean;
}

export interface ListResponse {
  items: ListItem[];
  nextCursor: string | null;
}

export interface ListItem {
  id: string | number;
  vector?: number[];
  metadata?: Record<string, Value>;
  [key: string]: Value | number[] | undefined | Record<string, Value>;
}

export interface RetrieveOptions {
  includeVector?: boolean;
  includeMetadata?: boolean;
}

export interface RetrieveResponse {
  id: string | number;
  vector?: number[];
  metadata?: Record<string, Value>;
  [key: string]: Value | number[] | undefined | Record<string, Value>;
}

export class Index {
  private client: Client;
  private tableName: string;
  private dimensions: number;
  private columns: ColumnDefinition[];
  private debug: boolean;

  constructor(client: Client, options: IndexOptions) {
    this.client = client;
    this.tableName = options.tableName || "vector_index";
    this.dimensions = options.dimensions;
    this.columns = options.columns;
    this.debug = options.debug || false;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  async initialize(): Promise<void> {
    await this.createTable();
    await this.createIndex();
  }

  async upsert(vectors: Vector | Vector[]): Promise<string> {
    const vectorArray = Array.isArray(vectors) ? vectors : [vectors];

    const columnNames = [
      "id",
      "embedding",
      ...this.columns.map((col) => col.name),
    ];

    for (const vec of vectorArray) {
      const values = [
        `'${vec.id.toString().replace(/'/g, "''")}'`,
        // `vector32(x'${Buffer.from(new Float32Array(vec.vector).buffer).toString("hex")}')`,
        `vector32('[${vec.vector.join(", ")}]')`,
        ...this.columns.map((col) => {
          const value = vec[col.name];
          return typeof value === "string"
            ? `'${value.replace(/'/g, "''")}'`
            : value;
        }),
      ];

      const sql = `
        INSERT OR REPLACE INTO ${this.tableName} (${columnNames.join(", ")})
        VALUES (${values.join(", ")})
      `;

      this.log("Upsert SQL:", sql);

      await this.client.execute(sql);
    }

    return "Success";
  }

  async query(
    queryVector: number[],
    options: QueryOptions,
  ): Promise<QueryResponse[]> {
    const { topK, includeVectors = false, filter = "" } = options;

    const selectClauses = [
      `${this.tableName}.id`,
      `1 - vector_distance_cos(embedding, vector32('[${queryVector.join(", ")}]')) as similarity`,
      ...this.columns.map((col) => col.name),
    ];

    if (includeVectors)
      selectClauses.push("vector_extract(embedding) as vector");

    const sql = `
        SELECT ${selectClauses.join(", ")}
        FROM ${this.tableName}
        ${filter ? `WHERE ${filter}` : ""}
        ORDER BY similarity DESC
        LIMIT ?
      `;

    this.log("Query SQL:", sql);

    const result: ResultSet = await this.client.execute({ sql, args: [topK] });

    this.log("Query result:", result.rows);

    return result.rows.map((row) => {
      const response: QueryResponse = {
        id: this.ensureIdType(row.id),
        score: this.ensureNumber(row.similarity),
      };

      if (includeVectors) {
        response.vector = this.parseVector(row.vector);
      }

      this.columns.forEach((col) => {
        response[col.name] = row[col.name];
      });

      return response;
    });
  }

  async list(options: ListOptions = {}): Promise<ListResponse> {
    const {
      cursor,
      limit = 10,
      includeVectors = false,
      includeMetadata = true,
    } = options;

    const selectClauses = [`${this.tableName}.id`];

    if (includeVectors) {
      selectClauses.push(`vector_extract(embedding) as vector`);
    }

    if (includeMetadata) {
      this.columns.forEach((col) => selectClauses.push(col.name));
    }

    let sql = `SELECT ${selectClauses.join(", ")} FROM ${this.tableName}`;
    const args: any[] = [];

    if (cursor) {
      sql += ` WHERE id > ?`;
      args.push(cursor);
    }

    sql += ` ORDER BY id LIMIT ?`;
    args.push(limit + 1); // Fetch one extra to determine if there's a next page

    this.log("List SQL:", sql);
    this.log("List args:", args);

    const result = await this.client.execute({ sql, args });

    if (!result || !result.rows || result.rows.length === 0) {
      return { items: [], nextCursor: null };
    }

    const items: ListItem[] = result.rows.slice(0, limit).map((row) => {
      const item: ListItem = { id: this.ensureIdType(row.id) };

      if (includeVectors && row.vector) {
        item.vector = this.parseVector(row.vector);
      }

      if (includeMetadata) {
        item.metadata = {};
        this.columns.forEach((col) => {
          item.metadata![col.name] = row[col.name];
        });
      }

      return item;
    });

    let nextCursor: string | null = null;

    if (result.rows.length > limit) {
      const lastItem = result.rows[limit - 1];

      if (lastItem && lastItem.id != null) {
        nextCursor = lastItem.id.toString();
      }
    }

    return { items, nextCursor };
  }

  async retrieve(
    ids: string | number | (string | number)[],
    options: RetrieveOptions = {},
  ): Promise<RetrieveResponse | RetrieveResponse[]> {
    const { includeVector = true, includeMetadata = true } = options;
    const idsArray = Array.isArray(ids) ? ids : [ids];

    const selectClauses = [`${this.tableName}.id`];
    if (includeVector) {
      selectClauses.push(`vector_extract(embedding) as vector`);
    }
    if (includeMetadata) {
      this.columns.forEach((col) => selectClauses.push(col.name));
    }

    const sql = `
      SELECT ${selectClauses.join(", ")}
      FROM ${this.tableName}
      WHERE id IN (${idsArray.map(() => "?").join(", ")})
    `;

    this.log("Retrieve SQL:", sql);
    this.log("Retrieve args:", idsArray);

    const result = await this.client.execute({ sql, args: idsArray });

    const items: RetrieveResponse[] = result.rows.map((row) => {
      const item: RetrieveResponse = { id: this.ensureIdType(row.id) };
      if (includeVector && row.vector) {
        item.vector = this.parseVector(row.vector);
      }
      if (includeMetadata) {
        item.metadata = {};
        this.columns.forEach((col) => {
          item.metadata![col.name] = row[col.name];
        });
      }
      return item;
    });

    return Array.isArray(ids) ? items : items[0];
  }

  private async createTable(): Promise<void> {
    const columnDefinitions = this.columns
      .map((col) => `${col.name} ${col.type}`)
      .join(", ");

    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding F32_BLOB(${this.dimensions}),
        ${columnDefinitions}
      )
    `;

    this.log("Create table SQL:", sql);

    await this.client.execute(sql);
  }

  private async createIndex(): Promise<void> {
    const sql = `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_embedding ON ${this.tableName}(libsql_vector_idx(embedding))`;

    this.log("Create index SQL:", sql);

    await this.client.execute(sql);
  }

  private ensureIdType(value: Value): string | number {
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    throw new Error(`Invalid id type: ${typeof value}`);
  }

  private ensureNumber(value: Value): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      return parseFloat(value);
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    throw new Error(`Invalid score type: ${typeof value}`);
  }

  private parseVector(value: Value): number[] | undefined {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (e) {
        throw new Error(`Failed to parse vector: ${e}`);
      }
    }
    if (value instanceof ArrayBuffer) {
      // Make this configurable? Float32Array
      return Array.from(new Float32Array(value));
    }
    if (value === null) {
      return undefined;
    }
    throw new Error(`Invalid vector type: ${typeof value}`);
  }
}

export { LibsqlError };
