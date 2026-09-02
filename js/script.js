/* =========================================================================
   PLANO APROBADO — recorrido virtual
   Vista explorable = efecto "planeta pequeño" (proyección polar) generado
   con canvas 2D a partir de tu foto de dron tomada en picado — ideal para
   este efecto porque el punto central de la proyección ES la vista nadir.
   Sin librerías externas ni WebGL: cero riesgo del "Script error." anterior.
   ========================================================================= */

// ---- 1. IMÁGENES — reemplaza por tus fotos reales de dron ----
const SCENES = {
  principal: {
    label: 'Vista Principal',
    image: 'img/vista-principal.jpg', // panorámica 360° real (equirectangular) - frontal.png
    audio: 'audio/narracion.mp3'
  }
};
const CENTRO_IMAGE = 'img/centro.jpg';
const CARDINAL_SCENES = {
  norte: { label:'Atrás', image:'img/atras.jpg', audio:'' },
  sur: { label:'Frontal', image:'img/frontal.jpg', audio:'' },
  este: { label:'Derecha', image:'img/derecha.jpg', audio:'' },
  oeste: { label:'Izquierda', image:'img/izquierda.jpg', audio:'' },
};

// ---- 2. GENERADOR DE "PLANETA PEQUEÑO" (proyección polar por canvas) ----
const planetCanvas = document.getElementById('planetCanvas');
const PLANET_SIZE = 560;
planetCanvas.width = PLANET_SIZE; planetCanvas.height = PLANET_SIZE;

function buildTinyPlanet(url){
  return new Promise((resolve)=>{
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = ()=>{
      try{
        const off = document.createElement('canvas');
        off.width = im.naturalWidth; off.height = im.naturalHeight;
        const octx = off.getContext('2d');
        octx.drawImage(im, 0, 0);
        const src = octx.getImageData(0,0,off.width,off.height).data;
        const sw = off.width, sh = off.height;

        const ctx = planetCanvas.getContext('2d');
        const outImg = ctx.createImageData(PLANET_SIZE, PLANET_SIZE);
        const cx = PLANET_SIZE/2, cy = PLANET_SIZE/2, maxR = PLANET_SIZE/2;

        for(let y=0;y<PLANET_SIZE;y++){
          for(let x=0;x<PLANET_SIZE;x++){
            const dx = x-cx, dy = y-cy;
            const r = Math.sqrt(dx*dx+dy*dy);
            const di = (y*PLANET_SIZE+x)*4;
            if(r>maxR){ outImg.data[di+3]=0; continue; }
            const angle = Math.atan2(dy,dx);
            const norm = (angle+Math.PI)/(2*Math.PI);
            const sx = Math.min(sw-1, Math.floor(norm*sw));
            const sy = Math.min(sh-1, Math.floor((1 - r/maxR)*(sh-1))); // suelo (nadir) al centro, cielo (cenit) al borde
            const si = (sy*sw+sx)*4;
            outImg.data[di]=src[si]; outImg.data[di+1]=src[si+1];
            outImg.data[di+2]=src[si+2]; outImg.data[di+3]=255;
          }
        }
        ctx.putImageData(outImg,0,0);
      }catch(err){
        // Imagen sin CORS habilitado: vista simplificada, sin cortar la app.
        const ctx = planetCanvas.getContext('2d');
        ctx.clearRect(0,0,PLANET_SIZE,PLANET_SIZE);
        ctx.save();
        ctx.beginPath(); ctx.arc(PLANET_SIZE/2,PLANET_SIZE/2,PLANET_SIZE/2,0,Math.PI*2); ctx.clip();
        ctx.drawImage(im,0,0,PLANET_SIZE,PLANET_SIZE);
        ctx.restore();
        showToast('Vista simplificada: la imagen no permite el efecto de planeta (CORS)');
      }
      resolve();
    };
    im.onerror = ()=> resolve();
    im.src = url;
  });
}

// ---- 3. ROTACIÓN (arrastre + auto-rotación) ----
let rotation = 0, dragging = false, lastX = 0, idleTimer = null, autoRAF = null, autoOn = true;

function applyRotation(){ planetCanvas.style.transform = `rotate(${rotation}deg)`; updateCompassFromRotation(); }
function updateCompassFromRotation(){
  const dirs = ['N','NE','E','SE','S','SO','O','NO'];
  const norm = ((-rotation % 360)+360)%360;
  document.getElementById('compassNeedle').style.transform = `rotate(${-rotation}deg)`;
  document.getElementById('headingLabel').textContent = dirs[Math.round(norm/45)%8];
}
function startAuto(){
  cancelAnimationFrame(autoRAF);
  function step(){ if(autoOn && !dragging){ rotation += 0.03; applyRotation(); } autoRAF = requestAnimationFrame(step); }
  step();
}
function wakeIdle(){ clearTimeout(idleTimer); }

planetCanvas.addEventListener('pointerdown', (e)=>{
  dragging = true; planetCanvas.classList.add('dragging'); lastX = e.clientX;
  planetCanvas.setPointerCapture(e.pointerId);
});
planetCanvas.addEventListener('pointermove', (e)=>{
  if(!dragging) return;
  rotation += (e.clientX - lastX) * 0.35;
  lastX = e.clientX;
  applyRotation();
});
function endDrag(){ dragging=false; planetCanvas.classList.remove('dragging'); }
planetCanvas.addEventListener('pointerup', endDrag);
planetCanvas.addEventListener('pointercancel', endDrag);
planetCanvas.addEventListener('pointerleave', endDrag);

// ---- BOTÓN OJO: muestra/oculta el botón "Ver en 360°", los botones de
// dirección y los lotes con sus etiquetas, para ver la foto limpia ----
let overlaysVisible = true;
const eyeOpenIcon = document.getElementById('eyeOpenIcon');
const eyeClosedIcon = document.getElementById('eyeClosedIcon');
document.getElementById('overlayToggleBtn').addEventListener('click', ()=>{
  overlaysVisible = !overlaysVisible;
  [
    document.getElementById('panoOpenBtn'),
    document.getElementById('cardinalButtons'),
    document.getElementById('lotShapes'),
    document.getElementById('lotLabels')
  ].forEach(el => { if(el) el.classList.toggle('overlay-hidden', !overlaysVisible); });
  eyeOpenIcon.style.display = overlaysVisible ? 'block' : 'none';
  eyeClosedIcon.style.display = overlaysVisible ? 'none' : 'block';
});

// ---- 4. NAVEGACIÓN ----
let currentView = 'principal';

async function loadExplorable(sceneId, data, label){
  await buildTinyPlanet(data.image);
  rotation = 0; applyRotation();
  currentView = sceneId;
  updateLocation(label);
}

// (los botones de dirección se detectan manualmente en endLotPointer, más
// abajo, por la misma razón que los lotes — ver comentario ahí)

