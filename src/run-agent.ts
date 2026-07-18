import { readFile } from "node:fs/promises";
import { runCandidateSourcingAgent, type CandidateAgentInput } from "./agent.js";

const inputPath = process.argv[2] ?? "data/agent-input.example.json";

try {
  const input = JSON.parse(await readFile(inputPath, "utf8")) as CandidateAgentInput;
  const output = await runCandidateSourcingAgent(input);
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Agent impossible à exécuter.");
  process.exitCode = 1;
}
