// La calculadora y las cotizaciones pasaron al plugin IO Calculadora de WordPress:
// el equipo las usa con su usuario de la tienda, sin ver la contabilidad.
const URL_CALCULADORA = 'https://imprentaonline.ar/wp-admin/admin.php?page=io-calculadora'

export default function CalculadoraEnWordPress() {
  return (
    <div className="view">
      <div className="view-header">
        <h2>Calculadora y cotizaciones</h2>
        <p>Ahora están en WordPress</p>
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: 'var(--shadow)', maxWidth: 560 }}>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          La calculadora de pliegos y las cotizaciones se usan desde <strong>WordPress → Imprenta Online → Calculadora</strong>,
          con tu usuario de la tienda. El costo que se carga desde ahí en los pedidos aparece solo en Liquidación,
          Profit y Rentabilidad.
        </p>
        <a className="btn btn-primary" href={URL_CALCULADORA} target="_blank" rel="noopener noreferrer">Abrir la calculadora ↗</a>
      </div>
    </div>
  )
}