// Anclas 3D (yaw/pitch) para el botón "Centro" dentro de cada vista cardinal.
// Por defecto apunta al centro/frente de la foto; para "Atrás" (norte) se
// corrige para que apunte hacia tierra, no hacia la playa.
const SPH_CENTER_ANCHOR_DEFAULT = { yaw: -Math.PI/2, pitch: -0.14 };
const SPH_CENTER_ANCHOR_OVERRIDES = {
  norte: { yaw: Math.PI/2, pitch: -0.14 }
};
// Anclas 3D de los 4 botones de dirección dentro de la foto del Centro,
// usando al sujeto de la gorra café (apunta hacia Atrás) como referencia.
const SPH_DIR_ANCHORS = {
  norte: { yaw: -Math.PI/2 - 0.35, pitch: 0 }, // Atrás — sobre el horizonte, corrido a la izquierda
  sur:   { yaw: Math.PI/2 - 0.35,  pitch: 0 }, // Frontal — sobre el horizonte, corrido a la izquierda
  este:  { yaw: Math.PI,           pitch: 0 }, // Derecha — sobre la línea del horizonte
  oeste: { yaw: 0,                 pitch: 0 }, // Izquierda — sobre la línea del horizonte
};

function goDirection(dir){
  const cfg = CARDINAL_SCENES[dir];
  if(!cfg.image){ showToast('Próximamente: vista hacia el ' + cfg.label); return; }
  const flat = document.getElementById('flatScene');
  flat.classList.add('zoom-out-full');
  setTimeout(async ()=>{
    flat.classList.remove('zoom-out-full');
    setFlatVisible(false);
    await enterSphereScene(cfg.image, dir, 'Vista ' + cfg.label);
    sphereView.classList.add('active', 'zoom-in-full');
    setTimeout(()=> sphereView.classList.remove('zoom-in-full'), 480);
    sphereHint.classList.remove('faded');
    showBackBtn(true);
    setActiveNav(null);
  }, 260);
}

// Prepara la escena esférica según el modo: 'dir' (una de las 4 vistas
// cardinales, con botón "Centro") o null (la foto del Centro, con los
// 4 botones de dirección). No dispara la animación de entrada/salida;
// eso lo maneja quien la llama, según de dónde venga.
async function enterSphereScene(imageUrl, dir, label){
  await openSphereAssets(imageUrl);
  if(dir){
    sphereView.classList.remove('mode-centro');
    const ov = SPH_CENTER_ANCHOR_OVERRIDES[dir] || SPH_CENTER_ANCHOR_DEFAULT;
    SPH_BTN_ANCHOR.yaw = ov.yaw; SPH_BTN_ANCHOR.pitch = ov.pitch;
    currentView = 'dir-' + dir;
  } else {
    sphereView.classList.add('mode-centro');
    currentView = 'centro';
  }
  updateLocation(label);
}

function goToCentroSphere(){
  if(panoView.classList.contains('active')) hidePanoView();
  const flat = document.getElementById('flatScene');
  const wrap = document.getElementById('planetWrap');
  const sphereActive = sphereView.classList.contains('active');
  const fromAerial = currentView === 'aerial';
  const fromPrincipal = !sphereActive && !fromAerial;
  let outgoing = null, outgoingClass = null;
  if(sphereActive){ outgoing = sphereView; outgoingClass = 'zoom-out-full'; }
  else if(fromAerial){ outgoing = flat; outgoingClass = 'zoom-out-full'; }
  else if(fromPrincipal){ outgoing = wrap; outgoingClass = 'zoom-out-centered'; }
  const proceed = async ()=>{
    if(outgoing) outgoing.classList.remove(outgoingClass);
    if(fromAerial) setFlatVisible(false);
    await enterSphereScene(CENTRO_IMAGE, null, 'Centro');
    sphereView.classList.add('active', 'zoom-in-full');
    setTimeout(()=> sphereView.classList.remove('zoom-in-full'), 480);
    sphereHint.classList.remove('faded');
    showBackBtn(true);
    setActiveNav('centro');
  };
  if(outgoing){ outgoing.classList.add(outgoingClass); setTimeout(proceed, 260); }
  else proceed();
}

// Lleva directo a una de las 4 vistas cardinales desde CUALQUIER pantalla
// (esfera principal, mapa de lotes, Centro, u otra vista cardinal) — usada
// por los botones del panel lateral "Vista Atrás/Frontal/Derecha/Izquierda".
function goToDirectSphere(dir){
  const cfg = CARDINAL_SCENES[dir];
  if(!cfg.image){ showToast('Próximamente: vista hacia el ' + cfg.label); return; }
  if(panoView.classList.contains('active')) hidePanoView();
  const flat = document.getElementById('flatScene');
  const wrap = document.getElementById('planetWrap');
  const sphereActive = sphereView.classList.contains('active');
  const fromAerial = currentView === 'aerial';
  const fromPrincipal = !sphereActive && !fromAerial;
  let outgoing = null, outgoingClass = null;
  if(sphereActive){ outgoing = sphereView; outgoingClass = 'zoom-out-full'; }
  else if(fromAerial){ outgoing = flat; outgoingClass = 'zoom-out-full'; }
  else if(fromPrincipal){ outgoing = wrap; outgoingClass = 'zoom-out-centered'; }
  const proceed = async ()=>{
    if(outgoing) outgoing.classList.remove(outgoingClass);
    if(fromAerial) setFlatVisible(false);
    await enterSphereScene(cfg.image, dir, 'Vista ' + cfg.label);
    sphereView.classList.add('active', 'zoom-in-full');
    setTimeout(()=> sphereView.classList.remove('zoom-in-full'), 480);
    sphereHint.classList.remove('faded');
    showBackBtn(true);
    setActiveNav('dir-' + dir);
  };
  if(outgoing){ outgoing.classList.add(outgoingClass); setTimeout(proceed, 260); }
  else proceed();
}

function goDirectionFromCentro(dir){
  const cfg = CARDINAL_SCENES[dir];
  if(!cfg.image){ showToast('Próximamente: vista hacia el ' + cfg.label); return; }
  sphereView.classList.add('zoom-out-full');
  setTimeout(async ()=>{
    await enterSphereScene(cfg.image, dir, 'Vista ' + cfg.label);
    sphereView.classList.remove('zoom-out-full');
    sphereView.classList.add('active', 'zoom-in-full');
    setTimeout(()=> sphereView.classList.remove('zoom-in-full'), 480);
    sphereHint.classList.remove('faded');
    showBackBtn(true);
    setActiveNav(null);
  }, 260);
}

function goToAerial(){
  if(panoView.classList.contains('active')) hidePanoView();
  if(sphereView.classList.contains('active')) hideSphereView();
  const wrap = document.getElementById('planetWrap');
  const flat = document.getElementById('flatScene');
  wrap.classList.add('zoom-out-centered');
  setTimeout(()=>{
    wrap.classList.remove('zoom-out-centered');
    setFlatVisible(true);
    currentView = 'aerial';
    updateLocation('Zona de Lotes');
    showBackBtn(true);
    setActiveNav('aerial');
    flat.classList.add('zoom-in-full');
    setTimeout(()=> flat.classList.remove('zoom-in-full'), 480);
    sizeLotsSvg();
    resetLotZoom();
    pulseGlobalCta();
  }, 260);
}
function pulseGlobalCta(){
  const cta = document.getElementById('globalCta');
  cta.classList.add('show-tip');
  clearTimeout(pulseGlobalCta._t);
  pulseGlobalCta._t = setTimeout(()=> cta.classList.remove('show-tip'), 4000);
}

// ---- 4c. ZOOM DEL PLANO DE LOTES (rueda / pellizco + arrastrar) ----
const lotsSvg = document.getElementById('lotsOverlay');
const flatSceneEl = document.getElementById('flatScene');
let lotZoom = 1, lotX = 0, lotY = 0;
const LOT_MIN_ZOOM = 1, LOT_MAX_ZOOM = 6;
let lotDragging = false, lotLastX = 0, lotLastY = 0, lotMoved = false, lotSuppressClick = false;
const lotPointers = new Map();
let lotPinchDist = null;

