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
  var OIL_NOMBRE = { wti: 'WTI', ulsd: 'Diésel ULSD' };
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
  var state = { vista: 'dual', oil: 'wti', rango: 'all', tab: 'liq', sel: null };
  var D = null;          // datos crudos
  var PRODS = {};        // id -> {meta, segs}
  var OIL = {};          // wti|ulsd -> {mensual:[{d,v}], diario:[{d,iso,v}]}
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

    ['wti', 'ulsd'].forEach(function (k) {
      var o = (D.petroleo || {})[k];
      if (!o) return;
      OIL[k] = {
        mensual: (o.mensual || []).map(function (r) { return { d: parse(r[0]), v: r[1] }; }),
        diario: (o.diario || []).map(function (r) { return { d: parse(r[0]), iso: r[0], v: r[1] }; })
      };
    });
  }

  function seriesPrice(id) {
    var p = PRODS[id];
    if (!p || !p.segs.length) return null;
    return { id: id, kind: 'price', name: p.meta.nombre, short: CORTOS[id] || p.meta.nombre, color: cvar(id), segs: p.segs, gaps: p.gaps, rows: p.rows,
      hasMax: p.rows.some(function (r) { return r.tipo_precio === 'max_o_sugerido_venta_publico'; }) };
  }
  function seriesOil(k) {
    var o = OIL[k];
    if (!o || !o.mensual.length) return null;
    var last = o.mensual[o.mensual.length - 1].d;
    return { id: 'oil_' + k, kind: 'oil', key: k, name: OIL_NOMBRE[k], short: k === 'wti' ? 'WTI' : 'ULSD', color: 'var(--oil)',
      segs: [{ pts: o.mensual, end: last }], gaps: [] };
  }
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
  function niceOilStep(max, n) {
    var need = max / n, base = Math.pow(10, Math.floor(Math.log10(need)));
    var mult = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < mult.length; i++) if (base * mult[i] >= need) return base * mult[i];
    return base * 10;
  }
  function yMaxVisible(list, xmin, xmax) {
    var m = 0;
    list.forEach(function (s) {
      s.segs.forEach(function (g) {
        g.pts.forEach(function (p) { if (p.d >= xmin && p.d <= xmax && p.v > m) m = p.v; });
      });
      var p0 = pointAt(s, xmin); if (p0 && p0.v > m) m = p0.v;
    });
    return m;
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

    // rango x
    var xmax = XMAX, xmin = XMIN_ALL;
    if (o.rango !== 'all') {
      xmin = new Date(Date.UTC(xmax.getUTCFullYear() - (+o.rango), xmax.getUTCMonth(), xmax.getUTCDate()));
      if (xmin < XMIN_ALL) xmin = XMIN_ALL;
    }

    if (o.xDesdeDatos && lista.length) {   // p. ej. GLP: el eje arranca en su primer dato (con margen de 60 días)
      xmin = new Date(+d3.min(lista, firstD) - 60 * 864e5);
    }

    // layout
    var dualAx = showOil && !index;
    var axisR = dualAx && !mobile ? 58 : 0;   // en móvil los ticks US$ van por dentro del área
    var labW = mobile ? 0 : 178;      // en móvil las etiquetas finales van en un bloque debajo del gráfico
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
      var mx = yMaxVisible(priceAct, xmin, xmax) || 12000;
      var raw = mx * 1.04, step = 10000, cs = [500, 1000, 2000, 2500, 5000, 10000];
      for (var ci = 0; ci < cs.length; ci++) { if (Math.ceil(raw / cs[ci]) <= 6) { step = cs[ci]; break; } }
      var n = Math.max(1, Math.ceil(raw / step));
      ticksL = d3.range(0, n + 1).map(function (i) { return i * step; });
      yL = d3.scaleLinear().domain([0, step * n]).range([ih, band]);
      if (dualAx) {
        var oilAct = activas.indexOf(o.oil) >= 0;
        var om = oilAct ? yMaxVisible([o.oil], xmin, xmax) : 3;
        var rs = niceOilStep((om || 3) * 1.05, n);
        yR = d3.scaleLinear().domain([0, rs * n]).range([ih, band]);
        ticksR = d3.range(0, n + 1).map(function (i) { return i * rs; });
        decR = rs % 1 === 0 ? 0 : (Math.abs(rs * 10 - Math.round(rs * 10)) < 1e-9 ? 1 : 2);
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
      g.append('text').attr('class', 'halo tramo-t').attr('x', ta + 4).attr('y', fs + 1).attr('font-size', mobile ? 10 : 11)
        .text('Precio máximo/sugerido');
    }

    // grilla y ejes
    g.append('g').attr('class', 'grid').selectAll('line').data(ticksL).join('line')
      .attr('x1', 0).attr('x2', iw).attr('y1', yL).attr('y2', yL);
    var fmtL = index ? function (v) { return dec(v, 0); } : function (v) { return miles(v); };
    g.append('g').attr('class', 'axis').call(d3.axisLeft(yL).tickValues(ticksL).tickFormat(fmtL).tickSize(0).tickPadding(6))
      .call(function (a) { a.select('.domain').remove(); }).selectAll('text').attr('font-size', fs);
    var nY = (xmax - xmin) / (365.25 * 864e5);
    var tickV, fmtX;
    if (nY <= 3.2) {
      tickV = d3.utcMonth.every(mobile ? 6 : 3).range(xmin, xmax);
      fmtX = function (d) { return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MESES[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); };
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
      .text(index ? 'Índice (base 100)' : (o.ejeL || 'Gs por litro'));
    if (dualAx) {
      if (mobile) {
        /* ticks US$ en móvil: se dibujan después de las líneas (con halo) */
      } else {
        g.append('g').attr('class', 'axis').attr('transform', 'translate(' + iw + ',0)')
          .call(d3.axisRight(yR).tickValues(ticksR).tickFormat(function (v) { return 'US$ ' + dec(v, decR); }).tickSize(0).tickPadding(6))
          .call(function (a) { a.select('.domain').remove(); }).selectAll('text').attr('font-size', fs);
      }
      g.append('text').attr('x', iw + axisR).attr('text-anchor', 'end').attr('y', -9).attr('font-size', mobile ? 10 : 11.5)
        .text(mobile ? 'US$/gal' : 'US$ por galón (' + o.oil.short + ')');
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
      var txt = mobile ? v.e.etiqueta.replace(/\s*\(.*?\)/g, '') : v.e.etiqueta;
      var tt = g.append('text').attr('class', 'hito-t halo').attr('y', fs + 1 + (k % 2) * fs2)
        .attr('font-size', mobile ? 10 : 11).text(txt);
      var tl = 0; try { tl = tt.node().getComputedTextLength(); } catch (e) { tl = txt.length * 6; }
      var spR = iw - xx - 5, spL = xx - 5, right = tl <= spR ? false : (tl <= spL ? true : spL > spR);
      var sp = right ? spL : spR;
      if (tl > sp && sp > 20) tt.text(txt.slice(0, Math.max(3, Math.floor(txt.length * sp / tl) - 1)) + '…');
      tt.attr('x', xx + (right ? -5 : 5)).attr('text-anchor', right ? 'end' : 'start');
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
      var marcado = {}, rr = mobile ? 5 : 6;
      function rombo(d, v, firme) {
        if (d < xmin || d > xmax) return;
        nGapMarks++;
        var cx = x(d), cy = yOf(s, v);
        gm.append('path').attr('d', 'M' + cx + ',' + (cy - rr) + 'l' + rr + ',' + rr + 'l' + (-rr) + ',' + rr + 'l' + (-rr) + ',' + (-rr) + 'z')
          .style('fill', firme ? s.color : 'var(--bg)').style('stroke', s.color).attr('stroke-width', 2);
      }
      // hueco: último punto conocido antes (a) y primero después (b); nunca se arrastra el precio
      (s.gaps || []).forEach(function (hg) {
        if ((hg.b && hg.b < xmin) || hg.a > xmax) return;
        var antes = null, despues = null;
        s.rows.forEach(function (r) {
          if (r.fecha <= hg.aIso) antes = r;
          if (!despues && hg.bIso && r.fecha >= hg.bIso) despues = r;
        });
        if (antes) { rombo(hg.a, antes.precio, antes.firme !== false); marcado[+hg.a] = true; if (antes.fecha === hg.aIso) marcado[+parse(antes.fecha)] = true; }
        if (despues) { rombo(parse(despues.fecha), despues.precio, despues.firme !== false); marcado[+parse(despues.fecha)] = true; }
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
    var lab = [], fin = [];
    all.forEach(function (s) {
      if (activas.indexOf(s) < 0) return;
      var gLast = s.segs[s.segs.length - 1], pl = gLast.pts[gLast.pts.length - 1];
      var v = tr(s, pl.v);
      if (!isFinite(v)) return;
      var alcanza = s.kind === 'oil' || (xmax - gLast.end) < 864e5 * 2;
      if (alcanza) {
        lab.push({ s: s, y0: yOf(s, pl.v), v: v });
      } else if (gLast.end >= xmin) {
        fin.push({ s: s, x: x(gLast.end), y: yOf(s, pl.v), end: gLast.end });
      }
    });
    var gap = fs + 3;
    var lx = iw + axisR + 6;
    function valTxt(s, v) {
      if (index) return dec(v, 0);
      return s.kind === 'oil' ? 'US$ ' + dec(v, 2) + '/gal' : miles(v);
    }
    if (mobile) {
      // móvil: puntos sobre la línea y un bloque de valores debajo del gráfico (texto en tinta del tema)
      lab.forEach(function (it) { g.append('circle').attr('cx', iw).attr('cy', it.y0).attr('r', 3).style('fill', it.s.color); });
    } else {
      relax(lab, gap, band, ih + 6);
      lab.forEach(function (it) {
        var s = it.s;
        g.append('circle').attr('cx', iw).attr('cy', it.y0).attr('r', 3).style('fill', s.color);
        if (Math.abs(it.y - it.y0) > 1) {
          g.append('line').attr('x1', iw).attr('y1', it.y0).attr('x2', lx).attr('y2', it.y).style('stroke', s.color).attr('stroke-width', 1);
        }
        var sw = g.append('g').attr('transform', 'translate(' + lx + ',' + it.y + ')');
        if (s.kind === 'oil') {
          sw.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).style('stroke', s.color)
            .attr('stroke-width', 2.6).attr('stroke-linecap', 'round').attr('stroke-dasharray', '0.1 5');
        } else {
          sw.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).style('stroke', s.color).attr('stroke-width', 3);
        }
        var tx = sw.append('text').attr('x', 18).attr('y', 0).attr('dy', '0.34em').attr('font-size', fs)
          .attr('class', s.kind === 'oil' ? 'lbl-oil' : 'lbl-v');
        tx.append('tspan').text((s.kind === 'oil' ? s.short : s.name) + ' ');
        tx.append('tspan').attr('font-weight', 700).text(valTxt(s, it.v));
      });
    }
    fin.forEach(function (it) {
      // marcador discreto del corte (el texto "dato hasta" está en tabla, nota y tooltip)
      g.append('line').attr('x1', it.x).attr('x2', it.x).attr('y1', it.y - 7).attr('y2', it.y + 7).style('stroke', it.s.color).attr('stroke-width', 2.5);
    });

    if (mobile) {
      var fb = document.createElement('ul');
      fb.className = 'finales';
      var items = lab.slice().sort(function (a, b) { return a.y0 - b.y0; }).map(function (it) {
        return { s: it.s, txt: valTxt(it.s, it.v) };
      }).concat(fin.map(function (it) { return { s: it.s, txt: 'dato hasta ' + fmtD(it.end) }; }));
      fb.innerHTML = items.map(function (it) {
        return '<li><span class="sw' + (it.s.kind === 'oil' ? ' sw-oil' : '') + '" style="border-color:' + it.s.color + '"></span> '
          + esc(it.s.kind === 'oil' ? it.s.short : it.s.name) + ' <strong>' + esc(it.txt) + '</strong></li>';
      }).join('');
      host.appendChild(fb);
    }

    // interacción
    var guia = g.append('line').attr('class', 'guia').attr('y1', 0).attr('y2', ih).style('display', 'none');
    var foco = g.append('circle').attr('r', 6).attr('fill', 'none').attr('stroke-width', 2).style('display', 'none');
    var tip = document.createElement('div');
    tip.className = 'tt'; tip.hidden = true;
    host.appendChild(tip);
    var st = charts[hostId] = charts[hostId] || {};
    st.pinned = false;

    function inspect(px, py) {
      var t = x.invert(px);
      var cand = [];
      lista.forEach(function (s) {
        var p = pointAt(s, t);
        if (!p) {   // filas aisladas (tramo de un solo día): se "pegan" si el cursor está a pocos px
          s.segs.forEach(function (sg) {
            if (sg.pts.length === 1 && +sg.end === +sg.pts[0].d && Math.abs(x(sg.pts[0].d) - px) <= 8) p = sg.pts[0];
          });
        }
        if (p) cand.push({ s: s, p: p, y: yOf(s, p.v) });
      });
      var best = null;
      cand.forEach(function (c) { var dd = Math.abs(c.y - py); if (!best || dd < best.dd) { best = c; best.dd = dd; } });
      var h = '<h3>' + esc(fmtD(t)) + '</h3>';
      if (best) {
        var r = best.p.row, s = best.s;
        h += '<div><span class="sw" style="border-color:' + s.color + '"></span> <strong>' + esc(s.name) + ': ' + gs(r.precio) + (o.unidadTxt ? ' ' + esc(o.unidadTxt(s)) : '') + '</strong>'
          + (index ? ' <span class="f">(índice ' + dec(tr(s, r.precio), 1) + ')</span>' : '') + '</div>';
        h += '<div><span class="f">Vigente desde:</span> ' + fmtIso(r.fecha) + '</div>';
        h += '<div><span class="f">Tipo de precio:</span> ' + esc(TIPO_TXT[r.tipo_precio] || r.tipo_precio) + '</div>';
        h += '<div><span class="f">Estado:</span> ' + esc(ESTADO_TXT[r.estado] || r.estado)
          + ' · <span class="f">fecha:</span> ' + esc(FECHA_ESTADO_TXT[r.fecha_estado] || r.fecha_estado)
          + (r.firme === false ? ' <span class="nofirme">no firme</span>' : '') + '</div>';
        if (r.fuente) h += '<div><span class="f">Fuente:</span> ' + esc(r.fuente) + '</div>';
        var us = (r.urls || []).filter(urlOk);
        if (us.length) {
          h += '<div>' + us.map(function (u, i) {
            return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Enlace a la fuente' + (us.length > 1 ? ' ' + (i + 1) : '') + '</a>';
          }).join(' · ') + '</div>';
        }
        if (r.nota) h += '<div class="f">' + esc(r.nota) + '</div>';
        if (cand.length > 1) {
          h += '<div class="sep"><span class="f">Otros productos ese día:</span></div>';
          cand.forEach(function (c) {
            if (c === best) return;
            h += '<div><span class="sw" style="border-color:' + c.s.color + ';width:12px"></span> ' + esc(c.s.name) + ': ' + gs(c.p.v)
              + (index ? ' <span class="f">(' + dec(tr(c.s, c.p.v), 1) + ')</span>' : '') + '</div>';
          });
        }
        st.foco = { x: x(best.p.d), y: best.y, color: best.s.color };
      } else {
        h += '<div class="f">Sin precio vigente de los productos elegidos en esta fecha.</div>';
        st.foco = null;
      }
      lista.forEach(function (s) {
        var hg = gapAt(s, t);
        if (hg && !hg.b) h += '<div class="sep"><span class="sw" style="border-color:' + s.color + ';width:12px"></span> <strong>' + esc(s.name)
          + '</strong>: sin datos desde ' + fmtD(hg.a) + '.</div>';
        else if (hg) h += '<div class="sep"><span class="sw" style="border-color:' + s.color + ';width:12px"></span> <strong>' + esc(s.name)
          + '</strong>: sin datos entre ' + fmtD(hg.a) + ' y ' + fmtD(hg.b) + '. <span class="f">No se estima ni se arrastra el último precio.</span></div>';
      });
      if (tramoVis && t >= TRAMO.a && t < TRAMO.b) {
        h += '<div class="sep f">Entre ' + fmtD(TRAMO.a) + ' y ' + fmtD(TRAMO.b)
          + ' el dato es el precio máximo y/o sugerido, no el precio de venta al público.</div>';
      }
      if (showOil && OIL[o.oil.key]) {
        var od = OIL[o.oil.key].diario, i = d3.bisector(function (q) { return q.d; }).left(od, t);
        var c1 = od[Math.max(0, i - 1)], c2 = od[Math.min(od.length - 1, i)], c = c1 || c2;
        if (c1 && c2 && Math.abs(c2.d - t) < Math.abs(c1.d - t)) c = c2;
        var mp = o.oil.segs[0].pts, mi = bisD(mp, t) - 1, mm = mp[Math.max(0, mi)];
        if (c) {
          h += '<div class="sep"><span class="sw" style="border-color:var(--oil);border-top-style:dotted"></span> <strong>' + esc(o.oil.name) + '</strong>: US$ ' + dec(c.v, 2) + '/gal'
            + ' <span class="f">(diario, ' + fmtIso(c.iso) + ')</span>'
            + (mm ? '<br><span class="f">Promedio mensual (' + MESES[mm.d.getUTCMonth()] + ' ' + mm.d.getUTCFullYear() + '):</span> US$ ' + dec(mm.v, 2) + '/gal' : '') + '</div>';
        }
      }
      // eventos cercanos
      var near = evs.filter(function (v) {
        var x1 = x(v.a), x2 = v.b ? x(v.b) : x1;
        return px >= x1 - 6 && px <= x2 + 6;
      });
      near.forEach(function (v) {
        var e = v.e;
        h += '<div class="sep"><strong>' + (e.tipo === 'promo' ? 'Promoción: ' : 'Hito: ') + esc(e.etiqueta) + '</strong><br><span class="f">'
          + fmtIso(e.fecha) + (e.fecha_fin ? ' al ' + fmtIso(e.fecha_fin) : '') + '</span>'
          + (e.fuente ? '<br><span class="f">Fuente:</span> ' + esc(e.fuente) : '')
          + (urlOk(e.url) ? ' <a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">enlace</a>' : '')
          + (e.nota ? '<br><span class="f">' + esc(e.nota) + '</span>' : '') + '</div>';
      });
      return { html: h, t: t };
    }

    function mostrar(px, py, fijar) {
      var r = inspect(px, py);
      tip.innerHTML = (fijar ? '<button class="x" aria-label="Cerrar">&times;</button>' : '') + r.html;
      tip.hidden = false;
      tip.classList.toggle('fijo', !!fijar);
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = m.left + px + 14;
      if (left + tw > W - 2) left = m.left + px - tw - 14;
      if (left < 2) left = Math.max(2, Math.min(W - tw - 2, 2));
      var top = Math.max(2, Math.min(H - th - 2, m.top + py - th / 2));
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      guia.style('display', null).attr('x1', px).attr('x2', px);
      if (st.foco) foco.style('display', null).attr('cx', st.foco.x).attr('cy', st.foco.y).style('stroke', st.foco.color);
      else foco.style('display', 'none');
      var b = tip.querySelector('.x');
      if (b) b.addEventListener('click', function (ev) { ev.stopPropagation(); ocultar(true); });
    }
    function ocultar(force) {
      if (st.pinned && !force) return;
      st.pinned = false; tip.hidden = true; tip.classList.remove('fijo');
      guia.style('display', 'none'); foco.style('display', 'none');
    }
    var ov = g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('cursor', 'crosshair');
    function loc(ev) { var r = ov.node().getBoundingClientRect(); return [Math.max(0, Math.min(iw, ev.clientX - r.left)), Math.max(0, Math.min(ih, ev.clientY - r.top))]; }
    ov.on('pointermove', function (ev) {
      if (st.pinned || ev.pointerType === 'touch') return;
      var p = loc(ev); mostrar(p[0], p[1], false);
    });
    ov.on('pointerleave', function (ev) { if (ev.pointerType !== 'touch') ocultar(false); });
    ov.on('click', function (ev) { var p = loc(ev); st.pinned = true; mostrar(p[0], p[1], true); });
    svg.on('keydown', null);
    st.esc = function () { ocultar(true); };

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
    if (f.hueco) h += '<span class="it"><svg width="14" height="14" aria-hidden="true"><path d="M7,1 L13,7 L7,13 L1,7z" fill="currentColor"/></svg>Borde de un hueco sin datos</span>';
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
      .map(function (p) { return seriesPrice(p.id); }).filter(Boolean);
    var oil = state.oil === 'none' ? null : seriesOil(state.oil);
    return {
      series: sel, oil: oil, view: state.vista, rango: state.rango, leyendaId: 'leyenda-liq',
      vacio: 'Elegí al menos un producto para ver el gráfico.',
      aria: 'Precios de combustibles de Petropar y petróleo internacional, serie histórica'
    };
  }
  function optsGlp() {
    return {
      series: glps().map(function (p) { return seriesPrice(p.id); }).filter(Boolean),
      oil: null, view: 'dual', rango: 'all', leyendaId: 'leyenda-glp', altura: undefined,
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
    } else if (state.oil !== 'none' && seriesOil(state.oil)) {
      msg += 'Eje derecho en US$ por galón, con escala independiente: no compares alturas entre combustibles y petróleo.';
    }
    return msg;
  }
  function renderLiq() {
    var o = optsLiq(), av = el('#aviso-vista');
    av.textContent = notaVista(null);
    o.onInfo = function (i) { av.textContent = notaVista(i.base); };
    if (OG) o.altura = 470;
    drawChart('chart-liq', o);
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
     Orden: el de data.tarjetas. En desktop ancho la lista va en 2 columnas que se llenan por columnas (grid por columnas:
     primero baja la columna izquierda y después la derecha), así el orden de lectura es el de data.tarjetas. */
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
    box.innerHTML = filas.map(function (f) {
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
      if (conf) meta += (main.vigente_desde > HOY ? 'rige desde ' : 'desde ') + fechaCorta(main.vigente_desde);
      if (its.some(function (x) { return x.por_confirmar; })) meta += (meta ? ' · ' : '') + '<span class="f-pc">por confirmar</span>';
      return '<button type="button" class="fila" data-id="' + esc(f.id) + '" style="--tc:' + f.color + '">'
        + '<span class="f-dot" aria-hidden="true"></span>'
        + '<span class="f-nom">' + esc(f.nombre) + '</span>'
        + '<span class="f-precio">' + precios + '</span>'
        + cam + '<span class="f-meta">' + meta + '</span>'
        + '<span class="sr-only"> — ver en el gráfico histórico</span></button>';
    }).join('');
    box.style.setProperty('--filas', Math.ceil(filas.length / 2));   // 2 columnas en desktop: la izquierda lleva la mitad de arriba
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
    var v = el('#verif'); if (!v) return;
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
    [['vista', 'vista'], ['oil', 'oil'], ['rango', 'rango']].forEach(function (c) {
      document.querySelectorAll('input[name=' + c[0] + ']').forEach(function (i) {
        i.addEventListener('change', function () { if (i.checked) { state[c[1]] = i.value; render(); } });
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

  function textos() {
    var u = D.ultimo_dato || {};
    var o = [];
    if (u.wti) o.push('WTI al ' + fmtIso(u.wti));
    if (u.ulsd) o.push('ULSD al ' + fmtIso(u.ulsd));
    el('#frescura').textContent = o.length ? 'Petróleo (EIA): ' + o.join(', ') + '.' : '';
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

    var titulo = state.tab === 'glp' ? 'Precio del GLP (Ñande Gas) de Petropar' : 'Precios de combustibles de Petropar y precio del petróleo';
    var subt = state.tab === 'glp' ? 'Guaraníes por kg y por litro, nominal'
      : 'Guaraníes por litro, nominal' + (o.oil ? (o.view === 'index' ? '; índice base 100' : '; petróleo en US$ por galón (eje derecho, escala independiente)') : '');
    var u = D.ultimo_dato || {};
    var fuente = 'Fuente: Petropar (respuesta AIP N° 90150, prensa y página oficial)' + (o.oil ? '; U.S. Energy Information Administration (EIA)' : '') + '.';
    var fecha = 'Datos al ' + fmtIso(u.petropar || iso(new Date())) + (o.oil && u.wti ? ' (petróleo al ' + fmtIso(u.wti) + ')' : '') + ' · combuspy-tracker.vercel.app';
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
        if (b) bajar('petropar_' + (state.tab === 'glp' ? 'glp' : 'combustibles') + '_' + (u.petropar || iso(new Date())) + '.png', b);
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
      pf.textContent = 'Gs por litro (nominal) y petróleo WTI en US$ por galón, escalas independientes. Fuente: Petropar; EIA. Datos al '
        + fmtIso(u.petropar || '') + '. combuspy-tracker.vercel.app';
      el('#chart-liq').after(pf);
    }
    var dt = el('#det-tabla');   // la tabla completa se arma solo al abrir (o con ?tabla=1, útil para capturas)
    dt.addEventListener('toggle', function () { if (dt.open) armarTabla(); });
    try { if (new URLSearchParams(location.search).get('tabla') === '1') { dt.open = true; armarTabla(); } } catch (e) { /* sin parámetros */ }
    /* Parámetros de URL (para compartir o capturar): ?rango=all|10|5|2 y ?pestana=glp */
    try {
      var qp = new URLSearchParams(location.search), rg = qp.get('rango');
      if (rg && ['all', '10', '5', '2'].indexOf(rg) >= 0) {
        state.rango = rg;
        var ri = document.querySelector('input[name=rango][value="' + rg + '"]'); if (ri) ri.checked = true;
      }
      if (qp.get('pestana') === 'glp') { el('#tab-glp').click(); return; }
    } catch (e) { /* sin parámetros */ }
    render();
  }

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
