import { MEMORY_CATALOG } from "@/lib/memory/catalog";
import type { MemorySnippet } from "@/lib/types";

export function retrieveMemory(prompt: string, limit = 4): MemorySnippet[] {
  const terms = tokenize(prompt);
  const scored = MEMORY_CATALOG.map((record) => {
    const haystack = [
      record.title,
      record.body,
      record.path ?? "",
      record.owner ?? "",
      ...record.terms,
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (record.terms.some((t) => t.toLowerCase() === term)) score += 2.4;
      else if (haystack.includes(term)) score += 1;
    }
    if (record.path && prompt.includes(record.path)) score += 3;
    return { record, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const snippets = scored.map(({ record, score }) => ({
    id: record.id,
    kind: record.kind,
    title: record.title,
    body: record.body,
    path: record.path,
    owner: record.owner,
    score: Math.round(score * 10) / 10,
  }));

  if (snippets.length > 0) return snippets;
  return MEMORY_CATALOG.slice(0, 2).map((record) => ({
    id: record.id,
    kind: record.kind,
    title: record.title,
    body: record.body,
    path: record.path,
    owner: record.owner,
    score: 0.2,
  }));
}

function tokenize(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .filter((t) => t.length > 2);
}