function applyLotTransform(){
  lotsSvg.style.transform = `translate(${lotX}px, ${lotY}px) scale(${lotZoom})`;
}
// En celular, el SVG se dimensiona más grande que la pantalla (a la
// relación de aspecto real de la foto), y #flatScene (overflow:hidden)
// recorta la ventana visible — así arrastrar revela imagen real, no un
// borde vacío. En escritorio se deja del tamaño del contenedor, igual que
// siempre.
let lotIsMobile = false, lotSvgNativeW = 0, lotSvgNativeH = 0;
function sizeLotsSvg(){
  const containerW = flatSceneEl.clientWidth, containerH = flatSceneEl.clientHeight;
  lotIsMobile = window.innerWidth <= 720;
  if(lotIsMobile){
    const containerAspect = containerW / containerH;
    const viewBoxAspect = 1920 / 1080.57;
    let svgW, svgH;
    if(containerAspect < viewBoxAspect){ svgH = containerH; svgW = svgH * viewBoxAspect; }
    else { svgW = containerW; svgH = svgW / viewBoxAspect; }
    lotsSvg.style.width = svgW + 'px';
    lotsSvg.style.height = svgH + 'px';
    lotsSvg.style.left = ((containerW - svgW) / 2) + 'px';
    lotsSvg.style.top = ((containerH - svgH) / 2) + 'px';
    lotSvgNativeW = svgW; lotSvgNativeH = svgH;
  } else {
    lotsSvg.style.width = ''; lotsSvg.style.height = '';
    lotsSvg.style.left = ''; lotsSvg.style.top = '';
    lotSvgNativeW = containerW; lotSvgNativeH = containerH;
  }
}
sizeLotsSvg();
window.addEventListener('resize', sizeLotsSvg);

function clampLotPan(){
  const rect = flatSceneEl.getBoundingClientRect();
  const baseX = lotIsMobile ? Math.max(0, (lotSvgNativeW - rect.width) / 2) : 0;
  const baseY = lotIsMobile ? Math.max(0, (lotSvgNativeH - rect.height) / 2) : 0;
  const zoomX = Math.max(0, (lotZoom-1) * rect.width);
  const zoomY = Math.max(0, (lotZoom-1) * rect.height);
  lotX = Math.max(-(zoomX+baseX), Math.min(baseX, lotX));
  lotY = Math.max(-(zoomY+baseY), Math.min(baseY, lotY));
}
function lotZoomBy(factor, anchorX, anchorY){
  const prevZoom = lotZoom;
  lotZoom = Math.max(LOT_MIN_ZOOM, Math.min(LOT_MAX_ZOOM, lotZoom*factor));
  if(lotZoom === prevZoom) return;
  const ratio = lotZoom/prevZoom;
  lotX = anchorX*(1-ratio) + lotX*ratio;
  lotY = anchorY*(1-ratio) + lotY*ratio;
  clampLotPan();
  applyLotTransform();
}
function resetLotZoom(){ lotZoom=1; lotX=0; lotY=0; applyLotTransform(); }

flatSceneEl.addEventListener('wheel', (e)=>{
  if(!flatSceneEl.classList.contains('active')) return;
  e.preventDefault();
  const rect = flatSceneEl.getBoundingClientRect();
  lotZoomBy(1 - e.deltaY*0.0015, e.clientX-rect.left, e.clientY-rect.top);
}, { passive:false });

flatSceneEl.addEventListener('pointerdown', (e)=>{
  if(!flatSceneEl.classList.contains('active')) return;
  lotMoved = false;
  if(e.target.closest('.cardinal-btn-svg')) return;
  lotPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  flatSceneEl.setPointerCapture(e.pointerId);
  if(lotPointers.size === 1){
    lotDragging = true; lotLastX = e.clientX; lotLastY = e.clientY;
    flatSceneEl.classList.add('panning');
  } else if(lotPointers.size === 2){
    lotDragging = false;
    const pts = [...lotPointers.values()];
    lotPinchDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
  }
});
flatSceneEl.addEventListener('pointermove', (e)=>{
  if(!lotPointers.has(e.pointerId)) return;
  lotPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(lotPointers.size === 2){
    const pts = [...lotPointers.values()];
    const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    const rect = flatSceneEl.getBoundingClientRect();
    const midX = (pts[0].x+pts[1].x)/2 - rect.left, midY = (pts[0].y+pts[1].y)/2 - rect.top;
    if(lotPinchDist) lotZoomBy(dist/lotPinchDist, midX, midY);
    lotPinchDist = dist;
    return;
  }
  if(!lotDragging) return;
  const dx = e.clientX-lotLastX, dy = e.clientY-lotLastY;
  if(Math.abs(dx)+Math.abs(dy) > 3) lotMoved = true;
  lotX += dx; lotY += dy;
  lotLastX = e.clientX; lotLastY = e.clientY;
  clampLotPan(); applyLotTransform();
});
function endLotPointer(e){
  lotPointers.delete(e.pointerId);
  if(lotPointers.size < 2) lotPinchDist = null;
  if(lotPointers.size === 0){
    lotDragging = false;
    flatSceneEl.classList.remove('panning');
    if(lotMoved){
      lotSuppressClick = true; setTimeout(()=> lotSuppressClick=false, 0);
    } else {
      // Toque simple (sin arrastre): la captura de puntero impide que el "click"
      // llegue al elemento real (lote o botón de dirección), así que lo
      // detectamos manualmente aquí.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el && el.closest && el.closest('.cardinal-btn-svg');
      if(btn){
        goDirection(btn.dataset.dir);
        return;
      }
      const shape = el && el.closest && el.closest('.lot-shape');
      if(shape){
        const id = shape.getAttribute('data-id');
        const meta = LOTS_BY_ID[id] || { id, tipo:'lote', estado:'Disponible', area:'—', precio:'—' };
        openLotInfo(meta);
      }
    }
  } else if(lotPointers.size === 1){
    const [p] = [...lotPointers.values()];
    lotDragging = true; lotLastX = p.x; lotLastY = p.y;
  }
}
flatSceneEl.addEventListener('pointerup', endLotPointer);
flatSceneEl.addEventListener('pointercancel', endLotPointer);
flatSceneEl.addEventListener('click', (e)=>{ if(lotSuppressClick) e.stopPropagation(); }, true);
flatSceneEl.addEventListener('dblclick', ()=> resetLotZoom());


function goToPrincipal(){
  if(panoView.classList.contains('active')) hidePanoView();
  const flat = document.getElementById('flatScene');
  const wrap = document.getElementById('planetWrap');
  const sphereActive = sphereView.classList.contains('active');
  let outgoing, outgoingClass;
  if(sphereActive){ outgoing = sphereView; outgoingClass = 'zoom-out-full'; }
  else if(currentView === 'aerial'){ outgoing = flat; outgoingClass = 'zoom-out-full'; }
  else { outgoing = wrap; outgoingClass = 'zoom-out-centered'; }
  outgoing.classList.add(outgoingClass);
  setTimeout(async ()=>{
    outgoing.classList.remove(outgoingClass);
    if(sphereActive) hideSphereView();
    setFlatVisible(false);
    await loadExplorable('principal', SCENES.principal, 'Vista Principal');
    showBackBtn(false);
    setActiveNav('principal');
    wrap.classList.add('zoom-in-centered');
    setTimeout(()=> wrap.classList.remove('zoom-in-centered'), 480);
  }, 260);
}

