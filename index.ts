/**
 * MCP server for Windsurf to save credits.
 * LLM calls this tool to wait for user input via a temp file,
 * then continues its response without using UI credits.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { watch } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const INPUT_FILE = join(tmpdir(), "windsurf_user_input.txt");

interface WaitResult {
  status: string;
  user_message?: string;
  input_file?: string;
  error?: string;
}

class UserInputServer {
  private inputFile: string;
  private initialized = false;
  private history: string[] = [];

  constructor() {
    this.inputFile = INPUT_FILE;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    
    // Ensure parent dir exists
    await mkdir(join(tmpdir()), { recursive: true });
    this.initialized = true;
  }

  /**
   * Main tool: Wait for user to write input to the file.
   * Uses file watcher for instant response when saved.
   */
  async waitForUserInput(): Promise<WaitResult> {
    await this.init();

    // Write history to file so user can see previous messages
    const historyText = this.history.length > 0 
      ? this.history.join("\n") + "\n\n--- Type your message below (end with //SEND to submit) ---\n\n"
      : "--- Type your message below (end with //SEND to submit) ---\n\n";
    await writeFile(this.inputFile, historyText);

    console.error(`\n📝 Waiting for user input in: ${this.inputFile}`);
    console.error(`   Write your message and end with //SEND to submit.\n`);

    // Open the file in Windsurf/VS Code automatically
    this.openInEditor();

    return new Promise((resolve) => {

      // Watch for file changes - triggers instantly on save
      const watcher = watch(this.inputFile, async (event) => {
        if (event === "change") {
          try {
            const content = await readFile(this.inputFile, "utf-8");
            const trimmed = content.trim();

            if (trimmed) {
              // Check for the //SEND marker at the end
              const sendMarker = "//SEND";
              if (!trimmed.toUpperCase().endsWith(sendMarker)) {
                // User hasn't signaled they're done yet
                return;
              }

              // Extract only the new message (after the separator, if present)
              const separator = "--- Type your message below (end with //SEND to submit) ---";
              let userMessage = trimmed;
              
              if (trimmed.includes(separator)) {
                userMessage = trimmed.split(separator).pop()?.trim() || "";
              }
              
              // Remove the //SEND marker from the message
              userMessage = userMessage.replace(/\/\/SEND$/i, "").trim();
              
              if (userMessage) {
                watcher.close();
                
                // Add to history with timestamp
                const timestamp = new Date().toLocaleTimeString();
                this.history.push(`[${timestamp}] USER: ${userMessage}`);
                
                resolve({
                  status: "success",
                  user_message: userMessage,
                });
              }
            }
          } catch (e) {
            console.error(`Error reading file: ${e}`);
          }
        }
      });
    });
  }

  getInputFilePath(): WaitResult {
    return {
      status: "success",
      input_file: this.inputFile,
    };
  }

  /**
   * Open the input file in Windsurf/VS Code as a new tab in current window
   */
  private openInEditor(): void {
    // Try editors in order, use -r to reuse current window
    const editors = ["windsurf-next", "windsurf", "code"];
    
    for (const editor of editors) {
      try {
        // -r = reuse window, opens as new tab in current window
        const proc = Bun.spawn([editor, "-r", this.inputFile], {
          stdout: "ignore",
          stderr: "ignore",
        });
        console.error(`📂 Opening ${this.inputFile} in ${editor}`);
        return;
      } catch (e) {
        console.error(`Failed to open with ${editor}: ${e}`);
        // Try next editor
      }
    }
    
    console.error(`⚠️ Could not open file in editor. Please open manually: ${this.inputFile}`);
  }
}

const server = new UserInputServer();

// Single focused tool
const tools = [
  {
    name: "wait_for_user_input",
    description: "Call this to pause and wait for user input via a temp file. The user writes their message to the file, and this tool returns it. Use this instead of ending the conversation to save credits.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_input_file",
    description: "Get the path to the input file where users write their messages.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Handle MCP tool calls
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "wait_for_user_input":
      return await server.waitForUserInput();

    case "get_input_file":
      return server.getInputFilePath();

    default:
      return { status: "error", message: `Unknown tool: ${name}` };
  }
}

// MCP Protocol handler using stdio
async function handleMessage(message: string): Promise<string> {
  try {
    const request = JSON.parse(message);

    if (request.method === "initialize") {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "llm-response-mcp",
            version: "1.0.0",
          },
        },
      });
    }

    if (request.method === "tools/list") {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools },
      });
    }

    if (request.method === "tools/call") {
      const result = await handleToolCall(request.params.name, request.params.arguments || {});
      return JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      });
    }

    // Handle notifications (no response needed)
    if (request.method === "notifications/initialized") {
      return "";
    }

    return JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "Method not found" },
    });
  } catch (err) {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `Parse error: ${err}` },
    });
  }
}

// Main entry point
async function main() {
  await server.init();

  console.error("LLM Response MCP Server started");

  // Read from stdin line by line
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        const response = await handleMessage(line);
        if (response) {
          console.log(response);
        }
      }
    }
  }
}

main().catch(console.error);
