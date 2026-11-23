/* Shared helpers for the block-graph options. Data lives in graph-data.js (window.BG). */
(function () {
  var BG = window.BG;
  var NW = 168, NH = 56;
  var blocks = {}, order = [];
  BG.blocks.forEach(function (b) { blocks[b[0]] = { id: b[0], name: b[1], color: b[2] }; order.push(b[0]); });
  var pairs = {}, pairList = [];
  BG.pairs.forEach(function (p) {
    var o = { key: p[0] + '>' + p[1], f: p[0], t: p[1], items: p[2].map(function (i) { return { n: i[0], r: i[1], s: i[2], k: i[3] }; }) };
    pairs[o.key] = o; pairList.push(o);
  });
  var outDeg = {}, inDeg = {};
  order.forEach(function (id) { outDeg[id] = 0; inDeg[id] = 0; });
  pairList.forEach(function (p) { outDeg[p.f]++; inDeg[p.t]++; });

  function fmt(r) {
    if (r >= 10000) return (r / 1000).toFixed(1).replace('.0', '') + 'k';
    if (r >= 100) return String(Math.round(r));
    if (r >= 10) return r.toFixed(1).replace(/\.0$/, '');
    if (r > 0) return r.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
    return '0';
  }
  function worst(items) {
    var l = false, o = false;
    items.forEach(function (i) { if (i.s === 'l') l = true; if (i.s === 'o') o = true; });
    return l ? 'l' : (o ? 'o' : 'u');
  }
  function smooth(pts) {
    var d = 'M ' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], mx = (a[0] + b[0]) / 2;
      d += ' C ' + mx + ' ' + a[1] + ', ' + mx + ' ' + b[1] + ', ' + b[0] + ' ' + b[1];
    }
    return d;
  }
  function backPath(sx, sy, tx, ty, lane) {
    return 'M ' + sx + ' ' + sy + ' C ' + (sx + 24) + ' ' + sy + ', ' + (sx + 24) + ' ' + lane + ', ' + sx + ' ' + lane +
      ' L ' + tx + ' ' + lane + ' C ' + (tx - 24) + ' ' + lane + ', ' + (tx - 24) + ' ' + ty + ', ' + tx + ' ' + ty;
  }

  /* A scene from graph-data.js, with edge ends spread along the node sides (ports). */
  function scene(key) {
    var S = BG[key];
    var nodes = S.nodes.map(function (n) {
      var b = blocks[n[0]];
      return { id: b.id, name: b.name, color: b.color, x: n[1], y: n[2], col: n[3], iso: n[3] < 0 };
    });
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var edges = S.edges.map(function (e) {
      var p = pairs[e[0] + '>' + e[1]];
      return { key: p.key, f: e[0], t: e[1], n: p.items.length, back: !!e[2], pts: e[3].map(function (q) { return [q[0], q[1]]; }), st: worst(p.items) };
    });
    var inc = {}, outg = {};
    edges.forEach(function (e) {
      if (e.back) return;
      (outg[e.f] = outg[e.f] || []).push(e);
      (inc[e.t] = inc[e.t] || []).push(e);
    });
    Object.keys(outg).forEach(function (id) {
      var list = outg[id].slice().sort(function (a, b) { return a.pts[1][1] - b.pts[1][1]; });
      list.forEach(function (e, k) { e.pts[0][1] = Math.round(byId[id].y + 8 + (NH - 16) * (k + 0.5) / list.length); });
    });
    Object.keys(inc).forEach(function (id) {
      var list = inc[id].slice().sort(function (a, b) { return a.pts[a.pts.length - 2][1] - b.pts[b.pts.length - 2][1]; });
      list.forEach(function (e, k) { e.pts[e.pts.length - 1][1] = Math.round(byId[id].y + 8 + (NH - 16) * (k + 0.5) / list.length); });
    });
    var backs = edges.filter(function (e) { return e.back; });
    var bottom = 0; nodes.forEach(function (n) { if (!n.iso && n.y + NH > bottom) bottom = n.y + NH; });
    backs.forEach(function (e, k) {
      var s = byId[e.f], t = byId[e.t];
      e.lane = bottom + 26 + k * 12;
      e.d = backPath(s.x + NW, Math.round(s.y + NH / 2), t.x, Math.round(t.y + NH / 2), e.lane);
      e.bx = Math.round((s.x + NW + t.x) / 2); e.by = e.lane;
    });
    edges.forEach(function (e) { if (!e.back) e.d = smooth(e.pts); });
    var isoY = bottom + 26 + backs.length * 12 + 28;
    nodes.forEach(function (n) { if (n.iso) n.y = isoY; });
    var maxB = 0; nodes.forEach(function (n) { if (n.y + NH > maxB) maxB = n.y + NH; });
    var maxR = 0; nodes.forEach(function (n) { if (n.x + NW > maxR) maxR = n.x + NW; });
    return { w: Math.max(S.w, maxR), h: maxB, nodes: nodes, byId: byId, edges: edges, lanes: backs.length, bottom: bottom, hubs: S.hubs || [] };
  }

  /* Dependency order: layers of the tidy layout, then its row order; unconnected blocks last. */
  function depOrder() {
    var s = scene('A');
    return s.nodes.slice().sort(function (a, b) {
      if (a.iso !== b.iso) return a.iso ? 1 : -1;
      return a.col - b.col || a.y - b.y;
    }).map(function (n) { return n.id; });
  }

  window.BGH = {
    NW: NW, NH: NH, blocks: blocks, order: order, pairs: pairs, pairList: pairList, outDeg: outDeg, inDeg: inDeg,
    fmt: fmt, worst: worst, smooth: smooth, backPath: backPath, scene: scene, depOrder: depOrder,
    OK: '#16a34a', LIM: '#f59e0b', UNU: '#6b7280',
    stColor: function (s) { return s === 'l' ? '#f59e0b' : (s === 'u' ? '#6b7280' : '#16a34a'); },
    stText: function (s) { return s === 'l' ? 'limited' : (s === 'u' ? 'not used' : 'ok'); }
  };
})();