// ---- 4b. LOTES REALES (clic sobre un lote para ver su información) ----
const LOTS_META = [{"id": "05-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz01", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz02", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz03", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz04", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz05", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz06", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz07", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz08", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz09", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz10", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz11", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz11", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz11", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz11", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz11", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz11", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz12", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz12", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz12", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz12", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz12", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz12", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz13", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz13", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz13", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz13", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz13", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz13", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz14", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz15", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz16", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz17", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz18", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz19", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz20", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz21", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz22", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz22", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz22", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz22", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz22", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz22", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz23", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "12-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "11-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz24", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "12-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "11-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz25", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "12-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "11-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz26", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "12-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "11-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz27", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "12-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "11-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz28", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz29", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz29", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz29", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz29", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz29", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz29", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz30", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz30", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz30", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz30", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz30", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz30", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "12-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "11-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz32", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz33", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz34", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz34", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz34", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz34", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz34", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz34", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz35", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz35", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz35", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz31", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz35", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz35", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz35", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz36", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "10-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "09-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "08-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "07-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "06-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "05-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "04-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "03-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "02-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "01-Mz37", "tipo": "lote", "estado": "Disponible", "area": "—", "precio": "—"}, {"id": "espacio verde", "tipo": "amenidad", "label": "Área Verde"}, {"id": "espacio verde", "tipo": "amenidad", "label": "Área Verde"}, {"id": "NUEVAS AREAS COMUNES", "tipo": "amenidad", "label": "Área Común"}, {"id": "NUEVAS AREAS COMUNES", "tipo": "amenidad", "label": "Área Común"}, {"id": "fuente centro", "tipo": "amenidad", "label": "Fuente"}, {"id": "área recreativa", "tipo": "amenidad", "label": "Área Recreativa"}];
const LOTS_BY_ID = {};
LOTS_META.forEach(l => { if(!(l.id in LOTS_BY_ID)) LOTS_BY_ID[l.id] = l; });

// ---- Conexión con Google Sheets (hoja "Lotes" publicada como CSV) ----
// Para cambiar la hoja: Google Sheets → Archivo → Compartir → Publicar en la
// Web → elige la pestaña "Lotes" y el formato CSV, y pega ese enlace aquí.
const LOTS_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSWgBIwE1H3YJ6v-d0NVbOUa3NrdPOVZPRrRup6-FvOekV33kFkRWnpaIpIJ6MXFUXgLPxORbhjHv7d/pub?gid=125050881&single=true&output=csv';

