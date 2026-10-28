// FADIDO - Pedido Online (WhatsApp / Instagram)
function pdM(v){return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",minimumFractionDigits:0}).format(v||0);}
// Argumento para un onclick="...": número tal cual, texto entre comillas simples (con comillas dobles cortaba el atributo)
function pdA(v){return typeof v==="number"?String(v):"'"+String(v).replace(/[^\w-]/g,"")+"'";}
function pdE(s){if(s==null)return"";return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// Desde Fadido Nube la página vive en /l/<local>/: la API también
const PD_API=(location.pathname.match(/^\/l\/[^/]+/)||[""])[0];

// Carta en español, inglés y portugués. Los platos traen sus traducciones desde el local (si faltan, en español);
// los textos de la página están acá. Lo que ve cocina y caja sigue en español.
const PD_TEXTOS={
  es:{acompana:"Acompañalo con",grande_q:"¿Lo querés grande? +{m}",conviene:"Te conviene: {c}. Ahorrás {m}",cambiar:"Cambiar",se_pide:"Se pide {h}",dias:["dom","lun","mar","mié","jue","vie","sáb"],dias_todos:"todos los días",de_a:"de {d} a {h}",de_h:"de {a} a {b}",op_una:"Elegí una",op_opcional:"Opcional",op_hasta:"Hasta {n}",op_varias:"Elegí las que quieras",op_falta:"Elegí: {g}",op_agregar:"Agregar {m}",cancelar:"Cancelar",letra:"Letra más grande",toda_carta:"Toda la carta",buscar_ph:"Buscar en la carta",sin_resultados:"No encontramos nada con esa búsqueda.",b_mas:"Lo más pedido",b_nuevo:"Nuevo",b_reco:"Recomendado",online_sub:"Arma tu pedido y lo recibimos enseguida",ver_sub:"Nuestra carta",mesa_sub:"Elegí, enviá tu pedido y el mozo lo confirma",carta_sub:"Mirá la carta y llamá al mozo cuando quieras pedir",
    llamar_mozo:"Llamar al mozo",pedir_cuenta:"Pedir la cuenta",tu_pedido:"Tu pedido",vacio:"Todavía no agregaste nada",total_estimado:"Total estimado",confirmar:"Confirmar pedido",
    tus_datos:"Tus datos",nombre:"Nombre",nombre_opc:"Tu nombre (opcional)",nombre_ph:"Tu nombre",telefono:"Teléfono",como:"¿Cómo lo querés?",retiro:"Retiro en el local",delivery:"Delivery",
    direccion:"Dirección de entrega",direccion_ph:"Calle, número, piso/dpto",notas:"Notas / aclaraciones",notas_ph:"Sin cebolla, sin sal, etc.",volver:"Volver",enviar:"Enviar pedido",enviar_mozo:"Enviar al mozo",
    enviando:"Enviando...",todas:"Todas",agregar:"Agregar",item:"item",items:"items",resumen:"Resumen del pedido",la_cuenta:"La cuenta",total_mesa:"Total de la mesa",ya_pagado:"Ya pagado",
    falta_pagar:"Falta pagar",mp_titulo:"Pagar ahora con Mercado Pago",toda_cuenta:"Toda la cuenta",mi_parte:"Mi parte: dividir entre",personas:"personas",propina_equipo:"Propina para el equipo",
    sin_propina:"Sin propina",otra:"Otra",cuenta:"Cuenta",tu_parte:"Tu parte",propina:"Propina",pagas:"Pagás",pagar_mp:"Pagar {m} con Mercado Pago",abriendo_mp:"Abriendo Mercado Pago...",
    otra_forma:"¿Pagás de otra forma? Te traemos la cuenta",como_pagas:"¿Cómo pagás? Te traemos la cuenta",efectivo:"Efectivo",tarjeta:"Tarjeta",transferencia:"Transferencia",transferi_a:"Transferí a este alias",titular:"Titular",copiar:"Copiar",copiado:"Copiado",aviso_transferi:"Ya transferí: avisar al mozo",cuenta_en_camino:"Listo: el mozo te trae la cuenta.",
    tus_pedidos:"Tus pedidos",tu_cuenta:"Tu cuenta",total:"Total",descuento:"Descuento",pagado:"Pagado",
    est_pendiente:"Esperando al mozo",est_confirmada:"Confirmado, en preparación",est_rechazada:"No se pudo tomar",est_atendida:"El mozo ya viene",avisado:"Avisado",
    tit_pedido:"Pedido",tit_mozo:"Llamaste al mozo",tit_cuenta:"Pediste la cuenta",sin_productos:"No hay productos.",sin_productos_cat:"Sin productos en esta categoría.",
    qr_invalido:"Este QR no corresponde a ninguna mesa. Pedile ayuda al mozo.",sin_menu:"No se pudo cargar la carta.",recibido:"¡Pedido recibido!",enviado:"Pedido enviado",
    otro_pedido:"Hacer otro pedido",consultar_wa:"Consultar por WhatsApp",gracias:"¡Gracias {n}! Recibimos tu pedido y en breve te contactamos.",numero:"Número de pedido:",
    completa_datos:"Completá nombre y teléfono.",completa_dir:"Completá la dirección de entrega.",agrega_algo:"Agregá al menos un producto.",
    listo_cocina:"¡Listo{n}! Tu pedido ya está en preparación.",espera_mozo:"¡Gracias{n}! El mozo lo confirma en un momento: abajo ves cuándo pasa a cocina.",
    pago_ok:"¡Pago aprobado! Gracias.",cuenta_paga:" La cuenta quedó paga.",falta_resto:" Falta pagar el resto de la mesa.",
    pago_proceso:"Tu pago está en proceso: cuando Mercado Pago lo apruebe, se acredita solo.",pago_no:"El pago no se completó. Podés intentar de nuevo o pedirle la cuenta al mozo."},
  en:{acompana:"Goes great with",grande_q:"Make it large? +{m}",conviene:"Better deal: {c}. You save {m}",cambiar:"Switch",se_pide:"Available {h}",dias:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],dias_todos:"every day",de_a:"{d} to {h}",de_h:"from {a} to {b}",op_una:"Choose one",op_opcional:"Optional",op_hasta:"Up to {n}",op_varias:"Choose any",op_falta:"Please choose: {g}",op_agregar:"Add {m}",cancelar:"Cancel",letra:"Bigger text",toda_carta:"Full menu",buscar_ph:"Search the menu",sin_resultados:"Nothing matches your search.",b_mas:"Most ordered",b_nuevo:"New",b_reco:"Our pick",online_sub:"Build your order and we'll get it right away",ver_sub:"Our menu",mesa_sub:"Choose, send your order and the waiter confirms it",carta_sub:"Browse the menu and call the waiter when you're ready to order",
    llamar_mozo:"Call the waiter",pedir_cuenta:"Ask for the bill",tu_pedido:"Your order",vacio:"You haven't added anything yet",total_estimado:"Estimated total",confirmar:"Confirm order",
    tus_datos:"Your details",nombre:"Name",nombre_opc:"Your name (optional)",nombre_ph:"Your name",telefono:"Phone",como:"How would you like it?",retiro:"Pick up at the store",delivery:"Delivery",
    direccion:"Delivery address",direccion_ph:"Street, number, floor/apt",notas:"Notes",notas_ph:"No onion, no salt, etc.",volver:"Back",enviar:"Send order",enviar_mozo:"Send to the waiter",
    enviando:"Sending...",todas:"All",agregar:"Add",item:"item",items:"items",resumen:"Order summary",la_cuenta:"The bill",total_mesa:"Table total",ya_pagado:"Already paid",
    falta_pagar:"Left to pay",mp_titulo:"Pay now with Mercado Pago",toda_cuenta:"The whole bill",mi_parte:"My share: split between",personas:"people",propina_equipo:"Tip for the team",
    sin_propina:"No tip",otra:"Other",cuenta:"Bill",tu_parte:"Your share",propina:"Tip",pagas:"You pay",pagar_mp:"Pay {m} with Mercado Pago",abriendo_mp:"Opening Mercado Pago...",
    otra_forma:"Paying another way? We'll bring you the bill",como_pagas:"How will you pay? We'll bring you the bill",efectivo:"Cash",tarjeta:"Card",transferencia:"Bank transfer",transferi_a:"Transfer to this alias",titular:"Account holder",copiar:"Copy",copiado:"Copied",aviso_transferi:"I've transferred: let the waiter know",cuenta_en_camino:"Done: the waiter is bringing your bill.",
    tus_pedidos:"Your orders",tu_cuenta:"Your bill",total:"Total",descuento:"Discount",pagado:"Paid",
    est_pendiente:"Waiting for the waiter",est_confirmada:"Confirmed, being prepared",est_rechazada:"Couldn't be taken",est_atendida:"The waiter is on the way",avisado:"Notified",
    tit_pedido:"Order",tit_mozo:"You called the waiter",tit_cuenta:"You asked for the bill",sin_productos:"No items.",sin_productos_cat:"No items in this category.",
    qr_invalido:"This QR doesn't belong to any table. Please ask the waiter for help.",sin_menu:"The menu couldn't be loaded.",recibido:"Order received!",enviado:"Order sent",
    otro_pedido:"Place another order",consultar_wa:"Ask on WhatsApp",gracias:"Thank you {n}! We got your order and will contact you shortly.",numero:"Order number:",
    completa_datos:"Please enter your name and phone.",completa_dir:"Please enter the delivery address.",agrega_algo:"Add at least one item.",
    listo_cocina:"Done{n}! Your order is being prepared.",espera_mozo:"Thank you{n}! The waiter will confirm it shortly: below you'll see when it goes to the kitchen.",
    pago_ok:"Payment approved! Thank you.",cuenta_paga:" The bill is fully paid.",falta_resto:" The rest of the table still has to pay.",
    pago_proceso:"Your payment is being processed: once Mercado Pago approves it, it will be credited automatically.",pago_no:"The payment wasn't completed. You can try again or ask the waiter for the bill."},
  pt:{acompana:"Combina com",grande_q:"Quer grande? +{m}",conviene:"Vale mais a pena: {c}. Você economiza {m}",cambiar:"Trocar",se_pide:"Disponível {h}",dias:["dom","seg","ter","qua","qui","sex","sáb"],dias_todos:"todos os dias",de_a:"de {d} a {h}",de_h:"das {a} às {b}",op_una:"Escolha uma",op_opcional:"Opcional",op_hasta:"Até {n}",op_varias:"Escolha as que quiser",op_falta:"Escolha: {g}",op_agregar:"Adicionar {m}",cancelar:"Cancelar",letra:"Letra maior",toda_carta:"Cardápio completo",buscar_ph:"Buscar no cardápio",sin_resultados:"Não encontramos nada com essa busca.",b_mas:"Mais pedido",b_nuevo:"Novo",b_reco:"Recomendado",online_sub:"Monte seu pedido e recebemos na hora",ver_sub:"Nosso cardápio",mesa_sub:"Escolha, envie seu pedido e o garçom confirma",carta_sub:"Veja o cardápio e chame o garçom quando quiser pedir",
    llamar_mozo:"Chamar o garçom",pedir_cuenta:"Pedir a conta",tu_pedido:"Seu pedido",vacio:"Você ainda não adicionou nada",total_estimado:"Total estimado",confirmar:"Confirmar pedido",
    tus_datos:"Seus dados",nombre:"Nome",nombre_opc:"Seu nome (opcional)",nombre_ph:"Seu nome",telefono:"Telefone",como:"Como você prefere?",retiro:"Retirar no local",delivery:"Delivery",
    direccion:"Endereço de entrega",direccion_ph:"Rua, número, andar/apto",notas:"Observações",notas_ph:"Sem cebola, sem sal, etc.",volver:"Voltar",enviar:"Enviar pedido",enviar_mozo:"Enviar ao garçom",
    enviando:"Enviando...",todas:"Todas",agregar:"Adicionar",item:"item",items:"itens",resumen:"Resumo do pedido",la_cuenta:"A conta",total_mesa:"Total da mesa",ya_pagado:"Já pago",
    falta_pagar:"Falta pagar",mp_titulo:"Pagar agora com Mercado Pago",toda_cuenta:"A conta toda",mi_parte:"Minha parte: dividir entre",personas:"pessoas",propina_equipo:"Gorjeta para a equipe",
    sin_propina:"Sem gorjeta",otra:"Outra",cuenta:"Conta",tu_parte:"Sua parte",propina:"Gorjeta",pagas:"Você paga",pagar_mp:"Pagar {m} com Mercado Pago",abriendo_mp:"Abrindo o Mercado Pago...",
    otra_forma:"Vai pagar de outro jeito? Levamos a conta",como_pagas:"Como vai pagar? Levamos a conta",efectivo:"Dinheiro",tarjeta:"Cartão",transferencia:"Transferência",transferi_a:"Transfira para este alias",titular:"Titular",copiar:"Copiar",copiado:"Copiado",aviso_transferi:"Já transferi: avisar o garçom",cuenta_en_camino:"Pronto: o garçom já leva a conta.",
    tus_pedidos:"Seus pedidos",tu_cuenta:"Sua conta",total:"Total",descuento:"Desconto",pagado:"Pago",
    est_pendiente:"Aguardando o garçom",est_confirmada:"Confirmado, em preparo",est_rechazada:"Não foi possível aceitar",est_atendida:"O garçom já vem",avisado:"Avisado",
    tit_pedido:"Pedido",tit_mozo:"Você chamou o garçom",tit_cuenta:"Você pediu a conta",sin_productos:"Não há produtos.",sin_productos_cat:"Sem produtos nesta categoria.",
    qr_invalido:"Este QR não corresponde a nenhuma mesa. Peça ajuda ao garçom.",sin_menu:"Não foi possível carregar o cardápio.",recibido:"Pedido recebido!",enviado:"Pedido enviado",
    otro_pedido:"Fazer outro pedido",consultar_wa:"Falar no WhatsApp",gracias:"Obrigado {n}! Recebemos seu pedido e entraremos em contato em breve.",numero:"Número do pedido:",
    completa_datos:"Preencha nome e telefone.",completa_dir:"Preencha o endereço de entrega.",agrega_algo:"Adicione pelo menos um produto.",
    listo_cocina:"Pronto{n}! Seu pedido já está em preparo.",espera_mozo:"Obrigado{n}! O garçom confirma em instantes: abaixo você vê quando vai para a cozinha.",
    pago_ok:"Pagamento aprovado! Obrigado.",cuenta_paga:" A conta foi paga.",falta_resto:" Falta pagar o resto da mesa.",
    pago_proceso:"Seu pagamento está em processamento: quando o Mercado Pago aprovar, ele é creditado automaticamente.",pago_no:"O pagamento não foi concluído. Você pode tentar de novo ou pedir a conta ao garçom."}
};
const PD_IDIOMAS={es:"ES",en:"EN",pt:"PT"};
function pdIdiomaInicial(){
  let g="";try{g=localStorage.getItem("morfi_carta_idioma")||"";}catch(e){}
  if(PD_TEXTOS[g])return g;
  const n=(navigator.language||"es").slice(0,2).toLowerCase();
  return PD_TEXTOS[n]?n:"es";
}
let PD_IDIOMA=pdIdiomaInicial();
try{if(localStorage.getItem("morfi_carta_letra")==="1")document.addEventListener("DOMContentLoaded",()=>document.body.classList.add("letra-grande"),{once:true});}catch(e){}
// Texto de la página en el idioma elegido; {n} y {m} se reemplazan
function pdT(k,vars){let s=(PD_TEXTOS[PD_IDIOMA]||PD_TEXTOS.es)[k]||PD_TEXTOS.es[k]||k;for(const[a,b]of Object.entries(vars||{}))s=s.replace("{"+a+"}",b);return s;}
// Nombre o descripción de un plato/categoría en el idioma elegido (si no está traducido, en español)
function pdTr(x,campo){const t=x&&x.traducciones&&x.traducciones[PD_IDIOMA];return(t&&t[campo])||(x?x[campo]:"")||"";}

const PedidoOnline={
  categorias:[],productos:[],carrito:[],catActiva:"todas",origen:"web",config:{},
  // Momentos del día (Desayuno, Brunch...): la carta abre en el de la hora; "todo" = toda la carta
  momentos:[],momentoActivo:"todo",busqueda:"",
  // Desde el QR de una mesa: clave de la mesa y su estado (pedidos enviados, cuenta)
  mesaToken:"",mesa:null,
  // ?ver=1: solo la carta, sin pedir (el QR general de la vidriera y la carta de antes, menu.html)
  soloVer:false,

  async init(){
    const p=new URLSearchParams(location.search);
    const o=p.get("origen")||"web";
    this.origen=["whatsapp","instagram","web"].includes(o)?o:"web";
    this.mesaToken=/^[a-f0-9]{24}$/.test(p.get("mesa")||"")?p.get("mesa"):"";
    this.soloVer=!this.mesaToken&&p.get("ver")==="1";
    if(this.soloVer)["carritoSidebar","carritoFlotante"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});
    else if(!this.mesaToken)this._badge();
    try{
      const[m,info,mesa]=await Promise.all([
        fetch(PD_API+"/api/publico/menu").then(r=>r.json()),
        fetch(PD_API+"/api/publico/info").then(r=>r.json()).catch(()=>({})),
        this.mesaToken?fetch(PD_API+"/api/publico/mesa/"+this.mesaToken).then(r=>r.ok?r.json():null):null
      ]);
      if(this.mesaToken&&!mesa){
        document.getElementById("menuItems").innerHTML='<div class="menu-empty"><i class="fas fa-exclamation-triangle"></i><p>'+pdE(pdT("qr_invalido"))+'</p></div>';
        return;
      }
      this.categorias=m.categorias||[];
      this.momentos=m.momentos||[];
      this.grupos=m.grupos||[];
      this.momentoActivo=m.momento_actual||"todo";
      this.productos=m.productos||[];
      this.config=info;
      if(info.nombre){document.getElementById("negocioNombre").textContent=info.nombre;document.title="Pedido | "+info.nombre;}
      if(info.eslogan){const es=document.getElementById("negocioEslogan");es.textContent=info.eslogan;es.hidden=false;}
      this._selectorIdioma();
      if(mesa)this._iniciarMesa(mesa);else this._textos();
      if(info.recibe_pedidos===false&&info.aviso){const av=document.createElement("div");av.className="mesa-seguimiento";av.textContent=info.aviso;document.getElementById("menuItems").before(av);}
      if(info.telefono){
        const wa=document.getElementById("confirmacionWA");
        if(wa){wa.href="https://wa.me/"+info.telefono.replace(/\D/g,"");wa.style.display="";}
      }
      this._avisoDatos(info);
      this.paintMomentos();this.paintCats();this.paintItems();this._initEvents();
    }catch(err){
      document.getElementById("menuItems").innerHTML='<div class="menu-empty"><i class="fas fa-exclamation-triangle"></i><p>'+pdE(pdT("sin_menu"))+'</p></div>';
    }
  },

  // ── Idioma y letra grande ──
  // Los idiomas aparecen solo si el local tradujo algo de la carta (si no, quedaría todo en español igual).
  // "Aa" agranda la letra (para quien ve poco); se recuerda en este celular.
  _selectorIdioma(){
    const hay=[...this.categorias,...this.productos].some(x=>x.traducciones&&Object.keys(x.traducciones).length);
    const el=document.getElementById("selectorIdioma");
    if(!hay)PD_IDIOMA="es";
    if(!el)return;
    const grande=document.body.classList.contains("letra-grande");
    el.innerHTML=(hay?Object.entries(PD_IDIOMAS).map(([k,l])=>`<button type="button" lang="${k}" class="${k===PD_IDIOMA?"activo":""}" aria-pressed="${k===PD_IDIOMA}" onclick="PedidoOnline.setIdioma('${k}')">${l}</button>`).join(""):"")+
      `<button type="button" class="boton-letra ${grande?"activo":""}" aria-pressed="${grande}" aria-label="${pdE(pdT("letra"))}" title="${pdE(pdT("letra"))}" onclick="PedidoOnline.letraGrande()">A<span>A</span></button>`;
    el.style.display="";
  },
  letraGrande(){
    const on=document.body.classList.toggle("letra-grande");
    try{localStorage.setItem("morfi_carta_letra",on?"1":"0");}catch(e){}
    this._selectorIdioma();
  },
  setIdioma(k){
    if(!PD_TEXTOS[k])return;
    PD_IDIOMA=k;try{localStorage.setItem("morfi_carta_idioma",k);}catch(e){}
    this._selectorIdioma();this._textos();
    this.paintMomentos();this.paintCats();this.paintItems();this.paintCarrito();
    if(this.mesa)this._pintarMesa(this.mesa);
    if(document.getElementById("pagoModal").style.display!=="none")this._pintarPago();
  },
  // Textos fijos de la página (los marcados con data-i18n) y los que cambian si se pide desde la mesa
  _textos(){
    document.documentElement.lang=PD_IDIOMA;
    document.querySelectorAll("[data-i18n]").forEach(e=>{e.textContent=pdT(e.dataset.i18n);});
    document.querySelectorAll("[data-i18n-ph]").forEach(e=>{e.placeholder=pdT(e.dataset.i18nPh);});
    const sub=document.getElementById("negocioSub");
    if(this.mesa)sub.textContent=pdT(this.mesa.modo==="solo_carta"?"carta_sub":"mesa_sub");
    else sub.textContent=this.soloVer?pdT("ver_sub"):(this.config.descripcion||pdT("online_sub"));
    const lbl=document.getElementById("labelNombre");
    if(this.mesaToken)lbl.textContent=pdT("nombre_opc");
    else lbl.innerHTML=pdE(pdT("nombre"))+' <span aria-hidden="true">*</span>';
    if(this.mesaToken)["btnConfirmar","btnConfirmarMobile"].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML='<i class="fas fa-paper-plane"></i> '+pdE(pdT("enviar_mozo"));});
    this._avisoDatos(this.config);
  },
  _btnEnviar(){const b=document.getElementById("btnEnviar");if(b){b.disabled=false;b.innerHTML='<i class="fas fa-paper-plane"></i> '+pdE(pdT("enviar"));}},
  // Nombre a mostrar de un producto del carrito (el carrito guarda el id; el nombre sale de la carta)
  _nombreItem(i){
    const base=pdTr(this.productos.find(p=>p.id===i.producto_id)||i,"nombre");
    const ops=(i.opciones||[]).map(id=>{for(const g of this.grupos){const o=g.opciones.find(x=>x.id===id);if(o)return pdTr(o,"nombre");}return"";}).filter(Boolean);
    return ops.length?base+" · "+ops.join(", "):base;
  },

  // Aviso de privacidad (Ley 25.326, art. 6): quién guarda los datos, para qué y cómo pedir verlos o borrarlos.
  // El responsable es el local; por la nube los datos solo pasan hasta que el local recibe el pedido.
  _avisoDatos(info){
    const el=document.getElementById("avisoDatos");
    if(!el)return;
    const quien=(info.nombre||"El local")+(info.cuit?" (CUIT "+info.cuit+")":"");
    const contacto=[info.telefono&&("al "+info.telefono),info.email&&("a "+info.email)].filter(Boolean).join(" o ");
    const contactoOtro=[info.telefono,info.email].filter(Boolean).join(" / ");
    if(PD_IDIOMA==="en"){
      el.textContent=quien+" uses your details only to prepare and deliver your order; it does not sell or share them."+
        (PD_API?" They go through Fadido Nube only until the store receives the order.":"")+
        " You can ask to see, correct or delete them"+(contactoOtro?" by writing to "+contactoOtro:" at the store")+". Argentine Law 25.326.";
      return;
    }
    if(PD_IDIOMA==="pt"){
      el.textContent=quien+" usa seus dados só para preparar e entregar seu pedido; não os vende nem os repassa."+
        (PD_API?" Passam pelo Fadido Nube só até o local receber o pedido.":"")+
        " Você pode pedir para vê-los, corrigi-los ou apagá-los"+(contactoOtro?" escrevendo para "+contactoOtro:" no local")+". Lei argentina 25.326.";
      return;
    }
    el.textContent="Tus datos los usa "+quien+" solo para preparar y entregar tu pedido; no los vende ni los cede."+
      (PD_API?" Pasan por Fadido Nube solo hasta que el local recibe el pedido.":"")+
      " Podés pedir verlos, corregirlos o borrarlos"+(contacto?" escribiendo "+contacto:" en el local")+". Ley 25.326.";
  },

  // ── Pedido desde la mesa ──
  _iniciarMesa(estado){
    const b=document.getElementById("origenBadge");
    if(b){b.innerHTML='<i class="fas fa-chair"></i> '+pdE(estado.mesa.nombre);b.className="origen-badge-hero badge-web";b.style.display="";}
    document.getElementById("mesaPanel").style.display="";
    // Formulario: no hace falta teléfono ni tipo de entrega; el nombre es opcional
    ["grupoTelefono","grupoTipo","grupoDireccion"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});
    document.getElementById("clienteTelefono").required=false;
    document.getElementById("clienteNombre").required=false;
    this._pintarMesa(estado);
    this._textos();
    // El cliente ve cuándo el mozo confirma: se consulta cada 10 s mientras la página está a la vista
    setInterval(()=>{if(!document.hidden)this._refrescarMesa();},10000);
    // Vuelta de Mercado Pago: ?pago=<intento>&payment_id=...&status=...
    const q=new URLSearchParams(location.search);
    if(/^\d+$/.test(q.get("pago")||""))this._volverDePago(q.get("pago"),q.get("payment_id")||q.get("collection_id")||"",q.get("status")||q.get("collection_status")||"");
  },

  // ── Pagar desde la mesa ──
  pagoOpc:{modo:"todo",partes:2,propina:0,propinaOtra:""},
  abrirCuenta(){
    const e=this.mesa||{};const c=e.cuenta;
    // Sin cuenta abierta o sin Mercado Pago: se avisa al mozo como antes
    if(!c||!(c.saldo>0)){this.llamar("cuenta");return;}
    this._pintarPago();
    document.getElementById("pagoModal").style.display="";document.body.style.overflow="hidden";
  },
  cerrarCuenta(){document.getElementById("pagoModal").style.display="none";document.body.style.overflow="";},
  _calcPago(){
    const c=this.mesa.cuenta,o=this.pagoOpc;
    const n=Math.max(2,Math.min(20,parseInt(o.partes,10)||2));
    const parte=o.modo==="todo"?c.saldo:Math.min(c.saldo,Math.ceil(c.saldo/n*100)/100);
    const propina=o.propina==="otra"?Math.max(0,Math.round((parseFloat(String(o.propinaOtra).replace(",","."))||0)*100)/100):Math.round(parte*o.propina)/100;
    return{n,parte,propina,total:Math.round((parte+propina)*100)/100};
  },
  _pintarPago(){
    const e=this.mesa,c=e.cuenta,o=this.pagoOpc,k=this._calcPago();
    const chip=(v,l)=>`<button type="button" class="pago-chip ${o.propina===v?"activo":""}" onclick="PedidoOnline.opcPago('propina',${pdA(v)})">${l}</button>`;
    const mp=e.pago&&e.pago.mercadopago?`
      <div class="pago-seccion">
        <h4><i class="fas fa-mobile-alt"></i> ${pdE(pdT("mp_titulo"))}</h4>
        <label class="tipo-opcion"><input type="radio" name="pagoModo" ${o.modo==="todo"?"checked":""} onchange="PedidoOnline.opcPago('modo','todo')"><span>${pdE(pdT("toda_cuenta"))}</span></label>
        <label class="tipo-opcion"><input type="radio" name="pagoModo" ${o.modo==="partes"?"checked":""} onchange="PedidoOnline.opcPago('modo','partes')"><span>${pdE(pdT("mi_parte"))}
          <input type="number" id="pagoPartes" min="2" max="20" value="${k.n}" onchange="PedidoOnline.opcPago('partes',this.value)" onfocus="PedidoOnline.elegirPartes()" onclick="event.stopPropagation()" class="pago-partes"> ${pdE(pdT("personas"))}</span></label>
        <div class="pago-propina"><span>${pdE(pdT("propina_equipo"))}</span><div>${chip(0,pdE(pdT("sin_propina")))}${chip(10,"10%")}${chip(15,"15%")}${chip("otra",pdE(pdT("otra")))}</div>
          ${o.propina==="otra"?`<input type="number" id="pagoPropinaOtra" min="0" step="1" placeholder="$" value="${pdE(o.propinaOtra)}" oninput="PedidoOnline.opcPago('propinaOtra',this.value,true)">`:""}</div>
        <div class="resumen-row"><span>${pdE(pdT(o.modo==="todo"?"cuenta":"tu_parte"))}</span><strong>${pdM(k.parte)}</strong></div>
        ${k.propina?`<div class="resumen-row"><span>${pdE(pdT("propina"))}</span><strong>${pdM(k.propina)}</strong></div>`:""}
        <div class="resumen-total"><span>${pdE(pdT("pagas"))}</span><strong id="pagoTotal">${pdM(k.total)}</strong></div>
        <button class="btn btn-primary btn-block mt-10" id="btnPagarMP" onclick="PedidoOnline.pagarMP()"><i class="fas fa-lock"></i> ${pdE(pdT("pagar_mp",{m:pdM(k.total)}))}</button>
      </div>`:"";
    document.getElementById("pagoContenido").innerHTML=`
      <div class="form-resumen">
        <div class="resumen-row"><span>${pdE(pdT("total_mesa"))}</span><strong>${pdM(c.total)}</strong></div>
        ${c.pagado?`<div class="resumen-row"><span>${pdE(pdT("ya_pagado"))}</span><strong>-${pdM(c.pagado)}</strong></div>`:""}
        <div class="resumen-total"><span>${pdE(pdT("falta_pagar"))}</span><strong>${pdM(c.saldo)}</strong></div>
      </div>
      ${mp}
      <div class="pago-seccion">
        <h4>${pdE(pdT(mp?"otra_forma":"como_pagas"))}</h4>
        <div class="mesa-acciones">
          <button class="btn btn-outline" onclick="PedidoOnline.cuentaAlMozo('efectivo')"><i class="fas fa-money-bill-wave"></i> ${pdE(pdT("efectivo"))}</button>
          <button class="btn btn-outline" onclick="PedidoOnline.cuentaAlMozo('tarjeta')"><i class="fas fa-credit-card"></i> ${pdE(pdT("tarjeta"))}</button>
          ${e.pago&&e.pago.transferencia?`<button class="btn btn-outline" onclick="PedidoOnline.verTransferencia()"><i class="fas fa-university"></i> ${pdE(pdT("transferencia"))}</button>`:""}
        </div>
        <div id="pagoTransferencia"></div>
      </div>`;
  },
  // Transferencia: el alias para copiar y, cuando transfirió, avisa al mozo (que lo verifica antes de cerrar la mesa)
  verTransferencia(){
    const tr=this.mesa.pago.transferencia,c=this.mesa.cuenta;
    document.getElementById("pagoTransferencia").innerHTML=`
      <div class="form-resumen mt-10">
        <div class="resumen-row"><span>${pdE(pdT("transferi_a"))}</span></div>
        <div class="resumen-total"><strong id="aliasTransferencia">${pdE(tr.alias)}</strong>
          <button type="button" class="btn btn-outline btn-sm" onclick="PedidoOnline.copiarAlias(this)"><i class="fas fa-copy"></i> ${pdE(pdT("copiar"))}</button></div>
        ${tr.titular?`<div class="resumen-row"><span>${pdE(pdT("titular"))}</span><strong>${pdE(tr.titular)}</strong></div>`:""}
        <div class="resumen-row"><span>${pdE(pdT("falta_pagar"))}</span><strong>${pdM(c.saldo)}</strong></div>
        <button class="btn btn-primary btn-block mt-10" onclick="PedidoOnline.cuentaAlMozo('transferencia')"><i class="fas fa-check"></i> ${pdE(pdT("aviso_transferi"))}</button>
      </div>`;
  },
  async copiarAlias(btn){
    const alias=this.mesa.pago.transferencia.alias;
    try{await navigator.clipboard.writeText(alias);}catch(e){
      const r=document.createRange();r.selectNodeContents(document.getElementById("aliasTransferencia"));const s=getSelection();s.removeAllRanges();s.addRange(r);
    }
    btn.innerHTML='<i class="fas fa-check"></i> '+pdE(pdT("copiado"));
  },
  // Tocar la cantidad de personas elige "Mi parte" (si no, seguía cobrando la cuenta entera)
  elegirPartes(){
    if(this.pagoOpc.modo==="partes")return;
    this.pagoOpc.modo="partes";this._pintarPago();
    const i=document.getElementById("pagoPartes");i.focus();i.select();
  },
  // sinRepintar: al escribir la propina no se rehace el formulario (se perdería el foco)
  opcPago(campo,valor,sinRepintar){
    this.pagoOpc[campo]=valor;
    if(!sinRepintar)return this._pintarPago();
    const k=this._calcPago();
    document.getElementById("pagoTotal").textContent=pdM(k.total);
    document.getElementById("btnPagarMP").innerHTML='<i class="fas fa-lock"></i> '+pdE(pdT("pagar_mp",{m:pdM(k.total)}));
  },
  async pagarMP(){
    const o=this.pagoOpc,k=this._calcPago();
    const btn=document.getElementById("btnPagarMP");btn.disabled=true;
    btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> '+pdE(pdT("abriendo_mp"));
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pagar",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({partes:o.modo==="todo"?1:k.n,propina:k.propina})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo iniciar el pago");
      location.href=d.link;
    }catch(err){alert(err.message);this._pintarPago();}
  },
  async cuentaAlMozo(forma){
    this.cerrarCuenta();
    await this.llamar("cuenta",forma);
    this._aviso(pdT("cuenta_en_camino"));
  },
  _aviso(texto){
    const a=document.getElementById("mesaAviso");
    a.textContent=texto;a.style.display="";
    clearTimeout(this._avisoTimer);this._avisoTimer=setTimeout(()=>{a.style.display="none";},15000);
  },
  async _volverDePago(id,paymentId,status){
    history.replaceState(null,"",location.pathname+"?mesa="+this.mesaToken);
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pago/"+id+"/verificar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payment_id:paymentId})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo verificar el pago");
      if(d.estado==="aprobado"){
        this._aviso(pdT("pago_ok")+pdT(d.cuenta_cerrada?"cuenta_paga":"falta_resto"));
        this._pintarComprobante(id,d);
      }else{
        this._aviso(pdT(status==="pending"||status==="in_process"?"pago_proceso":"pago_no"));
      }
      this._refrescarMesa();
    }catch(err){this._aviso(err.message);}
  },
  // Comprobante por WhatsApp para quien pagó (sale cuando se cierra la cuenta de la mesa)
  _pintarComprobante(id,d){
    const el=document.getElementById("mesaComprobante");
    if(!this.mesa||!this.mesa.pago||!this.mesa.pago.whatsapp){el.innerHTML="";return;}
    if(d.comprobante){
      el.innerHTML=`<div class="mesa-seguimiento"><i class="fab fa-whatsapp"></i> ${d.comprobante==="enviado"?"Te mandamos el comprobante por WhatsApp.":"Te mandamos el comprobante por WhatsApp cuando se pague toda la cuenta."}</div>`;
      return;
    }
    el.innerHTML=`<form class="mesa-seguimiento" onsubmit="PedidoOnline.pedirComprobante(event,${Number(id)})">
      <h4><i class="fab fa-whatsapp"></i> ¿Querés el comprobante por WhatsApp?</h4>
      <div class="mesa-acciones"><input type="tel" id="comprobanteTel" placeholder="11 1234-5678" required autocomplete="tel">
      <button class="btn btn-success" id="btnComprobante">Enviarme</button></div></form>`;
  },
  async pedirComprobante(e,id){
    e.preventDefault();
    const btn=document.getElementById("btnComprobante");btn.disabled=true;
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pago/"+id+"/comprobante",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({telefono:document.getElementById("comprobanteTel").value})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo enviar");
      this._pintarComprobante(id,d);
    }catch(err){alert(err.message);btn.disabled=false;}
  },
  async _refrescarMesa(){
    try{const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken);if(r.ok)this._pintarMesa(await r.json());}catch(e){}
  },
  _pintarMesa(estado){
    this.mesa=estado;
    const ESTADOS={pendiente:pdT("est_pendiente"),confirmada:pdT("est_confirmada"),rechazada:pdT("est_rechazada"),atendida:pdT("est_atendida")};
    const TITULOS={pedido:pdT("tit_pedido"),mozo:pdT("tit_mozo"),cuenta:pdT("tit_cuenta")};
    // Los avisos de pago son para el mozo; el cliente ve lo pagado en la cuenta
    const sols=(estado.solicitudes||[]).filter(s=>TITULOS[s.tipo]).slice(0,6).map(s=>{
      const det=s.tipo==="pedido"?" — "+s.items.map(i=>i.cantidad+" x "+this._nombreItem(i)).join(", "):"";
      const est=s.tipo!=="pedido"&&s.estado==="pendiente"?pdT("avisado"):ESTADOS[s.estado]||s.estado;
      return`<div class="mesa-sol"><span>${pdE(TITULOS[s.tipo]+det)}${s.motivo?`<br><small>${pdE(s.motivo)}</small>`:""}</span><span class="mesa-sol-estado ${pdE(s.estado)}">${pdE(est)}</span></div>`;
    }).join("");
    const c=estado.cuenta;
    const cuenta=c?`<div class="mesa-seguimiento"><h4><i class="fas fa-receipt"></i> ${pdE(pdT("tu_cuenta"))}</h4>
      ${c.items.map(i=>`<div class="mesa-sol"><span>${pdE(i.cantidad+" x "+this._nombreItem({producto_id:i.producto_id,nombre:i.nombre_producto}))}</span><span>${pdM(i.subtotal)}</span></div>`).join("")}
      ${c.descuento?`<div class="mesa-sol"><span>${pdE(pdT("descuento"))}</span><span>-${pdM(c.descuento)}</span></div>`:""}
      ${c.propina?`<div class="mesa-sol"><span>${pdE(pdT("propina"))}</span><span>${pdM(c.propina)}</span></div>`:""}
      <div class="mesa-cuenta-total"><span>${pdE(pdT("total"))}</span><span>${pdM(c.total)}</span></div>
      ${c.pagado?`<div class="mesa-sol"><span>${pdE(pdT("pagado"))}</span><span>-${pdM(c.pagado)}</span></div>
      <div class="mesa-cuenta-total"><span>${pdE(pdT("falta_pagar"))}</span><span>${pdM(c.saldo)}</span></div>`:""}</div>`:"";
    document.getElementById("mesaEstado").innerHTML=(sols?`<div class="mesa-seguimiento"><h4><i class="fas fa-bell"></i> ${pdE(pdT("tus_pedidos"))}</h4>${sols}</div>`:"")+cuenta;
    // Solo carta: se ve el menú pero no se arma pedido
    if(estado.modo==="solo_carta"){["carritoSidebar","carritoFlotante"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});}
  },
  async llamar(tipo,forma){
    const btn=document.getElementById(tipo==="cuenta"?"btnPedirCuenta":"btnLlamarMozo");
    btn.disabled=true;
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/llamar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tipo,forma})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo avisar");
      await this._refrescarMesa();
    }catch(err){alert(err.message);}
    finally{setTimeout(()=>{btn.disabled=false;},5000);}
  },

  _badge(){
    const b=document.getElementById("origenBadge");if(!b)return;
    const m={whatsapp:{icon:"fab fa-whatsapp",label:"Pedido por WhatsApp",cls:"badge-wa"},instagram:{icon:"fab fa-instagram",label:"Pedido por Instagram",cls:"badge-ig"},web:{icon:"fas fa-globe",label:"Pedido Online",cls:"badge-web"}};
    const i=m[this.origen]||m.web;
    b.innerHTML=`<i class="${i.icon}"></i> ${i.label}`;
    b.className="origen-badge-hero "+i.cls;b.style.display="";
  },

  catIcon(n){
    n=(n||"").toLowerCase();
    if(n.includes("entrada"))return"fa-utensils";
    if(n.includes("plato")||n.includes("principal"))return"fa-drumstick-bite";
    if(n.includes("bebida")||n.includes("gaseosa"))return"fa-glass-martini-alt";
    if(n.includes("postre")||n.includes("helado"))return"fa-ice-cream";
    if(n.includes("cafe"))return"fa-mug-hot";
    return"fa-tag";
  },

  // Take Away: el momento muestra solo los productos del menú para llevar, con el nombre de la categoría ahí
  paraLlevar(){const m=this.momentos.find(x=>x.id===this.momentoActivo);return!!(m&&m.solo_para_llevar);},
  nombreCat(c){return this.paraLlevar()&&c.nombre_para_llevar?c.nombre_para_llevar:pdTr(c,"nombre");},
  // Categorías del momento elegido, en el orden del momento (o todas, en el orden de la carta)
  catsMomento(){
    const m=this.momentos.find(x=>x.id===this.momentoActivo);
    return m?m.categorias.map(id=>this.categorias.find(c=>c.id===id)).filter(Boolean):this.categorias;
  },
  paintMomentos(){
    const el=document.getElementById("momentosCarta");if(!el)return;
    if(!this.momentos.length){el.style.display="none";return;}
    // Solo el nombre y el horario, sin íconos
    const tab=(id,nombre,horario)=>`<button type="button" role="tab" aria-selected="${this.momentoActivo===id}" class="momento-btn ${this.momentoActivo===id?"activo":""}" onclick="PedidoOnline.setMomento(${pdA(id)})"><span>${pdE(nombre)}</span>${horario?`<small>${pdE(horario)}</small>`:""}</button>`;
    el.innerHTML=this.momentos.map(m=>tab(m.id,pdTr(m,"nombre"),m.desde+" – "+m.hasta)).join("")+tab("todo",pdT("toda_carta"),"");
    el.style.display="";
  },
  setMomento(id){this.momentoActivo=id;this.catActiva="todas";this.paintMomentos();this.paintCats();this.paintItems();},
  buscar(t){this.busqueda=String(t||"");this.paintItems();},
  paintCats(){
    const mk=(id,lbl)=>`<button class="menu-cat-btn ${this.catActiva==id?"active":""}" onclick="PedidoOnline.setCat(${pdA(id)})">${pdE(lbl)}</button>`;
    const h=[mk("todas",pdT("todas")),...this.catsMomento().map(c=>mk(c.id,this.nombreCat(c)))].join("");
    ["menuCategorias","mobileCatScroll"].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=h;});
  },

  // Destacados: Recomendado de la casa y Nuevo los marca el local; Lo más pedido sale de las ventas
  _marcas(p){
    const m=[p.recomendado&&["reco","fa-award","b_reco"],p.mas_pedido&&["mas","fa-star","b_mas"],p.nuevo&&["nuevo","fa-certificate","b_nuevo"]].filter(Boolean);
    return m.length?`<div class="carta-marcas">${m.map(([c,i,k])=>`<span class="carta-marca ${c}"><i class="fas ${i}"></i> ${pdE(pdT(k))}</span>`).join("")}</div>`:"";
  },
  setCat(id){this.catActiva=id;this.paintCats();this.paintItems();},
  visible(p){return p.tracking_stock?(p.stock_actual>0||p.es_plato===1):true;},
  itemCard(p){
    if(!this.soloVer&&p.disponible===false)return this._cardFueraHorario(p);
    const conOpciones=this._gruposDe(p).length;
    const q=conOpciones?0:(this.carrito.find(i=>i.producto_id===p.id)||{cantidad:0}).cantidad;
    const qc=this.soloVer||(this.mesa&&this.mesa.modo==="solo_carta")?""
      :q===0
      ?`<button class="btn-agregar" onclick="PedidoOnline.agregar(${p.id})" aria-label="${pdE(pdT("agregar"))}"><i class="fas fa-plus"></i> ${pdE(pdT("agregar"))}</button>`
      :`<button class="btn-qty btn-qty-minus" onclick="PedidoOnline.quitar(${p.id})" aria-label="Quitar">&#8722;</button><span class="qty-num">${q}</span><button class="btn-qty btn-qty-plus" onclick="PedidoOnline.agregar(${p.id})" aria-label="Sumar">+</button>`;
    // Como en una carta impresa: nombre, puntos guía y precio en una línea; la descripción debajo
    return `<div class="menu-item-card pedido-item-card" data-id="${p.id}">
  <div class="menu-item-info">
    <div class="carta-linea">
      <span class="menu-item-nombre">${pdE(pdTr(p,"nombre"))}</span>
      <span class="carta-puntos" aria-hidden="true"></span>
      <span class="menu-item-precio">${pdM(p.precio_venta)}</span>
    </div>
    ${this._marcas(p)}
    ${pdTr(p,"descripcion")?`<div class="menu-item-desc">${pdE(pdTr(p,"descripcion"))}</div>`:""}
  </div>
  <div class="item-qty-ctrl">${qc}</div>
</div>`;
  },

  paintItems(){
    const el=document.getElementById("menuItems");
    const todos=this.productos.filter(p=>this.visible(p));
    const vis=this.paraLlevar()?todos.filter(p=>p.para_llevar):todos;
    const sec=(cat,prods)=>{
      if(!prods.length)return"";
      // La descripción de la categoría es una nota de la carta (opciones de leche, horarios de las promos...)
      const nota=pdTr(cat,"descripcion");
      return`<div class="menu-section"><div class="menu-section-title"><i class="fas ${this.catIcon(cat.nombre)}"></i> ${pdE(this.nombreCat(cat))}</div>${nota?`<div class="carta-nota">${pdE(nota)}</div>`:""}${prods.map(p=>this.itemCard(p)).join("")}</div>`;
    };
    const vacio=k=>'<div class="menu-empty">'+pdE(pdT(k))+'</div>';
    // Buscando se mira toda la carta (en el idioma elegido y en español), no solo el momento
    const q=this.busqueda.trim().toLowerCase();
    if(q){
      const coincide=p=>[pdTr(p,"nombre"),pdTr(p,"descripcion"),p.nombre].some(x=>String(x||"").toLowerCase().includes(q));
      el.innerHTML=this.categorias.map(c=>sec(c,todos.filter(p=>p.categoria_id==c.id&&coincide(p)))).join("")||vacio("sin_resultados");
      return;
    }
    if(this.catActiva==="todas"){
      el.innerHTML=this.catsMomento().map(c=>sec(c,vis.filter(p=>p.categoria_id==c.id))).join("")||vacio("sin_productos");
    }else{
      const cat=this.categorias.find(c=>c.id==this.catActiva);
      const items=vis.filter(p=>p.categoria_id==this.catActiva);
      el.innerHTML=cat?sec(cat,items)||vacio("sin_productos_cat"):vacio("sin_productos");
    }
  },

  // ── Opciones y adicionales ("¿Qué leche?", "Adicionales"): se eligen al agregar ──
  grupos:[],
  _gruposDe(p){return(p&&p.grupos||[]).map(id=>this.grupos.find(g=>g.id===id)).filter(g=>g&&g.opciones.length);},
  agregar(id){
    const prod=this.productos.find(p=>p.id===id);if(!prod)return;
    if(this._gruposDe(prod).length)return this._elegirOpciones(prod);
    this._sumar(prod,[],0);
  },
  // Cada combinación de opciones es una línea del carrito (el precio lo vuelve a calcular el local)
  _sumar(prod,opciones,extra,sinSugerir){
    const clave=prod.id+":"+opciones.slice().sort((a,b)=>a-b).join(",");
    const item=this.carrito.find(i=>(i.clave||i.producto_id+":")===clave);
    if(item)item.cantidad++;
    else this.carrito.push({producto_id:prod.id,nombre:prod.nombre,precio:prod.precio_venta+extra,cantidad:1,notas:"",opciones,clave});
    this.paintItems();this.paintCarrito();
    if(!sinSugerir)this._sugerir(prod,this.carrito.findIndex(i=>(i.clave||i.producto_id+":")===clave));
  },

  // ── Venta cruzada (js/venta-cruzada.js): acompañalo con, ¿lo querés grande?, te conviene la promo ──
  _textoHorario(h){
    if(!h)return"";
    const D=pdT("dias");const seguidos=h.dias.length>2&&h.dias.every((d,i)=>i===0||d===h.dias[i-1]+1);
    const dias=h.dias.length===7?pdT("dias_todos"):seguidos?pdT("de_a",{d:D[h.dias[0]],h:D[h.dias[h.dias.length-1]]}):h.dias.map(d=>D[d]).join(", ");
    return dias+" "+pdT("de_h",{a:h.desde,b:h.hasta});
  },
  _cardFueraHorario(p){
    return`<div class="menu-item-card pedido-item-card fuera-horario" data-id="${p.id}"><div class="menu-item-info">
      <div class="carta-linea"><span class="menu-item-nombre">${pdE(pdTr(p,"nombre"))}</span><span class="carta-puntos" aria-hidden="true"></span><span class="menu-item-precio">${pdM(p.precio_venta)}</span></div>
      ${this._marcas(p)}${pdTr(p,"descripcion")?`<div class="menu-item-desc">${pdE(pdTr(p,"descripcion"))}</div>`:""}</div>
      <div class="item-qty-ctrl"><span class="carta-horario"><i class="far fa-clock"></i> ${pdE(pdT("se_pide",{h:this._textoHorario(p.horario)}))}</span></div></div>`;
  },
  _sugerir(prod,linea){
    const el=document.getElementById("sugerenciasCarta");if(!el||this.soloVer)return;
    const grande=VentaCruzada.grande(prod,this.productos);
    const acompa=VentaCruzada.acompanar(prod,this.productos,this.categorias,this.carrito.map(i=>i.producto_id));
    if(!grande&&!acompa.length){el.style.display="none";return;}
    el.innerHTML=`<button type="button" class="sugerencias-cerrar" onclick="PedidoOnline.cerrarSugerencias()" aria-label="Cerrar">&times;</button>
      ${grande?`<button type="button" class="sugerencia-grande" onclick="PedidoOnline.cambiarAGrande(${linea})"><i class="fas fa-arrow-up"></i> ${pdE(pdT("grande_q",{m:pdM(grande.precio_venta-prod.precio_venta)}))}</button>`:""}
      ${acompa.length?`<div class="sugerencias-titulo">${pdE(pdT("acompana"))}</div><div class="sugerencias-lista">${acompa.map(p=>`<button type="button" onclick="PedidoOnline.agregarSugerido(${p.id})"><span>${pdE(pdTr(p,"nombre"))}</span><b>${pdM(p.precio_venta)} +</b></button>`).join("")}</div>`:""}`;
    el.style.display="";
    clearTimeout(this._sugTimer);this._sugTimer=setTimeout(()=>this.cerrarSugerencias(),12000);
  },
  cerrarSugerencias(){const el=document.getElementById("sugerenciasCarta");if(el)el.style.display="none";},
  agregarSugerido(id){this.cerrarSugerencias();this.agregar(id);},
  // Cambia una unidad de la línea por la versión grande, con las opciones que la grande también tiene
  cambiarAGrande(idx){
    const l=this.carrito[idx];if(!l)return;
    const prod=this.productos.find(p=>p.id===l.producto_id);const grande=VentaCruzada.grande(prod,this.productos);if(!grande)return;
    const gruposG=this._gruposDe(grande);
    const opciones=(l.opciones||[]).filter(id=>gruposG.some(g=>g.opciones.some(o=>o.id===id)));
    const extra=opciones.reduce((s,id)=>{for(const g of gruposG){const o=g.opciones.find(x=>x.id===id);if(o)return s+(Number(o.precio)||0);}return s;},0);
    this.cerrarSugerencias();
    l.cantidad--;if(l.cantidad<=0)this.carrito.splice(idx,1);
    this._sumar(grande,opciones,extra,true);
  },
  _htmlCombo(){
    const c=VentaCruzada.comboConveniente(this.carrito,this.productos);
    if(!c||this.soloVer)return"";
    return`<div class="combo-conviene"><span><i class="fas fa-tags"></i> ${pdE(pdT("conviene",{c:pdTr(c.combo,"nombre"),m:pdM(c.ahorro)}))}</span>
      <button type="button" class="btn btn-sm btn-primary" onclick="PedidoOnline.cambiarACombo()">${pdE(pdT("cambiar"))}</button></div>`;
  },
  // Saca del carrito lo que arma el combo y agrega el combo (si tiene opciones, se eligen)
  cambiarACombo(){
    const c=VentaCruzada.comboConveniente(this.carrito,this.productos);if(!c)return;
    for(const u of c.usar)this.carrito[u.linea].cantidad-=u.cantidad;
    this.carrito=this.carrito.filter(i=>i.cantidad>0);
    const combo=c.combo;
    if(this._gruposDe(combo).length){this.paintItems();this.paintCarrito();return this._elegirOpciones(combo);}
    this._sumar(combo,[],0,true);
  },
  _elegirOpciones(prod){
    const grupos=this._gruposDe(prod);
    this._eligiendo={prod,grupos};
    const html=grupos.map(g=>{
      const una=g.tipo==="una";
      const pista=una?pdT(g.obligatorio?"op_una":"op_opcional"):(g.maximo?pdT("op_hasta",{n:g.maximo}):pdT("op_varias"));
      return`<div class="opciones-grupo" data-grupo="${g.id}" data-maximo="${Number(g.maximo)||0}"><h4>${pdE(pdTr(g,"nombre"))} <small>${pdE(pista)}</small></h4>
        <div class="opciones-lista">${g.opciones.map((o,i)=>`<label class="opcion-chip"><input type="${una?"radio":"checkbox"}" name="og${g.id}" value="${o.id}" data-precio="${Number(o.precio)||0}"
          ${una&&g.obligatorio&&i===0?"checked":""} onchange="PedidoOnline._opcionCambio(this)"><span>${pdE(pdTr(o,"nombre"))}${o.precio?` <b>+${pdM(o.precio)}</b>`:""}</span></label>`).join("")}</div></div>`;
    }).join("");
    document.getElementById("opcionesTitulo").textContent=pdTr(prod,"nombre");
    document.getElementById("opcionesContenido").innerHTML=html;
    document.getElementById("opcionesCancelar").textContent=pdT("cancelar");
    document.getElementById("opcionesModal").style.display="";document.body.style.overflow="hidden";
    this._opcionCambio();
  },
  _opcionCambio(input){
    if(input&&input.type==="checkbox"){
      const caja=input.closest(".opciones-grupo");const max=Number(caja.dataset.maximo)||0;
      if(max&&caja.querySelectorAll("input:checked").length>max)input.checked=false;
    }
    const extra=[...document.querySelectorAll("#opcionesContenido input:checked")].reduce((s,i)=>s+(Number(i.dataset.precio)||0),0);
    document.getElementById("opcionesOk").innerHTML='<i class="fas fa-plus"></i> '+pdE(pdT("op_agregar",{m:pdM(this._eligiendo.prod.precio_venta+extra)}));
  },
  confirmarOpciones(){
    const{prod,grupos}=this._eligiendo;
    const faltan=grupos.filter(g=>g.tipo==="una"&&g.obligatorio&&!document.querySelector(`#opcionesContenido .opciones-grupo[data-grupo="${g.id}"] input:checked`));
    if(faltan.length){alert(pdT("op_falta",{g:faltan.map(g=>pdTr(g,"nombre")).join(", ")}));return;}
    const elegidas=[...document.querySelectorAll("#opcionesContenido input:checked")];
    this.cerrarOpciones();
    this._sumar(prod,elegidas.map(i=>Number(i.value)),elegidas.reduce((s,i)=>s+(Number(i.dataset.precio)||0),0));
  },
  cerrarOpciones(){document.getElementById("opcionesModal").style.display="none";document.body.style.overflow="";},

  // Desde la tarjeta (productos sin opciones): una línea por producto
  quitar(id){
    const idx=this.carrito.findIndex(i=>(i.clave||i.producto_id+":")===id+":");if(idx===-1)return;
    this.quitarLinea(idx);
  },
  eliminar(id){
    this.carrito=this.carrito.filter(i=>i.producto_id!==id);
    this.paintItems();this.paintCarrito();
  },
  // Desde el carrito: por línea (cada combinación de opciones)
  sumarLinea(idx){const i=this.carrito[idx];if(!i)return;i.cantidad++;this.paintItems();this.paintCarrito();},
  quitarLinea(idx){
    const i=this.carrito[idx];if(!i)return;
    i.cantidad--;if(i.cantidad<=0)this.carrito.splice(idx,1);
    this.paintItems();this.paintCarrito();
  },
  borrarLinea(idx){this.carrito.splice(idx,1);this.paintItems();this.paintCarrito();},

  _carritoHTML(){
    if(!this.carrito.length)return'<div class="carrito-vacio"><i class="fas fa-shopping-bag"></i><p>'+pdE(pdT("vacio"))+'</p></div>';
    return this.carrito.map((i,idx)=>`<div class="carrito-item">
  <div class="carrito-item-info"><span class="carrito-item-nombre">${pdE(this._nombreItem(i))}</span><span class="carrito-item-precio">${pdM(i.precio)}</span></div>
  <div class="carrito-item-qty">
    <button class="btn-qty btn-qty-minus" onclick="PedidoOnline.quitarLinea(${idx})" aria-label="Quitar">&#8722;</button>
    <span>${i.cantidad}</span>
    <button class="btn-qty btn-qty-plus" onclick="PedidoOnline.sumarLinea(${idx})" aria-label="Sumar">+</button>
    <button class="btn-qty btn-qty-remove" onclick="PedidoOnline.borrarLinea(${idx})" aria-label="Eliminar"><i class="fas fa-trash-alt"></i></button>
  </div>
  <div class="carrito-item-sub">${pdM(i.precio*i.cantidad)}</div>
</div>`).join("");
  },

  paintCarrito(){
    const total=this.carrito.reduce((s,i)=>s+i.precio*i.cantidad,0);
    const count=this.carrito.reduce((s,i)=>s+i.cantidad,0);
    const html=this._carritoHTML();
    const has=this.carrito.length>0;
    const set=(id,val,prop)=>{const e=document.getElementById(id);if(e){if(prop==="html")e.innerHTML=val;else if(prop==="display")e.style.display=val;else if(prop==="text")e.textContent=val;}};
    const combo=this._htmlCombo();
    set("carritoItems",combo+html,"html");set("carritoTotalRow",has?"":"none","display");set("carritoTotal",pdM(total),"text");
    set("btnConfirmar",has?"":"none","display");set("carritoCount",count+" "+pdT(count===1?"item":"items"),"text");
    set("carritoItemsMobile",combo+html,"html");set("carritoTotalRowMobile",has?"":"none","display");set("carritoTotalMobile",pdM(total),"text");
    set("btnConfirmarMobile",has?"":"none","display");
    set("carritoFlotante",has?"":"none","display");set("carritoFlotanteCount",String(count),"text");
  },
  toggleCarritoMobile(){
    const m=document.getElementById("carritoMobileModal");if(!m)return;
    const open=m.style.display!=="none";
    m.style.display=open?"none":"";
    document.body.style.overflow=open?"":"hidden";
  },
  abrirFormulario(){
    const mm=document.getElementById("carritoMobileModal");
    if(mm)mm.style.display="none";
    this._paintResumen();
    const fm=document.getElementById("formModal");
    if(fm){fm.style.display="";document.body.style.overflow="hidden";}
  },
  cerrarFormulario(){
    const fm=document.getElementById("formModal");
    if(fm)fm.style.display="none";
    document.body.style.overflow="";
  },
  onTipoChange(v){
    const gd=document.getElementById("grupoDireccion");if(!gd)return;
    gd.style.display=v==="delivery"?"":"none";
    const dir=document.getElementById("clienteDireccion");
    if(dir)dir.required=v==="delivery";
  },
  _paintResumen(){
    const el=document.getElementById("formResumen");if(!el)return;
    const total=this.carrito.reduce((s,i)=>s+i.precio*i.cantidad,0);
    el.innerHTML='<div class="resumen-titulo">'+pdE(pdT("resumen"))+'</div>'
      +this.carrito.map(i=>`<div class="resumen-row"><span>${pdE(this._nombreItem(i))} x${i.cantidad}</span><strong>${pdM(i.precio*i.cantidad)}</strong></div>`).join("")
      +`<div class="resumen-total"><span>${pdE(pdT("total_estimado"))}</span><strong>${pdM(total)}</strong></div>`;
  },
  async enviarPedido(e){
    e.preventDefault();
    const nombre=document.getElementById("clienteNombre").value.trim();
    const tel=document.getElementById("clienteTelefono").value.trim();
    const tipo=(document.querySelector('input[name="tipoPedido"]:checked')||{value:"takeaway"}).value;
    const dir=document.getElementById("clienteDireccion").value.trim();
    const notas=document.getElementById("clienteNotas").value.trim();
    if(this.mesaToken)return this._enviarMesa(nombre,notas);
    if(!nombre||!tel){alert(pdT("completa_datos"));return;}
    if(tipo==="delivery"&&!dir){alert(pdT("completa_dir"));return;}
    if(!this.carrito.length){alert(pdT("agrega_algo"));return;}
    const btn=document.getElementById("btnEnviar");
    btn.disabled=true;
    btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> '+pdE(pdT("enviando"));
    try{
      const r=await fetch(PD_API+"/api/publico/pedido",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({cliente:nombre,telefono:tel,tipo,direccion:dir,notas,origen:this.origen,
          items:this.carrito.map(i=>({producto_id:i.producto_id,nombre:i.nombre,cantidad:i.cantidad,notas:i.notas||"",opciones:i.opciones||[]}))})
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||"Error al enviar");
      this._confirmar(data,nombre);
      if(data.pendiente)this._seguirNube(data.codigo,nombre);
    }catch(err){
      alert("Error: "+err.message);
      this._btnEnviar();
    }
  },
  // Por Fadido Nube el pedido llega al local en unos segundos: el cliente ve cuándo lo recibió y con qué número
  _seguirNube(codigo,nombre){
    const msg=document.getElementById("confirmacionMsg"),num=document.getElementById("confirmacionNumero");
    const tit=document.getElementById("confirmacionTitulo"),titulo=t=>{if(tit)tit.textContent=t;};
    titulo(pdT("enviado"));
    if(msg)msg.textContent="Enviando tu pedido al local...";
    if(num)num.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    const hasta=Date.now()+35*60000;
    const mirar=async()=>{
      try{
        const r=await fetch(PD_API+"/api/publico/pedido/"+codigo);const d=await r.json();
        if(d.estado==="recibido"){
          titulo(pdT("recibido"));
          if(msg)msg.textContent=pdT("gracias",{n:nombre});
          if(num)num.innerHTML=pdE(pdT("numero"))+" <strong>"+pdE(d.numero_pedido)+"</strong>";
          return;
        }
        if(d.estado!=="pendiente"){titulo("No se pudo tomar el pedido");if(msg)msg.textContent=d.mensaje||"El local no pudo tomar el pedido.";if(num)num.innerHTML="";return;}
      }catch(e){}
      if(Date.now()<hasta)setTimeout(mirar,4000);
    };
    mirar();
  },
  async _enviarMesa(nombre,notas){
    if(!this.carrito.length){alert(pdT("agrega_algo"));return;}
    const btn=document.getElementById("btnEnviar");
    btn.disabled=true;
    btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> '+pdE(pdT("enviando"));
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pedido",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({cliente:nombre,notas,items:this.carrito.map(i=>({producto_id:i.producto_id,cantidad:i.cantidad,notas:i.notas||"",opciones:i.opciones||[]}))})
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||"Error al enviar");
      this._confirmar(data,nombre);
      this._refrescarMesa();
    }catch(err){
      alert("Error: "+err.message);
      this._btnEnviar();
    }
  },
  _confirmar(data,nombre){
    document.getElementById("formModal").style.display="none";
    document.body.style.overflow="";
    const msg=document.getElementById("confirmacionMsg");
    const num=document.getElementById("confirmacionNumero");
    if(this.mesaToken){
      // Desde la mesa no se tapa la carta: el cliente sigue viendo sus pedidos, la cuenta y puede pedir más.
      // En modo directo ya está en cocina; si no, espera al mozo.
      const aviso=document.getElementById("mesaAviso");
      aviso.textContent=pdT(data.estado==="confirmada"?"listo_cocina":"espera_mozo",{n:nombre?" "+nombre:""});
      aviso.style.display="";
      setTimeout(()=>{aviso.style.display="none";},15000);
      this.carrito=[];
      const form=document.getElementById("pedidoForm");if(form)form.reset();
      this._btnEnviar();
      this.paintItems();this.paintCarrito();
      document.getElementById("mesaPanel").scrollIntoView({behavior:"smooth"});
      return;
    }
    if(msg)msg.textContent=pdT("gracias",{n:nombre});
    if(num)num.innerHTML=pdE(pdT("numero"))+" <strong>"+pdE(data.numero_pedido)+"</strong>";
    document.getElementById("confirmacionScreen").style.display="";
    ["menuItems","menuCategorias"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});
    const sb=document.getElementById("carritoSidebar");if(sb)sb.style.display="none";
    const fl=document.getElementById("carritoFlotante");if(fl)fl.style.display="none";
    const nav=document.getElementById("mobileCatNav");if(nav)nav.style.display="none";
  },
  nuevoPedido(){
    this.carrito=[];
    document.getElementById("confirmacionScreen").style.display="none";
    ["menuItems","menuCategorias"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="";});
    const sb=document.getElementById("carritoSidebar");if(sb)sb.style.display="";
    const nav=document.getElementById("mobileCatNav");if(nav)nav.style.display="";
    const form=document.getElementById("pedidoForm");if(form)form.reset();
    // El botón quedaba en "Enviando..." deshabilitado y no se podía mandar otro pedido sin recargar
    this._btnEnviar();
    const gd=document.getElementById("grupoDireccion");if(gd)gd.style.display="none";
    this.paintItems();this.paintCarrito();
  },
  _initEvents(){
    ["carritoMobileModal","formModal","pagoModal","opcionesModal"].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.addEventListener("click",e=>{
        if(e.target===el){
          if(id==="carritoMobileModal")this.toggleCarritoMobile();
          else if(id==="pagoModal")this.cerrarCuenta();
          else if(id==="opcionesModal")this.cerrarOpciones();
          else this.cerrarFormulario();
        }
      });
    });
    document.addEventListener("keydown",e=>{
      if(e.key!=="Escape")return;
      this.cerrarFormulario();
      this.cerrarOpciones();
      if(this.mesaToken)this.cerrarCuenta();
      const mm=document.getElementById("carritoMobileModal");
      if(mm&&mm.style.display!=="none")this.toggleCarritoMobile();
    });
  }
};
document.addEventListener("DOMContentLoaded",()=>PedidoOnline.init());