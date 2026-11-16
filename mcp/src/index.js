import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAllTools } from './tools/index.js';

const app = express();
app.use(express.json());

// ── Autenticación ──────────────────────────────────────────────────────────────
// El servidor puede escribir en Firestore, así que no puede quedar abierto.
// Claude.ai no deja cargar headers en un conector propio: el token va en la URL
// (https://.../t/<token>/mcp). También se acepta "Authorization: Bearer <token>".
const ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('[MCP Finanzas] Falta MCP_ACCESS_TOKEN. El servidor no arranca sin token.');
  process.exit(1);
}

const tokenValido = (t) => {
  const a = Buffer.from(String(t || ''));
  const b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

// mergeParams: para leer :token cuando el router está montado en /t/:token
const router = express.Router({ mergeParams: true });

router.use((req, res, next) => {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.params.token ?? bearer;
  if (!tokenValido(token)) return res.status(401).json({ error: 'No autorizado' });
  next();
});

function crearServidor() {
  const server = new McpServer({
    name: 'mcp-finanzas-imprentaonline',
    version: '2.0.0',
  });
  registerAllTools(server);
  return server;
}

// ── Streamable HTTP (transporte actual de MCP) ─────────────────────────────────
// Sin estado: cada request arma su servidor, así funciona con varias instancias de Cloud Run
router.post('/mcp', async (req, res) => {
  const server = crearServidor();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null });
    }
  }
});

const metodoNoPermitido = (_, res) => res.status(405).json({
  jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido' }, id: null,
});
router.get('/mcp', metodoNoPermitido);
router.delete('/mcp', metodoNoPermitido);

// ── SSE (transporte viejo, se mantiene por compatibilidad) ─────────────────────
const sessions = new Map();

// Claude se conecta acá para recibir eventos (SSE)
router.get('/sse', async (req, res) => {
  // El endpoint de mensajes tiene que llevar el mismo prefijo (con el token, si va en la URL)
  const transport = new SSEServerTransport(`${req.baseUrl}/messages`, res);
  const server = crearServidor();
  sessions.set(transport.sessionId, transport);

  res.on('close', () => {
    sessions.delete(transport.sessionId);
    console.log(`[SSE] Sesión cerrada: ${transport.sessionId}`);
  });

  console.log(`[SSE] Nueva sesión: ${transport.sessionId}`);
  await server.connect(transport);
});

// Claude envía llamadas a herramientas acá
router.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sessions.get(sessionId);
  if (!transport) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }
  await transport.handlePostMessage(req, res, req.body);
});

// Health check para Cloud Run (sin token, no expone datos)
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/t/:token', router);
app.use('/', router);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[MCP Finanzas] Servidor corriendo en puerto ${PORT}`);
});