function parseCsv(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0; i<text.length; i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field = ''; }
      else if(c === '\n' || c === '\r'){
        if(c === '\r' && text[i+1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

async function loadLotsFromSheet(){
  if(!LOTS_SHEET_CSV_URL) return;
  try{
    const res = await fetch(LOTS_SHEET_CSV_URL, { cache:'no-store' });
    if(!res.ok) return;
    const text = await res.text();
    const rows = parseCsv(text);
    if(rows.length < 2) return;
    // Encabezados esperados: ID (no editar), Manzana, Lote, Estado, Área (m²), Precio (USD)
    for(let i=1; i<rows.length; i++){
      const [id, , , estado, area, precio] = rows[i];
      if(!id || !(id in LOTS_BY_ID)) continue;
      const meta = LOTS_BY_ID[id];
      if(estado) meta.estado = estado.trim();
      if(area) meta.area = area.trim();
      if(precio) meta.precio = precio.trim();
    }
    applyLotColors();
  } catch(err){
    console.warn('No se pudo cargar la hoja de estados de lotes:', err);
  }
}

function applyLotColors(){
  document.querySelectorAll('.lot-shape[data-id]').forEach(el=>{
    const meta = LOTS_BY_ID[el.getAttribute('data-id')];
    el.classList.remove('estado-disponible','estado-reservado','estado-vendido');
    if(!meta || meta.tipo !== 'lote') return;
    const estado = (meta.estado || 'Disponible').toLowerCase();
    if(estado === 'reservado') el.classList.add('estado-reservado');
    else if(estado === 'vendido') el.classList.add('estado-vendido');
    else el.classList.add('estado-disponible');
  });
}
loadLotsFromSheet();

// ← reemplaza con tu número real de WhatsApp (código de país sin el "+", sin espacios)
const WHATSAPP_NUMBER = '593995172209';
(function setupGlobalCta(){
  const cta = document.getElementById('globalCta');
  const msg = encodeURIComponent('Hola, quiero más información sobre el proyecto.');
  cta.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
})();

function openLotInfo(meta){
  const eyebrow = document.getElementById('lotInfoEyebrow');
  const title = document.getElementById('lotInfoTitle');
  const areaRow = document.getElementById('lotInfoAreaRow');
  const estadoRow = document.getElementById('lotInfoEstadoRow');
  const precioRow = document.getElementById('lotInfoPrecioRow');
  const wa = document.getElementById('lotInfoWhatsapp');
  if(meta.tipo === 'amenidad'){
    eyebrow.textContent = 'Área común';
    title.textContent = meta.label;
    areaRow.style.display = 'none';
    estadoRow.style.display = 'none';
    precioRow.style.display = 'none';
    wa.style.display = 'none';
  } else {
    const [num, mz] = meta.id.split('-Mz');
    eyebrow.textContent = 'Lote ' + num + ' · Manzana ' + mz;
    title.textContent = meta.id;
    areaRow.style.display = 'flex';
    estadoRow.style.display = 'flex';
    precioRow.style.display = 'flex';
    document.getElementById('lotInfoArea').textContent = meta.area;
    document.getElementById('lotInfoEstado').textContent = meta.estado;
    document.getElementById('lotInfoPrecio').textContent = meta.precio;
    wa.style.display = 'flex';
    const msg = encodeURIComponent(`Hola, quiero información sobre el Lote ${meta.id} (${meta.estado}).`);
    wa.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
  }
  document.getElementById('lotInfo').classList.add('open');
}
document.getElementById('lotInfoClose').addEventListener('click', ()=>
  document.getElementById('lotInfo').classList.remove('open'));

// (la detección de toques sobre cada lote se hace en endLotPointer, más abajo,
// porque la captura de puntero del arrastre/zoom impide que el "click" nativo
// llegue al lote real)

// ---- VISOR 360° NAVEGABLE (izquierda/derecha, arriba/abajo, y zoom) ----
const panoView = document.getElementById('panoView');
const panoTrack = document.getElementById('panoTrack');
const panoTiles = [document.getElementById('panoTile1'), document.getElementById('panoTile2'), document.getElementById('panoTile3')];
const panoHint = document.getElementById('panoHint');

let panoAspect = 2;                 // naturalWidth/naturalHeight de la panorámica
let panoZoom = 1;                   // 1 = nivel base (ya con margen para mirar arriba/abajo)
const PANO_BASE_SCALE = 1;          // 1 = imagen completa ajustada a la pantalla, sin zoom forzado al iniciar
const PANO_MIN_ZOOM = 1, PANO_MAX_ZOOM = 2.6;
let panoTileH = 0, panoTileW = 0;   // tamaño de cada copia de la imagen al zoom actual
let panoX = 0, panoY = 0;           // posición actual (translate)
let panoDragging = false, panoLastX = 0, panoLastY = 0;
let panoIdleTimer = null, panoDriftRAF = null;
const panoPointers = new Map();     // pointerId -> {x,y}, para detectar pellizco (pinch)
let panoPinchDist = null;

function applyPano(){ panoTrack.style.transform = `translate(${panoX}px, ${panoY}px)`; }

function wrapPanoX(){
  if(panoTileW <= 0) return;
  while(panoX > 0) panoX -= panoTileW;
  while(panoX < -2*panoTileW) panoX += panoTileW;
}
function clampPanoY(){
  const vh = window.innerHeight;
  const maxNeg = Math.min(0, vh - panoTileH); // cuánto se puede subir/bajar la imagen
  panoY = Math.max(maxNeg, Math.min(0, panoY));
}
// anchorX/anchorY: punto de la pantalla (mouse o centro del pellizco) que debe quedarse fijo al hacer zoom
function recomputePanoDims(prevZoom, anchorX, anchorY){
  const vh = window.innerHeight;
  if(anchorX === undefined) anchorX = window.innerWidth / 2;
  if(anchorY === undefined) anchorY = window.innerHeight / 2;
  const ratio = prevZoom ? panoZoom / prevZoom : 1;
  panoTileH = vh * PANO_BASE_SCALE * panoZoom;
  panoTileW = panoTileH * panoAspect;
  panoTiles.forEach(t=> t.style.height = panoTileH + 'px');
  if(prevZoom){
    // el punto bajo el cursor/dedos se mantiene fijo: newPos = anchor*(1-ratio) + oldPos*ratio
    panoX = anchorX * (1 - ratio) + panoX * ratio;
    panoY = anchorY * (1 - ratio) + panoY * ratio;
  }
  wrapPanoX(); clampPanoY(); applyPano();
  positionPanoWaveBtn();
}

// Ancla el botón "Ver Mapa de Lotes" a un punto fijo DENTRO de la foto (tile
// del medio), para que se mueva y escale junto con la imagen al arrastrar/zoom.
const PANO_BTN_ANCHOR_X = 0.5;  // 0-1: posición horizontal dentro de la foto
const PANO_BTN_ANCHOR_Y = 0.6;  // 0-1: posición vertical dentro de la foto
function positionPanoWaveBtn(){
  const btn = document.getElementById('panoToAerialBtn');
  if(!btn || !panoTileW) return;
  btn.style.left = (panoTileW * 1 + panoTileW * PANO_BTN_ANCHOR_X) + 'px';
  btn.style.top = (panoTileH * PANO_BTN_ANCHOR_Y) + 'px';
}

function wakePanoIdle(){
  clearTimeout(panoIdleTimer);
  panoIdleTimer = setTimeout(startPanoDrift, 2600);
}
function startPanoDrift(){
  cancelAnimationFrame(panoDriftRAF);
  function step(){
    if(!panoDragging){ panoX -= 0.15; wrapPanoX(); applyPano(); }
    panoDriftRAF = requestAnimationFrame(step);
  }
  step();
}

function panoZoomBy(factor, anchorX, anchorY){
  const prevZoom = panoZoom;
  panoZoom = Math.max(PANO_MIN_ZOOM, Math.min(PANO_MAX_ZOOM, panoZoom * factor));
  if(panoZoom === prevZoom) return;
  recomputePanoDims(prevZoom, anchorX, anchorY);
}

panoTrack.addEventListener('pointerdown', (e)=>{
  if(e.target.closest('#panoToAerialBtn')) return;
  panoPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  panoTrack.setPointerCapture(e.pointerId);
  cancelAnimationFrame(panoDriftRAF);
  panoHint.classList.add('faded');
  if(panoPointers.size === 1){
    panoDragging = true; panoView.classList.add('dragging');
    panoLastX = e.clientX; panoLastY = e.clientY;
  } else if(panoPointers.size === 2){
    panoDragging = false;
    const pts = [...panoPointers.values()];
    panoPinchDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
  }
});
panoTrack.addEventListener('pointermove', (e)=>{
  if(!panoPointers.has(e.pointerId)) return;
  panoPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

  if(panoPointers.size === 2){
    const pts = [...panoPointers.values()];
    const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    const midX = (pts[0].x+pts[1].x)/2, midY = (pts[0].y+pts[1].y)/2;
    if(panoPinchDist){
      panoZoomBy(dist / panoPinchDist, midX, midY);
    }
    panoPinchDist = dist;
    return;
  }
  if(!panoDragging) return;
  panoX += (e.clientX - panoLastX);
  panoY += (e.clientY - panoLastY);
  panoLastX = e.clientX; panoLastY = e.clientY;
  wrapPanoX(); clampPanoY(); applyPano();
});
function endPanoPointer(e){
  panoPointers.delete(e.pointerId);
  if(panoPointers.size < 2) panoPinchDist = null;
  if(panoPointers.size === 0){
    if(panoDragging){ panoDragging = false; panoView.classList.remove('dragging'); wakePanoIdle(); }
  } else if(panoPointers.size === 1){
    const [p] = [...panoPointers.values()];
    panoDragging = true; panoLastX = p.x; panoLastY = p.y;
  }
}
panoTrack.addEventListener('pointerup', endPanoPointer);
panoTrack.addEventListener('pointercancel', endPanoPointer);
panoTrack.addEventListener('pointerleave', (e)=>{ if(panoPointers.size<=1) endPanoPointer(e); });

panoView.addEventListener('wheel', (e)=>{
  e.preventDefault();
  panoZoomBy(1 - e.deltaY * 0.0012, e.clientX, e.clientY);
  panoHint.classList.add('faded');
  wakePanoIdle();
}, { passive:false });

function openPanoAssets(imageUrl){
  return new Promise((resolve)=>{
    const src = imageUrl || SCENES.principal.image;
    const probe = new Image();
    probe.onload = ()=>{
      panoAspect = probe.naturalWidth / probe.naturalHeight;
      panoZoom = 1;
      panoTiles.forEach(t=> t.src = src);
      recomputePanoDims(null);
      panoX = window.innerWidth/2 - 1.5*panoTileW; // centra el frente de la imagen en la pantalla
      panoY = (window.innerHeight - panoTileH) / 2; // centrado verticalmente al abrir
      clampPanoY(); applyPano();
      resolve();
    };
    probe.onerror = resolve;
    probe.src = src;
  });
}
function hidePanoView(){
  cancelAnimationFrame(panoDriftRAF); clearTimeout(panoIdleTimer);
  panoPointers.clear(); panoPinchDist = null;
  panoView.classList.remove('active');
}

// ================================================================
// VISOR 360° ESFÉRICO (WebGL, perspectiva real: mira arriba/abajo/
// a los lados libremente) — SOLO para Atrás/Frontal/Derecha/Izquierda.
// Código totalmente aparte del visor de arrastre de arriba; no toca
// la esfera principal ni "Ver Mapa de Lotes".
// ================================================================
const sphereView = document.getElementById('sphereView');
const sphereCanvas = document.getElementById('sphereGL');
const sphereHint = document.getElementById('sphereHint');

const sglp = sphereCanvas.getContext('webgl2', {antialias:true, alpha:false}) ||
             sphereCanvas.getContext('webgl', {antialias:true, alpha:false});

let sphReady = false, sphIntroFrom = null, sphUploadFn = null;
const SPH_INTRO_MS = 1300;
const sphView3 = { yaw: 0, pitch: 0.05, fov: 96 };
// Punto 3D del botón "Centro" dentro de la esfera (con profundidad real).
// Se reasigna según la escena en enterSphereScene().
const SPH_BTN_ANCHOR = { yaw: -Math.PI/2, pitch: -0.14 };
const sphVel = { yaw:0, pitch:0 };
const SPH_MIN_FOV = 26, SPH_MAX_FOV = 110;
let sphDragging = false, sphSpinning = false, sphLastX = 0, sphLastY = 0;
const sphPointers = new Map();
let sphPinchStart = 0, sphFovStart = 0, sphIdleTimer = null;

function sphClamp(v,lo,hi){ return v<lo?lo:v>hi?hi:v; }
function sphEaseOut(t){ return 1-Math.pow(1-t,3); }

if(sglp){
  const VS = "attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uProj; uniform mat4 uView; varying vec2 vUV;\n"+
             "void main(){ vUV = aUV; gl_Position = uProj*uView*vec4(aPos,1.0); }";
  const FS = "precision highp float; varying vec2 vUV; uniform sampler2D uTex;\n"+
             "void main(){ gl_FragColor = vec4(texture2D(uTex, vUV).rgb, 1.0); }";
  function sphCompile(type, src){ const s=sglp.createShader(type); sglp.shaderSource(s,src); sglp.compileShader(s); return s; }
  const sphProg = sglp.createProgram();
  sglp.attachShader(sphProg, sphCompile(sglp.VERTEX_SHADER, VS));
  sglp.attachShader(sphProg, sphCompile(sglp.FRAGMENT_SHADER, FS));
  sglp.linkProgram(sphProg); sglp.useProgram(sphProg);
  const spaPos = sglp.getAttribLocation(sphProg,'aPos');
  const spaUV = sglp.getAttribLocation(sphProg,'aUV');
  const spuProj = sglp.getUniformLocation(sphProg,'uProj');
  const spuView = sglp.getUniformLocation(sphProg,'uView');

  let sphSphereCount = 0;
  (function(){
    const SEG=96, RING=48, R=100, pos=[], uv=[], idx=[];
    for(let y=0;y<=RING;y++){
      const v=y/RING, phi=v*Math.PI;
      for(let x=0;x<=SEG;x++){
        const u=x/SEG, theta=u*Math.PI*2;
        pos.push(R*Math.sin(phi)*Math.cos(theta), R*Math.cos(phi), R*Math.sin(phi)*Math.sin(theta));
        uv.push(u,v);
      }
    }
    for(let y=0;y<RING;y++) for(let x=0;x<SEG;x++){
      const a=y*(SEG+1)+x, b=a+SEG+1;
      idx.push(a,b,a+1, b,b+1,a+1);
    }
    function buf(target,data,Ctor){ const bb=sglp.createBuffer(); sglp.bindBuffer(target,bb); sglp.bufferData(target,new Ctor(data),sglp.STATIC_DRAW); }
    buf(sglp.ARRAY_BUFFER,pos,Float32Array);
    sglp.enableVertexAttribArray(spaPos); sglp.vertexAttribPointer(spaPos,3,sglp.FLOAT,false,0,0);
    buf(sglp.ARRAY_BUFFER,uv,Float32Array);
    sglp.enableVertexAttribArray(spaUV); sglp.vertexAttribPointer(spaUV,2,sglp.FLOAT,false,0,0);
    buf(sglp.ELEMENT_ARRAY_BUFFER,idx,Uint16Array);
    sphSphereCount = idx.length;
  })();

  const sphTex = sglp.createTexture();
  sglp.bindTexture(sglp.TEXTURE_2D, sphTex);
  sglp.disable(sglp.CULL_FACE);
  sglp.clearColor(0.024,0.051,0.051,1);

  function sphIsPOT(n){ return (n & (n-1))===0; }
  function sphUpload(img){
    const w=img.naturalWidth, h=img.naturalHeight;
    const isGL2 = (typeof WebGL2RenderingContext!=='undefined') && (sglp instanceof WebGL2RenderingContext);
    const max = sglp.getParameter(sglp.MAX_TEXTURE_SIZE);
    let source = img;
    const needsPOT = !isGL2 && (!sphIsPOT(w)||!sphIsPOT(h));
    if(needsPOT || w>max || h>max){
      let tw=w, th=h;
      if(needsPOT){
        tw = Math.pow(2, Math.round(Math.log2(w)));
        th = Math.pow(2, Math.round(Math.log2(h)));
        while(tw>max) tw/=2;
        while(th>max) th/=2;
      } else {
        const s = max/Math.max(tw,th);
        tw = Math.floor(tw*s); th = Math.floor(th*s);
      }
      const c = document.createElement('canvas');
      c.width = Math.max(2,tw); c.height = Math.max(2,th);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      source = c;
    }
    sglp.bindTexture(sglp.TEXTURE_2D, sphTex);
    sglp.pixelStorei(sglp.UNPACK_FLIP_Y_WEBGL, false);
    sglp.texImage2D(sglp.TEXTURE_2D,0,sglp.RGB,sglp.RGB,sglp.UNSIGNED_BYTE, source);
    sglp.texParameteri(sglp.TEXTURE_2D, sglp.TEXTURE_WRAP_S, sglp.REPEAT);
    sglp.texParameteri(sglp.TEXTURE_2D, sglp.TEXTURE_WRAP_T, sglp.CLAMP_TO_EDGE);
    sglp.texParameteri(sglp.TEXTURE_2D, sglp.TEXTURE_MAG_FILTER, sglp.LINEAR);
    sglp.texParameteri(sglp.TEXTURE_2D, sglp.TEXTURE_MIN_FILTER, sglp.LINEAR_MIPMAP_LINEAR);
    sglp.generateMipmap(sglp.TEXTURE_2D);
  }
  sphUploadFn = sphUpload;

  function sphPerspective(out, fovy, aspect, near, far){
    const f=1/Math.tan(fovy/2), nf=1/(near-far);
    out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0;
    out[4]=0; out[5]=f; out[6]=0; out[7]=0;
    out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
    out[12]=0; out[13]=0; out[14]=2*far*near*nf; out[15]=0;
  }
  function sphViewFrom(out, yaw, pitch){
    const cp=Math.cos(pitch), sp=Math.sin(pitch);
    const fx=cp*Math.sin(yaw), fy=sp, fz=cp*Math.cos(yaw);
    let rx=-fz, ry=0, rz=fx;
    const rl=Math.hypot(rx,rz)||1; rx/=rl; rz/=rl;
    const ux=ry*fz-rz*fy, uy=rz*fx-rx*fz, uz=rx*fy-ry*fx;
    out[0]=rx; out[1]=ux; out[2]=-fx; out[3]=0;
    out[4]=ry; out[5]=uy; out[6]=-fy; out[7]=0;
    out[8]=rz; out[9]=uz; out[10]=-fz; out[11]=0;
    out[12]=0; out[13]=0; out[14]=0; out[15]=1;
  }
  const sphProjM = new Float32Array(16);
  const sphViewM = new Float32Array(16);

  function sphResize(){
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const w = Math.round(sphereCanvas.clientWidth*dpr);
    const h = Math.round(sphereCanvas.clientHeight*dpr);
    if(sphereCanvas.width!==w || sphereCanvas.height!==h){
      sphereCanvas.width=w; sphereCanvas.height=h;
      sglp.viewport(0,0,w,h);
    }
  }
  function sphVFov(aspect){
    const hf = sphView3.fov*Math.PI/180;
    return 2*Math.atan(Math.tan(hf/2)/Math.max(aspect,0.0001));
  }

  let sphLast = performance.now();
  const sphCenterBtn = document.getElementById('sphereToAerialBtn');
  const sphDirButtons = [...document.querySelectorAll('.sph-dir-btn')].map(el =>
    ({ el, anchor: SPH_DIR_ANCHORS[el.dataset.dir] }));
  function sphProjectAnchor(yawA, pitchA){
    const R = 100;
    const theta = Math.PI/2 - yawA;
    const phi = Math.PI/2 - pitchA;
    const wx = R*Math.sin(phi)*Math.cos(theta);
    const wy = R*Math.cos(phi);
    const wz = R*Math.sin(phi)*Math.sin(theta);
    const vx = sphViewM[0]*wx + sphViewM[4]*wy + sphViewM[8]*wz + sphViewM[12];
    const vy = sphViewM[1]*wx + sphViewM[5]*wy + sphViewM[9]*wz + sphViewM[13];
    const vz = sphViewM[2]*wx + sphViewM[6]*wy + sphViewM[10]*wz + sphViewM[14];
    const cx = sphProjM[0]*vx + sphProjM[4]*vy + sphProjM[8]*vz;
    const cy = sphProjM[1]*vx + sphProjM[5]*vy + sphProjM[9]*vz;
    const cw = sphProjM[11]*vz; // = -vz (proj[11] es el único término no nulo de esa fila)
    if(cw <= 0.001) return null; // detrás de la cámara (vz>0 → cw negativo)
    const ndcX = cx/cw, ndcY = cy/cw;
    if(ndcX < -1.3 || ndcX > 1.3 || ndcY < -1.3 || ndcY > 1.3) return null;
    return {
      x: (ndcX*0.5+0.5) * sphereCanvas.clientWidth,
      y: (1-(ndcY*0.5+0.5)) * sphereCanvas.clientHeight
    };
  }
  function sphApplyAnchor(el, anchor){
    const p = sphReady ? sphProjectAnchor(anchor.yaw, anchor.pitch) : null;
    if(!p){
      el.style.opacity = '0'; el.style.pointerEvents = 'none';
    } else {
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    }
  }
  function sphUpdateAnchoredButtons(){
    if(sphereView.classList.contains('mode-centro')){
      sphDirButtons.forEach(({el, anchor}) => sphApplyAnchor(el, anchor));
    } else {
      sphApplyAnchor(sphCenterBtn, SPH_BTN_ANCHOR);
    }
  }

  function sphFrame(now){
    const dt = Math.min((now-sphLast)/16.667, 3); sphLast = now;
    sphResize();
    if(sphReady){
      if(sphIntroFrom){
        const t = sphClamp((now-sphIntroFrom.t0)/SPH_INTRO_MS, 0, 1);
        const e = sphEaseOut(t);
        sphView3.fov = sphIntroFrom.fromFov + (96 - sphIntroFrom.fromFov)*e;
        if(t>=1) sphIntroFrom = null;
      } else {
        if(sphSpinning) sphView3.yaw -= 0.0016*dt;
        if(!sphDragging){
          sphView3.yaw += sphVel.yaw*dt;
          sphView3.pitch += sphVel.pitch*dt;
          sphVel.yaw *= Math.pow(0.92, dt);
          sphVel.pitch *= Math.pow(0.92, dt);
          if(Math.abs(sphVel.yaw)<1e-5) sphVel.yaw=0;
          if(Math.abs(sphVel.pitch)<1e-5) sphVel.pitch=0;
        }
      }
      sphView3.pitch = sphClamp(sphView3.pitch, -Math.PI/2+0.02, Math.PI/2-0.02);
    }
    const aspect = sphereCanvas.width/Math.max(sphereCanvas.height,1);
    sphPerspective(sphProjM, sphVFov(aspect), aspect, 0.1, 500);
    sphViewFrom(sphViewM, sphView3.yaw, sphView3.pitch);
    sglp.clear(sglp.COLOR_BUFFER_BIT);
    if(sphReady){
      sglp.useProgram(sphProg);
      sglp.uniformMatrix4fv(spuProj,false,sphProjM);
      sglp.uniformMatrix4fv(spuView,false,sphViewM);
      sglp.bindTexture(sglp.TEXTURE_2D, sphTex);
      sglp.drawElements(sglp.TRIANGLES, sphSphereCount, sglp.UNSIGNED_SHORT, 0);
    }
    sphUpdateAnchoredButtons();
    requestAnimationFrame(sphFrame);
  }
  requestAnimationFrame(sphFrame);

  function sphStopIntro(){ sphIntroFrom = null; }
  function sphWakeIdle(){
    clearTimeout(sphIdleTimer);
    sphIdleTimer = setTimeout(()=>{ sphSpinning = true; }, 3000);
  }

  sphereCanvas.addEventListener('pointerdown', (e)=>{
    if(!sphReady) return;
    sphStopIntro(); sphSpinning = false;
    sphereCanvas.setPointerCapture(e.pointerId);
    sphPointers.set(e.pointerId, {x:e.clientX,y:e.clientY});
    if(sphPointers.size===1){
      sphDragging = true; sphLastX=e.clientX; sphLastY=e.clientY;
      sphVel.yaw=0; sphVel.pitch=0;
      sphereView.classList.add('dragging');
    } else if(sphPointers.size===2){
      const p=[...sphPointers.values()];
      sphPinchStart = Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y);
      sphFovStart = sphView3.fov;
    }
    sphereHint.classList.add('faded');
  });
  sphereCanvas.addEventListener('pointermove', (e)=>{
    if(!sphPointers.has(e.pointerId)) return;
    sphPointers.set(e.pointerId, {x:e.clientX,y:e.clientY});
    if(sphPointers.size>=2){
      const p=[...sphPointers.values()];
      const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
      if(sphPinchStart>0) sphView3.fov = sphClamp(sphFovStart*(sphPinchStart/Math.max(d,1)), SPH_MIN_FOV, SPH_MAX_FOV);
      return;
    }
    if(!sphDragging) return;
    const dx=e.clientX-sphLastX, dy=e.clientY-sphLastY;
    sphLastX=e.clientX; sphLastY=e.clientY;
    const k=(sphView3.fov*Math.PI/180)/Math.max(sphereCanvas.clientWidth,1);
    sphView3.yaw += dx*k; sphView3.pitch += dy*k;
    sphVel.yaw = dx*k*0.55; sphVel.pitch = dy*k*0.55;
  });
  function sphEndPointer(e){
    sphPointers.delete(e.pointerId);
    if(sphPointers.size<2) sphPinchStart=0;
    if(sphPointers.size===0){ sphDragging=false; sphereView.classList.remove('dragging'); sphWakeIdle(); }
  }
  sphereCanvas.addEventListener('pointerup', sphEndPointer);
  sphereCanvas.addEventListener('pointercancel', sphEndPointer);
  sphereCanvas.addEventListener('lostpointercapture', sphEndPointer);

  sphereView.addEventListener('wheel', (e)=>{
    if(!sphReady) return;
    e.preventDefault(); sphStopIntro();
    const step = e.deltaMode===1 ? e.deltaY*16 : e.deltaY;
    sphView3.fov = sphClamp(sphView3.fov*Math.exp(step*0.0012), SPH_MIN_FOV, SPH_MAX_FOV);
    sphereHint.classList.add('faded'); sphWakeIdle();
  }, {passive:false});

  sphereCanvas.addEventListener('dblclick', ()=>{
    if(!sphReady) return;
    sphStopIntro();
    sphView3.fov = sphClamp(sphView3.fov>SPH_MIN_FOV+4 ? sphView3.fov*0.6 : 96, SPH_MIN_FOV, SPH_MAX_FOV);
  });
}

function openSphereAssets(imageUrl){
  return new Promise((resolve)=>{
    if(!sglp || !sphUploadFn){ resolve(); return; }
    const img = new Image();
    img.onload = ()=>{
      sphUploadFn(img);
      sphReady = true;
      sphSpinning = false;
      // Arranca mirando al frente real de la foto (centro de la imagen), de
      // espaldas al punto donde queda la persona/guía dividida en los bordes.
      sphView3.yaw = -Math.PI/2; sphView3.pitch = -0.05;
      sphView3.fov = 130;
      sphIntroFrom = { t0: performance.now(), fromFov: 130 };
      sphereHint.classList.remove('faded');
      clearTimeout(sphIdleTimer);
      sphIdleTimer = setTimeout(()=>{ sphSpinning = true; }, 3000);
      resolve();
    };
    img.onerror = resolve;
    img.src = imageUrl;
  });
}
function hideSphereView(){
  clearTimeout(sphIdleTimer);
  sphPointers.clear();
  sphereView.classList.remove('active');
}

document.getElementById('panoOpenBtn').addEventListener('click', goToPano);
async function goToPano(){
  const wrap = document.getElementById('planetWrap');
  wrap.classList.add('zoom-out-centered');
  await openPanoAssets();
  setTimeout(()=>{
    wrap.classList.remove('zoom-out-centered');
    panoView.classList.add('active', 'zoom-in-full');
    setTimeout(()=> panoView.classList.remove('zoom-in-full'), 480);
    panoHint.classList.remove('faded');
    wakePanoIdle();
    currentView = 'pano';
    updateLocation('Vista 360°');
    showBackBtn(true);
    setActiveNav(null);
    document.getElementById('compass').style.display = 'none';
  }, 260);
}
function closePano(){
  panoView.classList.add('zoom-out-full');
  setTimeout(()=>{
    hidePanoView();
    panoView.classList.remove('zoom-out-full');
    currentView = 'principal';
    updateLocation('Vista Principal');
    showBackBtn(false);
    setActiveNav('principal');
    document.getElementById('compass').style.display = 'flex';
    const wrap = document.getElementById('planetWrap');
    wrap.classList.add('zoom-in-centered');
    setTimeout(()=> wrap.classList.remove('zoom-in-centered'), 480);
  }, 260);
}
document.getElementById('panoToAerialBtn').addEventListener('click', ()=>{
  document.getElementById('compass').style.display = 'flex';
  goToAerial();
});

// ---- Visor esférico (Atrás/Frontal/Derecha/Izquierda): botón "Centro" ----
// ---- y navegación dentro de la foto del Centro ----
document.getElementById('sphereToAerialBtn').addEventListener('click', ()=>{
  goToCentroSphere();
});
document.querySelectorAll('.sph-dir-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> goDirectionFromCentro(btn.dataset.dir));
});

document.getElementById('backBtn').addEventListener('click', ()=>{
  if(panoView.classList.contains('active')){ closePano(); return; }
  if(sphereView.classList.contains('active')){ goToAerial(); return; }
  if(currentView === 'aerial' || currentView.startsWith('dir-')) goToPrincipal();
});


document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const t = btn.dataset.target;
    if(t === 'principal') goToPrincipal();
    else if(t === 'centro') goToCentroSphere();
    else if(t.startsWith('dir-')) goToDirectSphere(t.replace('dir-',''));
    else goToAerial();
    document.getElementById('sidebar').classList.add('collapsed');
  });
});
function setActiveNav(target){
  document.querySelectorAll('.nav-item').forEach(b=> b.classList.toggle('active', b.dataset.target === target));
}

