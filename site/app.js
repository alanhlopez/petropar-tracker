/* Tracker Petropar vs. petróleo. Sin build: D3 7.9.0 (jsdelivr) + SVG. Lee data.json. */
(function () {
  'use strict';

  // Repo y workflow cuya última corrida exitosa da la hora de "Última verificación" (API pública de GitHub, sin token).
  var GH_REPO = 'alanhlopez/petropar-tracker';
  var GH_WORKFLOW = 'scrape.yml';

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var CORTOS = {
    diesel_mbarete: 'Mbarete', diesel_pora: 'Porã', nafta_aratiri97: 'Aratiri',
    nafta_oikoite93: 'Oikoite', nafta_kape88: 'Kape', nafta_ecoflex85: 'Ecoflex',
    glp_kg: 'Gas kg', glp_litro: 'Gas litro'
  };
  var PRES_CORTO = { 'Fernando Lugo': 'Lugo', 'Federico Franco': 'Franco', 'Horacio Cartes': 'Cartes', 'Mario Abdo Benítez': 'Abdo', 'Santiago Peña': 'Peña' };
  // series internacionales que muestra el sitio (WTI se guarda en petroleo.csv pero no se publica)
  var OIL_NOMBRE = { brent: 'Brent', ulsd: 'Diésel ULSD' };
  var OIL_FUENTE = { brent: 'Brent (Europa, FOB)', ulsd: 'diésel ULSD (Costa del Golfo, EE.UU.)' };
  var TIPO_TXT = {
    max_o_sugerido_venta_publico: 'Precio máximo y/o sugerido de venta al público (referencia, no necesariamente el precio efectivo de surtidor)',
    venta_publico: 'Venta al público'
  };
  var ESTADO_TXT = { verificado: 'verificado', derivado: 'derivado', planilla: 'planilla', a_confirmar: 'a confirmar' };
  var FECHA_ESTADO_TXT = { confirmada: 'confirmada', a_confirmar: 'a confirmar' };

  var parse = d3.utcParse('%Y-%m-%d');
  // ?og=1: modo imagen para compartir (1200×630, solo título y gráfico); lo captura etl/og_image.py en el build
  var OG = false;
  try { OG = new URLSearchParams(location.search).get('og') === '1'; } catch (e) { /* sin parámetros */ }
  if (OG) document.documentElement.classList.add('modo-og');
  // desde/hasta: rango visible del histórico (Date UTC); preset: botón activo ('todo', '5a', ...) o null si es personalizado
  var state = { vista: 'dual', oil: 'brent', desde: null, hasta: null, preset: 'todo', tab: 'liq', sel: null };
  var D = null;          // datos crudos
  var PRODS = {};        // id -> {meta, segs}
  var OIL = {};          // brent|ulsd -> {mensual:[{d,v}], diario:[{d,iso,v}]}
  var XMIN_ALL, XMAX;
  var TRAMO = null;      // {a, b}: tramo con tipo_precio = max_o_sugerido_venta_publico (derivado de los datos)

  /* ---------- tema ----------
     El tema se fija con data-theme en <html> (script inline en index.html, antes del primer pintado).
     Claro por defecto; no sigue prefers-color-scheme. Se recuerda en localStorage (siempre en try/catch).
     ?tema=oscuro | ?tema=claro fuerza el tema solo para esa visita (útil para capturas).
     La exportación a PNG (exportarPng) siempre sale en tema claro, sin importar el tema activo en pantalla. */
  function temaActual() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'oscuro' : 'claro'; }
  function metaCS() {
    var mt = document.getElementById('meta-cs');
    if (mt) mt.setAttribute('content', temaActual() === 'oscuro' ? 'dark' : 'light');
  }
  function initTema() {
    var b = document.getElementById('btn-tema');
    if (!b) return;
    function sync() { b.setAttribute('aria-pressed', temaActual() === 'oscuro' ? 'true' : 'false'); }
    sync(); metaCS();
    b.addEventListener('click', function () {
      var nuevo = temaActual() === 'oscuro' ? 'claro' : 'oscuro';
      document.documentElement.setAttribute('data-theme', nuevo === 'oscuro' ? 'dark' : 'light');
      try { localStorage.setItem('tema', nuevo); } catch (e) { /* sin almacenamiento: vale solo esta visita */ }
      sync(); metaCS();
      if (D) render();
    });
  }

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function miles(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function dec(n, k) {
    var s = Number(n).toFixed(k).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return s.join(',');
  }
  function gs(n) { return 'G. ' + miles(n); }
  function mesTexto(am) { return am ? MESES[+am.slice(5, 7) - 1] + ' ' + am.slice(0, 4) : ''; }
  function fmtIso(iso) { if (!iso) return ''; var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtD(d) { return fmtIso(d.toISOString().slice(0, 10)); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function urlOk(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }
  // el id va dentro de atributos style: solo se aceptan ids simples
  function cvar(id) { return /^[a-z0-9_]+$/.test(id) ? 'var(--c-' + id + ')' : 'currentColor'; }
  function el(sel) { return document.querySelector(sel); }

  /* ---------- preparación de datos ---------- */
  function prepare(data) {
    D = data;
    var maxRow = null, minRow = null;
    (D.productos || []).forEach(function (m) {
      var rows = ((D.precios || {})[m.id] || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
      rows.forEach(function (r) {
        if (!maxRow || r.fecha > maxRow) maxRow = r.fecha;
        if (!minRow || r.fecha < minRow) minRow = r.fecha;
      });
      PRODS[m.id] = { meta: m, rows: rows, segs: [] };
    });
    var ult = (D.ultimo_dato && D.ultimo_dato.petropar) || iso(new Date());
    // los precios siguen vigentes hasta que se generó data.json, no solo hasta el último cambio
    var gen = D.generado ? String(D.generado).slice(0, 10) : '';
    var finIso = [ult, maxRow || '', gen].sort().pop();
    XMAX = parse(finIso);
    XMIN_ALL = parse(minRow && minRow < '2009-01-02' ? minRow : '2009-01-01');
    if (minRow && minRow > '2009-01-01') XMIN_ALL = parse(minRow);

    // tramo de precio máximo/sugerido: primera y última fecha con ese tipo, hasta la primera fila de venta al público
    var mxA = '', vpA = '';
    Object.keys(PRODS).forEach(function (id) {
      PRODS[id].rows.forEach(function (r) {
        if (r.tipo_precio === 'max_o_sugerido_venta_publico' && (!mxA || r.fecha < mxA)) mxA = r.fecha;
        if (r.tipo_precio === 'venta_publico' && (!vpA || r.fecha < vpA)) vpA = r.fecha;
      });
    });
    TRAMO = mxA ? { a: parse(mxA), b: parse(vpA || finIso), aIso: mxA, bIso: vpA } : null;

    /* Huecos: la ÚNICA fuente es productos[i].huecos = [{desde, hasta}] (hasta null = sin retomar).
       La línea llega hasta `desde` y no hay línea hasta la fila con fecha `hasta`; nunca se arrastra el precio.
       Se arman "tramos vivos" [inicio, desde1], [hasta1, desde2], ..., [hastaN, fin]: un tramo puede ser de un solo
       día (huecos contiguos) y esa fila queda como punto aislado. Una fila dentro de un hueco tampoco desaparece. */
    Object.keys(PRODS).forEach(function (id) {
      var p = PRODS[id];
      function mk(rows) { return rows.map(function (r) { return { d: parse(r.fecha), v: r.precio, row: r }; }); }
      p.gaps = ((p.meta.huecos || []).map(function (g) {
        return { aIso: g.desde, bIso: g.hasta || null, a: parse(g.desde), b: g.hasta ? parse(g.hasta) : null };
      })).sort(function (u, v) { return u.aIso < v.aIso ? -1 : 1; });
      if (!p.rows.length) return;
      var live = [], cur = p.rows[0].fecha, k;
      for (k = 0; k < p.gaps.length; k++) {
        if (cur <= p.gaps[k].aIso) live.push([cur, p.gaps[k].aIso]);
        cur = p.gaps[k].bIso;
        if (!cur) break;
      }
      if (cur) live.push([cur, finIso]);
      var usada = {};
      live.forEach(function (iv) {
        var rs = p.rows.filter(function (r) { return r.fecha >= iv[0] && r.fecha <= iv[1]; });
        rs.forEach(function (r) { usada[r.fecha] = true; });
        if (rs.length) p.segs.push({ pts: mk(rs), end: parse(iv[1]) });
      });
      p.rows.forEach(function (r) {
        if (!usada[r.fecha]) p.segs.push({ pts: mk([r]), end: parse(r.fecha) });   // fila dentro de un hueco: punto aislado
      });
      p.segs.sort(function (u, v) { return u.pts[0].d - v.pts[0].d; });
    });

    if (D.ipc && D.ipc.serie && D.ipc.serie.length) {
      IPC = { base: D.ipc.base, mapa: {} };
      D.ipc.serie.forEach(function (r) { IPC.mapa[r[0]] = r[1]; });
      IPC.vb = IPC.mapa[IPC.base];
    }
    ['brent', 'ulsd'].forEach(function (k) {
      var o = (D.petroleo || {})[k];
      if (!o) return;
      OIL[k] = {
        mensual: (o.mensual || []).map(function (r) { return { d: parse(r[0]), v: r[1] }; }),
        diario: (o.diario || []).map(function (r) { return { d: parse(r[0]), iso: r[0], v: r[1] }; })
      };
    });
  }

  /* Vistas: 'dual' e 'index' usan el precio nominal; 'usd' = US$ por litro con el tipo de cambio del BCP de la fecha de
     vigencia (calculado en data.json); 'real' = Gs constantes del último mes del IPC (precio vigente de cada mes
     por IPC(base) / IPC(mes): la línea baja mes a mes aunque el precio nominal no cambie). */
  var LITROS_POR_GALON = 3.785411784;
  var IPC = null;   // {base, mapa: {'AAAA-MM': ipc}, vb}
  function mesIso(d) { return d.toISOString().slice(0, 7); }
  function factorReal(d) {
    if (!IPC) return null;
    var v = IPC.mapa[mesIso(d)];
    if (v == null && mesIso(d) > IPC.base) v = IPC.vb;   // meses posteriores a la base: sin deflactar todavía
    return v ? IPC.vb / v : null;
  }
  function segsVista(p, vista) {
    p.cache = p.cache || {};
    if (p.cache[vista]) return p.cache[vista];
    var out = [];
    p.segs.forEach(function (sg) {
      var pts = [];
      if (vista === 'usd') {
        sg.pts.forEach(function (q) { if (q.row.usd != null) pts.push({ d: q.d, v: q.row.usd, row: q.row }); });
      } else {   // real: un punto por fila y uno al comienzo de cada mes mientras rige
        sg.pts.forEach(function (q, i) {
          var hasta = i + 1 < sg.pts.length ? sg.pts[i + 1].d : sg.end, f = factorReal(q.d);
          if (f) pts.push({ d: q.d, v: q.v * f, row: q.row });
          var m = new Date(Date.UTC(q.d.getUTCFullYear(), q.d.getUTCMonth() + 1, 1));
          for (; m < hasta; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
            var fm = factorReal(m); if (fm) pts.push({ d: m, v: q.v * fm, row: q.row });
          }
        });
      }
      if (pts.length) out.push({ pts: pts, end: sg.end });
    });
    return (p.cache[vista] = out);
  }
  function seriesPrice(id, vista) {
    var p = PRODS[id];
    if (!p || !p.segs.length) return null;
    var segs = vista === 'usd' || vista === 'real' ? segsVista(p, vista) : p.segs;
    if (!segs.length) return null;
    return { id: id, kind: 'price', name: p.meta.nombre, short: CORTOS[id] || p.meta.nombre, color: cvar(id), segs: segs, gaps: p.gaps, rows: p.rows,
      vista: vista || 'dual',
      // filas en la unidad de la vista (para la variación del período)
      filasV: vista === 'usd' || vista === 'real'
        ? [].concat.apply([], segs.map(function (sg) { return sg.pts.map(function (q) { return { fecha: iso(q.d), precio: q.v }; }); }))
        : p.rows,
      hasMax: p.rows.some(function (r) { return r.tipo_precio === 'max_o_sugerido_venta_publico'; }) };
  }
  // diario = true: serie diaria (rangos de 2 años o menos); si no, promedio mensual
  function seriesOil(k, diario, porLitro) {
    var o = OIL[k];
    if (!o || !o.mensual.length) return null;
    var pts = diario && o.diario.length ? o.diario : o.mensual;
    if (porLitro) {   // vista US$ por litro: el petróleo va en el mismo eje que los combustibles
      var ck = (diario ? 'dl' : 'ml');
      o.cache = o.cache || {};
      pts = o.cache[ck] = o.cache[ck] || pts.map(function (q) { return { d: q.d, iso: q.iso, v: q.v / LITROS_POR_GALON }; });
    }
    return { porLitro: !!porLitro, id: 'oil_' + k, kind: 'oil', key: k, name: OIL_NOMBRE[k], short: k === 'brent' ? 'Brent' : 'ULSD', color: 'var(--oil)',
      diario: pts === o.diario, segs: [{ pts: pts, end: pts[pts.length - 1].d }], gaps: [] };
  }
  // último punto con fecha <= t (petróleo), o null
  function ptLE(pts, t) { var i = bisD(pts, t) - 1; return i >= 0 ? pts[i] : null; }
  function gapAt(s, t) {
    var gs_ = s.gaps || [];
    for (var i = 0; i < gs_.length; i++) if (t > gs_[i].a && (!gs_[i].b || t < gs_[i].b)) return gs_[i];
    return null;
  }
  function firstD(s) { return s.segs[0].pts[0].d; }
  function lastEnd(s) { return s.segs[s.segs.length - 1].end; }

  var bisD = d3.bisector(function (p) { return p.d; }).right;
  // punto de precio vigente en t (o null si hay hueco / antes del primer dato)
  function pointAt(s, t) {
    for (var i = 0; i < s.segs.length; i++) {
      var g = s.segs[i];
      if (t >= g.pts[0].d && t <= g.end) { return g.pts[bisD(g.pts, t) - 1]; }
    }
    return null;
  }
  // valor para la base del índice: vigente en t, o el primero posterior, o el último
  function baseValue(s, t) {
    var p = s.kind === 'oil'
      ? (function () { var pts = s.segs[0].pts, i = bisD(pts, t) - 1; return pts[Math.max(0, i)]; })()
      : pointAt(s, t);
    if (!p) {
      for (var i = 0; i < s.segs.length && !p; i++) {
        for (var j = 0; j < s.segs[i].pts.length; j++) if (s.segs[i].pts[j].d >= t) { p = s.segs[i].pts[j]; break; }
      }
    }
    if (!p) { var g = s.segs[s.segs.length - 1]; p = g.pts[g.pts.length - 1]; }
    return p.v;
  }

  /* ---------- escalas ---------- */
  // mínimo y máximo de las series en el rango visible (incluye el valor vigente al inicio)
  function yExtVisible(list, xmin, xmax) {
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (s) {
      s.segs.forEach(function (g) {
        g.pts.forEach(function (p) { if (p.d >= xmin && p.d <= xmax) { if (p.v > hi) hi = p.v; if (p.v < lo) lo = p.v; } });
      });
      var p0 = s.kind === 'oil' ? ptLE(s.segs[0].pts, xmin) : pointAt(s, xmin);
      if (p0) { if (p0.v > hi) hi = p0.v; if (p0.v < lo) lo = p0.v; }
    });
    return isFinite(lo) ? [lo, hi] : null;
  }
  var MULT = [1, 2, 2.5, 3, 4, 5, 6, 8];
  function pasosNice(min) {   // pasos "redondos" >= min, de menor a mayor
    var b = Math.pow(10, Math.floor(Math.log10(min))), out = [];
    [b / 10, b, b * 10].forEach(function (e) { MULT.forEach(function (k) { if (e * k >= min * 0.999) out.push(e * k); }); });
    return out;
  }
  // eje con margen: el rango visible más un 6 % arriba y abajo; como mucho nMax intervalos. piso0: no bajar de 0
  function ejeConMargen(ext, nMax, piso0) {
    var lo = ext[0], hi = ext[1], span = hi - lo;
    if (span <= 0) span = Math.abs(hi) * 0.1 || 1;
    lo -= span * 0.06; hi += span * 0.06;
    if (piso0 && lo < 0) lo = 0;
    var pasos = pasosNice((hi - lo) / nMax);
    for (var i = 0; i < pasos.length; i++) {
      var st = pasos[i], a = Math.floor(lo / st + 1e-9) * st, n = Math.ceil((hi - a) / st - 1e-9);
      if (n <= nMax) return { a: a, paso: st, n: Math.max(1, n) };
    }
    var p = pasos[pasos.length - 1]; return { a: Math.floor(lo / p) * p, paso: p, n: nMax };
  }
  // eje derecho con la misma cantidad de intervalos que el izquierdo (comparten la grilla)
  function ejeAlineado(ext, n) {
    var lo = ext[0], hi = ext[1], span = (hi - lo) || Math.abs(hi) * 0.1 || 1;
    lo -= span * 0.06; hi += span * 0.06;
    var pasos = pasosNice((hi - lo) / n);
    for (var i = 0; i < pasos.length; i++) {
      var st = pasos[i], a = Math.floor(lo / st + 1e-9) * st;
      if (a + n * st >= hi - 1e-9) return { a: a, paso: st, n: n };
    }
    var p = pasos[pasos.length - 1]; return { a: Math.floor(lo / p) * p, paso: p, n: n };
  }
  function decPaso(p) { return p % 1 === 0 ? 0 : (Math.abs(p * 10 - Math.round(p * 10)) < 1e-9 ? 1 : 2); }

  /* Variación del período visible para la etiqueta final: precio vigente al final contra el vigente al inicio
     (Rango.variacion; nunca a través de un hueco). Mismo criterio de flecha y color que "Precios hoy": ▲ sube, ▼ baja. */
  function variacionSerie(s, xmin, xmax) {
    var a, b, desde = null;
    if (s.kind === 'oil') {
      var pa = ptLE(s.segs[0].pts, xmin), pb = ptLE(s.segs[0].pts, xmax);
      if (!pa || !pb || !pa.v) return null;
      a = pa.v; b = pb.v;
    } else {
      var r = Rango.variacion(s.filasV || s.rows, xmin, xmax, PRODS[s.id].meta.huecos || []);
      if (!r) return null;
      a = r.inicio.precio; b = r.fin.precio; desde = r.desde;
    }
    var pct = Math.round((b / a - 1) * 1000) / 10;
    // empieza después del inicio del rango: se aclara desde cuándo ("desde mar-2011")
    var nota = desde ? 'desde ' + MESES[+desde.slice(5, 7) - 1] + '-' + desde.slice(0, 4) : '';
    if (pct === 0) return { pct: 0, cls: 'igual', txt: '= 0%', nota: nota };
    return { pct: pct, cls: pct > 0 ? 'sube' : 'baja', txt: (pct > 0 ? '▲ +' : '▼ −') + dec(Math.abs(pct), 1) + '%', nota: nota };
  }

  /* ---------- colisión de etiquetas ---------- */
  function relax(items, gap, top, bottom) {
    items.sort(function (a, b) { return a.y0 - b.y0; });
    items.forEach(function (it) { it.y = it.y0; });
    var n = items.length; if (!n) return;
    var i;
    for (i = 1; i < n; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    if (items[n - 1].y > bottom) {
      items[n - 1].y = bottom;
      for (i = n - 2; i >= 0; i--) if (items[i + 1].y - items[i].y < gap) items[i].y = items[i + 1].y - gap;
    }
    if (items[0].y < top) {
      items[0].y = top;
      for (i = 1; i < n; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    }
  }

  /* ---------- gráfico ---------- */
  var charts = {};   // host.id -> {redraw, pinned}
  var ARRASTRE = { fin: 0 };   // momento en que terminó el último arrastre (para no tomarlo como click)

  function drawChart(hostId, o) {
    var host = document.getElementById(hostId);
    var W = Math.floor(host.clientWidth);
    if (W < 50) return;                                  // oculto
    host.innerHTML = '';
    var mobile = W < 600;
    var showOil = !!o.oil;
    var index = o.view === 'index';
    var lista = o.series.slice();                        // precios
    if (!lista.length && !showOil) {
      host.innerHTML = '<div class="vacio">' + esc(o.vacio || 'Sin datos para mostrar.') + '</div>';
      return;
    }
    var all = lista.concat(showOil ? [o.oil] : []);

    // rango x: el elegido (botones, navegador, arrastre, zoom) o todo
    var xmax = o.hasta || XMAX, xmin = o.desde || XMIN_ALL;

    if (o.xDesdeDatos && lista.length) {   // p. ej. GLP: el eje arranca en su primer dato (con margen de 60 días)
      xmin = new Date(+d3.min(lista, firstD) - 60 * 864e5);
    }

    // layout
    var vistaUsd = o.view === 'usd', vistaReal = o.view === 'real';
    var dualAx = showOil && !index && !vistaUsd;   // en US$ por litro el petróleo comparte el eje
    var axisR = dualAx && !mobile ? 58 : 0;   // en móvil los ticks US$ van por dentro del área
    var labW = mobile ? 0 : 238;      // en móvil las etiquetas finales van en un bloque debajo del gráfico
    var m = { top: 48, left: mobile ? 41 : 64, bottom: 26, right: axisR + (mobile ? 8 : labW + 4) };
    var H = o.altura || (mobile ? 420 : Math.max(440, Math.min(560, Math.round(W * 0.5))));
    var iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    var fs = mobile ? 10.5 : 12;
    var x = d3.scaleUtc().domain([xmin, xmax]).range([0, iw]);
    var fs2 = fs + 3;
    var band = 2 * fs2 + 8;           // franja superior reservada (hitos, rótulo de tramo); los datos no entran

    // índice: base
    var base = null, baseVals = {};
    var activas = all.filter(function (s) { return lastEnd(s) >= xmin && firstD(s) <= xmax; });
    if (index && activas.length) {
      base = new Date(Math.max.apply(null, activas.map(function (s) { return Math.max(+xmin, +firstD(s)); })));
      // la base no puede caer dentro de un hueco de una serie visible: se corre al fin de ese hueco
      for (var it = 0, mov = true; mov && it < 20; it++) {
        mov = false;
        activas.forEach(function (s) {
          var hg = gapAt(s, base);
          if (hg && hg.b) { base = hg.b; mov = true; }
        });
      }
      if (base > xmax) base = xmax;
      activas.forEach(function (s) { baseVals[s.id] = baseValue(s, base); });
    }
    var tr = function (s, v) { return index ? (baseVals[s.id] ? v / baseVals[s.id] * 100 : NaN) : v; };

    // escalas y
    var yL, yR = null, ticksL, ticksR = null, decR = 1;
    var priceAct = lista.filter(function (s) { return activas.indexOf(s) >= 0; });
    if (index) {
      var lo = Infinity, hi = -Infinity;
      activas.forEach(function (s) {
        s.segs.forEach(function (g) {
          g.pts.forEach(function (p) {
            if (p.d >= xmin && p.d <= xmax) { var v = tr(s, p.v); if (v < lo) lo = v; if (v > hi) hi = v; }
          });
        });
      });
      if (!isFinite(lo)) { lo = 50; hi = 150; }
      lo = Math.min(lo, 100) * 0.92; hi = Math.max(hi, 100) * 1.05;
      yL = d3.scaleLinear().domain([lo, hi]).range([ih, band]).nice(5);
      ticksL = yL.ticks(5);
    } else {
      // los dos ejes se reajustan al rango visible, con margen
      var eL = ejeConMargen(yExtVisible(vistaUsd && showOil && activas.indexOf(o.oil) >= 0 ? priceAct.concat([o.oil]) : priceAct, xmin, xmax)
        || (vistaUsd ? [0, 2] : [0, 12000]), 6, true);
      var decL = vistaUsd ? decPaso(eL.paso) : 0;
      var n = eL.n;
      ticksL = d3.range(0, n + 1).map(function (i) { return eL.a + i * eL.paso; });
      yL = d3.scaleLinear().domain([eL.a, eL.a + eL.paso * n]).range([ih, band]);
      if (dualAx) {
        var eR = ejeAlineado((activas.indexOf(o.oil) >= 0 && yExtVisible([o.oil], xmin, xmax)) || [0, 3], n);
        yR = d3.scaleLinear().domain([eR.a, eR.a + eR.paso * n]).range([ih, band]);
        ticksR = d3.range(0, n + 1).map(function (i) { return eR.a + i * eR.paso; });
        decR = decPaso(eR.paso);
      }
    }
    var yOf = function (s, v) { return (s.kind === 'oil' && yR) ? yR(v) : yL(tr(s, v)); };

    // svg
    var svg = d3.select(host).append('svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', o.aria || 'Gráfico de precios');
    var uid = hostId + '-c';
    var defs = svg.append('defs');
    defs.append('clipPath').attr('id', uid).append('rect').attr('x', 0).attr('y', -2).attr('width', iw).attr('height', ih + 4);
    var pat = defs.append('pattern').attr('id', uid + 'p').attr('width', 6).attr('height', 6)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).style('stroke', 'var(--promo)').attr('stroke-width', 2.5);
    var pat2 = defs.append('pattern').attr('id', uid + 'm').attr('width', 7).attr('height', 7)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(-45)');
    pat2.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7).style('stroke', 'var(--muted)').attr('stroke-width', 1);
    var g = svg.append('g').attr('transform', 'translate(' + m.left + ',' + m.top + ')');

    // sombreado presidentes
    var gp = g.append('g').attr('clip-path', 'url(#' + uid + ')');
    var presVis = [];
    (D.presidentes || []).forEach(function (pr, i) {
      var a = parse(pr.inicio), b = pr.fin ? parse(pr.fin) : xmax;
      var a2 = a < xmin ? xmin : a, b2 = b > xmax ? xmax : b;
      if (b2 <= a2) return;
      presVis.push(pr);
      gp.append('rect').attr('x', x(a2)).attr('width', Math.max(0, x(b2) - x(a2))).attr('y', 0).attr('height', ih)
        .style('fill', i % 2 ? 'var(--shade-b)' : 'var(--shade-a)');
      var w = x(b2) - x(a2);
      var t = g.append('text').attr('class', 'pres').attr('text-anchor', 'middle').attr('x', (x(a2) + x(b2)) / 2).attr('y', -28)
        .attr('font-size', mobile ? 10 : 11.5).text(mobile ? (PRES_CORTO[pr.nombre] || pr.nombre) : pr.nombre);
      try {
        if (t.node().getComputedTextLength() > w - 4) {
          t.text(PRES_CORTO[pr.nombre] || pr.nombre);
          if (t.node().getComputedTextLength() > w - 4) t.remove();
        }
      } catch (e) { /* sin medición */ }
    });

    // tramo 2009-2014: precio máximo y/o sugerido (trama sutil + rótulo en la franja superior)
    var tramoVis = !!(TRAMO && TRAMO.b > xmin && TRAMO.a < xmax && lista.some(function (s) { return s.hasMax; }));
    if (tramoVis) {
      var ta = Math.max(0, x(TRAMO.a)), tb = Math.min(iw, x(TRAMO.b));
      gp.append('rect').attr('x', ta).attr('width', Math.max(0, tb - ta)).attr('y', 0).attr('height', ih)
        .style('fill', 'url(#' + uid + 'm)').attr('opacity', 0.22);
      gp.append('line').attr('x1', tb).attr('x2', tb).attr('y1', band).attr('y2', ih).style('stroke', 'var(--muted)')
        .attr('stroke-width', 1).attr('opacity', 0.35);
      var tt0 = g.append('text').attr('class', 'halo tramo-t').attr('x', ta + 4).attr('y', fs + 1).attr('font-size', mobile ? 10 : 11)
        .text('Precio máximo/sugerido');
      // nunca cortado en el borde: versión corta o nada
      try {
        if (tt0.node().getComputedTextLength() > tb - ta - 8) tt0.text('Máx./sugerido');
        if (tt0.node().getComputedTextLength() > tb - ta - 8) tt0.remove();
      } catch (e) { /* sin medición */ }
    }

    // grilla y ejes
    g.append('g').attr('class', 'grid').selectAll('line').data(ticksL).join('line')
      .attr('x1', 0).attr('x2', iw).attr('y1', yL).attr('y2', yL);
    var fmtL = index ? function (v) { return dec(v, 0); } : (vistaUsd ? function (v) { return dec(v, decL); } : function (v) { return miles(v); });
    g.append('g').attr('class', 'axis').call(d3.axisLeft(yL).tickValues(ticksL).tickFormat(fmtL).tickSize(0).tickPadding(6))
      .call(function (a) { a.select('.domain').remove(); }).selectAll('text').attr('font-size', fs);
    var nY = (xmax - xmin) / (365.25 * 864e5);
    var tickV, fmtX, nivel = Rango.nivelEje(xmin, xmax);
    // años, meses ("ene 2026") o días ("15 oct") según el zoom; los pasos se eligen para que las etiquetas entren
    function cabe(lista, ancho) { return lista.length <= Math.max(2, Math.floor(iw / ancho)); }
    if (nivel === 'dias') {
      [1, 2, 3, 7, 14].some(function (k) { tickV = d3.utcDay.every(k).range(xmin, xmax); return cabe(tickV, mobile ? 46 : 54); });
      fmtX = function (d) { return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()]; };
    } else if (nivel === 'meses') {
      [1, 2, 3, 4, 6, 12].some(function (k) { tickV = d3.utcMonth.every(k).range(xmin, xmax); return cabe(tickV, mobile ? 56 : 66); });
      fmtX = function (d) { return MESES[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
    } else {
      var k = Math.max(1, Math.ceil(nY * (mobile ? 40 : 50) / iw));
      if (k === 3) k = 4; if (k > 4 && k < 10) k = 5;
      tickV = d3.utcYear.every(k).range(xmin, xmax);
      fmtX = function (d) { return String(d.getUTCFullYear()); };
    }
    g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + ih + ')')
      .call(d3.axisBottom(x).tickValues(tickV).tickFormat(fmtX).tickSize(0).tickPadding(8))
      .selectAll('text').attr('font-size', fs);
    // captions de ejes
    g.append('text').attr('x', -m.left + 2).attr('y', -9).attr('font-size', mobile ? 10 : 11.5)
      .text(index ? 'Índice (base 100)' : (vistaUsd ? 'US$ por litro' : (vistaReal ? 'Gs de ' + mesTexto(IPC.base) + ' por litro' : (o.ejeL || 'Gs por litro'))));
    if (dualAx) {
      if (mobile) {
        /* ticks US$ en móvil: se dibujan después de las líneas (con halo) */
      } else {
        g.append('g').attr('class', 'axis').attr('transform', 'translate(' + iw + ',0)')
          .call(d3.axisRight(yR).tickValues(ticksR).tickFormat(function (v) { return 'US$ ' + dec(v, decR); }).tickSize(0).tickPadding(6))
          .call(function (a) { a.select('.domain').remove(); }).selectAll('text').attr('font-size', fs);
      }
      g.append('text').attr('x', iw + axisR).attr('text-anchor', 'end').attr('y', -9).attr('font-size', mobile ? 10 : 11.5)
        .text(mobile ? 'US$/gal (' + o.oil.short + ')' : 'US$ por galón (' + o.oil.short + ')');
    }

    // eventos
    var gc = g.append('g').attr('clip-path', 'url(#' + uid + ')');
    var evs = (D.eventos || []).map(function (e) {
      return { e: e, a: parse(e.fecha), b: e.fecha_fin ? parse(e.fecha_fin) : null };
    }).filter(function (v) { return v.a && (v.b || v.a) >= xmin && v.a <= xmax; });
    // promos: banda con trama si hay fecha_fin posterior a fecha; si no, marcador ▲ sobre el eje X.
    // Solo en combustibles líquidos (o.sinPromos en GLP). Van debajo de la franja reservada para hitos.
    // Colisión con hitos: la banda es siempre de altura completa; el hito se dibuja encima con un contorno del color
    // de fondo (halo), así se distingue aunque quede a pocos px de la banda.
    var hitosV = evs.filter(function (v) { return v.e.tipo !== 'promo'; });
    var promosV = o.sinPromos ? [] : evs.filter(function (v) { return v.e.tipo === 'promo'; });
    var hitoFin = hitosV.map(function () { return ih; });   // fin de la línea del hito (se acorta si cae sobre un ▲)
    var hayBanda = false, hayTri = false;
    promosV.forEach(function (v) {
      var x1 = x(v.a), span = v.b && v.b > v.a, x2 = span ? x(v.b) : x1;
      var w = span ? Math.max(6, x2 - x1) : 11, xa = (x1 + x2) / 2 - w / 2, xb = xa + w;
      if (span) {
        hayBanda = true;
        var y0 = band;   // la banda siempre cubre toda la altura del área de datos
        gc.append('rect').attr('x', xa).attr('width', w).attr('y', y0).attr('height', ih - y0)
          .style('fill', 'url(#' + uid + 'p)').attr('opacity', 0.7);
        gc.append('rect').attr('x', xa).attr('width', w).attr('y', y0).attr('height', ih - y0)
          .attr('fill', 'none').style('stroke', 'var(--promo)').attr('stroke-width', 1.2);
      } else {
        hayTri = true;
        hitosV.forEach(function (h, k) { if (Math.abs(x(h.a) - x1) < 9) hitoFin[k] = Math.min(hitoFin[k], ih - 14); });
        gc.append('path').attr('d', 'M' + (x1 - 5.5) + ',' + ih + 'l5.5,-9l5.5,9z').style('fill', 'var(--promo)')
          .style('stroke', 'var(--bg)').attr('stroke-width', 1);
      }
    });
    // hitos: líneas desde debajo de la franja superior (así no cruzan ninguna etiqueta) y rótulos con halo en la franja
    hitosV.forEach(function (v, k) {
      var xx = x(v.a);
      g.append('line').attr('class', 'hito-halo').attr('x1', xx).attr('x2', xx).attr('y1', band).attr('y2', hitoFin[k]);
      g.append('line').attr('class', 'hito-l').attr('x1', xx).attr('x2', xx).attr('y1', band).attr('y2', hitoFin[k]);
    });
    hitosV.forEach(function (v, k) {
      var xx = x(v.a);
      // rótulo completo, o abreviado (sin paréntesis), o nada: nunca cortado en el borde
      var largo = v.e.etiqueta, corto = largo.replace(/\s*\(.*?\)/g, '');
      var tt = g.append('text').attr('class', 'hito-t halo').attr('y', fs + 1 + (k % 2) * fs2).attr('font-size', mobile ? 10 : 11);
      var spR = iw - xx - 5, spL = xx - 5, ok = false;
      (mobile ? [corto] : [largo, corto]).some(function (txt) {
        tt.text(txt);
        var tl = 0; try { tl = tt.node().getComputedTextLength(); } catch (e) { tl = txt.length * 6; }
        if (tl <= spR) { tt.attr('x', xx + 5).attr('text-anchor', 'start'); ok = true; }
        else if (tl <= spL) { tt.attr('x', xx - 5).attr('text-anchor', 'end'); ok = true; }
        return ok;
      });
      if (!ok) tt.remove();
    });

    // marcador base 100
    if (index && base) {
      g.append('line').attr('class', 'base-l').attr('x1', 0).attr('x2', iw).attr('y1', yL(100)).attr('y2', yL(100));
      g.append('line').attr('class', 'base-l').attr('x1', x(base)).attr('x2', x(base)).attr('y1', 0).attr('y2', ih);
      g.append('text').attr('class', 'halo').attr('x', x(base) + 4).attr('y', ih - 6).attr('font-size', fs - 1)
        .text('base 100: ' + fmtD(base));
    }

    // líneas
    var gl = g.append('g').attr('clip-path', 'url(#' + uid + ')');
    var orden = all.slice().sort(function (a, b) { return (a.kind === 'oil' ? -1 : 0) - (b.kind === 'oil' ? -1 : 0); });
    orden.forEach(function (s) {
      s.segs.forEach(function (sg) {
        var pts = sg.pts.map(function (p) { return { d: p.d, v: p.v }; });
        if (s.kind === 'price') pts.push({ d: sg.end, v: pts[pts.length - 1].v });
        var ln = d3.line().defined(function (p) { return isFinite(tr(s, p.v)); })
          .x(function (p) { return x(p.d); }).y(function (p) { return yOf(s, p.v); })
          .curve(s.kind === 'price' ? d3.curveStepAfter : d3.curveLinear);
        var path = gl.append('path').attr('d', ln(pts)).attr('fill', 'none').style('stroke', s.color)
          .attr('stroke-linejoin', 'round');
        if (s.kind === 'oil') {
          path.attr('stroke-width', mobile ? 2 : 2.4).attr('stroke-linecap', 'round').attr('stroke-dasharray', mobile ? '0.1 4.5' : '0.1 5.5');
        } else {
          path.attr('stroke-width', mobile ? 2 : 2.4);
        }
      });
    });
    // ticks US$ del eje derecho en móvil: después de las líneas, con halo
    if (dualAx && mobile) {
      g.append('g').selectAll('text').data(ticksR.filter(function (v) { return yR(v) > band + 10; })).join('text').attr('class', 'halo')
        .attr('x', iw - 3).attr('y', function (v) { return yR(v) - 3; })
        .attr('text-anchor', 'end').attr('font-size', fs - 1).text(function (v) { return dec(v, decR); });
    }

    // puntos no firmes (círculo hueco), bordes de huecos (rombo) y filas aisladas (punto); fuera del clip para no cortarse.
    // (Sin <title>: el rect de interacción quedaría encima; el cuadro emergente propio explica el hueco.)
    var gm = g.append('g'), nGapMarks = 0, nNoFirme = 0;
    lista.forEach(function (s) {
      var marcado = {}, rr = mobile ? 3.5 : 4;
      // rombo chico y sin relleno (solo contorno) para no competir con las líneas; si es firme o no lo dice el cuadro emergente
      function rombo(d, v) {
        if (d < xmin || d > xmax) return;
        nGapMarks++;
        var cx = x(d), cy = yOf(s, v);
        gm.append('path').attr('d', 'M' + cx + ',' + (cy - rr) + 'l' + rr + ',' + rr + 'l' + (-rr) + ',' + rr + 'l' + (-rr) + ',' + (-rr) + 'z')
          .style('fill', 'var(--bg)').style('stroke', s.color).attr('stroke-width', 1.5);
      }
      // hueco: último punto conocido antes (a) y primero después (b); nunca se arrastra el precio
      (s.gaps || []).forEach(function (hg) {
        if ((hg.b && hg.b < xmin) || hg.a > xmax) return;
        var antes = null, despues = null;
        s.rows.forEach(function (r) {
          if (r.fecha <= hg.aIso) antes = r;
          if (!despues && hg.bIso && r.fecha >= hg.bIso) despues = r;
        });
        if (antes) { rombo(hg.a, antes.precio); marcado[+hg.a] = true; if (antes.fecha === hg.aIso) marcado[+parse(antes.fecha)] = true; }
        if (despues) { rombo(parse(despues.fecha), despues.precio); marcado[+parse(despues.fecha)] = true; }
      });
      s.segs.forEach(function (sg) {
        sg.pts.forEach(function (p) {
          if (p.d < xmin || p.d > xmax || marcado[+p.d]) return;
          var aislada = sg.pts.length === 1 && +sg.end === +p.d;
          if (p.row && p.row.firme === false) {
            nNoFirme++;
            gm.append('circle').attr('cx', x(p.d)).attr('cy', yOf(s, p.v)).attr('r', mobile ? 3.5 : 4.5)
              .style('fill', 'var(--bg)').style('stroke', s.color).attr('stroke-width', 2);
          } else if (aislada) {
            gm.append('circle').attr('cx', x(p.d)).attr('cy', yOf(s, p.v)).attr('r', mobile ? 3.5 : 4.5).style('fill', s.color);
          }
        });
      });
    });

    // etiquetas directas
    // valor en la fecha final visible y variación del período (vigente al final contra vigente al inicio; ver rango.js)
    var lab = [], fin = [];
    all.forEach(function (s) {
      if (activas.indexOf(s) < 0) return;
      var pEnd = s.kind === 'oil' ? ptLE(s.segs[0].pts, xmax) : pointAt(s, xmax);
      if (pEnd && isFinite(tr(s, pEnd.v))) {
        lab.push({ s: s, y0: yOf(s, pEnd.v), v: tr(s, pEnd.v), varia: variacionSerie(s, xmin, xmax) });
        return;
      }
      // la serie no llega al final visible (hueco o dejó de publicarse): marca de corte en su último punto visible
      var segV = s.segs.filter(function (sg) { return sg.end >= xmin && sg.pts[0].d <= xmax; }).pop();
      if (segV && s.kind !== 'oil') {
        var pl = segV.pts[segV.pts.length - 1], fe = segV.end < xmax ? segV.end : xmax;
        fin.push({ s: s, x: x(fe), y: yOf(s, pl.v), end: fe });
        // también va en la columna de etiquetas ("hasta DD/MM/AAAA"): con el cursor muestra su valor en esa fecha
        lab.push({ s: s, y0: yOf(s, pl.v), v: tr(s, pl.v), finTxt: 'hasta ' + fmtD(fe), corte: x(fe) });
      }
    });
    // si alguna variación lleva "desde mmm-aaaa" (segunda línea), las etiquetas necesitan dos renglones
    var conNota = lab.some(function (it) { return it.varia && it.varia.nota; });
    var gap = conNota ? 2 * fs + 6 : fs + 3;
    var lx = iw + axisR + 6;
    function txtFin(it) { return it.finTxt || valTxt(it.s, it.v); }
    function valTxt(s, v) {
      if (index) return dec(v, 0);
      if (vistaUsd) return 'US$ ' + dec(v, 2) + (s.kind === 'oil' ? '/L' : '');
      return s.kind === 'oil' ? 'US$ ' + dec(v, 2) + '/gal' : miles(v);
    }
    if (mobile) {
      // móvil: puntos sobre la línea y un bloque de valores debajo del gráfico (texto en tinta del tema)
      lab.forEach(function (it) { if (!it.finTxt) g.append('circle').attr('cx', iw).attr('cy', it.y0).attr('r', 3).style('fill', it.s.color); });
    } else {
      relax(lab, gap, band, ih + 6);
      lab.forEach(function (it) {
        var s = it.s;
        if (!it.finTxt) g.append('circle').attr('class', 'lbl-con').attr('cx', iw).attr('cy', it.y0).attr('r', 3).style('fill', s.color);
        if (Math.abs(it.y - it.y0) > 1 || it.finTxt) {
          g.append('line').attr('class', 'lbl-con').attr('x1', it.finTxt ? it.corte : iw).attr('y1', it.y0).attr('x2', lx).attr('y2', it.y).style('stroke', s.color)
            .attr('stroke-width', 1).attr('stroke-dasharray', it.finTxt ? '2 3' : null).attr('opacity', it.finTxt ? 0.6 : 1);
        }
        var sw = it.grp = g.append('g').attr('class', 'lbl-g').attr('transform', 'translate(' + lx + ',' + it.y + ')');
        if (s.kind === 'oil') {
          sw.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).style('stroke', s.color)
            .attr('stroke-width', 2.6).attr('stroke-linecap', 'round').attr('stroke-dasharray', '0.1 5');
        } else {
          sw.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).style('stroke', s.color).attr('stroke-width', 3);
        }
        var tx = sw.append('text').attr('x', 18).attr('y', 0).attr('dy', '0.34em').attr('font-size', fs)
          .attr('class', s.kind === 'oil' ? 'lbl-oil' : 'lbl-v');
        tx.append('tspan').text((s.kind === 'oil' ? s.short : s.name) + ' ');
        // referencias para las etiquetas dinámicas (valor en la fecha del cursor)
        it.valT = tx.append('tspan').attr('font-weight', it.finTxt ? 400 : 700).text(txtFin(it));
        it.sepT = tx.append('tspan').attr('class', 'lbl-sep').text(it.varia ? ' · ' : '');
        it.varT = tx.append('tspan').attr('class', 'lbl-var ' + (it.varia ? it.varia.cls : '')).text(it.varia ? it.varia.txt : '');
        // "desde mmm-aaaa": segunda línea chica (el producto empieza después del inicio del rango)
        it.notaT = sw.append('text').attr('class', 'lbl-nota').attr('x', 18).attr('y', fs + 2).attr('font-size', fs - 1.5)
          .text(it.varia && it.varia.nota ? it.varia.nota : '');
      });
    }
    // fecha de la columna de etiquetas mientras el cursor está sobre el gráfico
    var fechaCol = mobile ? null : g.append('text').attr('class', 'lbl-fecha').attr('x', lx).attr('y', band - 6)
      .attr('font-size', fs - 0.5).style('display', 'none');
    fin.forEach(function (it) {
      // marcador discreto del corte (el texto "dato hasta" está en tabla, nota y tooltip)
      g.append('line').attr('x1', it.x).attr('x2', it.x).attr('y1', it.y - 7).attr('y2', it.y + 7).style('stroke', it.s.color).attr('stroke-width', 2.5);
    });

    if (mobile) {
      var fb = document.createElement('ul');
      fb.className = 'finales';
      var items = lab.slice().sort(function (a, b) { return a.y0 - b.y0; }).map(function (it) {
        return { s: it.s, txt: it.finTxt ? 'dato ' + it.finTxt : valTxt(it.s, it.v), varia: it.varia };
      });
      fb.innerHTML = '<li class="fin-fecha" hidden></li>' + items.map(function (it) {
        return '<li data-sid="' + esc(it.s.id) + '"><span class="sw' + (it.s.kind === 'oil' ? ' sw-oil' : '') + '" style="border-color:' + it.s.color + '"></span> '
          + esc(it.s.kind === 'oil' ? it.s.short : it.s.name) + ' <strong>' + esc(it.txt) + '</strong>'
          + ' <span class="var-p ' + (it.varia ? it.varia.cls : '') + '">' + (it.varia ? esc(it.varia.txt + (it.varia.nota ? ' (' + it.varia.nota + ')' : '')) : '') + '</span></li>';
      }).join('');
      host.appendChild(fb);
      lab.forEach(function (it) {
        var li = fb.querySelector('li[data-sid="' + it.s.id + '"]');
        if (li) { it.liVal = li.querySelector('strong'); it.liVar = li.querySelector('.var-p'); it.liTxt = it.finTxt ? 'dato ' + it.finTxt : null; }
      });
      var liFecha = fb.querySelector('.fin-fecha');
    }

    // interacción
    var guia = g.append('line').attr('class', 'guia').attr('y1', 0).attr('y2', ih).style('display', 'none');
    var foco = g.append('circle').attr('r', 5).attr('fill', 'none').attr('stroke-width', 2).style('display', 'none');
    var tip = document.createElement('div');
    tip.className = 'tt'; tip.hidden = true;
    host.appendChild(tip);
    var st = charts[hostId] = charts[hostId] || {};
    st.pinned = false;

    // punto de petróleo en t: el día más cercano si la serie es diaria; el mes de t si es mensual (tooltip y etiquetas usan este)
    function oilEn(s, t) {
      var pts = s.segs[0].pts;
      if (!s.diario) return ptLE(pts, t);
      var i = d3.bisector(function (q) { return q.d; }).left(pts, t), a1 = pts[Math.max(0, i - 1)], a2 = pts[Math.min(pts.length - 1, i)];
      return a2 && a1 && Math.abs(a2.d - t) < Math.abs(a1.d - t) ? a2 : a1;
    }
    /* Línea más cercana al cursor (precio o petróleo) en la fecha t. Devuelve {s, p, y} o null. */
    function cercana(t, py) {
      var best = null;
      all.forEach(function (s) {
        if (activas.indexOf(s) < 0) return;
        var p = null;
        if (s.kind === 'oil') {
          p = oilEn(s, t);
        } else {
          p = pointAt(s, t);
          if (!p) s.segs.forEach(function (sg) {   // filas aisladas: se "pegan" si el cursor está a pocos px
            if (sg.pts.length === 1 && +sg.end === +sg.pts[0].d && Math.abs(x(sg.pts[0].d) - x(t)) <= 8) p = sg.pts[0];
          });
        }
        if (!p || !isFinite(tr(s, p.v))) return;
        var yy = yOf(s, p.v), dd = Math.abs(yy - py);
        if (!best || dd < best.dd) best = { s: s, p: p, y: yy, dd: dd };
      });
      return best;
    }
    function fechaPetroleo(s, p) {
      return s.diario ? fmtIso(p.iso || iso(p.d)) : 'promedio ' + MESES[p.d.getUTCMonth()] + ' ' + p.d.getUTCFullYear();
    }
    // Tooltip compacto: una línea con producto y precio; otra, chica, con la fecha del cursor y la vigencia
    function htmlCompacto(c, t, conLink) {
      var s = c.s, h = '<div class="tt-l1"><span class="tt-dot" style="background:' + s.color + '"></span><span>';
      if (s.kind === 'oil') {   // petróleo: una sola línea ("Brent · US$ 1,79/gal · 21/11/2024")
        h += esc(s.short) + ' · <strong>US$ ' + dec(c.p.v, 2) + (s.porLitro ? '/L' : '/gal') + '</strong> · <span class="tt-f">' + esc(fechaPetroleo(s, c.p)) + '</span></span></div>';
      } else {
        var r = c.p.row;
        var vtxt = vistaUsd ? 'US$ ' + dec(c.p.v, 2) + '/L' : (vistaReal ? 'G. ' + miles(c.p.v) : gs(r.precio));
        h += esc(s.name) + ' · <strong>' + vtxt + (o.unidadTxt ? ' ' + esc(o.unidadTxt(s)) : '') + '</strong>'
          + (vistaReal ? ' <span class="tt-f">(Gs de ' + esc(mesTexto(IPC.base)) + ')</span>' : '') + '</span></div>'
          + '<div class="tt-l2">' + fmtD(t) + ' · vigente desde ' + fmtIso(r.fecha)
          + (r.firme === false ? ' · <span class="nofirme">por confirmar</span>' : '') + '</div>';
      }
      if (conLink) h += '<button type="button" class="tt-ver">Ver detalle</button>';
      return h;
    }
    // Panel de detalle (click, Enter o "Ver detalle"): un solo panel abierto, cerrable con ✕ o Esc
    function htmlDetalle(c, t) {
      var s = c.s, h = '<button type="button" class="x" aria-label="Cerrar detalle">&times;</button>';
      if (s.kind === 'oil') {
        var mp = seriesOil(s.key, false, s.porLitro).segs[0].pts, mm = ptLE(mp, c.p.d);
        h += '<h3><span class="tt-dot" style="background:' + s.color + '"></span>' + esc(s.name) + '</h3>'
          + '<div><strong>US$ ' + dec(c.p.v, 2) + (s.porLitro ? '/L' : '/gal') + '</strong> <span class="f">(' + esc(fechaPetroleo(s, c.p)) + ')</span></div>'
          + (mm && s.diario ? '<div><span class="f">Promedio de ' + MESES[mm.d.getUTCMonth()] + ' ' + mm.d.getUTCFullYear() + ':</span> US$ ' + dec(mm.v, 2) + (s.porLitro ? '/L' : '/gal') + '</div>' : '')
          + '<div><span class="f">Fuente:</span> <a href="https://www.eia.gov/" target="_blank" rel="noopener noreferrer">U.S. Energy Information Administration (EIA)</a></div>';
        return h;
      }
      var r = c.p.row, rows = s.rows, k = rows.indexOf(r), sig = k >= 0 ? rows[k + 1] : null;
      var hg = (s.gaps || []).filter(function (q) { return q.aIso >= r.fecha && (!sig || q.aIso < sig.fecha); })[0];
      var hasta = hg ? 'sin datos desde ' + fmtIso(hg.aIso) : (sig ? fmtIso(sig.fecha) : 'hoy (sigue vigente)');
      h += '<h3><span class="tt-dot" style="background:' + s.color + '"></span>' + esc(s.name) + '</h3>'
        + '<div><strong>' + gs(r.precio) + (o.unidadTxt ? ' ' + esc(o.unidadTxt(s)) : ' por litro') + '</strong></div>'
        + (r.usd != null ? '<div><span class="f">En dólares:</span> US$ ' + dec(r.usd, 2) + ' por ' + (PRODS[s.id].meta.unidad === 'kg' ? 'kg' : 'litro') + ' <span class="f">(BCP: G. '
            + dec(r.tc, 2) + ' por US$ al ' + fmtIso(r.tc_fecha) + ')</span></div>' : '')
        + (vistaReal ? '<div><span class="f">En Gs de ' + esc(mesTexto(IPC.base)) + ':</span> G. ' + miles(c.p.v) + ' <span class="f">(IPC del BCP)</span></div>' : '')
        + '<div><span class="f">Vigente:</span> desde ' + fmtIso(r.fecha) + ' hasta ' + hasta + '</div>'
        + '<div><span class="f">Tipo de precio:</span> ' + esc(TIPO_TXT[r.tipo_precio] || r.tipo_precio) + '</div>'
        + '<div><span class="f">Estado:</span> ' + esc(ESTADO_TXT[r.estado] || r.estado) + ' · <span class="f">fecha</span> '
        + esc(FECHA_ESTADO_TXT[r.fecha_estado] || r.fecha_estado) + (r.firme === false ? ' · <span class="nofirme">por confirmar</span>' : '') + '</div>';
      var us = (r.urls || []).filter(urlOk);
      if (r.fuente || us.length) {
        h += '<div><span class="f">Fuente:</span> ' + (us.length
          ? us.map(function (u, i) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(i ? 'enlace ' + (i + 1) : (r.fuente || 'enlace')) + '</a>'; }).join(' · ')
          : esc(r.fuente)) + '</div>';
      }
      if (r.nota) h += '<div class="f">' + esc(r.nota) + '</div>';
      if (showOil && OIL[o.oil.key]) {
        var mm2 = ptLE(seriesOil(o.oil.key, false, o.oil.porLitro).segs[0].pts, t);
        if (mm2) h += '<div class="sep"><span class="f">' + esc(o.oil.name) + ', promedio de ' + MESES[mm2.d.getUTCMonth()] + ' ' + mm2.d.getUTCFullYear()
          + ':</span> US$ ' + dec(mm2.v, 2) + (o.oil.porLitro ? '/L' : '/gal') + '</div>';
      }
      return h;
    }

    // Etiquetas finales dinámicas: valor de cada serie en la fecha del cursor (con la fecha arriba de la columna)
    function etiquetasEn(t) {
      lab.forEach(function (it) {
        var s = it.s, p = s.kind === 'oil' ? oilEn(s, t) : pointAt(s, t);
        var txt = p && isFinite(tr(s, p.v)) ? valTxt(s, tr(s, p.v)) : '—';
        if (it.valT) { it.valT.text(txt); it.sepT.text(''); it.varT.text(''); it.notaT.text(''); }
        if (it.liVal) { it.liVal.textContent = txt; it.liVar.textContent = ''; }
      });
      if (fechaCol) {
        fechaCol.style('display', null).text(fmtD(t));
        g.selectAll('.lbl-con').style('display', 'none');
        lab.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (it, i) {
          if (it.grp) it.grp.attr('transform', 'translate(' + lx + ',' + (band + 8 + i * (fs + 7)) + ')');   // durante el hover no hay segunda línea
        });
      }
      if (liFecha) { liFecha.hidden = false; liFecha.textContent = 'Valores al ' + fmtD(t); }
    }
    function etiquetasFin() {
      lab.forEach(function (it) {
        var txt = txtFin(it);
        if (it.valT) {
          it.valT.text(txt); it.sepT.text(it.varia ? ' · ' : ''); it.varT.text(it.varia ? it.varia.txt : '');
          it.notaT.text(it.varia && it.varia.nota ? it.varia.nota : '');
        }
        if (it.liVal) { it.liVal.textContent = it.liTxt || txt; it.liVar.textContent = it.varia ? it.varia.txt + (it.varia.nota ? ' (' + it.varia.nota + ')' : '') : ''; }
      });
      if (fechaCol) {
        fechaCol.style('display', 'none');
        g.selectAll('.lbl-con').style('display', null);
        lab.forEach(function (it) { if (it.grp) it.grp.attr('transform', 'translate(' + lx + ',' + it.y + ')'); });
      }
      if (liFecha) liFecha.hidden = true;
    }

    /* Ubica el cuadro pegado al punto, siempre dentro del área de datos [0, iw] (así nunca tapa las etiquetas
       finales, que están a la derecha de iw, ni sale del gráfico): a la derecha del punto, o a la izquierda si no entra;
       arriba del punto, o abajo si no entra. */
    function ubicar(px, py) {
      // se mide en (0,0) y con el ancho y alto máximos del área de datos: así la medida no depende de la posición previa
      tip.style.left = '0px'; tip.style.top = '0px';
      tip.style.maxWidth = Math.max(120, iw - 4) + 'px'; tip.style.maxHeight = Math.max(80, ih) + 'px';
      var tw = tip.offsetWidth, th = tip.offsetHeight, gapP = 12;
      var minL = m.left + 2, maxR = m.left + iw - 2, minT = m.top, maxB = m.top + ih;
      var left = m.left + px + gapP;
      if (left + tw > maxR) left = m.left + px - gapP - tw;
      var alLado = left >= minL;   // entra a un costado del punto: no lo tapa aunque se corra en vertical
      if (!alLado) left = Math.max(minL, Math.min(maxR - tw, m.left + px - tw / 2));
      var top = m.top + py - th - gapP;                    // arriba del punto
      if (top < minT) top = m.top + py + gapP;             // o abajo
      if (top + th > maxB) {                               // no entra ni arriba ni abajo
        top = alLado ? Math.max(minT, Math.min(maxB - th, m.top + py - th / 2)) : Math.max(minT, maxB - th);
      }
      tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(Math.max(minT, top)) + 'px';
    }
    var actual = null;   // {c, t, px} del último punto mostrado
    var porTeclado = false;   // el foco pasa al ✕ solo si el panel se abrió con teclado
    function mostrar(px, py, modo) {   // modo: 'compacto' | 'fijo' (compacto fijo con "Ver detalle") | 'detalle'
      var t = x.invert(px), c = cercana(t, py);
      guia.style('display', null).attr('x1', px).attr('x2', px);
      etiquetasEn(t);
      if (!c) { tip.hidden = true; foco.style('display', 'none'); actual = null; return; }
      actual = { c: c, t: t, px: px };
      tip.className = 'tt' + (modo === 'detalle' ? ' tt-det fijo' : ' tt-c' + (modo === 'fijo' ? ' fijo' : ''));
      if (modo === 'detalle') { tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-label', 'Detalle de ' + c.s.name); }
      else { tip.removeAttribute('role'); tip.removeAttribute('aria-label'); }
      tip.innerHTML = modo === 'detalle' ? htmlDetalle(c, t) : htmlCompacto(c, t, modo === 'fijo');
      tip.hidden = false;
      // el foco va sobre la línea, en la fecha del cursor
      foco.style('display', null).attr('cx', px).attr('cy', c.y).style('stroke', c.s.color);
      ubicar(px, c.y);
      var bx = tip.querySelector('.x'); if (bx) { bx.addEventListener('click', function (ev) { ev.stopPropagation(); ocultar(true); }); }
      var bv = tip.querySelector('.tt-ver');
      if (bv) bv.addEventListener('click', function (ev) { ev.stopPropagation(); fijar(px, py, 'detalle'); });
      if (modo === 'detalle' && bx && porTeclado) bx.focus({ preventScroll: true });
      porTeclado = false;
    }
    function fijar(px, py, modo) {
      Object.keys(charts).forEach(function (k) { if (k !== hostId && charts[k].esc) charts[k].esc(); });   // un solo panel
      st.pinned = true; mostrar(px, py, modo);
    }
    function ocultar(force) {
      if (st.pinned && !force) return;
      if (tip.contains(document.activeElement)) { try { svg.node().focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }
      st.pinned = false; tip.hidden = true; actual = null;
      guia.style('display', 'none'); foco.style('display', 'none');
      etiquetasFin();
    }
    var ov = g.append('rect').attr('class', 'ov').attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('cursor', 'crosshair');
    st.geom = { left: m.left, iw: iw, xmin: xmin, xmax: xmax };   // para arrastre y zoom (wireZoom)
    function loc(ev) { var r = ov.node().getBoundingClientRect(); return [Math.max(0, Math.min(iw, ev.clientX - r.left)), Math.max(0, Math.min(ih, ev.clientY - r.top))]; }
    var ultimoTipo = 'mouse';
    ov.on('pointerdown', function (ev) { ultimoTipo = ev.pointerType || 'mouse'; });
    ov.on('pointermove', function (ev) {
      if (st.pinned || ev.pointerType === 'touch') return;
      var p = loc(ev); mostrar(p[0], p[1], 'compacto');
    });
    ov.on('pointerleave', function (ev) { if (ev.pointerType !== 'touch') ocultar(false); });
    ov.on('click', function (ev) {
      if (Date.now() - ARRASTRE.fin < 250) return;   // fue un arrastre, no un click
      var p = loc(ev);
      // mouse: panel de detalle; táctil: tooltip compacto fijo con "Ver detalle"
      fijar(p[0], p[1], ultimoTipo === 'touch' ? 'fijo' : 'detalle');
    });
    // teclado: el gráfico es enfocable; ←/→ recorren las fechas, ↑/↓ cambian de línea, Enter abre el detalle, Esc cierra
    svg.attr('tabindex', 0).attr('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Escape')
      .attr('aria-label', (o.aria || 'Gráfico de precios') + '. Con teclado: flechas izquierda y derecha recorren las fechas, arriba y abajo cambian de línea, Enter abre el detalle.');
    var kb = { px: iw, idx: 0 };
    function kbMostrar(modo) {
      var t = x.invert(kb.px), cands = all.filter(function (s) { return activas.indexOf(s) >= 0; });
      if (!cands.length) return;
      kb.idx = (kb.idx + cands.length) % cands.length;
      var s = cands[kb.idx], p = s.kind === 'oil' ? ptLE(s.segs[0].pts, t) : pointAt(s, t);
      var py = p ? yOf(s, p.v) : ih / 2;
      if (modo === 'detalle') fijar(kb.px, py, 'detalle'); else { st.pinned = false; mostrar(kb.px, py, 'compacto'); }
    }
    svg.on('keydown', function (ev) {
      var k = ev.key, paso = Math.max(1, iw / 60);
      if (k === 'ArrowLeft' || k === 'ArrowRight') { kb.px = Math.max(0, Math.min(iw, kb.px + (k === 'ArrowLeft' ? -paso : paso))); kbMostrar('compacto'); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { kb.idx += k === 'ArrowUp' ? -1 : 1; kbMostrar('compacto'); }
      else if (k === 'Enter' || k === ' ') { porTeclado = true; kbMostrar('detalle'); }
      else return;
      ev.preventDefault();
    });
    svg.on('focus', function () {
      var tecl = true; try { tecl = svg.node().matches(':focus-visible'); } catch (e) { /* navegador viejo */ }
      if (!st.pinned && tecl) kbMostrar('compacto');   // con el mouse no: el click ya ubica el cuadro
    });
    svg.on('blur', function () { setTimeout(function () { if (!st.pinned && !host.contains(document.activeElement)) ocultar(false); }, 0); });
    // táctil: tocar afuera del gráfico y del cuadro lo cierra
    if (!st.tapAfuera) {
      st.tapAfuera = true;
      document.addEventListener('pointerdown', function (ev) {
        var cs = charts[hostId];
        if (!cs || !cs.pinned || !cs.esc) return;
        var tt = cs.tipEl;
        if (tt && tt.contains(ev.target)) return;
        if (ev.target.classList && ev.target.classList.contains('ov')) return;   // tocar el gráfico mueve el cuadro
        cs.esc();
      });
    }
    st.esc = function () { ocultar(true); };
    st.tipEl = tip;

    // leyenda
    var lg = document.getElementById(o.leyendaId);
    if (lg) lg.innerHTML = leyendaHtml({
      nofirme: nNoFirme > 0,
      hueco: nGapMarks > 0, hito: hitosV.length > 0, banda: hayBanda, tri: hayTri, tramo: tramoVis, pres: presVis
    });

    // avisos y datos de la base
    if (o.onInfo) o.onInfo({ base: base, activas: activas.length });
  }

  // Leyenda: solo clave de símbolos (productos y petróleo ya están en chips y etiquetas finales)
  function leyendaHtml(f) {
    var h = '';
    if (f.nofirme) h += '<span class="it"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>Punto no firme (precio no verificado o fecha por confirmar)</span>';
    if (f.hueco) h += '<span class="it"><svg width="14" height="14" aria-hidden="true"><path d="M7,3 L11,7 L7,11 L3,7z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>Borde de un hueco sin datos</span>';
    if (f.hito) h += '<span class="it"><svg width="22" height="10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="currentColor" style="color:var(--hito)" stroke-width="1.5" stroke-dasharray="6 4"/></svg>Hito</span>';
    if (f.banda || f.tri) h += '<span class="it"><svg width="34" height="14" aria-hidden="true"><defs><pattern id="lgp" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" style="color:var(--promo)" stroke-width="2"/></pattern></defs><rect x="0" y="0" width="18" height="12" fill="url(#lgp)" stroke="currentColor" style="color:var(--promo)"/><path d="M26,12 l5,-9 l5,9z" fill="currentColor" style="color:var(--promo)" transform="translate(-4,0)"/></svg>Promoción o baja temporal (' + (f.banda && f.tri ? 'banda con fecha de fin; ▲ si no la tiene' : (f.banda ? 'banda con trama' : '▲ sobre el eje')) + ')</span>';
    if (f.tramo) h += '<span class="it"><svg width="18" height="14" aria-hidden="true"><defs><pattern id="lgm" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" style="color:var(--muted)" stroke-width="1"/></pattern></defs><rect width="18" height="12" fill="url(#lgm)" stroke="currentColor" style="color:var(--faint)" stroke-width="0.5"/></svg>Precio máximo/sugerido (trama)</span>';
    if (f.pres.length) h += '<span class="it"><svg width="18" height="12" aria-hidden="true"><rect width="9" height="12" style="fill:var(--shade-a)"/><rect x="9" width="9" height="12" style="fill:var(--shade-b)"/></svg>Sombreado: período presidencial (' + f.pres.map(function (p) { return esc(PRES_CORTO[p.nombre] || p.nombre); }).join(', ') + ')</span>';
    return h;
  }

  /* ---------- paneles ---------- */
  function liquidos() { return (D.productos || []).filter(function (p) { return p.tipo !== 'glp'; }); }
  function glps() { return (D.productos || []).filter(function (p) { return p.tipo === 'glp'; }); }

  // Opciones de cada gráfico: las usa la pantalla y también la exportación a PNG
  function optsLiq() {
    var sel = liquidos().filter(function (p) { return state.sel.has(p.id); })
      .map(function (p) { return seriesPrice(p.id, state.vista); }).filter(Boolean);
    var oil = state.oil === 'none' ? null : seriesOil(state.oil, Rango.petroleoDiario(state.desde, state.hasta), state.vista === 'usd');
    return {
      series: sel, oil: oil, view: state.vista, desde: state.desde, hasta: state.hasta, leyendaId: 'leyenda-liq',
      vacio: 'Elegí al menos un producto para ver el gráfico.',
      aria: 'Precios de combustibles de Petropar y petróleo internacional, serie histórica'
    };
  }
  function optsGlp() {
    return {
      series: glps().map(function (p) { return seriesPrice(p.id); }).filter(Boolean),
      oil: null, view: 'dual', leyendaId: 'leyenda-glp', altura: undefined,
      xDesdeDatos: true, sinPromos: true,
      vacio: 'Sin datos todavía. El GLP (Ñande Gas) entra con la primera captura del scraper.',
      ejeL: 'Gs por kg / por litro',
      unidadTxt: function (s) { return PRODS[s.id].meta.unidad === 'kg' ? 'por kg' : 'por litro'; },
      aria: 'Precios del GLP Ñande Gas'
    };
  }
  // Nota chica bajo el gráfico (debajo del eje derecho): doble eje o base del índice
  function notaVista(base) {
    var msg = '';
    if (state.oil !== 'none' && !seriesOil(state.oil)) msg = 'No hay datos de ' + OIL_NOMBRE[state.oil] + ' en data.json. ';
    if (state.vista === 'index') {
      msg += base ? 'Índice base 100: en ' + fmtD(base) + ' (primera fecha del período con todas las series visibles) cada serie vale 100.'
        : 'Índice base 100: no hay series con datos en este período.';
    } else if (state.vista === 'usd') {
      msg += 'Cada precio convertido con el tipo de cambio de referencia del BCP en su fecha de vigencia.'
        + (state.oil !== 'none' ? ' El petróleo va en el mismo eje, en US$ por litro.' : '');
    } else if (state.vista === 'real') {
      msg += 'Guaraníes constantes de ' + mesTexto(IPC.base) + ' (IPC del BCP).'
        + (state.oil !== 'none' ? ' Petróleo en el eje derecho, en US$ por galón, con escala independiente.' : '');
    } else if (state.oil !== 'none' && seriesOil(state.oil)) {
      msg += 'Eje derecho en US$ por galón, con escala independiente: no compares alturas entre combustibles y petróleo.';
    }
    return msg;
  }
  function renderLiq() {
    var o = optsLiq(), av = el('#aviso-vista');
    av.textContent = notaVista(null);
    o.onInfo = function (i) { av.textContent = notaVista(i.base); };
    if (OG) o.altura = 520;
    drawChart('chart-liq', o);
    navDibujar();
  }
  function renderGlp() {
    var o = optsGlp();
    drawChart('chart-glp', o);
    if (!o.series.length) { var lg = el('#leyenda-glp'); if (lg) lg.innerHTML = ''; }
  }
  function render() { if (!D) return; if (state.tab === 'liq') renderLiq(); else renderGlp(); }


  /* ---------- Sección 1: Precios hoy (todo viene calculado en data.json; acá solo se renderiza) ---------- */
  var HOY = null;   // YYYY-MM-DD en America/Asuncion
  function hoyAsuncion() {
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }); } catch (e) { return iso(new Date()); }
  }
  function fmtAsu(isoTs) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(isoTs)).forEach(function (q) { p[q.type] = q.value; });
      if (p.hour === '24') p.hour = '00';
      return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
    } catch (e) { return ''; }
  }
  // DD/MM; con año de 2 dígitos (DD/MM/AA) si es de otro año que el actual
  function fechaCorta(d) {
    var p = String(d).split('-');
    return p[2] + '/' + p[1] + (p[0] !== HOY.slice(0, 4) ? '/' + p[0].slice(2) : '');
  }
  var UNI = { litro: 'L', kg: 'kg' };
  /* Lista compacta de "Precios hoy": una fila por producto, todo en un solo bloque. Todo viene de data.tarjetas
     (precio, cambio.flecha, vigente_desde, etc.); acá solo se formatea. GLP: una fila con kg y litro.
     Orden: el de data.tarjetas. Dos bloques .col-hoy (mitad de arriba y de abajo): en desktop van lado a lado, con alturas
     de fila independientes; en celular uno debajo del otro, así el orden de lectura es el de data.tarjetas. */
  function renderLista() {
    var box = el('#lista-hoy'); if (!box) return;
    HOY = hoyAsuncion();
    var ts = D.tarjetas || [];
    if (!ts.length) { box.innerHTML = '<p class="hoy-nd">No disponible: este sitio todavía no trae los precios de hoy.</p>'; return; }
    var T = {}; ts.forEach(function (t) { T[t.id] = t; });
    var nom = {}; (D.productos || []).forEach(function (p) { nom[p.id] = p.nombre; });
    var filas = [], visto = {};
    ts.forEach(function (t) {
      if (visto[t.id]) return;
      if (t.id === 'glp_kg' || t.id === 'glp_litro') {
        visto.glp_kg = visto.glp_litro = true;
        var its = [T.glp_kg, T.glp_litro].filter(Boolean);
        filas.push({ id: 'glp', color: cvar('glp_kg'), nombre: 'Ñande Gas', items: its });
      } else {
        visto[t.id] = true;
        filas.push({ id: t.id, color: cvar(t.id), nombre: nom[t.id] || t.id, items: [t] });
      }
    });
    var html = filas.map(function (f) {
      var its = f.items, main = its[0];
      // precio principal en una línea; en GLP el precio por litro va debajo, como texto secundario
      var pr = function (x) {
        return x.precio == null ? 'sin datos' : 'G. ' + miles(x.precio) + '<small> /' + esc(UNI[x.unidad] || x.unidad) + '</small>';
      };
      var precios = pr(main) + its.slice(1).map(function (x) { return '<span class="f-alt">' + pr(x) + '</span>'; }).join('');
      // monto solo si cambio.flecha es true en todas las unidades (data.json ya excluye por confirmar, anterior viejo y huecos)
      var conFlecha = its.every(function (x) { return x.cambio && x.cambio.flecha; });
      var cam = '<span class="f-cambio">';
      if (conFlecha) {
        var c = main.cambio, sube = c.abs > 0;
        cam += '<span class="pill ' + (sube ? 'sube' : 'baja') + '"><span aria-hidden="true">' + (sube ? '▲' : '▼') + ' </span>'
          + '<span class="sr-only">' + (sube ? 'subió ' : 'bajó ') + '</span>' + miles(Math.abs(c.abs)) + '</span>';
      }
      cam += '</span>';
      var conf = its.every(function (x) { return x.fecha_vigencia_confirmada && x.vigente_desde; });
      var meta = '';
      if (conf) meta += (main.vigente_desde > HOY ? 'rige desde\u00a0' : 'desde\u00a0') + fechaCorta(main.vigente_desde);
      if (its.some(function (x) { return x.por_confirmar; })) meta += (meta ? '<br>' : '') + '<span class="f-pc">por confirmar</span>';
      return '<button type="button" class="fila" data-id="' + esc(f.id) + '" style="--tc:' + f.color + '">'
        + '<span class="f-dot" aria-hidden="true"></span>'
        + '<span class="f-nom">' + esc(f.nombre) + '</span>'
        + '<span class="f-precio">' + precios + '</span>'
        + cam + '<span class="f-meta">' + meta + '</span>'
        + '<span class="sr-only"> — ver en el gráfico histórico</span></button>';
    });
    // dos columnas independientes (cada una con sus propias alturas de fila): la izquierda lleva la mitad de arriba
    var mitad = Math.ceil(html.length / 2);
    box.innerHTML = '<div class="col-hoy">' + html.slice(0, mitad).join('') + '</div><div class="col-hoy">' + html.slice(mitad).join('') + '</div>';
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.fila') : null;
      if (b) irAlGrafico(b.getAttribute('data-id'));
    });
  }
  function irAlGrafico(id) {
    if (id === 'glp') {
      if (state.tab !== 'glp') el('#tab-glp').click(); else render();
    } else {
      if (state.tab !== 'liq') el('#tab-liq').click();
      state.sel = new Set([id]);
      syncChips();
      render();
    }
    var sec = document.getElementById('historico'), calmo = false;
    try { calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* sin matchMedia */ }
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
    var hh = document.getElementById('h-hist');   // el foco pasa al título del Histórico (tabindex=-1)
    if (hh && hh.focus) { try { hh.focus({ preventScroll: true }); } catch (e) { hh.focus(); } }
  }
  // Hora de la última verificación: API pública de GitHub (timeout corto, nunca bloquea); si falla, data.ultima_captura
  function verificacion() {
    var v = el('#verif'); if (!v || OG) return;
    var cap = D.ultima_captura ? fmtAsu(D.ultima_captura) : '';
    v.textContent = cap ? 'Último cambio capturado ' + cap : '';
    try {
      var ctl = window.AbortController ? new AbortController() : null;
      var to = setTimeout(function () { if (ctl) ctl.abort(); }, 4000);
      fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/' + GH_WORKFLOW + '/runs?status=success&per_page=1',
        { headers: { Accept: 'application/vnd.github+json' }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          clearTimeout(to);
          var t = j && j.workflow_runs && j.workflow_runs[0] && j.workflow_runs[0].updated_at;
          var f = t ? fmtAsu(t) : '';
          if (f) v.textContent = 'Verificado ' + f;
        })
        .catch(function () { /* queda el texto de respaldo */ });
    } catch (e) { /* queda el texto de respaldo */ }
  }

  /* ---------- tabla y eventos ---------- */
  /* Tabla con TODO el histórico de data.precios (≈480 filas). Se arma recién al abrir el desplegable.
     Filtros: producto y rango de años. Va dentro de un bloque con scroll vertical propio (nunca scroll horizontal de la página). */
  var TIPO_CORTO = { max_o_sugerido_venta_publico: 'Máx./sugerido', venta_publico: 'Venta al público' };
  var TABLA = { filas: null, armada: false };
  function filasTabla() {
    if (TABLA.filas) return TABLA.filas;
    var nom = {}, uni = {}, ord = {};
    (D.productos || []).forEach(function (p, i) { nom[p.id] = p.nombre; uni[p.id] = p.unidad; ord[p.id] = i; });
    var out = [];
    Object.keys(D.precios || {}).forEach(function (id) {
      (D.precios[id] || []).forEach(function (r) { out.push({ id: id, nombre: nom[id] || id, unidad: uni[id] || '', o: ord[id] || 0, r: r }); });
    });
    out.sort(function (a, b) { return a.r.fecha < b.r.fecha ? 1 : (a.r.fecha > b.r.fecha ? -1 : a.o - b.o); });
    TABLA.filas = out;
    return out;
  }
  function pintarTabla() {
    var fs_ = filasTabla(), pid = el('#tb-prod').value, y0 = +el('#tb-desde').value, y1 = +el('#tb-hasta').value;
    var sel = fs_.filter(function (f) { var y = +f.r.fecha.slice(0, 4); return (pid === 'todos' || f.id === pid) && y >= y0 && y <= y1; });
    el('#tb-cuenta').textContent = sel.length + ' de ' + fs_.length + ' filas';
    el('#tb-cuerpo').innerHTML = sel.map(function (f) {
      var r = f.r, uv = (r.urls || []).filter(urlOk);
      var links = uv.map(function (u, i) {
        return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">enlace' + (uv.length > 1 ? ' ' + (i + 1) : '') + '</a>';
      }).join(' · ');
      return '<tr><td class="num" data-l="Fecha">' + fmtIso(r.fecha) + '</td>'
        + '<td class="prod" data-l="Producto"><span class="sw" style="border-color:' + cvar(f.id) + '"></span> ' + esc(f.nombre) + '</td>'
        + '<td class="num" data-l="Precio">' + gs(r.precio) + '</td>'
        + '<td data-l="Unidad">' + esc(f.unidad) + '</td>'
        + '<td data-l="Tipo de precio">' + esc(TIPO_CORTO[r.tipo_precio] || r.tipo_precio) + '</td>'
        + '<td data-l="Estado">' + esc(ESTADO_TXT[r.estado] || r.estado) + '</td>'
        + '<td data-l="Fecha del estado">' + esc(FECHA_ESTADO_TXT[r.fecha_estado] || r.fecha_estado) + '</td>'
        + '<td data-l="Fuente">' + esc(r.fuente || '') + (links ? ' ' + links : '') + '</td>'
        + '<td data-l="Nota">' + esc(r.nota || '') + '</td></tr>';
    }).join('');
  }
  function armarTabla() {
    if (TABLA.armada) return;
    TABLA.armada = true;
    var fs_ = filasTabla(), yrs = fs_.map(function (f) { return +f.r.fecha.slice(0, 4); });
    var ymin = Math.min.apply(null, yrs), ymax = Math.max.apply(null, yrs), op = '', oy0 = '', oy1 = '', y;
    (D.productos || []).forEach(function (p) { op += '<option value="' + esc(p.id) + '">' + esc(p.nombre) + '</option>'; });
    for (y = ymin; y <= ymax; y++) { oy0 += '<option value="' + y + '">' + y + '</option>'; oy1 += '<option value="' + y + '">' + y + '</option>'; }
    el('#tabla-datos').innerHTML = '<div class="tb-filtros">'
      + '<label>Producto <select id="tb-prod"><option value="todos">Todos</option>' + op + '</select></label>'
      + '<label>Desde <select id="tb-desde">' + oy0 + '</select></label>'
      + '<label>Hasta <select id="tb-hasta">' + oy1 + '</select></label>'
      + '<span id="tb-cuenta" class="tb-cuenta" aria-live="polite"></span></div>'
      + '<div class="tabla-wrap" tabindex="0" role="region" aria-label="Histórico completo de precios"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Precio</th><th>Unidad</th>'
      + '<th>Tipo de precio</th><th>Estado</th><th>Fecha del estado</th><th>Fuente</th><th>Nota</th></tr></thead><tbody id="tb-cuerpo"></tbody></table></div>';
    el('#tb-desde').value = String(ymin); el('#tb-hasta').value = String(ymax);
    ['#tb-prod', '#tb-desde', '#tb-hasta'].forEach(function (q) { el(q).addEventListener('change', pintarTabla); });
    pintarTabla();
  }
  function renderEventos() {
    var evs = D.eventos || [];
    if (!evs.length) { el('#lista-eventos').innerHTML = '<p>No hay eventos cargados.</p>'; return; }
    el('#lista-eventos').innerHTML = '<ul class="ev">' + evs.map(function (e) {
      return '<li><span class="tag">' + (e.tipo === 'promo' ? 'Promoción' : 'Hito') + '</span> ' + esc(e.etiqueta) + '<br>'
        + fmtIso(e.fecha) + (e.fecha_fin ? ' al ' + fmtIso(e.fecha_fin) : '')
        + (e.fuente ? ' · ' + esc(e.fuente) : '')
        + (urlOk(e.url) ? ' · <a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">enlace</a>' : '')
        + (e.nota ? '<br><small>' + esc(e.nota) + '</small>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  /* ---------- controles ---------- */
  // Chips de producto: botones de alternancia (aria-pressed); activo = relleno suave del color + tilde
  function buildChips() {
    var box = document.createElement('div'); box.className = 'chips-box';
    liquidos().forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chipb'; b.setAttribute('data-id', p.id); b.setAttribute('aria-pressed', 'true');
      b.style.setProperty('--tc', cvar(p.id));
      b.innerHTML = '<span class="chip-ck" aria-hidden="true">\u2713</span><span class="sw" style="border-color:' + cvar(p.id) + '"></span>' + esc(p.nombre);
      box.appendChild(b);
    });
    el('#ctl-prod').appendChild(box);
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.chipb') : null;
      if (!b) return;
      var id = b.getAttribute('data-id');
      if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
      syncChips(); render();
    });
  }
  function syncChips() {
    document.querySelectorAll('#ctl-prod .chipb').forEach(function (b) {
      b.setAttribute('aria-pressed', state.sel.has(b.getAttribute('data-id')) ? 'true' : 'false');
    });
  }
  function wireControls() {
    document.querySelectorAll('input[name=rango]').forEach(function (i) {
      i.addEventListener('change', function () { if (i.checked) aplicarPreset(i.value); });
    });
    [['vista', 'vista'], ['oil', 'oil']].forEach(function (c) {
      document.querySelectorAll('input[name=' + c[0] + ']').forEach(function (i) {
        i.addEventListener('change', function () { if (i.checked) { state[c[1]] = i.value; if (c[0] === 'oil') textoOil(); render(); } });
      });
    });
    [['liq', 'glp'], ['glp', 'liq']].forEach(function (pair) {
      el('#tab-' + pair[0]).addEventListener('click', function () {
        state.tab = pair[0];
        el('#tab-' + pair[0]).classList.add('on'); el('#tab-' + pair[0]).setAttribute('aria-selected', 'true');
        el('#tab-' + pair[1]).classList.remove('on'); el('#tab-' + pair[1]).setAttribute('aria-selected', 'false');
        el('#panel-' + pair[0]).hidden = false; el('#panel-' + pair[1]).hidden = true;
        render();
      });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') Object.keys(charts).forEach(function (k) { if (charts[k].esc) charts[k].esc(); });
    });
    var raf = 0, lastW = 0;
    var ro = new ResizeObserver(function () {
      var w = el('#panel-liq').hidden ? el('#chart-glp').clientWidth : el('#chart-liq').clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(render);
    });
    ro.observe(document.body);
  }

  // Frescura y pie de fuentes nombran solo la serie internacional activa (nunca una serie fija)
  function textoOil() {
    var u = D.ultimo_dato || {}, k = state.oil, fr = el('#frescura'), pf = el('#fuente-oil');
    fr.textContent = k !== 'none' && u[k] ? 'Petróleo (EIA): ' + OIL_NOMBRE[k] + ' al ' + fmtIso(u[k]) + '.' : '';
    if (pf) pf.textContent = k === 'none' ? 'Brent o diésel ULSD' : OIL_FUENTE[k] + (u[k] ? ', al ' + fmtIso(u[k]) : '');
  }
  /* ---------- navegación temporal (rango visible del histórico) ----------
     Un solo punto de entrada: setRango. Lo usan los botones, el navegador, los campos de fecha, el arrastre y el zoom.
     Redibuja con requestAnimationFrame (un dibujo por cuadro aunque lleguen muchos eventos) y guarda el rango en la URL. */
  var rafRango = 0, urlTimer = 0;
  function setRango(desde, hasta) {
    var r = Rango.limitar(desde, hasta, XMIN_ALL, XMAX);
    state.desde = r.desde; state.hasta = r.hasta;
    state.preset = Rango.presetDe(r.desde, r.hasta, XMIN_ALL, XMAX);
    document.querySelectorAll('input[name=rango]').forEach(function (i) { i.checked = i.value === state.preset; });
    navPosicion();
    clearTimeout(urlTimer); urlTimer = setTimeout(urlGuardar, 300);
    cancelAnimationFrame(rafRango);
    rafRango = requestAnimationFrame(function () { if (state.tab === 'liq') renderLiq(); });
  }
  function aplicarPreset(clave) { var r = Rango.preset(clave, XMIN_ALL, XMAX); setRango(r.desde, r.hasta); }
  // ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (sin parámetros = Todo); conserva los demás parámetros
  function urlGuardar() {
    try {
      var u = new URL(location.href);
      u.searchParams.delete('rango');
      if (state.preset === 'todo') { u.searchParams.delete('desde'); u.searchParams.delete('hasta'); }
      else { u.searchParams.set('desde', iso(state.desde)); u.searchParams.set('hasta', iso(state.hasta)); }
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* sin History API: el rango vale solo en esta visita */ }
  }
  function rangoInicial(qp) {
    var okIso = /^\d{4}-\d{2}-\d{2}$/, d0 = qp.get('desde'), d1 = qp.get('hasta');
    if (d0 && d1 && okIso.test(d0) && okIso.test(d1) && parse(d0) && parse(d1)) return Rango.limitar(d0, d1, XMIN_ALL, XMAX);
    var viejo = { all: 'todo', '10': '10a', '5': '5a' }[qp.get('rango')];   // links viejos (?rango=)
    if (viejo) return Rango.preset(viejo, XMIN_ALL, XMAX);
    if (qp.get('rango') === '2') return Rango.limitar(new Date(+XMAX - 730 * 864e5), XMAX, XMIN_ALL, XMAX);
    return Rango.preset('todo', XMIN_ALL, XMAX);
  }

  /* Navegador: minigráfico de Diésel Porã (o del primer producto activo) en todo el período y una ventana arrastrable.
     El minigráfico se redibuja al cambiar el ancho o los productos; la ventana se mueve con navPosicion. */
  var NAV = { x: null, w: 0, id: null };
  function navSerie() {
    var ids = liquidos().map(function (p) { return p.id; }).filter(function (id) { return state.sel.has(id); });
    return state.sel.has('diesel_pora') ? 'diesel_pora' : (ids[0] || 'diesel_pora');
  }
  function navDibujar() {
    var box = el('#nav-mini'); if (!box) return;
    var W = box.clientWidth, H = 60, id = navSerie(), s = seriesPrice(id);
    if (W < 50) return;
    if (W !== NAV.w || id !== NAV.id) {
      NAV.w = W; NAV.id = id;
      NAV.x = d3.scaleUtc().domain([XMIN_ALL, XMAX]).range([0, W]);
      var old = box.querySelector('svg'); if (old) old.remove();
      // minigráfico arriba (H - 16 px) y años debajo, fuera del área de la línea
      var svg = d3.select(box).insert('svg', ':first-child').attr('width', W).attr('height', H + 16).attr('aria-hidden', 'true');
      if (s) {
        var lo = d3.min(s.rows, function (r) { return r.precio; }), hi = d3.max(s.rows, function (r) { return r.precio; });
        var y = d3.scaleLinear().domain([lo * 0.95, hi * 1.03]).range([H - 3, 16]);
        s.segs.forEach(function (sg) {
          var pts = sg.pts.concat([{ d: sg.end, v: sg.pts[sg.pts.length - 1].v }]);
          var ar = d3.area().x(function (p) { return NAV.x(p.d); }).y0(H).y1(function (p) { return y(p.v); }).curve(d3.curveStepAfter);
          var ln = d3.line().x(function (p) { return NAV.x(p.d); }).y(function (p) { return y(p.v); }).curve(d3.curveStepAfter);
          svg.append('path').attr('d', ar(pts)).style('fill', s.color).attr('opacity', 0.12);
          svg.append('path').attr('d', ln(pts)).attr('fill', 'none').style('stroke', s.color).attr('stroke-width', 1.5);
        });
        svg.append('text').attr('class', 'nav-rot').attr('x', 6).attr('y', 14).text(s.name);
      }
      d3.utcYear.every(W < 500 ? 4 : 2).range(XMIN_ALL, XMAX).forEach(function (d) {
        svg.append('line').attr('class', 'nav-tick').attr('x1', NAV.x(d)).attr('x2', NAV.x(d)).attr('y1', H).attr('y2', H + 4);
        svg.append('text').attr('class', 'nav-anio').attr('x', NAV.x(d)).attr('y', H + 14).attr('text-anchor', 'middle').text(d.getUTCFullYear());
      });
    }
    navPosicion();
  }
  function navPosicion() {
    if (!NAV.x) return;
    var a = NAV.x(state.desde), b = NAV.x(state.hasta), v = el('#nav-ventana');
    v.style.left = a + 'px'; v.style.width = Math.max(4, b - a) + 'px';
    el('#nav-sombra-a').style.width = a + 'px';
    el('#nav-sombra-b').style.left = b + 'px'; el('#nav-sombra-b').style.width = Math.max(0, NAV.w - b) + 'px';
    v.setAttribute('aria-valuetext', 'Desde ' + fmtD(state.desde) + ' hasta ' + fmtD(state.hasta));
    v.setAttribute('aria-label', 'Período visible: ' + fmtD(state.desde) + ' a ' + fmtD(state.hasta));
    var i0 = el('#nav-desde'), i1 = el('#nav-hasta');
    if (document.activeElement !== i0) i0.value = iso(state.desde);
    if (document.activeElement !== i1) i1.value = iso(state.hasta);
  }
  function wireNav() {
    var box = el('#nav-mini'), v = el('#nav-ventana'), i0 = el('#nav-desde'), i1 = el('#nav-hasta');
    [i0, i1].forEach(function (i) { i.min = iso(XMIN_ALL); i.max = iso(XMAX); });
    function deFecha(i) { return /^\d{4}-\d{2}-\d{2}$/.test(i.value) ? parse(i.value) : null; }
    i0.addEventListener('change', function () { var d = deFecha(i0); if (d) setRango(d, state.hasta); });
    i1.addEventListener('change', function () { var d = deFecha(i1); if (d) setRango(state.desde, d); });
    // arrastre: ventana (mover), bordes (estirar) o fondo (centrar la ventana ahí y seguir moviéndola)
    var drag = null;
    box.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || !NAV.x) return;
      var rect = box.getBoundingClientRect(), px = ev.clientX - rect.left;
      var borde = ev.target.getAttribute && ev.target.getAttribute('data-borde');
      var modo = borde || 'mover';
      if (!borde && !v.contains(ev.target)) {   // click en el fondo: centrar
        var span = state.hasta - state.desde, t = +NAV.x.invert(px);
        setRango(new Date(t - span / 2), new Date(t + span / 2));
      }
      drag = { modo: modo, px: px, desde: +state.desde, hasta: +state.hasta, k: (XMAX - XMIN_ALL) / NAV.w };
      box.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    box.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var px = ev.clientX - box.getBoundingClientRect().left, dt = (px - drag.px) * drag.k;
      if (drag.modo === 'a') setRango(new Date(Math.min(drag.desde + dt, drag.hasta - 30 * 864e5)), new Date(drag.hasta));
      else if (drag.modo === 'b') setRango(new Date(drag.desde), new Date(Math.max(drag.hasta + dt, drag.desde + 30 * 864e5)));
      else setRango(new Date(drag.desde + dt), new Date(drag.hasta + dt));
    });
    function soltar() { drag = null; }
    box.addEventListener('pointerup', soltar);
    box.addEventListener('pointercancel', soltar);
    // teclado: flechas mueven la ventana; Shift+flechas mueven el final (la estiran o la achican); Inicio/Fin van a los extremos
    v.addEventListener('keydown', function (ev) {
      var span = state.hasta - state.desde, paso = Math.max(7 * 864e5, span * 0.1), mes = 30.44 * 864e5;
      var a = +state.desde, b = +state.hasta;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        var sg = ev.key === 'ArrowLeft' ? -1 : 1;
        if (ev.shiftKey) setRango(new Date(a), new Date(b + sg * mes));
        else setRango(new Date(a + sg * paso), new Date(b + sg * paso));
      } else if (ev.key === 'Home') setRango(XMIN_ALL, new Date(+XMIN_ALL + span));
      else if (ev.key === 'End') setRango(new Date(+XMAX - span), XMAX);
      else return;
      ev.preventDefault();
    });
  }

  /* Gráfico principal (solo con mouse): arrastrar desplaza; Ctrl/⌘ + rueda hace zoom alrededor del cursor
     (sin modificador la rueda hace scroll de la página); doble click vuelve a Todo. En pantallas táctiles no hay
     gestos sobre el gráfico (el scroll no se traba): se navega con los botones y el navegador. */
  function wireZoom() {
    var host = el('#chart-liq'), drag = null;
    host.addEventListener('pointerdown', function (ev) {
      var gm = charts['chart-liq'] && charts['chart-liq'].geom;
      if (ev.pointerType !== 'mouse' || ev.button !== 0 || !gm || !ev.target.classList || !ev.target.classList.contains('ov')) return;
      drag = { x: ev.clientX, desde: +state.desde, hasta: +state.hasta, k: (gm.xmax - gm.xmin) / gm.iw, movido: false };
    });
    window.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x;
      if (!drag.movido && Math.abs(dx) < 4) return;
      if (!drag.movido) { drag.movido = true; document.body.classList.add('arrastrando'); if (charts['chart-liq'].esc) charts['chart-liq'].esc(); }
      setRango(new Date(drag.desde - dx * drag.k), new Date(drag.hasta - dx * drag.k));
    });
    window.addEventListener('pointerup', function () {
      if (drag && drag.movido) ARRASTRE.fin = Date.now();
      drag = null; document.body.classList.remove('arrastrando');
    });
    host.addEventListener('wheel', function (ev) {
      var gm = charts['chart-liq'] && charts['chart-liq'].geom;
      if (!(ev.ctrlKey || ev.metaKey) || !gm) return;
      ev.preventDefault();
      var f = Math.max(0, Math.min(1, (ev.clientX - host.getBoundingClientRect().left - gm.left) / gm.iw));
      var span = gm.xmax - gm.xmin, t = +gm.xmin + f * span, nuevo = span * Math.exp(ev.deltaY * 0.0025);
      setRango(new Date(t - f * nuevo), new Date(t + (1 - f) * nuevo));
    }, { passive: false });
    host.addEventListener('dblclick', function (ev) {
      if (ev.target.closest && ev.target.closest('svg')) aplicarPreset('todo');
    });
  }

  function textos() {
    var u = D.ultimo_dato || {};
    textoOil();
    var pe = u.petropar ? 'Precios Petropar al ' + fmtIso(u.petropar) + '. ' : '';
    if (D.generado) el('#generado').textContent = pe + 'Sitio generado el ' + fmtIso(String(D.generado).slice(0, 10)) + '.';
    var hu = (D.productos || []).filter(function (p) { return (p.huecos || []).length; }).map(function (p) {
      return p.nombre + ': ' + p.huecos.map(function (h) {
        return h.hasta ? fmtIso(h.desde) + '\u2013' + fmtIso(h.hasta) : 'desde ' + fmtIso(h.desde) + ' (sin retomar)';
      }).join(', ') + '.';
    });
    el('#nota-huecos').textContent = hu.length ? 'Hoy: ' + hu.join(' ') : 'Hoy no hay huecos conocidos.';
  }

  /* ---------- descargas ---------- */
  function bajar(nombre, blob) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }
  function csvCelda(v) {
    var t = v == null ? '' : String(v);
    // texto que Excel tomaría como fórmula: se antepone un apóstrofo (los números negativos no se tocan)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function csv(cab, filas) {
    // BOM para que Excel abra bien los acentos
    return new Blob(['﻿' + [cab].concat(filas).map(function (f) { return f.map(csvCelda).join(','); }).join('\r\n') + '\r\n'],
      { type: 'text/csv;charset=utf-8' });
  }
  function csvVigentes() {
    var nom = {}; (D.productos || []).forEach(function (p) { nom[p.id] = p.nombre; });
    return csv(['product_id', 'producto', 'unidad', 'precio_gs', 'vigente_desde', 'fecha_vigencia_confirmada', 'estado', 'por_confirmar',
      'precio_anterior_gs', 'fecha_anterior', 'cambio_gs'],
      (D.tarjetas || []).filter(function (t) { return t.precio != null; }).map(function (t) {
        var c = t.cambio || {};
        return [t.id, nom[t.id] || t.id, t.unidad, t.precio, t.vigente_desde, t.fecha_vigencia_confirmada ? 'si' : 'no',
          t.estado, t.por_confirmar ? 'si' : 'no', c.precio_anterior, c.fecha_anterior, c.abs];
      }));
  }
  function csvHistorico() {
    return csv(['fecha_vigencia', 'product_id', 'producto', 'unidad', 'precio_gs', 'tipo_precio', 'estado', 'fecha_estado', 'fuente', 'fuente_url', 'nota'],
      filasTabla().slice().sort(function (a, b) { return a.r.fecha < b.r.fecha ? -1 : (a.r.fecha > b.r.fecha ? 1 : a.o - b.o); }).map(function (f) {
        var r = f.r;
        return [r.fecha, f.id, f.nombre, f.unidad, r.precio, r.tipo_precio, r.estado, r.fecha_estado, r.fuente, (r.urls || []).join(' | '), r.nota];
      }));
  }
  function wireDescargas() {
    var btn = el('#btn-descarga'), lista = el('#menu-descarga-lista');
    function abrir(si) {
      lista.hidden = !si; btn.setAttribute('aria-expanded', si ? 'true' : 'false');
      if (si) { var b0 = lista.querySelector('button'); if (b0) b0.focus(); }
    }
    btn.addEventListener('click', function () { abrir(lista.hidden); });
    lista.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-csv]') : null;
      if (!b) return;
      var dia = (D.ultimo_dato && D.ultimo_dato.petropar) || iso(new Date());
      if (b.getAttribute('data-csv') === 'vigentes') bajar('petropar_precios_vigentes_' + dia + '.csv', csvVigentes());
      else bajar('petropar_precios_historico_' + dia + '.csv', csvHistorico());
      abrir(false); btn.focus();
    });
    document.addEventListener('click', function (ev) {
      if (!lista.hidden && !el('#menu-descarga').contains(ev.target)) abrir(false);
    });
    el('#menu-descarga').addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !lista.hidden) { abrir(false); btn.focus(); }
    });
    el('#btn-png').addEventListener('click', exportarPng);
  }

  /* Exportar el gráfico visible a PNG: SIEMPRE en tema claro (contenedor .tema-claro fuera de pantalla, a 1200 px de ancho),
     con título, fuente y fecha dibujados en el canvas. Los estilos calculados se copian al SVG para que se vea igual fuera de la página. */
  var PROPS_SVG = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linejoin',
    'stroke-linecap', 'opacity', 'font-size', 'font-weight', 'font-style', 'paint-order', 'text-anchor', 'dominant-baseline', 'display', 'visibility'];
  function estilosEnLinea(svg) {
    [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*'))).forEach(function (n) {
      var cs = getComputedStyle(n), st = '';
      PROPS_SVG.forEach(function (k) { var v = cs.getPropertyValue(k); if (v) st += k + ':' + v + ';'; });
      n.setAttribute('style', st + 'font-family:Inter,Helvetica,Arial,sans-serif;');
      n.removeAttribute('class');
    });
  }
  function exportarPng() {
    var btn = el('#btn-png'), W = 1200, PAD = 40;
    btn.disabled = true;
    var caja = document.createElement('div');
    caja.className = 'tema-claro';
    caja.setAttribute('aria-hidden', 'true');
    caja.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + (W - 2 * (PAD - 8)) + 'px;background:#fcfcfb';
    caja.innerHTML = '<div class="chart" id="chart-export"></div>';
    document.body.appendChild(caja);
    var o = state.tab === 'glp' ? optsGlp() : optsLiq();
    o.leyendaId = null; o.altura = 560;
    try { drawChart('chart-export', o); } catch (e) { caja.remove(); btn.disabled = false; throw e; }
    delete charts['chart-export'];
    var svg = caja.querySelector('svg');
    if (!svg) { caja.remove(); btn.disabled = false; return; }
    estilosEnLinea(svg);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var txt = new XMLSerializer().serializeToString(svg);
    var sw = +svg.getAttribute('width'), sh = +svg.getAttribute('height');
    caja.remove();

    var titulo = state.tab === 'glp' ? 'Precio del GLP (Ñande Gas) de Petropar'
      : 'Precios de combustibles de Petropar y precio del petróleo, ' + fmtD(state.desde) + ' – ' + fmtD(state.hasta);
    var subt = state.tab === 'glp' ? 'Guaraníes por kg y por litro, nominal'
      : (o.view === 'usd' ? 'US$ por litro (tipo de cambio de referencia del BCP en la fecha de vigencia)' + (o.oil ? '; ' + o.oil.short + ' en US$ por litro' : '')
        : (o.view === 'real' ? 'Guaraníes constantes de ' + mesTexto(IPC.base) + ' por litro (IPC del BCP)' : 'Guaraníes por litro, nominal')
          + (o.oil ? (o.view === 'index' ? '; índice base 100 con ' + o.oil.short : '; ' + o.oil.short + ' en US$ por galón (eje derecho, escala independiente)') : ''));
    var u = D.ultimo_dato || {};
    var fuente = 'Fuente: Petropar (respuesta AIP N° 90150, prensa y página oficial)' + (o.oil ? '; U.S. Energy Information Administration (EIA), ' + OIL_FUENTE[o.oil.key] : '') + '.';
    var fecha = 'Datos al ' + fmtIso(u.petropar || iso(new Date())) + (o.oil && u[o.oil.key] ? ' (' + o.oil.short + ' al ' + fmtIso(u[o.oil.key]) + ')' : '') + ' · combuspy-tracker.vercel.app';
    var HC = 96, HP = 64, H = HC + sh + HP, k = 2;
    var cv = document.createElement('canvas');
    cv.width = W * k; cv.height = H * k;
    var cx = cv.getContext('2d');
    cx.scale(k, k);
    cx.fillStyle = '#fcfcfb'; cx.fillRect(0, 0, W, H);
    var img = new Image();
    img.onload = function () {
      var ff = 'Inter, Helvetica, Arial, sans-serif';
      cx.fillStyle = '#0b0b0b'; cx.font = '800 26px ' + ff; cx.fillText(titulo, PAD - 8, 44);
      cx.fillStyle = '#52514e'; cx.font = '400 15px ' + ff; cx.fillText(subt, PAD - 8, 72);
      cx.drawImage(img, PAD - 8, HC, sw, sh);
      cx.fillStyle = '#dcdad4'; cx.fillRect(PAD - 8, HC + sh + 12, W - 2 * (PAD - 8), 1);
      cx.fillStyle = '#7a7974'; cx.font = '400 13px ' + ff;
      cx.fillText(fuente, PAD - 8, HC + sh + 34); cx.fillText(fecha, PAD - 8, HC + sh + 52);
      cv.toBlob(function (b) {
        btn.disabled = false;
        if (b) bajar('petropar_' + (state.tab === 'glp' ? 'glp' : 'combustibles_' + iso(state.desde) + '_' + iso(state.hasta)) + '.png', b);
      }, 'image/png');
    };
    img.onerror = function () { btn.disabled = false; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
  }

  /* ---------- arranque ---------- */
  function init(data) {
    prepare(data);
    state.sel = new Set(liquidos().map(function (p) { return p.id; }));
    textos(); buildChips(); renderLista(); verificacion(); renderEventos(); wireControls(); wireDescargas();
    if (OG) {
      var u = D.ultimo_dato || {}, pf = document.createElement('p');
      pf.className = 'og-fuente';
      pf.textContent = 'Gs por litro (nominal) y ' + (OIL_NOMBRE[state.oil] || 'petróleo') + ' en US$ por galón, escalas independientes. Fuente: Petropar; EIA. Datos al '
        + fmtIso(u.petropar || '') + '. combuspy-tracker.vercel.app';
      el('#chart-liq').after(pf);
    }
    var dt = el('#det-tabla');   // la tabla completa se arma solo al abrir (o con ?tabla=1, útil para capturas)
    dt.addEventListener('toggle', function () { if (dt.open) armarTabla(); });
    try { if (new URLSearchParams(location.search).get('tabla') === '1') { dt.open = true; armarTabla(); } } catch (e) { /* sin parámetros */ }
    /* Parámetros de URL (para compartir o capturar): ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD y ?pestana=glp */
    var qp0 = null; try { qp0 = new URLSearchParams(location.search); } catch (e) { /* sin parámetros */ }
    var r0 = rangoInicial(qp0 || new URLSearchParams(''));
    state.desde = r0.desde; state.hasta = r0.hasta; state.preset = Rango.presetDe(r0.desde, r0.hasta, XMIN_ALL, XMAX);
    document.querySelectorAll('input[name=rango]').forEach(function (i) { i.checked = i.value === state.preset; });
    wireNav(); wireZoom();
    var rReal = document.querySelector('input[name=vista][value=real]');
    if (rReal && !IPC) {   // sin data/ipc.csv la vista no se puede calcular
      rReal.disabled = true;
      rReal.parentNode.title = 'Falta cargar el IPC del BCP (data/ipc.csv)';
      rReal.parentNode.classList.add('seg-off');
    }
    try {
      var qp = new URLSearchParams(location.search);
      if (qp.get('pestana') === 'glp') { el('#tab-glp').click(); abrirMetodologia(); return; }
    } catch (e) { /* sin parámetros */ }
    render();
    abrirMetodologia();
  }

  // El anillo de foco de los segmentados aparece solo al navegar con teclado: un click (que enfoca el radio) no lo muestra
  document.addEventListener('pointerdown', function () { document.documentElement.classList.add('con-puntero'); }, true);
  var TECLAS_NAV = ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape'];
  document.addEventListener('keydown', function (ev) {
    if (TECLAS_NAV.indexOf(ev.key) >= 0) document.documentElement.classList.remove('con-puntero');
  }, true);

  // Metodología: desplegable cerrado; con #metodologia en la URL (o un link a esa ancla) se abre y baja hasta ahí
  function abrirMetodologia() {
    if (location.hash !== '#metodologia') return;
    var d = document.getElementById('metodologia');
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', abrirMetodologia);
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[href="#metodologia"]') : null;
    if (a && location.hash === '#metodologia') { ev.preventDefault(); abrirMetodologia(); }   // mismo hash: hashchange no salta
  });

  initTema();
  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) {
      var er = el('#error-datos'); er.hidden = false;
      er.textContent = 'No se pudieron cargar los datos (' + e.message + '). Probá recargar la página.';
      if (window.console) console.error(e);
    });
})();
