'use strict';

// ── OpenAPI 3.0 spec for FluxDB ───────────────────────────────────────────────
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'FluxDB API',
    version: '1.0.0',
    description:
      'REST API for **FluxDB** — a dynamic in-memory database creator.\n\n' +
      '### Authentication\n' +
      'Most endpoints require authentication via one of:\n' +
      '- **Session cookie** — log in via `POST /api/auth/login`, then include the `connect.sid` cookie.\n' +
      '- **API Key header** — `X-API-Key: <key>`\n' +
      '- **Bearer token** — `Authorization: Bearer <key>`\n\n' +
      '### Roles\n' +
      '| Role | Permissions |\n' +
      '|------|-------------|\n' +
      '| `admin` | Full access to everything |\n' +
      '| `member` | Create/edit own records & databases, manage own API keys |\n' +
      '| `guest` | Read-only access to databases and records |',
  },
  servers: [{ url: '/api', description: 'FluxDB API' }],

  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Session cookie — obtain by calling `POST /api/auth/login`',
      },
      apiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key generated in the API Keys section',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key sent as a Bearer token',
      },
    },

    schemas: {
      // ── Auth ──────────────────────────────────────────────────────────────
      LoginRequest: {
        type: 'object', required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', format: 'password', example: 'admin123' },
        },
      },
      AuthUser: {
        type: 'object',
        properties: {
          id:       { type: 'string', format: 'uuid' },
          username: { type: 'string', example: 'admin' },
          role:     { type: 'string', enum: ['admin', 'member', 'guest'] },
        },
      },

      // ── Users ─────────────────────────────────────────────────────────────
      User: {
        type: 'object',
        properties: {
          id:       { type: 'string', format: 'uuid' },
          username: { type: 'string', example: 'alice' },
          role:     { type: 'string', enum: ['admin', 'member', 'guest'] },
        },
      },
      CreateUserRequest: {
        type: 'object', required: ['username', 'password', 'role'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 32, example: 'alice' },
          password: { type: 'string', minLength: 6, format: 'password' },
          role:     { type: 'string', enum: ['admin', 'member', 'guest'] },
        },
      },
      UpdateUserRequest: {
        type: 'object',
        properties: {
          password: { type: 'string', minLength: 6, format: 'password' },
          role:     { type: 'string', enum: ['admin', 'member', 'guest'] },
        },
      },

      // ── Fields ────────────────────────────────────────────────────────────
      Field: {
        type: 'object', required: ['name', 'type'],
        properties: {
          name:       { type: 'string', example: 'title' },
          type:       { type: 'string', enum: ['string', 'number', 'boolean', 'date'] },
          required:   { type: 'boolean', default: false },
          minLength:  { type: 'integer', description: 'string only' },
          maxLength:  { type: 'integer', description: 'string only' },
          pattern:    { type: 'string', description: 'Regex pattern — string only' },
          min:        { type: 'number', description: 'number only' },
          max:        { type: 'number', description: 'number only' },
          minDate:    { type: 'string', format: 'date', description: 'date only' },
          maxDate:    { type: 'string', format: 'date', description: 'date only' },
          enumValues: { type: 'array', items: { type: 'string' }, description: 'Allowed values' },
        },
      },

      // ── Databases ─────────────────────────────────────────────────────────
      Database: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          name:        { type: 'string', example: 'Products' },
          fields:      { type: 'array', items: { $ref: '#/components/schemas/Field' } },
          createdBy:   { type: 'string', example: 'admin' },
          createdAt:   { type: 'string', format: 'date-time' },
          recordCount: { type: 'integer', description: 'Present in list response only' },
        },
      },
      CreateDatabaseRequest: {
        type: 'object', required: ['name', 'fields'],
        properties: {
          name:   { type: 'string', example: 'Products' },
          fields: { type: 'array', items: { $ref: '#/components/schemas/Field' }, minItems: 1 },
        },
      },
      UpdateDatabaseRequest: {
        type: 'object',
        properties: {
          name:   { type: 'string' },
          fields: { type: 'array', items: { $ref: '#/components/schemas/Field' } },
        },
      },

      // ── Records ───────────────────────────────────────────────────────────
      Record: {
        type: 'object',
        properties: {
          id:         { type: 'string', format: 'uuid' },
          databaseId: { type: 'string', format: 'uuid' },
          data:       { type: 'object', additionalProperties: true, example: { title: 'Widget', price: 9.99 } },
          createdBy:  { type: 'string' },
          createdAt:  { type: 'string', format: 'date-time' },
          updatedAt:  { type: 'string', format: 'date-time' },
        },
      },
      RecordRequest: {
        type: 'object', required: ['data'],
        properties: {
          data: { type: 'object', additionalProperties: true, example: { title: 'Widget', price: 9.99 } },
        },
      },

      // ── API Keys ──────────────────────────────────────────────────────────
      ApiKeyPreview: {
        type: 'object',
        properties: {
          id:         { type: 'string', format: 'uuid' },
          name:       { type: 'string', example: 'My script' },
          keyPreview: { type: 'string', example: 'dyndb_a1b2c3d4e5f6…' },
          createdAt:  { type: 'string', format: 'date-time' },
          lastUsed:   { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ApiKeyFull: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          name:      { type: 'string' },
          key:       { type: 'string', example: 'dyndb_a1b2c3d4e5f6...', description: 'Shown only on creation' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateApiKeyRequest: {
        type: 'object', required: ['name'],
        properties: { name: { type: 'string', example: 'My script' } },
      },

      // ── Activity ──────────────────────────────────────────────────────────
      ActivityEntry: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          action:    { type: 'string', example: 'create_db' },
          user:      { type: 'string', example: 'admin' },
          target:    { type: 'string', example: 'Products' },
          detail:    { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },

      // ── Errors ────────────────────────────────────────────────────────────
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Not authenticated' } },
      },
      Message: {
        type: 'object',
        properties: { message: { type: 'string', example: 'Done' } },
      },
    },

    responses: {
      Unauthorized: {
        description: 'Not authenticated',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Insufficient permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Conflict: {
        description: 'Resource already exists',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      RateLimit: {
        description: 'Rate limit exceeded',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },

  // ── Default security (all protected by default) ────────────────────────────
  security: [{ cookieAuth: [] }, { apiKeyHeader: [] }, { bearerAuth: [] }],

  tags: [
    { name: 'Auth',      description: 'Login, logout, register, current user' },
    { name: 'Users',     description: 'User management — admin only' },
    { name: 'Databases', description: 'Create and manage dynamic databases' },
    { name: 'Records',   description: 'CRUD operations on database records' },
    { name: 'API Keys',  description: 'Personal API key management' },
    { name: 'Activity',  description: 'Activity audit log — admin only' },
  ],

  paths: {

    // ── Auth ─────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Login',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthUser' } } },
          },
          401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { $ref: '#/components/responses/RateLimit' },
        },
      },
    },

    '/auth/logout': {
      post: {
        tags: ['Auth'], summary: 'Logout',
        responses: {
          200: { description: 'Logged out', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
        },
      },
    },

    '/auth/me': {
      get: {
        tags: ['Auth'], summary: 'Get current user',
        responses: {
          200: { description: 'Current user', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthUser' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Register a new account',
        description: 'Creates a new account with the `member` role.',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          201: { description: 'Account created', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthUser' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/RateLimit' },
        },
      },
    },

    // ── Users ────────────────────────────────────────────────────────────────
    '/users': {
      get: {
        tags: ['Users'], summary: 'List all users',
        description: 'Admin only.',
        responses: {
          200: { description: 'User list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['Users'], summary: 'Create a user',
        description: 'Admin only.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserRequest' } } },
        },
        responses: {
          201: { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },

    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      put: {
        tags: ['Users'], summary: 'Update a user',
        description: 'Admin only. Change password and/or role.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUserRequest' } } },
        },
        responses: {
          200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Users'], summary: 'Delete a user',
        description: 'Admin only. Cannot delete `admin` or `guest` system accounts.',
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
          400: { description: 'Cannot delete system account', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Databases ────────────────────────────────────────────────────────────
    '/databases': {
      get: {
        tags: ['Databases'], summary: 'List all databases',
        description: 'Returns all databases with their `recordCount`.',
        responses: {
          200: { description: 'Database list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Database' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Databases'], summary: 'Create a database',
        description: 'Requires `admin` or `member` role.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateDatabaseRequest' } } },
        },
        responses: {
          201: { description: 'Database created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Database' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },

    '/databases/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Database UUID' }],
      get: {
        tags: ['Databases'], summary: 'Get a database',
        responses: {
          200: { description: 'Database object', content: { 'application/json': { schema: { $ref: '#/components/schemas/Database' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['Databases'], summary: 'Update a database',
        description: 'Admin only. Rename or change fields.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateDatabaseRequest' } } },
        },
        responses: {
          200: { description: 'Updated database', content: { 'application/json': { schema: { $ref: '#/components/schemas/Database' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
      delete: {
        tags: ['Databases'], summary: 'Delete a database',
        description: 'Admin only. Also deletes all records in the database.',
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Records ──────────────────────────────────────────────────────────────
    '/databases/{dbId}/records': {
      parameters: [{ name: 'dbId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Database UUID' }],
      get: {
        tags: ['Records'], summary: 'List records in a database',
        responses: {
          200: { description: 'Record list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Record' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      post: {
        tags: ['Records'], summary: 'Add a record',
        description: 'Requires `admin` or `member` role. `data` must match the database schema.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordRequest' } } },
        },
        responses: {
          201: { description: 'Record created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Record' } } } },
          400: { description: 'Schema validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/databases/{dbId}/records/{id}': {
      parameters: [
        { name: 'dbId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Database UUID' },
        { name: 'id',   in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Record UUID' },
      ],
      put: {
        tags: ['Records'], summary: 'Update a record',
        description: '`admin` can edit any record. `member` can only edit their own records.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordRequest' } } },
        },
        responses: {
          200: { description: 'Updated record', content: { 'application/json': { schema: { $ref: '#/components/schemas/Record' } } } },
          400: { description: 'Schema validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Records'], summary: 'Delete a record',
        description: '`admin` can delete any record. `member` can only delete their own records.',
        responses: {
          200: { description: 'Deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── API Keys ─────────────────────────────────────────────────────────────
    '/keys': {
      get: {
        tags: ['API Keys'], summary: 'List my API keys',
        description: 'Requires `admin` or `member` role.',
        responses: {
          200: { description: 'Key list (preview only)', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiKeyPreview' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['API Keys'], summary: 'Generate an API key',
        description: 'Requires `admin` or `member` role. Maximum 5 keys per user. The full key is returned **only once**.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateApiKeyRequest' } } },
        },
        responses: {
          201: { description: 'Key created (full key shown once)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiKeyFull' } } } },
          400: { description: 'Validation error or limit reached', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },

    '/keys/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'API key UUID' }],
      delete: {
        tags: ['API Keys'], summary: 'Revoke an API key',
        description: '`admin` can revoke any key. `member` can only revoke their own.',
        responses: {
          200: { description: 'Revoked', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Activity ─────────────────────────────────────────────────────────────
    '/activity': {
      get: {
        tags: ['Activity'], summary: 'Get activity log',
        description: 'Admin only. Returns the last 100 entries, newest first.',
        responses: {
          200: { description: 'Activity entries', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ActivityEntry' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
  },
};
