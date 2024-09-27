# @libsql/vector

Vector similarity search for libSQL and Turso.

```bash
npm install @libsql/vector # doesn't yet exist
```

## Usage

### Initializing the Index

```typescript
import { createClient } from "@libsql/client";
import { Index } from "@libsql/vector";

const client = createClient({ url: "file:vector.db" });
const vectorIndex = new Index(client, {
  tableName: "my_vectors", // optional, defaults to 'vector_index'
  dimensions: 384,
  columns: [
    { name: "title", type: "TEXT" },
    { name: "timestamp", type: "INTEGER" },
  ],
  debug: process.env.NODE_ENV !== "production", // optional, defaults to false
});

// Initialize the index (creates table and index if they don't exist)
await vectorIndex.initialize();
```

### Upserting Vectors

```typescript
const vectors = [
  {
    id: "1",
    vector: [0.1, 0.2, 0.3 /* ... up to 384 dimensions */],
    title: "Example Document 1",
    timestamp: Date.now(),
  },
  {
    id: "2",
    vector: [0.4, 0.5, 0.6 /* ... up to 384 dimensions */],
    title: "Example Document 2",
    timestamp: Date.now(),
  },
];

await vectorIndex.upsert(vectors);
```

### Querying Vectors

```typescript
const queryVector = [0.2, 0.3, 0.4 /* ... up to 384 dimensions */];

// Basic query
const results = await vectorIndex.query(queryVector, { topK: 5 });

console.log(results);
// [
//   { id: '1', score: 0.95, title: 'Example Document 1', timestamp: 1631234567890 },
//   { id: '2', score: 0.82, title: 'Example Document 2', timestamp: 1631234567891 },
//   ...
// ]

// Query with filter
const filteredResults = await vectorIndex.query(queryVector, {
  topK: 5,
  filter: "timestamp > 1630000000000",
});

// Query including vector data
const resultsWithVectors = await vectorIndex.query(queryVector, {
  topK: 5,
  includeVectors: true,
});

console.log(resultsWithVectors);
// [
//   {
//     id: '1',
//     score: 0.95,
//     title: 'Example Document 1',
//     timestamp: 1631234567890,
//     vector: [0.1, 0.2, 0.3, ...]
//   },
//   ...
// ]
```

### Listing Vectors

```typescript
// List vectors with default options
const result = await vectorIndex.list();

console.log(result);
// {
//   items: [
//     { id: '1', metadata: { title: 'Example Document 1', timestamp: 1631234567890 } },
//     { id: '2', metadata: { title: 'Example Document 2', timestamp: 1631234567891 } },
//     ...
//   ],
//   nextCursor: '10'
// }

// List vectors with custom options
const customResult = await vectorIndex.list({
  cursor: "10",
  limit: 5,
  includeVectors: true,
  includeMetadata: false,
});

console.log(customResult);
// {
//   items: [
//     { id: '11', vector: [0.1, 0.2, 0.3, ...] },
//     { id: '12', vector: [0.4, 0.5, 0.6, ...] },
//     ...
//   ],
//   nextCursor: '15'
// }
```

### Retrieving Vectors

```typescript
// Retrieve a single vector
const vector = await vectorIndex.retrieve("1");

console.log(vector);
// {
//   id: '1',
//   vector: [0.1, 0.2, 0.3, ...],
//   metadata: { title: 'Example Document 1', timestamp: 1631234567890 }
// }

// Retrieve multiple vectors
const vectors = await vectorIndex.retrieve(["1", "2"]);

console.log(vectors);
// [
//   {
//     id: '1',
//     vector: [0.1, 0.2, 0.3, ...],
//     metadata: { title: 'Example Document 1', timestamp: 1631234567890 }
//   },
//   {
//     id: '2',
//     vector: [0.4, 0.5, 0.6, ...],
//     metadata: { title: 'Example Document 2', timestamp: 1631234567891 }
//   }
// ]

// Retrieve without vector or metadata
const vectorWithoutDetails = await vectorIndex.retrieve("1", {
  includeVector: false,
  includeMetadata: false,
});

console.log(vectorWithoutDetails);
// { id: '1' }
```

## API Reference

### `new Index(client, options)`

Creates a new vector index.

- `client`: A libSQL client instance
- `options`: Configuration options
  - `tableName`: Name of the table to store vectors (default: `vector_index`)
  - `dimensions`: Number of dimensions in your vectors
  - `columns`: Additional columns to store with each vector
  - `debug`: Enable debug logging (default: `false`)

### `index.initialize()`

Initializes the index, creating the necessary table and index if they don't exist.

### `index.upsert(vectors)`

Inserts or updates vectors in the index.

- `vectors`: An array of vector objects, each containing:
  - `id`: Unique identifier for the vector
  - `vector`: Array of numbers representing the vector
  - Additional properties corresponding to the columns defined in the index options

### `index.query(queryVector, options)`

Performs a similarity search.

- `queryVector`: Array of numbers representing the query vector
- `options`:
  - `topK`: Number of results to return
  - `filter`: SQL WHERE clause to filter results (optional)
  - `includeVectors`: Whether to include vector data in the results (default: `false`)

Returns an array of results, each containing the vector's id, similarity score, and additional columns.

### `index.list(options)`

Lists vectors in the index with pagination.

- `options`:
  - `cursor`: Pagination cursor (optional)
  - `limit`: Number of items to return (default: 10)
  - `includeVectors`: Whether to include vector data in the results (default: false)
  - `includeMetadata`: Whether to include metadata in the results (default: true)

Returns an object with `items` array and `nextCursor` for pagination.

### `index.retrieve(ids, options)`

Retrieves one or more vectors by their IDs.

- `ids`: A single ID or an array of IDs
- `options`:
  - `includeVector`: Whether to include vector data in the results (default: true)
  - `includeMetadata`: Whether to include metadata in the results (default: true)

Returns a single vector object or an array of vector objects.

## License

[MIT](https://choosealicense.com/licenses/mit/)
