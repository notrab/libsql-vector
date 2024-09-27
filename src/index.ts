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
        `'${vec.id}'`,
        `vector32('[${vec.vector.join(", ")}]')`,
        ...this.columns.map((col) => {
          const value = vec[col.name];
          return typeof value === "string" ? `'${value}'` : value;
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
        LIMIT ${topK}
      `;

    this.log("Query SQL:", sql);

    const result: ResultSet = await this.client.execute(sql);

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

  // async upsert(vectors: Vector | Vector[]): Promise<string> {
  //   const vectorArray = Array.isArray(vectors) ? vectors : [vectors];
  //   const columnNames = [
  //     "id",
  //     "embedding",
  //     ...this.columns.map((col) => col.name),
  //   ];
  //   const placeholders = columnNames.map(() => "?").join(", ");
  //   const sql = `
  //     INSERT OR REPLACE INTO ${this.tableName} (${columnNames.join(", ")})
  //     VALUES (${placeholders})
  //   `;

  //   const batch: InStatement[] = vectorArray.map((vec) => ({
  //     sql,
  //     args: [
  //       vec.id,
  //       `[${vec.vector.join(", ")}]`,
  //       ...this.columns.map((col) => this.ensureInValue(vec[col.name])),
  //     ],
  //   }));

  //   await this.client.batch(batch);
  //   return "Success";
  // }

  // async query(
  //   queryVector: number[],
  //   options: QueryOptions,
  // ): Promise<QueryResponse[]> {
  //   const { topK, includeVectors = false, filter = "" } = options;

  //   const whereClause = filter ? `WHERE ${filter}` : "";

  //   const selectClauses = [
  //     `${this.tableName}.id`,
  //     `vector_distance_cos(embedding, vector32(?)) as score`,
  //     ...this.columns.map((col) => col.name),
  //   ];

  //   if (includeVectors)
  //     selectClauses.push("vector_extract(embedding) as vector");

  //   const sql = `
  //       SELECT ${selectClauses.join(", ")}
  //       FROM vector_top_k('idx_${this.tableName}_embedding', vector32(?), ?) AS top_k
  //       JOIN ${this.tableName} ON ${this.tableName}.rowid = top_k.id
  //       ${whereClause}
  //       ORDER BY score ASC
  //       LIMIT ?
  //     `;

  //   const vectorString = `[${queryVector.join(", ")}]`;

  //   const result: ResultSet = await this.client.execute({
  //     sql,
  //     args: [vectorString, vectorString, topK, topK],
  //   });

  //   return result.rows.map((row) => {
  //     const response: QueryResponse = {
  //       id: this.ensureIdType(row.id),
  //       score: this.ensureNumber(row.score),
  //     };

  //     if (includeVectors) {
  //       response.vector = this.parseVector(row.vector);
  //     }

  //     this.columns.forEach((col) => {
  //       response[col.name] = row[col.name];
  //     });

  //     return response;
  //   });
  // }

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

  private ensureInValue(value: Value | number[]): InValue {
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }

    return value as InValue;
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
