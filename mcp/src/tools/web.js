import { z } from 'zod';
import {
  fechaSchema, mesSchema, montoSchema, sinUndefined, respuesta, conErrores,
  LECTURA, ESCRITURA, MODIFICA,
} from '../comun.js';

// Las mismas herramientas, hablando con IO Finanzas (WordPress) en vez de Firebase.
// Se usan cuando están cargadas IO_FINANZAS_URL (la dirección del sitio) e IO_FINANZAS_CLAVE
// (una clave de alcance "completo" de Finanzas → Ajustes → Conexiones). Toda la lógica vive
// en el plugin: acá solo se validan los parámetros y se pasan. Para volver a Firebase, se
// sacan las dos variables y se vuelve a deployar.

const BASE = () => (process.env.IO_FINANZAS_URL || '').replace(/\/+$/, '');

export const usaWeb = () => !!BASE() && !!process.env.IO_FINANZAS_CLAVE;

async function api(metodo, ruta, { query, cuerpo } = {}) {
  const url = new URL(`${BASE()}/wp-json/io-finanzas/v1/mcp/${ruta}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: metodo,
    // Encabezado propio: algunos hostings se comen el Authorization antes de llegar a WordPress.
    headers: { 'X-IO-Finanzas-Clave': process.env.IO_FINANZAS_CLAVE, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(sinUndefined(cuerpo)) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error(datos?.message || `IO Finanzas respondió ${res.status}`);
  return datos;
}

const opcionales = (campos) =>
  Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.optional()]));

export function registerWebTools(server) {
  const herramienta = (nombre, descripcion, esquema, tipo, fn) =>
    server.tool(nombre, descripcion, esquema, tipo, conErrores(async (args) => respuesta(await fn(args))));

  const mes = z.string().optional().describe('Mes (YYYY-MM). Por defecto: el actual.');

  herramienta(
    'resumen_mensual',
    'Resumen financiero de un mes: ingresos, gastos, compromisos, presupuesto, saldo de cada cuenta y último cierre. ' +
    'Es la herramienta principal para diagnóstico y recomendaciones.',
    { mes }, LECTURA,
    ({ mes: m }) => api('GET', 'resumen', { query: { mes: m } })
  );

  herramienta(
    'listar_cuentas',
    'Cuánto hay en cada cuenta (Ualá, Mercado Pago, Santander, BBVA, Efectivo, Caja chica), lo que falta acreditar y la proyección a fin de mes.',
    {}, LECTURA,
    () => api('GET', 'cuentas')
  );

  herramienta('listar_categorias', 'Lista las categorías de gastos (id y nombre).', {}, LECTURA, async () => {
    const res = await fetch(`${BASE()}/wp-json/io-finanzas/v1/categorias`, {
      headers: { 'X-IO-Finanzas-Clave': process.env.IO_FINANZAS_CLAVE },
      signal: AbortSignal.timeout(30_000),
    });
    const categorias = await res.json();
    if (!res.ok) throw new Error(categorias?.message || `IO Finanzas respondió ${res.status}`);
    return { cantidad: categorias.length, categorias };
  });

  // ── Egresos ────────────────────────────────────────────────────────────────
  // banco, efectivo, caja_chica, getnet (Santander), avealma (BBVA) o el id exacto de una cuenta.
  const camposEgreso = {
    fecha: fechaSchema.describe('Fecha del pago (YYYY-MM-DD).'),
    monto: montoSchema.describe('Monto en pesos.'),
    categoria: z.string().describe('Id o nombre de la categoría (ver listar_categorias).'),
    medio_pago: z.string().describe(
      'De dónde salió la plata: banco (la cuenta principal, Ualá), mercadopago, efectivo, caja_chica, getnet (Santander), avealma (BBVA) o el id de una cuenta. "canje" = pagado con trabajo, no mueve plata.'
    ),
    descripcion: z.string().describe('Detalle del gasto.'),
    subcategoria: z.string().describe('Subcategoría o proveedor.'),
  };

  herramienta(
    'listar_egresos',
    'Lista los gastos del negocio. Filtrá por mes y/o medio de pago (banco, efectivo, caja_chica, avealma, getnet, canje, a_pagar) o por el id de una cuenta.',
    {
      mes,
      medio_pago: z.string().optional().describe('Medio de pago o id de cuenta.'),
      limit: z.number().int().min(1).max(200).optional().describe('Por defecto: 100.'),
    },
    LECTURA,
    (q) => api('GET', 'egresos', { query: q })
  );

  herramienta(
    'crear_egreso',
    'Registra un gasto pagado: sale de la cuenta elegida. Para pagar un compromiso (sueldo, cuota, servicio) usá registrar_pago_compromiso, que además avanza el vencimiento.',
    { ...opcionales(camposEgreso), monto: camposEgreso.monto, categoria: camposEgreso.categoria },
    ESCRITURA,
    (c) => api('POST', 'egresos', { cuerpo: c })
  );

  herramienta(
    'editar_egreso',
    'Corrige un gasto. Solo cambia los campos que se pasen; el pago sigue al gasto.',
    { id: z.string().describe('Id del gasto (lo devuelve listar_egresos).'), ...opcionales(camposEgreso) },
    MODIFICA,
    ({ id, ...c }) => api('POST', `egresos/${encodeURIComponent(id)}`, { cuerpo: c })
  );

  herramienta(
    'eliminar_egreso',
    'Anula un gasto: la plata vuelve a la cuenta y queda tachado, no se borra. Confirmá con el usuario antes de usarla.',
    { id: z.string().describe('Id del gasto.') },
    MODIFICA,
    ({ id }) => api('DELETE', `egresos/${encodeURIComponent(id)}`)
  );

  // ── Compromisos ────────────────────────────────────────────────────────────
  const camposCompromiso = {
    nombre: z.string().min(1).describe('Nombre (ej: "Sueldo Juan", "Crédito plotter").'),
    tipo: z.enum(['recurrente', 'cuotas']).describe('"recurrente" sin fin, "cuotas" con cantidad fija.'),
    frecuencia: z.enum(['mensual', 'semanal', 'anual']).describe('Cada cuánto se paga.'),
    monto: montoSchema.describe('Monto de cada pago (o de cada cuota).'),
    categoria: z.string().describe('Id o nombre de la categoría.'),
    fecha_proximo_pago: fechaSchema.describe('Próximo vencimiento (YYYY-MM-DD).'),
    total_cuotas: z.number().int().positive().describe('Solo para tipo "cuotas".'),
    cuotas_pagadas: z.number().int().min(0).describe('Solo para tipo "cuotas". Por defecto: 0.'),
    estado: z.enum(['activo', 'pausado', 'finalizado']).describe('Por defecto: activo.'),
    notas: z.string(),
  };

  herramienta(
    'listar_compromisos',
    'Lista los compromisos: "recurrente" (sueldos, suscripciones, servicios) y "cuotas" (créditos). Incluye lo ya pagado de cada uno y la deuda total en créditos.',
    {
      mes: z.string().optional().describe('Filtrar por mes de próximo pago (YYYY-MM).'),
      tipo: z.enum(['recurrente', 'cuotas', 'todos']).optional(),
      proximos_dias: z.number().int().min(1).max(90).optional().describe('Los que vencen en los próximos N días.'),
      solo_activos: z.boolean().optional().describe('Por defecto: true.'),
    },
    LECTURA,
    (q) => api('GET', 'compromisos', { query: q })
  );

  herramienta(
    'crear_compromiso',
    'Crea un compromiso de pago: un gasto recurrente o un crédito en cuotas.',
    { ...opcionales(camposCompromiso), nombre: camposCompromiso.nombre, monto: camposCompromiso.monto, categoria: camposCompromiso.categoria },
    ESCRITURA,
    (c) => api('POST', 'compromisos', { cuerpo: c })
  );

  herramienta(
    'editar_compromiso',
    'Corrige un compromiso. Solo cambia los campos que se pasen. Para registrar un pago usá registrar_pago_compromiso.',
    { id: z.string().describe('Id del compromiso.'), ...opcionales(camposCompromiso) },
    MODIFICA,
    ({ id, ...c }) => api('POST', `compromisos/${encodeURIComponent(id)}`, { cuerpo: c })
  );

  herramienta(
    'eliminar_compromiso',
    'Da por terminado un compromiso: queda finalizado, no se borra, y los pagos hechos siguen. Confirmá con el usuario antes.',
    { id: z.string().describe('Id del compromiso.') },
    MODIFICA,
    ({ id }) => api('DELETE', `compromisos/${encodeURIComponent(id)}`)
  );

  herramienta(
    'registrar_pago_compromiso',
    'Registra el pago de un compromiso, igual que el botón "Pagar": crea el gasto y avanza el compromiso. Una cuota avanza siempre; un gasto fijo avanza cuando lo pagado llega al monto, así se pueden cargar pagos parciales.',
    {
      id: z.string().describe('Id del compromiso.'),
      monto: montoSchema.optional().describe('Monto pagado. Por defecto: lo que falta.'),
      fecha: fechaSchema.optional().describe('Fecha del pago. Por defecto: hoy.'),
      medio_pago: z.string().optional().describe('Cuenta de la que salió. Por defecto: la del compromiso o la principal.'),
    },
    ESCRITURA,
    ({ id, ...c }) => api('POST', `compromisos/${encodeURIComponent(id)}/pago`, { cuerpo: c })
  );

  // ── Ingresos extra ─────────────────────────────────────────────────────────
  const camposIngreso = {
    fecha: fechaSchema.describe('Fecha (YYYY-MM-DD).'),
    monto: montoSchema.describe('Monto en pesos.'),
    tipo: z.enum(['credito', 'transferencia', 'devolucion', 'otro']).describe('"credito" = crédito o préstamo recibido.'),
    descripcion: z.string(),
  };

  herramienta(
    'listar_ingresos_extra',
    'Lista los ingresos que no vienen de un pedido (préstamos, aportes, devoluciones). Los gastos están en listar_egresos.',
    { mes, tipo: z.string().optional().describe('Filtrar por tipo.') },
    LECTURA,
    (q) => api('GET', 'ingresos', { query: q })
  );

  herramienta(
    'crear_ingreso_extra',
    'Registra un ingreso que no viene de un pedido. Entra a la cuenta principal.',
    { ...opcionales(camposIngreso), monto: camposIngreso.monto },
    ESCRITURA,
    (c) => api('POST', 'ingresos', { cuerpo: c })
  );

  herramienta(
    'editar_ingreso_extra',
    'Corrige un ingreso extra. Si se cambia el tipo o la descripción, pasá los dos.',
    { id: z.string().describe('Id del ingreso.'), ...opcionales(camposIngreso) },
    MODIFICA,
    ({ id, ...c }) => api('POST', `ingresos/${encodeURIComponent(id)}`, { cuerpo: c })
  );

  herramienta(
    'eliminar_ingreso_extra',
    'Anula un ingreso extra: queda tachado, no se borra. Confirmá con el usuario antes de usarla.',
    { id: z.string().describe('Id del ingreso.') },
    MODIFICA,
    ({ id }) => api('DELETE', `ingresos/${encodeURIComponent(id)}`)
  );

  // ── Presupuesto ────────────────────────────────────────────────────────────
  herramienta('listar_presupuestos', 'Los presupuestos mensuales por categoría.', {}, LECTURA, () => api('GET', 'presupuestos'));

  herramienta(
    'guardar_presupuesto',
    'Define el presupuesto mensual de una categoría. Si ya tiene, lo reemplaza.',
    {
      categoria: z.string().describe('Id o nombre de la categoría.'),
      monto: montoSchema.describe('Monto mensual.'),
      descripcion: z.string().optional(),
    },
    MODIFICA,
    (c) => api('POST', 'presupuestos', { cuerpo: c })
  );

  herramienta(
    'eliminar_presupuesto',
    'Elimina el presupuesto de una categoría. Confirmá con el usuario antes de usarla.',
    { id: z.string().describe('Id del presupuesto.') },
    MODIFICA,
    ({ id }) => api('DELETE', `presupuestos/${encodeURIComponent(id)}`)
  );

  // ── Pagos variables ────────────────────────────────────────────────────────
  herramienta(
    'listar_pagos_variables',
    'Los pagos variables del mes: el monto de cada concepto, los que faltan cargar y si el mes se cerró.',
    { mes }, LECTURA,
    ({ mes: m }) => api('GET', 'variables', { query: { mes: m } })
  );

  herramienta(
    'cargar_pago_variable',
    'Carga o corrige el monto de un concepto variable en un mes. No se puede si el mes ya se cerró.',
    {
      concepto: z.string().describe('Id o nombre del concepto.'),
      monto: z.number().min(0).describe('Monto del mes. 0 para dejarlo sin monto.'),
      mes: mesSchema.optional().describe('Mes (YYYY-MM). Por defecto: el actual.'),
      notas: z.string().optional(),
    },
    MODIFICA,
    (c) => api('POST', 'variables', { cuerpo: c })
  );

  // ── Cierres y liquidaciones (solo lectura) ─────────────────────────────────
  herramienta(
    'listar_cierres_caja',
    'Los cierres de caja, el más reciente primero, con lo contado por cuenta y la diferencia. El cierre se hace en la pantalla, no desde acá.',
    {
      limit: z.number().int().min(1).max(30).optional().describe('Por defecto: 5.'),
      desde: z.string().optional().describe('Fecha desde (YYYY-MM-DD).'),
      hasta: z.string().optional().describe('Fecha hasta (YYYY-MM-DD).'),
    },
    LECTURA,
    (q) => api('GET', 'cierres', { query: q })
  );

  herramienta(
    'listar_liquidaciones',
    'Las liquidaciones de producción traídas de Firebase (historia). Lo nuevo está en IO Costos, pedido por pedido.',
    { mes, proveedor: z.string().optional() },
    LECTURA,
    (q) => api('GET', 'liquidaciones', { query: q })
  );
}
