# Manual de uso de Fadido

Guía para quienes usan Fadido en el local todos los días. La instalación y la configuración técnica están en
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
Fadido **sigue funcionando sin internet**: pedidos, mesas, cocina, caja y cobros en efectivo o con tarjeta en el
posnet. Arriba aparece un aviso. Lo que necesita internet (facturas de ARCA, cobros con Mercado Pago, WhatsApp, Fadido
Nube) queda **en espera y se envía solo** cuando vuelve la conexión. No hay que volver a cargar nada.

---

## Mozo

1. **Mesas**: tocar una mesa libre para abrirla y elegir los productos. Cada mesa tiene un solo pedido abierto.
2. Para agregar más cosas, se vuelve a tocar la mesa y se suman productos al mismo pedido.
3. Lo que se pide **llega solo a la pantalla de cocina**.
4. **Pedidos desde el QR de la mesa:** si el cliente pide con el QR de su mesa, al mozo le aparece el aviso para
   **Confirmar** o **Rechazar** el pedido (si el local lo configuró así). En **Configuración → "Sin mozo"** el pedido
   del cliente va directo a la cocina sin que nadie lo confirme, y el cliente también paga desde el celular.
5. **"Llamar al mozo" y "pagó":** cuando el cliente toca *Llamar al mozo* o paga desde su celular, aparece el aviso.
   Si avisa que paga **por transferencia**, quien cobra ve *Transferencia recibida: cobrar y cerrar*: con la plata en la
   cuenta, un toque cobra lo que falta y libera la mesa. Con Mercado Pago la mesa se cierra sola al pagar todo.
6. **Si se corta el WiFi del celular** al mandar un pedido o un agregado: aparece "quedó guardado en este celular" y
   un aviso amarillo abajo. No hay que volver a cargarlo, porque se envía solo cuando vuelve el WiFi (o con
   **Reintentar**). Si la mesa se abrió mientras tanto, lo pedido se suma a esa mesa. Si algo no se pudo enviar (por
   ejemplo, un producto que se dio de baja), Fadido avisa para cargarlo de nuevo.
7. **Reservas**: en **Mesas → Reservas**, con **Nueva reserva** se carga nombre, teléfono, día, hora y cantidad de
   personas.

---

## Cajero

### Abrir la caja (al empezar el turno)
**Caja → Abrir caja** y escribir con cuánto efectivo se arranca. Sin caja abierta no se puede cobrar.

### Vender en el mostrador, para llevar o delivery
1. **Punto de Venta**: elegir el tipo de pedido (salón, mostrador, para llevar o delivery).
2. Tocar los productos. Se puede elegir el cliente con **Elegir cliente**, para delivery, puntos o factura A.
3. **Cobrar** y elegir el medio de pago: efectivo, tarjeta, transferencia, **QR Mercado Pago**, **MODO**, **Cuenta DNI** u **Otro medio de
   pago**. En efectivo, Fadido calcula el vuelto.

**Barra o mostrador en un toque**: con los productos en el carrito, **Cobrar y enviar (mostrador)** pide el nombre
(opcional, para llamarlo) y cómo paga: el pedido se cobra y va a la cocina en el mismo paso.

