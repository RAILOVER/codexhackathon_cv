import type { Config } from "@netlify/functions";
import { getDiagnostic } from "../../src/ginse-adapter.js";

export default getDiagnostic;

export const config: Config = { path: "/api/ginse-diagnostic", method: ["GET"] };
