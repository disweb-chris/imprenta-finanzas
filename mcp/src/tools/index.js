import { registerEgresos }       from './egresos.js';
import { registerCompromisos }    from './compromisos.js';
import { registerCierresCaja }    from './cierres_caja.js';
import { registerIngresosExtra }  from './ingresos_extra.js';
import { registerLiquidaciones }  from './liquidaciones.js';
import { registerPresupuestos }   from './presupuestos.js';
import { registerPvMontos }       from './pv_montos.js';
import { registerResumenMensual } from './resumen_mensual.js';
import { registerCategorias }     from './categorias.js';

export function registerAllTools(server) {
  registerEgresos(server);
  registerCompromisos(server);
  registerCierresCaja(server);
  registerIngresosExtra(server);
  registerLiquidaciones(server);
  registerPresupuestos(server);
  registerPvMontos(server);
  registerResumenMensual(server);
  registerCategorias(server);
}
