import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { seleneGet } from "../seleneClient.js";

export function register(server: McpServer): void {
  server.registerTool(
    "get_user_settings",
    {
      title: "ユーザー設定を取得",
      description:
        "表示名、締め日、タイムゾーン、通貨などのユーザー設定を返す。「今月」の範囲は締め日によって変わるので、期間を指定して集計するときは先に確認する。",
      inputSchema: {},
    },
    async () => {
      const body = await seleneGet("/api/user/settings");
      return { content: [{ type: "text", text: body }] };
    }
  );
}
