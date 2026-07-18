import type { Config } from "@netlify/functions";
import { runGinseOperation } from "../../src/ginse-adapter.js";

export default runGinseOperation;

export const config: Config = { path: "/run", method: ["POST"] };