function setFlatVisible(v){
  document.getElementById('flatScene').classList.toggle('active', v);
  document.getElementById('planetWrap').style.display = v ? 'none' : 'block';
  document.getElementById('compass').style.display = v ? 'none' : 'flex';
}
function showBackBtn(show){ document.getElementById('backBtn').style.display = show ? 'flex' : 'none'; }
function updateLocation(name){ document.getElementById('narrationLabel').textContent = 'Narración'; }
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> t.classList.remove('show'), 2600);
}

// ---- 5. NARRACIÓN ----
const narrationAudio = new Audio();
let userEnabledAudio = false;
function loadNarration(src){
  narrationAudio.pause(); narrationAudio.currentTime = 0; setPlayIcon(false);
  narrationAudio.src = src || '';
  if(userEnabledAudio && narrationAudio.src){
    narrationAudio.play().then(()=> setPlayIcon(true)).catch(()=>{});
  }
}
function setPlayIcon(playing){
  document.getElementById('playIcon').style.display = playing ? 'none' : 'block';
  document.getElementById('pauseIcon').style.display = playing ? 'block' : 'none';
}
document.getElementById('playPauseBtn').addEventListener('click', ()=>{
  userEnabledAudio = true;
  if(!narrationAudio.src) return;
  if(narrationAudio.paused){ narrationAudio.play().catch(()=>{}); setPlayIcon(true); }
  else { narrationAudio.pause(); setPlayIcon(false); }
});
narrationAudio.addEventListener('timeupdate', ()=>{
  if(!narrationAudio.duration) return;
  document.getElementById('narrationProgress').style.width =
    (narrationAudio.currentTime / narrationAudio.duration) * 100 + '%';
});
narrationAudio.addEventListener('ended', ()=> setPlayIcon(false));

