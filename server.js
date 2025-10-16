import express from "express";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 4000;

// Middleware para parsear JSON
app.use(express.json());

let mcpProcess = null;
let isReady = false;
const pendingRequests = new Map();

// Inicializar el proceso MCP de Playwright
function initializeMCP() {
  if (mcpProcess) {
    console.log("MCP process already running");
    return;
  }

  console.log("Starting Playwright MCP server...");

  // Instalar Playwright si no está instalado
  const installProcess = spawn("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: true,
  });

  installProcess.on("close", (code) => {
    console.log(`Playwright install completed with code ${code}`);
    startMCPProcess();
  });
}

function startMCPProcess() {
  mcpProcess = spawn("npx", ["@playwright/mcp@latest"], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  let buffer = "";

  mcpProcess.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    lines.forEach((line) => {
      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          console.log("MCP Response:", JSON.stringify(response, null, 2));

          // Si es una respuesta a una petición específica
          if (response.id && pendingRequests.has(response.id)) {
            const { resolve } = pendingRequests.get(response.id);
            resolve(response);
            pendingRequests.delete(response.id);
          }

          isReady = true;
        } catch (e) {
          console.log("MCP Output:", line);
        }
      }
    });
  });

  mcpProcess.stderr.on("data", (data) => {
    console.error(`MCP stderr: ${data}`);
  });

  mcpProcess.on("exit", (code) => {
    console.log(`MCP exited with code ${code}`);
    mcpProcess = null;
    isReady = false;

    // Rechazar todas las peticiones pendientes
    pendingRequests.forEach(({ reject }) => {
      reject(new Error("MCP process exited"));
    });
    pendingRequests.clear();
  });

  mcpProcess.on("error", (error) => {
    console.error(`MCP error: ${error}`);
    mcpProcess = null;
    isReady = false;
  });

  // Dar tiempo para que MCP se inicie
  setTimeout(() => {
    isReady = true;
    console.log("MCP server ready");
  }, 3000);
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

    // Asegurarse de que la petición tenga un ID único
    if (!mcpRequest.id) {
      mcpRequest.id = Date.now().toString();
    }

    console.log("Received MCP request:", JSON.stringify(mcpRequest, null, 2));

    // Crear una promesa para esperar la respuesta
    const responsePromise = new Promise((resolve, reject) => {
      pendingRequests.set(mcpRequest.id, { resolve, reject });

      // Timeout de 60 segundos
      setTimeout(() => {
        if (pendingRequests.has(mcpRequest.id)) {
          pendingRequests.delete(mcpRequest.id);
          reject(new Error("Request timeout"));
        }
      }, 60000);
    });

    // Enviar la petición al proceso MCP
    mcpProcess.stdin.write(JSON.stringify(mcpRequest) + "\n");

    // Esperar la respuesta
    const response = await responsePromise;
    res.json(response);

  } catch (error) {
    console.error("Error handling MCP request:", error);

    if (error.message === "Request timeout") {
      res.status(504).json({
        error: "MCP request timeout",
        message: "The MCP server took too long to respond",
      });
    } else {
      res.status(500).json({
        error: "Internal server error",
        details: error.message,
      });
    }
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
