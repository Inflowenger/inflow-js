/**
 * Sample extension parameter schemas.
 *
 * These are the `params.schema` / `params.ui` pair an Inflow extension record
 * carries, written out by hand so the lab needs no backend. The Jira Connector
 * is the same sample the inspector seeds a new extension with — keep them in
 * step, it is the one people recognise.
 */
export interface Sample {
  id: string
  label: string
  /** What this sample is here to demonstrate. */
  about: string
  schema: unknown
  ui: unknown
}

const jiraConnector: Sample = {
  id: 'jira',
  label: 'Jira Connector',
  about:
    'The full spread: groups, a nested object, an enum, an array, a oneOf, and two x-inflow-ui buttons. Reload patches leaf paths under connection; Load fills the labels array from a faked service call.',
  schema: {
    type: 'object',
    title: 'Jira Connector',
    properties: {
      connection: {
        type: 'object',
        title: 'Connection',
        properties: {
          protocol: {
            type: 'string',
            title: 'Protocol',
            enum: ['http', 'https', 'ws', 'wss'],
            default: 'https',
          },
          host: { type: 'string', title: 'Host', default: 'localhost' },
          port: { type: 'integer', title: 'Port', minimum: 1, maximum: 65535, default: 443 },
          secure: { type: 'boolean', title: 'Use TLS', default: true },
        },
        required: ['protocol', 'host'],
      },
      project: { type: 'string', title: 'Project', enum: ['ENG', 'OPS', 'MARKETING'] },
      labels: { type: 'array', title: 'Labels', items: { type: 'string' } },
      authentication: {
        title: 'Authentication',
        oneOf: [
          {
            title: 'API Key',
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'apiKey' },
              apiKey: { type: 'string', title: 'API Key', format: 'password' },
            },
            required: ['apiKey'],
          },
          {
            title: 'OAuth2',
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'oauth2' },
              clientId: { type: 'string', title: 'Client ID' },
              clientSecret: { type: 'string', title: 'Client Secret', format: 'password' },
            },
            required: ['clientId', 'clientSecret'],
          },
        ],
      },
    },
    required: ['project'],
  },
  ui: {
    type: 'VerticalLayout',
    elements: [
      {
        type: 'Group',
        label: 'Connection',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/connection/properties/protocol',
            label: 'Protocol',
            'x-inflow-ui': {
              action: { name: 'refreshForm' },
              button: { position: 'append', icon: '↻', label: 'Reload' },
            },
          },
          {
            type: 'HorizontalLayout',
            elements: [
              { type: 'Control', scope: '#/properties/connection/properties/host', label: 'Host' },
              { type: 'Control', scope: '#/properties/connection/properties/port', label: 'Port' },
            ],
          },
          { type: 'Control', scope: '#/properties/connection/properties/secure', label: 'Use TLS' },
        ],
      },
      {
        type: 'Group',
        label: 'Issue',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/project',
            label: 'Project',
            'x-inflow-ui': {
              action: { name: 'loadLabels' },
              button: { position: 'append', label: 'Load labels' },
            },
          },
          { type: 'Control', scope: '#/properties/labels', label: 'Labels' },
        ],
      },
      {
        type: 'Group',
        label: 'Authentication',
        elements: [{ type: 'Control', scope: '#/properties/authentication' }],
      },
    ],
  },
}

const buttonPositions: Sample = {
  id: 'positions',
  label: 'Button positions',
  about:
    'The same field four times, once per `button.position`. Every button runs `noop`, so what you are looking at is placement only — append, prepend, above, below, each relative to the control that would have rendered anyway.',
  schema: {
    type: 'object',
    properties: {
      appended: { type: 'string', title: 'Appended', default: 'value' },
      prepended: { type: 'string', title: 'Prepended', default: 'value' },
      above: { type: 'string', title: 'Above', default: 'value' },
      below: { type: 'string', title: 'Below', default: 'value' },
    },
  },
  ui: {
    type: 'VerticalLayout',
    elements: (['append', 'prepend', 'above', 'below'] as const).map((position) => ({
      type: 'Control',
      scope: `#/properties/${position === 'append' ? 'appended' : position === 'prepend' ? 'prepended' : position}`,
      'x-inflow-ui': {
        action: { name: 'noop' },
        button: { position, label: position },
      },
    })),
  },
}

const unknownAction: Sample = {
  id: 'unknown-action',
  label: 'Unknown action',
  about:
    'A schema naming an action the host never registered. Actions resolve by name from the registry, so this button is inert rather than fatal — a schema can only ever call what the app handed the plugin.',
  schema: {
    type: 'object',
    properties: {
      target: { type: 'string', title: 'Target', default: 'anything' },
    },
  },
  ui: {
    type: 'VerticalLayout',
    elements: [
      {
        type: 'Control',
        scope: '#/properties/target',
        'x-inflow-ui': {
          action: { name: 'dropTheDatabase' },
          button: { position: 'append', label: 'Not in the registry' },
        },
      },
    ],
  },
}

export const samples: Sample[] = [jiraConnector, buttonPositions, unknownAction]

/**
 * Seed form data from the schema's `default`s, nested objects included.
 *
 * JSON Forms does not inject schema defaults into empty data on its own. This
 * is a plain schema walk on purpose — it stays independent of JSON Forms
 * internals, and so of JSON Forms versions.
 */
export function buildDefaults(schema: any): any {
  if (!schema || typeof schema !== 'object') return undefined
  if ('default' in schema) return schema.default
  if (schema.type === 'object' && schema.properties) {
    const obj: Record<string, any> = {}
    for (const [key, sub] of Object.entries<any>(schema.properties)) {
      const val = buildDefaults(sub)
      if (val !== undefined) obj[key] = val
    }
    return Object.keys(obj).length ? obj : undefined
  }
  return undefined
}
