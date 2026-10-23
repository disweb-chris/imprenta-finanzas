import { getCategorias, respuesta, conErrores, LECTURA } from '../comun.js';

export function registerCategorias(server) {
  server.tool(
    'listar_categorias',
    'Lista las categorías de gastos (id y nombre). Usá el id o el nombre al crear egresos, ' +
    'compromisos o presupuestos.',
    {},
    LECTURA,
    conErrores(async () => {
      const categorias = await getCategorias();
      return respuesta({ cantidad: categorias.length, categorias });
    })
  );
}
