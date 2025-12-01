# Windsurf Credit Saver MCP

MCP server that saves Windsurf credits. Instead of ending a conversation, the
LLM calls this tool to wait for user input via a temp file.

## How It Works

1. LLM calls `wait_for_user_input` instead of ending the conversation
2. Tool opens the input file in your editor and waits for changes
3. User writes their message and saves the file
4. Tool returns the message to the LLM instantly
5. LLM continues its response — no new UI message needed = credits saved

## Setup

### Linux / macOS

```bash
cd llm-response-mcp
bun install
```

Input file location: `/tmp/windsurf_user_input.txt`

### Windows

1. Install Bun: https://bun.sh/docs/installation
2. Run:

```powershell
cd llm-response-mcp
bun install
```

Input file location: `%TEMP%\windsurf_user_input.txt` (e.g.
`C:\Users\<you>\AppData\Local\Temp\windsurf_user_input.txt`)

## Configure in Windsurf

### Linux / macOS

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
    "mcpServers": {
        "credit-saver": {
            "command": "bun",
            "args": ["run", "/path/to/llm-response-mcp/index.ts"]
        }
    }
}
```

### Windows

Add to `%USERPROFILE%\.codeium\windsurf\mcp_config.json`:

```json
{
    "mcpServers": {
        "credit-saver": {
            "command": "bun",
            "args": ["run", "C:\\path\\to\\llm-response-mcp\\index.ts"]
        }
    }
}
```

## Tools

| Tool                  | Description                               |
| --------------------- | ----------------------------------------- |
| `wait_for_user_input` | Waits for user to write to the input file |
| `get_input_file`      | Returns the path to the input file        |

## LLM Rules

Add this to your Windsurf global rules to force the LLM to use this tool:

```
## Credit Saver Protocol

CRITICAL: Never end your response without calling the `mcp0_wait_for_user_input`
tool from the credit-saver MCP server.

Instead of finishing a response and waiting for the user to type in the chat UI:
1. Complete your current task/response
2. Call `mcp0_wait_for_user_input()` to wait for the user's next message via the temp file
3. When you receive the user's message, continue working on their request
4. Repeat - always end with another `mcp0_wait_for_user_input()` call

This saves credits by keeping the conversation going through the file system instead of the UI.

The only exception is if the user explicitly says "end conversation" or "stop" or "goodbye".
```