### Pedidos desde la barra y para retirar
- **QR de la barra** (Menú QR → *Imprimir QR de la barra*): el cliente escanea en el mostrador, elige, pone su
  nombre y el pedido va **directo a la cocina** (sale la comanda). En su celular ve el número (#12), si está en
  preparación o listo, y puede pagar con Mercado Pago (si está conectado), por transferencia al alias del local o
  en la caja al retirar.
- **Pantalla de retiro** (Menú QR → *Abrir pantalla de retiro*): para una TV en la barra. Muestra "En preparación" y
  "¡Listos!" con número y nombre; suena cuando uno pasa a listo (tocar la pantalla una vez para activar el sonido).
- **Para retirar** (botón en Punto de Venta): los pedidos de mostrador y barra con su estado y su pago. Si el
  cliente avisó que transfirió, aparece **Avisó transferencia**: cuando la ves en la cuenta, *Transferencia
  recibida* cobra y cierra. Al entregarlo, **Entregado** lo saca de la pantalla.
- Cuando la cocina toca **Listo**, el celular del cliente vibra y suena: "¡Listo! Retiralo en la barra".

### Cobrar una mesa
- Desde **Mesas** o **Pedidos**, **Cobrar**.
- **Dividir la cuenta**: **Partes iguales** (se elige cuántas personas) o **Por plato**: cada persona marca lo que
  comió y paga eso. El descuento y la propina se reparten solos. Después de cada pago, **Cobrar al siguiente** muestra
  solo lo que falta, y el último paga lo que queda.
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

### Cierre del día (encargado y administrador)
En **Caja → Cierre del día** está todo lo que pasó en el día: ventas (por medio de pago, por tipo de pedido y por
persona, ticket promedio y comparación con el mismo día de la semana anterior), la caja (inicial, ventas en efectivo,
ingresos, egresos, esperado, contado y lo cobrado con cada medio de pago), **todos los movimientos de caja** (hora,
concepto y quién), **todos los cobros** (hora, pedido, mesa, medio de pago y monto), compras y gastos, propinas y
su reparto, quién fichó, descuentos y cancelaciones, stock para reponer, lo que quedó pendiente y la copia de
seguridad. **Ver cómo va hoy** lo muestra en el momento; **Cerrar el día ahora** lo guarda (se puede repetir si
después hubo más ventas). Cada cierre se puede abrir e **imprimir** desde la lista.
- **Automático:** en **Configurar** se elige la hora (por defecto 22:00) y los días que abre el local. 15 minutos
  antes aparece el aviso para contar el efectivo.
- **Si a esa hora la caja sigue abierta**, se cierra **sin contar** (nunca se inventa lo contado). Arriba de Caja
  aparece el aviso y el encargado toca **Cargar lo contado**: ahí se ve si faltó o sobró plata.
- **Propinas:** en Configurar se eligen las personas entre las que se reparten, en partes iguales. Si no se elige a
  nadie, se reparten entre los que ficharon ese día.

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
- **Opciones y adicionales** (en Productos): grupos como **"¿Qué leche?"** (se elige una: entera, descremada,
  vegetal +$1300) o **"Adicionales"** (se eligen varios, cada uno con su precio, con tope opcional). En cada grupo
  se agregan, editan o quitan opciones y se marcan los productos que lo usan (con "toda la categoría" de un toque).
  Al agregar ese producto en el **Punto de Venta**, en **Agregar ítem** o en la **carta del QR**, se pregunta qué
  opciones lleva; cocina y el ticket lo ven como "Latte · Leche vegetal" y el recargo se suma solo. Si una opción
  obligatoria no se elige (por ejemplo, un pedido del asistente), va la primera.
- **Para vender más** (venta cruzada): en cada **categoría**, "Acompañalo con" elige qué se sugiere (a los cafés,
  laminados y pastelería); en cada **producto**, la **versión grande** ("¿Lo querés grande?"), el **horario** (las promos
  de 8 a 12: fuera de horario el cliente lo ve pero no lo pide; en el Punto de Venta solo avisa) y, si es un combo,
  **qué incluye** (1 café + 2 medialunas). La carta y el Punto de Venta sugieren después de agregar algo y, si el
  pedido arma un combo suelto que sale más barato, avisan "Te conviene la promo" y lo cambian con un toque.
- **Buscador del Punto de Venta**: escribir parte del nombre filtra en todas las categorías; **Enter** agrega el
  primero y **Esc** borra la búsqueda.
- **Carta en inglés y portugués**: al editar un producto o crear una categoría, abrir **Carta QR en otros idiomas**
  y escribir el nombre (y la descripción) en inglés y portugués. En la carta del QR aparecen los botones
  **ES / EN / PT**; si el celular del cliente está en inglés o portugués, la carta abre en ese idioma. Lo que se deja
  vacío se ve en español. Cocina, caja y tickets siguen siempre en español.
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
  - **Costos de la carta:** todos los productos en una lista para cargar lo que cuesta hacer cada uno (mercadería,
    envase…). Arriba aparecen los que no tienen costo, los más vendidos primero; el margen se calcula al escribir.
    Los que tienen receta toman el costo de sus ingredientes. Sin costo, un producto no se puede evaluar.
  - **Por plato:** separa la carta en *Estrella* (se vende mucho y deja buena ganancia), *Caballo de batalla* (se vende
    mucho pero deja poco: revisar precio o receta), *Rompecabezas* (deja bien pero se vende poco: recomendarlo) y
    *Perro* (poco y poco). Los productos sin costo van al grupo *Sin costo* y no se comparan con los demás.
  - **Canales y horarios → Por momento del día:** ticket promedio, ventas, tickets y lo más vendido en cada momento de
    la carta (Desayuno, Brunch, Almuerzo, Merienda…), según la hora en que se hizo cada pedido.
- **Contabilidad** (plan Pro): gastos, cuentas a pagar, IVA, estado de resultados y libro diario.
  - **Factura de cada compra:** en **Cargar gasto**, tocar **Sacar foto o subir la factura** (foto con el celular o
    PDF). Queda guardada con el gasto y se ve con **Ver factura** en la lista y en el IVA compras. Si está cargada la
    clave de Claude (Integraciones → Asistente IA), Fadido lee la factura y completa fecha, proveedor, comprobante,
    neto, IVA y percepciones: hay que revisarlos antes de guardar. Si el proveedor no está cargado, ofrece agregarlo.
    Arriba de la lista se ve cuántos gastos todavía no tienen la factura adjunta.

### Administración (solo administrador)
- **Usuarios**: alta de cada persona con su rol. Al irse alguien, desactivar su usuario.
- **Configuración**: datos del local (nombre, CUIT, dirección, teléfono, que también aparecen en el aviso de
  privacidad del pedido online), cómo llegan los pedidos del QR, arqueo ciego, PIN del encargado, impresora y
  copias de seguridad.
  - **Eslogan** (opcional, ej. "Café & cosas ricas"): aparece debajo del nombre en la carta online y en el ticket.
- **Integraciones**: ARCA (factura electrónica), Mercado Pago, WhatsApp Business, apps de delivery y Asistente IA.
- **Tu plan**: qué incluye el plan, cuándo vence y cómo cambiarlo. Si soporte te pasa una licencia, se pega ahí.

### Copias de seguridad
Fadido hace **una copia de la base todos los días**, sola. Conviene tener también la **copia fuera del local** (ver
`docs/INSTALACION.md`): si se roba o se rompe la PC, con esa copia se recupera todo en otra PC.

---

## Si algo falla

| Pasa esto | Hacer esto |
|---|---|
| El celular no abre Fadido | Que esté en el mismo WiFi que la PC. Volver a escanear el QR de **Conectar celulares**. |
| Se cortó internet | Seguir trabajando. Las facturas y los cobros con Mercado Pago se mandan solos al volver. |
| Una factura dice "pendiente" | Se reintenta sola. Si dice "error", tocar **Reintentar factura** o avisar a soporte. |
| Una factura dice "CAEA" en vez de "CAE" | Es normal: ARCA no respondía y salió con el código de contingencia. Es válida y Fadido la informa sola a ARCA cuando vuelve internet. |
| La impresora no imprime | Que esté encendida y con papel. En **Configuración → Impresora**, probar la impresión. |
| La PC no abre Fadido | Reiniciar la PC: Fadido arranca solo. Si sigue sin abrir, avisar a soporte. |
| Algo raro con un cobro o la caja | No borrar nada. Sacar una foto de la pantalla y avisar a soporte. |

**Soporte:** WhatsApp 11 2390-0155, de lunes a sábado de 10 a 20 h. Si el local no puede vender ni cobrar, se
atiende primero.
