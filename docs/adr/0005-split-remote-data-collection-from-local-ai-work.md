# Split remote data collection from local AI work

To keep public schedules and provider callbacks always available while using locally operated, subscription-billed AI tooling, we chose a split-brain runtime: Vercel ingests into production Neon, and local evidence mode works against that same evidence with Codex, Claude, or Ollama providers. Hosted execution retains OpenAI outside local evidence mode, so reliable remote collection and local AI experimentation can evolve independently without copying the evidence store.
