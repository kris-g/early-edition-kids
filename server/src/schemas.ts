/**
 * JSON schemas for structured outputs (Anthropic `output_config.format`). They make replies
 * schema-valid; lengths, numbers and the blocklist are still checked by validate.ts afterwards.
 */

const pick = (topics: string[]) => ({
  type: "object",
  properties: {
    candidate_id: { type: "integer" },
    topic: { type: "string", enum: topics },
  },
  required: ["candidate_id", "topic"],
  additionalProperties: false,
});

export function selectSchema(topics: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      picks: { type: "array", items: pick(topics) },
      reserves: { type: "array", items: pick(topics) },
    },
    required: ["picks", "reserves"],
    additionalProperties: false,
  };
}

export function rewriteSchema(topics: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      teaser: { type: "string" },
      topic: { type: "string", enum: topics },
      body: { type: "array", items: { type: "string" } },
      word_to_know: {
        anyOf: [
          {
            type: "object",
            properties: { word: { type: "string" }, definition: { type: "string" } },
            required: ["word", "definition"],
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
      think_about_it: { type: "string" },
      source_name: { type: "string" },
      source_url: { type: "string" },
    },
    required: ["title", "teaser", "topic", "body", "word_to_know", "think_about_it", "source_name", "source_url"],
    additionalProperties: false,
  };
}

export const CHECK_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    safe: { type: "boolean" },
    supported: { type: "boolean" },
    reasons: { type: "array", items: { type: "string" } },
  },
  required: ["safe", "supported", "reasons"],
  additionalProperties: false,
};
