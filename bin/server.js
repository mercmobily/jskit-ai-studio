import { startServer } from "../server.js";

try {
  await startServer();
} catch (error) {
  console.error("Failed to start AI Studio server:", error);
  process.exitCode = 1;
}
