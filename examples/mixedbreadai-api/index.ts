import { createClient } from "@libsql/client";
import { MixedbreadAIClient } from "@mixedbread-ai/sdk";

import { Index, IndexOptions, Vector } from "../../src";

const client = createClient({
  url: "file:./movies.db",
});

const indexOptions: IndexOptions = {
  tableName: "movies",
  dimensions: 1024,
  columns: [
    { name: "title", type: "TEXT" },
    { name: "year", type: "INTEGER" },
    { name: "plot_summary", type: "TEXT" },
    { name: "genres", type: "TEXT" },
  ],
  debug: true,
};

const movieIndex = new Index(client, indexOptions);

const mxbai = new MixedbreadAIClient({
  apiKey: "...",
});

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await mxbai.embeddings({
    model: "mixedbread-ai/mxbai-embed-large-v1",
    input: [text],
    normalized: true,
    encodingFormat: "float",
    truncationStrategy: "end",
  });

  return res.data[0].embedding;
}

async function addMovie(
  title: string,
  year: number,
  plotSummary: string,
  genres: string[],
) {
  const textForEmbedding = `${title} ${plotSummary} ${genres.join(" ")}`;
  const embedding = await generateEmbedding(textForEmbedding);

  const movie: Vector = {
    id: `${title}_${year}`,
    vector: embedding,
    title,
    year,
    plot_summary: plotSummary,
    genres: genres.join(","),
  };

  await movieIndex.upsert(movie);
  console.log(`Added movie: ${title}`);
}

async function getMovieRecommendations(query: string, topK: number = 5) {
  const queryEmbedding = await generateEmbedding(query);
  const results = await movieIndex.query(queryEmbedding, { topK });

  console.log(`Recommendations for query: "${query}"`);
  results.forEach((result, index) => {
    console.log(
      `${index + 1}. ${result.title} (${result.year}) - Similarity: ${
        result.score
      }`,
    );
  });
}

async function main() {
  await movieIndex.initialize();

  await addMovie(
    "The Terminator",
    1984,
    "A human soldier is sent from 2029 to 1984 to stop an almost indestructible cyborg killing machine, sent from the same year, which has been programmed to execute a young woman whose unborn son is the key to humanity's future salvation.",
    ["Action", "Sci-Fi"],
  );

  await addMovie(
    "Wall-E",
    2008,
    "In a distant, but not so unrealistic, future where mankind has abandoned earth because it has become covered with trash from products sold by the powerful multi-national Buy N Large corporation, WALL-E, a garbage collecting robot has been left to clean up the mess.",
    ["Animation", "Adventure", "Sci-Fi"],
  );

  await addMovie(
    "Inception",
    2010,
    "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a CEO.",
    ["Action", "Adventure", "Sci-Fi"],
  );

  await getMovieRecommendations(
    "I'm in the mood for a sci-fi action movie with robots",
  );
}

main().catch(console.error);
