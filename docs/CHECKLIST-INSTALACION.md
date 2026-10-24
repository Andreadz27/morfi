# Checklist: instalar Morfi en un cliente

Para imprimir y llevar. El detalle de cada paso está en `docs/INSTALACION.md`.

## El día anterior

- [ ] **Pedirle al cliente por WhatsApp:**
  - [ ] Lista de productos con precios y categorías (Excel, foto de la carta o lo que tenga).
  - [ ] Nombre y email de cada persona que va a usar Morfi, y qué hace (encargado, caja, mozo, cocina).
  - [ ] Si va a facturar con Morfi: CUIT, condición frente al IVA, y que tenga a mano la clave fiscal (nivel 3).
  - [ ] Marca y modelo de las impresoras (comandas y tickets), y si van por cable de red o USB.
  - [ ] Que la PC esté prendida, con Windows 10 u 11, conectada por cable al router, y con la clave de administrador.
  - [ ] Si va a cobrar con Mercado Pago: usuario y contraseña de su cuenta, para que entre él.
- [ ] **Pendrive** con: `instalar.ps1`, este checklist, la orden de alta y el manual de uso.
- [ ] **Imprimir** dos copias de la orden de alta (`docs/legales/ORDEN-DE-ALTA.md`), una para el cliente y otra para vos.
- [ ] **Gestor de contraseñas** abierto en el celular, para guardar la clave de las copias del cliente.

## En el local: instalación (unos 20 minutos)

- [ ] **PC:** Windows 10 u 11, al menos 4 GB de RAM, por cable al router. En la BIOS, *Restore on AC power loss = Power On*
      (si se corta la luz, se prende sola). En el router, reservar la IP de la PC y la de cada impresora de red.
- [ ] Copiar `instalar.ps1` del pendrive al Escritorio. Abrir **PowerShell como administrador** (botón derecho en Inicio
      → *Terminal (administrador)*) y ejecutar:
  ```
  cd $HOME\Desktop
  powershell -ExecutionPolicy Bypass -File instalar.ps1 -Cliente "nombre-del-local" -ActualizacionAutomatica
  ```
  `nombre-del-local` va en minúsculas, sin espacios ni acentos (ej. `pizzeria-don-jose`).
- [ ] Al final, el instalador muestra **en rojo la clave de las copias**: guardarla ya en el gestor de contraseñas,
      con el nombre del cliente. Sin ella, si la PC se rompe, las copias de la nube no se pueden abrir.
- [ ] Abrir `http://localhost:3000`. Entrar con `admin@morfi.local` / `admin123`: el sistema obliga a cambiar la
      contraseña. Elegirla con el dueño y guardarla en el gestor.
- [ ] **Copia fuera de la PC.** Mientras no haya un bucket de copias para el cliente, usar su Google Drive u OneDrive.
      Instalar Drive para escritorio en la PC, y en `C:\Morfi\.env` agregar
      `BACKUP_COPIA_DIR=G:\Mi unidad\Morfi-copias` (la carpeta sincronizada). Después: `pm2 restart morfi`.

## En el local: puesta a punto, con el dueño

- [ ] **Configuración:** tipo de negocio, nombre, dirección, teléfono, CUIT y alícuota de IVA. Estos datos salen en los
      tickets y en el aviso de privacidad del pedido online.
- [ ] **Usuarios:** uno por persona y por rol. Cada uno con su contraseña.
- [ ] **Productos:** categorías y productos con precio. Las recetas e insumos se pueden cargar después.
- [ ] **Impresoras:** Configuración → Impresoras → agregar cada una (IP o USB) y **probar la impresión**.
- [ ] **Mesas:** que coincidan con el salón (nombre y capacidad).
- [ ] **Celulares del personal:** Menú QR → *Conectar celulares* → escanear con cada celular. Imprimir la *hoja para el
      personal* y pegarla en la caja.
- [ ] **Factura electrónica** (si factura con Morfi; si no, se configura otro día):
  - [ ] En ARCA, con la clave fiscal del dueño: punto de venta "Web Services" dado de alta.
  - [ ] Integraciones → AFIP: CUIT, punto de venta, access token y certificado. **Primero en homologación** (prueba).
  - [ ] Opcional, recomendado: punto de venta CAEA para cuando ARCA no responde (`docs/INSTALACION.md`, "CAEA").
- [ ] **Mercado Pago** (si lo usa): Integraciones → Mercado Pago, con el dueño logueado.

## Prueba antes de abrir (obligatoria)

- [ ] Abrir la caja.
- [ ] Una venta en el mostrador: pedido → llega a cocina → cocina lo marca listo → cobrar en efectivo con vuelto → ticket.
- [ ] Una mesa desde un celular: tomar pedido → cobrar dividido (partes iguales o por plato).
- [ ] Si factura: una factura en homologación. Recién después, pasar a producción.
- [ ] Cerrar la caja: tiene que cuadrar.
- [ ] Desactivar los usuarios de prueba, si se crearon.

## Cierre con el cliente

- [ ] Firmar las dos copias de la **orden de alta** (plan, forma de pago, fecha de inicio de la prueba).
- [ ] Explicarle: **30 días de prueba con todo**. Después elige el plan; si no paga, nunca se cortan las ventas, la
      caja, la cocina ni la facturación.
- [ ] Dejarle el **manual de uso** y el WhatsApp de soporte: 11 2390-0155.
- [ ] Mostrarle **Si algo falla** del manual (WiFi, impresora, corte de internet).
- [ ] Anotar: nombre del local (`-Cliente`), IP de la PC, clave de las copias (en el gestor), contraseña del administrador
      (en el gestor), usuarios creados.

## Después (en la semana)

- [ ] Copia en la nube propia del cliente (bucket R2 o B2) y monitoreo (`docs/INSTALACION.md`, puntos 3 y 4).
- [ ] Dirección fija con Cloudflare Tunnel (Mercado Pago con cierre automático, pedidos online, WhatsApp).
- [ ] Conectarlo a Morfi Nube cuando tenga dirección pública.
- [ ] Llamarlo al tercer día: dudas, cosas que faltan cargar.
