# @libsql/vector

```bash
npm install @libsql/vector # doesn't yet exist
```

```ts
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
```
