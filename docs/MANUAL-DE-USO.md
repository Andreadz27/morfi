# Manual de uso de Morfi

Guía para quienes usan Morfi en el local todos los días. La instalación y la configuración técnica están en
`docs/INSTALACION.md`.

**Índice:** [Antes de empezar](#antes-de-empezar) · [Mozo](#mozo) · [Cajero](#cajero) · [Cocina](#cocina) ·
[Dueño o encargado](#dueño-o-encargado) · [Si algo falla](#si-algo-falla)

---

## Antes de empezar

### Cómo se entra
- **En la PC del local:** abrir el navegador en `http://localhost:3000`.
- **En celulares y tablets del personal:** en la PC, ir a **Menú QR / Display → Conectar celulares y tablets del
  personal** y escanear el QR con el celular. El celular tiene que estar en el **mismo WiFi** que la PC. Para
  tenerlo siempre a mano, se puede imprimir con **Imprimir hoja para el personal**.
- Cada persona entra con **su propio usuario**. Así queda registrado quién hizo cada cosa: cobros, anulaciones,
  descuentos.

### Qué ve cada uno
| Rol | Ve y hace |
|---|---|
| **Mozo** | Mesas, toma pedidos, reservas y clientes. No cobra ni ve la caja. |
| **Cajero** | Todo lo del mozo, más cobrar, descuentos, cancelar pedidos, caja, delivery, cocina, stock y reportes de ventas. |
| **Cocina** | La pantalla de cocina y la consulta de stock. |
| **Encargado** | Todo, menos usuarios, configuración, integraciones y copias de seguridad. |
| **Administrador** | Todo. |

### Fichar
El botón **Fichar** de la barra lateral marca la entrada y, al tocarlo de nuevo, la salida. Si alguien se olvidó,
el encargado lo corrige en **Personal → Fichadas** (queda registrado el motivo).

### Sin internet
Morfi **sigue funcionando sin internet**: pedidos, mesas, cocina, caja y cobros en efectivo o con tarjeta en el
posnet. Arriba aparece un aviso. Lo que necesita internet (facturas de ARCA, cobros con Mercado Pago, WhatsApp, Morfi
Nube) queda **en espera y se envía solo** cuando vuelve la conexión. No hay que volver a cargar nada.

---

## Mozo

1. **Mesas**: tocar una mesa libre para abrirla y elegir los productos. Cada mesa tiene un solo pedido abierto.
2. Para agregar más cosas, se vuelve a tocar la mesa y se suman productos al mismo pedido.
3. Lo que se pide **llega solo a la pantalla de cocina**.
4. **Pedidos desde el QR de la mesa:** si el cliente pide con el QR de su mesa, al mozo le aparece el aviso para
   **Confirmar** o **Rechazar** el pedido (si el local lo configuró así).
5. **"Llamar al mozo" y "pagó":** cuando el cliente toca *Llamar al mozo* o paga desde su celular, aparece el aviso.
6. **Reservas**: en **Mesas → Reservas**, con **Nueva reserva** se carga nombre, teléfono, día, hora y cantidad de
   personas.

---

## Cajero

### Abrir la caja (al empezar el turno)
**Caja → Abrir caja** y escribir con cuánto efectivo se arranca. Sin caja abierta no se puede cobrar.

### Vender en el mostrador, para llevar o delivery
1. **Punto de Venta**: elegir el tipo de pedido (salón, mostrador, para llevar o delivery).
2. Tocar los productos. Se puede elegir el cliente con **Elegir cliente**, para delivery, puntos o factura A.
3. **Cobrar** y elegir el medio de pago: efectivo, tarjeta, transferencia, **QR Mercado Pago** u **Otro medio de
   pago**. En efectivo, Morfi calcula el vuelto.

### Cobrar una mesa
- Desde **Mesas** o **Pedidos**, **Cobrar**.
- **Dividir la cuenta**: en partes iguales, y cada parte se cobra con **Cobrar al siguiente**.
- **Pagos mixtos**: una parte en efectivo y otra con tarjeta, por ejemplo.
- **Propina**: se suma aparte. No va en la factura ni en el IVA, y queda para repartir al personal.
- **Descuento** y **cupones** (si el local tiene Fidelización).
- **Factura ARCA**: si está configurada, la factura sale en el mismo paso. Si no hay internet, queda en espera y se
  emite sola. Si ARCA la rechaza, aparece **Reintentar factura**.
- **Enviar comprobante** o **Enviar por WhatsApp** al cliente.

### Anular o cancelar
Cancelar un pedido o anular un cobro puede pedir el **PIN del encargado** (lo define el local). Una factura ya
emitida no se borra: se hace la nota de crédito desde el pedido.

### Movimientos de caja
**Caja → Ingreso** o **Egreso / retiro**: por ejemplo, un pago a un proveedor en efectivo o un retiro del dueño.
Siempre con el motivo.

### Cerrar la caja (al terminar el turno)
**Caja → Cerrar caja** y contar el efectivo. Si el local usa **Arqueo ciego**, el cajero escribe lo que contó sin
ver cuánto debería haber, y la diferencia la ve el encargado. Los cierres anteriores están en **Historial de cajas**.

---

## Cocina

- **Cocina** (en la PC o en una tablet) muestra los pedidos en tiempo real, del más viejo al más nuevo.
- Al terminar un plato o un pedido, marcarlo **LISTO**. Le avisa al mozo o al mostrador y, en delivery, puede
  avisar al cliente por WhatsApp.
- Para una pantalla grande que solo muestre los pedidos, usar el link de **Display Cocina** (en
  **Menú QR / Display**).

---

## Dueño o encargado

### Todos los días
- **Dashboard**: ventas de hoy y la tarjeta **¿Cuánto gané hoy?**
- **Caja → Historial de cajas**: controlar cierres y diferencias.
- **Pedidos**: ver todo lo vendido, anulaciones y facturas pendientes.

### Carta y precios
- **Productos**: alta de productos, precios y categorías. Lo que se cambia acá se ve al instante en el
  sistema, en la carta QR y en la carta online.
- **Menú QR / Display**: el QR de la carta (para las mesas o la vidriera), **QR de cada mesa: pedir desde la mesa**,
  **Imprimir QR de las mesas** y los **Links para compartir** en WhatsApp e Instagram.

### Stock y proveedores
**Inventario**: stock de cada producto e insumo, con recetas que descuentan los insumos solos. **Proveedores**:
datos y compras.

### Clientes y fidelización
**Clientes**: datos para delivery y factura A. **Fidelización** (plan Pro): puntos, cupones y gift cards.
Los clientes pueden pedir ver o borrar sus datos (Ley 25.326): se editan o se borran desde **Clientes**.

### Personal (plan Pro)
**Personal**: turnos de la semana (**Copiar a la semana siguiente** para no cargarlos de nuevo), fichadas con llegadas
tarde y ausencias, y **Repartir propinas** por horas trabajadas o en partes iguales.

### Números
- **Reportes**: ventas del período, lo más vendido y en qué horarios se vende más.
- **Ganancias** (plan Pro): cuánto queda después de costos, comisiones y gastos fijos; qué platos conviene empujar o
  revisar; punto de equilibrio.
- **Contabilidad** (plan Pro): gastos, cuentas a pagar, IVA, estado de resultados y libro diario.

### Administración (solo administrador)
- **Usuarios**: alta de cada persona con su rol. Al irse alguien, desactivar su usuario.
- **Configuración**: datos del local (nombre, CUIT, dirección, teléfono, que también aparecen en el aviso de
  privacidad del pedido online), cómo llegan los pedidos del QR, arqueo ciego, PIN del encargado, impresora y
  copias de seguridad.
- **Integraciones**: ARCA (factura electrónica), Mercado Pago, WhatsApp Business, apps de delivery y Asistente IA.
- **Tu plan**: qué incluye el plan, cuándo vence y cómo cambiarlo. Si soporte te pasa una licencia, se pega ahí.

### Copias de seguridad
Morfi hace **una copia de la base todos los días**, sola. Conviene tener también la **copia fuera del local** (ver
`docs/INSTALACION.md`): si se roba o se rompe la PC, con esa copia se recupera todo en otra PC.

---

## Si algo falla

| Pasa esto | Hacer esto |
|---|---|
| El celular no abre Morfi | Que esté en el mismo WiFi que la PC. Volver a escanear el QR de **Conectar celulares**. |
| Se cortó internet | Seguir trabajando. Las facturas y los cobros con Mercado Pago se mandan solos al volver. |
| Una factura dice "pendiente" | Se reintenta sola. Si dice "error", tocar **Reintentar factura** o avisar a soporte. |
| Una factura dice "CAEA" en vez de "CAE" | Es normal: ARCA no respondía y salió con el código de contingencia. Es válida y Morfi la informa sola a ARCA cuando vuelve internet. |
| La impresora no imprime | Que esté encendida y con papel. En **Configuración → Impresora**, probar la impresión. |
| La PC no abre Morfi | Reiniciar la PC: Morfi arranca solo. Si sigue sin abrir, avisar a soporte. |
| Algo raro con un cobro o la caja | No borrar nada. Sacar una foto de la pantalla y avisar a soporte. |

**Soporte:** WhatsApp 11 2390-0155, de lunes a sábado de 10 a 20 h. Si el local no puede vender ni cobrar, se
atiende primero.