// ---- 6. PANTALLA COMPLETA / MENÚ ----
document.getElementById('fullscreenBtn').addEventListener('click', ()=>{
  if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
});
document.getElementById('sidebarToggle').addEventListener('click', ()=>{
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// ---- 7. CARGA INICIAL ----
const loadScreen = document.getElementById('loadScreen');
const soundPrompt = document.getElementById('soundPrompt');
const loadPct = document.getElementById('loadPct');
let pct = 0;
const pctTimer = setInterval(()=>{
  pct = Math.min(96, pct + Math.random()*14);
  loadPct.textContent = Math.round(pct) + '%';
}, 180);

(async function boot(){
  await loadExplorable('principal', SCENES.principal, 'Vista Principal');
  clearInterval(pctTimer);
  loadPct.textContent = '100%';
  setTimeout(()=>{
    loadScreen.classList.add('hidden');
  }, 300);
})();

// ---- 8. ELECCIÓN DE SONIDO → activa y te lleva a la vista 360 frontal ----
function enterTour(withSound){
  userEnabledAudio = withSound;
  soundPrompt.classList.add('hidden');
  const wrap = document.getElementById('planetWrap');
  wrap.classList.add('zoom-in-centered');
  setTimeout(()=> wrap.classList.remove('zoom-in-centered'), 480);
  startAuto();
  if(withSound && SCENES.principal.audio) loadNarration(SCENES.principal.audio);
}
document.getElementById('soundYes').addEventListener('click', ()=> enterTour(true));
document.getElementById('soundNo').addEventListener('click', ()=> enterTour(false));

window.addEventListener('resize', ()=>{
  if(panoView.classList.contains('active')){
    recomputePanoDims(panoZoom);
  }
});
