type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type RunTaskOptions = {
  sessionId?: string;
};

export class OpenClawOpenAIProxy {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async runTask(
    agentId: string,
    prompt: string,
    options: RunTaskOptions = {},
  ): Promise<string> {
    const data = await this.createCompletion({
      model: agentId,
      stream: false,
      user: options.sessionId ?? `aifc-${Date.now()}`,
      messages: [{ role: "user", content: prompt }],
    });

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenClaw REST response did not include choices[0].message.content");
    }

    return content;
  }

  async *runTaskStream(agentId: string, prompt: string, sessionId: string): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: agentId,
        stream: true,
        user: sessionId,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenClaw REST request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("OpenClaw REST stream response has no body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const trimmed = frame.trim();
        if (!trimmed.startsWith("data: ")) {
          continue;
        }

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") {
          return;
        }

        const data = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
            };
          }>;
        };

        const delta = data.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield delta;
        }
      }
    }
  }

  private async createCompletion(body: {
    model: string;
    stream: boolean;
    user: string;
    messages: ChatCompletionMessage[];
  }): Promise<{
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  }> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenClaw REST request failed: ${response.status} ${response.statusText} ${errorText}`.trim(),
      );
    }

    return response.json() as Promise<{
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    }>;
  }

  private buildHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }
}
