export type ConnectorOptions = {
  gatewayUrl: string;
  deviceId: string;
  token?: string;
};

export class AgentConnector {
  constructor(private readonly options: ConnectorOptions) {}

  describeConnection() {
    return {
      gatewayUrl: this.options.gatewayUrl,
      deviceId: this.options.deviceId,
      authMode: this.options.token ? "token" : "anonymous",
    };
  }
}
