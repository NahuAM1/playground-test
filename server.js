import express from "express";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 4000;

// Middleware para parsear JSON
app.use(express.json());

let mcpProcess = null;
let isReady = false;

// Inicializar el proceso MCP de Playwright
function initializeMCP() {
  if (mcpProcess) {
    console.log("MCP process already running");
    return;
  }

  console.log("Starting Playwright MCP server...");

  mcpProcess = spawn("npx", ["@playwright/mcp@latest"], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  mcpProcess.stdout.on("data", (data) => {
    console.log(`MCP stdout: ${data}`);
    isReady = true;
  });

  mcpProcess.stderr.on("data", (data) => {
    console.error(`MCP stderr: ${data}`);
  });

  mcpProcess.on("exit", (code) => {
    console.log(`MCP exited with code ${code}`);
    mcpProcess = null;
    isReady = false;
  });

  mcpProcess.on("error", (error) => {
    console.error(`MCP error: ${error}`);
    mcpProcess = null;
    isReady = false;
  });
}

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Playwright MCP Server running",
    ready: isReady,
    timestamp: new Date().toISOString(),
  });
});

// MCP protocol endpoint - maneja las peticiones del cliente MCP
app.post("/mcp", async (req, res) => {
  if (!isReady || !mcpProcess) {
    return res.status(503).json({
      error: "MCP server not ready",
      message: "The MCP server is starting or not available",
    });
  }

  try {
    const mcpRequest = req.body;
    console.log("Received MCP request:", JSON.stringify(mcpRequest, null, 2));

    // Enviar la petición al proceso MCP
    mcpProcess.stdin.write(JSON.stringify(mcpRequest) + "\n");

    // Esperar respuesta del proceso MCP
    const responseHandler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log("MCP response:", JSON.stringify(response, null, 2));
        res.json(response);
      } catch (error) {
        console.error("Error parsing MCP response:", error);
        res.status(500).json({
          error: "Failed to parse MCP response",
          details: error.message,
        });
      }
      mcpProcess.stdout.off("data", responseHandler);
    };

    mcpProcess.stdout.once("data", responseHandler);

    // Timeout de 30 segundos
    setTimeout(() => {
      mcpProcess.stdout.off("data", responseHandler);
      if (!res.headersSent) {
        res.status(504).json({
          error: "MCP request timeout",
          message: "The MCP server took too long to respond",
        });
      }
    }, 30000);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

// Inicializar MCP al arrancar
initializeMCP();

// Manejar shutdown gracefully
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});

app.listen(port, () => {
  console.log(`MCP Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
});
