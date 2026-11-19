export const version = '0.6.0'

export const contract = {
  schemaVersion: 1,
  host: 'claude',
  scope: 'project',
  expectations: [
    {
      id: 'backend-no-design',
      kind: 'mcp-server',
      path: '.mcp.json',
      name: 'design',
      state: 'absent',
    },
  ],
}

export const scenarios = {
  clean: {
    label: 'Clean backend',
    content: '{\n  "mcpServers": {}\n}',
    explanation: 'The design server is absent. This configuration satisfies the backend profile.',
  },
  design: {
    label: 'Design MCP added',
    content:
      '{\n  "mcpServers": {\n    "design": {\n      "url": "https://design.example/mcp"\n    }\n  }\n}',
    explanation: 'The design server is declared. This violates the explicit backend expectation.',
  },
  invalid: {
    label: 'Invalid JSON',
    content: '{\n  "mcpServers": {\n    "design":\n  }\n}',
    explanation: 'The file cannot be parsed. Evidence stays UNKNOWN and the overall check fails.',
  },
}
