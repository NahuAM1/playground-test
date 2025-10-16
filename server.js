import express from "express";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 4000;

// Endpoint básico para Render
app.get("/", (req, res) => {
  res.send("✅ Playwright MCP running via Render wrapper");
});

// Ejecutar el MCP de Playwright en background
const mcpProcess = spawn("npx", ["@playwright/mcp@latest"], {
  stdio: "inherit",
  shell: true,
});

mcpProcess.on("exit", (code) => {
  console.log(`MCP exited with code ${code}`);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
